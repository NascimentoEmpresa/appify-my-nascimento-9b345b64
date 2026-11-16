-- =========================================================================
-- SST › ASO PERIÓDICO — controle automático dos vencimentos (14/11/2026)
--
-- PEDIDO DO SST: hoje os periódicos saem da listagem que a PROTEGE manda;
-- o SST confere quem está ativo, consulta cada um no portal da Zielo e pede
-- o agendamento por e-mail. Passa a ser o ERP quem diz quem precisa fazer:
-- periodicidade de 1 ano na UFFS e de 2 anos nos demais contratos, contada
-- do ÚLTIMO ASO realizado — admissional, periódico, retorno ou troca de
-- função.
--
-- DE ONDE SAI O ÚLTIMO ASO (o maior entre as fontes, por CPF — o "ID" de
-- EMPREGADOS a carga da Senior apaga e recria, o CPF não muda):
--   - admissional     WA_CURRICULOS (Recrutamento): sst_data_exame, ou o dia
--                     em que o SST marcou o ASO realizado/recebido;
--   - troca de função SISTEMA_SOLICITACOES_TROCA_FUNCAO.sst_aso_data (fora as
--                     reprovadas);
--   - retorno         SST_CTRL_AFASTAMENTO com ASO realizado: aso_recebido_em;
--   - periódico       SST_ASO_PERIODICO realizado (esta tabela): realizado_em.
--   - SEM NENHUM DESSES: a data de admissão da Senior, marcada como
--     "admissao_estimada" — o admissional de quem entrou antes do ERP não
--     está em lugar nenhum. A tela mostra "estimado pela admissão" e o SST
--     corrige registrando o último periódico (realizado, sem solicitação).
--
-- STATUS (régua repetida em src/lib/sst/asoPeriodico.ts, com teste):
--   ciclo em aberto com data de agendamento → Agendado
--   ciclo em aberto sem data de agendamento → Aguardando agendamento
--   sem ciclo em aberto: vencimento < hoje → Vencido;
--                        vencimento <= hoje + 60 dias → Próximo do vencimento;
--                        último ASO é periódico deste controle → Realizado/recebido;
--                        senão → Em dia (não entra no painel).
--   O ciclo nasce quando o SST registra a solicitação à clínica.
--
-- O QUE ESTA MIGRATION FAZ (aditiva)
--   1. Menu sst_aso_periodico (visualizar + alterar), semeado de quem já tem
--      sst_aso (ASO / Admissão) — é a mesma equipe.
--   2. SST_ASO_PERIODICO: um ciclo por solicitação; um em aberto por CPF.
--      Leitura com visualizar; escrita só pelas RPCs (alterar).
--   3. Gatilho: realizado exige data de realização (não futura) e resultado.
--   4. Bucket privado sst-aso-periodico para o ASO (dado de saúde).
--   5. RPCs: sst_aso_per_lista, sst_aso_per_salvar, sst_aso_per_anexo_registrar,
--      sst_aso_per_anexo_remover.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_aso_periodico', 'ASO Periódico', '/app/sst/aso-periodico',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_aso_periodico');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_aso_periodico', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sst_aso_periodico', pp.acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'sst_aso'
   AND pp.acao IN ('visualizar', 'alterar') AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'sst_aso_periodico' AND x.acao = pp.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sst_aso_periodico', s.acao, true,
       'Migração 20261114100000: já cuidava do ASO / Admissão'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'sst_aso'
   AND s.acao IN ('visualizar', 'alterar') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sst_aso_periodico' AND x.acao = s.acao);

CREATE OR REPLACE FUNCTION public.sst_aso_per_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_aso_periodico', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_per_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_aso_per_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) ao ASO Periódico', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_aso_per_exige(text) FROM PUBLIC, anon, authenticated;

