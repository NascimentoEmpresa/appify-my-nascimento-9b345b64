-- =========================================================================
-- TVs GERENCIAIS: TV SUPPLY = ESPELHO DO DASHBOARD DE COMPRAS (14/10/2026)
--
-- Pablo, com a TV Supply ao lado de Suprimentos › Dashboard de Compras:
-- "não bate com os valores que estão no dashboard deles […] as informações
-- não podem ser criadas aleatoriamente, tem que ser um espelho praticamente
-- do dashboard de cada sistema, ou dos relatórios".
--
-- A TV fazia contas próprias: "despachados" = tudo que saiu no mês, inclusive
-- pedido antigo (279 × 83 do dashboard); estoque = saldo FÍSICO (481 mil ×
-- 474 mil, que é o DISPONÍVEL); e quatro indicadores que não existem no
-- dashboard (compras vencidas, pedidos em atraso por tipo, contratos sem
-- entrega, itens sem movimentação). Agora a TV Supply repete a Visão Geral do
-- dashboard com as MESMAS regras de sup_dashboard_compras_estoque (lidas, não
-- chamadas: aquela RPC exige login com acesso à tela e à empresa, e a TV não
-- tem login): empresa HAGG (a do dashboard; é onde está o Supply — 324 de 341
-- pedidos do mês e todo o estoque), período = mês corrente (o filtro 01 a 31
-- do mês no dashboard). Conferido em 14/10: 324 solicitações, 239 pendentes,
-- 83 despachadas, 4,0 dias, R$ 474.122 em estoque — iguais à tela.
-- Os quatro sem fonte saem da TV (na_tv = false; continuam cadastrados).
--
-- Como: tvg_calc_espelho(codigo) — os indicadores que ESPELHAM um dashboard
-- ou relatório do módulo — é consultada antes de tvg_calc_ajuste/tvg_calc/
-- tvg_calc_extra em tvg_resultado (e em tvg_fonte, para a I.A).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_calc_espelho(p_codigo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  fim date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 month - 1 day')::date;
  v_emp uuid; r jsonb;
BEGIN
  -- ── Supply: Suprimentos › Dashboard de Compras (sup_dashboard_compras_estoque) ─
  IF p_codigo IN ('sup_solicitacoes', 'sup_pendentes', 'sup_despachados', 'sup_tempo_atendimento') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH pedidos AS (SELECT p.* FROM public.sup_pedido p WHERE p.empresa_id = v_emp AND p.data_solicitacao BETWEEN ini AND fim),
    por_contrato AS (SELECT coalesce(contrato_nome, 'Sem contrato') AS nome, count(*) AS q,
                            count(*) FILTER (WHERE status = 'DESPACHADO') AS d,
                            count(*) FILTER (WHERE status NOT IN ('DESPACHADO', 'CANCELADO')) AS pend,
                            round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400) FILTER (WHERE data_despachado IS NOT NULL)::numeric, 1) AS tm
                       FROM pedidos GROUP BY 1)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo
                 WHEN 'sup_solicitacoes' THEN (SELECT count(*) FROM pedidos)
                 WHEN 'sup_pendentes' THEN (SELECT count(*) FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO'))
                 WHEN 'sup_despachados' THEN (SELECT count(*) FROM pedidos WHERE status = 'DESPACHADO')
                 ELSE COALESCE((SELECT round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400)::numeric, 1) FROM pedidos WHERE data_despachado IS NOT NULL), 0) END,
      'afetado', CASE p_codigo
                   WHEN 'sup_despachados' THEN (SELECT CASE WHEN count(*) = 0 THEN '—' ELSE round(100.0 * count(*) FILTER (WHERE status = 'DESPACHADO') / count(*)) || '% das ' || count(*) || ' solicitações do mês' END FROM pedidos)
                   WHEN 'sup_pendentes' THEN (SELECT count(*) || ' solicitações no mês · ' || count(*) FILTER (WHERE status = 'DESPACHADO') || ' despachadas' FROM pedidos)
                   WHEN 'sup_tempo_atendimento' THEN (SELECT count(*) FILTER (WHERE data_despachado IS NOT NULL) || ' pedido(s) despachado(s), da solicitação ao despacho' FROM pedidos)
                   ELSE (SELECT count(DISTINCT coalesce(contrato_nome, 'Sem contrato')) || ' contrato(s)' FROM pedidos) END,
      'causa', CASE WHEN p_codigo = 'sup_pendentes' THEN
                 (SELECT 'Maior motivo: ' || CASE status WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra' WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                                                         WHEN 'EM PREPARACAO' THEN 'Em preparação' ELSE initcap(lower(status)) END || ' (' || count(*) || ')'
                    FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO') GROUP BY status ORDER BY count(*) DESC LIMIT 1) END,
      'base', 'Igual a Suprimentos › Dashboard de Compras (Visão Geral), empresa HAGG, de ' || to_char(ini, 'DD/MM') || ' a ' || to_char(fim, 'DD/MM'),
      'detalhe', CASE p_codigo
        WHEN 'sup_pendentes' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
            FROM (SELECT CASE status WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra' WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                                     WHEN 'EM PREPARACAO' THEN 'Em preparação' ELSE initcap(lower(status)) END AS nome, count(*) q
                    FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO') GROUP BY status) t), '[]'::jsonb)
        WHEN 'sup_tempo_atendimento' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', tm, 'rotulo', replace(tm::text, '.', ',') || ' d') ORDER BY tm DESC)
            FROM (SELECT * FROM por_contrato WHERE tm IS NOT NULL ORDER BY tm DESC LIMIT 10) t), '[]'::jsonb)
        WHEN 'sup_despachados' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', d, 'rotulo', d || ' de ' || q) ORDER BY d DESC)
            FROM (SELECT * FROM por_contrato WHERE d > 0 ORDER BY d DESC LIMIT 10) t), '[]'::jsonb)
        ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'a', q, 'b', d, 'valor', q, 'rotulo', q || ' · ' || d || ' despachada(s)') ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato ORDER BY q DESC LIMIT 10) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sup_valor_estoque', 'sup_abaixo_minimo') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH estoque AS (
      SELECT ei.id, i.nome AS item, i.tipo AS categoria, ei.estoque_minimo,
             COALESCE(sum(s.disponivel), 0)::numeric AS disponivel, COALESCE(sum(s.disponivel), 0) * ei.valor_unitario AS valor_total
        FROM public.sup_estoque_item ei JOIN public.sup_item i ON i.id = ei.sup_item_id
        LEFT JOIN public.sup_estoque_saldo s ON s.item_estoque_id = ei.id
       WHERE ei.empresa_id = v_emp AND ei.arquivado_em IS NULL
       GROUP BY ei.id, i.nome, i.tipo, ei.estoque_minimo, ei.valor_unitario),
    saude AS (SELECT *, CASE WHEN disponivel <= 0 THEN 'Sem estoque'
                             WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo THEN 'Baixo'
                             WHEN estoque_minimo > 0 AND disponivel <= estoque_minimo * 1.5 THEN 'Atenção'
                             ELSE 'Adequado' END AS situacao FROM estoque)
    SELECT CASE WHEN p_codigo = 'sup_valor_estoque' THEN jsonb_build_object(
        'valor', COALESCE((SELECT round(sum(valor_total), 2) FROM estoque), 0),
        'afetado', (SELECT replace(to_char(COALESCE(sum(disponivel), 0), 'FM999G999G990'), ',', '.') || ' itens disponíveis · ' || count(*) || ' itens distintos' FROM estoque),
        'base', 'Igual a Suprimentos › Dashboard de Compras: saldo disponível × valor unitário, empresa HAGG',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC)
                               FROM (SELECT CASE categoria WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes' WHEN 'insumo' THEN 'Insumos'
                                                           WHEN 'equipamento' THEN 'Equipamentos' ELSE initcap(categoria) END AS nome, round(sum(valor_total), 2) v
                                       FROM estoque GROUP BY categoria) t), '[]'::jsonb))
      ELSE jsonb_build_object(
        'valor', (SELECT count(*) FROM saude WHERE situacao = 'Baixo'),
        'afetado', (SELECT count(*) FILTER (WHERE situacao = 'Atenção') || ' em atenção · ' || count(*) FILTER (WHERE situacao = 'Adequado') || ' adequados' FROM saude),
        'causa', (SELECT 'Mais baixo: ' || item FROM saude WHERE situacao = 'Baixo' ORDER BY disponivel / greatest(estoque_minimo, 1) LIMIT 1),
        'base', 'Igual a Suprimentos › Dashboard de Compras (saúde do estoque): disponível no mínimo ou abaixo, entre os itens com mínimo definido, empresa HAGG',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', item, 'valor', disponivel, 'rotulo', disponivel || ' de mín. ' || estoque_minimo)
                                              ORDER BY disponivel / greatest(estoque_minimo, 1))
                               FROM (SELECT * FROM saude WHERE situacao = 'Baixo' ORDER BY disponivel / greatest(estoque_minimo, 1) LIMIT 12) t), '[]'::jsonb)) END
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sup_cotacoes' THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH m AS (SELECT 1 FROM public.malote_despesa d
                WHERE d.empresa_id = v_emp AND d.cotacao_enviada_em IS NOT NULL AND d.deleted_at IS NULL
                  AND d.cotacao_enviada_em >= ini::timestamptz AND d.cotacao_enviada_em < (fim + 1)::timestamptz),
    l AS (SELECT 1 FROM public.cotacoes_licitacao q
           WHERE q.empresa_id = v_emp AND q.created_at >= ini::timestamptz AND q.created_at < (fim + 1)::timestamptz)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM m) + (SELECT count(*) FROM l),
      'afetado', (SELECT count(*) FROM m) || ' de compras (Malote) · ' || (SELECT count(*) FROM l) || ' para licitação',
      'base', 'Igual a Suprimentos › Dashboard de Compras: cotações enviadas no mês, empresa HAGG',
      'detalhe', jsonb_build_array(jsonb_build_object('nome', 'Compras (Malote)', 'valor', (SELECT count(*) FROM m)),
                                   jsonb_build_object('nome', 'Licitação', 'valor', (SELECT count(*) FROM l))))
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_calc_espelho(text, numeric) FROM PUBLIC, anon, authenticated;

