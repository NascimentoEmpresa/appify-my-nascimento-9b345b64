-- =========================================================================
-- TV's › AO VIVO E "RECARREGAR A TV" (11/11/2026)
--
-- Pablo: "alguns clicam pra ver a TV ao vivo e não aparece nada, dá erro" —
-- e o botão "Recarregar a TV" mostrava "permission denied for table
-- TV_DISPOSITIVO" (até para ele).
--
-- 1. RECARREGAR / renomear / trocar playlist / remover TV: a tela faz UPDATE
--    e DELETE direto em TV_DISPOSITIVO (useTvs.ts), decididos pelas policies
--    tv_dispositivo_update/delete (sistemas_tvs alterar/excluir). No cluster o
--    papel authenticated ficou sem o privilégio de UPDATE/DELETE na tabela —
--    a mesma falta de GRANT da virada de 16/10 (mig 20261103002100). O
--    GRANT só deixa a policy decidir, como foi desenhado. A leitura continua
--    por coluna (o token_hash nunca sai).
-- 2. AO VIVO da TV Operacional (relatório 'ope-contratos'): a prévia cobrava
--    a tela Indicadores por Contrato, que nasceu sem ninguém — quem gerencia
--    as TVs e não tinha essa tela via erro. Agora vale também quem tem as
--    TVs (sistemas_tvs / tvs_gerenciais), como as prévias de Compras e
--    Recrutamento (migs 20261111180000 e 20261111190000).
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

SET lock_timeout = '5s';

GRANT UPDATE (nome, local, playlist_id, comando, comando_em, ativo) ON public."TV_DISPOSITIVO" TO authenticated;
GRANT DELETE ON public."TV_DISPOSITIVO" TO authenticated;
-- A leitura por coluna (mig 20261007000012 + ao vivo 20261020000004), de novo
-- por garantia: sem ela o UPDATE ... WHERE id não acha a linha.
GRANT SELECT (id, codigo, nome, local, playlist_id, pareado_em, pareado_por, ultimo_ping, user_agent, tela, comando, comando_em, ativo, created_at,
              atual_item_id, atual_desde, atual_em)
  ON public."TV_DISPOSITIVO" TO authenticated;

CREATE OR REPLACE FUNCTION public.tv_ope_contratos_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'ope_indicadores_contratos', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso às TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_ope_contratos_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_ope_contratos_previa() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- REVOKE UPDATE (nome, local, playlist_id, comando, comando_em, ativo) ON public."TV_DISPOSITIVO" FROM authenticated;
-- REVOKE DELETE ON public."TV_DISPOSITIVO" FROM authenticated;
-- (reexecutar o CREATE de tv_ope_contratos_previa da mig 20261111130000)
-- NOTIFY pgrst, 'reload schema';
