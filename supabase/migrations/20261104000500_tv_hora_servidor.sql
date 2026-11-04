-- =========================================================================
-- Sistemas › TV's — HORA DO SERVIDOR para o online/offline (04/11/2026)
--
-- Chamado da Helena: todas as TVs "offline" só para ela. O ultimo_ping é
-- gravado com now() do banco (tv_estado), mas a tela comparava com o relógio
-- do computador de quem olha (statusTv em src/lib/tv/tv.ts). Relógio
-- adiantado mais de 50 s = tudo offline. A tela agora pede a hora do banco e
-- desconta a diferença (src/hooks/useTvs.ts); sem esta função ela segue como
-- antes (diferença zero).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tv_hora_servidor()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT clock_timestamp() $$;

REVOKE EXECUTE ON FUNCTION public.tv_hora_servidor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tv_hora_servidor() FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_hora_servidor() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_hora_servidor();
-- NOTIFY pgrst, 'reload schema';
