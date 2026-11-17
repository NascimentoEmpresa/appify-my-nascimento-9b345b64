-- =========================================================================
-- SIS-2026-0918 — SST › ASO Periódico: periodicidade por contrato e janela
-- de aviso configuráveis (17/11/2026)
--
-- CONTEXTO: a mig 20261114100000 já entregou a tela, o ciclo (solicitação →
-- agendamento → realização com resultado e ASO anexado), os cinco status e
-- o painel. Faltava o que o chamado pede como REGRA DO SST, não do código:
--   - "UFFS = 1 ano; demais contratos = 2 anos" estava cravado numa regex
--     (sst_aso_per_meses: '\mUFFS\M' no nome do contrato/filial). Contrato
--     novo com outra periodicidade exigiria deploy;
--   - "próximo do vencimento" era 60 dias fixos no SQL e no front;
--   - o contrato da pessoa saía SÓ do de-para manual
--     (sup_empregado_contrato_depara, 3 linhas) — quase todo mundo ficava
--     "sem contrato" e a periodicidade dependia do nome da filial.
--
-- O QUE ESTA MIGRATION FAZ (aditiva; nada da 20261114100000 é apagado além
-- da função da regex)
--   1. "SST_ASO_PERIODICO_CONFIG" (linha única): dias de aviso (padrão 60)
--      e periodicidade padrão (24 meses = 2 anos).
--   2. "SST_ASO_PERIODICO_CONTRATO": periodicidade por contrato
--      (contratos.id). Contrato sem linha usa o padrão.
--      SEMENTE: 12 meses para os contratos da UFFS — identificados em
--      public.contratos pela sigla "UFFS" como palavra inteira no nome
--      (ex.: "UFFS - 041/2021") ou pelo nome por extenso "Fronteira Sul".
--      É a mesma régua que a regex aplicava, só que roda UMA vez aqui e vira
--      dado editável na tela; contrato novo da UFFS cadastrado depois entra
--      com 2 anos até o SST ajustar (a tela de configuração lista todos).
--   3. Pessoa → contrato pela ligação de sempre (a do rh_ac_ativos /
--      turnover_contrato_encerrado_locais): de-para da filial, nome da filial
--      normalizado (rh_norm_contrato), de-para pelo nome normalizado e, por
--      fim, a "Descrição do Local". Dois contratos com o mesmo nome
--      (renovação): vale o que NÃO está encerrado.
--   4. sst_aso_per_base passa a devolver contrato_id e a origem da
--      periodicidade ('contrato' | 'padrao'); sst_aso_per_lista usa os dias
--      de aviso da configuração.
--   5. CHECK de periodicidade no ciclo: era IN (12, 24); vira 1..60 meses.
--   6. RPCs da configuração: sst_aso_per_config_ler (visualizar),
--      sst_aso_per_config_salvar e sst_aso_per_contrato_salvar (alterar).
--
-- DECISÕES (o chamado não define):
--   - Janela de "próximo do vencimento": 60 dias, editável de 1 a 365.
--     60 dá tempo de pedir à clínica, agendar e receber o ASO antes de vencer.
--   - Quem não tem contrato identificado fica com o PADRÃO (2 anos) e a tela
--     marca "contrato não identificado" — o SST vê e corrige o de-para.
--   - Só alterar do menu sst_aso_periodico muda a configuração: é o mesmo
--     time que opera a fila.
--   - Afastados (férias, auxílio, licença) continuam na lista: o vínculo está
--     ativo e o vencimento corre; quem volta de afastamento longo faz o ASO
--     de retorno, que já zera a contagem. Só desligados saem.
--
-- STATUS (régua repetida em src/lib/sst/asoPeriodico.ts, com teste):
--   ciclo em aberto com data de agendamento → Agendado
--   ciclo em aberto sem data de agendamento → Aguardando agendamento
--   sem ciclo: vencimento < hoje                    → Vencido
--              vencimento <= hoje + dias_aviso      → Próximo do vencimento
--              último ASO é periódico deste controle → Realizado/recebido
--              senão                                → Em dia (fora do painel)
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Configuração geral (linha única) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_ASO_PERIODICO_CONFIG" (
  id                         boolean PRIMARY KEY DEFAULT true CHECK (id),
  dias_aviso                 integer NOT NULL DEFAULT 60 CHECK (dias_aviso BETWEEN 1 AND 365),
  periodicidade_padrao_meses integer NOT NULL DEFAULT 24 CHECK (periodicidade_padrao_meses BETWEEN 1 AND 60),
  atualizado_por_nome        text,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."SST_ASO_PERIODICO_CONFIG" (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public."SST_ASO_PERIODICO_CONFIG" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_ASO_PERIODICO_CONFIG" FROM anon;
GRANT SELECT ON public."SST_ASO_PERIODICO_CONFIG" TO authenticated;
DROP POLICY IF EXISTS sst_aso_per_config_sel ON public."SST_ASO_PERIODICO_CONFIG";
CREATE POLICY sst_aso_per_config_sel ON public."SST_ASO_PERIODICO_CONFIG" FOR SELECT TO authenticated
  USING ((select public.sst_aso_per_pode('visualizar')));

-- ── 2. Periodicidade por contrato ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_ASO_PERIODICO_CONTRATO" (
  contrato_id         uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  periodicidade_meses integer NOT NULL CHECK (periodicidade_meses BETWEEN 1 AND 60),
  motivo              text,
  atualizado_por_nome text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."SST_ASO_PERIODICO_CONTRATO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SST_ASO_PERIODICO_CONTRATO" FROM anon;
GRANT SELECT ON public."SST_ASO_PERIODICO_CONTRATO" TO authenticated;
DROP POLICY IF EXISTS sst_aso_per_contrato_sel ON public."SST_ASO_PERIODICO_CONTRATO";
CREATE POLICY sst_aso_per_contrato_sel ON public."SST_ASO_PERIODICO_CONTRATO" FOR SELECT TO authenticated
  USING ((select public.sst_aso_per_pode('visualizar')));

-- Semente: UFFS = 1 ano (ver cabeçalho). ON CONFLICT: reexecutar não desfaz
-- o que o SST ajustou na tela.
INSERT INTO public."SST_ASO_PERIODICO_CONTRATO" (contrato_id, periodicidade_meses, motivo, atualizado_por_nome)
SELECT c.id, 12, 'SIS-2026-0918: contrato da UFFS — periódico anual', 'Migração 20261117020000'
  FROM public.contratos c
 WHERE c.nome ~* '\mUFFS\M' OR c.nome ~* 'FRONTEIRA\s+SUL'
ON CONFLICT (contrato_id) DO NOTHING;

-- ── 3. Ciclo: periodicidade deixa de ser só 12/24 ────────────────────────
ALTER TABLE public."SST_ASO_PERIODICO" DROP CONSTRAINT IF EXISTS "SST_ASO_PERIODICO_periodicidade_meses_check";
ALTER TABLE public."SST_ASO_PERIODICO" DROP CONSTRAINT IF EXISTS sst_aso_per_meses_ck;
ALTER TABLE public."SST_ASO_PERIODICO" ADD CONSTRAINT sst_aso_per_meses_ck CHECK (periodicidade_meses BETWEEN 1 AND 60);

-- ── 4. Regras de cálculo ─────────────────────────────────────────────────
-- A regex sai: a periodicidade agora é dado (seção 2).
DROP FUNCTION IF EXISTS public.sst_aso_per_meses(text, text);

CREATE OR REPLACE FUNCTION public.sst_aso_per_cfg()
RETURNS public."SST_ASO_PERIODICO_CONFIG"
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r public."SST_ASO_PERIODICO_CONFIG";
BEGIN
  SELECT * INTO r FROM public."SST_ASO_PERIODICO_CONFIG" WHERE id;
  IF NOT FOUND THEN  -- linha apagada à mão: volta aos padrões do chamado
    r := ROW(true, 60, 24, NULL, now())::public."SST_ASO_PERIODICO_CONFIG";
  END IF;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_cfg() FROM PUBLIC, anon, authenticated;

-- Filial/local da Senior → contrato (ligação de sempre, ver cabeçalho).
-- Roda nos pares distintos (poucas centenas), não em cada pessoa.
CREATE OR REPLACE FUNCTION public.sst_aso_per_contrato_local()
RETURNS TABLE (filial text, local text, contrato_id uuid, contrato_nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  ),
  par AS MATERIALIZED (
    SELECT DISTINCT btrim(x."Nome Filial") AS filial, COALESCE(btrim(x."Descrição do Local"), '') AS local
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome Filial"), '') <> ''
  )
  SELECT p.filial, p.local, c.id, c.nome
    FROM par p
    LEFT JOIN dp_nome d1 ON d1.filial_nome = p.filial
    LEFT JOIN ct c1      ON c1.nn = public.rh_norm_contrato(p.filial)
    LEFT JOIN dp_nn d2   ON d2.nn = public.rh_norm_contrato(p.filial)
    LEFT JOIN ct c2      ON c2.nn = public.rh_norm_contrato(p.local)
    JOIN public.contratos c ON c.id = COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id)
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_contrato_local() FROM PUBLIC, anon, authenticated;

