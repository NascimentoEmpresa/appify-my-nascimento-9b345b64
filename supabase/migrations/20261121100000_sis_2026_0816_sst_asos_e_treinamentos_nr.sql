-- =========================================================================
-- SIS-2026-0816 — SST: o que só existia em planilha passa a ter tela no ERP
-- (parte 1 de 2; a parte 2, 20261121110000, é o painel da TV do SST)
--
-- CHAMADO: "painel gerencial automático na TV do setor de SST [...] reduzir a
-- atualização manual". Para a TV mostrar dado real, o que hoje o SST mantém
-- em planilha precisa morar no banco. Antes de criar, o que JÁ existe e é
-- reaproveitado (nada disso muda aqui):
--   · Acidentes de Trabalho — SST_ACIDENTE, com importação da "PLANILHA DE
--     ACIDENTES.xlsx" (SIS-2026-0889, mig 20261117220000);
--   · Afastamentos e Telemedicina (atestados) — SST_AFASTAMENTO, com
--     importação da planilha de telemedicina (mig 20261029001750);
--   · Controle de Afastamentos (INSS, licença-maternidade, retorno previsto)
--     — SST_CTRL_AFASTAMENTO (mig 20261105030000);
--   · treinamentos online liberados por contrato/cargo — TRN_CURSO_LIBERACAO
--     × TRN_CERTIFICADO (plataforma de Treinamentos).
--
-- O QUE FALTAVA E NASCE AQUI
--   1. SST › ASOs Realizados (menu sst_asos_realizados): o histórico dos
--      ASOs feitos fora dos fluxos do ERP — a planilha "EXAMES CLINICOS
--      PROTEGE NOVO.xlsm" (abas ADMISSIONAL, DEMISSIONAL, PERIÓDICO, TROCA DE
--      FUNÇÃO - RISCO e RETORNO; ~9.500 linhas de 2023 a 2026) — com cadastro
--      manual e importação pela tela, com simulação antes de gravar.
--   2. O ASO Periódico passa a contar o vencimento TAMBÉM desses ASOs
--      (sst_aso_per_ultimos ganha a fonte nova). Pedido do Pablo: o card
--      mostrava 778 vencidos porque, sem ASO no ERP, o vencimento saía da
--      admissão ("Estimado pela admissão") — e a maioria já tinha feito o
--      periódico, registrado só na planilha.
--   3. SST › Treinamentos Obrigatórios (NR) (menu sst_treinamentos_nr):
--        · a matriz contrato × função × treinamento obrigatório com
--          periodicidade e data do último ("Plano_Treinamentos_Empresas",
--          abas HAGG/SN/NH/CANAA) — SST_TRN_OBRIGATORIO;
--        · as turmas presenciais ("CRONOGRAMA DE TREINAMENTOS 2026") —
--          SST_TRN_TURMA. Registrar uma turma realizada pode atualizar a
--          data do último treinamento das linhas da matriz que ela cobre.
--      O status (em dia / próximo / vencido / pendente) é calculado na hora,
--      nada gravado: a mesma régua em src/lib/sst/treinamentosNr.ts, com teste.
--   4. sst_trn_online_resumo(): obrigatório × feito dos cursos ONLINE
--      liberados por contrato/cargo (mesma regra de público da plataforma,
--      mig 20260930000231/235: aluno não demitido e não bloqueado).
--
-- A PESSOA É O CPF (como em SST_ACIDENTE): EMPREGADOS."ID" muda quando a
-- carga da Senior recria as linhas. A planilha não tem CPF nem matrícula —
-- casa pelo NOME normalizado; homônimo desempata pela EMPRESA da planilha
-- (HAGG = Senior 1, SN = 2, CANAÃ = 3, NH = 5); sem casar, a linha entra
-- "sem vínculo" e não mexe em vencimento até o SST escolher a pessoa.
--
-- Tabelas sem acesso direto (CPF e dado de saúde): tudo por RPC.
-- Sem FK nova: contrato_id é referência solta (LEFT JOIN), como em
-- SST_AFASTAMENTO e SST_ACIDENTE — contrato apagado não derruba o histórico.
--
-- Telas novas nascem PENDENTES (SIS-2026-0931): liberar em Módulos & Menus ›
-- Novos Módulos. O seed abaixo é "acesso preparado".
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

SET lock_timeout = '5s';

-- ── 1. Menus e acesso ────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, v.rota, COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + v.n, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES ('sst_asos_realizados', 'ASOs Realizados (histórico)', '/app/sst/asos-realizados', 1),
                    ('sst_treinamentos_nr', 'Treinamentos Obrigatórios (NR)', '/app/sst/treinamentos-nr', 2)) AS v(codigo, nome, rota, n)
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = v.codigo);

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT c, a FROM unnest(ARRAY['sst_asos_realizados', 'sst_treinamentos_nr']) AS c
 CROSS JOIN (VALUES ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS x(a)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- concede_tudo: a linha só marca o menu como configurado (J2 de REGRAS-PR).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, c, a, true
  FROM public.perfil_acesso pa
 CROSS JOIN unnest(ARRAY['sst_asos_realizados', 'sst_treinamentos_nr']) AS c
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS x(a)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Acesso preparado: quem cuida do ASO Periódico (é o SST) — visualizar e
-- alterar como lá; quem altera também exclui (J1.A, como nos Acidentes).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, c, a.acao, true
  FROM public.perfil_acesso_permissao pp
 CROSS JOIN unnest(ARRAY['sst_asos_realizados', 'sst_treinamentos_nr']) AS c
 CROSS JOIN LATERAL (VALUES (pp.acao), (CASE WHEN pp.acao = 'alterar' THEN 'excluir'::public.app_acao END)) AS a(acao)
 WHERE pp.menu_codigo = 'sst_aso_periodico' AND pp.acao IN ('visualizar', 'alterar') AND pp.allow AND a.acao IS NOT NULL
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, c, a.acao, true, 'Migração 20261121100000 (SIS-2026-0816): já cuidava do ASO Periódico'
  FROM public.screen_permission_user s
 CROSS JOIN unnest(ARRAY['sst_asos_realizados', 'sst_treinamentos_nr']) AS c
 CROSS JOIN LATERAL (VALUES (s.acao), (CASE WHEN s.acao = 'alterar' THEN 'excluir'::public.app_acao END)) AS a(acao)
 WHERE s.menu_codigo = 'sst_aso_periodico' AND s.acao IN ('visualizar', 'alterar') AND s.allow AND a.acao IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = c AND x.acao = a.acao);

