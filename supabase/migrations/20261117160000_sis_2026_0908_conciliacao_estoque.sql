-- SIS-2026-0908 — Conciliação de Estoque e Custo de Materiais (Controladoria)
-- ============================================================================
-- A tela junta, no mesmo período: a compra lançada nos contratos de estoque do
-- Fluxo de Caixa ("ADMINISTRATIVO - HAGG ESTOQUE", "ADMINISTRATIVO - SN
-- ESTOQUE"), o estoque físico do almoxarifado, as saídas por contrato e o custo
-- que a Lucratividade mostra. O lado do Fluxo a tela lê pelas views de sempre;
-- esta migration cuida do lado FÍSICO.
--
-- POR QUE UMA FOTO DO ESTOQUE, E NÃO O SALDO RECONSTRUÍDO PELOS MOVIMENTOS
--   Medido em 16/11/2026 (só leitura): somar os movimentos de cada item não dá
--   o físico de hoje em ~570 de 1.009 itens, com qualquer sinal que se dê ao
--   'ajuste'; trocando 'entrada' pelos lotes criados, ainda ~500 não fecham. A
--   carga do sistema antigo (ago–set/2026) entrou como lote sem movimento, e
--   ~4.900 unidades saíram de lotes por remoção/correção sem linha no ledger.
--   O único sup_estoque_snapshot (competência 2026-09-01) foi gravado em 29/10,
--   então nem ele serve de prova. "Estoque inicial do período" calculado de
--   trás para frente seria um número inventado.
--   Decisão do Eduardo (16/11/2026): foto do físico, valorada, gravada no dia
--   1º de cada mês (o saldo de abertura do mês) e uma foto de abertura agora.
--   A conciliação física de um período só existe a partir da primeira foto; o
--   que não fecha entre duas fotos aparece numa linha própria, com nome.
--
-- CRITÉRIO DE VALOR
--   Tudo a preço de cadastro (sup_estoque_item.valor_unitario), o mesmo de
--   sup_rel_saidas_por_contrato e sup_rel_consumo_custo_por_contrato
--   (20261110200000). Assim a saída da conciliação é o mesmo número da tela
--   Saídas por Contrato e da coluna Consumo de Estoque da Lucratividade —
--   igualdade exigida pela CEO em 10/11/2026. O card de Estoque & Etiquetas usa
--   outro critério (o maior entre cadastro e custo do lote vivo, 20261028001800);
--   a RPC devolve esse valor também, para a tela mostrar a diferença de critério
--   em vez de escondê-la.
--
-- Acesso por pessoa (deny-by-default), nada liberado de início:
--   conciliacao-estoque-custo  (visualizar) : ver a tela;
--   conciliacao-estoque-gerir  (alterar)    : gravar uma foto do estoque fora do dia 1º (menu fantasma, sem rota).
--
-- O pg_cron NÃO vem num dump/restore (cron.job é tabela de extensão): o job do
-- fechamento mensal do Estoque Saudável não rodou em out/nov. O agendamento
-- daqui fica sob guarda e a tela mostra a data da última foto, para um mês sem
-- foto aparecer no dia, não meses depois. Conferir `cron.job` depois do merge.
--
-- ROLLBACK:
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       PERFORM cron.unschedule('ctl_estoque_foto_mensal')
--         WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ctl_estoque_foto_mensal');
--     END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.ctl_conciliacao_estoque_fisico(date, date, uuid);
--   DROP FUNCTION IF EXISTS public.ctl_estoque_foto_gravar(uuid);
--   DROP FUNCTION IF EXISTS public.ctl_estoque_posicao(uuid);
--   DROP TABLE IF EXISTS public.ctl_estoque_foto;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('conciliacao-estoque-custo', 'conciliacao-estoque-gerir');
--   DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('conciliacao-estoque-custo', 'conciliacao-estoque-gerir');
--   DELETE FROM public.app_menu WHERE codigo IN ('conciliacao-estoque-custo', 'conciliacao-estoque-gerir');
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

-- 1) Menus ------------------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m,
       (VALUES
         ('conciliacao-estoque-custo', 'Conciliação de Estoque e Custo de Materiais',          '/app/controladoria/conciliacao-estoque', 57),
         ('conciliacao-estoque-gerir', 'Conciliação de Estoque — gravar foto do estoque (ação)', NULL::text,                               58)
       ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Foto do estoque ----------------------------------------------------------
-- Uma linha por (empresa, dia, item de estoque). Sem FK em item_estoque_id de
-- propósito: a foto de um mês fechado tem que sobreviver ao item ser apagado.
CREATE TABLE IF NOT EXISTS public.ctl_estoque_foto (
  empresa_id      uuid NOT NULL REFERENCES public.empresas (id) ON DELETE CASCADE,
  data_ref        date NOT NULL,          -- dia da foto (Brasília); a do dia 1º é o saldo de abertura do mês
  item_estoque_id uuid NOT NULL,
  sup_item_id     uuid,
  item_nome       text,
  item_codigo     text,
  tipo_item       text,
  tamanho         text,
  fisico          numeric(14,2) NOT NULL,
  valor_unitario  numeric(14,2) NOT NULL DEFAULT 0,   -- cadastro, no momento da foto
  valor_total     numeric(16,2) NOT NULL DEFAULT 0,
  gravada_em      timestamptz NOT NULL DEFAULT now(),
  gravada_por     uuid,
  PRIMARY KEY (empresa_id, data_ref, item_estoque_id)
);
CREATE INDEX IF NOT EXISTS ctl_estoque_foto_data_idx ON public.ctl_estoque_foto (data_ref);

ALTER TABLE public.ctl_estoque_foto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ctl_estoque_foto_select ON public.ctl_estoque_foto;
CREATE POLICY ctl_estoque_foto_select ON public.ctl_estoque_foto FOR SELECT TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'conciliacao-estoque-custo', 'visualizar'::public.app_acao)));
-- Escrita só pela função de gravar (SECURITY DEFINER): ninguém edita uma foto à mão.
GRANT SELECT ON public.ctl_estoque_foto TO authenticated;