-- ── 2. Tabela ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_ASO_PERIODICO" (
  id                  bigserial PRIMARY KEY,
  cpf                 text NOT NULL,          -- só dígitos: é a chave do colaborador aqui
  empregado_id        bigint,                 -- EMPREGADOS."ID" no dia (sem FK: a Senior recria)
  nome                text NOT NULL,
  filial_nome         text,
  contrato_nome       text,
  periodicidade_meses integer NOT NULL CHECK (periodicidade_meses IN (12, 24)),
  vencimento_previsto date,                   -- o vencimento que abriu o ciclo
  solicitado_em       date,                   -- solicitação do agendamento à clínica
  agendado_para       date,                   -- data do agendamento
  clinica             text,
  realizado           boolean NOT NULL DEFAULT false,  -- realizado/recebido
  realizado_em        date,                   -- data da realização
  resultado           text CHECK (resultado IS NULL OR resultado IN ('apto', 'inapto')),
  aso_path            text,
  aso_nome            text,
  observacao          text,
  created_by          uuid,
  created_por_nome    text,
  atualizado_por_nome text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_aso_per_cpf_ck CHECK (cpf ~ '^\d{11}$')
);
-- Um ciclo em aberto por colaborador.
CREATE UNIQUE INDEX IF NOT EXISTS sst_aso_per_um_aberto_uq ON public."SST_ASO_PERIODICO" (cpf) WHERE NOT realizado;
CREATE INDEX IF NOT EXISTS sst_aso_per_cpf_idx ON public."SST_ASO_PERIODICO" (cpf, realizado_em DESC);

ALTER TABLE public."SST_ASO_PERIODICO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_ASO_PERIODICO" FROM anon;
GRANT SELECT ON public."SST_ASO_PERIODICO" TO authenticated;
DROP POLICY IF EXISTS sst_aso_per_sel ON public."SST_ASO_PERIODICO";
CREATE POLICY sst_aso_per_sel ON public."SST_ASO_PERIODICO" FOR SELECT TO authenticated
  USING ((select public.sst_aso_per_pode('visualizar')));

-- ── 3. Regras do ciclo ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_regras()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.realizado THEN
    IF NEW.realizado_em IS NULL THEN RAISE EXCEPTION 'Informe a data da realização do ASO.'; END IF;
    IF NEW.resultado IS NULL THEN RAISE EXCEPTION 'Informe o resultado do ASO: apto ou inapto.'; END IF;
  ELSIF NEW.solicitado_em IS NULL THEN
    RAISE EXCEPTION 'Informe a data da solicitação do agendamento.';
  END IF;
  IF NEW.realizado_em > current_date THEN RAISE EXCEPTION 'A data da realização não pode ser futura.'; END IF;
  IF NEW.solicitado_em > current_date THEN RAISE EXCEPTION 'A data da solicitação não pode ser futura.'; END IF;
  IF NEW.agendado_para < NEW.solicitado_em THEN
    RAISE EXCEPTION 'O agendamento não pode ser antes da solicitação.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_regras() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sst_aso_per_regras ON public."SST_ASO_PERIODICO";
CREATE TRIGGER trg_sst_aso_per_regras
  BEFORE INSERT OR UPDATE ON public."SST_ASO_PERIODICO"
  FOR EACH ROW EXECUTE FUNCTION public.sst_aso_per_regras();

-- ── 4. ASO anexado: bucket privado ───────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-aso-periodico', 'sst-aso-periodico', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sst aso periodico select" ON storage.objects;
CREATE POLICY "sst aso periodico select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-aso-periodico' AND (select public.sst_aso_per_pode('visualizar')));
DROP POLICY IF EXISTS "sst aso periodico insert" ON storage.objects;
CREATE POLICY "sst aso periodico insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-aso-periodico' AND (select public.sst_aso_per_pode('alterar')));
DROP POLICY IF EXISTS "sst aso periodico delete" ON storage.objects;
CREATE POLICY "sst aso periodico delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sst-aso-periodico' AND (select public.sst_aso_per_pode('alterar')));