-- Colaboradores ativos (não desligados), um por CPF, com contrato, a
-- periodicidade dele e o último ASO. O tipo de retorno mudou: DROP antes.
DROP FUNCTION IF EXISTS public.sst_aso_per_base(text);
CREATE FUNCTION public.sst_aso_per_base(p_cpf text DEFAULT NULL)
RETURNS TABLE (cpf text, empregado_id bigint, nome text, situacao text, filial_nome text, contrato_id uuid,
               contrato_nome text, cargo text, admissao date, ultimo_aso date, ultimo_tipo text,
               periodicidade_meses integer, periodicidade_origem text, vencimento date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cfg AS (SELECT * FROM public.sst_aso_per_cfg()),
  emp AS (
    SELECT DISTINCT ON (x.cpf) x.*
      FROM (SELECT regexp_replace(COALESCE(e."CPF", ''), '\D', '', 'g') AS cpf, e."ID" AS empregado_id,
                   btrim(e."Nome") AS nome, e."Situação" AS situacao, btrim(e."Nome Filial") AS filial_nome,
                   COALESCE(btrim(e."Descrição do Local"), '') AS local_nome,
                   nullif(btrim(e."Título do Cargo"), '') AS cargo, public.rh_data(e."Admissão"::text) AS admissao
              FROM public."EMPREGADOS" e
             WHERE COALESCE(public.sst_afa_tipo_da_situacao(e."Situação"), '') <> 'desligamento') x
     WHERE length(x.cpf) = 11 AND (p_cpf IS NULL OR x.cpf = p_cpf)
     ORDER BY x.cpf, (x.situacao = 'Trabalhando') DESC, x.admissao DESC NULLS LAST
  ), com_aso AS (
    SELECT m.*, cl.contrato_id, cl.contrato_nome, pc.periodicidade_meses AS meses_contrato,
           COALESCE(u.data, m.admissao) AS ultimo_aso,
           CASE WHEN u.data IS NOT NULL THEN u.tipo WHEN m.admissao IS NOT NULL THEN 'admissao_estimada' END AS ultimo_tipo
      FROM emp m
      LEFT JOIN public.sst_aso_per_contrato_local() cl ON cl.filial = m.filial_nome AND cl.local = m.local_nome
      LEFT JOIN public."SST_ASO_PERIODICO_CONTRATO" pc ON pc.contrato_id = cl.contrato_id
      LEFT JOIN public.sst_aso_per_ultimos() u ON u.cpf = m.cpf
  )
  SELECT a.cpf, a.empregado_id, a.nome, a.situacao, a.filial_nome, a.contrato_id, a.contrato_nome, a.cargo, a.admissao,
         a.ultimo_aso, a.ultimo_tipo,
         COALESCE(a.meses_contrato, cfg.periodicidade_padrao_meses),
         CASE WHEN a.meses_contrato IS NOT NULL THEN 'contrato' ELSE 'padrao' END,
         (a.ultimo_aso + make_interval(months => COALESCE(a.meses_contrato, cfg.periodicidade_padrao_meses)))::date
    FROM com_aso a CROSS JOIN cfg
$$;
REVOKE ALL ON FUNCTION public.sst_aso_per_base(text) FROM PUBLIC, anon, authenticated;

-- ── 5. Lista: dias de aviso da configuração ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_aso_per_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_aviso integer := (SELECT dias_aviso FROM public.sst_aso_per_cfg());
BEGIN
  PERFORM public.sst_aso_per_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'cpf', b.cpf, 'empregado_id', b.empregado_id, 'nome', b.nome, 'situacao', b.situacao,
             'filial_nome', b.filial_nome, 'contrato_id', b.contrato_id, 'contrato_nome', b.contrato_nome, 'cargo', b.cargo,
             'admissao', b.admissao, 'ultimo_aso', b.ultimo_aso, 'ultimo_tipo', b.ultimo_tipo,
             'periodicidade_meses', b.periodicidade_meses, 'periodicidade_origem', b.periodicidade_origem,
             'vencimento', b.vencimento,
             'status', public.sst_aso_per_status(b.vencimento, b.ultimo_tipo, c.id IS NOT NULL, c.agendado_para, current_date, v_aviso),
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

-- ── 6. RPCs da configuração ──────────────────────────────────────────────
-- Configuração + todos os contratos (encerrados por último), com a
-- periodicidade efetiva e quantos ativos cada um tem hoje.
CREATE OR REPLACE FUNCTION public.sst_aso_per_config_ler()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE cfg public."SST_ASO_PERIODICO_CONFIG" := public.sst_aso_per_cfg();
BEGIN
  PERFORM public.sst_aso_per_exige('visualizar');
  RETURN jsonb_build_object(
    'dias_aviso', cfg.dias_aviso,
    'periodicidade_padrao_meses', cfg.periodicidade_padrao_meses,
    'atualizado_por_nome', cfg.atualizado_por_nome,
    'updated_at', cfg.updated_at,
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contrato_id', c.id, 'nome', c.nome, 'status', COALESCE(c.status, 'ativo'),
               'periodicidade_meses', pc.periodicidade_meses, 'motivo', pc.motivo,
               'atualizado_por_nome', pc.atualizado_por_nome, 'colaboradores', COALESCE(n.qtd, 0))
             ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), COALESCE(n.qtd, 0) = 0, c.nome)
        FROM public.contratos c
        LEFT JOIN public."SST_ASO_PERIODICO_CONTRATO" pc ON pc.contrato_id = c.id
        LEFT JOIN (SELECT b.contrato_id, count(*) AS qtd FROM public.sst_aso_per_base() b GROUP BY b.contrato_id) n
               ON n.contrato_id = c.id), '[]'::jsonb),
    'sem_contrato', (SELECT count(*) FROM public.sst_aso_per_base() b WHERE b.contrato_id IS NULL));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_config_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_config_ler() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_aso_per_config_salvar(p_dias_aviso integer, p_periodicidade_padrao_meses integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_aso_per_exige('alterar');
  IF p_dias_aviso IS NULL OR p_dias_aviso NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Dias de aviso: informe de 1 a 365.';
  END IF;
  IF p_periodicidade_padrao_meses IS NULL OR p_periodicidade_padrao_meses NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Periodicidade padrão: informe de 1 a 60 meses.';
  END IF;
  INSERT INTO public."SST_ASO_PERIODICO_CONFIG" (id, dias_aviso, periodicidade_padrao_meses, atualizado_por_nome, updated_at)
  VALUES (true, p_dias_aviso, p_periodicidade_padrao_meses, public.sst_afa_nome_usuario(), now())
  ON CONFLICT (id) DO UPDATE SET dias_aviso = EXCLUDED.dias_aviso,
    periodicidade_padrao_meses = EXCLUDED.periodicidade_padrao_meses,
    atualizado_por_nome = EXCLUDED.atualizado_por_nome, updated_at = now();
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_config_salvar(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_config_salvar(integer, integer) TO authenticated;

-- p_meses NULL = o contrato volta para o padrão (apaga a linha).
-- Ciclos já abertos guardam a periodicidade do dia em que abriram; o
-- vencimento da lista é recalculado na hora.
CREATE OR REPLACE FUNCTION public.sst_aso_per_contrato_salvar(p_contrato_id uuid, p_meses integer, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_aso_per_exige('alterar');
  IF NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = p_contrato_id) THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;
  IF p_meses IS NULL THEN
    DELETE FROM public."SST_ASO_PERIODICO_CONTRATO" WHERE contrato_id = p_contrato_id;
    RETURN;
  END IF;
  IF p_meses NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Periodicidade: informe de 1 a 60 meses.'; END IF;
  INSERT INTO public."SST_ASO_PERIODICO_CONTRATO" (contrato_id, periodicidade_meses, motivo, atualizado_por_nome, updated_at)
  VALUES (p_contrato_id, p_meses, nullif(btrim(p_motivo), ''), public.sst_afa_nome_usuario(), now())
  ON CONFLICT (contrato_id) DO UPDATE SET periodicidade_meses = EXCLUDED.periodicidade_meses,
    motivo = EXCLUDED.motivo, atualizado_por_nome = EXCLUDED.atualizado_por_nome, updated_at = now();
END $fn$;
REVOKE ALL ON FUNCTION public.sst_aso_per_contrato_salvar(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_aso_per_contrato_salvar(uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (volta à regex da 20261114100000)
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.sst_aso_per_contrato_salvar(uuid, integer, text),
--   public.sst_aso_per_config_salvar(integer, integer), public.sst_aso_per_config_ler();
-- -- recriar sst_aso_per_meses(text, text), sst_aso_per_base(text) e sst_aso_per_lista()
-- -- exatamente como na 20261114100000 (DROP FUNCTION sst_aso_per_base(text) antes:
-- -- o tipo de retorno muda), e então:
-- DROP FUNCTION IF EXISTS public.sst_aso_per_contrato_local(), public.sst_aso_per_cfg();
-- ALTER TABLE public."SST_ASO_PERIODICO" DROP CONSTRAINT IF EXISTS sst_aso_per_meses_ck;
-- ALTER TABLE public."SST_ASO_PERIODICO" ADD CONSTRAINT "SST_ASO_PERIODICO_periodicidade_meses_check"
--   CHECK (periodicidade_meses IN (12, 24));   -- falha se já houver ciclo com outro valor
-- DROP TABLE IF EXISTS public."SST_ASO_PERIODICO_CONTRATO";
-- DROP TABLE IF EXISTS public."SST_ASO_PERIODICO_CONFIG";
-- NOTIFY pgrst, 'reload schema';
