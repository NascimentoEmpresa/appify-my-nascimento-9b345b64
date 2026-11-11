-- =========================================================================
-- OPERACIONAL › INDICADORES › CONTRATOS — os 7 indicadores POR CONTRATO
-- (11/11/2026)
--
-- PEDIDO (Pablo, com a tabela "Indicador na TV × o que a empresa precisa
-- identificar"): a Gerência Operacional precisa ver, CONTRATO A CONTRATO,
--   1. postos contratados × cobertos     5. faltas (%)
--   2. lucratividade (%)                 6. turnover (%)
--   3. custo direto acima do orçado (%)  7. reclamações / baixa satisfação
--   4. glosas (valor, causa)
-- A TV ger-operacional já mostra os 7 como TOTAIS (tvg_calc, mig
-- 20261109001000); aqui é o recorte por contrato, numa tela só.
--
-- REGRA: número só quando a fonte existe e é verdadeira. Sem fonte = NULL,
-- nunca zero. Cada bloco usa a conta da tela de origem:
--
--   POSTOS (posição de hoje) — a conta do Ativos/Contratos, igual à
--     ope_efet_previsto_planilha (mig 20261104001300): contratados = soma do
--     IMPLANTADO vigente (contrato_postos_base: CONTRATO_POSTO_IMPLANTADO, ou
--     o previsto da Planilha de Custo quando não há registro), sem RENDA
--     TÉCNICA; cobertos = "Tem" (rh_ac_pessoas_posto: só Trabalhando, dentro
--     da conta, sem RT). Contrato sem Planilha de Custo: sem fonte.
--   FALTAS (competência) — os ATESTADOS por dia do Ativos/Contratos
--     (rh_ac_atestados_dias, mig 20261103005100: SST_AFASTAMENTO tipo
--     atestado/atestado_acompanhante, não cancelado, uma pessoa por dia e
--     contrato) ÷ (efetivo no fim do mês × dias do mês até hoje). É PARCIAL:
--     falta injustificada não é apurada por dia em tabela nenhuma (o ponto
--     não guarda a falta apurada — conferido em 09/11/2026).
--   TURNOVER (competência) — a taxa mensal de Relatórios › Turn-over ›
--     Variação de Efetivo (dir_turnover_variacao_efetivo, mig
--     20261026000040): demissões no mês ÷ efetivo no fim do mês × 100, com a
--     MESMA ligação pessoa → contrato (de-para da filial, nome da filial,
--     nome do local). Aquela RPC cobra o acesso do relatório; por isso a
--     conta é repetida aqui (só o efetivo e as demissões).
--   GLOSAS (90 dias até o fim da competência) — Jurídico › Controle de
--     Notificações, tipo Glosa (a mesma fonte do op_glosas da TV); valor
--     final (ou original); sai o que foi Revertido ou Cancelado pelo órgão
--     (não houve perda). Causa = causa raiz, senão o assunto.
--   RECLAMAÇÕES (90 dias) — as notificações formais do cliente que não são
--     glosa nem multa (o op_reclamacoes da TV). PARCIAL: satisfação do
--     cliente não é medida em lugar nenhum do ERP.
--   ORÇADO (para os indicadores 2 e 3) — a Planilha de Custo EXECUTADA
--     vigente no fim de cada mês, um posto por nome (a mesma régua do
--     previsto): é o orçamento que a licitação precificou e o "Orçado" que o
--     Malote já usa (useOrcamentoContratos). Por mês e contrato:
--       custo direto orçado = Σ qt_postos × (total_por_empregado − custos
--         indiretos − lucro − COFINS − PIS − IRPJ/CSLL − ISS);
--       margem prevista     = Σ qt × lucro ÷ Σ qt × total_por_empregado
--         (só quando dá entre 0 e 60%: fora disso a linha não é R$).
--     Os orçamentos de contrato da Controladoria (orcamento_contrato) estão
--     todos em rascunho e ligam em outra tabela (public.contrato): não servem.
--
-- LUCRATIVIDADE e CUSTO REALIZADO não saem daqui: são a conta de
-- Controladoria › Faturamento da Empresa (líquido das notas − despesas do
-- Fluxo de Caixa), feita na tela com a escolha de empresa/base/código de
-- nota da pessoa (useIndicadoresFaturamento) — a mesma de Lucratividade e
-- Orçamento. Esta RPC manda só o orçado para a tela comparar.
--
-- Notificação cujo texto de contrato não liga a um contrato do ERP entra em
-- "sem_contrato" (a tela mostra o total à parte: não some, nem vira zero).
--
-- PESO: um SELECT por bloco, EMPREGADOS lida uma vez (normaliza uma vez por
-- pessoa, como a mig 20261007000004); o papel authenticated tem
-- statement_timeout de 8 s.
--
-- ope_contratos_ind_dados: interna (sem EXECUTE para o client), para a TV
-- poder reaproveitar sem login. ope_contratos_indicadores: a da tela, cobra
-- ope_indicadores_contratos (visualizar).
--
-- Tela nova nasce sem ninguém (desde 08/10/2026): liberar em Administração ›
-- Acesso por Usuário. Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'ope_indicadores_contratos', 'Indicadores por Contrato', '/app/operacional/indicadores/contratos', 55, true
  FROM public.app_modulo m
 WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) A conta (interna) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_contratos_ind_dados(p_competencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_comp text;
  v_ini date;
  v_fim date;
  v_dias int;
  v_jan date;
  v_janela_ini date;
  v_out jsonb;
BEGIN
  v_comp := CASE WHEN p_competencia ~ '^\d{4}-(0[1-9]|1[0-2])$' AND p_competencia <= to_char(hoje, 'YYYY-MM')
                 THEN p_competencia ELSE to_char(hoje, 'YYYY-MM') END;
  v_ini := to_date(v_comp || '-01', 'YYYY-MM-DD');
  v_fim := least((v_ini + interval '1 month' - interval '1 day')::date, hoje);
  v_dias := v_fim - v_ini + 1;
  v_jan := date_trunc('year', v_ini)::date;
  v_janela_ini := v_fim - 89;

  WITH
  -- Contrato do ERP de cada nome normalizado (mesma ligação de rh_ac_ativos).
  ct AS MATERIALIZED (
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
  -- Efetivo e demissões da competência (Turn-over › Variação de Efetivo).
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão") AS adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento") END AS dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') AS conta,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem filial)') AS filial,
           public.rh_norm_contrato(x."Nome Filial") AS nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") AS nn_local
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
  ),
  ec AS MATERIALIZED (
    SELECT e.adm, e.dem, e.conta, COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id) AS contrato_id
      FROM e
      LEFT JOIN dp_nome d1 ON d1.filial_nome = e.filial
      LEFT JOIN ct c1      ON c1.nn = e.nn_filial
      LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
      LEFT JOIN ct c2      ON c2.nn = e.nn_local
     WHERE e.dem IS NULL OR e.dem >= v_ini
  ),
  mov AS (
    SELECT contrato_id,
           count(*) FILTER (WHERE conta AND adm <= v_fim AND (dem IS NULL OR dem > v_fim)) AS efetivo,
           count(*) FILTER (WHERE dem BETWEEN v_ini AND v_fim) AS demissoes
      FROM ec WHERE contrato_id IS NOT NULL
     GROUP BY 1
  ),
  -- Postos: implantado × Tem (ope_efet_previsto_planilha).
  base AS MATERIALIZED (SELECT * FROM public.contrato_postos_base(hoje)),
  pv AS (
    SELECT b.contrato_id,
           COALESCE(sum(b.implantado) FILTER (WHERE NOT b.rt), 0) AS implantado,
           COALESCE(sum(b.previsto) FILTER (WHERE NOT b.rt), 0) AS previsto,
           COALESCE(bool_or(b.registrado) FILTER (WHERE NOT b.rt), false) AS registrado
      FROM base b GROUP BY 1
  ),
  tem AS (
    SELECT a.contrato_id,
           count(*) FILTER (WHERE NOT a.fora AND NOT a.rt AND a.conta) AS tem,
           count(*) FILTER (WHERE NOT a.fora AND NOT a.rt AND NOT a.conta) AS afastados
      FROM public.rh_ac_pessoas_posto() a
     WHERE a.contrato_id IS NOT NULL
     GROUP BY 1
  ),
  -- Atestados por dia (rh_ac_atestados_dias), só a competência.
  afa AS MATERIALIZED (
    SELECT a.contrato_id, upper(btrim(a.nome)) AS quem, a.data_inicio AS ini,
           public.sst_afa_fim(a.data_inicio, a.dias_considerados, a.retornou_em) AS fim
      FROM public."SST_AFASTAMENTO" a
     WHERE a.tipo IN ('atestado', 'atestado_acompanhante')
       AND NOT a.cancelado
       AND a.contrato_id IS NOT NULL
       AND a.data_inicio <= v_fim
       AND a.data_inicio >= v_ini - 400   -- atestado não dura mais que isso; poupa o índice
  ),
  fal AS (
    SELECT contrato_id, count(*) AS dias_pessoa, count(DISTINCT quem) AS pessoas
      FROM (SELECT DISTINCT f.contrato_id, d.d::date AS dia, f.quem
              FROM afa f
              CROSS JOIN LATERAL generate_series(greatest(f.ini, v_ini), least(f.fim, v_fim), interval '1 day') AS d(d)
             WHERE f.fim >= v_ini) z
     GROUP BY 1
  ),
  -- Notificações do Jurídico (glosas e reclamações), 90 dias.
  nt AS MATERIALIZED (
    SELECT ct.id AS contrato_id, n.tipo,
           coalesce(n.valor_final, n.valor_original, 0) AS valor,
           coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), n.tipo, 'Sem causa registrada') AS causa,
           n.resultado
      FROM public."JUR_NOTIFICACOES" n
      LEFT JOIN ct ON ct.nn = public.rh_norm_contrato(n.contrato)
     WHERE coalesce(n.data_recebimento, n.created_at::date) BETWEEN v_janela_ini AND v_fim
  ),
  gl AS (
    SELECT contrato_id, sum(valor) AS valor, count(*) AS qtd,
           (array_agg(left(causa, 90) ORDER BY valor DESC))[1] AS causa
      FROM nt
     WHERE tipo = 'Glosa' AND coalesce(resultado, '') NOT IN ('Revertida', 'Cancelada pelo órgão')
     GROUP BY 1
  ),
  rc AS (
    SELECT contrato_id, count(*) AS qtd,
           (SELECT left(x.causa, 90) FROM nt x
             WHERE x.contrato_id IS NOT DISTINCT FROM r.contrato_id AND coalesce(x.tipo, '') NOT IN ('Glosa', 'Multa')
             GROUP BY x.causa ORDER BY count(*) DESC, x.causa LIMIT 1) AS causa
      FROM nt r
     WHERE coalesce(tipo, '') NOT IN ('Glosa', 'Multa')
     GROUP BY 1
  ),
  -- Orçado: Planilha de Custo EXECUTADA vigente no fim de cada mês do ano.
  mm AS (
    SELECT g::date AS ini, least((g + interval '1 month' - interval '1 day')::date, hoje) AS fim
      FROM generate_series(v_jan, v_ini, interval '1 month') g
  ),
  pc AS MATERIALIZED (
    SELECT DISTINCT ON (p.contrato_id, public.sup_norm_nome(p.posto), mm.ini)
           p.contrato_id, mm.ini,
           COALESCE(p.qt_postos, 0) AS qt,
           COALESCE(p.total_por_empregado, 0) AS total,
           COALESCE(p.lucro, 0) AS lucro,
           COALESCE(p.custos_indiretos, 0) + COALESCE(p.lucro, 0) + COALESCE(p.cofins, 0) + COALESCE(p.pis, 0)
             + COALESCE(p.irpj_csll, 0) + COALESCE(p.iss, 0) AS fora_do_direto
      FROM public.planilha_custo p
      JOIN mm ON p.data_vigencia <= mm.fim
     WHERE p.contrato_id IS NOT NULL
       AND p.orexec = 'EXECUTADO'
       AND NOT COALESCE(p.encerrado, false)
       AND p.data_vigencia IS NOT NULL
       AND COALESCE(btrim(p.posto), '') <> ''
     ORDER BY p.contrato_id, public.sup_norm_nome(p.posto), mm.ini, p.data_vigencia DESC
  ),
  orc_mes AS (
    SELECT contrato_id, ini,
           sum(qt * greatest(total - fora_do_direto, 0)) AS custo_direto,
           sum(qt * total) AS preco,
           sum(qt * lucro) AS lucro
      FROM pc GROUP BY 1, 2
  ),
  orc AS (
    SELECT o.contrato_id,
           jsonb_object_agg(to_char(o.ini, 'YYYY-MM'), round(o.custo_direto, 2)) FILTER (WHERE o.custo_direto > 0) AS custo_por_mes,
           max(o.preco) FILTER (WHERE o.ini = v_ini) AS preco,
           max(o.lucro) FILTER (WHERE o.ini = v_ini) AS lucro
      FROM orc_mes o GROUP BY 1
  ),
  cids AS (
    SELECT id AS contrato_id FROM public.contratos WHERE COALESCE(status, 'ativo') <> 'encerrado'
    UNION SELECT contrato_id FROM tem WHERE tem > 0 OR afastados > 0
    UNION SELECT contrato_id FROM gl WHERE contrato_id IS NOT NULL
    UNION SELECT contrato_id FROM rc WHERE contrato_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'competencia', v_comp,
    'de', v_ini, 'ate', v_fim, 'dias', v_dias,
    'janela_notificacoes', jsonb_build_object('de', v_janela_ini, 'ate', v_fim),
    'gerado_em', now(),
    'contratos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'nome', c.nome, 'cliente', c.cliente,
               'encerrado', COALESCE(c.status, 'ativo') = 'encerrado',
               'postos', CASE WHEN pv.contrato_id IS NULL THEN NULL ELSE jsonb_build_object(
                           'contratados', pv.implantado, 'previsto', pv.previsto, 'implantado_registrado', pv.registrado,
                           'cobertos', COALESCE(t.tem, 0), 'afastados', COALESCE(t.afastados, 0)) END,
               'efetivo', COALESCE(mv.efetivo, 0),
               'demissoes', COALESCE(mv.demissoes, 0),
               'atestados', jsonb_build_object('dias_pessoa', COALESCE(f.dias_pessoa, 0), 'pessoas', COALESCE(f.pessoas, 0)),
               'glosas', jsonb_build_object('valor', COALESCE(g.valor, 0), 'qtd', COALESCE(g.qtd, 0), 'causa', g.causa),
               'reclamacoes', jsonb_build_object('qtd', COALESCE(r.qtd, 0), 'causa', r.causa),
               'orcado', CASE WHEN o.contrato_id IS NULL THEN NULL ELSE jsonb_build_object(
                           'custo_direto_por_mes', COALESCE(o.custo_por_mes, '{}'::jsonb),
                           'margem_prevista', CASE WHEN o.preco > 0 AND o.lucro > 0 AND o.lucro / o.preco < 0.6
                                                   THEN round(100 * o.lucro / o.preco, 2) END) END)
             ORDER BY c.nome)
        FROM cids
        JOIN public.contratos c ON c.id = cids.contrato_id
        LEFT JOIN pv  ON pv.contrato_id = c.id
        LEFT JOIN tem t ON t.contrato_id = c.id
        LEFT JOIN mov mv ON mv.contrato_id = c.id
        LEFT JOIN fal f ON f.contrato_id = c.id
        LEFT JOIN gl g ON g.contrato_id = c.id
        LEFT JOIN rc r ON r.contrato_id = c.id
        LEFT JOIN orc o ON o.contrato_id = c.id), '[]'::jsonb),
    'sem_contrato', jsonb_build_object(
      'glosas_valor', COALESCE((SELECT valor FROM gl WHERE contrato_id IS NULL), 0),
      'glosas_qtd', COALESCE((SELECT qtd FROM gl WHERE contrato_id IS NULL), 0),
      'reclamacoes_qtd', COALESCE((SELECT qtd FROM rc WHERE contrato_id IS NULL), 0))
  ) INTO v_out;

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.ope_contratos_ind_dados(text) FROM PUBLIC, anon, authenticated;

-- ── 3) A RPC da tela ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ope_contratos_indicadores(_competencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'ope_indicadores_contratos', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores por Contrato' USING ERRCODE = '42501';
  END IF;
  RETURN public.ope_contratos_ind_dados(_competencia);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_contratos_indicadores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ope_contratos_indicadores(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin), com o tempo:
--   SELECT clock_timestamp();
--   SELECT jsonb_array_length(public.ope_contratos_ind_dados(NULL)->'contratos');
--   SELECT clock_timestamp();

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.ope_contratos_indicadores(text);
-- DROP FUNCTION IF EXISTS public.ope_contratos_ind_dados(text);
-- DELETE FROM public.app_menu WHERE codigo = 'ope_indicadores_contratos';
-- NOTIFY pgrst, 'reload schema';
