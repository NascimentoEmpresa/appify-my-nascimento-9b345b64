-- =========================================================================
-- SISTEMAS › TV's — AO VIVO (08/10/2026)
--
-- PEDIDO (Pablo): "ao criar a playlist pra TV, ter um PREVIEW e um AO VIVO
-- que mostre exatamente como está a tela da TV e como vai ficar após
-- atualizar".
--
-- O "exatamente" precisa da TV dizer o que está na tela: a cada troca de
-- item o player chama tv_reportar(token, item) e a TV guarda o item atual e
-- desde quando. A gestão (Sistemas › TV's) lê essas duas colunas e desenha o
-- mesmo item com o próprio player (/tv/previa), com o aviso geral por cima,
-- pausa e relógio pelas regras do tv_estado.
--
-- Só ACRESCENTA (duas colunas + uma função). Sem esta migration o front
-- continua funcionando: o player para de chamar tv_reportar no primeiro
-- erro, e a gestão mostra o ao vivo "aproximado" (simulado pelos tempos).
--
-- tv_reportar é anon como tv_estado (a TV não tem login): vale só para o
-- token de uma TV pareada, e só aceita item da playlist daquela TV (ou NULL
-- = relógio/pausada). Também conta como sinal de vida (ultimo_ping).
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."TV_DISPOSITIVO" ADD COLUMN IF NOT EXISTS atual_item_id uuid;
ALTER TABLE public."TV_DISPOSITIVO" ADD COLUMN IF NOT EXISTS atual_desde timestamptz;

-- TV_DISPOSITIVO é lido por coluna (o token_hash nunca sai do banco): libera só as novas.
GRANT SELECT (atual_item_id, atual_desde) ON public."TV_DISPOSITIVO" TO authenticated;

CREATE OR REPLACE FUNCTION public.tv_reportar(p_token text, p_item uuid DEFAULT NULL)
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
     SET atual_item_id = p_item, atual_desde = now(), ultimo_ping = now()
   WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION public.tv_reportar(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_reportar(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_reportar(text, uuid);
-- ALTER TABLE public."TV_DISPOSITIVO" DROP COLUMN IF EXISTS atual_item_id, DROP COLUMN IF EXISTS atual_desde;
