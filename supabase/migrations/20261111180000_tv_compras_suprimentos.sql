-- =========================================================================
-- TV › COMPRAS — SUPRIMENTOS (11/11/2026)
--
-- Pablo, com a tabela "Indicador na TV × o que a empresa precisa identificar":
--   1. Compras vencidas e não entregues     4. Itens sem movimentação
--   2. Itens abaixo do estoque mínimo       5. Pedidos em atraso por fornecedor
--   3. Valor total do estoque               6. Contratos sem entrega de material prevista
-- "TV Compras, já muda ela pra mim também, desenvolve essa nova tela pra ela e
-- já atualiza. Os itens abaixo do estoque mínimo precisam de um gráfico que
-- mostre os itens que mais estão abaixo do mínimo, mostrando o mínimo junto,
-- pode ser uma tabela."
--
-- Relatório de TV novo, 'sup-painel' (src/pages/tv/relatorio/paginasSupPainel.tsx):
-- visão geral dos 6 e páginas de detalhe que se revezam. As contas são as
-- MESMAS dos cards da TV gerencial Supply (tvg_calc / tvg_ia_dados, mig
-- 20261019000005), com as mesmas janelas padrão (15, 10 e 90 dias), só com o
-- detalhe que a tela pede:
--   · estoque: sup_estoque_item (não arquivado) × sup_estoque_saldo
--     (disponível/físico), valor = físico × valor unitário;
--   · pedidos: sup_pedido (pedido interno de material/uniforme por contrato);
--   · FORNECEDOR: sup_compra_pedido (pedido de compra enviado ao fornecedor,
--     com data-limite de entrega). Em 11/11/2026 há só 3 pedidos de compra,
--     nenhum enviado e em aberto: a TV mostra que não há atraso registrado e
--     diz que a fonte ainda é pequena — nunca inventa fornecedor.
--
-- PRIVACIDADE: nada de nome de colaborador; só item, contrato e fornecedor.
-- A TV COMPRAS passa a tocar a playlist nova (a antiga, com a TV gerencial
-- Supply, fica guardada). Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Relatório novo no item ────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos', 'sup-painel'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 2) Os dados da TV ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_supply_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  d_compra int := 15;   -- compras vencidas: aguardando compra há mais de 15 dias
  d_entrega int := 10;  -- contratos sem entrega: pedido parado há mais de 10 dias
  d_parado int := 90;   -- sem movimentação há mais de 90 dias
  v_estoque jsonb; v_pedidos jsonb; v_fornecedor jsonb;
