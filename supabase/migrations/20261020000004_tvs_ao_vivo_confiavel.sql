-- =========================================================================
-- SISTEMAS › TV's — AO VIVO que bate com a TV (20/10/2026)
--
-- Pablo: "parece que as TVs não estão vinculadas corretamente no sistema,
-- quando coloco em ao vivo não aparece o que está aparecendo na TV".
--
-- O que foi achado (banco antigo, 20/10/2026):
--   · TV SST e TV COMPRAS seguiram falando com a Supabase ANTIGA até
--     19/10 17:48 — três dias depois da virada para o cluster (16/10). O
--     navegador da TV ficou com o JS velho (URL do banco embutida) e o cão
--     de guarda não recarrega quem consegue falar com algum banco. Na
--     gestão (cluster) elas apareciam offline/paradas, e playlist e
--     "Recarregar" não chegavam. Correção no player: confere a versão
--     publicada a cada 10 min e recarrega sozinho quando muda.
--   · tv_reportar só era chamado na TROCA de item. 6 das 7 TVs têm UM item
--     (um relatório que gira páginas): se esse único aviso falhasse (rede,
--     função velha no cluster), a gestão ficava com o item errado ou no
--     modo "aproximado" até a TV recarregar. Agora a TV confirma o item a
--     cada consulta (p_troca = false: não zera o "desde") e atual_em diz
--     quando ela falou por último — a gestão sabe se a informação é fresca.
--
-- tv_reportar ganha p_troca (DEFAULT true = comportamento antigo, para o
-- player que ainda não recarregou). DROP + CREATE porque um overload novo
-- deixaria a chamada de 2 argumentos ambígua no PostgREST.
-- tv_estado é recriado igual à mig 20261014000002: em 19/10 as funções do
-- cluster vieram velhas da replicação (ver mig 20261019000005) — assim fica
-- garantida a versão atual.
-- Idempotente.
-- =========================================================================

ALTER TABLE public."TV_DISPOSITIVO" ADD COLUMN IF NOT EXISTS atual_item_id uuid;
ALTER TABLE public."TV_DISPOSITIVO" ADD COLUMN IF NOT EXISTS atual_desde timestamptz;
ALTER TABLE public."TV_DISPOSITIVO" ADD COLUMN IF NOT EXISTS atual_em timestamptz;

-- TV_DISPOSITIVO é lido por coluna (o token_hash nunca sai do banco).
GRANT SELECT (atual_item_id, atual_desde, atual_em) ON public."TV_DISPOSITIVO" TO authenticated;

DROP FUNCTION IF EXISTS public.tv_reportar(text, uuid);
CREATE OR REPLACE FUNCTION public.tv_reportar(p_token text, p_item uuid DEFAULT NULL, p_troca boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE d public."TV_DISPOSITIVO";
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND OR d.pareado_em IS NULL THEN RETURN; END IF;
  IF p_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."TV_ITEM" i WHERE i.id = p_item AND i.playlist_id = d.playlist_id) THEN
    RETURN;   -- item de outra playlist: ignora (a TV pega a playlist nova na próxima consulta)
  END IF;
  UPDATE public."TV_DISPOSITIVO"
     SET atual_item_id = p_item,
         -- Batimento (p_troca = false) do mesmo item não mexe no "desde":
         -- é dele que a gestão tira a página e o ponto do vídeo.
         atual_desde   = CASE WHEN p_troca OR atual_item_id IS DISTINCT FROM p_item OR atual_desde IS NULL THEN now() ELSE atual_desde END,
         atual_em      = now(),
         ultimo_ping   = now()
   WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION public.tv_reportar(text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_reportar(text, uuid, boolean) TO anon, authenticated;

-- tv_estado: a da mig 20261014000002 (com rel_visual), sem mudança.
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
REVOKE ALL ON FUNCTION public.tv_estado(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_estado(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_reportar(text, uuid, boolean);
-- (recriar a tv_reportar(text, uuid) da mig 20261008000003)
-- ALTER TABLE public."TV_DISPOSITIVO" DROP COLUMN IF EXISTS atual_em;
