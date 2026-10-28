-- =========================================================================
-- SST › AFASTAMENTOS E TELEMEDICINA — análise automática dos afastamentos
-- por atestado e do impacto operacional e financeiro (28/10/2026)
--
-- CHAMADO: "automatizar a análise dos afastamentos por atestado e permitir a
-- mensuração de seus impactos operacionais e financeiros". Hoje é uma
-- planilha manual (PLANILHA TELEMEDICINA.xlsx — 1.472 linhas, mar–out/2026 —
-- e RELATÓRIO MENSAL ATESTADOS.xlsx) e, para cada linha, alguém pesquisa a
-- lotação do colaborador (contrato, posto, escala, valor do posto).
--
-- O QUE ESTA MIGRATION FAZ (tudo aditivo — nada existente muda)
--   1. Menus: sst_afastamentos (/app/sst/afastamentos; visualizar + alterar)
--      e o fantasma sst_afastamentos_financeiro (valores da Planilha de
--      Custo, faturamento, glosa e margem). Nascem FECHADOS — liberar em
--      Acesso por Usuário.
--   2. SST_AFASTAMENTO — um afastamento: atestado (dias, CID, tipo),
--      telemedicina (data, encaminhamento, avaliação, resultado, dias após a
--      avaliação, assinatura, ponto), acompanhamento do retorno e a LOTAÇÃO
--      gravada na data do afastamento (contrato, posto da Senior, posto da
--      Planilha de Custo, cargo, escala, RT do contrato).
--      SST_AFASTAMENTO_FIN — os valores do posto na data (Planilha de Custo
--      vigente: valor mensal, salário, custo, lucro) + glosa informada; RLS
--      só para quem tem o financeiro.
--      SST_AFASTAMENTO_DESPESA — cobertura registrada à mão (hora extra,
--      substituição, remanejamento, RT, transporte…) com valor e dias.
--      SST_AFASTAMENTO_EVENTO — histórico.
--   3. Lotação AUTOMÁTICA (sst_afa_lotacao_calc): a mesma ligação do
--      RH › Ativos/Contratos — contrato pelo depara da filial/nome/local
--      (rh_ac_ativos), posto da planilha por RH_POSTO_COLABORADOR (ajuste do
--      ERP, inclusive RENDA TÉCNICA) ou RH_POSTO_DEPARA (posto da Senior), e
--      a Planilha de Custo EXECUTADA vigente na data do afastamento.
--   4. Cobertura AUTOMÁTICA na ficha e no relatório: ocorrências da
--      Efetividade (OPE_EFET_OCORRENCIA, com substituto e se ele é RT),
--      diárias (DIARIA_SOLICITACAO/LINHA do faltante) e as despesas manuais.
--   5. Financeiro: notas emitidas do contrato nas competências do
--      afastamento (nf_emissao: bruto, faltas, glosas, líquido).
--   6. Captura da Senior (sst_afa_capturar_senior, pg_cron de hora em hora):
--      quem entra em situação de atestado / auxílio-doença / acidente vira
--      afastamento sozinho (origem 'senior'), e o retorno é marcado quando a
--      situação volta a "Trabalhando" (ou "desligado" na demissão). O
--      espelho só tem a situação ATUAL — a captura monta o histórico daqui
--      para a frente; o passado entra pela importação da planilha.
--   7. Importação da planilha de telemedicina (sst_afa_importar): o front lê
--      o .xlsx; o banco casa o nome com EMPREGADOS, resolve a lotação e não
--      duplica (chave nome + data do atestado).
--
-- Escrita só pelas RPCs (SECURITY DEFINER, exigem alterar). Leitura das
-- tabelas pela RLS. Sem filtro de empresa.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_afastamentos', 'Afastamentos e Telemedicina', '/app/sst/afastamentos',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_afastamentos');

-- Fantasma: quem vê valores (Planilha de Custo, notas, glosa, margem).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_afastamentos_financeiro', 'Afastamentos — Ver valores e impacto financeiro', NULL,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_afastamentos_financeiro');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_afastamentos', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sst_afa_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_afastamentos', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_afa_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_ve_fin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.can_access(auth.uid(), 'sst_afastamentos_financeiro', 'visualizar'::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_afa_ve_fin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_ve_fin() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_afa_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) a Afastamentos e Telemedicina', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_afa_exige(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_exige(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_nome_usuario()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = auth.uid()), 'Sistema')
$$;
REVOKE ALL ON FUNCTION public.sst_afa_nome_usuario() FROM PUBLIC, anon;

-- ── 2. Tabelas ───────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.sst_afastamento_protocolo_seq;

CREATE TABLE IF NOT EXISTS public."SST_AFASTAMENTO" (
  id                bigserial PRIMARY KEY,
  protocolo         text UNIQUE,
  empregado_id      bigint,                       -- EMPREGADOS."ID" (sem FK: a carga da Senior apaga/recria)
  empresa           bigint,
  cadastro          bigint,
  nome              text NOT NULL,
  cpf               text,
  tipo              text NOT NULL DEFAULT 'atestado',
  data_inicio       date NOT NULL,
  dias_atestado     integer,                      -- NULL = em aberto (sem previsão)
  cid               text,
  medico            text,
  observacao        text,
  origem            text NOT NULL DEFAULT 'manual',
  situacao_senior   text,
  -- Telemedicina
  tele_status       text NOT NULL DEFAULT 'nao_avaliado',
  tele_data         date,
  tele_horario      text,
  tele_encaminhamento text,
  tele_avaliacao    text,
  tele_resultado    text,
  dias_apos_tele    integer,
  assinatura        text,
  ponto             text,
  encarregado_nome  text,
  -- Retorno
  retorno_status    text NOT NULL DEFAULT 'aguardando',
  retornou_em       date,
  acompanhamento    text,
  -- Lotação na data do afastamento (gravada, não recalculada sozinha)
  contrato_id       uuid,
  contrato_nome     text,
  filial_nome       text,
  posto_senior      text,
  posto_planilha    text,
  cargo             text,
  escala            text,
  rt_no_contrato    integer,
  lotacao_em        timestamptz,
  -- Importação
  contrato_planilha text,
  situacao_planilha text,
  chave_importacao  text UNIQUE,
  cancelado         boolean NOT NULL DEFAULT false,
  cancelado_motivo  text,
  created_by        uuid,
  created_by_nome   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  dias_considerados integer GENERATED ALWAYS AS (COALESCE(dias_apos_tele, dias_atestado)) STORED,
  CONSTRAINT sst_afa_tipo CHECK (tipo IN ('atestado', 'atestado_acompanhante', 'acidente_trabalho', 'auxilio_doenca', 'outros')),
  CONSTRAINT sst_afa_origem CHECK (origem IN ('manual', 'senior', 'planilha')),
  CONSTRAINT sst_afa_tele CHECK (tele_status IN ('nao_avaliado', 'agendada', 'realizada', 'nao_compareceu', 'nao_avaliado_prazo', 'nao_se_aplica')),
  CONSTRAINT sst_afa_result CHECK (tele_resultado IS NULL OR tele_resultado IN ('mantido', 'reduzido', 'zerado', 'ampliado')),
  CONSTRAINT sst_afa_assin CHECK (assinatura IS NULL OR assinatura IN ('encaminhado', 'assinado', 'sem_assinatura')),
  CONSTRAINT sst_afa_ponto CHECK (ponto IS NULL OR ponto IN ('cumpriu', 'nao_cumpriu')),
  CONSTRAINT sst_afa_retorno CHECK (retorno_status IN ('aguardando', 'retornou', 'nao_retornou', 'prorrogado', 'desligado')),
  CONSTRAINT sst_afa_dias CHECK ((dias_atestado IS NULL OR dias_atestado >= 0) AND (dias_apos_tele IS NULL OR dias_apos_tele >= 0))
);
CREATE INDEX IF NOT EXISTS idx_sst_afa_inicio ON public."SST_AFASTAMENTO" (data_inicio);
CREATE INDEX IF NOT EXISTS idx_sst_afa_emp ON public."SST_AFASTAMENTO" (empregado_id, data_inicio);
CREATE INDEX IF NOT EXISTS idx_sst_afa_contrato ON public."SST_AFASTAMENTO" (contrato_id, data_inicio);