BEGIN
  -- Estoque (abaixo do mínimo, valor, sem movimentação)
  WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
  i AS (SELECT ei.id, it.nome, it.tipo, nullif(btrim(coalesce(it.tamanho, '')), '') AS tamanho,
               coalesce(ei.estoque_minimo, 0) AS minimo, coalesce(ei.valor_unitario, 0) AS vu,
               coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis
          FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
          LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL),
  abaixo AS (SELECT * FROM i WHERE minimo > 0 AND disp < minimo),
  parado AS (SELECT i.* FROM i WHERE i.fis > 0
               AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = i.id AND m.created_at >= now() - make_interval(days => d_parado))
               AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = i.id AND c.consumido_em >= now() - make_interval(days => d_parado)))
  SELECT jsonb_build_object(
    'itens', (SELECT count(*) FROM i),
    'com_minimo', (SELECT count(*) FROM i WHERE minimo > 0),
    'abaixo_minimo', jsonb_build_object(
      'qtd', (SELECT count(*) FROM abaixo),
      'zerados', (SELECT count(*) FROM abaixo WHERE disp <= 0),
      'reposicao', (SELECT round(coalesce(sum((minimo - disp) * vu), 0), 2) FROM abaixo),
      -- Os que MAIS estão abaixo: menor % do mínimo primeiro, depois a maior falta.
      'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'tamanho', tamanho, 'disp', disp, 'minimo', minimo,
                                  'falta', minimo - disp, 'pct', round(100.0 * greatest(disp, 0) / minimo, 1)) ORDER BY ord, falta DESC)
                           FROM (SELECT *, greatest(disp, 0)::numeric / minimo AS ord, minimo - disp AS falta FROM abaixo
                                  ORDER BY greatest(disp, 0)::numeric / minimo, minimo - disp DESC LIMIT 14) t), '[]'::jsonb)),
    'valor', jsonb_build_object(
      'total', (SELECT round(coalesce(sum(fis * vu), 0), 2) FROM i),
      'itens_com_saldo', (SELECT count(*) FROM i WHERE fis > 0),
      'por_tipo', coalesce((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'valor', v) ORDER BY v DESC)
                              FROM (SELECT coalesce(nullif(btrim(tipo), ''), 'Outros') AS tipo, round(sum(fis * vu), 2) AS v FROM i WHERE fis > 0 GROUP BY 1) t), '[]'::jsonb),
      'maiores', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'tamanho', tamanho, 'qtd', fis, 'valor', v) ORDER BY v DESC)
                             FROM (SELECT nome, tamanho, fis, round(fis * vu, 2) AS v FROM i WHERE fis > 0 ORDER BY fis * vu DESC LIMIT 8) t), '[]'::jsonb)),
    'sem_mov', jsonb_build_object(
      'dias', d_parado,
      'qtd', (SELECT count(*) FROM parado),
      'valor', (SELECT round(coalesce(sum(fis * vu), 0), 2) FROM parado),
      'itens', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'tamanho', tamanho, 'qtd', fis, 'valor', v) ORDER BY v DESC)
                           FROM (SELECT nome, tamanho, fis, round(fis * vu, 2) AS v FROM parado ORDER BY fis * vu DESC LIMIT 10) t), '[]'::jsonb))
  ) INTO v_estoque;

  -- Pedidos internos (compras vencidas, contratos sem entrega)
  WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, p.status, hoje - p.data_solicitacao AS dias
               FROM public.sup_pedido p
              WHERE p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao IS NOT NULL),
  vencidas AS (SELECT * FROM p WHERE status = 'AGUARDANDO COMPRA' AND dias > d_compra),
  parados AS (SELECT * FROM p WHERE dias > d_entrega)
  SELECT jsonb_build_object(
    'compras_vencidas', jsonb_build_object(
      'dias', d_compra, 'qtd', (SELECT count(*) FROM vencidas),
      'contratos', (SELECT count(DISTINCT contrato) FROM vencidas),
      'mais_antigo', (SELECT max(dias) FROM vencidas),
      'por_contrato', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'qtd', q, 'dias', d) ORDER BY q DESC, d DESC)
                                  FROM (SELECT contrato, count(*) q, max(dias) d FROM vencidas GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 10) t), '[]'::jsonb)),
    'sem_entrega', jsonb_build_object(
      'dias', d_entrega, 'contratos', (SELECT count(DISTINCT contrato) FROM parados), 'pedidos', (SELECT count(*) FROM parados),
      'por_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'qtd', q) ORDER BY q DESC)
                                FROM (SELECT status, count(*) q FROM parados GROUP BY 1) t), '[]'::jsonb),
      'por_contrato', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'qtd', q, 'dias', d) ORDER BY d DESC, q DESC)
                                  FROM (SELECT contrato, count(*) q, max(dias) d FROM parados GROUP BY 1 ORDER BY 3 DESC, 2 DESC LIMIT 10) t), '[]'::jsonb))
  ) INTO v_pedidos;

  -- Pedido de compra ao fornecedor: enviado, não entregue, passou da data-limite.
  WITH c AS (SELECT coalesce(nullif(btrim(fornecedor_nome), ''), 'Fornecedor não informado') AS fornecedor,
                    coalesce(valor_total, 0) AS valor, hoje - data_limite_entrega AS atraso, status
               FROM public.sup_compra_pedido
              WHERE coalesce(status, '') NOT IN ('rascunho', 'cancelado')),
  atraso AS (SELECT * FROM c WHERE atraso > 0 AND coalesce(status, '') NOT IN ('entregue', 'recebido', 'concluido', 'finalizado'))
  SELECT jsonb_build_object(
    'registrados', (SELECT count(*) FROM public.sup_compra_pedido),
    'enviados', (SELECT count(*) FROM c),
    'em_atraso', (SELECT count(*) FROM atraso),
    'por_fornecedor', coalesce((SELECT jsonb_agg(jsonb_build_object('fornecedor', fornecedor, 'qtd', q, 'valor', v, 'dias', d) ORDER BY q DESC, d DESC)
                                  FROM (SELECT fornecedor, count(*) q, round(sum(valor), 2) v, max(atraso) d FROM atraso GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)
  ) INTO v_fornecedor;

  RETURN jsonb_build_object('estoque', v_estoque, 'pedidos', v_pedidos, 'fornecedor', v_fornecedor, 'gerado_em', now());
END $fn$;
REVOKE ALL ON FUNCTION public.tv_supply_dados() FROM PUBLIC, anon, authenticated;

-- Prévia da Gestão das TV's (com login): quem vê as TVs.
CREATE OR REPLACE FUNCTION public.tv_supply_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_supply_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_supply_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_supply_previa() TO authenticated;

-- ── 3) tv_relatorio com o relatório novo ─────────────────────────────────
-- Mesmo corpo da mig 20261111130000, com o ramo 'sup-painel'.
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

-- ── 4) A playlist e a TV COMPRAS tocando ela ─────────────────────────────
DO $$
DECLARE v_pl uuid;
BEGIN
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Compras — Suprimentos' LIMIT 1;
  IF v_pl IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Compras — Suprimentos',
            'Os 6 indicadores de Suprimentos: compras vencidas, estoque mínimo, valor do estoque, itens parados, atraso de fornecedor e contratos sem entrega.')
    RETURNING id INTO v_pl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'sup-painel') THEN
    -- Um item só: as páginas giram dentro dele, 15 s cada (paginasSupPainel.tsx).
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 10, 'relatorio', 'Suprimentos', 'sup-painel', 3600, true);
  END IF;
  UPDATE public."TV_DISPOSITIVO" SET playlist_id = v_pl
   WHERE ativo AND (id = '130f9eff-385a-4678-880f-f2334b2ecf55'::uuid OR upper(btrim(coalesce(nome, ''))) = 'TV COMPRAS');
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."TV_DISPOSITIVO" SET playlist_id = (SELECT id FROM public."TV_PLAYLIST" WHERE nome = 'TV COMPRAS' LIMIT 1)
--  WHERE id = '130f9eff-385a-4678-880f-f2334b2ecf55'::uuid;
-- DELETE FROM public."TV_PLAYLIST" WHERE nome = 'Compras — Suprimentos';
-- (reexecutar o CREATE de tv_relatorio e o tv_item_relatorio_check da mig 20261111130000)
-- DROP FUNCTION IF EXISTS public.tv_supply_previa();
-- DROP FUNCTION IF EXISTS public.tv_supply_dados();
-- NOTIFY pgrst, 'reload schema';