-- ── 5. Regras de cálculo ─────────────────────────────────────────────────
-- Periodicidade: UFFS 12 meses, demais 24 (pedido do SST).
CREATE OR REPLACE FUNCTION public.sst_aso_per_meses(p_contrato text, p_filial text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN COALESCE(p_contrato, '') || ' ' || COALESCE(p_filial, '') ~* '\mUFFS\M' THEN 12 ELSE 24 END
$$;

-- O último ASO de cada CPF, entre todas as fontes (ver cabeçalho).
CREATE OR REPLACE FUNCTION public.sst_aso_per_ultimos()
RETURNS TABLE (cpf text, data date, tipo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (f.cpf) f.cpf, f.data, f.tipo
    FROM (
      SELECT regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g') AS cpf,
             COALESCE(c.sst_data_exame, c.sst_aso_realizado_em::date) AS data, 'admissional' AS tipo
        FROM public."WA_CURRICULOS" c
       WHERE c.sst_aso_realizado_em IS NOT NULL AND c.sst_ok IS DISTINCT FROM false
      UNION ALL
      SELECT regexp_replace(COALESCE(t.colaborador_cpf, ''), '\D', '', 'g'), t.sst_aso_data, 'troca_funcao'
        FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
       WHERE t.sst_aso_data IS NOT NULL AND t.status <> 'Reprovada'
      UNION ALL
      SELECT regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g'), a.aso_recebido_em, 'retorno'
        FROM public."SST_CTRL_AFASTAMENTO" a
       WHERE a.aso_realizado AND a.aso_recebido_em IS NOT NULL
      UNION ALL
      SELECT p.cpf, p.realizado_em, 'periodico'
        FROM public."SST_ASO_PERIODICO" p
       WHERE p.realizado
    ) f
   WHERE length(f.cpf) = 11 AND f.data IS NOT NULL AND f.data <= current_date
   ORDER BY f.cpf, f.data DESC,
            -- Mesmo dia: o periódico registrado aqui vence o desempate.
            (f.tipo = 'periodico') DESC
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_ultimos() FROM PUBLIC, anon, authenticated;

-- Colaboradores ativos (não desligados), um por CPF, com contrato e o último ASO.
CREATE OR REPLACE FUNCTION public.sst_aso_per_base(p_cpf text DEFAULT NULL)
RETURNS TABLE (cpf text, empregado_id bigint, nome text, situacao text, filial_nome text, contrato_nome text,
               cargo text, admissao date, ultimo_aso date, ultimo_tipo text, periodicidade_meses integer, vencimento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH emp AS (
    SELECT DISTINCT ON (x.cpf) x.*
      FROM (SELECT regexp_replace(COALESCE(e."CPF", ''), '\D', '', 'g') AS cpf, e."ID" AS empregado_id,
                   btrim(e."Nome") AS nome, e."Situação" AS situacao, e."Nome Filial" AS filial_nome,
                   nullif(btrim(e."Título do Cargo"), '') AS cargo, public.rh_data(e."Admissão"::text) AS admissao
              FROM public."EMPREGADOS" e
             WHERE COALESCE(public.sst_afa_tipo_da_situacao(e."Situação"), '') <> 'desligamento') x
     WHERE length(x.cpf) = 11 AND (p_cpf IS NULL OR x.cpf = p_cpf)
     ORDER BY x.cpf, (x.situacao = 'Trabalhando') DESC, x.admissao DESC NULLS LAST
  ), com_aso AS (
    SELECT m.*, (SELECT c.nome FROM public.sup_empregado_contrato_depara d
                   JOIN public.contratos c ON c.id = d.contrato_id
                  WHERE d.filial_nome = m.filial_nome ORDER BY d.contrato_id LIMIT 1) AS contrato_nome,
           COALESCE(u.data, m.admissao) AS ultimo_aso,
           CASE WHEN u.data IS NOT NULL THEN u.tipo WHEN m.admissao IS NOT NULL THEN 'admissao_estimada' END AS ultimo_tipo
      FROM emp m
      LEFT JOIN public.sst_aso_per_ultimos() u ON u.cpf = m.cpf
  )
  SELECT a.cpf, a.empregado_id, a.nome, a.situacao, a.filial_nome, a.contrato_nome, a.cargo, a.admissao,
         a.ultimo_aso, a.ultimo_tipo, public.sst_aso_per_meses(a.contrato_nome, a.filial_nome),
         (a.ultimo_aso + make_interval(months => public.sst_aso_per_meses(a.contrato_nome, a.filial_nome)))::date
    FROM com_aso a
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_base(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_per_status(p_vencimento date, p_ultimo_tipo text, p_aberto boolean,
                                                     p_agendado date, p_hoje date, p_dias_aviso integer DEFAULT 60)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_aberto AND p_agendado IS NOT NULL THEN 'Agendado'
    WHEN p_aberto THEN 'Aguardando agendamento'
    WHEN p_vencimento IS NULL THEN 'Sem ASO'
    WHEN p_vencimento < p_hoje THEN 'Vencido'
    WHEN p_vencimento <= p_hoje + p_dias_aviso THEN 'Próximo do vencimento'
    WHEN p_ultimo_tipo = 'periodico' THEN 'Realizado/recebido'
    ELSE 'Em dia'
  END
$$;

-- ── 6. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_aso_per_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', b.cpf, 'empregado_id', b.empregado_id, 'nome', b.nome, 'situacao', b.situacao,
             'filial_nome', b.filial_nome, 'contrato_nome', b.contrato_nome, 'cargo', b.cargo,
             'admissao', b.admissao, 'ultimo_aso', b.ultimo_aso, 'ultimo_tipo', b.ultimo_tipo,
             'periodicidade_meses', b.periodicidade_meses, 'vencimento', b.vencimento,
             'status', public.sst_aso_per_status(b.vencimento, b.ultimo_tipo, c.id IS NOT NULL, c.agendado_para, current_date),
             'ciclo', CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) - 'created_by' END,
             'ultimo_periodico', CASE WHEN b.ultimo_tipo = 'periodico' THEN (
               SELECT to_jsonb(p) - 'created_by' FROM public."SST_ASO_PERIODICO" p
                WHERE p.cpf = b.cpf AND p.realizado ORDER BY p.realizado_em DESC, p.id DESC LIMIT 1) END)
           ORDER BY b.vencimento NULLS FIRST, b.nome)
      FROM public.sst_aso_per_base() b
      LEFT JOIN public."SST_ASO_PERIODICO" c ON c.cpf = b.cpf AND NOT c.realizado), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_lista() TO authenticated;