CREATE OR REPLACE FUNCTION public.sst_afa_protocolo()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.protocolo IS NULL THEN
    NEW.protocolo := 'AFA-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sst_afastamento_protocolo_seq')::text, 5, '0');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sst_afa_protocolo ON public."SST_AFASTAMENTO";
CREATE TRIGGER trg_sst_afa_protocolo BEFORE INSERT OR UPDATE ON public."SST_AFASTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sst_afa_protocolo();

CREATE TABLE IF NOT EXISTS public."SST_AFASTAMENTO_FIN" (
  afastamento_id      bigint PRIMARY KEY REFERENCES public."SST_AFASTAMENTO"(id) ON DELETE CASCADE,
  valor_mensal_posto  numeric(14,2),               -- planilha_custo.total_por_empregado
  salario             numeric(14,2),
  custo_mensal_posto  numeric(14,2),               -- valor mensal − lucro − tributos
  lucro_mensal        numeric(14,2),
  planilha_vigencia   date,
  glosa_valor         numeric(14,2),               -- informada (senão o relatório estima)
  glosa_obs           text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."SST_AFASTAMENTO_DESPESA" (
  id               bigserial PRIMARY KEY,
  afastamento_id   bigint NOT NULL REFERENCES public."SST_AFASTAMENTO"(id) ON DELETE CASCADE,
  tipo             text NOT NULL,
  data             date NOT NULL,
  dias             integer NOT NULL DEFAULT 1,
  substituto_nome  text,
  horas            numeric(8,2),
  valor            numeric(14,2) NOT NULL DEFAULT 0,
  descricao        text,
  created_by       uuid,
  created_by_nome  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sst_afa_desp_tipo CHECK (tipo IN ('hora_extra', 'substituicao', 'remanejamento', 'rt', 'diaria', 'transporte', 'beneficio', 'outros')),
  CONSTRAINT sst_afa_desp_dias CHECK (dias >= 0 AND valor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sst_afa_desp ON public."SST_AFASTAMENTO_DESPESA" (afastamento_id);

CREATE TABLE IF NOT EXISTS public."SST_AFASTAMENTO_EVENTO" (
  id              bigserial PRIMARY KEY,
  afastamento_id  bigint NOT NULL REFERENCES public."SST_AFASTAMENTO"(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  descricao       text,
  autor_nome      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sst_afa_ev ON public."SST_AFASTAMENTO_EVENTO" (afastamento_id, created_at);

ALTER TABLE public."SST_AFASTAMENTO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_AFASTAMENTO_FIN" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_AFASTAMENTO_DESPESA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SST_AFASTAMENTO_EVENTO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."SST_AFASTAMENTO", public."SST_AFASTAMENTO_FIN", public."SST_AFASTAMENTO_DESPESA", public."SST_AFASTAMENTO_EVENTO" TO authenticated;

DROP POLICY IF EXISTS sst_afa_ler ON public."SST_AFASTAMENTO";
CREATE POLICY sst_afa_ler ON public."SST_AFASTAMENTO" FOR SELECT TO authenticated USING (public.sst_afa_pode('visualizar'));
DROP POLICY IF EXISTS sst_afa_fin_ler ON public."SST_AFASTAMENTO_FIN";
CREATE POLICY sst_afa_fin_ler ON public."SST_AFASTAMENTO_FIN" FOR SELECT TO authenticated USING (public.sst_afa_pode('visualizar') AND public.sst_afa_ve_fin());
DROP POLICY IF EXISTS sst_afa_desp_ler ON public."SST_AFASTAMENTO_DESPESA";
CREATE POLICY sst_afa_desp_ler ON public."SST_AFASTAMENTO_DESPESA" FOR SELECT TO authenticated USING (public.sst_afa_pode('visualizar'));
DROP POLICY IF EXISTS sst_afa_ev_ler ON public."SST_AFASTAMENTO_EVENTO";
CREATE POLICY sst_afa_ev_ler ON public."SST_AFASTAMENTO_EVENTO" FOR SELECT TO authenticated USING (public.sst_afa_pode('visualizar'));

-- ── 3. Lotação na data ───────────────────────────────────────────────────
-- Mesma ligação do RH › Ativos/Contratos (rh_ac_ativos + rh_ac_painel), mas
-- para UMA pessoa em qualquer situação (quem está de atestado ou já saiu
-- também) e com a Planilha de Custo vigente NA DATA.
CREATE OR REPLACE FUNCTION public.sst_afa_lotacao_calc(p_empregado_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  e        public."EMPREGADOS"%ROWTYPE;
  v_ct     uuid;
  v_ctnome text;
  v_ps     text;
  v_oc     text;
  v_rt     boolean := false;
  v_pp     text;
  v_pc     public.planilha_custo%ROWTYPE;
  v_rtq    integer;
BEGIN
  SELECT * INTO e FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Contrato: depara da filial (exato) → nome da filial → depara normalizado → local.
  SELECT d.contrato_id INTO v_ct FROM public.sup_empregado_contrato_depara d
   WHERE d.filial_nome = e."Nome Filial" ORDER BY d.contrato_id LIMIT 1;
  IF v_ct IS NULL THEN
    SELECT c.id INTO v_ct FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(e."Nome Filial")
     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1;
  END IF;
  IF v_ct IS NULL THEN
    SELECT d.contrato_id INTO v_ct FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) = public.rh_norm_contrato(e."Nome Filial")
     ORDER BY d.contrato_id LIMIT 1;
  END IF;
  IF v_ct IS NULL THEN
    SELECT c.id INTO v_ct FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) = public.rh_norm_contrato(e."Descrição do Local")
     ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC LIMIT 1;
  END IF;
  SELECT c.nome INTO v_ctnome FROM public.contratos c WHERE c.id = v_ct;

  v_ps := btrim(COALESCE(e."Nome do Posto", ''));

  IF v_ct IS NOT NULL THEN
    -- Ajuste do ERP para a pessoa (inclusive RENDA TÉCNICA).
    SELECT x.planilha_posto, public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA'
      INTO v_oc, v_rt
      FROM public."RH_POSTO_COLABORADOR" x
     WHERE x.empresa = e."Empresa" AND x.cadastro = e."Cadastro" AND x.contrato_id = v_ct;
    v_rt := COALESCE(v_rt, false);

    IF v_rt THEN
      v_pp := 'RENDA TÉCNICA';
    ELSE
      -- Posto da planilha: o da pessoa, senão o do depara do posto da Senior.
      SELECT pc.posto INTO v_pp
        FROM public.planilha_custo pc
       WHERE pc.contrato_id = v_ct AND pc.orexec = 'EXECUTADO'
         AND COALESCE(btrim(pc.posto), '') <> ''
         AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(
               COALESCE(nullif(v_oc, ''),
                        (SELECT d.planilha_posto FROM public."RH_POSTO_DEPARA" d
                          WHERE d.contrato_id = v_ct AND d.posto_senior = v_ps AND NOT d.ignorar LIMIT 1)))
       ORDER BY pc.data_vigencia DESC NULLS LAST LIMIT 1;
    END IF;

    -- Planilha vigente na data; sem vigência até a data, a mais antiga.
    IF v_pp IS NOT NULL AND NOT v_rt THEN
      SELECT pc.* INTO v_pc
        FROM public.planilha_custo pc
       WHERE pc.contrato_id = v_ct AND pc.orexec = 'EXECUTADO'
         AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(v_pp)
       ORDER BY (pc.data_vigencia IS NOT NULL AND pc.data_vigencia <= p_data) DESC,
                CASE WHEN pc.data_vigencia <= p_data THEN pc.data_vigencia END DESC NULLS LAST,
                pc.data_vigencia ASC NULLS LAST
       LIMIT 1;
    END IF;

    SELECT count(*) INTO v_rtq FROM public."RH_POSTO_COLABORADOR" x
     WHERE x.contrato_id = v_ct AND public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA';
  END IF;

  RETURN jsonb_build_object(
    'empresa', e."Empresa", 'cadastro', e."Cadastro", 'nome', btrim(e."Nome"), 'cpf', e."CPF",
    'situacao', e."Situação",
    'contrato_id', v_ct, 'contrato_nome', v_ctnome, 'filial_nome', e."Nome Filial",
    'posto_senior', nullif(v_ps, ''), 'posto_planilha', v_pp, 'eh_rt', v_rt,
    'cargo', nullif(btrim(e."Título do Cargo"), ''), 'escala', nullif(btrim(e."Escala"), ''),
    'rt_no_contrato', COALESCE(v_rtq, 0),
    'valor_mensal_posto', v_pc.total_por_empregado,
    'salario', COALESCE(v_pc.salario, public.col_num(e."Valor Salário")),
    'lucro_mensal', v_pc.lucro,
    'custo_mensal_posto', CASE WHEN v_pc.total_por_empregado IS NOT NULL THEN
        v_pc.total_por_empregado - COALESCE(v_pc.lucro, 0) - COALESCE(v_pc.cofins, 0) - COALESCE(v_pc.pis, 0)
        - COALESCE(v_pc.irpj_csll, 0) - COALESCE(v_pc.iss, 0) END,
    'planilha_vigencia', v_pc.data_vigencia);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_lotacao_calc(bigint, date) FROM PUBLIC, anon, authenticated;

-- Grava a lotação calculada no afastamento (snapshot + valores).
CREATE OR REPLACE FUNCTION public.sst_afa_aplicar_lotacao(p_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  a public."SST_AFASTAMENTO"%ROWTYPE;
  l jsonb;
BEGIN
  SELECT * INTO a FROM public."SST_AFASTAMENTO" WHERE id = p_id;
  IF NOT FOUND OR a.empregado_id IS NULL THEN RETURN; END IF;
  l := public.sst_afa_lotacao_calc(a.empregado_id, a.data_inicio);
  IF l IS NULL THEN RETURN; END IF;
  UPDATE public."SST_AFASTAMENTO" SET
    empresa = (l->>'empresa')::bigint, cadastro = (l->>'cadastro')::bigint,
    cpf = COALESCE(cpf, l->>'cpf'),
    contrato_id = (l->>'contrato_id')::uuid, contrato_nome = l->>'contrato_nome', filial_nome = l->>'filial_nome',
    posto_senior = l->>'posto_senior', posto_planilha = l->>'posto_planilha',
    cargo = l->>'cargo', escala = l->>'escala', rt_no_contrato = (l->>'rt_no_contrato')::int,
    lotacao_em = now()
  WHERE id = p_id;
  INSERT INTO public."SST_AFASTAMENTO_FIN" (afastamento_id, valor_mensal_posto, salario, custo_mensal_posto, lucro_mensal, planilha_vigencia, updated_at)
  VALUES (p_id, (l->>'valor_mensal_posto')::numeric, (l->>'salario')::numeric, (l->>'custo_mensal_posto')::numeric,
          (l->>'lucro_mensal')::numeric, (l->>'planilha_vigencia')::date, now())
  ON CONFLICT (afastamento_id) DO UPDATE SET
    valor_mensal_posto = EXCLUDED.valor_mensal_posto, salario = EXCLUDED.salario,
    custo_mensal_posto = EXCLUDED.custo_mensal_posto, lucro_mensal = EXCLUDED.lucro_mensal,
    planilha_vigencia = EXCLUDED.planilha_vigencia, updated_at = now();
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_aplicar_lotacao(bigint) FROM PUBLIC, anon, authenticated;

-- ── 4. Busca de colaborador (para o formulário) ──────────────────────────
CREATE OR REPLACE FUNCTION public.sst_afa_colaboradores(p_busca text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE t text := btrim(COALESCE(p_busca, ''));
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  IF length(t) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object('id', e."ID", 'nome', btrim(e."Nome"), 'cpf', e."CPF", 'situacao', e."Situação",
                                'filial', e."Nome Filial", 'cargo', e."Título do Cargo", 'cadastro', e."Cadastro") AS x
        FROM public."EMPREGADOS" e
       WHERE (e."Nome" ILIKE '%' || t || '%'
              OR regexp_replace(COALESCE(e."CPF", ''), '\D', '', 'g') = regexp_replace(t, '\D', '', 'g'))
       ORDER BY (e."Situação" = 'Trabalhando') DESC, e."Nome"
       LIMIT 20) s), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_colaboradores(text) TO authenticated;

-- Prévia da lotação antes de salvar (o formulário mostra o que vai gravar).
CREATE OR REPLACE FUNCTION public.sst_afa_lotacao(p_empregado_id bigint, p_data date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE l jsonb;
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  l := public.sst_afa_lotacao_calc(p_empregado_id, COALESCE(p_data, current_date));
  IF l IS NOT NULL AND NOT public.sst_afa_ve_fin() THEN
    l := l - 'valor_mensal_posto' - 'salario' - 'lucro_mensal' - 'custo_mensal_posto';
  END IF;
  RETURN l;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_lotacao(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_lotacao(bigint, date) TO authenticated;

-- ── 5. Escrita ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_afa_evento(p_id bigint, p_tipo text, p_desc text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
  VALUES (p_id, p_tipo, p_desc, public.sst_afa_nome_usuario());
$$;
REVOKE ALL ON FUNCTION public.sst_afa_evento(bigint, text, text) FROM PUBLIC, anon, authenticated;

-- Cria (sem id) ou altera (com id). Campos que não vierem no json ficam como estão.
CREATE OR REPLACE FUNCTION public.sst_afa_salvar(p jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  a      public."SST_AFASTAMENTO"%ROWTYPE;
  v_emp  bigint;
  v_nome text;
  v_ini  date;
  v_relot boolean := false;
  t      text;
BEGIN
  PERFORM public.sst_afa_exige('alterar');

  IF v_id IS NULL THEN
    v_emp := nullif(p->>'empregado_id', '')::bigint;
    v_ini := nullif(p->>'data_inicio', '')::date;
    IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe a data do atestado.'; END IF;
    v_nome := nullif(btrim(p->>'nome'), '');
    IF v_emp IS NOT NULL THEN
      SELECT btrim("Nome") INTO v_nome FROM public."EMPREGADOS" WHERE "ID" = v_emp;
    END IF;
    IF v_nome IS NULL THEN RAISE EXCEPTION 'Escolha o colaborador.'; END IF;
    IF v_emp IS NOT NULL AND EXISTS (
         SELECT 1 FROM public."SST_AFASTAMENTO" x
          WHERE x.empregado_id = v_emp AND x.data_inicio = v_ini AND NOT x.cancelado) THEN
      RAISE EXCEPTION 'Já existe afastamento deste colaborador com início em %.', to_char(v_ini, 'DD/MM/YYYY');
    END IF;
    INSERT INTO public."SST_AFASTAMENTO" (empregado_id, nome, data_inicio, origem, created_by, created_by_nome)
    VALUES (v_emp, v_nome, v_ini, 'manual', auth.uid(), public.sst_afa_nome_usuario())
    RETURNING id INTO v_id;
    v_relot := true;
    PERFORM public.sst_afa_evento(v_id, 'criado', 'Afastamento registrado.');
  ELSE
    SELECT * INTO a FROM public."SST_AFASTAMENTO" WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Afastamento não encontrado.'; END IF;
    IF p ? 'empregado_id' AND nullif(p->>'empregado_id', '')::bigint IS DISTINCT FROM a.empregado_id THEN
      v_emp := nullif(p->>'empregado_id', '')::bigint;
      SELECT btrim("Nome") INTO v_nome FROM public."EMPREGADOS" WHERE "ID" = v_emp;
      UPDATE public."SST_AFASTAMENTO" SET empregado_id = v_emp, nome = COALESCE(v_nome, nome) WHERE id = v_id;
      v_relot := true;
    END IF;
    IF p ? 'data_inicio' AND nullif(p->>'data_inicio', '')::date IS DISTINCT FROM a.data_inicio THEN
      IF nullif(p->>'data_inicio', '') IS NULL THEN RAISE EXCEPTION 'Informe a data do atestado.'; END IF;
      UPDATE public."SST_AFASTAMENTO" SET data_inicio = (p->>'data_inicio')::date WHERE id = v_id;
      v_relot := true;
    END IF;
  END IF;

  UPDATE public."SST_AFASTAMENTO" x SET
    tipo                = CASE WHEN p ? 'tipo' THEN COALESCE(nullif(p->>'tipo', ''), 'atestado') ELSE x.tipo END,
    dias_atestado       = CASE WHEN p ? 'dias_atestado' THEN nullif(p->>'dias_atestado', '')::int ELSE x.dias_atestado END,
    cid                 = CASE WHEN p ? 'cid' THEN nullif(btrim(p->>'cid'), '') ELSE x.cid END,
    medico              = CASE WHEN p ? 'medico' THEN nullif(btrim(p->>'medico'), '') ELSE x.medico END,
    observacao          = CASE WHEN p ? 'observacao' THEN nullif(btrim(p->>'observacao'), '') ELSE x.observacao END,
    tele_status         = CASE WHEN p ? 'tele_status' THEN COALESCE(nullif(p->>'tele_status', ''), 'nao_avaliado') ELSE x.tele_status END,
    tele_data           = CASE WHEN p ? 'tele_data' THEN nullif(p->>'tele_data', '')::date ELSE x.tele_data END,
    tele_horario        = CASE WHEN p ? 'tele_horario' THEN nullif(btrim(p->>'tele_horario'), '') ELSE x.tele_horario END,
    tele_encaminhamento = CASE WHEN p ? 'tele_encaminhamento' THEN nullif(btrim(p->>'tele_encaminhamento'), '') ELSE x.tele_encaminhamento END,
    tele_avaliacao      = CASE WHEN p ? 'tele_avaliacao' THEN nullif(btrim(p->>'tele_avaliacao'), '') ELSE x.tele_avaliacao END,
    tele_resultado      = CASE WHEN p ? 'tele_resultado' THEN nullif(p->>'tele_resultado', '') ELSE x.tele_resultado END,
    dias_apos_tele      = CASE WHEN p ? 'dias_apos_tele' THEN nullif(p->>'dias_apos_tele', '')::int ELSE x.dias_apos_tele END,
    assinatura          = CASE WHEN p ? 'assinatura' THEN nullif(p->>'assinatura', '') ELSE x.assinatura END,
    ponto               = CASE WHEN p ? 'ponto' THEN nullif(p->>'ponto', '') ELSE x.ponto END,
    encarregado_nome    = CASE WHEN p ? 'encarregado_nome' THEN nullif(btrim(p->>'encarregado_nome'), '') ELSE x.encarregado_nome END,
    retorno_status      = CASE WHEN p ? 'retorno_status' THEN COALESCE(nullif(p->>'retorno_status', ''), 'aguardando') ELSE x.retorno_status END,
    retornou_em         = CASE WHEN p ? 'retornou_em' THEN nullif(p->>'retornou_em', '')::date ELSE x.retornou_em END,
    acompanhamento      = CASE WHEN p ? 'acompanhamento' THEN nullif(btrim(p->>'acompanhamento'), '') ELSE x.acompanhamento END,
    cancelado           = CASE WHEN p ? 'cancelado' THEN COALESCE((p->>'cancelado')::boolean, false) ELSE x.cancelado END,
    cancelado_motivo    = CASE WHEN p ? 'cancelado_motivo' THEN nullif(btrim(p->>'cancelado_motivo'), '') ELSE x.cancelado_motivo END
  WHERE x.id = v_id;

  IF v_relot THEN PERFORM public.sst_afa_aplicar_lotacao(v_id); END IF;

  IF a.id IS NOT NULL THEN
    t := concat_ws('; ',
      CASE WHEN p ? 'tele_status' AND p->>'tele_status' IS DISTINCT FROM a.tele_status THEN 'telemedicina: ' || (p->>'tele_status') END,
      CASE WHEN p ? 'dias_apos_tele' AND nullif(p->>'dias_apos_tele', '')::int IS DISTINCT FROM a.dias_apos_tele THEN 'dias após a telemedicina: ' || COALESCE(p->>'dias_apos_tele', '—') END,
      CASE WHEN p ? 'retorno_status' AND p->>'retorno_status' IS DISTINCT FROM a.retorno_status THEN 'retorno: ' || (p->>'retorno_status') END,
      CASE WHEN p ? 'cancelado' AND COALESCE((p->>'cancelado')::boolean, false) AND NOT a.cancelado THEN 'cancelado' END,
      CASE WHEN v_relot THEN 'lotação recalculada' END);
    PERFORM public.sst_afa_evento(v_id, 'alterado', COALESCE(nullif(t, ''), 'Dados atualizados.'));
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_recalcular_lotacao(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_afa_exige('alterar');
  PERFORM public.sst_afa_aplicar_lotacao(p_id);
  PERFORM public.sst_afa_evento(p_id, 'lotacao', 'Lotação e valores do posto recalculados.');
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_recalcular_lotacao(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_recalcular_lotacao(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_despesa_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint;
BEGIN
  PERFORM public.sst_afa_exige('alterar');
  IF nullif(p->>'data', '') IS NULL THEN RAISE EXCEPTION 'Informe a data da cobertura.'; END IF;
  INSERT INTO public."SST_AFASTAMENTO_DESPESA" (afastamento_id, tipo, data, dias, substituto_nome, horas, valor, descricao, created_by, created_by_nome)
  VALUES ((p->>'afastamento_id')::bigint, COALESCE(nullif(p->>'tipo', ''), 'outros'), (p->>'data')::date,
          COALESCE(nullif(p->>'dias', '')::int, 1), nullif(btrim(p->>'substituto_nome'), ''),
          nullif(p->>'horas', '')::numeric, COALESCE(nullif(p->>'valor', '')::numeric, 0),
          nullif(btrim(p->>'descricao'), ''), auth.uid(), public.sst_afa_nome_usuario())
  RETURNING id INTO v_id;
  PERFORM public.sst_afa_evento((p->>'afastamento_id')::bigint, 'cobertura',
    'Cobertura registrada: ' || COALESCE(p->>'tipo', 'outros') || COALESCE(' — ' || nullif(btrim(p->>'substituto_nome'), ''), ''));
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_despesa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_despesa_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_despesa_remover(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_afa bigint;
BEGIN
  PERFORM public.sst_afa_exige('alterar');
  DELETE FROM public."SST_AFASTAMENTO_DESPESA" WHERE id = p_id RETURNING afastamento_id INTO v_afa;
  IF v_afa IS NOT NULL THEN PERFORM public.sst_afa_evento(v_afa, 'cobertura', 'Cobertura removida.'); END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_despesa_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_despesa_remover(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_glosa_salvar(p_id bigint, p_valor numeric, p_obs text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_afa_exige('alterar');
  IF NOT public.sst_afa_ve_fin() THEN RAISE EXCEPTION 'Sem acesso aos valores.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public."SST_AFASTAMENTO_FIN" (afastamento_id, glosa_valor, glosa_obs) VALUES (p_id, p_valor, nullif(btrim(p_obs), ''))
  ON CONFLICT (afastamento_id) DO UPDATE SET glosa_valor = EXCLUDED.glosa_valor, glosa_obs = EXCLUDED.glosa_obs, updated_at = now();
  PERFORM public.sst_afa_evento(p_id, 'financeiro', 'Glosa/perda de receita informada: ' || COALESCE(to_char(p_valor, 'FM999G999G990D00'), 'removida'));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_glosa_salvar(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_glosa_salvar(bigint, numeric, text) TO authenticated;

-- ── 6. Coberturas automáticas e consolidação ─────────────────────────────
-- Dias do afastamento cobertos, de três fontes, sem contar o mesmo dia duas
-- vezes: Efetividade (ocorrência com substituto e cobertura feita),
-- diárias do faltante e coberturas registradas no afastamento.
CREATE OR REPLACE FUNCTION public.sst_afa_coberturas(p_id bigint)
RETURNS TABLE (dia date, fonte text, substituto text, eh_rt boolean, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH a AS (
    SELECT x.*, x.data_inicio AS ini,
           CASE WHEN x.dias_considerados IS NULL THEN GREATEST(current_date, x.data_inicio)
                WHEN x.dias_considerados = 0 THEN x.data_inicio
                ELSE x.data_inicio + x.dias_considerados - 1 END AS fim
      FROM public."SST_AFASTAMENTO" x WHERE x.id = p_id
  ),
  rt AS (
    SELECT empresa, cadastro FROM public."RH_POSTO_COLABORADOR"
     WHERE public.sup_norm_nome(planilha_posto) = 'RENDATECNICA'
  )
  SELECT o.data, 'efetividade',
         COALESCE(o.substituto_nome, 'Substituto'),
         EXISTS (SELECT 1 FROM public."EMPREGADOS" s JOIN rt ON rt.empresa = s."Empresa" AND rt.cadastro = s."Cadastro"
                  WHERE s."ID" = o.substituto_empregado_id),
         NULL::numeric
    FROM a JOIN public."OPE_EFET_OCORRENCIA" o
      ON o.empregado_id = a.empregado_id AND o.data BETWEEN a.ini AND a.fim
   WHERE o.status IN ('aceita', 'em_deslocamento', 'aguardando_ponto', 'ponto_confirmado')
     AND (o.substituto_nome IS NOT NULL OR o.substituto_empregado_id IS NOT NULL OR o.substituto_diarista_id IS NOT NULL)
  UNION ALL
  SELECT l.data, 'diaria', d.diarista_nome, false,
         (l.valor_diaria_centavos + l.qt_vt * l.valor_unit_vt_centavos) / 100.0
    FROM a JOIN public."DIARIA_SOLICITACAO" d
      ON (d.faltante_empregado_id = a.empregado_id
          OR (a.cpf IS NOT NULL AND regexp_replace(d.faltante_cpf, '\D', '', 'g') = regexp_replace(a.cpf, '\D', '', 'g')))
    JOIN public."DIARIA_LINHA" l ON l.solicitacao_id = d.id AND l.data BETWEEN a.ini AND a.fim
   WHERE d.status <> 'reprovada'
  UNION ALL
  SELECT g::date, 'registro', ds.substituto_nome, ds.tipo = 'rt',
         CASE WHEN g::date = ds.data THEN ds.valor ELSE 0 END
    FROM public."SST_AFASTAMENTO_DESPESA" ds
    CROSS JOIN LATERAL generate_series(ds.data, ds.data + GREATEST(ds.dias, 1) - 1, interval '1 day') g
   WHERE ds.afastamento_id = p_id;
$fn$;
REVOKE ALL ON FUNCTION public.sst_afa_coberturas(bigint) FROM PUBLIC, anon, authenticated;

-- Lista do período (afastamentos que tocam [ini, fim]) com os totais de
-- cobertura e, para quem tem o financeiro, os valores do posto.
CREATE OR REPLACE FUNCTION public.sst_afa_lista(p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_fin boolean := public.sst_afa_ve_fin(); v_out jsonb;
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  WITH a AS (
    SELECT x.* FROM public."SST_AFASTAMENTO" x
     WHERE x.data_inicio <= p_fim
       AND (CASE WHEN x.dias_considerados IS NULL THEN GREATEST(current_date, x.data_inicio)
                 WHEN x.dias_considerados = 0 THEN x.data_inicio
                 ELSE x.data_inicio + x.dias_considerados - 1 END) >= p_ini
  ),
  cob AS (
    SELECT a.id,
           count(DISTINCT c.dia) AS dias_cobertos,
           count(DISTINCT c.dia) FILTER (WHERE c.eh_rt) AS dias_rt,
           COALESCE(sum(c.valor) FILTER (WHERE c.fonte = 'diaria'), 0) AS custo_diarias,
           COALESCE(sum(c.valor) FILTER (WHERE c.fonte = 'registro'), 0) AS custo_registros
      FROM a LEFT JOIN LATERAL public.sst_afa_coberturas(a.id) c ON true
     GROUP BY a.id
  )
  SELECT COALESCE(jsonb_agg(
           to_jsonb(a) - 'chave_importacao' || jsonb_build_object(
             'dias_cobertos', cob.dias_cobertos, 'dias_rt', cob.dias_rt,
             'custo_cobertura', cob.custo_diarias + cob.custo_registros,
             'custo_diarias', cob.custo_diarias)
           || CASE WHEN v_fin THEN jsonb_build_object(
                'valor_mensal_posto', f.valor_mensal_posto, 'salario', f.salario,
                'custo_mensal_posto', f.custo_mensal_posto, 'lucro_mensal', f.lucro_mensal,
                'glosa_valor', f.glosa_valor) ELSE '{}'::jsonb END
           ORDER BY a.data_inicio DESC, a.nome), '[]'::jsonb)
    INTO v_out
    FROM a JOIN cob ON cob.id = a.id
    LEFT JOIN public."SST_AFASTAMENTO_FIN" f ON f.afastamento_id = a.id;
  RETURN jsonb_build_object('ve_financeiro', v_fin, 'itens', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_lista(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_lista(date, date) TO authenticated;

-- Ficha individual: tudo do afastamento num jsonb só.
CREATE OR REPLACE FUNCTION public.sst_afa_ficha(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  a      public."SST_AFASTAMENTO"%ROWTYPE;
  v_fin  boolean := public.sst_afa_ve_fin();
  v_fim  date;
  v_out  jsonb;
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  SELECT * INTO a FROM public."SST_AFASTAMENTO" WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_fim := CASE WHEN a.dias_considerados IS NULL THEN GREATEST(current_date, a.data_inicio)
                WHEN a.dias_considerados = 0 THEN a.data_inicio
                ELSE a.data_inicio + a.dias_considerados - 1 END;

  v_out := jsonb_build_object(
    'afastamento', to_jsonb(a) - 'chave_importacao',
    'data_fim', v_fim,
    've_financeiro', v_fin,
    'empregado', (SELECT jsonb_build_object('situacao', e."Situação", 'data_afastamento', e."Data Afastamento",
                                            'admissao', e."Admissão", 'telefone', e.telefone)
                    FROM public."EMPREGADOS" e WHERE e."ID" = a.empregado_id),
    'coberturas', COALESCE((SELECT jsonb_agg(jsonb_build_object('dia', c.dia, 'fonte', c.fonte, 'substituto', c.substituto,
                                                                 'eh_rt', c.eh_rt, 'valor', c.valor) ORDER BY c.dia, c.fonte)
                              FROM public.sst_afa_coberturas(p_id) c), '[]'::jsonb),
    'despesas', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.data, d.id) FROM public."SST_AFASTAMENTO_DESPESA" d
                           WHERE d.afastamento_id = p_id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at DESC) FROM public."SST_AFASTAMENTO_EVENTO" ev
                          WHERE ev.afastamento_id = p_id), '[]'::jsonb),
    'rt', jsonb_build_object(
      'quantidade', COALESCE(a.rt_no_contrato, 0),
      'colaboradores', COALESCE((
        SELECT jsonb_agg(DISTINCT btrim(e."Nome"))
          FROM public."RH_POSTO_COLABORADOR" x
          JOIN public."EMPREGADOS" e ON e."Empresa" = x.empresa AND e."Cadastro" = x.cadastro
         WHERE a.contrato_id IS NOT NULL AND x.contrato_id = a.contrato_id
           AND public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA'
           AND public.esp_col_esta_ativo(e."Situação")), '[]'::jsonb)),
    'historico_colaborador', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'protocolo', h.protocolo, 'data_inicio', h.data_inicio,
                                          'dias', h.dias_considerados, 'tele_status', h.tele_status) ORDER BY h.data_inicio DESC)
        FROM public."SST_AFASTAMENTO" h
       WHERE h.id <> a.id AND NOT h.cancelado
         AND ((a.empregado_id IS NOT NULL AND h.empregado_id = a.empregado_id)
              OR (a.empregado_id IS NULL AND public.rh_norm_nome(h.nome) = public.rh_norm_nome(a.nome)))), '[]'::jsonb));

  IF v_fin THEN
    v_out := v_out || jsonb_build_object(
      'financeiro', (SELECT to_jsonb(f) FROM public."SST_AFASTAMENTO_FIN" f WHERE f.afastamento_id = p_id),
      'notas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'competencia', n.competencia, 'numero_nf', n.numero_nf, 'status', n.status,
                 'bruto', n.vlr_bruto_total, 'liquido', n.vlr_liquido_total,
                 'faltas', (SELECT COALESCE(sum(i.faltas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id),
                 'glosas', (SELECT COALESCE(sum(i.glosas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id),
                 'outros_descontos', (SELECT COALESCE(sum(i.posto_nao_implementado + i.multas + i.outros_descontos), 0)
                                        FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id))
                 ORDER BY n.competencia)
          FROM public.nf_emissao n
         WHERE a.contrato_id IS NOT NULL AND n.contrato_id = a.contrato_id
           AND n.deleted_at IS NULL AND n.status::text NOT ILIKE 'cancel%'
           AND date_trunc('month', n.competencia) BETWEEN date_trunc('month', a.data_inicio) AND date_trunc('month', v_fim)),
        '[]'::jsonb));
  END IF;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_ficha(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_ficha(bigint) TO authenticated;

-- ── 7. Importação da planilha de telemedicina ───────────────────────────
-- Cada linha já vem interpretada pelo front (src/lib/sst/afastamentos.ts).
-- Casa o nome com EMPREGADOS (o Trabalhando, senão o de admissão mais
-- recente); sem cadastro, entra só com o nome (aparece como "sem cadastro").
-- Reimportar atualiza a linha (chave: nome normalizado + data do atestado).
CREATE OR REPLACE FUNCTION public.sst_afa_importar(p_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  r       jsonb;
  v_emp   bigint;
  v_id    bigint;
  v_chave text;
  v_novo  boolean;
  v_ins   int := 0;
  v_upd   int := 0;
  v_sem   jsonb := '[]'::jsonb;
  v_ini   date;
BEGIN
  PERFORM public.sst_afa_exige('alterar');
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_linhas, '[]'::jsonb)) LOOP
    v_ini := nullif(r->>'data_inicio', '')::date;
    IF v_ini IS NULL OR nullif(btrim(r->>'nome'), '') IS NULL THEN CONTINUE; END IF;
    v_chave := public.rh_norm_nome(r->>'nome') || '|' || v_ini::text;

    SELECT e."ID" INTO v_emp FROM public."EMPREGADOS" e
     WHERE public.rh_norm_nome(e."Nome") = public.rh_norm_nome(r->>'nome')
     ORDER BY (e."Situação" = 'Trabalhando') DESC, public.rh_data(e."Admissão"::text) DESC NULLS LAST, e."ID" DESC
     LIMIT 1;
    IF v_emp IS NULL THEN v_sem := v_sem || to_jsonb(btrim(r->>'nome')); END IF;

    INSERT INTO public."SST_AFASTAMENTO" AS x (
      empregado_id, nome, data_inicio, dias_atestado, origem, tele_status, tele_data, tele_horario,
      tele_resultado, dias_apos_tele, assinatura, ponto, retorno_status, encarregado_nome,
      contrato_planilha, situacao_planilha, observacao, tele_avaliacao, chave_importacao, created_by, created_by_nome)
    VALUES (
      v_emp, upper(btrim(r->>'nome')), v_ini, nullif(r->>'dias_atestado', '')::int, 'planilha',
      COALESCE(nullif(r->>'tele_status', ''), 'nao_avaliado'), nullif(r->>'tele_data', '')::date, nullif(r->>'tele_horario', ''),
      nullif(r->>'tele_resultado', ''), nullif(r->>'dias_apos_tele', '')::int, nullif(r->>'assinatura', ''), nullif(r->>'ponto', ''),
      COALESCE(nullif(r->>'retorno_status', ''), 'aguardando'), nullif(btrim(r->>'encarregado'), ''),
      nullif(btrim(r->>'contrato'), ''), nullif(btrim(r->>'situacao'), ''), nullif(btrim(r->>'observacao'), ''),
      nullif(btrim(r->>'avaliacao'), ''), v_chave, auth.uid(), public.sst_afa_nome_usuario())
    ON CONFLICT (chave_importacao) DO UPDATE SET
      empregado_id     = COALESCE(x.empregado_id, EXCLUDED.empregado_id),
      dias_atestado    = COALESCE(EXCLUDED.dias_atestado, x.dias_atestado),
      tele_status      = CASE WHEN EXCLUDED.tele_status = 'nao_avaliado' THEN x.tele_status ELSE EXCLUDED.tele_status END,
      tele_data        = COALESCE(EXCLUDED.tele_data, x.tele_data),
      tele_horario     = COALESCE(EXCLUDED.tele_horario, x.tele_horario),
      tele_resultado   = COALESCE(EXCLUDED.tele_resultado, x.tele_resultado),
      dias_apos_tele   = COALESCE(EXCLUDED.dias_apos_tele, x.dias_apos_tele),
      assinatura       = COALESCE(EXCLUDED.assinatura, x.assinatura),
      ponto            = COALESCE(EXCLUDED.ponto, x.ponto),
      retorno_status   = CASE WHEN EXCLUDED.retorno_status = 'aguardando' THEN x.retorno_status ELSE EXCLUDED.retorno_status END,
      encarregado_nome = COALESCE(EXCLUDED.encarregado_nome, x.encarregado_nome),
      contrato_planilha = COALESCE(EXCLUDED.contrato_planilha, x.contrato_planilha),
      situacao_planilha = COALESCE(EXCLUDED.situacao_planilha, x.situacao_planilha),
      observacao       = COALESCE(EXCLUDED.observacao, x.observacao)
    RETURNING x.id, (xmax = 0) INTO v_id, v_novo;

    IF v_novo THEN
      v_ins := v_ins + 1;
      PERFORM public.sst_afa_aplicar_lotacao(v_id);
      PERFORM public.sst_afa_evento(v_id, 'importado', 'Importado da planilha de telemedicina' || COALESCE(' (' || nullif(r->>'aba', '') || ')', '') || '.');
    ELSE
      v_upd := v_upd + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd,
                            'sem_cadastro', (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(v_sem) x));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_importar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_importar(jsonb) TO authenticated;

-- ── 8. Captura automática pela Senior ────────────────────────────────────
-- Quem está em situação de atestado / doença / acidente com Data Afastamento
-- vira afastamento (um por pessoa e data de início). Quem tinha afastamento
-- aguardando retorno e voltou a "Trabalhando" é marcado como retornou; quem
-- foi demitido, como desligado.
CREATE OR REPLACE FUNCTION public.sst_afa_capturar_senior()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_novos  int := 0;
  v_ret    int := 0;
  v_desl   int := 0;
  r        record;
  v_id     bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.sst_afa_exige('alterar'); END IF;

  FOR r IN
    SELECT e."ID" AS emp, btrim(e."Nome") AS nome, e."CPF" AS cpf, e."Situação" AS sit,
           public.rh_data(e."Data Afastamento"::text) AS ini
      FROM public."EMPREGADOS" e
     WHERE e."Situação" ~* '(ATEST|DOEN|ACIDENT)'
       AND public.rh_data(e."Data Afastamento"::text) IS NOT NULL
       AND public.rh_data(e."Data Afastamento"::text) >= current_date - 120
       AND NOT EXISTS (
         SELECT 1 FROM public."SST_AFASTAMENTO" x
          WHERE (x.empregado_id = e."ID"
                 OR (x.empregado_id IS NULL AND public.rh_norm_nome(x.nome) = public.rh_norm_nome(e."Nome")))
            AND x.data_inicio BETWEEN public.rh_data(e."Data Afastamento"::text) - 3
                                  AND public.rh_data(e."Data Afastamento"::text) + 3)
  LOOP
    INSERT INTO public."SST_AFASTAMENTO" (empregado_id, nome, cpf, data_inicio, origem, situacao_senior, tipo, created_by_nome)
    VALUES (r.emp, r.nome, r.cpf, r.ini, 'senior', r.sit,
            CASE WHEN r.sit ~* 'ACIDENT' THEN 'acidente_trabalho'
                 WHEN r.sit ~* 'AUX' THEN 'auxilio_doenca'
                 WHEN r.sit ~* '(FILHO|ACOMP)' THEN 'atestado_acompanhante'
                 ELSE 'atestado' END,
            'Senior (automático)')
    RETURNING id INTO v_id;
    PERFORM public.sst_afa_aplicar_lotacao(v_id);
    INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
    VALUES (v_id, 'criado', 'Capturado da Senior: situação "' || r.sit || '" desde ' || to_char(r.ini, 'DD/MM/YYYY') || '.', 'Senior (automático)');
    v_novos := v_novos + 1;
  END LOOP;

  -- Retorno: voltou a trabalhar depois do início do afastamento.
  FOR r IN
    SELECT x.id, x.data_inicio, x.dias_considerados, e."Situação" AS sit, public.rh_data(e."Data Afastamento"::text) AS dafa
      FROM public."SST_AFASTAMENTO" x
      JOIN public."EMPREGADOS" e ON e."ID" = x.empregado_id
     WHERE x.retorno_status = 'aguardando' AND NOT x.cancelado
       AND x.data_inicio <= current_date - 1
       AND (e."Situação" = 'Trabalhando' OR e."Situação" ~* '^(DEMIT|DESLIG|RESCIS)')
  LOOP
    IF r.sit = 'Trabalhando' THEN
      UPDATE public."SST_AFASTAMENTO" SET retorno_status = 'retornou',
             retornou_em = CASE WHEN r.dias_considerados IS NOT NULL
                                THEN LEAST(r.data_inicio + r.dias_considerados, current_date) ELSE current_date END
       WHERE id = r.id;
      INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
      VALUES (r.id, 'retorno', 'Situação na Senior voltou a "Trabalhando".', 'Senior (automático)');
      v_ret := v_ret + 1;
    ELSIF r.dafa IS NULL OR r.dafa >= r.data_inicio THEN
      UPDATE public."SST_AFASTAMENTO" SET retorno_status = 'desligado', retornou_em = r.dafa WHERE id = r.id;
      INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
      VALUES (r.id, 'retorno', 'Colaborador desligado na Senior (' || r.sit || ').', 'Senior (automático)');
      v_desl := v_desl + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('novos', v_novos, 'retornos', v_ret, 'desligados', v_desl);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_capturar_senior() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_capturar_senior() TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - captura automática não agendada (esperado na réplica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sst-afastamentos-senior') THEN
    PERFORM cron.unschedule('sst-afastamentos-senior');
  END IF;
  -- Logo depois do sync da Senior (5,20,35,50): de hora em hora basta.
  PERFORM cron.schedule('sst-afastamentos-senior', '25 * * * *', 'SELECT public.sst_afa_capturar_senior()');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('sst-afastamentos-senior');
-- DROP FUNCTION IF EXISTS public.sst_afa_capturar_senior(), public.sst_afa_importar(jsonb),
--   public.sst_afa_ficha(bigint), public.sst_afa_lista(date, date), public.sst_afa_coberturas(bigint),
--   public.sst_afa_glosa_salvar(bigint, numeric, text), public.sst_afa_despesa_remover(bigint),
--   public.sst_afa_despesa_salvar(jsonb), public.sst_afa_recalcular_lotacao(bigint), public.sst_afa_salvar(jsonb),
--   public.sst_afa_evento(bigint, text, text), public.sst_afa_lotacao(bigint, date), public.sst_afa_colaboradores(text),
--   public.sst_afa_aplicar_lotacao(bigint), public.sst_afa_lotacao_calc(bigint, date), public.sst_afa_protocolo(),
--   public.sst_afa_nome_usuario(), public.sst_afa_exige(text), public.sst_afa_ve_fin(), public.sst_afa_pode(text);
-- DROP TABLE IF EXISTS public."SST_AFASTAMENTO_EVENTO", public."SST_AFASTAMENTO_DESPESA",
--   public."SST_AFASTAMENTO_FIN", public."SST_AFASTAMENTO";
-- DROP SEQUENCE IF EXISTS public.sst_afastamento_protocolo_seq;
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_afastamentos';
-- DELETE FROM public.app_menu WHERE codigo IN ('sst_afastamentos', 'sst_afastamentos_financeiro');
