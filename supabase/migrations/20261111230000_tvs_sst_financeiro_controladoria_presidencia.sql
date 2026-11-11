-- =========================================================================
-- TVs › SST (afastamentos), FINANCEIRO, CONTROLADORIA e PRESIDÊNCIA (11/11/2026)
--
-- Pablo: "na TV do SST faltou gráfico dos afastamentos ativos por contrato";
-- "a TV do Financeiro, as informações têm que sair do Controle de
-- Faturamento"; "os dados da TV da Controladoria devem sair do Faturamento da
-- Empresa"; "a TV da Presidência deve pegar esses dados das outras, porque ali
-- são tudo de outras TVs" (documento de gestão, item 3: lucratividade geral e
-- por contrato, contratos vermelhos, postos contratados × cobertos, glosas e
-- retenções, salários e benefícios acima do orçamento, notas pendentes e
-- inadimplência, clientes insatisfeitos).
--
--   1. SST: card "Afastamentos ativos" + gráfico por contrato no painel
--      gerencial (tvg_espelho_sst = a da mig 20261109003200 + kpi 16 + sis_afast).
--   2. 'fin-painel' — a conta do Controle de Faturamento (tv_financeiro_dados).
--   3. 'ctl-painel' — a conta do Faturamento da Empresa (tv_controladoria_dados).
--   4. 'pre-painel' — junta o que as TVs Operacional, Controladoria,
--      Financeiro e RH já calculam (tv_presidencia_dados).
--   5. Playlists: a TV FINANCEIRO toca a nova; a playlist TV DIRETORIA (da
--      Presidência) troca a TV gerencial pela nova; a da Controladoria é
--      criada (não há TV de Controladoria cadastrada — basta escolher a
--      playlist na TV em Sistemas › TV's).
--
-- PRIVACIDADE: só contrato, cliente e valores; nenhum nome de pessoa.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 0) Relatórios novos no item ──────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos', 'sup-painel', 'rec-painel', 'rh-salarios', 'fin-painel', 'ctl-painel', 'pre-painel'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 1) SST: afastamentos ativos por contrato ─────────────────────────────

