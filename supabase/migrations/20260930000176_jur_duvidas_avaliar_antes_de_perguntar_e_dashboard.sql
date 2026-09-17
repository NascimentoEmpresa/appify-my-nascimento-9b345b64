-- =========================================================================
-- Orientações Jurídicas: avaliar antes de perguntar de novo, "Não resolveu"
-- fora da biblioteca e o dashboard de avaliações com permissão própria
--
-- PEDIDO (17/09/2026, Pablo)
--   • Dúvida avaliada como "Não resolveu" não aparece na biblioteca pública.
--   • Em Minhas perguntas a pessoa avalia; para abrir OUTRA pergunta é
--     obrigatório ter avaliado as anteriores. Perguntar mais DENTRO da
--     dúvida (fio de complementos, mig 170) não exige nada.
--   • Dashboard de avaliações e categorias, só pra quem tem permissão.
--
-- O QUE MUDA
--   1. Trigger jur_duvidas_exige_avaliacao (BEFORE INSERT em JUR_DUVIDAS):
--      se o autor tem dúvida 'Respondida' sem avaliação, a nova é recusada
--      com a mensagem que a tela mostra. A tela já bloqueia antes; o
--      trigger é o piso (o front antigo do site não conhece a regra).
--   2. Menu fantasma `duvidas_dashboard` (rota NULL) no módulo Jurídico —
--      é a permissão que libera a aba Dashboard em Parecer Jurídico. J2:
--      semeado no perfil "Jurídico" (visualizar).
--   3. "Não resolveu" fora da biblioteca é regra de tela (lib/juridico/
--      duvidas.ts, entraNaBiblioteca): a RLS de leitura continua aberta
--      porque o autor precisa ver a própria dúvida em Minhas perguntas.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Avaliar antes de perguntar de novo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvidas_exige_avaliacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_pendentes integer;
BEGIN
  IF NEW.autor_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_pendentes
    FROM public."JUR_DUVIDAS" d
   WHERE d.autor_id = NEW.autor_id
     AND d.status = 'Respondida'
     AND d.avaliacao IS NULL;
  IF v_pendentes > 0 THEN
    RAISE EXCEPTION 'Avalie a resposta da(s) sua(s) % pergunta(s) anterior(es) em Minhas perguntas antes de abrir uma nova. Para perguntar mais sobre o mesmo assunto, use "Pergunte mais" dentro da própria dúvida.', v_pendentes;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_duvidas_exige_avaliacao ON public."JUR_DUVIDAS";
CREATE TRIGGER trg_jur_duvidas_exige_avaliacao
  BEFORE INSERT ON public."JUR_DUVIDAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_duvidas_exige_avaliacao();

-- ── 2) Permissão do dashboard (menu fantasma) ────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'duvidas_dashboard', 'Parecer Jurídico — Dashboard de avaliações', NULL,
       COALESCE((SELECT max(y.ordem) FROM public.app_menu y WHERE y.modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'juridico'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu z WHERE z.codigo = 'duvidas_dashboard');

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'duvidas_dashboard', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.nome = 'Jurídico' AND pa.ativo
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao pp
      WHERE pp.perfil_id = pa.id AND pp.menu_codigo = 'duvidas_dashboard' AND pp.acao = 'visualizar'::public.app_acao);

NOTIFY pgrst, 'reload schema';

-- Conferência: quem está devendo avaliação hoje.
-- SELECT autor_nome, count(*) FROM public."JUR_DUVIDAS"
--  WHERE status = 'Respondida' AND avaliacao IS NULL GROUP BY 1 ORDER BY 2 DESC;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_jur_duvidas_exige_avaliacao ON public."JUR_DUVIDAS";
-- DROP FUNCTION IF EXISTS public.jur_duvidas_exige_avaliacao();
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'duvidas_dashboard';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'duvidas_dashboard';
-- DELETE FROM public.app_menu WHERE codigo = 'duvidas_dashboard';
-- NOTIFY pgrst, 'reload schema';
