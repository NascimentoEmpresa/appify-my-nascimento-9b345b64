-- SIS-2026-0753 — conciliação histórica e respostas operacionais da IA
--
-- 1. A ficha zerada/arquivada continuava na rotatividade, mas sem indicar que
--    era histórica. O usuário procurava o código no estoque ativo e entendia
--    corretamente que as telas divergiam.
-- 2. "Entradas registradas" na tela operacional é o número de etiquetas das
--    fichas ativas. O planejamento não expunha esse KPI para a IA.
-- 3. Pedidos importados possuem a data de negócio em data_solicitacao. A série
--    mensal ainda agrupava por created_at (data da importação), deslocando ou
--    zerando meses antigos. O dashboard passa a informar a cobertura real de
--    cada fonte e a usar data_solicitacao na análise de solicitações.

DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  -- A interface passa a abrir no primeiro registro real. Manter a trava de
  -- cinco anos faria "Todo o histórico" quebrar assim que a base ultrapassar
  -- essa idade, embora a agregação mensal continue pequena e previsível.
  v_origem := $trecho$
  IF p_fim - p_inicio > 1827 THEN
    RAISE EXCEPTION 'O período máximo do dashboard é de cinco anos.' USING ERRCODE = '22023';
  END IF;

$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do limite histórico não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, '');

  v_origem := $trecho$
      'atualizado_em', now(),
      'filtros', jsonb_build_object(
$trecho$;
  v_destino := $trecho$
      'atualizado_em', now(),
      'periodo_disponivel', jsonb_build_object(
        'inicio', LEAST(
          (SELECT min(p.data_solicitacao) FROM public.sup_pedido p WHERE p.empresa_id = p_empresa_id),
          (SELECT min((pi.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.sup_pedido_item pi
             JOIN public.sup_pedido p ON p.id = pi.pedido_id
            WHERE p.empresa_id = p_empresa_id),
          (SELECT min((m.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.sup_estoque_movimento m WHERE m.empresa_id = p_empresa_id),
          (SELECT min((d.cotacao_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.malote_despesa d WHERE d.empresa_id = p_empresa_id AND d.cotacao_enviada_em IS NOT NULL),
          (SELECT min((q.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.cotacoes_licitacao q WHERE q.empresa_id = p_empresa_id)
        ),
        'fim', GREATEST(
          (SELECT max(p.data_solicitacao) FROM public.sup_pedido p WHERE p.empresa_id = p_empresa_id),
          (SELECT max((pi.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.sup_pedido_item pi
             JOIN public.sup_pedido p ON p.id = pi.pedido_id
            WHERE p.empresa_id = p_empresa_id),
          (SELECT max((m.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.sup_estoque_movimento m WHERE m.empresa_id = p_empresa_id),
          (SELECT max((d.cotacao_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.malote_despesa d WHERE d.empresa_id = p_empresa_id AND d.cotacao_enviada_em IS NOT NULL),
          (SELECT max((q.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.cotacoes_licitacao q WHERE q.empresa_id = p_empresa_id)
        ),
        'solicitacoes_inicio', (SELECT min(p.data_solicitacao) FROM public.sup_pedido p WHERE p.empresa_id = p_empresa_id),
        'solicitacoes_fim', (SELECT max(p.data_solicitacao) FROM public.sup_pedido p WHERE p.empresa_id = p_empresa_id),
        'itens_registrados_inicio', (
          SELECT min((pi.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
            FROM public.sup_pedido_item pi
            JOIN public.sup_pedido p ON p.id = pi.pedido_id
           WHERE p.empresa_id = p_empresa_id
        ),
        'movimentos_inicio', (
          SELECT min((m.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
            FROM public.sup_estoque_movimento m WHERE m.empresa_id = p_empresa_id
        ),
        'cotacoes_inicio', LEAST(
          (SELECT min((d.cotacao_enviada_em AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.malote_despesa d WHERE d.empresa_id = p_empresa_id AND d.cotacao_enviada_em IS NOT NULL),
          (SELECT min((q.created_at AT TIME ZONE 'America/Sao_Paulo')::date)
             FROM public.cotacoes_licitacao q WHERE q.empresa_id = p_empresa_id)
        )
      ),
      'filtros', jsonb_build_object(
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do período disponível não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'date_trunc(''month'', p.created_at) = m.mes';
  v_destino := 'date_trunc(''month'', p.data_solicitacao::timestamp) = m.mes';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora mensal de solicitações não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'extract(epoch FROM (data_despachado - created_at)) / 86400';
  v_destino := 'extract(epoch FROM (data_despachado - (data_solicitacao::timestamp AT TIME ZONE ''America/Sao_Paulo''))) / 86400';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do tempo médio não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'extract(epoch FROM (p.data_despachado - p.created_at)) / 86400.0';
  v_destino := 'extract(epoch FROM (p.data_despachado - (p.data_solicitacao::timestamp AT TIME ZONE ''America/Sao_Paulo''))) / 86400.0';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do tempo despachado não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'extract(epoch FROM (now() - p.created_at)) / 86400.0';
  v_destino := 'extract(epoch FROM (now() - (p.data_solicitacao::timestamp AT TIME ZONE ''America/Sao_Paulo''))) / 86400.0';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do tempo pendente não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := 'FROM pedidos p ORDER BY p.created_at DESC LIMIT 8';
  v_destino := 'FROM pedidos p ORDER BY p.data_solicitacao DESC, p.created_at DESC LIMIT 8';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora das solicitações recentes não encontrada no dashboard.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_estoque_saudavel não encontrada.';
  END IF;

  v_origem := $trecho$
        'itens_planejados',  (SELECT count(*) FROM completo WHERE NOT fora_do_plano),
        'valor_em_estoque',  round(COALESCE((SELECT sum(valor_em_estoque) FROM completo), 0), 2),
$trecho$;
  v_destino := $trecho$
        'itens_planejados',  (SELECT count(*) FROM completo WHERE NOT fora_do_plano),
        'entradas_registradas', (
          SELECT count(*)
            FROM public.sup_estoque_tag tag
            JOIN public.sup_estoque_item estoque_item ON estoque_item.id = tag.item_estoque_id
           WHERE estoque_item.empresa_id = p_empresa_id
             AND estoque_item.arquivado_em IS NULL
        ),
        'valor_em_estoque',  round(COALESCE((SELECT sum(valor_em_estoque) FROM completo), 0), 2),
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do resumo operacional não encontrada no Estoque Saudável.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

DO $bloco$
DECLARE
  v_definicao text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_rotatividade_estoque_detalhado(uuid,date,date,uuid,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função detalhada de rotatividade não encontrada.';
  END IF;

  -- Cada tamanho é hoje um sup_item próprio e possui código operacional
  -- próprio. A versão anterior priorizava o código do pai, por isso a luva M
  -- aparecia como 0000101 no dashboard embora fosse 0002052 no estoque.
  v_origem := 'COALESCE(base.codigo, item.codigo) AS codigo';
  v_destino := 'COALESCE(item.codigo, base.codigo) AS codigo';
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do código específico por tamanho não encontrada na rotatividade.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
        sum(COALESCE(saldo.disponivel, 0))::numeric AS disponivel
      FROM public.sup_estoque_saldo saldo
      JOIN public.sup_item item ON item.id = saldo.sup_item_id
$trecho$;
  v_destino := $trecho$
        sum(COALESCE(saldo.disponivel, 0))::numeric AS disponivel,
        bool_or(estoque_item.arquivado_em IS NULL) AS cadastro_ativo
      FROM public.sup_estoque_saldo saldo
      JOIN public.sup_estoque_item estoque_item ON estoque_item.id = saldo.item_estoque_id
      JOIN public.sup_item item ON item.id = saldo.sup_item_id
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do cadastro ativo não encontrada na rotatividade.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
        COALESCE(saldo.disponivel, 0)::numeric AS saldo_disponivel,
        CASE
$trecho$;
  v_destino := $trecho$
        COALESCE(saldo.disponivel, 0)::numeric AS saldo_disponivel,
        COALESCE(saldo.cadastro_ativo, false) AS cadastro_ativo,
        CASE
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora da situação cadastral não encontrada na rotatividade.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  v_origem := $trecho$
          'saldo_disponivel', saldo_disponivel,
          'giro', giro
$trecho$;
  v_destino := $trecho$
          'saldo_disponivel', saldo_disponivel,
          'cadastro_ativo', cadastro_ativo,
          'giro', giro
$trecho$;
  IF position(v_origem IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'Âncora do JSON cadastral não encontrada na rotatividade.';
  END IF;
  v_definicao := replace(v_definicao, v_origem, v_destino);

  EXECUTE v_definicao;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
