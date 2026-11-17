-- =========================================================================
-- SST › EXAMES TOXICOLÓGICOS — validade do exame de cada motorista
-- (13/11/2026, SIS-2026-0887)
--
-- CHAMADO (SST): "Eliminar o controle paralelo por planilha, reduzir a
-- necessidade de conferência manual semanal e permitir que o ERP sinalize
-- automaticamente os exames toxicológicos que precisam de atualização."
--
-- O QUE ESTA MIGRATION FAZ (aditiva)
--   1. Menu sst_exames_toxicologicos (visualizar + alterar), semeado nos
--      perfis concede_tudo e em quem já tem sst_controle_afastamentos: é a
--      mesma equipe do SST.
--   2. Quem precisa do exame: CNH informada decide (C, D ou E); sem ela, o
--      título do cargo ("MOTORISTA CAT B" não precisa).
--   3. SST_TOXICOLOGICO (uma linha por PESSOA), _HISTORICO e _DOC. Sem acesso
--      direto às tabelas (guardam CPF): tudo pelas RPCs.
--   4. Bucket privado sst-exames-toxicologicos para o laudo do exame (dado de
--      saúde, nunca link público).
--   5. A LISTA NÃO É UMA TABELA: sst_toxico_lista() junta, na hora, quem está
--      ativo com cargo de motorista/tratorista/operador e quem já tem registro.
--      Motorista admitido aparece sozinho (sem exame = "Aguardando
--      atualização"); desligado sai sozinho. Não há captura para dessincronizar.
--
-- A PESSOA É O CPF, não EMPREGADOS."ID": a carga da Senior já recriou linhas
-- e o ID mudou (mig 20261005000001). O CPF fica só aqui; a lista não o devolve.
--
-- A PLANILHA QUE O SST USAVA NÃO ENTRA AQUI: o repositório é público e ela
-- tem CPF. A carga é pelo botão "Importar planilha" (sst_toxico_importar),
-- que só preenche campo vazio e nunca rebaixa uma validade.
--
-- A situação (Em dia / Próximo do vencimento / Vencido / Aguardando
-- atualização) é calculada em src/lib/sst/exameToxicologico.ts, com teste.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_exames_toxicologicos', 'Exames Toxicológicos', '/app/sst/exames-toxicologicos',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_exames_toxicologicos');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_exames_toxicologicos', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- concede_tudo já via tudo: a linha só marca o menu como configurado, e sem
-- ela a tela nasceria aberta para todo autenticado (J2 de .github/REGRAS-PR.md).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sst_exames_toxicologicos', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sst_exames_toxicologicos', pp.acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'sst_controle_afastamentos'
   AND pp.acao IN ('visualizar', 'alterar') AND pp.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Em 13/11/2026 eram 5 pessoas do SST, todas com visualizar + alterar.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sst_exames_toxicologicos', s.acao, true,
       'Migração 20261117140000 (SIS-2026-0887): já cuidava do Controle de Afastamentos'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'sst_controle_afastamentos'
   AND s.acao IN ('visualizar', 'alterar') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sst_exames_toxicologicos' AND x.acao = s.acao);

CREATE OR REPLACE FUNCTION public.sst_toxico_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_exames_toxicologicos', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_toxico_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_toxico_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_toxico_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) aos Exames Toxicológicos', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_toxico_exige(text) FROM PUBLIC, anon, authenticated;