-- tvg_resultado: espelho → ajuste → calc → calc_extra.
CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.fonte = 'auto' THEN
    BEGIN
      r := coalesce(public.tvg_calc_espelho(i.codigo, i.parametro), public.tvg_calc_ajuste(i.codigo, i.parametro),
                    public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
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
    'resultado', coalesce(r, '{}'::jsonb) - 'responsavel');
END $function$;

-- tvg_fonte (I.A): o trecho vem do espelho quando ele trata o código.
CREATE OR REPLACE FUNCTION public.tvg_fonte(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; alvo text; trecho text; ajudantes jsonb := '[]'::jsonb; h text;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  trecho := coalesce(public.tvg_trecho_calculo('tvg_calc_espelho', alvo), public.tvg_trecho_calculo('tvg_calc_ajuste', alvo),
                     public.tvg_trecho_calculo('tvg_calc', alvo), public.tvg_trecho_calculo('tvg_calc_extra', alvo));

  FOREACH h IN ARRAY ARRAY['tvg_quadro_contratos', 'tvg_dre_contratos', 'tvg_dre_competencia', 'dir_turnover_painel_dados'] LOOP
    IF trecho ~ h THEN
      ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', h, 'definicao',
        left((SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = h AND p.pronamespace = 'public'::regnamespace LIMIT 1), 2500)));
    END IF;
  END LOOP;
  IF trecho ~ 'tvg_dre_contratos' THEN
    ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', 'tvg_dre_mv',
      'definicao', 'Visão materializada (cache, atualizada a cada 6 h) que soma mz_60_view_dre_gerencial_competencia — o DRE gerencial carregado na migração contábil — por competência e contrato: RECEITA, CUSTO e DESPESA.'));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'painel', i.painel, 'fonte', i.fonte, 'regra', i.regra, 'identificar', i.identificar,
    'unidade', i.unidade, 'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'parametro', i.parametro,
    'parametro_rotulo', i.parametro_rotulo, 'responsavel', i.responsavel,
    'espelho_de', i.espelho_de,
    'espelho_regra', (SELECT o.regra FROM public."TVG_INDICADOR" o WHERE o.codigo = i.espelho_de),
    'componentes', (SELECT jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'regra', c.regra))
                      FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[]))),
    'calculo_sql', trecho,
    'funcoes_de_apoio', ajudantes);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_fonte(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_fonte(text) TO authenticated;

-- ── Cadastro da TV Supply: os números do dashboard ──────────────────────
UPDATE public."TVG_INDICADOR" SET na_tv = false
 WHERE codigo IN ('sup_compras_vencidas', 'sup_fornecedor', 'sup_contratos_sem_entrega', 'sup_sem_mov');
UPDATE public."TVG_INDICADOR" SET nome = 'Despachadas no mês', ordem = 3,
  regra = 'Igual ao Dashboard de Compras: das solicitações feitas no mês (empresa HAGG), as que estão com status Despachado.' WHERE codigo = 'sup_despachados';
UPDATE public."TVG_INDICADOR" SET nome = 'Valor do estoque', ordem = 5, meta = NULL, alerta = NULL,
  regra = 'Igual ao Dashboard de Compras: saldo disponível × valor unitário dos itens não arquivados, empresa HAGG.' WHERE codigo = 'sup_valor_estoque';
UPDATE public."TVG_INDICADOR" SET nome = 'Itens com estoque baixo', ordem = 6,
  regra = 'Igual ao Dashboard de Compras (saúde do estoque): itens com estoque mínimo definido e disponível igual ou abaixo dele, empresa HAGG.' WHERE codigo = 'sup_abaixo_minimo';

INSERT INTO public."TVG_INDICADOR"
  (codigo, painel, ordem, nome, identificar, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel, parametro, parametro_rotulo, pai, na_tv, espelho_de, componentes, regra)
VALUES
 ('sup_solicitacoes', 'ger-supply', 1, 'Solicitações no mês', 'Quantos pedidos de material/uniforme chegaram ao Supply no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Igual ao Dashboard de Compras: solicitações com data no mês corrente, empresa HAGG. Detalhe por contrato.'),
 ('sup_pendentes', 'ger-supply', 2, 'Pedidos pendentes', 'Das solicitações do mês, as que ainda não saíram.', 'auto', 'qtd', 'menor', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Igual ao Dashboard de Compras: solicitações do mês que não estão Despachadas nem Canceladas. Detalhe: os motivos (aguardando compra, envio, separação…).'),
 ('sup_tempo_atendimento', 'ger-supply', 4, 'Tempo médio de atendimento', 'Quantos dias, em média, da solicitação ao despacho.', 'auto', 'dias', 'menor', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Igual ao Dashboard de Compras: média de dias entre a solicitação e o despacho dos pedidos do mês já despachados. Detalhe por contrato.'),
 ('sup_cotacoes', 'ger-supply', 7, 'Cotações no mês', 'Cotações que o Supply enviou no mês.', 'auto', 'qtd', 'maior', NULL, NULL, 'diaria', 'Supply', NULL, NULL, NULL, true, NULL, NULL,
  'Igual ao Dashboard de Compras: cotações de compra enviadas pelo Malote + cotações para licitação, no mês, empresa HAGG.')
ON CONFLICT (codigo) DO NOTHING;

-- Tendência da TV Supply: o gráfico "Evolução das Solicitações e Cotações" do dashboard (antes: todas as empresas, despachos por data de despacho).
CREATE OR REPLACE FUNCTION public.tvg_tendencia(p_painel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '11 months')::date;
  r jsonb;
BEGIN
  BEGIN
    IF p_painel IN ('ger-operacional', 'ger-rh') THEN
      WITH e AS (SELECT public.rh_data(e."Admissão"::text) AS adm,
                        CASE WHEN e."Situação" = 'Demitido' THEN public.rh_data(e."Data Afastamento"::text) END AS dem
                   FROM public."EMPREGADOS" e)
      SELECT jsonb_build_object('titulo', 'Admissões × demissões por mês', 'series', jsonb_build_array('Admissões', 'Demissões'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE adm >= g AND adm < g + interval '1 month'),
                   'b', (SELECT count(*) FROM e WHERE dem >= g AND dem < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-licitacoes' THEN
      SELECT jsonb_build_object('titulo', 'Sessões de licitação por mês: ganhas × disputadas', 'series', jsonb_build_array('Ganhas', 'Disputadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text = 'Finalizada' AND x.posicao = 1),
                   'b', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text NOT IN ('Não Participado', 'Revogado'))) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-supply' THEN
      -- Igual ao Dashboard de Compras ("Evolução das Solicitações e Cotações"), empresa HAGG (mig 20261014000028).
      SELECT jsonb_build_object('titulo', 'Solicitações × cotações por mês (Dashboard de Compras)', 'series', jsonb_build_array('Solicitações', 'Cotações'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.sup_pedido p WHERE p.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                                AND p.data_solicitacao >= g AND p.data_solicitacao < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public.malote_despesa d WHERE d.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                                AND d.deleted_at IS NULL AND d.cotacao_enviada_em >= g AND d.cotacao_enviada_em < g + interval '1 month')
                        + (SELECT count(*) FROM public.cotacoes_licitacao q WHERE q.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                                AND q.created_at >= g AND q.created_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-frota' THEN
      SELECT jsonb_build_object('titulo', 'Uso da frota por mês: viagens × km rodado (÷ 100)', 'series', jsonb_build_array('Viagens', 'Km ÷ 100'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.cs_veiculo_agendamento a WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND coalesce(a.status, '') NOT ILIKE '%cancel%'),
                   'b', (SELECT round(coalesce(sum(a.km_final - a.km_inicial), 0) / 100.0) FROM public.cs_veiculo_agendamento a
                          WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND a.km_final >= a.km_inicial)) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-recrutamento' THEN
      SELECT jsonb_build_object('titulo', 'Vagas por mês: solicitadas × contratadas', 'series', jsonb_build_array('Solicitadas', 'Contratadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.created_at >= g AND s.created_at < g + interval '1 month'),
                   'b', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s
                          WHERE (s.status IN ('Contratado', 'Concluída') OR s.status LIKE 'Concluído%') AND s.status_changed_at >= g AND s.status_changed_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-sst' THEN
      WITH e AS (SELECT public.rh_data(e."Data Afastamento"::text) AS afa FROM public."EMPREGADOS" e WHERE e."Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias')),
      d AS (SELECT coalesce(s.data_solicitacao, s.criado_em::date) AS dia FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s)
      SELECT jsonb_build_object('titulo', 'Por mês: afastamentos iniciados × demissionais solicitados', 'series', jsonb_build_array('Afastamentos', 'Demissionais'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE afa >= g AND afa < g + interval '1 month'),
                   'b', (SELECT count(*) FROM d WHERE dia >= g AND dia < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-treinamento' THEN
      SELECT jsonb_build_object('titulo', 'Plataforma por mês: matrículas × certificados', 'series', jsonb_build_array('Matrículas', 'Certificados'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."TRN_MATRICULA" m WHERE m.inscrito_em >= g AND m.inscrito_em < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-financeiro' THEN
      SELECT jsonb_build_object('titulo', 'Por mês: faturado (NF emitida) × recebido', 'series', jsonb_build_array('Faturado', 'Recebido'), 'unidade', 'brl',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT round(coalesce(sum(n.vlr_liquido_total), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= g AND n.data_emissao < g + interval '1 month'),
                   'b', (SELECT round(coalesce(sum(coalesce(n.valor_pago, n.vlr_liquido_total)), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.data_pagamento >= g AND n.data_pagamento < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-juridico' THEN
      SELECT jsonb_build_object('titulo', 'Notificações do cliente por mês: recebidas × encerradas', 'series', jsonb_build_array('Recebidas', 'Encerradas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE coalesce(n.data_recebimento, n.created_at::date) >= g AND coalesce(n.data_recebimento, n.created_at::date) < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE n.encerrada_em >= g AND n.encerrada_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel IN ('ger-controladoria', 'ger-presidencia') THEN
      r := public.tvg_tendencia_dre();  -- mig 20261014000011 (DRE em cache)
    ELSIF p_painel = 'ger-ti' THEN
      SELECT jsonb_build_object('titulo', 'Chamados de sistemas por mês: abertos × concluídos', 'series', jsonb_build_array('Abertos', 'Concluídos'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.created_at >= g AND c.created_at < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.concluido_em >= g AND c.concluido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    r := jsonb_build_object('erro', SQLERRM);
  END;
  RETURN r;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."TVG_INDICADOR" WHERE codigo IN ('sup_solicitacoes', 'sup_pendentes', 'sup_tempo_atendimento', 'sup_cotacoes');
-- UPDATE public."TVG_INDICADOR" SET na_tv = true WHERE codigo IN ('sup_compras_vencidas', 'sup_fornecedor', 'sup_contratos_sem_entrega', 'sup_sem_mov');
-- UPDATE public."TVG_INDICADOR" SET nome = 'Pedidos despachados no mês', ordem = 7 WHERE codigo = 'sup_despachados';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Valor total do estoque' WHERE codigo = 'sup_valor_estoque';
-- UPDATE public."TVG_INDICADOR" SET nome = 'Itens abaixo do estoque mínimo' WHERE codigo = 'sup_abaixo_minimo';
-- tvg_resultado / tvg_fonte: reaplicar as versões da 20261014000025; DROP FUNCTION public.tvg_calc_espelho(text, numeric);
