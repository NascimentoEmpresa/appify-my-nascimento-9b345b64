-- =========================================================================
-- TVs: A TELA DE PLAYLISTS VOLTA (18/11/2026) — hotfix da mig 20261118140000
--
-- Incidente: depois do merge da 20261118140000, Sistemas › TV's mostrou
-- "Nenhuma playlist ainda" (Pablo: "agora caiu todas TVs e nem playlist tem
-- mais"). Os dados estavam intactos; a tela lê
--   TV_PLAYLIST?select=…,itens:TV_ITEM(*)
-- e a coluna nova TV_ITEM.inclui_playlist_id tinha FK para TV_PLAYLIST: duas
-- ligações entre as mesmas tabelas → o PostgREST não escolhe e responde 300
-- PGRST201 ("Could not embed because more than one relationship was found").
-- O useTvPlaylists engolia o erro como lista vazia.
--
-- Correção: sai a FK de inclui_playlist_id (a ambiguidade some na hora, sem
-- esperar deploy do front). O que a FK fazia passa para um gatilho: excluir
-- uma playlist apaga os itens "Outra playlist" que a incluíam. A coerência do
-- item segue no CHECK tv_item_inclui_playlist_check. O front também passou a
-- nomear a ligação (TV_ITEM!TV_ITEM_playlist_id_fkey) — vale com ou sem esta.
--
-- REGRA para quem mexer aqui: nada de FK nova de TV_ITEM para TV_PLAYLIST.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS "TV_ITEM_inclui_playlist_id_fkey";

-- Inclusão apontando para playlist que não existe (não deveria haver): sai.
DELETE FROM public."TV_ITEM" i
 WHERE i.tipo = 'playlist'
   AND NOT EXISTS (SELECT 1 FROM public."TV_PLAYLIST" p WHERE p.id = i.inclui_playlist_id);

CREATE OR REPLACE FUNCTION public.tv_playlist_apaga_inclusoes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  DELETE FROM public."TV_ITEM" WHERE inclui_playlist_id = OLD.id;
  RETURN OLD;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_playlist_apaga_inclusoes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tv_playlist_apaga_inclusoes ON public."TV_PLAYLIST";
CREATE TRIGGER trg_tv_playlist_apaga_inclusoes AFTER DELETE ON public."TV_PLAYLIST"
  FOR EACH ROW EXECUTE FUNCTION public.tv_playlist_apaga_inclusoes();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (não recriar a FK: ela é que derrubou a tela)
-- DROP TRIGGER IF EXISTS trg_tv_playlist_apaga_inclusoes ON public."TV_PLAYLIST";
-- DROP FUNCTION IF EXISTS public.tv_playlist_apaga_inclusoes();
