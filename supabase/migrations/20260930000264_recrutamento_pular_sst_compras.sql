-- =========================================================================
-- Recrutamento: "Pular SST e Compras" (DOCUMENTAÇÃO → ADMISSÃO)
--
-- Pedido (29/09/2026): no kanban do processo seletivo, com o candidato em
-- DOCUMENTAÇÃO, um botão que pula a etapa paralela SST + COMPRAS e leva
-- direto para ADMISSÃO — e que só ALGUNS tenham, concedido em
-- Administração › Acesso por Usuário.
--
-- CAPACIDADE PRÓPRIA, NÃO O `alterar` DA TELA
--   `recrutamento_gestao`/alterar é quem conduz o processo (podeRecrutar) e
--   entra de brinde no toggle padrão. Se pular SST/Compras dependesse dele,
--   todo recrutador passaria a dispensar o exame admissional e o enxoval.
--   Menu fantasma (`rota = NULL`), mesmo mecanismo de
--   `recrutamento_etapa_*` e `recrutamento_solicitacao_*` (mig 077). Nasce
--   SEM ninguém liberado.
--
-- A TRAVA MORA NO BANCO
--   A RLS de WA_CURRICULOS (wa_curriculos_gate) deixa gravar quem enxerga a
--   tela — esconder o botão sozinho não impediria um UPDATE via API. O
--   trigger abaixo recusa DOCUMENTAÇÃO → ADMISSÃO de quem não tem a
--   capacidade. auth.uid() nulo (SQL Editor, jobs) passa: não é usuário do
--   app. O caminho normal (SST + COMPRAS → ADMISSÃO pelo
--   trg_rec_paralelo_admissao) não é tocado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── A capacidade ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_pular_sst_compras', 'Pular SST e Compras (Documentação → Admissão)', NULL, 23, true
  FROM public.app_modulo m
 WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('recrutamento_pular_sst_compras', 'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── A trava ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_pular_sst_compras_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.etapa_processo = 'DOCUMENTAÇÃO'
     AND NEW.etapa_processo = 'ADMISSÃO'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_screen_access(auth.uid(), 'recrutamento_pular_sst_compras', 'aprovar'::app_acao)
  THEN
    RAISE EXCEPTION 'Você não tem permissão para pular SST e Compras.';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.rec_pular_sst_compras_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_rec_pular_sst_compras_guard ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_pular_sst_compras_guard
  BEFORE UPDATE OF etapa_processo ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_pular_sst_compras_guard();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rec_pular_sst_compras_guard ON public."WA_CURRICULOS";
-- DROP FUNCTION IF EXISTS public.rec_pular_sst_compras_guard();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'recrutamento_pular_sst_compras';
-- DELETE FROM public.app_menu_acao          WHERE menu_codigo = 'recrutamento_pular_sst_compras';
-- DELETE FROM public.app_menu               WHERE codigo      = 'recrutamento_pular_sst_compras';
-- NOTIFY pgrst, 'reload schema';
