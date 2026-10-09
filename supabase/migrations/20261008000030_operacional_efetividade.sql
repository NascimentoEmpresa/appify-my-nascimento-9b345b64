-- =========================================================================
-- OPERACIONAL › EFETIVIDADE E COBERTURAS — quem foi trabalhar e quem faltou,
-- pelo relógio de ponto da Senior, e o acionamento de diaristas/substitutos
-- para cobrir o posto.                        [branch LOCAL efetividade]
--
-- PEDIDO (Pablo, 08/10/2026)
--   "Sistema de efetividade/falta, integrado aos pontos da Senior, pra
--    mostrar quantas pessoas estão indo trabalhar e quantas estão faltando
--    pelos pontos, assim o operacional consegue identificar mais rápido pra
--    pegar diaristas." 5 telas: Painel do Dia, Controle de Postos,
--    Detalhamento do Posto, Faltas e Coberturas, Histórico e Indicadores.
--
-- DE ONDE VEM CADA NÚMERO (medido em 08/10/2026)
--   Contrato  = filial da Senior: (EMPREGADOS."Empresa", EMPREGADOS."Filial"),
--               nome em "Nome Filial" ("1037 - BENTO GONÇALVES - LIMPEZA").
--               A chave é o PAR — a filial 1097 existe na Nascimento (SAMU)
--               e na NH (Guaporé).
--   Posto     = o efetivo da Hierarquia de Postos (ajuste do ERP em
--               RH_POSTO_OCUPANTE_ERP, senão EMPREGADOS."Posto"), descrição
--               de RH_POSTO_TRABALHO; sem código, "Nome do Posto".
--   Encarregado = rh_hier_responsaveis() (mig 20261008000005): o líder
--               ocupado mais próximo acima dos postos do contrato.
--   Presença  = batida em espelho."BiMarcacoes" (minuto do dia; 420 = 07:00)
--               casada por (empresa, matricula % 1e8) = (Empresa, Cadastro),
--               mesma regra de gp_mes / esp_col_marcacoes.
--   Afastado  = EMPREGADOS."Situação" ≠ Trabalhando a partir de
--               "Data Afastamento" (Férias, Atestado, Auxílio Doença,
--               Licença...). Só há a situação ATUAL — o histórico de quem já
--               voltou aparece como dia normal.
--   Previsto  = a escala (ESCALAS + texto da escala) interpretada no front
--               (src/lib/efetividade.ts, com teste), igual à Gestão de Ponto.
--
-- LIMITE QUE A TELA MOSTRA, NÃO ESCONDE
--   O espelho da Senior é carregado 1x por dia (espelho-mysql, TRUNCATE +
--   COPY). O dia de hoje NÃO tem batida até a próxima carga — o Painel do Dia
--   abre no último dia sincronizado e, para hoje, mostra "aguardando ponto"
--   em vez de chamar todo mundo de faltoso. A falta de hoje entra pelo
--   registro manual (encarregado avisou) na tela Faltas e Coberturas.
--
-- O QUE ESTA MIGRATION FAZ (tudo ADITIVO — nada existente muda)
--   1. Menu ope_efetividade (/app/operacional/efetividade e sub-rotas, por
--      prefixo), ação alterar (acionar/atualizar coberturas). Nasce FECHADO:
--      sem permissão para ninguém — liberar em Acesso por Usuário (o toggle
--      já concede visualizar + alterar).
--   2. OPE_EFET_OCORRENCIA (uma falta/ausência a cobrir) + OPE_EFET_EVENTO
--      (linha do tempo da cobertura).
--   3. OPE_EFET_DIARISTA (banco de diaristas; semeado com quem já recebeu
--      diária em DIARIA_SOLICITACAO).
--   4. OPE_EFET_POSTO_OBS (observações do posto).
--   5. RPCs: ope_efet_base (contratos + colaboradores + batidas do período),
--      ope_efet_registrar, ope_efet_acionar, ope_efet_status,
--      ope_efet_diarista_salvar, ope_efet_diaristas, ope_efet_obs_adicionar,
--      ope_efet_obs_remover.
--   Escrita só pelas RPCs (SECURITY DEFINER, exigem alterar); leitura das
--   tabelas pela RLS com visualizar. Sem filtro de empresa (J1.E).
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- Depende de: 20261007000001 (índice em BiMarcacoes), 20261008000005
-- (rh_hier_responsaveis), 20260930000229 (data_universal).
-- =========================================================================