CREATE OR REPLACE FUNCTION public.sst_bases_exige(_menu text, _acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF _menu NOT IN ('sst_asos_realizados', 'sst_treinamentos_nr')
     OR NOT public.can_access(auth.uid(), _menu, _acao::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) a %', _acao,
      CASE _menu WHEN 'sst_asos_realizados' THEN 'ASOs Realizados' ELSE 'Treinamentos Obrigatórios (NR)' END
      USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_bases_exige(text, text) FROM PUBLIC, anon, authenticated;

-- Sigla da planilha → código de empresa da Senior (EMPREGADOS."Empresa").
CREATE OR REPLACE FUNCTION public.sst_bases_empresa_codigo(_sigla text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE public.sup_norm_nome(COALESCE(_sigla, ''))
    WHEN 'HAGG' THEN '1' WHEN 'NASCIMENTO' THEN '1' WHEN 'SN' THEN '2'
    WHEN 'CANAA' THEN '3' WHEN 'NH' THEN '5' END
$$;

-- O contrato escrito na planilha → contratos.id (nome normalizado, depois a
-- filial do depara). NULL quando não casa: fica o texto.
CREATE OR REPLACE FUNCTION public.sst_bases_contrato_id(_texto text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT c.id FROM public.contratos c
      WHERE nullif(btrim(_texto), '') IS NOT NULL AND public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(_texto)
      ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1),
    (SELECT d.contrato_id FROM public.sup_empregado_contrato_depara d
      WHERE nullif(btrim(_texto), '') IS NOT NULL AND public.rh_norm_contrato(d.filial_nome) = public.rh_norm_contrato(_texto)
      ORDER BY d.contrato_id LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.sst_bases_contrato_id(text) FROM PUBLIC, anon, authenticated;

-- ── 2. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_ASO_HISTORICO" (
  id               bigserial PRIMARY KEY,
  cpf              text CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$'),   -- NULL = sem vínculo (só importação)
  nome             text NOT NULL,
  empresa          text,                                              -- sigla da planilha (HAGG, SN, NH, CANAÃ)
  filial_texto     text,                                              -- "NOME FILIAL" como a planilha escrevia
  tipo             text NOT NULL CHECK (tipo IN ('admissional', 'periodico', 'retorno', 'troca_funcao', 'demissional')),
  data_solicitacao date,
  data_realizacao  date,
  -- realizado: conta (e, se não for demissional, move o vencimento do periódico);
  -- valido: demissional dispensado porque o ASO anterior ainda vale.
  situacao         text NOT NULL DEFAULT 'realizado'
                     CHECK (situacao IN ('realizado', 'aguardando', 'atrasado', 'cancelado', 'valido', 'nao_compareceu')),
  solicitado_por   text,
  clinica          text,
  observacoes      text,
  origem           text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha')),
  chave_importacao text UNIQUE,
  -- Linha da planilha corrigida na tela: a reimportação não a sobrescreve.
  editado_manual   boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_by_nome  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_aso_hist_realizado_ck CHECK (situacao <> 'realizado' OR data_realizacao IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sst_aso_hist_cpf_idx ON public."SST_ASO_HISTORICO" (cpf);
CREATE INDEX IF NOT EXISTS sst_aso_hist_data_idx ON public."SST_ASO_HISTORICO" (data_realizacao);

CREATE TABLE IF NOT EXISTS public."SST_TRN_OBRIGATORIO" (
  id                  bigserial PRIMARY KEY,
  empresa             text,
  contrato_texto      text NOT NULL,
  contrato_id         uuid,
  funcoes             text,                 -- "SERVENTE DE LIMPEZA, SUPERVISOR" / "TODAS FUNÇÕES"
  treinamento         text NOT NULL,        -- "NR-01, NR-06, NR-17" / "PREVENÇÃO DE COMBATE A INCÊNDIO"
  base_legal          text,
  periodicidade_meses integer CHECK (periodicidade_meses IS NULL OR periodicidade_meses BETWEEN 1 AND 120),
  ultimo_treinamento  date,
  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  origem              text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha')),
  chave_importacao    text UNIQUE,
  editado_manual      boolean NOT NULL DEFAULT false,
  created_by          uuid,
  created_by_nome     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_trn_obrig_contrato_idx ON public."SST_TRN_OBRIGATORIO" (contrato_id);

CREATE TABLE IF NOT EXISTS public."SST_TRN_TURMA" (
  id               bigserial PRIMARY KEY,
  numero           integer,               -- o "nº" do cronograma (linhas sem nº são a mesma turma, outro contrato)
  empresa          text,
  contrato_texto   text NOT NULL,
  contrato_id      uuid,
  funcoes          text,
  nrs              text,                  -- "NR 12- NR 31", como escrito
  tema             text,
  data             date,                  -- NULL = sem data marcada
  participantes    integer CHECK (participantes IS NULL OR participantes >= 0),
  custo            numeric(12,2) CHECK (custo IS NULL OR custo >= 0),
  instrutor        text,
  local            text,
  observacoes      text,
  cancelada        boolean NOT NULL DEFAULT false,
  origem           text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha')),
  chave_importacao text UNIQUE,
  editado_manual   boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_by_nome  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_trn_turma_data_idx ON public."SST_TRN_TURMA" (data);
CREATE INDEX IF NOT EXISTS sst_trn_turma_contrato_idx ON public."SST_TRN_TURMA" (contrato_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SST_ASO_HISTORICO', 'SST_TRN_OBRIGATORIO', 'SST_TRN_TURMA'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || lower(t) || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
                   'trg_' || lower(t) || '_updated_at', t);
  END LOOP;
END $$;

-- ── 3. ASO Periódico: o histórico conta para o vencimento ────────────────
-- Corpo da mig 20261114100000 + a 5ª fonte. Demissional não move vencimento
-- (quem tem demissional e segue ativo foi readmitido: o admissional novo conta).
-- Linha sem vínculo (cpf NULL) não entra.
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
      UNION ALL
      -- SIS-2026-0816: ASOs da planilha / registrados em SST › ASOs Realizados.
      SELECT h.cpf, h.data_realizacao, h.tipo
        FROM public."SST_ASO_HISTORICO" h
       WHERE h.cpf IS NOT NULL AND h.situacao = 'realizado' AND h.tipo <> 'demissional'
    ) f
   WHERE length(f.cpf) = 11 AND f.data IS NOT NULL AND f.data <= current_date
   ORDER BY f.cpf, f.data DESC,
            -- Mesmo dia: o periódico registrado aqui vence o desempate.
            (f.tipo = 'periodico') DESC
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_ultimos() FROM PUBLIC, anon, authenticated;

-- ── 4. ASOs Realizados: leitura e cadastro ───────────────────────────────
-- Pessoas para o vínculo: todo CPF da EMPREGADOS (inclui desligado: o
-- demissional é de quem saiu), com o código da empresa para o desempate.
CREATE OR REPLACE FUNCTION public.sst_aso_hist_pessoas()
RETURNS TABLE (cpf text, nome_norm text, empresa_codigo text, empregado_id bigint, nome text, desligado boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT ON (x.cpf, x.empresa_codigo) x.cpf, public.sup_norm_nome(x.nome), x.empresa_codigo, x.empregado_id, x.nome, x.desligado
    FROM (SELECT regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g') AS cpf, btrim(e."Nome"::text) AS nome,
                 nullif(btrim(e."Empresa"::text), '') AS empresa_codigo, e."ID"::bigint AS empregado_id,
                 COALESCE(public.sst_afa_tipo_da_situacao(e."Situação"::text) = 'desligamento', false) AS desligado
            FROM public."EMPREGADOS" e) x
   WHERE length(x.cpf) = 11 AND x.nome IS NOT NULL AND x.nome !~* 'teste'
   ORDER BY x.cpf, x.empresa_codigo, x.desligado, x.empregado_id DESC
$$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_pessoas() FROM PUBLIC, anon, authenticated;

-- Lista paginada (a planilha tem ~9.500 linhas): filtros no banco, no máximo
-- p_limite linhas, mais o resumo do ano para os cartões. Nunca devolve CPF.
CREATE OR REPLACE FUNCTION public.sst_aso_hist_lista(p_busca text DEFAULT NULL, p_tipo text DEFAULT NULL, p_de date DEFAULT NULL,
                                                     p_ate date DEFAULT NULL, p_sem_vinculo boolean DEFAULT false,
                                                     p_situacao text DEFAULT NULL, p_limite integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ano date := date_trunc('year', current_date)::date;
  v_busca text := nullif(public.sup_norm_nome(COALESCE(p_busca, '')), '');
  v_lim integer := LEAST(GREATEST(COALESCE(p_limite, 300), 1), 1000);
BEGIN
  PERFORM public.sst_bases_exige('sst_asos_realizados', 'visualizar');
  RETURN (
    WITH f AS (
      SELECT h.* FROM public."SST_ASO_HISTORICO" h
       WHERE (p_tipo IS NULL OR h.tipo = p_tipo)
         AND (p_situacao IS NULL OR h.situacao = p_situacao)
         AND (NOT COALESCE(p_sem_vinculo, false) OR h.cpf IS NULL)
         AND (p_de IS NULL OR COALESCE(h.data_realizacao, h.data_solicitacao) >= p_de)
         AND (p_ate IS NULL OR COALESCE(h.data_realizacao, h.data_solicitacao) <= p_ate)
         AND (v_busca IS NULL OR public.sup_norm_nome(h.nome || ' ' || COALESCE(h.filial_texto, '')) LIKE '%' || v_busca || '%')
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM f),
      'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', x.id, 'nome', x.nome, 'vinculado', x.cpf IS NOT NULL, 'empresa', x.empresa, 'filial_texto', x.filial_texto,
                  'tipo', x.tipo, 'data_solicitacao', x.data_solicitacao, 'data_realizacao', x.data_realizacao, 'situacao', x.situacao,
                  'solicitado_por', x.solicitado_por, 'clinica', x.clinica, 'observacoes', x.observacoes, 'origem', x.origem,
                  'editado_manual', x.editado_manual, 'created_by_nome', x.created_by_nome, 'updated_at', x.updated_at)
                ORDER BY COALESCE(x.data_realizacao, x.data_solicitacao) DESC NULLS LAST, x.id DESC)
                 FROM (SELECT * FROM f ORDER BY COALESCE(f.data_realizacao, f.data_solicitacao) DESC NULLS LAST, f.id DESC LIMIT v_lim) x), '[]'::jsonb),
      'resumo', (SELECT jsonb_build_object(
                   'realizados_ano', count(*) FILTER (WHERE h.situacao = 'realizado' AND h.data_realizacao >= v_ano),
                   'por_tipo_ano', COALESCE((SELECT jsonb_object_agg(t.tipo, t.q) FROM (
                       SELECT h2.tipo, count(*) q FROM public."SST_ASO_HISTORICO" h2
                        WHERE h2.situacao = 'realizado' AND h2.data_realizacao >= v_ano GROUP BY 1) t), '{}'::jsonb),
                   'pendentes', count(*) FILTER (WHERE h.situacao IN ('aguardando', 'atrasado')),
                   'sem_vinculo', count(*) FILTER (WHERE h.cpf IS NULL),
                   'total', count(*))
                   FROM public."SST_ASO_HISTORICO" h)));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_lista(text, text, date, date, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_hist_lista(text, text, date, date, boolean, text, integer) TO authenticated;

-- Busca de colaborador para ligar/cadastrar (sem CPF na resposta).
CREATE OR REPLACE FUNCTION public.sst_aso_hist_colaboradores(p_busca text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v text := nullif(public.sup_norm_nome(COALESCE(p_busca, '')), '');
BEGIN
  PERFORM public.sst_bases_exige('sst_asos_realizados', 'visualizar');
  IF v IS NULL OR length(v) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('empregado_id', p.empregado_id, 'nome', p.nome,
                                                       'empresa_codigo', p.empresa_codigo, 'desligado', p.desligado)
                                    ORDER BY p.desligado, p.nome)
                     FROM (SELECT * FROM public.sst_aso_hist_pessoas() WHERE nome_norm LIKE '%' || v || '%'
                            ORDER BY desligado, nome LIMIT 20) p), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_hist_colaboradores(text) TO authenticated;

-- Salvar (novo ou edição). p.empregado_id escolhe a pessoa (o CPF sai da
-- EMPREGADOS); sem ele, a edição mantém o vínculo que já havia.
CREATE OR REPLACE FUNCTION public.sst_aso_hist_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_cpf  text;
  v_nome text;
  v_sit  text := COALESCE(nullif(p->>'situacao', ''), 'realizado');
  v_real date := nullif(p->>'data_realizacao', '')::date;
BEGIN
  PERFORM public.sst_bases_exige('sst_asos_realizados', 'alterar');
  IF nullif(p->>'empregado_id', '') IS NOT NULL THEN
    SELECT regexp_replace(COALESCE(e."CPF"::text, ''), '\D', '', 'g'), btrim(e."Nome"::text) INTO v_cpf, v_nome
      FROM public."EMPREGADOS" e WHERE e."ID" = (p->>'empregado_id')::bigint;
    IF length(COALESCE(v_cpf, '')) <> 11 THEN RAISE EXCEPTION 'Colaborador sem CPF válido no cadastro.'; END IF;
  END IF;
  IF v_sit = 'realizado' AND v_real IS NULL THEN RAISE EXCEPTION 'Informe a data de realização do ASO.'; END IF;
  IF v_real > current_date THEN RAISE EXCEPTION 'A data de realização não pode estar no futuro.'; END IF;

  IF v_id IS NULL THEN
    IF v_cpf IS NULL THEN RAISE EXCEPTION 'Escolha o colaborador.'; END IF;
    INSERT INTO public."SST_ASO_HISTORICO" (cpf, nome, empresa, filial_texto, tipo, data_solicitacao, data_realizacao, situacao,
                                            solicitado_por, clinica, observacoes, origem, created_by, created_by_nome)
    VALUES (v_cpf, v_nome, nullif(btrim(p->>'empresa'), ''), nullif(btrim(p->>'filial_texto'), ''), p->>'tipo',
            nullif(p->>'data_solicitacao', '')::date, v_real, v_sit, nullif(btrim(p->>'solicitado_por'), ''),
            nullif(btrim(p->>'clinica'), ''), nullif(btrim(p->>'observacoes'), ''), 'manual', auth.uid(), public.sst_afa_nome_usuario())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."SST_ASO_HISTORICO" h SET
      cpf = COALESCE(v_cpf, h.cpf),
      nome = COALESCE(v_nome, h.nome),
      empresa = nullif(btrim(p->>'empresa'), ''),
      filial_texto = nullif(btrim(p->>'filial_texto'), ''),
      tipo = p->>'tipo',
      data_solicitacao = nullif(p->>'data_solicitacao', '')::date,
      data_realizacao = v_real,
      situacao = v_sit,
      solicitado_por = nullif(btrim(p->>'solicitado_por'), ''),
      clinica = nullif(btrim(p->>'clinica'), ''),
      observacoes = nullif(btrim(p->>'observacoes'), ''),
      editado_manual = h.editado_manual OR h.origem = 'planilha'
     WHERE h.id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_hist_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_hist_excluir(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_asos_realizados', 'excluir');
  DELETE FROM public."SST_ASO_HISTORICO" WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_excluir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_hist_excluir(bigint) TO authenticated;

-- ── 5. ASOs Realizados: importação da planilha ───────────────────────────
-- A planilha é lida no navegador (lerPlanilhaAsos, src/lib/sst/asoHistorico.ts)
-- e as linhas vêm em lotes; a chave (tipo + nome + data da solicitação + nº
-- de ordem dos repetidos) também vem de lá. Tudo set-based: 9.500 linhas.
--   · Linha nova → entra; já existente e diferente (ex.: AGUARDANDO virou
--     REALIZADO) → atualiza, a menos que o SST tenha corrigido na tela
--     (editado_manual); vínculo feito na tela nunca é desfeito.
--   · p_simular: mesmas contas, nada gravado — e o efeito no ASO Periódico
--     (quantos ativos teriam o último ASO corrigido e quantos deixam de vencer).
CREATE OR REPLACE FUNCTION public.sst_aso_hist_importar(p_linhas jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_aviso  integer := COALESCE((SELECT dias_aviso FROM public.sst_aso_per_cfg()), 60);
  v_out    jsonb;
  v_novos  integer;
  v_atual  integer;
BEGIN
  PERFORM public.sst_bases_exige('sst_asos_realizados', 'alterar');
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar.';
  END IF;
  -- A planilha inteira vai de uma vez (~9.500 linhas): o efeito no ASO Periódico só é exato olhando tudo junto.
  IF jsonb_array_length(p_linhas) > 15000 THEN RAISE EXCEPTION 'Envie no máximo 15.000 linhas por vez.'; END IF;

  DROP TABLE IF EXISTS tmp_sst_aso_pes;
  CREATE TEMP TABLE tmp_sst_aso_pes ON COMMIT DROP AS SELECT * FROM public.sst_aso_hist_pessoas();
  CREATE INDEX ON tmp_sst_aso_pes (nome_norm);

  DROP TABLE IF EXISTS tmp_sst_aso_imp;
  CREATE TEMP TABLE tmp_sst_aso_imp ON COMMIT DROP AS
  SELECT x.*, public.sup_norm_nome(x.nome) AS nome_norm, public.sst_bases_empresa_codigo(x.empresa) AS emp_cod,
         NULL::text AS cpf, NULL::text AS motivo
    FROM jsonb_to_recordset(p_linhas) AS x(chave text, linha integer, aba text, tipo text, nome text, empresa text, filial text,
                                            data_solicitacao date, data_realizacao date, situacao text, solicitado_por text)
   WHERE nullif(btrim(x.chave), '') IS NOT NULL AND nullif(btrim(x.nome), '') IS NOT NULL
     AND x.tipo IN ('admissional', 'periodico', 'retorno', 'troca_funcao', 'demissional')
     AND x.situacao IN ('realizado', 'aguardando', 'atrasado', 'cancelado', 'valido', 'nao_compareceu')
     AND NOT (x.situacao = 'realizado' AND x.data_realizacao IS NULL);
  -- Chave repetida no mesmo envio derrubaria o ON CONFLICT: fica a primeira.
  DELETE FROM tmp_sst_aso_imp a USING tmp_sst_aso_imp b WHERE a.chave = b.chave AND a.ctid > b.ctid;

  -- Vínculo: nome único → ligado; homônimo → desempata pela empresa.
  UPDATE tmp_sst_aso_imp t SET
    cpf = CASE WHEN cardinality(c.todos) = 1 THEN c.todos[1] WHEN cardinality(c.da_empresa) = 1 THEN c.da_empresa[1] END,
    motivo = CASE WHEN cardinality(c.todos) = 1 OR cardinality(c.da_empresa) = 1 THEN NULL
                  WHEN cardinality(c.todos) > 1 THEN 'homonimo' ELSE 'nao_encontrado' END
    FROM (SELECT t2.chave,
                 (SELECT array_agg(DISTINCT p.cpf) FROM tmp_sst_aso_pes p WHERE p.nome_norm = t2.nome_norm) AS todos,
                 (SELECT array_agg(DISTINCT p.cpf) FROM tmp_sst_aso_pes p WHERE p.nome_norm = t2.nome_norm AND p.empresa_codigo = t2.emp_cod) AS da_empresa
            FROM tmp_sst_aso_imp t2) c
   WHERE c.chave = t.chave;

  -- O que já existe e mudaria (sem tocar no que o SST corrigiu na tela).
  SELECT count(*) FILTER (WHERE h.id IS NULL),
         count(*) FILTER (WHERE h.id IS NOT NULL AND h.origem = 'planilha' AND NOT h.editado_manual AND (
                 (h.data_realizacao, h.data_solicitacao, h.situacao, h.empresa, h.filial_texto)
                   IS DISTINCT FROM (t.data_realizacao, t.data_solicitacao, t.situacao, nullif(btrim(t.empresa), ''), nullif(btrim(t.filial), ''))
                 OR (h.cpf IS NULL AND t.cpf IS NOT NULL)))
    INTO v_novos, v_atual
    FROM tmp_sst_aso_imp t LEFT JOIN public."SST_ASO_HISTORICO" h ON h.chave_importacao = t.chave;

  -- Efeito no ASO Periódico: ativos cujo último ASO fica mais novo.
  WITH novo AS (
    SELECT t.cpf, max(t.data_realizacao) AS data FROM tmp_sst_aso_imp t
     WHERE t.cpf IS NOT NULL AND t.situacao = 'realizado' AND t.tipo <> 'demissional' AND t.data_realizacao <= current_date
     GROUP BY t.cpf
  ), b AS (
    SELECT b.cpf, b.ultimo_aso, b.vencimento, b.periodicidade_meses, n.data AS data_nova
      FROM public.sst_aso_per_base() b JOIN novo n ON n.cpf = b.cpf
     WHERE n.data > COALESCE(b.ultimo_aso, '1900-01-01')
  )
  SELECT jsonb_build_object(
           'ativos_corrigidos', count(*),
           'deixam_de_vencer', count(*) FILTER (WHERE b.vencimento < current_date
                                                 AND (b.data_nova + make_interval(months => b.periodicidade_meses))::date >= current_date),
           'saem_de_proximo', count(*) FILTER (WHERE b.vencimento BETWEEN current_date AND current_date + v_aviso
                                                AND (b.data_nova + make_interval(months => b.periodicidade_meses))::date > current_date + v_aviso))
    INTO v_out FROM b;

  v_out := jsonb_build_object(
    'simulado', p_simular,
    'lidas', (SELECT count(*) FROM tmp_sst_aso_imp),
    'recusadas', jsonb_array_length(p_linhas) - (SELECT count(*) FROM tmp_sst_aso_imp),
    'novos', v_novos, 'atualizados', v_atual,
    'ligados', (SELECT count(*) FROM tmp_sst_aso_imp WHERE cpf IS NOT NULL),
    'sem_vinculo_total', (SELECT count(*) FROM tmp_sst_aso_imp WHERE cpf IS NULL),
    'sem_vinculo', COALESCE((SELECT jsonb_agg(jsonb_build_object('linha', s.linha, 'aba', s.aba, 'nome', s.nome, 'motivo', s.motivo) ORDER BY s.aba, s.linha)
                               FROM (SELECT * FROM tmp_sst_aso_imp WHERE cpf IS NULL ORDER BY aba, linha LIMIT 300) s), '[]'::jsonb),
    'por_tipo', COALESCE((SELECT jsonb_object_agg(q.tipo, q.n) FROM (SELECT tipo, count(*) n FROM tmp_sst_aso_imp GROUP BY 1) q), '{}'::jsonb),
    'periodico', v_out);

  IF p_simular THEN RETURN v_out; END IF;

  INSERT INTO public."SST_ASO_HISTORICO" AS h (cpf, nome, empresa, filial_texto, tipo, data_solicitacao, data_realizacao, situacao,
                                               solicitado_por, origem, chave_importacao, created_by, created_by_nome)
  SELECT t.cpf, btrim(t.nome), nullif(btrim(t.empresa), ''), nullif(btrim(t.filial), ''), t.tipo, t.data_solicitacao, t.data_realizacao,
         t.situacao, nullif(btrim(t.solicitado_por), ''), 'planilha', t.chave, auth.uid(), public.sst_afa_nome_usuario()
    FROM tmp_sst_aso_imp t
  ON CONFLICT (chave_importacao) DO UPDATE SET
    cpf = COALESCE(h.cpf, EXCLUDED.cpf),
    empresa = CASE WHEN h.editado_manual THEN h.empresa ELSE EXCLUDED.empresa END,
    filial_texto = CASE WHEN h.editado_manual THEN h.filial_texto ELSE EXCLUDED.filial_texto END,
    data_solicitacao = CASE WHEN h.editado_manual THEN h.data_solicitacao ELSE EXCLUDED.data_solicitacao END,
    data_realizacao = CASE WHEN h.editado_manual THEN h.data_realizacao ELSE EXCLUDED.data_realizacao END,
    situacao = CASE WHEN h.editado_manual THEN h.situacao ELSE EXCLUDED.situacao END
   WHERE h.origem = 'planilha' AND (
         (NOT h.editado_manual AND (h.data_realizacao, h.data_solicitacao, h.situacao, h.empresa, h.filial_texto)
            IS DISTINCT FROM (EXCLUDED.data_realizacao, EXCLUDED.data_solicitacao, EXCLUDED.situacao, EXCLUDED.empresa, EXCLUDED.filial_texto))
         OR (h.cpf IS NULL AND EXCLUDED.cpf IS NOT NULL));

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_hist_importar(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_hist_importar(jsonb, boolean) TO authenticated;

-- ── 6. Treinamentos NR: régua do status ──────────────────────────────────
-- Espelho de statusObrigatorio (src/lib/sst/treinamentosNr.ts). 30 dias de
-- aviso, como o "Alerta (30d)" da planilha. Sem periodicidade = vale enquanto
-- existir a data (treinamento único, ex. integração).
CREATE OR REPLACE FUNCTION public.sst_trn_status(p_ultimo date, p_meses integer, p_hoje date DEFAULT current_date, p_aviso integer DEFAULT 30)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_ultimo IS NULL THEN 'pendente'
    WHEN p_meses IS NULL THEN 'em_dia'
    WHEN (p_ultimo + make_interval(months => p_meses))::date < p_hoje THEN 'vencido'
    WHEN (p_ultimo + make_interval(months => p_meses))::date <= p_hoje + p_aviso THEN 'proximo'
    ELSE 'em_dia'
  END
$$;

CREATE OR REPLACE FUNCTION public.sst_trn_contratos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'visualizar');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
                     FROM (SELECT id, nome FROM public.contratos WHERE COALESCE(status, 'ativo') <> 'encerrado' ORDER BY nome LIMIT 1000) c),
                  '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_contratos() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_trn_obrig_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'visualizar');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', o.id, 'empresa', o.empresa, 'contrato_texto', o.contrato_texto, 'contrato_id', o.contrato_id,
             'contrato_nome', c.nome, 'funcoes', o.funcoes, 'treinamento', o.treinamento, 'base_legal', o.base_legal,
             'periodicidade_meses', o.periodicidade_meses, 'ultimo_treinamento', o.ultimo_treinamento,
             'validade', CASE WHEN o.ultimo_treinamento IS NOT NULL AND o.periodicidade_meses IS NOT NULL
                              THEN (o.ultimo_treinamento + make_interval(months => o.periodicidade_meses))::date END,
             'status', public.sst_trn_status(o.ultimo_treinamento, o.periodicidade_meses),
             'observacoes', o.observacoes, 'ativo', o.ativo, 'origem', o.origem, 'updated_at', o.updated_at)
           ORDER BY o.empresa NULLS LAST, o.contrato_texto, o.id)
      FROM (SELECT * FROM public."SST_TRN_OBRIGATORIO" ORDER BY id LIMIT 5000) o
      LEFT JOIN public.contratos c ON c.id = o.contrato_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_obrig_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_obrig_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_trn_obrig_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_ct text := nullif(btrim(p->>'contrato_texto'), '');
  v_ult date := nullif(p->>'ultimo_treinamento', '')::date;
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'alterar');
  IF v_ct IS NULL THEN RAISE EXCEPTION 'Informe o contrato.'; END IF;
  IF nullif(btrim(p->>'treinamento'), '') IS NULL THEN RAISE EXCEPTION 'Informe o treinamento.'; END IF;
  IF v_ult > current_date THEN RAISE EXCEPTION 'A data do último treinamento não pode estar no futuro.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."SST_TRN_OBRIGATORIO" (empresa, contrato_texto, contrato_id, funcoes, treinamento, base_legal, periodicidade_meses,
                                              ultimo_treinamento, observacoes, ativo, origem, created_by, created_by_nome)
    VALUES (nullif(btrim(p->>'empresa'), ''), v_ct, COALESCE(nullif(p->>'contrato_id', '')::uuid, public.sst_bases_contrato_id(v_ct)),
            nullif(btrim(p->>'funcoes'), ''), btrim(p->>'treinamento'), nullif(btrim(p->>'base_legal'), ''),
            nullif(p->>'periodicidade_meses', '')::integer, v_ult, nullif(btrim(p->>'observacoes'), ''),
            COALESCE((p->>'ativo')::boolean, true), 'manual', auth.uid(), public.sst_afa_nome_usuario())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."SST_TRN_OBRIGATORIO" o SET
      empresa = nullif(btrim(p->>'empresa'), ''), contrato_texto = v_ct,
      contrato_id = COALESCE(nullif(p->>'contrato_id', '')::uuid, public.sst_bases_contrato_id(v_ct)),
      funcoes = nullif(btrim(p->>'funcoes'), ''), treinamento = btrim(p->>'treinamento'), base_legal = nullif(btrim(p->>'base_legal'), ''),
      periodicidade_meses = nullif(p->>'periodicidade_meses', '')::integer, ultimo_treinamento = v_ult,
      observacoes = nullif(btrim(p->>'observacoes'), ''), ativo = COALESCE((p->>'ativo')::boolean, o.ativo),
      editado_manual = o.editado_manual OR o.origem = 'planilha'
     WHERE o.id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_obrig_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_obrig_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_trn_obrig_excluir(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'excluir');
  DELETE FROM public."SST_TRN_OBRIGATORIO" WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_obrig_excluir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_obrig_excluir(bigint) TO authenticated;