-- Abre (p sem id: precisa do cpf) ou altera um ciclo. Só os campos desta lista são gravados.
CREATE OR REPLACE FUNCTION public.sst_aso_per_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_cpf  text := regexp_replace(COALESCE(p->>'cpf', ''), '\D', '', 'g');
  v_nome text := public.sst_afa_nome_usuario();
  b      record;
BEGIN
  PERFORM public.sst_aso_per_exige('alterar');
  IF p->>'resultado' IS NOT NULL AND p->>'resultado' NOT IN ('', 'apto', 'inapto') THEN
    RAISE EXCEPTION 'Resultado inválido: use apto ou inapto.';
  END IF;

  IF v_id IS NULL THEN
    SELECT * INTO b FROM public.sst_aso_per_base(v_cpf) LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador ativo não encontrado para este CPF.'; END IF;
    IF EXISTS (SELECT 1 FROM public."SST_ASO_PERIODICO" x WHERE x.cpf = v_cpf AND NOT x.realizado) THEN
      RAISE EXCEPTION '% já tem um ASO periódico em andamento.', b.nome;
    END IF;
    INSERT INTO public."SST_ASO_PERIODICO" (cpf, empregado_id, nome, filial_nome, contrato_nome, periodicidade_meses,
      vencimento_previsto, solicitado_em, agendado_para, clinica, realizado, realizado_em, resultado, observacao,
      created_by, created_por_nome, atualizado_por_nome)
    VALUES (b.cpf, b.empregado_id, b.nome, b.filial_nome, b.contrato_nome, b.periodicidade_meses, b.vencimento,
      nullif(p->>'solicitado_em', '')::date, nullif(p->>'agendado_para', '')::date, nullif(btrim(p->>'clinica'), ''),
      COALESCE((p->>'realizado')::boolean, false), nullif(p->>'realizado_em', '')::date, nullif(p->>'resultado', ''),
      nullif(btrim(p->>'observacao'), ''), auth.uid(), v_nome, v_nome)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE public."SST_ASO_PERIODICO" SET
    solicitado_em = nullif(p->>'solicitado_em', '')::date,
    agendado_para = nullif(p->>'agendado_para', '')::date,
    clinica = nullif(btrim(p->>'clinica'), ''),
    realizado = COALESCE((p->>'realizado')::boolean, false),
    realizado_em = nullif(p->>'realizado_em', '')::date,
    resultado = nullif(p->>'resultado', ''),
    observacao = nullif(btrim(p->>'observacao'), ''),
    atualizado_por_nome = v_nome
  WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASO periódico não encontrado.'; END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_salvar(jsonb) TO authenticated;

