-- =========================================================================
-- TVs GERENCIAIS — VISUAL DO PROTÓTIPO HTML COMO OPÇÃO (14/10/2026)
-- SIS-2026-0635 (continuação)
--
-- PEDIDO (Pablo): "desenvolve igual ao HTML (TVs_Gerenciais_10_Telas_
-- CONFORME_WORD.html), deixa várias opções, não precisa tirar as já
-- desenvolvidas". O protótipo anexado ao chamado tem fundo escuro e um
-- GRÁFICO em cada indicador (colunas, agrupadas, linha, rosca, combo) com
-- as caixas Meta / Contrato-Setor afetado / Causa principal / Responsável.
--
-- Cada item "relatório" da playlist ganha o VISUAL (rel_visual):
--   NULL / 'classico'  as telas de 12/10 (cartões com o número) — padrão;
--   'painel'           igual ao HTML: escuro, 6 indicadores por tela (3×2);
--   'painel-claro'     o mesmo layout em fundo claro;
--   'graficos'         escuro, 4 indicadores por tela (2×2), gráfico maior.
-- tv_estado passa a entregar o rel_visual para a TV.
--
-- Os gráficos usam o detalhamento real de cada indicador; postos e quadro
-- precisam de duas séries (contratados × cobertos, ativos × necessários):
-- o detalhe desses dois cálculos ganha os campos a/b.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."TV_ITEM" ADD COLUMN IF NOT EXISTS rel_visual text;
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_rel_visual_check
  CHECK (rel_visual IS NULL OR rel_visual IN ('classico', 'painel', 'painel-claro', 'graficos'));

-- tv_estado: a da mig 20261007000014 (definição viva de 14/10/2026) + rel_visual no item.
CREATE OR REPLACE FUNCTION public.tv_estado(p_token text, p_tela text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $function$
DECLARE d public."TV_DISPOSITIVO"; v_cmd text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO" WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('desconhecida', true); END IF;
  v_cmd := CASE WHEN d.comando IS NOT NULL AND d.comando_em > now() - interval '10 minutes' THEN d.comando END;
  UPDATE public."TV_DISPOSITIVO" SET ultimo_ping = now(), tela = coalesce(left(p_tela, 30), tela), comando = NULL, comando_em = NULL WHERE id = d.id;
  IF d.pareado_em IS NULL THEN RETURN jsonb_build_object('pareada', false, 'codigo', d.codigo); END IF;
  RETURN jsonb_build_object(
    'pareada', true, 'nome', d.nome, 'local', d.local, 'ativa', d.ativo, 'comando', v_cmd,
    'itens', CASE WHEN NOT d.ativo THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'url', i.url, 'arquivo', i.arquivo,
                                                   'texto', i.texto, 'cor', i.cor, 'duracao_seg', i.duracao_seg, 'relatorio', i.relatorio,
                                                   'rel_periodo', i.rel_periodo, 'rel_visual', i.rel_visual) ORDER BY i.ordem, i.created_at), '[]'::jsonb)
        FROM public."TV_ITEM" i
       WHERE i.playlist_id = d.playlist_id AND i.ativo
         AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now() AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $function$;

-- Duas séries no detalhe de postos (a = contratados, b = cobertos) e do quadro (a = ativos, b = necessários).
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.tvg_calc(text, numeric)'::regprocedure);
  IF position($x$'a', necessarios, 'b', trabalhando$x$ IN d) = 0 THEN
    d := replace(d, $x$jsonb_build_object('nome', contrato, 'valor', falta, 'rotulo', '−' || falta$x$,
                    $x$jsonb_build_object('nome', contrato, 'a', necessarios, 'b', trabalhando, 'valor', falta, 'rotulo', '−' || falta$x$);
  END IF;
  IF position($x$SELECT contrato, ativos, necessarios, ativos - necessarios AS dif$x$ IN d) = 0 THEN
    d := replace(d, $x$WITH q AS (SELECT contrato, ativos - necessarios AS dif FROM public.tvg_quadro_contratos()$x$,
                    $x$WITH q AS (SELECT contrato, ativos, necessarios, ativos - necessarios AS dif FROM public.tvg_quadro_contratos()$x$);
    d := replace(d, $x$jsonb_build_object('nome', contrato, 'valor', dif, 'rotulo'$x$,
                    $x$jsonb_build_object('nome', contrato, 'a', ativos, 'b', necessarios, 'valor', dif, 'rotulo'$x$);
  END IF;
  EXECUTE d;
END $do$;

-- Milhar com ponto nos textos em R$ (to_char saía "R$ 2,555,808").
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.tvg_calc(text, numeric)'::regprocedure);
  IF position($x$R$ ' || replace(to_char($x$ IN d) = 0 THEN
    d := replace(d, $x$R$ ' || to_char($x$, $x$R$ ' || replace(to_char($x$);
    d := replace(d, $x
-- tv_estado: reaplicar sem 'rel_visual' (definição da mig 20261007000014).
-- ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
-- ALTER TABLE public."TV_ITEM" DROP COLUMN IF EXISTS rel_visual;
-- (os campos a/b do detalhe são inofensivos; a tela clássica os ignora)
FM999G999G990')$x$, $x
-- tv_estado: reaplicar sem 'rel_visual' (definição da mig 20261007000014).
-- ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
-- ALTER TABLE public."TV_ITEM" DROP COLUMN IF EXISTS rel_visual;
-- (os campos a/b do detalhe são inofensivos; a tela clássica os ignora)
FM999G999G990'), ',', '.')$x$);
  END IF;
  EXECUTE d;
END $do$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- tv_estado: reaplicar sem 'rel_visual' (definição da mig 20261007000014).
-- ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_rel_visual_check;
-- ALTER TABLE public."TV_ITEM" DROP COLUMN IF EXISTS rel_visual;
-- (os campos a/b do detalhe são inofensivos; a tela clássica os ignora)