-- 3) Posição de agora, item a item --------------------------------------------
-- Usada pela foto e pela conciliação quando o período chega até hoje. Físico
-- igual ao de Estoque & Etiquetas (sup_estoque_saldo.fisico, que não desconta
-- reserva). `valor_unitario_tela` é o critério do card daquela tela.
CREATE OR REPLACE FUNCTION public.ctl_estoque_posicao(p_empresa_id uuid DEFAULT NULL)
RETURNS TABLE (
  empresa_id          uuid,
  item_estoque_id     uuid,
  sup_item_id         uuid,
  item_nome           text,
  item_codigo         text,
  tipo_item           text,
  tamanho             text,
  fisico              numeric,
  valor_unitario      numeric,
  valor_unitario_tela numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH saldo AS (
    SELECT s.item_estoque_id, sum(s.fisico)::numeric AS fisico
      FROM public.sup_estoque_saldo s
     WHERE p_empresa_id IS NULL OR s.empresa_id = p_empresa_id
     GROUP BY 1
  )
  SELECT ei.empresa_id, ei.id, i.id, i.nome, i.codigo, i.tipo, i.tamanho,
         s.fisico,
         COALESCE(ei.valor_unitario, 0),
         GREATEST(COALESCE(ei.valor_unitario, 0),
                  COALESCE((SELECT max(t.valor_unitario)
                              FROM public.sup_estoque_tag t
                             WHERE t.item_estoque_id = ei.id AND NOT t.usado AND t.valor_unitario > 0), 0))
    FROM saldo s
    JOIN public.sup_estoque_item ei ON ei.id = s.item_estoque_id
    LEFT JOIN public.sup_item i ON i.id = ei.sup_item_id
   WHERE s.fisico <> 0;
$$;
REVOKE ALL ON FUNCTION public.ctl_estoque_posicao(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Gravar a foto --------------------------------------------------------------
-- Sem usuário (pg_cron, ou esta migration) grava; com usuário, só quem tem a
-- ação conciliacao-estoque-gerir. Regravar o mesmo dia sobrescreve.
CREATE OR REPLACE FUNCTION public.ctl_estoque_foto_gravar(p_empresa_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_dia    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_linhas integer;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_screen_access(v_uid, 'conciliacao-estoque-gerir', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para gravar a foto do estoque.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.ctl_estoque_foto f
   WHERE f.data_ref = v_dia AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);

  INSERT INTO public.ctl_estoque_foto
    (empresa_id, data_ref, item_estoque_id, sup_item_id, item_nome, item_codigo, tipo_item, tamanho,
     fisico, valor_unitario, valor_total, gravada_em, gravada_por)
  SELECT p.empresa_id, v_dia, p.item_estoque_id, p.sup_item_id, p.item_nome, p.item_codigo, p.tipo_item, p.tamanho,
         p.fisico, p.valor_unitario, round(p.fisico * p.valor_unitario, 2), now(), v_uid
    FROM public.ctl_estoque_posicao(p_empresa_id) p;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  RETURN jsonb_build_object('data_ref', v_dia, 'linhas', v_linhas, 'em', now());
END;
$$;
REVOKE ALL ON FUNCTION public.ctl_estoque_foto_gravar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ctl_estoque_foto_gravar(uuid) TO authenticated;

-- 5) O lado físico da conciliação -------------------------------------------------
-- Duas janelas, e a tela diz as duas:
--   • PERÍODO pedido [p_inicio, p_fim]: saídas por contrato — a mesma conta de
--     sup_rel_consumo_custo_por_contrato, para bater com a Lucratividade;
--   • JANELA FÍSICA: da foto mais recente até p_inicio, até a foto do dia
--     seguinte a p_fim (ou agora, se o período chega até hoje). Quando as fotos
--     do dia 1º existem, as duas janelas são a mesma.
-- Identidade física: inicial + entradas − saídas + acertos = final, em que
-- "acertos" é o resto, com nome: remoção, correção, devolução, inventário,
-- material sem lote e troca de preço do cadastro entre as fotos.
-- Sem acesso: NULL (a tela mostra vazio, não erro).
CREATE OR REPLACE FUNCTION public.ctl_conciliacao_estoque_fisico(
  p_inicio     date,
  p_fim        date,
  p_empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje       date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_foto_ini   date;
  v_foto_fim   date;
  v_ini_em     timestamptz;
  v_fim_em     timestamptz;
  v_fim_agora  boolean := false;
  v_periodo_de timestamptz := (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_periodo_ate timestamptz := ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');
  v_resultado  jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'conciliacao-estoque-custo', 'visualizar'::public.app_acao) THEN
    RETURN NULL;
  END IF;

  -- Foto inicial: a mais recente até o primeiro dia do período.
  SELECT max(f.data_ref) INTO v_foto_ini
    FROM public.ctl_estoque_foto f
   WHERE f.data_ref <= p_inicio AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);
  -- Período começando antes da primeira foto: a janela física começa NA primeira
  -- foto que cair dentro do período (é o caso do mês em que a foto de abertura foi tirada).
  IF v_foto_ini IS NULL THEN
    SELECT min(f.data_ref) INTO v_foto_ini
      FROM public.ctl_estoque_foto f
     WHERE f.data_ref > p_inicio AND f.data_ref <= p_fim
       AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);
  END IF;
  IF v_foto_ini IS NOT NULL THEN
    SELECT min(f.gravada_em) INTO v_ini_em
      FROM public.ctl_estoque_foto f
     WHERE f.data_ref = v_foto_ini AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);
  END IF;

  -- Foto final: a primeira a partir do dia seguinte ao fim; sem ela e com o
  -- período chegando a hoje, a posição de agora.
  SELECT min(f.data_ref) INTO v_foto_fim
    FROM public.ctl_estoque_foto f
   WHERE f.data_ref >= p_fim + 1 AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);
  IF v_foto_fim IS NOT NULL THEN
    SELECT min(f.gravada_em) INTO v_fim_em
      FROM public.ctl_estoque_foto f
     WHERE f.data_ref = v_foto_fim AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id);
  ELSIF p_fim >= v_hoje THEN
    v_fim_agora := true;
    v_fim_em := now();
  END IF;

  WITH
  -- Saídas do PERÍODO, por contrato efetivo. Mesma expressão de
  -- sup_rel_consumo_custo_por_contrato; a empresa aqui é a do ESTOQUE (é o
  -- estoque dela que está sendo conciliado), e a saída sem contrato fica.
  saida_periodo AS (
    SELECT COALESCE(p.contrato_id, c.contrato_id_reconstruido) AS contrato_id,
           sum(c.quantidade * COALESCE(ei.valor_unitario, 0))::numeric AS valor,
           sum(c.quantidade)::numeric AS unidades,
           sum(CASE WHEN COALESCE(ei.valor_unitario, 0) = 0 THEN c.quantidade ELSE 0 END)::numeric AS unidades_sem_valor
      FROM public.sup_estoque_consumo c
      LEFT JOIN public.sup_pedido       p  ON p.id  = c.pedido_id
      LEFT JOIN public.sup_estoque_item ei ON ei.id = c.item_estoque_id
     WHERE c.consumido_em >= v_periodo_de AND c.consumido_em < v_periodo_ate
       AND (p_empresa_id IS NULL OR ei.empresa_id = p_empresa_id)
     GROUP BY 1
  ),
  ini_itens AS (
    SELECT f.item_estoque_id, f.empresa_id, f.item_nome, f.item_codigo, f.tipo_item, f.tamanho,
           f.fisico, f.valor_total
      FROM public.ctl_estoque_foto f
     WHERE v_foto_ini IS NOT NULL AND f.data_ref = v_foto_ini
       AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id)
  ),
  fim_itens AS (
    SELECT f.item_estoque_id, f.empresa_id, f.item_nome, f.item_codigo, f.tipo_item, f.tamanho,
           f.fisico, f.valor_total, f.valor_total AS valor_tela
      FROM public.ctl_estoque_foto f
     WHERE v_foto_fim IS NOT NULL AND f.data_ref = v_foto_fim
       AND (p_empresa_id IS NULL OR f.empresa_id = p_empresa_id)
    UNION ALL
    SELECT p.item_estoque_id, p.empresa_id, p.item_nome, p.item_codigo, p.tipo_item, p.tamanho,
           p.fisico, round(p.fisico * p.valor_unitario, 2), round(p.fisico * p.valor_unitario_tela, 2)
      FROM public.ctl_estoque_posicao(p_empresa_id) p
     WHERE v_fim_agora
  ),
  -- Entradas da JANELA FÍSICA: lotes criados nela, pela quantidade original.
  entrada AS (
    SELECT t.item_estoque_id,
           sum(CASE WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_original_massa, 0) ELSE 1 END)::numeric AS qtd,
           sum(CASE WHEN t.tipo = 'massa' THEN COALESCE(t.quantidade_original_massa, 0) ELSE 1 END
               * COALESCE(ei.valor_unitario, 0))::numeric AS valor
      FROM public.sup_estoque_tag t
      JOIN public.sup_estoque_item ei ON ei.id = t.item_estoque_id
     WHERE v_ini_em IS NOT NULL AND v_fim_em IS NOT NULL
       AND t.created_at >= v_ini_em AND t.created_at < v_fim_em
       AND (p_empresa_id IS NULL OR ei.empresa_id = p_empresa_id)
     GROUP BY 1
  ),
  -- Saídas da JANELA FÍSICA, pelo ledger.
  saida AS (
    SELECT c.item_estoque_id,
           sum(c.quantidade)::numeric AS qtd,
           sum(c.quantidade * COALESCE(ei.valor_unitario, 0))::numeric AS valor
      FROM public.sup_estoque_consumo c
      JOIN public.sup_estoque_item ei ON ei.id = c.item_estoque_id
     WHERE v_ini_em IS NOT NULL AND v_fim_em IS NOT NULL
       AND c.consumido_em >= v_ini_em AND c.consumido_em < v_fim_em
       AND (p_empresa_id IS NULL OR ei.empresa_id = p_empresa_id)
     GROUP BY 1
  ),
  -- O que se sabe dos acertos (só para dar nome ao resto; não entra na conta).
  acerto AS (
    SELECT m.tipo, sum(m.quantidade)::numeric AS qtd,
           sum(m.quantidade * COALESCE(ei.valor_unitario, 0))::numeric AS valor
      FROM public.sup_estoque_movimento m
      JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id
     WHERE v_ini_em IS NOT NULL AND v_fim_em IS NOT NULL
       AND m.created_at >= v_ini_em AND m.created_at < v_fim_em
       AND m.tipo IN ('remocao', 'correcao', 'devolucao', 'ajuste')
       AND (p_empresa_id IS NULL OR ei.empresa_id = p_empresa_id)
     GROUP BY 1
  ),
  ids AS (
    SELECT item_estoque_id FROM ini_itens UNION SELECT item_estoque_id FROM fim_itens
    UNION SELECT item_estoque_id FROM entrada UNION SELECT item_estoque_id FROM saida
  ),
  itens AS (
    SELECT x.item_estoque_id,
           COALESCE(fi.item_nome, ii.item_nome, it.nome)     AS item_nome,
           COALESCE(fi.item_codigo, ii.item_codigo, it.codigo) AS item_codigo,
           COALESCE(fi.tipo_item, ii.tipo_item, it.tipo)       AS tipo_item,
           COALESCE(fi.tamanho, ii.tamanho, it.tamanho)        AS tamanho,
           COALESCE(ii.fisico, 0) AS inicial_qtd, COALESCE(ii.valor_total, 0) AS inicial_valor,
           COALESCE(en.qtd, 0)    AS entrada_qtd, COALESCE(en.valor, 0)       AS entrada_valor,
           COALESCE(sa.qtd, 0)    AS saida_qtd,   COALESCE(sa.valor, 0)       AS saida_valor,
           COALESCE(fi.fisico, 0) AS final_qtd,   COALESCE(fi.valor_total, 0) AS final_valor,
           COALESCE(fi.valor_tela, 0) AS final_valor_tela,
           COALESCE(ei.valor_unitario, 0) AS valor_unitario
      FROM ids x
      LEFT JOIN ini_itens ii ON ii.item_estoque_id = x.item_estoque_id
      LEFT JOIN fim_itens fi ON fi.item_estoque_id = x.item_estoque_id
      LEFT JOIN entrada en ON en.item_estoque_id = x.item_estoque_id
      LEFT JOIN saida   sa ON sa.item_estoque_id = x.item_estoque_id
      LEFT JOIN public.sup_estoque_item ei ON ei.id = x.item_estoque_id
      LEFT JOIN public.sup_item it ON it.id = ei.sup_item_id
  )
  SELECT jsonb_build_object(
    'janela', jsonb_build_object(
      'foto_inicial', v_foto_ini,
      'inicio_em',    v_ini_em,
      'foto_final',   v_foto_fim,
      'fim_agora',    v_fim_agora,
      'fim_em',       v_fim_em
    ),
    'fotos', COALESCE((SELECT jsonb_agg(d ORDER BY d)
                         FROM (SELECT DISTINCT f.data_ref AS d FROM public.ctl_estoque_foto f
                                WHERE p_empresa_id IS NULL OR f.empresa_id = p_empresa_id) q), '[]'::jsonb),
    'fisico', CASE WHEN v_ini_em IS NULL OR v_fim_em IS NULL THEN NULL ELSE jsonb_build_object(
      'inicial',         (SELECT COALESCE(sum(inicial_valor), 0) FROM itens),
      'entradas',        (SELECT COALESCE(sum(entrada_valor), 0) FROM itens),
      'saidas',          (SELECT COALESCE(sum(saida_valor), 0)   FROM itens),
      'final',           (SELECT COALESCE(sum(final_valor), 0)   FROM itens),
      'final_tela',      CASE WHEN v_fim_agora THEN (SELECT COALESCE(sum(final_valor_tela), 0) FROM itens) END,
      'entradas_sem_custo', (SELECT COALESCE(sum(entrada_qtd), 0) FROM itens WHERE valor_unitario = 0),
      'acertos_conhecidos', COALESCE((SELECT jsonb_object_agg(tipo, jsonb_build_object('qtd', qtd, 'valor', valor)) FROM acerto), '{}'::jsonb)
    ) END,
    'estoque_sem_custo', (SELECT jsonb_build_object('itens', count(*), 'unidades', COALESCE(sum(final_qtd), 0))
                            FROM itens WHERE final_qtd > 0 AND valor_unitario = 0),
    'saidas_por_contrato', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contrato_id', sp.contrato_id,
               'contrato_nome', COALESCE(ct.nome, '(sem contrato identificado)'),
               'empresa_id', ct.empresa_id,
               'valor', sp.valor,
               'unidades', sp.unidades,
               'unidades_sem_valor', sp.unidades_sem_valor) ORDER BY sp.valor DESC)
        FROM saida_periodo sp
        LEFT JOIN public.contratos ct ON ct.id = sp.contrato_id), '[]'::jsonb),
    'itens', COALESCE((
      SELECT jsonb_agg(to_jsonb(i)
                       ORDER BY i.item_nome)
        FROM itens i), '[]'::jsonb)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;
