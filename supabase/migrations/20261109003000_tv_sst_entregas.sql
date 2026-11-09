-- =========================================================================
-- TV SST: DO QUE FALTA PARA O QUE FOI ENTREGUE (09/11/2026)
--
-- Pablo, olhando "216 trabalhadores com impedimento" e "123 EPIs pendentes" na
-- TV: "tu tá querendo ferrar com o setor de segurança? [...] deixa coisas que
-- não são boas nem ruins ou só boas". Esses números eram recortes parciais
-- (medida = 'parcial' na mig 20261109001000): filas e pedidos, não a validade
-- real de ASO, treinamento ou EPI, que o ERP não guarda. Em área comum, liam
-- como falha do setor.
--
-- O que muda: a TV SST mostra o que o setor ENTREGOU no ano, e afastamentos
-- como acompanhamento. Os cards antigos só saem da TV (na_tv): o cadastro
-- fica, com o cálculo, para voltar se pedirem. Só SST: as outras 9 TVs do
-- documento seguem como estão.
--
-- tvg_espelho_sst é a de 20261019000005 + 5 kpis (índices 7 a 11) + 3 gráficos.
-- Os índices 0 a 6 e o mês a mês não mudam.
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
      jsonb_build_object('rotulo', 'EPIs e uniformes despachados no ano', 'valor', (SELECT count(*) FROM public.sup_pedido x WHERE x.data_despachado >= ano_ini AND x.tipo_pedido IN ('uniforme', 'ambos') AND x.status = 'DESPACHADO'), 'formato', 'n', 'dica', (SELECT count(*) FROM public.sup_pedido x WHERE x.data_despachado >= mes_ini AND x.tipo_pedido IN ('uniforme', 'ambos') AND x.status = 'DESPACHADO') || ' neste mês')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'demissional', 'rotulo', 'ASO demissional'), jsonb_build_object('chave', 'admissional', 'rotulo', 'ASO admissional')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'demissional', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE date_trunc('month', s.sst_em AT TIME ZONE 'America/Sao_Paulo') = g),
                  'admissional', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE date_trunc('month', c.sst_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
                  FROM generate_series(ini, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')), interval '1 month') g)),
    'graficos', jsonb_build_object(
      'entregas_aso', jsonb_build_object('titulo', 'ASOs realizados no ano, por tipo', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Admissional', 'valor', (SELECT count(*) FROM public."WA_CURRICULOS" x WHERE x.sst_em >= ano_ini)),
         jsonb_build_object('nome', 'Demissional', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" x WHERE x.sst_em >= ano_ini)),
         jsonb_build_object('nome', 'Mudança de função', 'valor', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" x WHERE x.sst_em >= ano_ini)))),
      'entregas_trn', jsonb_build_object('titulo', 'Treinamentos concluídos por mês', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YY'), 'valor', (SELECT count(*) FROM public."TRN_CERTIFICADO" x WHERE date_trunc('month', x.emitido_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
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

UPDATE public."TVG_PAINEL" SET pergunta = 'O que a Segurança do Trabalho já entregou este ano para cuidar de quem trabalha?' WHERE slug = 'ger-sst';

UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-sst' AND codigo <> 'sst_afastamentos';
UPDATE public."TVG_INDICADOR" SET na_tv = true, ordem = 6 WHERE codigo = 'sst_afastamentos';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque, medida)
VALUES
 ('sst_e_aso_adm', 'ger-sst', 1, 'ASOs admissionais realizados no ano', 'ASOs admissionais realizados no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no ERP desde 1º de janeiro.', 'sst', 'kpi:7', 'entregas_aso', 1, 'real'),
 ('sst_e_aso_dem', 'ger-sst', 2, 'ASOs demissionais realizados no ano', 'ASOs demissionais realizados no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no ERP desde 1º de janeiro.', 'sst', 'kpi:8', NULL, NULL, 'real'),
 ('sst_e_troca', 'ger-sst', 3, 'Mudanças de função atendidas no ano', 'Mudanças de função atendidas no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no ERP desde 1º de janeiro.', 'sst', 'kpi:9', NULL, NULL, 'real'),
 ('sst_e_treinamentos', 'ger-sst', 4, 'Treinamentos concluídos no ano', 'Treinamentos concluídos no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no ERP desde 1º de janeiro.', 'sst', 'kpi:10', 'entregas_trn', 2, 'real'),
 ('sst_e_epi', 'ger-sst', 5, 'EPIs e uniformes despachados no ano', 'EPIs e uniformes despachados no ano — entregas do SST.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'SST', true,
  'Contagem do que o SST registrou no ERP desde 1º de janeiro.', 'sst', 'kpi:11', 'entregas_epi', 3, 'real')
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico,
  espelho_destaque = EXCLUDED.espelho_destaque, medida = EXCLUDED.medida;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (a função pode ficar: os kpis novos só são lidos pelos cards sst_e_*)
-- DELETE FROM public."TVG_INDICADOR" WHERE codigo LIKE 'sst_e_%';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('sst_impedidos','sst_aso','sst_treinamentos','sst_epi','sst_acidentes');
-- UPDATE public."TVG_PAINEL" SET pergunta = 'Quem está trabalhando sem estar legalmente ou tecnicamente apto?' WHERE slug = 'ger-sst';
