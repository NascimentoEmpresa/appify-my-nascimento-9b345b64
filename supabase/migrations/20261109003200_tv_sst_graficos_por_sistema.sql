-- =========================================================================
-- TV SST: UM GRÁFICO POR SISTEMA DO MÓDULO (09/11/2026)
--
-- Pablo, com o menu do SST aberto: "faz gráficos desses sistemas aqui pra
-- colocar na TV do SST". Um card, com gráfico, para cada tela: ASO Demissional,
-- Controle de CA, Laudos de EPI, ASO / Admissão, Mudança de Função — ASO,
-- Afastamentos e Telemedicina, Controle de Afastamentos; mais Treinamentos.
-- O visual da TV mostra 4 cards por tela: são 2 telas.
--
-- Segue a regra da mig 20261109003000: só o que o setor fez. Nada de vencido,
-- pendente, nome de pessoa ou CID (a TV fica em área comum).
-- Sai da TV: EPIs despachados e afastamentos ativos (cadastro mantido).
--
-- tvg_espelho_sst é a da 20261109003000 + 4 kpis (índices 12 a 15) + 7 gráficos.
-- =========================================================================

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
      jsonb_build_object('rotulo', 'Retornos ao trabalho no ano', 'valor', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.data_retorno_real >= (ano_ini AT TIME ZONE 'America/Sao_Paulo')::date), 'formato', 'n', 'dica', (SELECT count(*) FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.data_retorno_real >= (mes_ini AT TIME ZONE 'America/Sao_Paulo')::date) || ' neste mês')),
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
 ('sst_e_aso_dem', 'ger-sst', 1, 'ASOs demissionais realizados no ano', 'ASOs demissionais realizados no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:8', 'sis_dem', 2, 'real'),
 ('sst_e_ca', 'ger-sst', 2, 'EPIs em estoque com CA válido', 'EPIs em estoque com CA válido — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:12', 'sis_ca', NULL, 'real'),
 ('sst_e_laudos', 'ger-sst', 3, 'Laudos de EPI ativos', 'Laudos de EPI ativos — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:13', 'sis_laudo', NULL, 'real'),
 ('sst_e_aso_adm', 'ger-sst', 4, 'ASOs admissionais realizados no ano', 'ASOs admissionais realizados no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:7', 'sis_adm', 1, 'real'),
 ('sst_e_troca', 'ger-sst', 5, 'Mudanças de função atendidas no ano', 'Mudanças de função atendidas no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:9', 'sis_troca', NULL, 'real'),
 ('sst_e_tele', 'ger-sst', 6, 'Telemedicinas realizadas no ano', 'Telemedicinas realizadas no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:14', 'sis_tele', 3, 'real'),
 ('sst_e_retornos', 'ger-sst', 7, 'Retornos ao trabalho no ano', 'Retornos ao trabalho no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:15', 'sis_retorno', NULL, 'real'),
 ('sst_e_treinamentos', 'ger-sst', 8, 'Treinamentos concluídos no ano', 'Treinamentos concluídos no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no sistema de origem.', 'sst', 'kpi:10', 'entregas_trn', NULL, 'real')
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico,
  espelho_destaque = EXCLUDED.espelho_destaque, medida = EXCLUDED.medida;

UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-sst' AND codigo NOT IN ('sst_e_aso_dem', 'sst_e_ca', 'sst_e_laudos', 'sst_e_aso_adm', 'sst_e_troca', 'sst_e_tele', 'sst_e_retornos', 'sst_e_treinamentos');

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: DELETE dos códigos sst_e_ca, sst_e_laudos, sst_e_tele, sst_e_retornos e
-- UPDATE ... SET na_tv = true em sst_e_epi e sst_afastamentos (a função pode ficar).