CREATE OR REPLACE FUNCTION public.tvg_espelho_sst()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ini date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '5 months')::date;
  r jsonb;
  ano_ini timestamptz := date_trunc('year', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  mes_ini timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  WITH adm AS (SELECT * FROM public."VW_RECRUTAMENTO_CANDIDATOS" WHERE etapa_processo IN ('SST + COMPRAS', 'EXAME SST') AND sst_ok IS NULL),
  dem AS (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
           WHERE status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído', 'ASO válido', 'Cancelamento solicitado')),
  tro AS (SELECT * FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" WHERE status IN ('Pendente SST', 'Pendente RH', 'Concluída') ORDER BY criado_em DESC LIMIT 500)
  SELECT jsonb_build_object(
    'tela', 'SST › ASO / Admissão · ASO Demissional · Mudança de Função — ASO',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'ASO admissional pendente', 'valor', (SELECT count(*) FROM adm), 'formato', 'n', 'dica', 'SST › ASO / Admissão'),
      jsonb_build_object('rotulo', 'ASO admissional com exame marcado', 'valor', (SELECT count(*) FROM adm WHERE sst_data_exame IS NOT NULL), 'formato', 'n', 'dica', 'dos pendentes, já com data'),
      jsonb_build_object('rotulo', 'Demissional a receber', 'valor', (SELECT count(*) FROM dem WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › ASO Demissional'),
      jsonb_build_object('rotulo', 'Demissional a agendar', 'valor', (SELECT count(*) FROM dem WHERE status = 'Solicitação de agendamento de DEMISSIONAL recebida'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Demissional agendadas', 'valor', (SELECT count(*) FROM dem WHERE status = 'Agendamento concluído'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Mudança de função aguardando ASO', 'valor', (SELECT count(*) FROM tro WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › Mudança de Função — ASO'),
      jsonb_build_object('rotulo', 'Mudança de função concluídas', 'valor', (SELECT count(*) FROM tro WHERE status = 'Concluída'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'ASOs admissionais realizados no ano', 'valor', (SELECT count(*) FROM public."WA_CURRICULOS" x WHERE x.sst_em >= ano_ini), 'formato', 'n', 'dica', (SELECT count(*) FROM public."WA_CURRICULOS" x WHERE x.sst_em >= mes_ini) || ' neste mês'),
      jsonb_build_object('rotulo', 'ASOs demissionais realizados no ano', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" x WHERE x.sst_em >= ano_ini), 'formato', 'n', 'dica', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" x WHERE x.sst_em >= mes_ini) || ' neste mês'),
      jsonb_build_object('rotulo', 'Mudanças de função atendidas no ano', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" x WHERE x.sst_em >= ano_ini), 'formato', 'n', 'dica', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" x WHERE x.sst_em >= mes_ini) || ' neste mês'),
      jsonb_build_object('rotulo', 'Treinamentos concluídos no ano', 'valor', (SELECT count(*) FROM public."TRN_CERTIFICADO" x WHERE x.emitido_em >= ano_ini), 'formato', 'n', 'dica', (SELECT count(*) FROM public."TRN_CERTIFICADO" x WHERE x.emitido_em >= mes_ini) || ' neste mês'),
      jsonb_build_object('rotulo', 'EPIs e uniformes despachados no ano', 'valor', (SELECT count(*) FROM public.sup_pedido x WHERE x.data_despachado >= ano_ini AND x.tipo_pedido IN ('uniforme', 'ambos') AND x.status = 'DESPACHADO'), 'formato', 'n', 'dica', (SELECT count(*) FROM public.sup_pedido x WHERE x.data_despachado >= mes_ini AND x.tipo_pedido IN ('uniforme', 'ambos') AND x.status = 'DESPACHADO') || ' neste mês'),
      jsonb_build_object('rotulo', 'EPIs em estoque com CA válido', 'valor', (SELECT count(*) FROM public.sup_estoque_tag t JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id JOIN public.sup_item i ON i.id = ei.sup_item_id WHERE i.tipo = 'epi' AND NOT t.usado AND t.ca_validade >= CURRENT_DATE), 'formato', 'n', 'dica', 'Controle de CA'),
      jsonb_build_object('rotulo', 'Laudos de EPI ativos', 'valor', (SELECT count(*) FROM public.sst_laudo_epi x WHERE x.ativo), 'formato', 'n', 'dica', (SELECT count(*) FROM public.sst_laudo_epi x WHERE x.emitido_em >= ano_ini) || ' emitidos no ano'),
      jsonb_build_object('rotulo', 'Telemedicinas realizadas no ano', 'valor', (SELECT count(*) FROM public."SST_AFASTAMENTO" x WHERE x.tele_status = 'realizada' AND x.tele_data >= (ano_ini AT TIME ZONE 'America/Sao_Paulo')::date), 'formato', 'n', 'dica', (SELECT count(*) FROM public."SST_AFASTAMENTO" x WHERE x.tele_status = 'realizada' AND x.tele_data >= (mes_ini AT TIME ZONE 'America/Sao_Paulo')::date) || ' neste mês'),
      jsonb_build_object('rotulo', 'Retornos ao trabalho no ano', 'valor', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.data_retorno_real >= (ano_ini AT TIME ZONE 'America/Sao_Paulo')::date), 'formato', 'n', 'dica', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.data_retorno_real >= (mes_ini AT TIME ZONE 'America/Sao_Paulo')::date) || ' neste mês'),
      jsonb_build_object('rotulo', 'Afastamentos ativos', 'valor', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.status NOT IN ('Retornado', 'Afastamento encerrado')), 'formato', 'n', 'dica', 'SST › Controle de Afastamentos')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'demissional', 'rotulo', 'ASO demissional'), jsonb_build_object('chave', 'admissional', 'rotulo', 'ASO admissional')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'demissional', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE date_trunc('month', s.sst_em AT TIME ZONE 'America/Sao_Paulo') = g),
                  'admissional', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE date_trunc('month', c.sst_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
                  FROM generate_series(ini, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')), interval '1 month') g)),
    'graficos', jsonb_build_object(
      'sis_dem', jsonb_build_object('titulo', 'ASO Demissional, realizados por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" x WHERE to_char(x.sst_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_adm', jsonb_build_object('titulo', 'ASO / Admissão, realizados por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."WA_CURRICULOS" x WHERE to_char(x.sst_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_troca', jsonb_build_object('titulo', 'Mudança de Função, ASOs por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" x WHERE to_char(x.sst_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_laudo', jsonb_build_object('titulo', 'Laudos de EPI emitidos por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public.sst_laudo_epi x WHERE to_char(x.emitido_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_tele', jsonb_build_object('titulo', 'Telemedicinas realizadas por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."SST_AFASTAMENTO" x WHERE to_char(x.tele_data, 'YYYY-MM') = to_char(g, 'YYYY-MM') AND x.tele_status = 'realizada')) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_retorno', jsonb_build_object('titulo', 'Retornos ao trabalho por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE to_char(x.data_retorno_real, 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
           FROM generate_series(ini, date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'sis_afast', jsonb_build_object('titulo', 'Afastamentos ativos por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(x.contrato_nome), ''), nullif(btrim(x.filial_nome), ''), 'Sem contrato') nome, count(*) q
                   FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.status NOT IN ('Retornado', 'Afastamento encerrado')
                  GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb)),
      'sis_ca', jsonb_build_object('titulo', 'EPIs com CA válido, por almoxarifado', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(a.nome), ''), 'Sem almoxarifado') nome, count(*) q
                   FROM public.sup_estoque_tag t JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id JOIN public.sup_item i ON i.id = ei.sup_item_id
                   LEFT JOIN public.almoxarifado a ON a.id = ei.almoxarifado_id
                  WHERE i.tipo = 'epi' AND NOT t.usado AND t.ca_validade >= CURRENT_DATE GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'entregas_aso', jsonb_build_object('titulo', 'ASOs realizados no ano, por tipo', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Admissional', 'valor', (SELECT count(*) FROM public."WA_CURRICULOS" x WHERE x.sst_em >= ano_ini)),
         jsonb_build_object('nome', 'Demissional', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" x WHERE x.sst_em >= ano_ini)),
         jsonb_build_object('nome', 'Mudança de função', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" x WHERE x.sst_em >= ano_ini)))),
      'entregas_trn', jsonb_build_object('titulo', 'Treinamentos concluídos por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YYYY'), 'valor', (SELECT count(*) FROM public."TRN_CERTIFICADO" x WHERE date_trunc('month', x.emitido_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
           FROM generate_series(date_trunc('month', ano_ini AT TIME ZONE 'America/Sao_Paulo'), date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') g)),
      'entregas_epi', jsonb_build_object('titulo', 'EPIs e uniformes despachados, por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(x.contrato_nome), ''), 'Sem contrato') nome, count(*) q FROM public.sup_pedido x
                  WHERE x.data_despachado >= ano_ini AND x.tipo_pedido IN ('uniforme', 'ambos') AND x.status = 'DESPACHADO' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'admissional', jsonb_build_object('titulo', 'ASO admissional pendente por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(contrato), ''), 'Sem contrato') nome, count(*) q FROM adm GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'demissional', jsonb_build_object('titulo', 'ASO demissional por situação', 'tipo', 'rosca', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', x.rotulo, 'valor', (SELECT count(*) FROM dem WHERE dem.status = x.st)) ORDER BY x.o)
           FROM (VALUES (1, 'Pendente SST', 'A receber'), (2, 'Solicitação de agendamento de DEMISSIONAL recebida', 'A agendar'),
                        (3, 'Agendamento concluído', 'Agendadas'), (4, 'ASO válido', 'ASO válido'), (5, 'Cancelamento solicitado', 'Cancelamento solicitado')) x(o, st, rotulo))),
      'troca', jsonb_build_object('titulo', 'Mudança de função na fila do SST, por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(local), ''), nullif(btrim(filial), ''), 'Sem contrato') nome, count(*) q FROM tro WHERE status = 'Pendente SST' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $function$;

REVOKE ALL ON FUNCTION public.tvg_espelho_sst() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_sst() TO service_role;

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque, medida)
VALUES
 ('sst_e_afastados', 'ger-sst', 9, 'Afastamentos ativos por contrato', 'Quem está afastado hoje, por contrato — SST › Controle de Afastamentos.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'SST', true,
  'Afastamentos do Controle de Afastamentos ainda não retornados nem encerrados (informativo, sem meta).', 'sst', 'kpi:16', 'sis_afast', NULL, 'real')
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, identificar = EXCLUDED.identificar, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido,
  meta = NULL, alerta = NULL, na_tv = true, regra = EXCLUDED.regra, espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item,
  espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque, medida = EXCLUDED.medida;

-- ── 2) FINANCEIRO: a conta do Controle de Faturamento ────────────────────
-- Mesmas regras de ControleFaturamento.tsx / faturamentoStatus.ts:
--   · Executável (Base) = Σ qt_postos × total_por_empregado da Planilha de
--     Custo EXECUTADA, posto a posto pela vigência mais recente até o fim do
--     mês (resolverLinhasPorPeriodo); mês com nota e sem executável usa também
--     as linhas encerradas;
--   · notas: só Código N, sem rascunho/enviada/cancelada/substituída
--     (foraDoRelatorio + naoContabilizaKpi);
--   · status: lançadas / parcial (bruto abaixo do executável, tolerância R$ 1)
--     / nenhum lançamento / competência sem dado / sem vigência (contrato
--     encerrado no cadastro e sem nota);
--   · Não Emitido = soma das faltas POR contrato (excesso não abate);
--   · competência = a mais recente do ano com nota Código N (a padrão da tela).
CREATE OR REPLACE FUNCTION public.tv_fin_planilha_executavel(p_mes date)
RETURNS TABLE(contrato_id uuid, executavel numeric, executavel_enc numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH fim AS (SELECT (p_mes + interval '1 month' - interval '1 day')::date AS d),
  todas AS (
    SELECT p.contrato_id, p.posto, p.data_vigencia, coalesce(p.encerrado, false) AS enc,
           coalesce(p.qt_postos, 0) * coalesce(p.total_por_empregado, 0) AS v
      FROM public.planilha_custo p, fim
     WHERE p.contrato_id IS NOT NULL AND p.orexec = 'EXECUTADO' AND p.data_vigencia IS NOT NULL AND p.data_vigencia <= fim.d),
  vig AS (SELECT contrato_id, posto, max(data_vigencia) FILTER (WHERE NOT enc) AS d_ok, max(data_vigencia) AS d_all FROM todas GROUP BY 1, 2)
  SELECT t.contrato_id,
         coalesce(sum(t.v) FILTER (WHERE NOT t.enc AND t.data_vigencia = v.d_ok), 0),
         coalesce(sum(t.v) FILTER (WHERE t.data_vigencia = v.d_all), 0)
    FROM todas t JOIN vig v ON v.contrato_id = t.contrato_id AND v.posto = t.posto
   GROUP BY 1
$$;
REVOKE ALL ON FUNCTION public.tv_fin_planilha_executavel(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tv_fin_nota_valida(p_status text, p_site text, p_dominio text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(p_status, '') NOT IN ('rascunho', 'enviada', 'cancelada')
     AND upper(coalesce(p_site, '') || ' ' || coalesce(p_dominio, '')) !~ '(CANCEL|SUBSTITU)'
$$;

CREATE OR REPLACE FUNCTION public.tv_financeiro_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_comp date;
  v_meses date[];
  v_out jsonb;
BEGIN
  SELECT max(competencia) INTO v_comp FROM public.nf_emissao
   WHERE deleted_at IS NULL AND tipo_nota = 'N' AND competencia >= date_trunc('year', hoje)::date AND competencia <= hoje;
  v_comp := coalesce(v_comp, date_trunc('month', hoje)::date);
  v_meses := ARRAY(SELECT g::date FROM generate_series(v_comp - interval '11 months', v_comp, interval '1 month') g);

  WITH nf AS (
    SELECT n.contrato_id, n.competencia AS mes,
           sum(coalesce(n.valor_contrato_exec_total, 0)) AS exec_rel, sum(coalesce(n.vlr_bruto_total, 0)) AS bruto,
           sum(coalesce(n.vlr_liquido_total, 0)) AS liquido, sum(coalesce(n.valor_pago, 0)) AS recebido,
           sum(coalesce(n.desconto_conta_vinculada, 0)) AS cv, count(*) AS qtd
      FROM public.nf_emissao n
     WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.contrato_id IS NOT NULL AND n.competencia = ANY (v_meses)
       AND public.tv_fin_nota_valida(n.status::text, n.situacao_site_pmt, n.situacao_dominio)
     GROUP BY 1, 2),
  com_dado AS (SELECT DISTINCT competencia AS mes FROM public.nf_emissao WHERE deleted_at IS NULL AND tipo_nota = 'N' AND competencia = ANY (v_meses)),
  ctr AS (SELECT c.id, c.nome, nullif(btrim(c.cliente), '') AS cliente,
                 greatest(nullif(btrim(c.data_fim_vigencia::text), '')::date, nullif(btrim(c.vigencia_final::text), '')::date) AS fim
            FROM public.contratos c),
  -- Executável de todos os contratos, UMA conta por mês.
  pe AS (SELECT m.mes, x.contrato_id, x.executavel, x.executavel_enc
           FROM unnest(v_meses) AS m(mes), LATERAL public.tv_fin_planilha_executavel(m.mes) x),
  cel AS (
    SELECT c.id, c.nome, c.cliente, m.mes,
           coalesce(CASE WHEN coalesce(nf.qtd, 0) > 0 AND coalesce(pe.executavel, 0) = 0 THEN pe.executavel_enc ELSE pe.executavel END, 0) AS executavel,
           coalesce(nf.exec_rel, 0) AS exec_rel, coalesce(nf.bruto, 0) AS bruto, coalesce(nf.liquido, 0) AS liquido,
           coalesce(nf.recebido, 0) AS recebido, coalesce(nf.cv, 0) AS cv, coalesce(nf.qtd, 0) AS qtd,
           (c.fim IS NOT NULL AND m.mes > c.fim) AS encerrado, EXISTS (SELECT 1 FROM com_dado d WHERE d.mes = m.mes) AS tem_dado
      FROM ctr c
     CROSS JOIN unnest(v_meses) AS m(mes)
      LEFT JOIN pe ON pe.contrato_id = c.id AND pe.mes = m.mes
      LEFT JOIN nf ON nf.contrato_id = c.id AND nf.mes = m.mes),
  st AS (
    SELECT cel.*,
           CASE WHEN qtd = 0 AND encerrado THEN 'SEM_VIGENCIA'
                WHEN executavel > 0 AND qtd > 0 THEN CASE WHEN executavel - bruto > 1 THEN 'FATURADO_PARCIAL' ELSE 'NOTAS_LANCADAS' END
                WHEN executavel > 0 AND NOT tem_dado THEN 'COMPETENCIA_SEM_DADOS'
                WHEN executavel > 0 THEN 'NENHUM_LANCAMENTO'
                ELSE 'SEM_VIGENCIA' END AS status,
           CASE WHEN qtd = 0 AND encerrado THEN 0 WHEN executavel - bruto > 1 THEN executavel - bruto ELSE 0 END AS nao_emitido,
           CASE WHEN bruto - executavel > 1 THEN bruto - executavel ELSE 0 END AS excesso
      FROM cel),
  vig AS (SELECT * FROM st WHERE status <> 'SEM_VIGENCIA'),
  atual AS (SELECT * FROM vig WHERE mes = v_comp)
  SELECT jsonb_build_object(
    'competencia', to_char(v_comp, 'YYYY-MM'),
    'kpis', (SELECT jsonb_build_object(
        'vigentes', count(*),
        'executavel', round(sum(executavel), 2), 'executado', round(sum(exec_rel), 2), 'faturado', round(sum(bruto), 2),
        'liquido', round(sum(liquido), 2), 'recebido', round(sum(recebido), 2), 'conta_vinculada', round(sum(cv), 2),
        'nao_emitido', round(sum(nao_emitido), 2), 'excesso', round(sum(excesso), 2),
        'lancadas', count(*) FILTER (WHERE status = 'NOTAS_LANCADAS'), 'parciais', count(*) FILTER (WHERE status = 'FATURADO_PARCIAL'),
        'pendentes', count(*) FILTER (WHERE status = 'NENHUM_LANCAMENTO'), 'sem_dados', count(*) FILTER (WHERE status = 'COMPETENCIA_SEM_DADOS'))
      FROM atual),
    'evolucao', coalesce((SELECT jsonb_agg(jsonb_build_object('mes', to_char(mes, 'YYYY-MM'), 'executavel', round(e, 2), 'faturado', round(b, 2), 'recebido', round(r, 2)) ORDER BY mes)
                            FROM (SELECT mes, sum(executavel) e, sum(bruto) b, sum(recebido) r FROM vig GROUP BY 1) t), '[]'::jsonb),
    'pendentes', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', nome, 'cliente', cliente, 'status', status, 'executavel', round(executavel, 2),
                                   'faturado', round(bruto, 2), 'nao_emitido', round(nao_emitido, 2)) ORDER BY nao_emitido DESC)
                             FROM (SELECT * FROM atual WHERE status IN ('NENHUM_LANCAMENTO', 'FATURADO_PARCIAL') ORDER BY nao_emitido DESC LIMIT 12) t), '[]'::jsonb),
    -- Inadimplência: notas Código N válidas emitidas, sem pagamento, vencidas (emissão + 30 dias, a mesma estimativa do Painel Executivo).
    'inadimplencia', (SELECT jsonb_build_object('valor', round(coalesce(sum(n.vlr_liquido_total), 0), 2), 'notas', count(*),
                               'mais_de_90', round(coalesce(sum(n.vlr_liquido_total) FILTER (WHERE hoje - (n.data_emissao + 30) > 90), 0), 2))
                        FROM public.nf_emissao n
                       WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL
                         AND n.data_pagamento IS NULL AND coalesce(n.valor_pago, 0) = 0 AND n.data_emissao + 30 < hoje
                         AND public.tv_fin_nota_valida(n.status::text, n.situacao_site_pmt, n.situacao_dominio)),
    'gerado_em', now()
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_financeiro_dados() FROM PUBLIC, anon, authenticated;

-- ── 3) CONTROLADORIA: a conta do Faturamento da Empresa ──────────────────
-- Notas Código N válidas (bruto, líquido, recebido, conta vinculada) − as
-- SAÍDAS com contrato do Fluxo de Caixa (ope_contratos_financeiro), sem os
-- contratos fora das despesas (tratamento da Controladoria; sem ele, o padrão
-- pelo nome: MOVIMENTAÇÃO FINANCEIRA, ESTOQUE, INVESTIMENTO, OBRAS ADM,
-- ADMINISTRATIVO). Competência: a última com o faturamento fechado
-- (ope_competencia_fechada), e a evolução nos 12 meses até ela.
CREATE OR REPLACE FUNCTION public.tv_ctl_fora_das_despesas(p_contrato uuid, p_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT t.tratamento IN ('fora_das_despesas', 'investimento') FROM public.controladoria_contrato_tratamento t WHERE t.contrato_id = p_contrato),
    upper(translate(coalesce(p_nome, ''), 'ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç', 'AAAAEEIOOOUCaaaaeeiooouc')) ~ '^\s*(MOVIMENTACAO FINANCEIRA|ESTOQUE|INVESTIMENTO|OBRAS ADM|ADMINISTRATIVO)')
$$;
REVOKE ALL ON FUNCTION public.tv_ctl_fora_das_despesas(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tv_controladoria_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_comp text := public.ope_competencia_fechada();
  v_ini date := to_date(public.ope_competencia_fechada() || '-01', 'YYYY-MM-DD');
  v_de date;
  v_sql text := '';
  v text;
  v_custo jsonb;
  v_out jsonb;
BEGIN
  v_de := (v_ini - interval '11 months')::date;
  -- Saídas com contrato, por contrato e mês, nos 12 meses (as 6 fontes do Fluxo de Caixa).
  FOREACH v IN ARRAY ARRAY['v_malote_pagamento_fluxo_caixa', 'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
                           'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
                           'v_fluxo_caixa_importado_fluxo_caixa'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      v_sql := v_sql || CASE WHEN v_sql = '' THEN '' ELSE ' UNION ALL ' END
        || format('SELECT contrato_id AS c, date_trunc(''month'', coalesce(competencia, data_pagamento))::date AS m, valor::numeric AS v FROM public.%I '
                  || 'WHERE tipo = ''saida'' AND contrato_id IS NOT NULL AND coalesce(competencia, data_pagamento) >= %L AND coalesce(competencia, data_pagamento) < %L',
                  v, v_de, (v_ini + interval '1 month')::date);
    END IF;
  END LOOP;
  IF v_sql = '' THEN v_sql := 'SELECT NULL::uuid AS c, NULL::date AS m, 0::numeric AS v WHERE false'; END IF;

  EXECUTE format($q$
    WITH custo AS (SELECT c, m, sum(v) AS v FROM (%s) u GROUP BY 1, 2),
    ctr AS (SELECT id, nome, public.tv_ctl_fora_das_despesas(id, nome) AS fora FROM public.contratos),
    nf AS (
      SELECT n.contrato_id AS c, n.competencia AS m, sum(coalesce(n.vlr_bruto_total, 0)) AS bruto, sum(coalesce(n.vlr_liquido_total, 0)) AS liquido,
             sum(coalesce(n.valor_pago, 0)) AS recebido, sum(coalesce(n.desconto_conta_vinculada, 0)) AS cv, count(*) AS qtd
        FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.tipo_nota = 'N' AND n.contrato_id IS NOT NULL AND n.competencia BETWEEN %L AND %L
         AND public.tv_fin_nota_valida(n.status::text, n.situacao_site_pmt, n.situacao_dominio)
       GROUP BY 1, 2),
    linha AS (
      SELECT coalesce(nf.c, cu.c) AS c, coalesce(nf.m, cu.m) AS m,
             coalesce(nf.bruto, 0) AS bruto, coalesce(nf.liquido, 0) AS liquido, coalesce(nf.recebido, 0) AS recebido, coalesce(nf.cv, 0) AS cv,
             coalesce(nf.qtd, 0) AS qtd, CASE WHEN ct.fora THEN 0 ELSE coalesce(cu.v, 0) END AS despesas, ct.nome, coalesce(ct.fora, false) AS fora
        FROM nf FULL JOIN custo cu ON cu.c = nf.c AND cu.m = nf.m
        LEFT JOIN ctr ct ON ct.id = coalesce(nf.c, cu.c)),
    mes AS (SELECT * FROM linha WHERE m = %L),
    porc AS (SELECT nome, sum(liquido) AS liquido, sum(despesas) AS despesas, sum(liquido) - sum(despesas) AS lucro
               FROM mes WHERE NOT fora AND nome IS NOT NULL GROUP BY 1 HAVING sum(liquido) >= 10000)
    SELECT jsonb_build_object(
      'competencia', %L,
      'kpis', (SELECT jsonb_build_object('bruto', round(sum(bruto), 2), 'liquido', round(sum(liquido), 2), 'recebido', round(sum(recebido), 2),
                                         'a_receber', round(sum(liquido) - sum(recebido), 2), 'conta_vinculada', round(sum(cv), 2),
                                         'despesas', round(sum(despesas), 2), 'lucro', round(sum(liquido) - sum(despesas), 2),
                                         'margem', CASE WHEN sum(liquido) > 0 THEN round(100 * (sum(liquido) - sum(despesas)) / sum(liquido), 2) END,
                                         'notas', sum(qtd), 'contratos', count(DISTINCT c) FILTER (WHERE qtd > 0))
                 FROM mes),
      'evolucao', coalesce((SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'), 'liquido', round(l, 2), 'despesas', round(d, 2), 'lucro', round(l - d, 2)) ORDER BY m)
                              FROM (SELECT m, sum(liquido) l, sum(despesas) d FROM linha GROUP BY 1) t), '[]'::jsonb),
      'melhores', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', nome, 'liquido', round(liquido, 2), 'lucro', round(lucro, 2),
                              'margem', round(100 * lucro / liquido, 1)) ORDER BY lucro DESC) FROM (SELECT * FROM porc ORDER BY lucro DESC LIMIT 6) t), '[]'::jsonb),
      'piores', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', nome, 'liquido', round(liquido, 2), 'lucro', round(lucro, 2),
                              'margem', round(100 * lucro / liquido, 1)) ORDER BY lucro) FROM (SELECT * FROM porc WHERE despesas > 0 ORDER BY lucro LIMIT 6) t), '[]'::jsonb),
      'gerado_em', now())
  $q$, v_sql, v_de, v_ini, v_ini, v_comp) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_controladoria_dados() FROM PUBLIC, anon, authenticated;

-- ── 4) PRESIDÊNCIA: o que as outras TVs já calculam ──────────────────────
-- Lucratividade geral e por contrato (Controladoria), contratos vermelhos,
-- postos contratados × cobertos, glosas e clientes insatisfeitos
-- (Indicadores por Contrato), salários e benefícios × orçamento (RH),
-- notas pendentes, retenções (conta vinculada) e inadimplência (Financeiro).
CREATE OR REPLACE FUNCTION public.tv_presidencia_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  RETURN jsonb_build_object(
    'operacional', public.tv_ope_contratos_dados(),
    'controladoria', public.tv_controladoria_dados(),
    'financeiro', public.tv_financeiro_dados(),
    'rh', public.tv_rh_salarios_dados(),
    'gerado_em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.tv_presidencia_dados() FROM PUBLIC, anon, authenticated;

-- Prévias da Gestão das TV's (com login): quem vê as TVs.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['financeiro', 'controladoria', 'presidencia'] LOOP
    EXECUTE format($q$
      CREATE OR REPLACE FUNCTION public.tv_%1$s_previa()
      RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $b$
      BEGIN
        IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
          RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
        END IF;
        RETURN public.tv_%1$s_dados();
      END $b$;
      REVOKE ALL ON FUNCTION public.tv_%1$s_previa() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION public.tv_%1$s_previa() TO authenticated;
    $q$, f);
  END LOOP;
END $$;


-- ── 5) tv_relatorio com os relatórios novos ──────────────────────────────
-- Mesmo corpo da mig 20261111220000, com fin-painel, ctl-painel e pre-painel.
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio)
             || jsonb_build_object('equipe', public.tvg_equipe_meta(i.relatorio));
  ELSIF i.relatorio LIKE 'ind:%' THEN
    v_out := jsonb_build_object('tipo', 'indicador') || coalesce(public.tvg_indicador_dados(substr(i.relatorio, 5)), '{}'::jsonb);
  ELSIF i.relatorio LIKE 'bi:%' THEN
    v_out := jsonb_build_object('tipo', 'bi') || public.tv_bi_dados(substr(i.relatorio, 4)::bigint);
  ELSIF i.relatorio = 'ope-contratos' THEN
    v_out := jsonb_build_object('tipo', 'ope-contratos') || public.tv_ope_contratos_dados();
  ELSIF i.relatorio = 'sup-painel' THEN
    v_out := jsonb_build_object('tipo', 'sup-painel') || public.tv_supply_dados();
  ELSIF i.relatorio = 'rec-painel' THEN
    v_out := jsonb_build_object('tipo', 'rec-painel') || public.tv_recrutamento_dados();
  ELSIF i.relatorio = 'rh-salarios' THEN
    v_out := jsonb_build_object('tipo', 'rh-salarios') || public.tv_rh_salarios_dados();
  ELSIF i.relatorio = 'fin-painel' THEN
    v_out := jsonb_build_object('tipo', 'fin-painel') || public.tv_financeiro_dados();
  ELSIF i.relatorio = 'ctl-painel' THEN
    v_out := jsonb_build_object('tipo', 'ctl-painel') || public.tv_controladoria_dados();
  ELSIF i.relatorio = 'pre-painel' THEN
    v_out := jsonb_build_object('tipo', 'pre-painel') || public.tv_presidencia_dados();
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;


-- ── 6) As playlists ──────────────────────────────────────────────────────
DO $$
DECLARE v_pl uuid; v_dir uuid;
BEGIN
  -- Financeiro
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Financeiro — Controle de Faturamento' LIMIT 1;
  IF v_pl IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Financeiro — Controle de Faturamento', 'Executável × faturado, não emitido, recebido e inadimplência — a conta do Controle de Faturamento.')
    RETURNING id INTO v_pl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'fin-painel') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 10, 'relatorio', 'Controle de Faturamento', 'fin-painel', 3600, true);
  END IF;
  UPDATE public."TV_DISPOSITIVO" SET playlist_id = v_pl
   WHERE ativo AND (id = '4f8a2f72-f433-4fda-adc7-ba5bd7a2adcf'::uuid OR upper(btrim(coalesce(nome, ''))) = 'TV FINANCEIRO');

  -- Controladoria (sem TV cadastrada: só a playlist)
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Controladoria — Faturamento da Empresa' LIMIT 1;
  IF v_pl IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Controladoria — Faturamento da Empresa', 'Faturado, recebido, a receber, despesas, lucro e margem — a conta do Faturamento da Empresa.')
    RETURNING id INTO v_pl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'ctl-painel') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 10, 'relatorio', 'Faturamento da Empresa', 'ctl-painel', 3600, true);
  END IF;

  -- Presidência: a playlist TV DIRETORIA troca a TV gerencial pela nova (o item antigo fica desativado).
  SELECT id INTO v_dir FROM public."TV_PLAYLIST" WHERE nome = 'TV DIRETORIA' LIMIT 1;
  IF v_dir IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao) VALUES ('TV DIRETORIA', 'Presidência') RETURNING id INTO v_dir;
  END IF;
  UPDATE public."TV_ITEM" SET ativo = false WHERE playlist_id = v_dir AND relatorio = 'ger-presidencia';
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_dir AND relatorio = 'pre-painel') THEN
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_dir, 5, 'relatorio', 'Presidência', 'pre-painel', 3600, true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."TV_DISPOSITIVO" SET playlist_id = (SELECT id FROM public."TV_PLAYLIST" WHERE nome = 'TV FINANCEIRO' LIMIT 1)
--  WHERE id = '4f8a2f72-f433-4fda-adc7-ba5bd7a2adcf'::uuid;
-- UPDATE public."TV_ITEM" SET ativo = true WHERE relatorio = 'ger-presidencia';
-- DELETE FROM public."TV_ITEM" WHERE relatorio = 'pre-painel';
-- DELETE FROM public."TV_PLAYLIST" WHERE nome IN ('Financeiro — Controle de Faturamento', 'Controladoria — Faturamento da Empresa');
-- DELETE FROM public."TVG_INDICADOR" WHERE codigo = 'sst_e_afastados';
-- (reexecutar tvg_espelho_sst da mig 20261109003200; tv_relatorio e tv_item_relatorio_check da 20261111220000)
-- DROP FUNCTION IF EXISTS public.tv_presidencia_previa(), public.tv_presidencia_dados(), public.tv_controladoria_previa(),
--   public.tv_controladoria_dados(), public.tv_ctl_fora_das_despesas(uuid, text), public.tv_financeiro_previa(),
--   public.tv_financeiro_dados(), public.tv_fin_nota_valida(text, text, text), public.tv_fin_planilha_executavel(date);
-- NOTIFY pgrst, 'reload schema';
