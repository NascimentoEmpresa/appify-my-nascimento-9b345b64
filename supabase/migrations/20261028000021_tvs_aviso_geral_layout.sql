-- =========================================================================
-- SISTEMAS › TV's — LAYOUT DO AVISO GERAL (28/10/2026)
--
-- Pablo, com o aviso de imagem já no ar (mig 20261028000020): "tenho que
-- conseguir montar como vai ser o layout da imagem na TV, se eu quiser que
-- apareça a imagem em um lado e um texto no outro tenho que conseguir".
--
--   · layout: 'cheia'    — imagem na tela inteira (texto, se houver, numa
--                          faixa embaixo) — o de antes;
--             'esquerda' — imagem à esquerda, texto à direita;
--             'direita'  — texto à esquerda, imagem à direita.
--     Aviso sem imagem ignora o layout (só texto, como sempre). Player
--     antigo ignora a chave nova.
--
-- tv_estado é a da mig 20261028000020 com 'layout' no 'alerta'. Idempotente.
-- =========================================================================

ALTER TABLE public."TV_ALERTA" ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'cheia';
ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_layout_ck;
ALTER TABLE public."TV_ALERTA" ADD CONSTRAINT tv_alerta_layout_ck CHECK (layout IN ('cheia', 'esquerda', 'direita'));

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
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim, 'inicio', a.inicio,
                                         'imagem', a.imagem, 'duracao_seg', a.duracao_seg, 'layout', a.layout)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now() AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $function$;
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar a tv_estado da mig 20261028000020)
-- ALTER TABLE public."TV_ALERTA" DROP CONSTRAINT IF EXISTS tv_alerta_layout_ck;
-- ALTER TABLE public."TV_ALERTA" DROP COLUMN IF EXISTS layout;
