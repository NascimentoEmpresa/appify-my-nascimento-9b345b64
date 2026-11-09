-- =========================================================================
-- SIS-2026-0635: AS 10 TVs VOLTAM A MOSTRAR OS CARDS DO DOCUMENTO (09/11/2026)
--
-- Pablo: "a playlist gerência operacional tem que aparecer exatamente essas
-- informações desses 7 cards, licitações esses 7 também, e assim em diante".
--
-- POR QUE NÃO BATIA: em 14/10 (migs 20261014000028 a 0040) cada TV virou
-- espelho do dashboard do módulo e os indicadores do documento ficaram com
-- na_tv = false. Eles nunca saíram do catálogo: aqui voltam, na ordem e com os
-- nomes do documento "Indicadores das TVs". Os espelhos deixam a TV.
-- Frota, TI e Treinamento não fazem parte do protótipo: ficam como estavam.
--
-- O QUE É NOVO
--   · TVG_INDICADOR.medida diz o quanto o número responde ao card:
--       real       mede o que o documento pede;
--       parcial    número verdadeiro, mas de um recorte: a TV etiqueta e NÃO
--                  dá semáforo (regra de 14/10: não expor setor por número
--                  que não é o do card);
--       sem_fonte  o ERP não tem o dado: sem número, nem substituto.
--   · medida_nota: o que o número conta, ou o que falta.
--   · meta_texto: a meta como o documento/protótipo escreve. Só onde a escala
--     é a do valor calculado; nos demais a TV usa o texto calculado da meta.
--   · tvg_calc_documento(): Supply passa a ler o pedido de compra real
--     (sup_compra_pedido), com fornecedor e data limite de entrega.
--
-- Orçado × realizado e fluxo de caixa seguem como 'parcial': as tabelas
-- existem, mas o preenchimento e o vínculo com o DRE não puderam ser
-- conferidos em produção quando esta migration foi escrita.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."TVG_INDICADOR"
  ADD COLUMN IF NOT EXISTS medida      text NOT NULL DEFAULT 'real',
  ADD COLUMN IF NOT EXISTS medida_nota text,
  ADD COLUMN IF NOT EXISTS meta_texto  text;
ALTER TABLE public."TVG_INDICADOR" DROP CONSTRAINT IF EXISTS tvg_indicador_medida_check;
ALTER TABLE public."TVG_INDICADOR" ADD CONSTRAINT tvg_indicador_medida_check
  CHECK (medida IN ('real', 'parcial', 'sem_fonte'));

-- ── 2) O visual novo da playlist ─────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_rel_visual_check
  CHECK (rel_visual IS NULL OR rel_visual IN ('classico', 'painel', 'painel-claro', 'graficos', 'dashboard', 'dashboard-escuro', 'documento'));

-- ── 3) Painéis: título e pergunta do documento ───────────────────────────
UPDATE public."TVG_PAINEL" p SET titulo = v.titulo, pergunta = v.pergunta
  FROM (VALUES
    ('ger-operacional', 'Gerência Operacional', 'Qual contrato não está sendo entregue corretamente e qual contrato está consumindo dinheiro?'),
    ('ger-licitacoes', 'Licitações', 'Qual licitação pode ser perdida por prazo, documento, preço ou falha de preparação, e qual contrato vencido ainda não foi encaminhado para implantação?'),
    ('ger-supply', 'Supply', 'O que pode faltar, o que está parado e qual atraso pode interromper a operação?'),
    ('ger-recrutamento', 'Recrutamento e Seleção', 'Qual contrato corre risco de ficar sem trabalhador por falha de recrutamento?'),
    ('ger-rh', 'RH', 'Onde estamos com pessoas demais, pessoas de menos, custos acima do que o contrato suporta ou risco trabalhista?'),
    ('ger-sst', 'SST', 'Quem está trabalhando sem estar legalmente ou tecnicamente apto?'),
    ('ger-financeiro', 'Financeira', 'Quanto dinheiro deveria estar no caixa e ainda não está?'),
    ('ger-juridico', 'Jurídico', 'Qual prazo, processo ou notificação pode gerar perda financeira ou jurídica para a empresa?'),
    ('ger-controladoria', 'Controladoria', 'Onde a empresa está perdendo margem e onde os gestores não estão corrigindo os desvios?'),
    ('ger-presidencia', 'Presidência', 'Onde estamos perdendo dinheiro, onde não estamos cumprindo o contrato e onde algum gestor precisa agir imediatamente?')
  ) AS v(slug, titulo, pergunta)
 WHERE p.slug = v.slug;

