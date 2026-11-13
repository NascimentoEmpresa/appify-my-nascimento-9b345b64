-- =========================================================================
-- TVs: "RECARREGAR" CHEGA EM ATÉ 1 MINUTO (14/11/2026)
--
-- Pablo: "clico para recarregar e a TV não atualiza; tenho que ir até a TV e
-- recarregar a página". Três causas:
--   1. a TV só lia o comando no ping de 4 min (tv_estado, exceção de
--      04/11/2026) — quem clicava e olhava a TV não via nada acontecer;
--   2. o botão de Sistemas › TV's gravava comando_em com o relógio da máquina
--      de quem clicava; tv_estado descarta comando com mais de 10 min pelo
--      relógio do BANCO. Máquina adiantada/atrasada = comando ignorado calado;
--   3. "Atualizar" de TV's › Indicadores gerenciais só atualizava aquela tela:
--      não mandava nada para as TVs.
--
-- O que muda:
--   · tv_tem_comando(token): pergunta de UMA linha pelo índice único de
--     token_hash, sem escrita, sem playlist. A TV (rota pública /tv, fora do
--     QA de telas) pergunta a cada 60 s; só quando a resposta é "sim" ela
--     chama a tv_estado, que entrega e limpa o comando. Com ~13 TVs são ~13
--     consultas de índice por minuto — o ping pesado segue em 4 min;
--   · tv_recarregar(ids): o botão de Sistemas › TV's, com now() do banco;
--   · tv_recarregar_relatorios(relatórios): o "Atualizar" dos Indicadores
--     gerenciais manda recarregar as TVs cuja playlist toca aquela área.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) A TV pergunta se tem comando (anon: a TV não tem login) ───────────
CREATE OR REPLACE FUNCTION public.tv_tem_comando(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public."TV_DISPOSITIVO"
     WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
       AND comando IS NOT NULL AND comando_em > now() - interval '10 minutes');
$fn$;
REVOKE ALL ON FUNCTION public.tv_tem_comando(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_tem_comando(text) TO anon, authenticated;

-- ── 2) Recarregar TVs escolhidas (Sistemas › TV's) ───────────────────────
CREATE OR REPLACE FUNCTION public.tv_recarregar(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem liberação para recarregar TVs.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."TV_DISPOSITIVO" SET comando = 'recarregar', comando_em = now() WHERE id = ANY (coalesce(p_ids, '{}'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_recarregar(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_recarregar(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_recarregar(uuid[]) TO authenticated;

-- ── 3) Recarregar as TVs de uma área (TV's › Indicadores gerenciais) ─────
-- Recarregar não muda dado nenhum, só faz a TV buscar os números de novo:
-- basta poder ver os Indicadores gerenciais (ou alterar as TVs).
CREATE OR REPLACE FUNCTION public.tv_recarregar_relatorios(p_relatorios text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE n integer;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem liberação para recarregar TVs.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."TV_DISPOSITIVO" d SET comando = 'recarregar', comando_em = now()
   WHERE d.ativo AND d.pareado_em IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public."TV_ITEM" i
        WHERE i.playlist_id = d.playlist_id AND i.ativo
          AND (i.relatorio = ANY (coalesce(p_relatorios, '{}'))
               OR i.relatorio IN (SELECT 'ind:' || g.codigo FROM public."TVG_INDICADOR" g WHERE g.painel = ANY (coalesce(p_relatorios, '{}')))));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.tv_recarregar_relatorios(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_recarregar_relatorios(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.tv_recarregar_relatorios(text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_recarregar_relatorios(text[]);
-- DROP FUNCTION IF EXISTS public.tv_recarregar(uuid[]);
-- DROP FUNCTION IF EXISTS public.tv_tem_comando(text);