-- ── 1. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'ope_efetividade', 'Efetividade e Coberturas', '/app/operacional/efetividade', 2, true
  FROM public.app_modulo m WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('ope_efetividade', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- O índice da Gestão de Ponto (20261007000001) — repetido aqui porque esta
-- migration pode ser aplicada antes daquela (branches locais separadas).
CREATE INDEX IF NOT EXISTS idx_bimarcacoes_emp_mat_data
  ON espelho."BiMarcacoes" (empresa, (matricula % 100000000), data_hora);

CREATE OR REPLACE FUNCTION public.ope_efet_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'ope_efetividade', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.ope_efet_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ope_efet_exige(_acao text DEFAULT 'visualizar')
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.ope_efet_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) à Efetividade e Coberturas', _acao USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.ope_efet_exige(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_exige(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ope_efet_nome_usuario()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário')
    FROM public.profiles p WHERE p.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.ope_efet_nome_usuario() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_nome_usuario() TO authenticated;

-- ── 2. Ocorrências (faltas a cobrir) e a linha do tempo ─────────────────
CREATE TABLE IF NOT EXISTS public."OPE_EFET_OCORRENCIA" (
  id                       bigserial PRIMARY KEY,
  data                     date NOT NULL,
  empresa                  bigint,
  filial                   bigint,
  contrato                 text,
  posto_codigo             text,
  posto_nome               text,
  turno                    text,
  horario_previsto         integer,                 -- minuto do dia da entrada prevista
  empregado_id             bigint,                  -- EMPREGADOS."ID" do faltante (sem FK: a carga apaga linhas)
  empregado_nome           text,
  motivo                   text NOT NULL DEFAULT 'falta',
  origem                   text NOT NULL DEFAULT 'ponto',
  substituto_tipo          text,
  substituto_empregado_id  bigint,
  substituto_diarista_id   bigint,
  substituto_nome          text,
  substituto_telefone      text,
  status                   text NOT NULL DEFAULT 'sem_cobertura',
  acionado_em              timestamptz,
  aceito_em                timestamptz,
  deslocamento_em          timestamptz,
  chegada_em               timestamptz,             -- no posto (aguardando o ponto)
  ponto_em                 timestamptz,
  encerrado_em             timestamptz,
  acionado_por             uuid,
  acionado_por_nome        text,
  observacao               text,
  created_by               uuid,
  created_by_nome          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ope_efet_oc_motivo CHECK (motivo IN ('falta', 'atestado', 'afastamento', 'ferias', 'folga', 'outros')),
  CONSTRAINT ope_efet_oc_origem CHECK (origem IN ('ponto', 'manual')),
  CONSTRAINT ope_efet_oc_subst  CHECK (substituto_tipo IS NULL OR substituto_tipo IN ('diarista', 'colaborador')),
  CONSTRAINT ope_efet_oc_status CHECK (status IN (
    'sem_cobertura', 'acionado', 'aceita', 'em_deslocamento', 'aguardando_ponto',
    'ponto_confirmado', 'nao_realizada', 'nao_se_aplica', 'cancelada'))
);
-- Uma ocorrência por colaborador por dia (a falta detectada e a registrada à
-- mão não podem virar duas coberturas).
ALTER TABLE public."OPE_EFET_OCORRENCIA" ADD COLUMN IF NOT EXISTS chegada_em timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ope_efet_oc_dia_empregado
  ON public."OPE_EFET_OCORRENCIA" (data, empregado_id) WHERE empregado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ope_efet_oc_data ON public."OPE_EFET_OCORRENCIA" (data);
CREATE INDEX IF NOT EXISTS idx_ope_efet_oc_contrato ON public."OPE_EFET_OCORRENCIA" (empresa, filial, data);

