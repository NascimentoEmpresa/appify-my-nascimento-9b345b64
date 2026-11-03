-- =========================================================================
-- PARECER DA I.A: PREÇO PELA ENTREGA REAL (pedido do Pablo, 29/10/2026)
--
-- "esse chamado deu 3500 só, e 30 horas de desenvolvimento, mas deu MUIITO
-- mais trabalho... outras i.as avaliaram esse serviço com entorno de 80 mil,
-- algumas 200 mil... a i.a tem que avaliar melhor."
--
-- O caso é o SIS-2026-0276: duas linhas de descrição na abertura e mais de 70
-- PRs depois (Supabase → cluster próprio de alta disponibilidade em três
-- provedores, réplica, backup, failover). A primeira versão do parecer
-- (mig 20261029000900) só lia o texto de abertura, então precificou o pedido,
-- não o trabalho.
--
-- A Edge Function chamado-parecer-ia passa a mandar à I.A as PRs e as
-- métricas do GitHub (CHAMADO_SISTEMA_EVENTO, meta canal github), com régua
-- de "preço de mercado do que foi entregue". Esta migration cuida de QUANDO
-- refazer:
--   1. ao CONCLUIR o chamado, o parecer é refeito sozinho — é quando a
--      entrega está toda no histórico. O da abertura continua (serve à
--      coordenação, antes de existir PR);
--   2. agora: todo parecer já gerado de chamado concluído é refeito com a
--      régua nova.
-- Refazer não esconde o parecer anterior: ele continua na tela até o novo
-- chegar (o status só vira 'pendente' quando ainda não há parecer).
-- =========================================================================

-- ── 1) Enfileirar com "forçar" ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_parecer_ia_enfileirar(p_chamado_id uuid, p_forcar boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT p_forcar THEN
    PERFORM public.chamado_parecer_ia_enfileirar(p_chamado_id);
    RETURN;
  END IF;

  -- Só cria a linha 'pendente' se ainda não há nada; parecer pronto ou com
  -- erro fica como está até a function gravar o novo.
  INSERT INTO public."CHAMADO_SISTEMA_PARECER_IA" (chamado_id, status)
  VALUES (p_chamado_id, 'pendente')
  ON CONFLICT (chamado_id) DO NOTHING;

  PERFORM public.enfileirar_http('chamado-parecer-ia', jsonb_build_object('chamado_id', p_chamado_id, 'forcar', true));
END $$;

REVOKE ALL ON FUNCTION public.chamado_parecer_ia_enfileirar(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ── 2) Refazer ao concluir ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_concluido_refaz_parecer_ia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.chamado_parecer_ia_enfileirar(NEW.id, true);
  EXCEPTION WHEN OTHERS THEN
    -- Concluir o chamado nunca pode falhar por causa do parecer.
    RAISE WARNING 'chamado-parecer-ia não foi enfileirada na conclusão de %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chamado_concluido_refaz_parecer_ia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_concluido_parecer_ia ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_concluido_parecer_ia
  AFTER UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido')
  EXECUTE FUNCTION public.chamado_concluido_refaz_parecer_ia();

-- ── 3) Reavaliar já os concluídos que têm parecer ────────────────────────
-- Para rodar de novo à mão (no banco1):
--   SELECT public.chamado_parecer_ia_enfileirar(p.chamado_id, true)
--     FROM public."CHAMADO_SISTEMA_PARECER_IA" p
--     JOIN public."CHAMADO_SISTEMA" c ON c.id = p.chamado_id
--    WHERE c.status = 'concluido';
SELECT public.chamado_parecer_ia_enfileirar(p.chamado_id, true)
  FROM public."CHAMADO_SISTEMA_PARECER_IA" p
  JOIN public."CHAMADO_SISTEMA" c ON c.id = p.chamado_id
 WHERE c.status = 'concluido';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_chamado_concluido_parecer_ia ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_concluido_refaz_parecer_ia();
--   DROP FUNCTION IF EXISTS public.chamado_parecer_ia_enfileirar(uuid, boolean);
-- =========================================================================
