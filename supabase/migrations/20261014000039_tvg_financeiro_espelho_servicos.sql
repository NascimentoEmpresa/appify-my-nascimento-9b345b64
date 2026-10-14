-- =========================================================================
-- TV FINANCEIRO = FINANCEIRO › RELATÓRIO DE SERVIÇOS › DASHBOARD (14/10/2026)
--
-- Pablo: a TV Financeiro espelha "/app/financeiro/relatorio-servicos — o
-- dashboard do relatório de serviços". A tela lê nf_emissao de todas as
-- empresas (fora da lixeira) + os itens, e calcula no navegador
-- (DashboardRelatorioServicos.tsx + nf-emissao/shared.tsx); aqui, as mesmas
-- regras, sem filtro (o padrão da tela):
--   · fora do relatório: rascunho e enviada;
--   · status da nota: Cancelada (situação site/domínio CANCELADA ou status
--     cancelada) · Substituída · Pago (tem data de pagamento) · Pendente;
--   · Cancelada/Substituída aparecem (Total de Notas, situação), mas não
--     somam dinheiro;
--   · pendente da nota = líquido − pago − conta vinculada − descontos depois
--     da NF (0 para cancelada/substituída pelo site/domínio);
--   · descontos = conta vinculada + os 8 campos de desconto dos itens.
-- Cartões: Total de Notas, Valor Executado, Faturado, Recebido, Pendente,
-- Total de Descontos. Gráficos: Situação das notas, Maiores valores pendentes
-- por contrato, Composição dos descontos; tendência = evolução por
-- competência (faturado × recebido, as 12 últimas).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_espelho_financeiro()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  WITH n AS (
    SELECT n.*, c.nome AS contrato_nome,
           CASE WHEN 'CANCELADA' IN (upper(coalesce(n.situacao_site_pmt, '')), upper(coalesce(n.situacao_dominio, ''))) THEN 'CANCELADA'
                WHEN 'SUBSTITUIDA' IN (upper(coalesce(n.situacao_site_pmt, '')), upper(coalesce(n.situacao_dominio, ''))) THEN 'SUBSTITUIDA' END AS esp
      FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
     WHERE n.deleted_at IS NULL AND n.status::text NOT IN ('rascunho', 'enviada')),
  i AS (SELECT it.nf_emissao_id,
               sum(coalesce(it.multas_pos_emissao, 0) + coalesce(it.glosas_pos_emissao, 0) + coalesce(it.outros_descontos_pos_emissao, 0)) AS pos,
               sum(coalesce(it.faltas, 0) + coalesce(it.posto_nao_implementado, 0) + coalesce(it.multas, 0) + coalesce(it.multas_pos_emissao, 0)
                   + coalesce(it.glosas, 0) + coalesce(it.glosas_pos_emissao, 0) + coalesce(it.outros_descontos, 0) + coalesce(it.outros_descontos_pos_emissao, 0)) AS desc_itens
          FROM public.nf_emissao_item it JOIN n ON n.id = it.nf_emissao_id GROUP BY 1),
  s AS (
    SELECT n.*, coalesce(i.pos, 0) AS pos, coalesce(i.desc_itens, 0) AS desc_itens,
           CASE WHEN esp = 'CANCELADA' OR n.status::text = 'cancelada' THEN 'cancelada' WHEN esp = 'SUBSTITUIDA' THEN 'substituida'
                WHEN n.data_pagamento IS NOT NULL THEN 'pago' ELSE 'pendente' END AS st,
           CASE WHEN esp IS NOT NULL THEN 0
                ELSE greatest(0, coalesce(n.vlr_liquido_total, 0) - coalesce(n.valor_pago, 0) - coalesce(n.desconto_conta_vinculada, 0) - coalesce(i.pos, 0)) END AS pendente
      FROM n LEFT JOIN i ON i.nf_emissao_id = n.id),
  k AS (SELECT * FROM s WHERE st NOT IN ('cancelada', 'substituida')),
  comp AS (SELECT competencia, sum(coalesce(valor_contrato_exec_total, 0)) exe, sum(coalesce(vlr_bruto_total, 0)) fat, sum(coalesce(valor_pago, 0)) rec
             FROM k GROUP BY 1 ORDER BY 1 DESC LIMIT 12)
  SELECT jsonb_build_object(
    'tela', 'Financeiro › Relatório de Serviços › Dashboard',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Total de Notas', 'valor', (SELECT count(*) FROM s), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Valor Executado', 'valor', (SELECT round(coalesce(sum(valor_contrato_exec_total), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Faturado', 'valor', (SELECT round(coalesce(sum(vlr_bruto_total), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Recebido', 'valor', (SELECT round(coalesce(sum(valor_pago), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Pendente', 'valor', (SELECT round(coalesce(sum(pendente), 0), 2) FROM k), 'formato', 'brl',
                         'dica', (SELECT replace(round(100.0 * count(*) FILTER (WHERE st = 'pago') / nullif(count(*), 0), 1)::text, '.', ',') || '% das notas pagas' FROM s)),
      jsonb_build_object('rotulo', 'Total de Descontos', 'valor', (SELECT round(coalesce(sum(coalesce(desconto_conta_vinculada, 0) + desc_itens), 0), 2) FROM k), 'formato', 'brl',
                         'dica', (SELECT replace(round(100 * sum(coalesce(desconto_conta_vinculada, 0) + desc_itens) / nullif(sum(valor_contrato_exec_total), 0), 1)::text, '.', ',') || '% do executado' FROM k))),
    'mensal', jsonb_build_object('unidade', 'brl',
      'series', jsonb_build_array(jsonb_build_object('chave', 'faturado', 'rotulo', 'Faturado'), jsonb_build_object('chave', 'recebido', 'rotulo', 'Recebido')),
      'dados', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(competencia, 'YYYY-MM'), 'faturado', round(fat, 2), 'recebido', round(rec, 2), 'executado', round(exe, 2)) ORDER BY competencia) FROM comp), '[]'::jsonb)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação das notas', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', x.rotulo, 'valor', q) ORDER BY x.o)
           FROM (VALUES (1, 'pago', 'Pago'), (2, 'pendente', 'Pendente'), (3, 'substituida', 'Substituída'), (4, 'cancelada', 'Cancelada')) x(o, st, rotulo)
           CROSS JOIN LATERAL (SELECT count(*) q FROM s WHERE s.st = x.st) c WHERE q > 0), '[]'::jsonb)),
      'pendencias', jsonb_build_object('titulo', 'Maiores valores pendentes por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(v, 2)) ORDER BY v DESC)
           FROM (SELECT coalesce(contrato_nome, 'Sem contrato') nome, sum(pendente) v FROM s GROUP BY 1 HAVING sum(pendente) > 0 ORDER BY 2 DESC LIMIT 7) t), '[]'::jsonb)),
      'descontos', jsonb_build_object('titulo', 'Composição dos descontos', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', rotulo, 'valor', round(v, 2)) ORDER BY o)
           FROM (SELECT 1 o, 'Faltas' rotulo, (SELECT coalesce(sum(it.faltas), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id) v
                 UNION ALL SELECT 2, 'Posto não implementado', (SELECT coalesce(sum(it.posto_nao_implementado), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 3, 'Multas', (SELECT coalesce(sum(coalesce(it.multas, 0) + coalesce(it.multas_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 4, 'Glosas', (SELECT coalesce(sum(coalesce(it.glosas, 0) + coalesce(it.glosas_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 5, 'Outros descontos', (SELECT coalesce(sum(coalesce(it.outros_descontos, 0) + coalesce(it.outros_descontos_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 6, 'Conta vinculada', (SELECT coalesce(sum(desconto_conta_vinculada), 0) FROM k)) z))))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_financeiro() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  IF p_fonte = 'geral' THEN RETURN public.tvg_espelho_geral(); END IF;
  IF p_fonte = 'turnover' THEN RETURN public.tvg_espelho_turnover(); END IF;
  IF p_fonte = 'frota' THEN RETURN public.tvg_espelho_frota(); END IF;
  IF p_fonte = 'financeiro' THEN RETURN public.tvg_espelho_financeiro(); END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(text) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: os 6 cartões da tela, na ordem; gráficos situação · pendências por contrato · descontos ─
UPDATE public."TVG_INDICADOR" SET na_tv = false WHERE painel = 'ger-financeiro' AND espelho_fonte IS NULL;
UPDATE public."TVG_PAINEL" SET espelho_fonte = 'financeiro', espelho_series = ARRAY['faturado', 'recebido'] WHERE slug = 'ger-financeiro';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, na_tv, regra,
   espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
VALUES
 ('fin_rs_notas', 'ger-financeiro', 1, 'Total de Notas', 'Total de Notas — Dashboard do Relatório de Serviços.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Total de Notas.', 'financeiro', 'kpi:0', 'situacao', 1),
 ('fin_rs_executado', 'ger-financeiro', 2, 'Valor Executado', 'Valor Executado — Dashboard do Relatório de Serviços.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Executado.', 'financeiro', 'kpi:1', NULL, NULL),
 ('fin_rs_faturado', 'ger-financeiro', 3, 'Valor Faturado', 'Valor Faturado — Dashboard do Relatório de Serviços.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Faturado.', 'financeiro', 'kpi:2', NULL, NULL),
 ('fin_rs_recebido', 'ger-financeiro', 4, 'Valor Recebido', 'Valor Recebido — Dashboard do Relatório de Serviços.', 'auto', 'brl', 'maior', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Recebido.', 'financeiro', 'kpi:3', NULL, NULL),
 ('fin_rs_pendente', 'ger-financeiro', 5, 'Valor Pendente', 'Valor Pendente — Dashboard do Relatório de Serviços.', 'auto', 'brl', 'menor', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Pendente.', 'financeiro', 'kpi:4', 'pendencias', 2),
 ('fin_rs_descontos', 'ger-financeiro', 6, 'Total de Descontos', 'Total de Descontos — Dashboard do Relatório de Serviços.', 'auto', 'brl', 'menor', NULL, NULL, 'diaria', 'Financeiro', true,
  'Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Total de Descontos.', 'financeiro', 'kpi:5', 'descontos', 3)
ON CONFLICT (codigo) DO UPDATE SET
  ordem = EXCLUDED.ordem, nome = EXCLUDED.nome, unidade = EXCLUDED.unidade, sentido = EXCLUDED.sentido, na_tv = true, regra = EXCLUDED.regra,
  espelho_fonte = EXCLUDED.espelho_fonte, espelho_item = EXCLUDED.espelho_item, espelho_grafico = EXCLUDED.espelho_grafico, espelho_destaque = EXCLUDED.espelho_destaque;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE espelho_fonte = 'financeiro';
-- UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = 'ger-financeiro';
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('fin_fluxo', 'fin_glosas', 'fin_inadimplencia', 'fin_notas_pendentes', 'fin_recebido_mes', 'fin_recebimentos', 'fin_valor_pendente');
-- DROP FUNCTION public.tvg_espelho_financeiro(); tvg_espelho_fonte_extra: reaplicar a da 20261014000038.