CREATE TABLE IF NOT EXISTS public."OPE_EFET_EVENTO" (
  id             bigserial PRIMARY KEY,
  ocorrencia_id  bigint NOT NULL REFERENCES public."OPE_EFET_OCORRENCIA"(id) ON DELETE CASCADE,
  tipo           text NOT NULL,                     -- status novo, ou 'registro' / 'observacao' / 'troca'
  descricao      text,
  autor_id       uuid,
  autor_nome     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ope_efet_ev_oc ON public."OPE_EFET_EVENTO" (ocorrencia_id, created_at);

-- ── 3. Banco de diaristas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OPE_EFET_DIARISTA" (
  id          bigserial PRIMARY KEY,
  nome        text NOT NULL,
  cpf         text,                                  -- só dígitos
  telefone    text,
  cidade      text,
  regioes     text,                                  -- contratos/cidades onde aceita trabalhar (texto livre)
  disponivel  boolean NOT NULL DEFAULT true,
  ativo       boolean NOT NULL DEFAULT true,
  observacao  text,
  origem      text NOT NULL DEFAULT 'manual',        -- 'manual' | 'diarias'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ope_efet_diarista_cpf
  ON public."OPE_EFET_DIARISTA" (cpf) WHERE cpf IS NOT NULL AND cpf <> '';

-- Semente: quem já recebeu diária (65 CPFs em 08/10/2026). Nome do pedido
-- mais recente. Telefone não existe lá — o Operacional completa.
INSERT INTO public."OPE_EFET_DIARISTA" (nome, cpf, origem)
SELECT DISTINCT ON (regexp_replace(d.diarista_cpf, '\D', '', 'g'))
       btrim(d.diarista_nome), regexp_replace(d.diarista_cpf, '\D', '', 'g'), 'diarias'
  FROM public."DIARIA_SOLICITACAO" d
 WHERE coalesce(btrim(d.diarista_nome), '') <> ''
   AND length(regexp_replace(coalesce(d.diarista_cpf, ''), '\D', '', 'g')) = 11
   AND coalesce(d.status, '') <> 'excluida'
 ORDER BY regexp_replace(d.diarista_cpf, '\D', '', 'g'), d.created_at DESC
ON CONFLICT DO NOTHING;

-- ── 4. Observações do posto ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OPE_EFET_POSTO_OBS" (
  id          bigserial PRIMARY KEY,
  empresa     bigint,
  filial      bigint,
  posto       text NOT NULL,                         -- código do posto (PO-…) ou o nome, quando não há código
  texto       text NOT NULL,
  autor_id    uuid,
  autor_nome  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ope_efet_obs_posto ON public."OPE_EFET_POSTO_OBS" (posto, created_at DESC);

-- ── RLS: leitura com visualizar; escrita só pelas RPCs ───────────────────
ALTER TABLE public."OPE_EFET_OCORRENCIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OPE_EFET_EVENTO"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OPE_EFET_DIARISTA"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OPE_EFET_POSTO_OBS"  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."OPE_EFET_OCORRENCIA", public."OPE_EFET_EVENTO",
              public."OPE_EFET_DIARISTA", public."OPE_EFET_POSTO_OBS" FROM PUBLIC, anon;
GRANT SELECT ON public."OPE_EFET_OCORRENCIA", public."OPE_EFET_EVENTO",
                public."OPE_EFET_DIARISTA", public."OPE_EFET_POSTO_OBS" TO authenticated;

DROP POLICY IF EXISTS ope_efet_oc_sel ON public."OPE_EFET_OCORRENCIA";
CREATE POLICY ope_efet_oc_sel ON public."OPE_EFET_OCORRENCIA" FOR SELECT TO authenticated USING (public.ope_efet_pode());
DROP POLICY IF EXISTS ope_efet_ev_sel ON public."OPE_EFET_EVENTO";
CREATE POLICY ope_efet_ev_sel ON public."OPE_EFET_EVENTO" FOR SELECT TO authenticated USING (public.ope_efet_pode());
DROP POLICY IF EXISTS ope_efet_dia_sel ON public."OPE_EFET_DIARISTA";
CREATE POLICY ope_efet_dia_sel ON public."OPE_EFET_DIARISTA" FOR SELECT TO authenticated USING (public.ope_efet_pode());
DROP POLICY IF EXISTS ope_efet_obs_sel ON public."OPE_EFET_POSTO_OBS";
CREATE POLICY ope_efet_obs_sel ON public."OPE_EFET_POSTO_OBS" FOR SELECT TO authenticated USING (public.ope_efet_pode());

-- ── 5. RPC base: contratos + colaboradores + batidas do período ─────────
-- p_ini..p_fim (até 62 dias). As batidas vêm de p_ini − 14 (o ciclo do
-- 12x36 sai da paridade dos dias trabalhados recentes) até p_fim + 1 (a
-- saída do noturno cai no dia seguinte). Por colaborador: [dia, [minutos]].
-- Sem CPF, sem salário: nome, cargo, matrícula, posto, escala e telefone de
-- contato (o Operacional liga para quem faltou).
CREATE OR REPLACE FUNCTION public.ope_efet_base(
  p_ini date, p_fim date, p_empresa bigint DEFAULT NULL, p_filial bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_col jsonb; v_contr jsonb; v_sinc date; v_ultima timestamptz;
BEGIN
  PERFORM public.ope_efet_exige('visualizar');
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  IF p_fim - p_ini > 62 THEN RAISE EXCEPTION 'Período máximo: 62 dias.'; END IF;

  -- Contratos com gente ativa + encarregado(s) pela Hierarquia.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'empresa', c.empresa, 'filial', c.filial, 'nome', c.nome, 'empresa_nome', c.empresa_nome,
           'ativos', c.ativos, 'endereco', k.endereco, 'cep', k.cep, 'encarregados', coalesce(r.nomes, '[]'::jsonb)) ORDER BY c.nome), '[]'::jsonb)
    INTO v_contr
    FROM (
      SELECT e."Empresa" AS empresa, e."Filial" AS filial, min(e."Nome Filial") AS nome,
             min(e."Nome da Empresa") AS empresa_nome, count(*)::int AS ativos
        FROM public."EMPREGADOS" e
       WHERE public.esp_col_esta_ativo(e."Situação")
         AND coalesce(btrim(e."Nome Filial"), '') <> '' AND e."Empresa" IS NOT NULL AND e."Filial" IS NOT NULL
       GROUP BY e."Empresa", e."Filial"
    ) c
    -- rh_hier_responsaveis() é recursiva: roda UMA vez, não uma por contrato.
    LEFT JOIN (
      SELECT h.empresa, h.filial,
             jsonb_agg(DISTINCT jsonb_build_object('id', x."ID", 'nome', x."Nome",
                                                   'telefone', coalesce(x.celular_whatsapp, x.telefone))) AS nomes
        FROM public.rh_hier_responsaveis() h
        JOIN public."EMPREGADOS" x ON x."ID" = h.empregado_id
       GROUP BY h.empresa, h.filial
    ) r ON r.empresa = c.empresa AND r.filial = c.filial
    LEFT JOIN LATERAL (
      SELECT nullif(btrim(x."Endereço"), '') AS endereco, nullif(btrim(x."CEP"), '') AS cep
        FROM public."CONTRATOS" x
       WHERE x."Empresa" = c.empresa AND x."Filial" = c.filial
       ORDER BY (x."ATIVO" = 'SIM') DESC NULLS LAST, x.id DESC
       LIMIT 1
    ) k ON true;

  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'motivo', 'O espelho de marcações da Senior não está no banco.',
                              'contratos', v_contr, 'colaboradores', '[]'::jsonb);
  END IF;

  v_sinc := public.diaria_ponto_sincronizado_ate();
  BEGIN
    EXECUTE 'SELECT max(terminada_em) FROM espelho.sincronizacoes WHERE ok' INTO v_ultima;
  EXCEPTION WHEN OTHERS THEN v_ultima := NULL;
  END;

  EXECUTE $q$
    WITH col AS (
      SELECT e."ID" AS id, e."Empresa" AS empresa, e."Filial" AS filial, e."Nome Filial" AS contrato,
             e."Cadastro" AS cadastro, e."Nome" AS nome, e."Título do Cargo" AS cargo, e."Situação" AS situacao,
             public.data_universal(e."Admissão"::text) AS admissao,
             public.data_universal(e."Data Afastamento"::text) AS data_afastamento,
             CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE e."Posto" END AS posto_codigo,
             e."Nome do Posto" AS posto_senior,
             coalesce(e.celular_whatsapp, e.telefone) AS telefone,
             e."Escala" AS escala_txt,
             CASE WHEN btrim(coalesce(e."Escala_1"::text, '')) ~ '^\d+$' THEN btrim(e."Escala_1"::text)::bigint END AS escala_cod,
             CASE WHEN btrim(e."Cadastro"::text) ~ '^\d+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad_num,
             CASE WHEN btrim(e."Empresa"::text) ~ '^\d+$' THEN btrim(e."Empresa"::text)::int END AS emp_num
        FROM public."EMPREGADOS" e
        LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = e."ID"
       WHERE coalesce(btrim(e."Nome"), '') <> ''
         AND coalesce(btrim(e."Nome Filial"), '') <> ''
         AND ($1::bigint IS NULL OR e."Empresa" = $1)
         AND ($2::bigint IS NULL OR e."Filial" = $2)
         AND (public.esp_col_esta_ativo(e."Situação")
              OR public.data_universal(e."Data Afastamento"::text) >= $3::date)
    ),
    bat AS (
      SELECT c.id, m.data_hora::date AS dia, m.hora
        FROM col c
        JOIN espelho."BiMarcacoes" m
          ON m.empresa = c.emp_num
         AND (m.matricula % 100000000) = c.cad_num
         AND m.data_hora >= ($3::date - 14) AND m.data_hora < ($4::date + 2)
       WHERE c.cad_num IS NOT NULL AND c.emp_num IS NOT NULL
       GROUP BY c.id, m.data_hora::date, m.hora          -- o relógio repete batida
    ),
    bd AS (SELECT id, dia, array_agg(hora ORDER BY hora) AS mins FROM bat GROUP BY id, dia),
    bj AS (SELECT id, jsonb_agg(jsonb_build_array(dia, mins) ORDER BY dia) AS dias FROM bd GROUP BY id)
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'empresa', c.empresa, 'filial', c.filial, 'contrato', c.contrato,
             'cadastro', c.cadastro, 'nome', c.nome, 'cargo', c.cargo, 'situacao', c.situacao,
             'admissao', c.admissao, 'data_afastamento', c.data_afastamento,
             'posto_codigo', c.posto_codigo,
             'posto_nome', coalesce(nullif(btrim(pt.descricao), ''), nullif(btrim(c.posto_senior), ''), 'Sem posto'),
             'telefone', c.telefone,
             'escala', jsonb_build_object(
               'codigo', c.escala_cod,
               'descricao', coalesce(es."Descricao", c.escala_txt),
               'h_semana', es."H.Semana", 'h_mes', es."H.Ms", 'h_dsr', es."H.DSR"),
             'dias', coalesce(bj.dias, '[]'::jsonb))
             ORDER BY c.nome), '[]'::jsonb)
      FROM col c
      LEFT JOIN public."ESCALAS" es ON es."Escala" = c.escala_cod
      LEFT JOIN public."RH_POSTO_TRABALHO" pt ON pt.codigo = c.posto_codigo
      LEFT JOIN bj ON bj.id = c.id
  $q$
  INTO v_col
  USING p_empresa, p_filial, p_ini, p_fim;

  RETURN jsonb_build_object(
    'disponivel', true,
    'inicio', p_ini, 'fim', p_fim,
    'sincronizado_ate', v_sinc,
    'ultima_sincronizacao', v_ultima,
    'gerado_em', now(),
    'contratos', v_contr,
    'colaboradores', v_col);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_base(date, date, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_base(date, date, bigint, bigint) TO authenticated;

-- ── 6. Registrar a ocorrência (falta detectada pelo ponto ou avisada) ────
-- Idempotente por (data, empregado): registrar de novo devolve a mesma.
CREATE OR REPLACE FUNCTION public.ope_efet_registrar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := public.ope_efet_exige('alterar');
  v_nome text := public.ope_efet_nome_usuario();
  v_id bigint; v_emp bigint := nullif(p->>'empregado_id', '')::bigint;
  v_data date := (p->>'data')::date;
BEGIN
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data.'; END IF;
  IF v_emp IS NOT NULL THEN
    SELECT id INTO v_id FROM public."OPE_EFET_OCORRENCIA" WHERE data = v_data AND empregado_id = v_emp;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  ELSIF coalesce(btrim(p->>'empregado_nome'), '') = '' AND coalesce(btrim(p->>'posto_nome'), '') = '' THEN
    RAISE EXCEPTION 'Informe o colaborador ou o posto.';
  END IF;

  INSERT INTO public."OPE_EFET_OCORRENCIA" (
    data, empresa, filial, contrato, posto_codigo, posto_nome, turno, horario_previsto,
    empregado_id, empregado_nome, motivo, origem, status, observacao, created_by, created_by_nome)
  VALUES (
    v_data, nullif(p->>'empresa', '')::bigint, nullif(p->>'filial', '')::bigint, p->>'contrato',
    p->>'posto_codigo', p->>'posto_nome', p->>'turno', nullif(p->>'horario_previsto', '')::int,
    v_emp, p->>'empregado_nome', coalesce(nullif(p->>'motivo', ''), 'falta'),
    coalesce(nullif(p->>'origem', ''), 'manual'),
    CASE WHEN coalesce(p->>'motivo', 'falta') IN ('ferias', 'folga') THEN 'nao_se_aplica' ELSE 'sem_cobertura' END,
    nullif(btrim(p->>'observacao'), ''), v_uid, v_nome)
  RETURNING id INTO v_id;

  INSERT INTO public."OPE_EFET_EVENTO" (ocorrencia_id, tipo, descricao, autor_id, autor_nome)
  VALUES (v_id, 'registro',
          CASE WHEN coalesce(p->>'origem', 'manual') = 'ponto'
               THEN coalesce(p->>'empregado_nome', 'Colaborador') || ' sem batida de ponto no dia.'
               ELSE 'Ausência registrada: ' || coalesce(p->>'empregado_nome', p->>'posto_nome', '') END
          || coalesce(' ' || nullif(btrim(p->>'observacao'), ''), ''),
          v_uid, v_nome);
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_registrar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_registrar(jsonb) TO authenticated;

-- ── 7. Acionar substituto (diarista ou colaborador remanejado) ───────────
CREATE OR REPLACE FUNCTION public.ope_efet_acionar(
  p_id bigint, p_tipo text, p_empregado_id bigint DEFAULT NULL, p_diarista_id bigint DEFAULT NULL,
  p_nome text DEFAULT NULL, p_telefone text DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := public.ope_efet_exige('alterar');
  v_nome text := public.ope_efet_nome_usuario();
  v_sub text := nullif(btrim(p_nome), ''); v_tel text := nullif(btrim(p_telefone), '');
  v_ant text;
BEGIN
  IF p_tipo NOT IN ('diarista', 'colaborador') THEN RAISE EXCEPTION 'Tipo de substituto inválido.'; END IF;
  IF p_tipo = 'diarista' AND p_diarista_id IS NOT NULL THEN
    SELECT coalesce(v_sub, d.nome), coalesce(v_tel, d.telefone) INTO v_sub, v_tel
      FROM public."OPE_EFET_DIARISTA" d WHERE d.id = p_diarista_id;
  ELSIF p_tipo = 'colaborador' AND p_empregado_id IS NOT NULL THEN
    SELECT coalesce(v_sub, e."Nome"), coalesce(v_tel, e.celular_whatsapp, e.telefone) INTO v_sub, v_tel
      FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;
  END IF;
  IF v_sub IS NULL THEN RAISE EXCEPTION 'Escolha o substituto.'; END IF;

  SELECT substituto_nome INTO v_ant FROM public."OPE_EFET_OCORRENCIA" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada.'; END IF;

  UPDATE public."OPE_EFET_OCORRENCIA"
     SET substituto_tipo = p_tipo,
         substituto_empregado_id = CASE WHEN p_tipo = 'colaborador' THEN p_empregado_id END,
         substituto_diarista_id  = CASE WHEN p_tipo = 'diarista' THEN p_diarista_id END,
         substituto_nome = v_sub, substituto_telefone = v_tel,
         status = 'acionado', acionado_em = now(), aceito_em = NULL, deslocamento_em = NULL,
         chegada_em = NULL, ponto_em = NULL, encerrado_em = NULL,
         acionado_por = v_uid, acionado_por_nome = v_nome, updated_at = now()
   WHERE id = p_id;

  INSERT INTO public."OPE_EFET_EVENTO" (ocorrencia_id, tipo, descricao, autor_id, autor_nome)
  VALUES (p_id, CASE WHEN v_ant IS NULL THEN 'acionado' ELSE 'troca' END,
          CASE WHEN v_ant IS NULL THEN '' ELSE 'Substituto trocado (era ' || v_ant || '). ' END
          || v_sub || CASE WHEN p_tipo = 'diarista' THEN ' (diarista)' ELSE ' (colaborador)' END
          || ' foi acionado por ' || v_nome || '.' || coalesce(' ' || nullif(btrim(p_observacao), ''), ''),
          v_uid, v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_acionar(bigint, text, bigint, bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_acionar(bigint, text, bigint, bigint, text, text, text) TO authenticated;

-- ── 8. Andamento da cobertura ────────────────────────────────────────────
-- O Operacional move livremente (a realidade não segue fluxo): cada status
-- carimba a sua hora na primeira vez e entra na linha do tempo.
-- 'sem_cobertura' = desfazer o acionamento (substituto desistiu).
CREATE OR REPLACE FUNCTION public.ope_efet_status(p_id bigint, p_status text, p_observacao text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := public.ope_efet_exige('alterar');
  v_nome text := public.ope_efet_nome_usuario();
  v_oc public."OPE_EFET_OCORRENCIA"%ROWTYPE;
  v_desc text;
BEGIN
  IF p_status NOT IN ('sem_cobertura', 'acionado', 'aceita', 'em_deslocamento', 'aguardando_ponto',
                      'ponto_confirmado', 'nao_realizada', 'nao_se_aplica', 'cancelada') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;
  SELECT * INTO v_oc FROM public."OPE_EFET_OCORRENCIA" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada.'; END IF;
  IF p_status IN ('acionado', 'aceita', 'em_deslocamento', 'aguardando_ponto', 'ponto_confirmado')
     AND v_oc.substituto_nome IS NULL THEN
    RAISE EXCEPTION 'Acione um substituto antes.';
  END IF;

  UPDATE public."OPE_EFET_OCORRENCIA" SET
    status = p_status,
    aceito_em       = CASE WHEN p_status IN ('aceita', 'em_deslocamento', 'aguardando_ponto', 'ponto_confirmado')
                           THEN coalesce(aceito_em, now()) ELSE aceito_em END,
    deslocamento_em = CASE WHEN p_status IN ('em_deslocamento', 'aguardando_ponto', 'ponto_confirmado')
                           THEN coalesce(deslocamento_em, now()) ELSE deslocamento_em END,
    chegada_em      = CASE WHEN p_status IN ('aguardando_ponto', 'ponto_confirmado')
                           THEN coalesce(chegada_em, now()) ELSE chegada_em END,
    ponto_em        = CASE WHEN p_status = 'ponto_confirmado' THEN coalesce(ponto_em, now()) ELSE ponto_em END,
    encerrado_em    = CASE WHEN p_status IN ('ponto_confirmado', 'nao_realizada', 'nao_se_aplica', 'cancelada')
                           THEN now() ELSE NULL END,
    substituto_tipo = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE substituto_tipo END,
    substituto_nome = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE substituto_nome END,
    substituto_telefone = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE substituto_telefone END,
    substituto_empregado_id = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE substituto_empregado_id END,
    substituto_diarista_id  = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE substituto_diarista_id END,
    acionado_em = CASE WHEN p_status = 'sem_cobertura' THEN NULL ELSE acionado_em END,
    updated_at = now()
  WHERE id = p_id;

  v_desc := CASE p_status
    WHEN 'aceita'           THEN coalesce(v_oc.substituto_nome, 'Substituto') || ' confirmou a cobertura.'
    WHEN 'em_deslocamento'  THEN coalesce(v_oc.substituto_nome, 'Substituto') || ' a caminho do posto.'
    WHEN 'aguardando_ponto' THEN 'No posto — aguardando o registro do ponto.'
    WHEN 'ponto_confirmado' THEN coalesce(v_oc.substituto_nome, 'Substituto') || ' registrou o ponto. Posto coberto.'
    WHEN 'nao_realizada'    THEN 'Cobertura não realizada.'
    WHEN 'nao_se_aplica'    THEN 'Marcada como sem necessidade de cobertura.'
    WHEN 'cancelada'        THEN 'Ocorrência cancelada.'
    WHEN 'sem_cobertura'    THEN 'Acionamento desfeito' || coalesce(' (' || v_oc.substituto_nome || ')', '') || ' — posto volta a ficar sem cobertura.'
    WHEN 'acionado'         THEN coalesce(v_oc.substituto_nome, 'Substituto') || ' acionado.'
  END || coalesce(' ' || nullif(btrim(p_observacao), ''), '');

  INSERT INTO public."OPE_EFET_EVENTO" (ocorrencia_id, tipo, descricao, autor_id, autor_nome)
  VALUES (p_id, p_status, v_desc, v_uid, v_nome);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_status(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_status(bigint, text, text) TO authenticated;

-- ── 9. Diaristas ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_efet_diarista_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_cpf text := nullif(regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'), '');
BEGIN
  PERFORM public.ope_efet_exige('alterar');
  IF coalesce(btrim(p->>'nome'), '') = '' THEN RAISE EXCEPTION 'Informe o nome da diarista.'; END IF;
  IF v_cpf IS NOT NULL AND length(v_cpf) <> 11 THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."OPE_EFET_DIARISTA" (nome, cpf, telefone, cidade, regioes, disponivel, observacao)
    VALUES (btrim(p->>'nome'), v_cpf, nullif(btrim(p->>'telefone'), ''), nullif(btrim(p->>'cidade'), ''),
            nullif(btrim(p->>'regioes'), ''), coalesce((p->>'disponivel')::boolean, true), nullif(btrim(p->>'observacao'), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."OPE_EFET_DIARISTA" SET
      nome = btrim(p->>'nome'), cpf = v_cpf, telefone = nullif(btrim(p->>'telefone'), ''),
      cidade = nullif(btrim(p->>'cidade'), ''), regioes = nullif(btrim(p->>'regioes'), ''),
      disponivel = coalesce((p->>'disponivel')::boolean, disponivel),
      ativo = coalesce((p->>'ativo')::boolean, ativo),
      observacao = nullif(btrim(p->>'observacao'), ''), updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Diarista não encontrada.'; END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_diarista_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_diarista_salvar(jsonb) TO authenticated;

-- Diaristas + o histórico delas: coberturas nesta tela e diárias pagas
-- (DIARIA_SOLICITACAO, pelo CPF). "Acionada hoje" = tem cobertura aberta.
CREATE OR REPLACE FUNCTION public.ope_efet_diaristas(p_ini date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM public.ope_efet_exige('visualizar');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'nome', d.nome, 'cpf', d.cpf, 'telefone', d.telefone, 'cidade', d.cidade,
           'regioes', d.regioes, 'disponivel', d.disponivel, 'ativo', d.ativo, 'observacao', d.observacao,
           'origem', d.origem,
           'chamados',  coalesce(oc.chamados, 0),  'aceitos', coalesce(oc.aceitos, 0),
           'recusas',   coalesce(oc.recusas, 0),   'confirmados', coalesce(oc.confirmados, 0),
           'em_aberto', coalesce(oc.em_aberto, 0),
           'diarias',   coalesce(di.qtd, 0), 'ultima_diaria', di.ultima, 'ultimo_contrato', di.contrato)
           ORDER BY d.disponivel DESC, coalesce(oc.confirmados, 0) + coalesce(di.qtd, 0) DESC, d.nome), '[]'::jsonb)
    INTO v
    FROM public."OPE_EFET_DIARISTA" d
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS chamados,
             count(*) FILTER (WHERE o.aceito_em IS NOT NULL)::int AS aceitos,
             count(*) FILTER (WHERE o.status = 'nao_realizada')::int AS recusas,
             count(*) FILTER (WHERE o.status = 'ponto_confirmado')::int AS confirmados,
             count(*) FILTER (WHERE o.status IN ('acionado', 'aceita', 'em_deslocamento', 'aguardando_ponto'))::int AS em_aberto
        FROM public."OPE_EFET_OCORRENCIA" o
       WHERE o.substituto_diarista_id = d.id
         AND (p_ini IS NULL OR o.data >= p_ini) AND (p_fim IS NULL OR o.data <= p_fim)
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT s.id)::int AS qtd, max(s.created_at)::date AS ultima,
             (array_agg(s.contrato_nome ORDER BY s.created_at DESC))[1] AS contrato
        FROM public."DIARIA_SOLICITACAO" s
       WHERE d.cpf IS NOT NULL AND regexp_replace(coalesce(s.diarista_cpf, ''), '\D', '', 'g') = d.cpf
         AND s.status NOT IN ('excluida', 'reprovada')
    ) di ON true
   WHERE d.ativo;
  RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_diaristas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_diaristas(date, date) TO authenticated;

-- ── 10. Observações do posto ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_efet_obs_adicionar(p_empresa bigint, p_filial bigint, p_posto text, p_texto text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := public.ope_efet_exige('alterar'); v_id bigint;
BEGIN
  IF coalesce(btrim(p_posto), '') = '' OR coalesce(btrim(p_texto), '') = '' THEN
    RAISE EXCEPTION 'Escreva a observação.';
  END IF;
  INSERT INTO public."OPE_EFET_POSTO_OBS" (empresa, filial, posto, texto, autor_id, autor_nome)
  VALUES (p_empresa, p_filial, btrim(p_posto), btrim(p_texto), v_uid, public.ope_efet_nome_usuario())
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_obs_adicionar(bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_obs_adicionar(bigint, bigint, text, text) TO authenticated;

-- Só quem escreveu apaga a própria observação.
CREATE OR REPLACE FUNCTION public.ope_efet_obs_remover(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_uid uuid := public.ope_efet_exige('alterar');
BEGIN
  DELETE FROM public."OPE_EFET_POSTO_OBS" WHERE id = p_id AND autor_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Só quem escreveu pode apagar a observação.'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_efet_obs_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_efet_obs_remover(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ope_efet_obs_remover(bigint), public.ope_efet_obs_adicionar(bigint, bigint, text, text),
--   public.ope_efet_diaristas(date, date), public.ope_efet_diarista_salvar(jsonb), public.ope_efet_status(bigint, text, text),
--   public.ope_efet_acionar(bigint, text, bigint, bigint, text, text, text), public.ope_efet_registrar(jsonb),
--   public.ope_efet_base(date, date, bigint, bigint), public.ope_efet_nome_usuario(), public.ope_efet_exige(text),
--   public.ope_efet_pode(text);
-- DROP TABLE IF EXISTS public."OPE_EFET_EVENTO", public."OPE_EFET_OCORRENCIA", public."OPE_EFET_DIARISTA", public."OPE_EFET_POSTO_OBS";
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'ope_efetividade';
-- DELETE FROM public.app_menu WHERE codigo = 'ope_efetividade';