-- Devolve o caminho do ASO que foi substituído (a tela apaga do bucket).
CREATE OR REPLACE FUNCTION public.sst_aso_per_anexo_registrar(p_id bigint, p_nome text, p_path text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_antigo text;
BEGIN
  PERFORM public.sst_aso_per_exige('alterar');
  -- O caminho tem que estar na pasta deste ciclo.
  IF COALESCE(p_path, '') NOT LIKE p_id::text || '/%' THEN
    RAISE EXCEPTION 'Arquivo fora da pasta do ASO periódico #%.', p_id;
  END IF;
  SELECT aso_path INTO v_antigo FROM public."SST_ASO_PERIODICO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASO periódico não encontrado.'; END IF;
  UPDATE public."SST_ASO_PERIODICO"
     SET aso_path = p_path, aso_nome = nullif(btrim(p_nome), ''), atualizado_por_nome = public.sst_afa_nome_usuario()
   WHERE id = p_id;
  RETURN nullif(v_antigo, p_path);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_anexo_registrar(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_anexo_registrar(bigint, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_per_anexo_remover(p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_path text;
BEGIN
  PERFORM public.sst_aso_per_exige('alterar');
  SELECT aso_path INTO v_path FROM public."SST_ASO_PERIODICO" WHERE id = p_id FOR UPDATE;
  UPDATE public."SST_ASO_PERIODICO" SET aso_path = NULL, aso_nome = NULL, atualizado_por_nome = public.sst_afa_nome_usuario()
   WHERE id = p_id;
  RETURN v_path;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_anexo_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_anexo_remover(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.sst_aso_per_anexo_remover(bigint), public.sst_aso_per_anexo_registrar(bigint, text, text),
--   public.sst_aso_per_salvar(jsonb), public.sst_aso_per_lista(),
--   public.sst_aso_per_status(date, text, boolean, date, date, integer), public.sst_aso_per_base(text),
--   public.sst_aso_per_ultimos(), public.sst_aso_per_meses(text, text);
-- DROP POLICY IF EXISTS "sst aso periodico select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst aso periodico insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst aso periodico delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'sst-aso-periodico';   -- só vazio
-- DROP TABLE IF EXISTS public."SST_ASO_PERIODICO";
-- DROP FUNCTION IF EXISTS public.sst_aso_per_regras(), public.sst_aso_per_exige(text), public.sst_aso_per_pode(text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'sst_aso_periodico';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_aso_periodico';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_aso_periodico';
-- DELETE FROM public.app_menu      WHERE codigo      = 'sst_aso_periodico';
-- NOTIFY pgrst, 'reload schema';