REVOKE ALL ON FUNCTION public.ctl_conciliacao_estoque_fisico(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ctl_conciliacao_estoque_fisico(date, date, uuid) TO authenticated;

-- 6) Foto de abertura, agora, e o agendamento do dia 1º ------------------------------
SELECT public.ctl_estoque_foto_gravar();

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('ctl_estoque_foto_mensal')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ctl_estoque_foto_mensal');
    -- 03:05 UTC do dia 1º = 00:05 em Brasília: depois da virada do mês e antes
    -- de qualquer movimento do dia, para a foto ser o saldo de abertura.
    PERFORM cron.schedule('ctl_estoque_foto_mensal', '5 3 1 * *', $job$SELECT public.ctl_estoque_foto_gravar();$job$);
    RAISE NOTICE 'pg_cron: job ctl_estoque_foto_mensal agendado (5 3 1 * *).';
  ELSE
    RAISE NOTICE 'pg_cron ausente — gravar a foto do dia 1º pela tela (ação conciliacao-estoque-gerir).';
  END IF;
END
$cron$;

COMMENT ON TABLE public.ctl_estoque_foto IS
  'SIS-2026-0908: foto valorada do estoque físico (preço de cadastro). A do dia 1º é o saldo de abertura do mês na Conciliação de Estoque.';
COMMENT ON FUNCTION public.ctl_conciliacao_estoque_fisico(date, date, uuid) IS
  'SIS-2026-0908: lado físico da Conciliação de Estoque — fotos, entradas, saídas, saídas por contrato e itens.';

NOTIFY pgrst, 'reload schema';