-- ── 2. Quem precisa do exame ─────────────────────────────────────────────
-- Cargos ativos medidos em 13/11/2026: MOTORISTA CAT B 30, CAT C 14, CAT D 40,
-- MOTORISTA DE CAMINHAO 8, MOTORISTA 8, TRATORISTA 13. "OPERADOR" sozinho não
-- serve: há OPERADOR DE RADIO CHAMADA, que não dirige.
CREATE OR REPLACE FUNCTION public.sst_toxico_cargo_motorista(_cargo text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(btrim(_cargo), '') ~* '^(MOTORISTA|TRATORISTA|OPERADOR DE (ESCAVADEIRA|RETRO|P[AÁ] CARREGADEIRA|MOTONIVELADORA))'
$$;

-- "MOTORISTA CAT D" → D. Sem "CAT" no título, NULL.
CREATE OR REPLACE FUNCTION public.sst_toxico_cnh_do_cargo(_cargo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT upper((regexp_match(COALESCE(_cargo, ''), 'CAT\.?\s*([A-E]{1,2})\M', 'i'))[1])
$$;

CREATE OR REPLACE FUNCTION public.sst_toxico_norm_cnh(_cnh text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN x IN ('A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE') THEN x END
    FROM (SELECT upper(regexp_replace(COALESCE(_cnh, ''), '[^A-Za-z]', '', 'g')) AS x) s
$$;

-- A CNH informada decide; sem ela, o cargo. Cargo sem categoria (TRATORISTA,
-- MOTORISTA DE CAMINHAO) precisa até o SST dizer que a CNH é A/B.
CREATE OR REPLACE FUNCTION public.sst_toxico_precisa_exame(_cnh text, _cargo text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN public.sst_toxico_norm_cnh(_cnh) IS NOT NULL THEN public.sst_toxico_norm_cnh(_cnh) ~ '[CDE]'
              ELSE COALESCE(public.sst_toxico_cnh_do_cargo(_cargo) ~ '[CDE]', true) END
$$;

-- ── 3. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_TOXICOLOGICO" (
  id                 bigserial PRIMARY KEY,
  cpf                text NOT NULL UNIQUE CHECK (cpf ~ '^[0-9]{11}$'),   -- só dígitos
  nome               text NOT NULL,                                       -- cópia, para quem saiu do EMPREGADOS
  categoria_cnh      text CHECK (categoria_cnh IS NULL OR categoria_cnh IN ('A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE')),
  -- Onde a pessoa trabalha dentro do contrato ("CAMPUS DO VALE AGRONOMIA/ FROTA").
  -- O contrato não fica aqui: vem do EMPREGADOS na hora.
  local_trabalho     text,
  -- Quem o SST cobra. Vazio: a tela sugere o superior do Organograma.
  responsavel        text,
  data_ultimo_exame  date,
  data_validade      date,
  clinica            text,
  observacao         text,
  -- Repetidos aqui para a lista; o histórico é _HISTORICO.
  ultima_cobranca_em date,
  ultimo_contato_em  date,
  ultimo_contato_obs text,
  origem             text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha')),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_toxico_datas_ck CHECK (data_ultimo_exame IS NULL OR data_validade IS NULL OR data_validade >= data_ultimo_exame)
);

CREATE TABLE IF NOT EXISTS public."SST_TOXICOLOGICO_HISTORICO" (
  id              bigserial PRIMARY KEY,
  toxicologico_id bigint NOT NULL REFERENCES public."SST_TOXICOLOGICO"(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('exame', 'cobranca', 'contato', 'alteracao', 'importacao', 'documento')),
  data_evento     date,
  data_exame      date,
  data_validade   date,
  clinica         text,
  descricao       text,
  autor_nome      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_toxico_hist_fk_idx ON public."SST_TOXICOLOGICO_HISTORICO" (toxicologico_id);

CREATE TABLE IF NOT EXISTS public."SST_TOXICOLOGICO_DOC" (
  id              bigserial PRIMARY KEY,
  toxicologico_id bigint NOT NULL REFERENCES public."SST_TOXICOLOGICO"(id) ON DELETE CASCADE,
  nome            text NOT NULL,
  storage_path    text NOT NULL,
  tamanho         bigint,
  tipo            text,
  enviado_por     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_toxico_doc_fk_idx ON public."SST_TOXICOLOGICO_DOC" (toxicologico_id);

-- RLS ligada e nenhuma policy: a tela lê e grava só pelas RPCs abaixo, que
-- nunca devolvem o CPF.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SST_TOXICOLOGICO', 'SST_TOXICOLOGICO_HISTORICO', 'SST_TOXICOLOGICO_DOC'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_sst_toxico_updated_at ON public."SST_TOXICOLOGICO";
CREATE TRIGGER trg_sst_toxico_updated_at
  BEFORE UPDATE ON public."SST_TOXICOLOGICO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. Laudo do exame: bucket privado ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-exames-toxicologicos', 'sst-exames-toxicologicos', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sst toxico select" ON storage.objects;
CREATE POLICY "sst toxico select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-exames-toxicologicos' AND (select public.sst_toxico_pode('visualizar')));
DROP POLICY IF EXISTS "sst toxico insert" ON storage.objects;
CREATE POLICY "sst toxico insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-exames-toxicologicos' AND (select public.sst_toxico_pode('alterar')));
DROP POLICY IF EXISTS "sst toxico delete" ON storage.objects;
CREATE POLICY "sst toxico delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sst-exames-toxicologicos' AND (select public.sst_toxico_pode('alterar')));

-- ── 5. Funções internas ──────────────────────────────────────────────────
-- Uma linha por CPF: a viva antes da desligada; entre iguais, a mais nova.
-- Em 13/11/2026, 10 CPFs da planilha tinham mais de uma linha no EMPREGADOS.
CREATE OR REPLACE FUNCTION public.sst_toxico_pessoas()
RETURNS TABLE (cpf text, empregado_id bigint, nome text, cargo text, situacao text, filial text, local_senior text, desligado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (x.cpf) x.cpf, x.empregado_id, x.nome, x.cargo, x.situacao, x.filial, x.local_senior, x.desligado
    FROM (SELECT regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g') AS cpf,
                 e."ID"::bigint AS empregado_id,
                 btrim(e."Nome"::text) AS nome,
                 nullif(btrim(e."Título do Cargo"::text), '') AS cargo,
                 e."Situação"::text AS situacao,
                 e."Nome Filial"::text AS filial,
                 e."Descrição do Local"::text AS local_senior,
                 COALESCE(public.sst_afa_tipo_da_situacao(e."Situação"::text) = 'desligamento', false) AS desligado
            FROM public."EMPREGADOS" e) x
   WHERE length(x.cpf) = 11
   ORDER BY x.cpf, x.desligado, x.empregado_id DESC
$$;
REVOKE ALL ON FUNCTION public.sst_toxico_pessoas() FROM PUBLIC, anon, authenticated;

-- O contrato pelo mesmo caminho de sst_afa_lotacao_calc (mig 20261029001750):
-- depara da filial (exato) → nome da filial → depara normalizado → local. Sem
-- a parte do posto, que é a cara e aqui não serve. Em 13/11/2026 acertou o
-- contrato de todas as pessoas da planilha do SST.
CREATE OR REPLACE FUNCTION public.sst_toxico_contrato(_filial text, _local text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ct uuid;
BEGIN
  SELECT d.contrato_id INTO v_ct FROM public.sup_empregado_contrato_depara d
   WHERE d.filial_nome = _filial ORDER BY d.contrato_id LIMIT 1;
  IF v_ct IS NULL THEN
    SELECT c.id INTO v_ct FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(_filial)
     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1;
  END IF;
  IF v_ct IS NULL THEN
    SELECT d.contrato_id INTO v_ct FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) = public.rh_norm_contrato(_filial)
     ORDER BY d.contrato_id LIMIT 1;
  END IF;
  IF v_ct IS NULL THEN
    SELECT c.id INTO v_ct FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(_local)
     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('contrato_id', v_ct, 'contrato_nome', (SELECT c.nome FROM public.contratos c WHERE c.id = v_ct));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_contrato(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sst_toxico_hist(p_id bigint, p_tipo text, p_desc text, p_data date DEFAULT NULL,
                                                  p_exame date DEFAULT NULL, p_validade date DEFAULT NULL, p_clinica text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."SST_TOXICOLOGICO_HISTORICO" (toxicologico_id, tipo, descricao, data_evento, data_exame, data_validade, clinica, autor_nome)
  VALUES (p_id, p_tipo, p_desc, p_data, p_exame, p_validade, p_clinica, public.sst_afa_nome_usuario())
$$;
REVOKE ALL ON FUNCTION public.sst_toxico_hist(bigint, text, text, date, date, date, text) FROM PUBLIC, anon, authenticated;

-- O registro em que a escrita cai: p.id, ou o do CPF de p.empregado_id — que
-- nasce aqui se a pessoa ainda não tinha (motorista em "Aguardando atualização").
CREATE OR REPLACE FUNCTION public.sst_toxico_alvo(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_cpf  text;
  v_nome text;
BEGIN
  IF v_id IS NOT NULL THEN
    PERFORM 1 FROM public."SST_TOXICOLOGICO" WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro do exame não encontrado.'; END IF;
    RETURN v_id;
  END IF;
  SELECT regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g'), btrim(e."Nome"::text) INTO v_cpf, v_nome
    FROM public."EMPREGADOS" e WHERE e."ID" = nullif(p->>'empregado_id', '')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o colaborador na lista.'; END IF;
  IF length(v_cpf) <> 11 THEN
    RAISE EXCEPTION '% está sem CPF no cadastro da Senior: não dá para registrar o exame.', v_nome;
  END IF;
  INSERT INTO public."SST_TOXICOLOGICO" (cpf, nome, origem, created_by)
  VALUES (v_cpf, v_nome, 'manual', auth.uid())
  ON CONFLICT (cpf) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT t.id INTO v_id FROM public."SST_TOXICOLOGICO" t WHERE t.cpf = v_cpf FOR UPDATE;
  ELSE
    PERFORM public.sst_toxico_hist(v_id, 'alteracao', 'Colaborador incluído no controle.');
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_alvo(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 6. RPCs da tela ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_toxico_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_toxico_exige('visualizar');
  RETURN COALESCE((
    WITH p AS (SELECT * FROM public.sst_toxico_pessoas()),
    universo AS (
      SELECT p.cpf FROM p WHERE public.sst_toxico_cargo_motorista(p.cargo) AND NOT p.desligado
      UNION
      SELECT t.cpf FROM public."SST_TOXICOLOGICO" t
    ),
    -- Uma conta de contrato por filial/local, não por pessoa.
    ct AS (
      SELECT f.filial, f.local_senior, public.sst_toxico_contrato(f.filial, f.local_senior) AS c
        FROM (SELECT DISTINCT p.filial, p.local_senior FROM universo u JOIN p ON p.cpf = u.cpf) f
    )
    SELECT jsonb_agg(jsonb_build_object(
        'toxicologico_id', t.id, 'empregado_id', p.empregado_id,
        'nome', COALESCE(p.nome, t.nome), 'cargo', p.cargo, 'situacao_senior', p.situacao,
        'desligado', COALESCE(p.desligado, true),
        'contrato_id', ct.c->>'contrato_id', 'contrato_nome', COALESCE(ct.c->>'contrato_nome', p.filial),
        'local_trabalho', t.local_trabalho, 'categoria_cnh', t.categoria_cnh,
        'cnh_do_cargo', public.sst_toxico_cnh_do_cargo(p.cargo),
        'precisa_exame', public.sst_toxico_precisa_exame(t.categoria_cnh, p.cargo),
        'responsavel', t.responsavel, 'superior_organograma', sup.nome,
        'data_ultimo_exame', t.data_ultimo_exame, 'data_validade', t.data_validade,
        'clinica', t.clinica, 'observacao', t.observacao,
        'ultima_cobranca_em', t.ultima_cobranca_em, 'ultimo_contato_em', t.ultimo_contato_em,
        'ultimo_contato_obs', t.ultimo_contato_obs, 'documentos', COALESCE(d.n, 0))
      ORDER BY COALESCE(p.nome, t.nome))
      FROM universo u
      LEFT JOIN p ON p.cpf = u.cpf
      LEFT JOIN public."SST_TOXICOLOGICO" t ON t.cpf = u.cpf
      LEFT JOIN ct ON p.cpf IS NOT NULL
                  AND ct.filial IS NOT DISTINCT FROM p.filial AND ct.local_senior IS NOT DISTINCT FROM p.local_senior
      LEFT JOIN LATERAL (SELECT public.organograma_nome_no(o.parent_id) AS nome
                           FROM public."ORGANOGRAMA_NO" o
                          WHERE o.empregado_id = p.empregado_id AND o.parent_id IS NOT NULL
                          LIMIT 1) sup ON true
      LEFT JOIN (SELECT x.toxicologico_id, count(*) AS n FROM public."SST_TOXICOLOGICO_DOC" x GROUP BY 1) d
             ON d.toxicologico_id = t.id
  ), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_toxico_ficha(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_toxico_exige('visualizar');
  RETURN jsonb_build_object(
    'historico', COALESCE((SELECT jsonb_agg(to_jsonb(h) - 'toxicologico_id' ORDER BY h.created_at DESC, h.id DESC)
                             FROM public."SST_TOXICOLOGICO_HISTORICO" h WHERE h.toxicologico_id = p_id), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id DESC)
                              FROM public."SST_TOXICOLOGICO_DOC" d WHERE d.toxicologico_id = p_id), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_ficha(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_ficha(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_toxico_colaboradores(p_busca text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  t   text := btrim(COALESCE(p_busca, ''));
  dig text := regexp_replace(COALESCE(p_busca, ''), '\D', '', 'g');
BEGIN
  PERFORM public.sst_toxico_exige('visualizar');
  IF length(t) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object('id', p.empregado_id, 'nome', p.nome, 'situacao', p.situacao, 'filial', p.filial, 'cargo', p.cargo,
               -- Já aparece na lista: a tela abre a ficha em vez de incluir de novo.
               'no_controle', public.sst_toxico_cargo_motorista(p.cargo)
                              OR EXISTS (SELECT 1 FROM public."SST_TOXICOLOGICO" r WHERE r.cpf = p.cpf)) AS x
        FROM public.sst_toxico_pessoas() p
       WHERE NOT p.desligado
         AND (p.nome ILIKE '%' || t || '%' OR (length(dig) = 11 AND p.cpf = dig))
       ORDER BY p.nome
       LIMIT 20) s), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_colaboradores(text) TO authenticated;

-- Cria ou altera os dados da pessoa. Grava só as chaves que vierem em p:
-- "Incluir colaborador" manda CNH/local/responsável e não apaga datas.
CREATE OR REPLACE FUNCTION public.sst_toxico_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id    bigint;
  a       public."SST_TOXICOLOGICO"%ROWTYPE;
  n       public."SST_TOXICOLOGICO"%ROWTYPE;
  v_cnh   text := public.sst_toxico_norm_cnh(p->>'categoria_cnh');
  v_exame date := nullif(p->>'data_ultimo_exame', '')::date;
  v_val   date := nullif(p->>'data_validade', '')::date;
  v_mud   text[] := '{}';
  fmt     CONSTANT text := 'DD/MM/YYYY';
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  IF p ? 'categoria_cnh' AND v_cnh IS NULL AND length(btrim(COALESCE(p->>'categoria_cnh', ''))) > 0 THEN
    RAISE EXCEPTION 'Categoria de CNH inválida: %.', p->>'categoria_cnh';
  END IF;
  IF v_exame > current_date THEN RAISE EXCEPTION 'A data do último exame não pode ser futura.'; END IF;

  v_id := public.sst_toxico_alvo(p);
  SELECT * INTO a FROM public."SST_TOXICOLOGICO" WHERE id = v_id;
  -- Confere antes do UPDATE: a CHECK da tabela daria um erro ilegível.
  IF NOT p ? 'data_ultimo_exame' THEN v_exame := a.data_ultimo_exame; END IF;
  IF NOT p ? 'data_validade' THEN v_val := a.data_validade; END IF;
  IF v_val < v_exame THEN RAISE EXCEPTION 'A validade não pode ser anterior à data do exame.'; END IF;

  UPDATE public."SST_TOXICOLOGICO" SET
    categoria_cnh     = CASE WHEN p ? 'categoria_cnh' THEN v_cnh ELSE categoria_cnh END,
    local_trabalho    = CASE WHEN p ? 'local_trabalho' THEN nullif(btrim(p->>'local_trabalho'), '') ELSE local_trabalho END,
    responsavel       = CASE WHEN p ? 'responsavel' THEN nullif(btrim(p->>'responsavel'), '') ELSE responsavel END,
    clinica           = CASE WHEN p ? 'clinica' THEN nullif(btrim(p->>'clinica'), '') ELSE clinica END,
    observacao        = CASE WHEN p ? 'observacao' THEN nullif(btrim(p->>'observacao'), '') ELSE observacao END,
    data_ultimo_exame = v_exame,
    data_validade     = v_val
  WHERE id = v_id
  RETURNING * INTO n;

  IF n.categoria_cnh IS DISTINCT FROM a.categoria_cnh THEN
    v_mud := v_mud || ('CNH: ' || COALESCE(a.categoria_cnh, '—') || ' → ' || COALESCE(n.categoria_cnh, '—')); END IF;
  IF n.local_trabalho IS DISTINCT FROM a.local_trabalho THEN
    v_mud := v_mud || ('Local: ' || COALESCE(n.local_trabalho, '—')); END IF;
  IF n.responsavel IS DISTINCT FROM a.responsavel THEN
    v_mud := v_mud || ('Responsável: ' || COALESCE(a.responsavel, '—') || ' → ' || COALESCE(n.responsavel, '—')); END IF;
  IF n.clinica IS DISTINCT FROM a.clinica THEN
    v_mud := v_mud || ('Clínica: ' || COALESCE(n.clinica, '—')); END IF;
  IF n.observacao IS DISTINCT FROM a.observacao THEN
    v_mud := v_mud || 'Observação alterada'::text; END IF;
  IF n.data_ultimo_exame IS DISTINCT FROM a.data_ultimo_exame THEN
    v_mud := v_mud || ('Último exame: ' || COALESCE(to_char(a.data_ultimo_exame, fmt), '—') || ' → ' || COALESCE(to_char(n.data_ultimo_exame, fmt), '—')); END IF;
  IF n.data_validade IS DISTINCT FROM a.data_validade THEN
    v_mud := v_mud || ('Validade: ' || COALESCE(to_char(a.data_validade, fmt), '—') || ' → ' || COALESCE(to_char(n.data_validade, fmt), '—')); END IF;
  IF cardinality(v_mud) > 0 THEN
    PERFORM public.sst_toxico_hist(v_id, 'alteracao', array_to_string(v_mud, '; ') || '.');
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_salvar(jsonb) TO authenticated;

-- O exame novo que o encarregado mandou. Lançar um exame mais antigo depois
-- fica no histórico, mas não rebaixa a validade atual.
CREATE OR REPLACE FUNCTION public.sst_toxico_registrar_exame(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id    bigint;
  v_exame date := nullif(p->>'data_exame', '')::date;
  v_val   date := nullif(p->>'data_validade', '')::date;
  v_cli   text := nullif(btrim(p->>'clinica'), '');
  v_atual date;
  fmt     CONSTANT text := 'DD/MM/YYYY';
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  IF v_exame IS NULL THEN RAISE EXCEPTION 'Informe a data do exame.'; END IF;
  IF v_val IS NULL THEN RAISE EXCEPTION 'Informe a data de validade do exame.'; END IF;
  IF v_exame > current_date THEN RAISE EXCEPTION 'A data do exame não pode ser futura.'; END IF;
  IF v_val < v_exame THEN RAISE EXCEPTION 'A validade não pode ser anterior à data do exame.'; END IF;

  v_id := public.sst_toxico_alvo(p);
  SELECT data_validade INTO v_atual FROM public."SST_TOXICOLOGICO" WHERE id = v_id;
  IF v_atual IS NULL OR v_val >= v_atual THEN
    UPDATE public."SST_TOXICOLOGICO" SET data_ultimo_exame = v_exame, data_validade = v_val, clinica = COALESCE(v_cli, clinica)
     WHERE id = v_id;
  END IF;
  PERFORM public.sst_toxico_hist(v_id, 'exame',
    'Exame de ' || to_char(v_exame, fmt) || ', válido até ' || to_char(v_val, fmt) || COALESCE(' (' || v_cli || ')', '')
      || CASE WHEN v_atual > v_val THEN '. Mais antigo que o atual: a validade continua ' || to_char(v_atual, fmt) ELSE '' END || '.',
    v_exame, v_exame, v_val, v_cli);
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_registrar_exame(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_registrar_exame(jsonb) TO authenticated;

-- Cobrança ao encarregado e/ou contato. A lista mostra o mais recente, mesmo
-- lançando um antigo depois.
CREATE OR REPLACE FUNCTION public.sst_toxico_registrar_acompanhamento(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id  bigint;
  v_cob date := nullif(p->>'data_cobranca', '')::date;
  v_con date := nullif(p->>'data_contato', '')::date;
  v_obs text := nullif(btrim(p->>'observacao'), '');
  fmt   CONSTANT text := 'DD/MM/YYYY';
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  IF v_cob IS NULL AND v_con IS NULL THEN RAISE EXCEPTION 'Informe a data da cobrança ou a do contato.'; END IF;
  IF GREATEST(v_cob, v_con) > current_date THEN RAISE EXCEPTION 'A data não pode ser futura.'; END IF;

  v_id := public.sst_toxico_alvo(p);
  -- Todas as expressões leem a linha de antes do UPDATE.
  UPDATE public."SST_TOXICOLOGICO" SET
    ultima_cobranca_em = GREATEST(ultima_cobranca_em, v_cob),
    ultimo_contato_obs = CASE WHEN v_con IS NOT NULL AND (ultimo_contato_em IS NULL OR v_con >= ultimo_contato_em)
                              THEN v_obs ELSE ultimo_contato_obs END,
    ultimo_contato_em  = GREATEST(ultimo_contato_em, v_con)
  WHERE id = v_id;

  IF v_cob IS NOT NULL THEN
    PERFORM public.sst_toxico_hist(v_id, 'cobranca', 'Cobrança ao encarregado em ' || to_char(v_cob, fmt) || COALESCE(': ' || v_obs, '.'), v_cob);
  END IF;
  IF v_con IS NOT NULL THEN
    PERFORM public.sst_toxico_hist(v_id, 'contato', 'Contato em ' || to_char(v_con, fmt) || COALESCE(': ' || v_obs, '.'), v_con);
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_registrar_acompanhamento(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_registrar_acompanhamento(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_toxico_doc_registrar(p_id bigint, p_nome text, p_path text, p_tamanho bigint, p_tipo text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_doc bigint;
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  -- O caminho tem que estar na pasta deste registro.
  IF COALESCE(p_path, '') NOT LIKE p_id::text || '/%' THEN
    RAISE EXCEPTION 'Arquivo fora da pasta do registro #%.', p_id;
  END IF;
  PERFORM 1 FROM public."SST_TOXICOLOGICO" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro do exame não encontrado.'; END IF;
  INSERT INTO public."SST_TOXICOLOGICO_DOC" (toxicologico_id, nome, storage_path, tamanho, tipo, enviado_por)
  VALUES (p_id, p_nome, p_path, p_tamanho, p_tipo, public.sst_afa_nome_usuario())
  RETURNING id INTO v_doc;
  PERFORM public.sst_toxico_hist(p_id, 'documento', 'Laudo anexado: ' || p_nome || '.');
  RETURN v_doc;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_doc_registrar(bigint, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_doc_registrar(bigint, text, text, bigint, text) TO authenticated;

-- Devolve o caminho: a tela apaga o arquivo do bucket depois que o registro saiu.
CREATE OR REPLACE FUNCTION public.sst_toxico_doc_remover(p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE d public."SST_TOXICOLOGICO_DOC"%ROWTYPE;
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  DELETE FROM public."SST_TOXICOLOGICO_DOC" WHERE id = p_id RETURNING * INTO d;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.sst_toxico_hist(d.toxicologico_id, 'documento', 'Laudo removido: ' || d.nome || '.');
  RETURN d.storage_path;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_doc_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_doc_remover(bigint) TO authenticated;

-- A planilha que o SST usava, lida no navegador (lerPlanilhaToxicologico).
-- Casa pelo CPF; quem já existe só ganha o que estiver VAZIO, e a validade só
-- troca se a da planilha for maior — reimportar não desfaz o que o SST digitou.
-- Uma linha com problema não derruba as outras: volta em "erros".
CREATE OR REPLACE FUNCTION public.sst_toxico_importar(p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r      record;
  a      public."SST_TOXICOLOGICO"%ROWTYPE;
  n      public."SST_TOXICOLOGICO"%ROWTYPE;
  v_id   bigint;
  v_cri  int := 0;
  v_atu  int := 0;
  v_igual int := 0;
  v_nao  jsonb := '[]'::jsonb;
  v_err  jsonb := '[]'::jsonb;
  v_cnh  text;
  v_ult  date;
  v_val  date;
  v_cob  date;
  v_onde text;
BEGIN
  PERFORM public.sst_toxico_exige('alterar');
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar.';
  END IF;

  FOR r IN
    SELECT l.x, p.cpf, p.nome
      FROM jsonb_array_elements(p_linhas) AS l(x)
      LEFT JOIN public.sst_toxico_pessoas() p ON p.cpf = regexp_replace(COALESCE(l.x->>'cpf', ''), '\D', '', 'g')
  LOOP
    v_onde := 'aba ' || COALESCE(r.x->>'aba', '?') || ', linha ' || COALESCE(r.x->>'linha', '?');
    IF r.cpf IS NULL THEN
      v_nao := v_nao || jsonb_build_object('aba', r.x->>'aba', 'linha', r.x->>'linha', 'nome', r.x->>'nome');
      CONTINUE;
    END IF;
    BEGIN
      v_id  := NULL;
      v_cnh := public.sst_toxico_norm_cnh(r.x->>'categoria_cnh');
      v_ult := nullif(r.x->>'data_ultimo_exame', '')::date;
      v_val := nullif(r.x->>'data_validade', '')::date;
      v_cob := nullif(r.x->>'ultima_cobranca_em', '')::date;
      IF v_ult > current_date OR v_ult > v_val THEN v_ult := NULL; END IF;
      IF v_cob > current_date THEN v_cob := NULL; END IF;

      INSERT INTO public."SST_TOXICOLOGICO" (cpf, nome, categoria_cnh, local_trabalho, responsavel, data_ultimo_exame,
        data_validade, clinica, observacao, ultima_cobranca_em, origem, created_by)
      VALUES (r.cpf, r.nome, v_cnh, nullif(btrim(r.x->>'local_trabalho'), ''), nullif(btrim(r.x->>'responsavel'), ''), v_ult,
        v_val, nullif(btrim(r.x->>'clinica'), ''), nullif(btrim(r.x->>'observacao'), ''), v_cob, 'planilha', auth.uid())
      ON CONFLICT (cpf) DO NOTHING
      RETURNING id INTO v_id;

      IF v_id IS NOT NULL THEN
        v_cri := v_cri + 1;
        PERFORM public.sst_toxico_hist(v_id, 'importacao', 'Importado da planilha (' || v_onde || ').');
        IF v_cob IS NOT NULL THEN
          PERFORM public.sst_toxico_hist(v_id, 'cobranca', 'Cobrança anotada na planilha em ' || to_char(v_cob, 'DD/MM/YYYY') || '.', v_cob);
        END IF;
      ELSE
        SELECT * INTO a FROM public."SST_TOXICOLOGICO" WHERE cpf = r.cpf FOR UPDATE;
        UPDATE public."SST_TOXICOLOGICO" SET
          categoria_cnh      = COALESCE(categoria_cnh, v_cnh),
          local_trabalho     = COALESCE(local_trabalho, nullif(btrim(r.x->>'local_trabalho'), '')),
          responsavel        = COALESCE(responsavel, nullif(btrim(r.x->>'responsavel'), '')),
          clinica            = COALESCE(clinica, nullif(btrim(r.x->>'clinica'), '')),
          observacao         = COALESCE(observacao, nullif(btrim(r.x->>'observacao'), '')),
          data_ultimo_exame  = CASE WHEN v_val IS NOT NULL AND (data_validade IS NULL OR v_val > data_validade) THEN v_ult ELSE data_ultimo_exame END,
          data_validade      = CASE WHEN v_val IS NOT NULL AND (data_validade IS NULL OR v_val > data_validade) THEN v_val ELSE data_validade END,
          ultima_cobranca_em = GREATEST(ultima_cobranca_em, v_cob)
        WHERE id = a.id
        RETURNING * INTO n;
        IF (to_jsonb(n) - 'updated_at') = (to_jsonb(a) - 'updated_at') THEN
          v_igual := v_igual + 1;
        ELSE
          v_atu := v_atu + 1;
          PERFORM public.sst_toxico_hist(a.id, 'importacao', 'Completado pela planilha (' || v_onde || ').');
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := v_err || jsonb_build_object('aba', r.x->>'aba', 'linha', r.x->>'linha', 'nome', r.x->>'nome', 'erro', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('criados', v_cri, 'atualizados', v_atu, 'sem_mudanca', v_igual,
                            'nao_encontrados', v_nao, 'erros', v_err);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_toxico_importar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_toxico_importar(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.sst_toxico_importar(jsonb), public.sst_toxico_doc_remover(bigint),
--   public.sst_toxico_doc_registrar(bigint, text, text, bigint, text),
--   public.sst_toxico_registrar_acompanhamento(jsonb), public.sst_toxico_registrar_exame(jsonb),
--   public.sst_toxico_salvar(jsonb), public.sst_toxico_colaboradores(text), public.sst_toxico_ficha(bigint),
--   public.sst_toxico_lista(), public.sst_toxico_alvo(jsonb),
--   public.sst_toxico_hist(bigint, text, text, date, date, date, text),
--   public.sst_toxico_contrato(text, text), public.sst_toxico_pessoas();
-- DROP POLICY IF EXISTS "sst toxico select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst toxico insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst toxico delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'sst-exames-toxicologicos';   -- só vazio
-- DROP TABLE IF EXISTS public."SST_TOXICOLOGICO_DOC", public."SST_TOXICOLOGICO_HISTORICO", public."SST_TOXICOLOGICO";
-- DROP FUNCTION IF EXISTS public.sst_toxico_precisa_exame(text, text), public.sst_toxico_norm_cnh(text),
--   public.sst_toxico_cnh_do_cargo(text), public.sst_toxico_cargo_motorista(text),
--   public.sst_toxico_exige(text), public.sst_toxico_pode(text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'sst_exames_toxicologicos';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_exames_toxicologicos';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_exames_toxicologicos';
-- DELETE FROM public.app_menu      WHERE codigo      = 'sst_exames_toxicologicos';
-- NOTIFY pgrst, 'reload schema';
