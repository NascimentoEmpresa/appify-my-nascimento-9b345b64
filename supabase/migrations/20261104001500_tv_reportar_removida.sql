-- =========================================================================
-- Sistemas › TV's — tv_reportar SAI DO BANCO (04/11/2026)
--
-- Pablo: "tá fazendo muito chamado rest/v1/rpc/tv_reportar, otimiza isso".
-- O player novo já não chama (commit 0a3219da, "sem busca automática", main
-- 04/11 08:48): reportarLigado/batimentoLigado nascem false em TvPlayer.tsx.
-- Quem ainda chama é TV com o JS de antes, que só troca ao recarregar. Esse
-- JS para de chamar no primeiro erro de função inexistente (PGRST202, mesmo
-- caminho que já tinha para banco sem a mig 20261008000003): sem a função,
-- cada TV antiga faz UMA chamada a mais e desliga, sem precisar recarregar.
--
-- TV_DISPOSITIVO.atual_item_id/atual_desde/atual_em ficam (o AO VIVO de
-- Sistemas › TV's ainda lê; só param de mudar).
-- =========================================================================

DROP FUNCTION IF EXISTS public.tv_reportar(text, uuid, boolean);
DROP FUNCTION IF EXISTS public.tv_reportar(text, uuid);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (recriar a tv_reportar(text, uuid, boolean) da mig 20261020000004, com o
--  REVOKE ... FROM PUBLIC e o GRANT EXECUTE ... TO anon, authenticated)
-- NOTIFY pgrst, 'reload schema';