-- ── 7. Treinamentos NR: turmas (cronograma) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_trn_turma_lista(p_ano integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'visualizar');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'id', t.id, 'numero', t.numero, 'empresa', t.empresa, 'contrato_texto', t.contrato_texto, 'contrato_id', t.contrato_id,
             'contrato_nome', c.nome, 'funcoes', t.funcoes, 'nrs', t.nrs, 'tema', t.tema, 'data', t.data,
             'participantes', t.participantes, 'custo', t.custo, 'instrutor', t.instrutor, 'local', t.local,
             'observacoes', t.observacoes, 'cancelada', t.cancelada, 'origem', t.origem)
           ORDER BY t.data NULLS LAST, t.numero NULLS LAST, t.id)
      FROM (SELECT * FROM public."SST_TRN_TURMA"
             WHERE p_ano IS NULL OR extract(year FROM data)::integer = p_ano OR data IS NULL
             ORDER BY data DESC NULLS FIRST LIMIT 2000) t
      LEFT JOIN public.contratos c ON c.id = t.contrato_id), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_turma_lista(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_turma_lista(integer) TO authenticated;

-- p_obrigatorios: linhas da matriz que a turma cobre. Turma já realizada
-- (data até hoje, não cancelada) leva a data do último treinamento dessas
-- linhas para a da turma — nunca para trás.
CREATE OR REPLACE FUNCTION public.sst_trn_turma_salvar(p jsonb, p_obrigatorios bigint[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_ct   text := nullif(btrim(p->>'contrato_texto'), '');
  v_data date := nullif(p->>'data', '')::date;
  v_canc boolean := COALESCE((p->>'cancelada')::boolean, false);
  v_atu  integer := 0;
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'alterar');
  IF v_ct IS NULL THEN RAISE EXCEPTION 'Informe o contrato.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."SST_TRN_TURMA" (numero, empresa, contrato_texto, contrato_id, funcoes, nrs, tema, data, participantes, custo,
                                        instrutor, local, observacoes, cancelada, origem, created_by, created_by_nome)
    VALUES (nullif(p->>'numero', '')::integer, nullif(btrim(p->>'empresa'), ''), v_ct,
            COALESCE(nullif(p->>'contrato_id', '')::uuid, public.sst_bases_contrato_id(v_ct)),
            nullif(btrim(p->>'funcoes'), ''), nullif(btrim(p->>'nrs'), ''), nullif(btrim(p->>'tema'), ''), v_data,
            nullif(p->>'participantes', '')::integer, nullif(p->>'custo', '')::numeric, nullif(btrim(p->>'instrutor'), ''),
            nullif(btrim(p->>'local'), ''), nullif(btrim(p->>'observacoes'), ''), v_canc, 'manual', auth.uid(), public.sst_afa_nome_usuario())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."SST_TRN_TURMA" t SET
      numero = nullif(p->>'numero', '')::integer, empresa = nullif(btrim(p->>'empresa'), ''), contrato_texto = v_ct,
      contrato_id = COALESCE(nullif(p->>'contrato_id', '')::uuid, public.sst_bases_contrato_id(v_ct)),
      funcoes = nullif(btrim(p->>'funcoes'), ''), nrs = nullif(btrim(p->>'nrs'), ''), tema = nullif(btrim(p->>'tema'), ''), data = v_data,
      participantes = nullif(p->>'participantes', '')::integer, custo = nullif(p->>'custo', '')::numeric,
      instrutor = nullif(btrim(p->>'instrutor'), ''), local = nullif(btrim(p->>'local'), ''),
      observacoes = nullif(btrim(p->>'observacoes'), ''), cancelada = v_canc,
      editado_manual = t.editado_manual OR t.origem = 'planilha'
     WHERE t.id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Turma não encontrada.'; END IF;
  END IF;

  IF NOT v_canc AND v_data IS NOT NULL AND v_data <= current_date AND COALESCE(cardinality(p_obrigatorios), 0) > 0 THEN
    UPDATE public."SST_TRN_OBRIGATORIO" o SET ultimo_treinamento = v_data
     WHERE o.id = ANY (p_obrigatorios) AND (o.ultimo_treinamento IS NULL OR o.ultimo_treinamento < v_data);
    GET DIAGNOSTICS v_atu = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'obrigatorios_atualizados', v_atu);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_turma_salvar(jsonb, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_turma_salvar(jsonb, bigint[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_trn_turma_excluir(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'excluir');
  DELETE FROM public."SST_TRN_TURMA" WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_turma_excluir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_turma_excluir(bigint) TO authenticated;

-- ── 8. Treinamentos NR: importação das duas planilhas ────────────────────
-- p_tipo = 'plano' (Plano_Treinamentos_Empresas: matriz) ou 'cronograma'
-- (CRONOGRAMA DE TREINAMENTOS: turmas). Lidas no navegador
-- (src/lib/sst/treinamentosNr.ts), chave montada lá. Reimportar não duplica;
-- a linha corrigida na tela não é sobrescrita; a data do último treinamento
-- da matriz nunca anda para trás (uma turma registrada no ERP pode tê-la
-- adiantado).
CREATE OR REPLACE FUNCTION public.sst_trn_importar(p_tipo text, p_linhas jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_novos integer; v_atual integer; v_sem text[];
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'alterar');
  IF p_tipo NOT IN ('plano', 'cronograma') THEN RAISE EXCEPTION 'Tipo de planilha desconhecido: %', p_tipo; END IF;
  IF jsonb_typeof(p_linhas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'A planilha não tem linhas para importar.';
  END IF;
  IF jsonb_array_length(p_linhas) > 3000 THEN RAISE EXCEPTION 'Envie no máximo 3.000 linhas por vez.'; END IF;

  DROP TABLE IF EXISTS tmp_sst_trn_imp;
  CREATE TEMP TABLE tmp_sst_trn_imp ON COMMIT DROP AS
  SELECT x.*, public.sst_bases_contrato_id(x.contrato) AS contrato_id
    FROM jsonb_to_recordset(p_linhas) AS x(chave text, linha integer, empresa text, contrato text, funcoes text, treinamento text,
                                            base_legal text, periodicidade_meses integer, ultimo_treinamento date, observacoes text,
                                            numero integer, nrs text, data date, participantes integer, custo numeric)
   WHERE nullif(btrim(x.chave), '') IS NOT NULL AND nullif(btrim(x.contrato), '') IS NOT NULL
     AND (p_tipo = 'cronograma' OR nullif(btrim(x.treinamento), '') IS NOT NULL);
  DELETE FROM tmp_sst_trn_imp a USING tmp_sst_trn_imp b WHERE a.chave = b.chave AND a.ctid > b.ctid;

  SELECT array_agg(DISTINCT btrim(contrato) ORDER BY btrim(contrato)) INTO v_sem FROM tmp_sst_trn_imp WHERE contrato_id IS NULL;

  IF p_tipo = 'plano' THEN
    SELECT count(*) FILTER (WHERE o.id IS NULL),
           count(*) FILTER (WHERE o.id IS NOT NULL AND o.origem = 'planilha' AND (
             (NOT o.editado_manual AND (o.base_legal, o.periodicidade_meses, o.observacoes, o.funcoes, o.treinamento)
               IS DISTINCT FROM (nullif(btrim(t.base_legal), ''), t.periodicidade_meses, nullif(btrim(t.observacoes), ''), nullif(btrim(t.funcoes), ''), btrim(t.treinamento)))
             OR t.ultimo_treinamento > COALESCE(o.ultimo_treinamento, '1900-01-01')))
      INTO v_novos, v_atual
      FROM tmp_sst_trn_imp t LEFT JOIN public."SST_TRN_OBRIGATORIO" o ON o.chave_importacao = t.chave;
  ELSE
    SELECT count(*) FILTER (WHERE m.id IS NULL),
           count(*) FILTER (WHERE m.id IS NOT NULL AND m.origem = 'planilha' AND NOT m.editado_manual AND
             (m.data, m.participantes, m.custo, m.funcoes, m.nrs, m.numero)
               IS DISTINCT FROM (t.data, t.participantes, t.custo, nullif(btrim(t.funcoes), ''), nullif(btrim(t.nrs), ''), t.numero))
      INTO v_novos, v_atual
      FROM tmp_sst_trn_imp t LEFT JOIN public."SST_TRN_TURMA" m ON m.chave_importacao = t.chave;
  END IF;

  IF NOT p_simular AND p_tipo = 'plano' THEN
    INSERT INTO public."SST_TRN_OBRIGATORIO" AS o (empresa, contrato_texto, contrato_id, funcoes, treinamento, base_legal, periodicidade_meses,
                                                   ultimo_treinamento, observacoes, origem, chave_importacao, created_by, created_by_nome)
    SELECT nullif(btrim(t.empresa), ''), btrim(t.contrato), t.contrato_id, nullif(btrim(t.funcoes), ''), btrim(t.treinamento),
           nullif(btrim(t.base_legal), ''), t.periodicidade_meses, t.ultimo_treinamento, nullif(btrim(t.observacoes), ''),
           'planilha', t.chave, auth.uid(), public.sst_afa_nome_usuario()
      FROM tmp_sst_trn_imp t
    ON CONFLICT (chave_importacao) DO UPDATE SET
      base_legal = CASE WHEN o.editado_manual THEN o.base_legal ELSE EXCLUDED.base_legal END,
      periodicidade_meses = CASE WHEN o.editado_manual THEN o.periodicidade_meses ELSE EXCLUDED.periodicidade_meses END,
      observacoes = CASE WHEN o.editado_manual THEN o.observacoes ELSE EXCLUDED.observacoes END,
      funcoes = CASE WHEN o.editado_manual THEN o.funcoes ELSE EXCLUDED.funcoes END,
      treinamento = CASE WHEN o.editado_manual THEN o.treinamento ELSE EXCLUDED.treinamento END,
      contrato_id = COALESCE(o.contrato_id, EXCLUDED.contrato_id),
      ultimo_treinamento = GREATEST(o.ultimo_treinamento, EXCLUDED.ultimo_treinamento)
     WHERE o.origem = 'planilha';
  ELSIF NOT p_simular THEN
    INSERT INTO public."SST_TRN_TURMA" AS m (numero, empresa, contrato_texto, contrato_id, funcoes, nrs, data, participantes, custo,
                                             origem, chave_importacao, created_by, created_by_nome)
    SELECT t.numero, nullif(btrim(t.empresa), ''), btrim(t.contrato), t.contrato_id, nullif(btrim(t.funcoes), ''), nullif(btrim(t.nrs), ''),
           t.data, t.participantes, t.custo, 'planilha', t.chave, auth.uid(), public.sst_afa_nome_usuario()
      FROM tmp_sst_trn_imp t
    ON CONFLICT (chave_importacao) DO UPDATE SET
      numero = EXCLUDED.numero, data = EXCLUDED.data, participantes = EXCLUDED.participantes, custo = EXCLUDED.custo,
      funcoes = EXCLUDED.funcoes, nrs = EXCLUDED.nrs, contrato_id = COALESCE(m.contrato_id, EXCLUDED.contrato_id)
     WHERE m.origem = 'planilha' AND NOT m.editado_manual;
  END IF;

  RETURN jsonb_build_object('simulado', p_simular, 'tipo', p_tipo,
    'lidas', (SELECT count(*) FROM tmp_sst_trn_imp),
    'recusadas', jsonb_array_length(p_linhas) - (SELECT count(*) FROM tmp_sst_trn_imp),
    'novos', v_novos, 'atualizados', v_atual,
    'contratos_sem_casar', to_jsonb(COALESCE(v_sem, '{}'::text[])));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_importar(text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_importar(text, jsonb, boolean) TO authenticated;

-- ── 9. Treinamentos ONLINE: obrigatório por contrato × feito ─────────────
-- "Obrigatório" = curso publicado liberado por regra de contrato/cargo
-- (TRN_CURSO_LIBERACAO) para o aluno, com a mesma régua de público da
-- plataforma (contrato/cargo iguais sem caixa e espaços; aluno não demitido
-- nem bloqueado). "Feito" = certificado emitido. Interna (sem grant): a tela
-- e a TV chamam por portões próprios.
CREATE OR REPLACE FUNCTION public.sst_trn_online_dados()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH pares AS (
    SELECT DISTINCT a.id AS aluno_id, l.curso_id, upper(btrim(COALESCE(a.contrato, ''))) AS contrato
      FROM public."TRN_CURSO_LIBERACAO" l
      JOIN public."TRN_CURSO" c ON c.id = l.curso_id AND c.publicado
      JOIN public."TRN_ALUNO" a
        ON (nullif(btrim(l.contrato), '') IS NULL OR upper(btrim(l.contrato)) = upper(btrim(a.contrato)))
       AND (nullif(btrim(l.cargo), '') IS NULL OR upper(btrim(l.cargo)) = upper(btrim(a.cargo)))
     WHERE COALESCE(a.situacao, '') <> 'Demitido' AND a.status <> 'bloqueado'
  ), p AS (
    SELECT pares.*, EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = pares.aluno_id AND ce.curso_id = pares.curso_id) AS feito
      FROM pares
  )
  SELECT jsonb_build_object(
    'obrigatorios', (SELECT count(*) FROM p),
    'concluidos', (SELECT count(*) FROM p WHERE feito),
    'pendentes', (SELECT count(*) FROM p WHERE NOT feito),
    'pessoas', (SELECT count(DISTINCT aluno_id) FROM p),
    'por_curso', COALESCE((SELECT jsonb_agg(jsonb_build_object('curso', x.nome, 'obrigatorios', x.o, 'concluidos', x.f) ORDER BY x.o - x.f DESC, x.nome)
                             FROM (SELECT c.nome, count(*) o, count(*) FILTER (WHERE p.feito) f
                                     FROM p JOIN public."TRN_CURSO" c ON c.id = p.curso_id GROUP BY c.nome ORDER BY 2 DESC LIMIT 12) x), '[]'::jsonb),
    'por_contrato', COALESCE((SELECT jsonb_agg(jsonb_build_object('contrato', x.contrato, 'obrigatorios', x.o, 'concluidos', x.f) ORDER BY x.o - x.f DESC)
                               FROM (SELECT COALESCE(nullif(p.contrato, ''), 'SEM CONTRATO') contrato, count(*) o, count(*) FILTER (WHERE p.feito) f
                                       FROM p GROUP BY 1 ORDER BY count(*) FILTER (WHERE NOT p.feito) DESC LIMIT 10) x), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.sst_trn_online_dados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sst_trn_online_resumo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_bases_exige('sst_treinamentos_nr', 'visualizar');
  RETURN public.sst_trn_online_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.sst_trn_online_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_trn_online_resumo() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (recriar public.sst_aso_per_ultimos() da mig 20261114100000 — sem a 5ª fonte)
-- DROP FUNCTION IF EXISTS public.sst_trn_online_resumo(), public.sst_trn_online_dados(),
--   public.sst_trn_importar(text, jsonb, boolean), public.sst_trn_turma_excluir(bigint),
--   public.sst_trn_turma_salvar(jsonb, bigint[]), public.sst_trn_turma_lista(integer),
--   public.sst_trn_obrig_excluir(bigint), public.sst_trn_obrig_salvar(jsonb), public.sst_trn_obrig_lista(),
--   public.sst_trn_contratos(), public.sst_trn_status(date, integer, date, integer),
--   public.sst_aso_hist_importar(jsonb, boolean), public.sst_aso_hist_excluir(bigint), public.sst_aso_hist_salvar(jsonb),
--   public.sst_aso_hist_colaboradores(text), public.sst_aso_hist_lista(text, text, date, date, boolean, text, integer),
--   public.sst_aso_hist_pessoas(), public.sst_bases_contrato_id(text), public.sst_bases_empresa_codigo(text),
--   public.sst_bases_exige(text, text);
-- DROP TABLE IF EXISTS public."SST_TRN_TURMA", public."SST_TRN_OBRIGATORIO", public."SST_ASO_HISTORICO";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('sst_asos_realizados', 'sst_treinamentos_nr');
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('sst_asos_realizados', 'sst_treinamentos_nr');
-- DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('sst_asos_realizados', 'sst_treinamentos_nr');
-- DELETE FROM public.app_menu WHERE codigo IN ('sst_asos_realizados', 'sst_treinamentos_nr');
-- NOTIFY pgrst, 'reload schema';