-- ── 4) Tudo o que não é do documento sai das 10 TVs ──────────────────────
UPDATE public."TVG_INDICADOR" SET na_tv = false
 WHERE painel IN ('ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                  'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-presidencia');

-- Espelho fora da TV não pode ficar calculando a cada abertura do painel.
-- Só fica ativo o que alguém pôs sozinho numa playlist ("ind:<codigo>").
UPDATE public."TVG_INDICADOR" i SET ativo = false
 WHERE i.espelho_fonte IS NOT NULL
   AND i.painel IN ('ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                    'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-presidencia')
   AND NOT EXISTS (SELECT 1 FROM public."TV_ITEM" t WHERE t.relatorio = 'ind:' || i.codigo);

-- ── 5) Os 62 cards ───────────────────────────────────────────────────────
UPDATE public."TVG_INDICADOR" i SET
  na_tv = true, ativo = true, ordem = v.ordem, nome = v.nome,
  medida = v.medida, medida_nota = v.nota, meta_texto = v.meta_texto,
  meta = coalesce(v.meta, i.meta), alerta = coalesce(v.alerta, i.alerta)
  FROM (VALUES
   -- GERÊNCIA OPERACIONAL
   ('op_postos', 1, 'Postos contratados x postos cobertos', 'real', NULL, '100% de cobertura', NULL::numeric, NULL::numeric),
   ('op_lucratividade', 2, 'Lucratividade por contrato (%)', 'real', NULL, '≥ 12% de lucratividade', 12, 10),
   ('op_custo_direto', 3, 'Custo direto acima do orçado (%)', 'parcial', 'Compara com a média dos 3 meses anteriores, não com o orçado', '≤ 0% (dentro do orçado)', NULL, NULL),
   ('op_glosas', 4, 'Glosas por contrato', 'real', NULL, 'R$ 0 em glosas', NULL, NULL),
   ('op_faltas', 5, 'Faltas por contrato (%)', 'parcial', 'Situação na folha hoje (atestado e falta), não a apuração do ponto', '≤ 3% de faltas', NULL, NULL),
   ('op_turnover', 6, 'Turnover por contrato (%)', 'real', NULL, NULL, NULL, NULL),
   ('op_reclamacoes', 7, 'Reclamações ou baixa satisfação', 'parcial', 'Só notificações formais de cliente; satisfação não é medida no ERP', '0 reclamações e ≥ 90% de satisfação', NULL, NULL),
   -- LICITAÇÕES
   ('lic_prazo', 1, 'Licitações estratégicas com prazo próximo', 'real', NULL, NULL, NULL, NULL),
   ('lic_documentos', 2, 'Documentação ou certidão pendente', 'parcial', 'Capa do edital não preenchida; não há cadastro de certidões', '0 pendências em atraso', NULL, NULL),
   ('lic_propostas', 3, 'Propostas em elaboração x concluídas', 'real', NULL, NULL, NULL, NULL),
   ('lic_risco', 4, 'Licitações com risco de desclassificação', 'sem_fonte', 'O ERP não registra o risco de desclassificação por licitação', '≤ 30% de risco alto', NULL, NULL),
   ('lic_implantacao', 5, 'Licitações vencidas aguardando implantação', 'real', NULL, NULL, NULL, NULL),
   ('lic_perdidas', 6, 'Licitações perdidas e principal motivo', 'real', NULL, NULL, NULL, NULL),
   ('lic_valor', 7, 'Valor potencial das propostas em andamento', 'real', NULL, NULL, NULL, NULL),
   -- SUPPLY
   ('sup_compras_vencidas', 1, 'Compras vencidas e não entregues', 'real', NULL, '0 pedidos em atraso', 0, 3),
   ('sup_abaixo_minimo', 2, 'Itens abaixo do estoque mínimo', 'real', NULL, '0 itens abaixo do estoque mínimo', NULL, NULL),
   ('sup_valor_estoque', 3, 'Valor total do estoque', 'real', NULL, NULL, NULL, NULL),
   ('sup_sem_mov', 4, 'Itens sem movimentação', 'real', NULL, '≤ 90 dias sem movimentação', NULL, NULL),
   ('sup_fornecedor', 5, 'Pedidos em atraso por fornecedor', 'real', NULL, '0 pedidos em atraso', 0, 3),
   ('sup_contratos_sem_entrega', 6, 'Contratos sem entrega de material prevista', 'real', NULL, '0 contratos sem entrega prevista', NULL, NULL),
   -- RECRUTAMENTO E SELEÇÃO
   ('rec_risco', 1, 'Vagas com risco de posto descoberto', 'real', NULL, '0 vagas críticas', NULL, NULL),
   ('rec_abertas', 2, 'Vagas abertas por contrato e cidade', 'real', NULL, NULL, NULL, NULL),
   ('rec_prazo', 3, 'Vagas acima do prazo de preenchimento', 'real', NULL, '≤ 5 vagas acima do prazo', 5, 10),
   ('rec_admissoes', 4, 'Admissões previstas x concluídas', 'real', NULL, '≥ 90% de admissões concluídas', 90, 75),
   ('rec_desistencias', 5, 'Desistências antes da admissão', 'real', NULL, NULL, NULL, NULL),
   -- RH
   ('rh_quadro', 1, 'Colaboradores ativos x necessários por contrato', 'real', NULL, '100% da lotação necessária', NULL, NULL),
   ('rh_salarios', 2, 'Salários e benefícios acima do orçamento (%)', 'parcial', 'Salário-base sobre o faturamento do contrato, não sobre o orçado', '≤ 5% acima do orçamento', NULL, NULL),
   ('rh_turnover', 3, 'Turnover por contrato (%)', 'real', NULL, NULL, NULL, NULL),
   ('rh_absenteismo', 4, 'Absenteísmo por contrato (%)', 'parcial', 'Situação na folha hoje (atestado e falta), não a apuração do ponto', '≤ 5% de absenteísmo', NULL, NULL),
   ('rh_obrigacoes', 5, 'Obrigações trabalhistas — indicador consolidado', 'parcial', 'Só rescisões têm dado; eSocial, banco de horas e folhas corrigidas não', '100% em conformidade', NULL, NULL),
   -- SST
   ('sst_impedidos', 1, 'Trabalhadores com impedimento para exercer a função', 'parcial', 'Soma só o que existe; restrição médica e retorno sem liberação não', '≤ 5 por contrato', NULL, NULL),
   ('sst_aso', 2, 'ASOs vencidos ou a vencer', 'parcial', 'Filas de admissão e demissional; a validade do periódico não existe', '0 ASOs vencidos', NULL, NULL),
   ('sst_treinamentos', 3, 'Treinamentos obrigatórios vencidos', 'parcial', 'Matrículas sem certificado; o ERP não guarda a validade', '0 treinamentos vencidos', NULL, NULL),
   ('sst_epi', 4, 'EPIs pendentes ou com troca vencida', 'parcial', 'Pedidos de EPI parados; não há ficha de entrega e troca', '0 pendências', NULL, NULL),
   ('sst_afastamentos', 5, 'Afastamentos ativos por contrato', 'real', NULL, NULL, NULL, NULL),
   ('sst_acidentes', 6, 'Acidentes e quase acidentes do mês', 'parcial', 'Afastados por acidente hoje; quase acidente não é registrado', '≤ 10 ocorrências/mês', NULL, NULL),
   -- FINANCEIRA
   ('fin_notas_pendentes', 1, 'Notas pendentes de emissão', 'real', NULL, NULL, NULL, NULL),
   ('fin_valor_pendente', 2, 'Valor pendente de faturamento', 'real', NULL, NULL, NULL, NULL),
   ('fin_recebimentos', 3, 'Recebimentos previstos x realizados', 'real', NULL, '≥ 95% de recebimento', 95, 85),
   ('fin_inadimplencia', 4, 'Inadimplência por faixa', 'real', NULL, NULL, NULL, NULL),
   ('fin_fluxo', 5, 'Fluxo de caixa projetado', 'parcial', 'NFs a receber menos despesas do Malote em 30 dias, sem saldo bancário', 'Saldo final ≥ R$ 800 mil', NULL, NULL),
   ('fin_glosas', 6, 'Valores glosados ou retidos', 'real', NULL, NULL, NULL, NULL),
   -- JURÍDICO
   ('jur_prazos', 1, 'Prazos jurídicos próximos ou vencidos', 'real', NULL, NULL, NULL, NULL),
   ('jur_sem_resposta', 2, 'Notificações sem resposta', 'real', NULL, '≤ 5 sem resposta', 5, 10),
   ('jur_audiencias', 3, 'Audiências próximas', 'real', NULL, NULL, NULL, NULL),
   ('jur_contratos_analise', 4, 'Contratos pendentes de análise', 'sem_fonte', 'O ERP não registra a fila de contratos em análise jurídica', '≤ 10 pendentes > 30 dias', NULL, NULL),
   ('jur_risco', 5, 'Processos com risco de perda elevado', 'parcial', 'Processos com pedidos altos; é exposição, não probabilidade de perda', '< 20% com risco elevado', NULL, NULL),
   ('jur_reincidentes', 6, 'Causas trabalhistas reincidentes', 'real', NULL, NULL, NULL, NULL),
   -- CONTROLADORIA
   ('ctl_margem', 1, 'Contratos abaixo da margem mínima', 'real', NULL, '≥ 10% de margem', NULL, NULL),
   ('ctl_desvio', 2, 'Desvio de custo por contrato (%)', 'parcial', 'Compara com a média dos 3 meses anteriores, não com o orçado', '± 5% de desvio', NULL, NULL),
   ('ctl_vermelhos', 3, 'Contratos classificados como vermelhos', 'parcial', 'Classifica só pela margem; o risco combinado não existe', 'Sem contratos em risco crítico', NULL, NULL),
   ('ctl_planos', 4, 'Planos de ação vencidos', 'real', NULL, '0 planos vencidos', NULL, NULL),
   ('ctl_nao_atualizados', 5, 'Indicadores não atualizados', 'sem_fonte', 'Todos os indicadores são calculados; não há data de atualização por setor', 'Atualização em até 7 dias', NULL, NULL),
   ('ctl_reincidentes', 6, 'Desvios reincidentes', 'parcial', 'Margem baixa em 3 competências; não liga o desvio ao plano de ação', 'Reduzir recorrências em 80%', NULL, NULL),
   -- PRESIDÊNCIA
   ('pre_lucratividade', 1, 'Lucratividade geral e por contrato (%)', 'real', NULL, '≥ 12% de lucratividade', 12, 10),
   ('pre_vermelhos', 2, 'Contratos vermelhos', 'parcial', 'Classifica só pela margem; o risco combinado não existe', 'Reduzir contratos críticos', NULL, NULL),
   ('pre_postos', 3, 'Postos contratados x cobertos', 'real', NULL, '100% dos postos cobertos', NULL, NULL),
   ('pre_glosas', 4, 'Glosas e retenções', 'real', NULL, '≤ R$ 100 mil', 100000, 150000),
   ('pre_salarios', 5, 'Salários e benefícios acima do orçamento', 'parcial', 'Salário-base sobre o faturamento do contrato, não sobre o orçado', '≤ 0% (dentro do orçamento)', NULL, NULL),
   ('pre_caixa', 6, 'Notas pendentes e inadimplência', 'real', NULL, '≤ R$ 200 mil vencidos', 200000, 400000),
   ('pre_clientes', 7, 'Clientes insatisfeitos', 'sem_fonte', 'O ERP não tem pesquisa de satisfação de cliente', '≥ 90% de satisfação', NULL, NULL),
   ('pre_planos', 8, 'Planos de ação vencidos', 'real', NULL, '0 planos de ação vencidos', NULL, NULL)
  ) AS v(codigo, ordem, nome, medida, nota, meta_texto, meta, alerta)
 WHERE i.codigo = v.codigo;

UPDATE public."TVG_INDICADOR" SET parametro = NULL, parametro_rotulo = NULL,
  regra = 'Pedidos de compra enviados ou com entrega parcial cuja data limite de entrega já passou (Suprimentos › Pedidos de Compra).'
 WHERE codigo = 'sup_compras_vencidas';
UPDATE public."TVG_INDICADOR" SET
  regra = 'Pedidos de compra com a data limite de entrega vencida, agrupados pelo fornecedor (Suprimentos › Pedidos de Compra).'
 WHERE codigo = 'sup_fornecedor';

-- ── 6) Playlists das 10 TVs abrem no visual novo ─────────────────────────
UPDATE public."TV_ITEM" SET rel_visual = 'documento'
 WHERE relatorio IN ('ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                     'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-presidencia');

-- ── 7) Supply lê o pedido de compra de verdade ───────────────────────────
CREATE OR REPLACE FUNCTION public.tvg_calc_documento(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF p_codigo NOT IN ('sup_compras_vencidas', 'sup_fornecedor') THEN RETURN NULL; END IF;

  RETURN (
    WITH p AS (
      SELECT c.numero, coalesce(nullif(btrim(c.fornecedor_nome), ''), 'Fornecedor não informado') AS fornecedor,
             hoje - c.data_limite_entrega AS dias, coalesce(c.valor_total, 0) AS valor
        FROM public.sup_compra_pedido c
       WHERE c.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND c.data_limite_entrega < hoje
    ),
    f AS (SELECT fornecedor, count(*) AS q, sum(valor) AS v FROM p GROUP BY fornecedor)
    SELECT jsonb_build_object(
      'valor', (SELECT count(*) FROM p),
      'impacto', (SELECT sum(valor) FROM p),
      'afetado', CASE p_codigo
        WHEN 'sup_compras_vencidas' THEN (SELECT numero || ' · ' || fornecedor FROM p ORDER BY dias DESC, valor DESC LIMIT 1)
        ELSE (SELECT fornecedor FROM f ORDER BY q DESC, v DESC LIMIT 1) END,
      'causa', CASE WHEN EXISTS (SELECT 1 FROM p)
        THEN 'Maior atraso: ' || (SELECT max(dias) FROM p) || ' dias após a data limite' END,
      'base', (SELECT count(DISTINCT fornecedor) || ' fornecedor(es) com entrega vencida' FROM p),
      'detalhe', CASE p_codigo
        WHEN 'sup_compras_vencidas' THEN coalesce((
          SELECT jsonb_agg(jsonb_build_object('nome', x.numero || ' · ' || x.fornecedor, 'valor', x.dias) ORDER BY x.dias DESC)
            FROM (SELECT * FROM p ORDER BY dias DESC, valor DESC LIMIT 6) x), '[]'::jsonb)
        ELSE coalesce((
          SELECT jsonb_agg(jsonb_build_object('nome', x.fornecedor, 'valor', x.q) ORDER BY x.q DESC)
            FROM (SELECT * FROM f ORDER BY q DESC, v DESC LIMIT 6) x), '[]'::jsonb) END)
  );
END $$;
REVOKE ALL ON FUNCTION public.tvg_calc_documento(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_calc_documento(text, numeric) TO service_role;

-- ── 8) tvg_resultado: a de 20261019000005 + medida e tvg_calc_documento ──
CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.medida = 'sem_fonte' THEN
    -- Sem dado no ERP: nenhum cálculo roda, para nenhum substituto aparecer como se fosse o card.
    r := jsonb_build_object('valor', NULL, 'origem', 'Sem fonte');
  ELSIF i.fonte = 'auto' THEN
    BEGIN
      r := coalesce(public.tvg_calc_documento(i.codigo, i.parametro), public.tvg_espelho_resultado(i.codigo), public.tvg_calc_espelho(i.codigo, i.parametro),
                    public.tvg_calc_ajuste(i.codigo, i.parametro), public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
      r := coalesce(r, jsonb_build_object('valor', NULL)) || jsonb_build_object('atualizado_em', now(), 'origem', 'ERP');
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('valor', NULL, 'erro', SQLERRM);
    END;
  ELSIF i.fonte = 'manual' THEN
    SELECT * INTO l FROM public."TVG_LANCAMENTO" WHERE indicador = i.codigo ORDER BY referencia DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      r := jsonb_build_object('valor', l.valor, 'afetado', l.afetado, 'causa', l.causa, 'impacto', l.impacto, 'detalhe', l.detalhe,
                              'responsavel', nullif(btrim(l.responsavel), ''), 'referencia', l.referencia, 'atualizado_em', l.created_at,
                              'origem', 'Lançamento', 'observacao', l.observacao);
    ELSE
      r := jsonb_build_object('valor', NULL, 'origem', 'Lançamento');
    END IF;
  ELSIF i.fonte = 'espelho' THEN
    r := (public.tvg_resultado(i.espelho_de, p_nivel + 1)->'resultado') || jsonb_build_object('origem', 'Espelho');
  ELSE
    FOREACH c IN ARRAY coalesce(i.componentes, ARRAY[]::text[]) LOOP
      sub := public.tvg_resultado(c, p_nivel + 1);
      IF sub IS NOT NULL THEN
        partes := partes || jsonb_build_array(jsonb_build_object('nome', sub->>'nome', 'valor', (sub->'resultado'->>'valor')::numeric,
                                                                  'rotulo', CASE WHEN sub->'resultado'->>'valor' IS NULL THEN 'sem dado' END));
        IF (sub->'resultado'->>'valor') IS NOT NULL THEN s := s + (sub->'resultado'->>'valor')::numeric; tem := true; END IF;
      END IF;
    END LOOP;
    r := jsonb_build_object('valor', CASE WHEN tem THEN s END, 'detalhe', partes, 'origem', 'Soma',
                            'afetado', (SELECT count(*) || ' de ' || jsonb_array_length(partes) || ' com pendência' FROM jsonb_array_elements(partes) x WHERE (x->>'valor')::numeric > 0),
                            'causa', (SELECT 'Maior: ' || (x->>'nome') || ' (' || (x->>'valor') || ')' FROM jsonb_array_elements(partes) x
                                       WHERE (x->>'valor')::numeric > 0 ORDER BY (x->>'valor')::numeric DESC LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'identificar', i.identificar, 'regra', i.regra, 'fonte', i.fonte, 'unidade', i.unidade,
    'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'periodicidade', i.periodicidade,
    'responsavel', coalesce(r->>'responsavel', i.responsavel), 'pai', i.pai, 'na_tv', i.na_tv, 'ordem', i.ordem,
    'parametro', i.parametro, 'parametro_rotulo', i.parametro_rotulo, 'espelho_de', i.espelho_de,
    'medida', i.medida, 'medida_nota', i.medida_nota, 'meta_texto', i.meta_texto,
    'resultado', coalesce(r, '{}'::jsonb) - 'responsavel');
END $function$;
REVOKE ALL ON FUNCTION public.tvg_resultado(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_resultado(text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a tvg_resultado de 20261019000005 e:
-- DROP FUNCTION IF EXISTS public.tvg_calc_documento(text, numeric);
-- UPDATE public."TV_ITEM" SET rel_visual = NULL WHERE rel_visual = 'documento';
-- UPDATE public."TVG_INDICADOR" SET ativo = true WHERE espelho_fonte IS NOT NULL;
-- UPDATE public."TVG_INDICADOR" SET na_tv = (espelho_fonte IS NOT NULL)
--  WHERE painel IN ('ger-operacional','ger-licitacoes','ger-supply','ger-recrutamento','ger-rh','ger-sst','ger-financeiro','ger-juridico','ger-controladoria','ger-presidencia');
-- ALTER TABLE public."TVG_INDICADOR" DROP COLUMN IF EXISTS medida, DROP COLUMN IF EXISTS medida_nota, DROP COLUMN IF EXISTS meta_texto;
