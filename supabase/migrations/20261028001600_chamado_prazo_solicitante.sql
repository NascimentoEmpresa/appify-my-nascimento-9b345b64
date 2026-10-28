-- =========================================================================
-- Chamados de Sistemas: PRAZO DO SOLICITANTE (28/10/2026, SIS-2026-0763)
--
-- Complemento do Pablo ao chamado do Painel do Desenvolvedor: "o solicitante
-- manda já com o prazo esperado, e o desenvolvedor manda com o prazo real de
-- desenvolvimento ao iniciar o chamado."
--
--   · prazo_solicitante (date): a data em que quem abre precisa da entrega.
--     Obrigatória na tela de abertura (AbrirChamado) — no banco fica nullable
--     porque há outros caminhos que criam chamado (encaminhamento de bug do
--     Checklist de Módulos, mig 291) e os chamados antigos não têm.
--   · Não aceita data no passado ao abrir. Depois de aberto, só a coordenação
--     muda (é o combinado com quem pediu; o dev informa o PRAZO REAL dele em
--     prazo_dias ao iniciar — mig 20261028001500).
--   · O prazo real do dev continua em chamado_iniciar_desenvolvimento /
--     chamado_definir_prazo (mig 20261028001500), sem mudança aqui.
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS prazo_solicitante date;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".prazo_solicitante IS
  'Prazo esperado informado por quem abriu o chamado (mig 20261028001600). Depois de aberto, só a coordenação muda.';

CREATE OR REPLACE FUNCTION public.chamado_sistema_prazo_solicitante()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.prazo_solicitante IS NOT NULL AND NEW.prazo_solicitante < v_hoje THEN
      RAISE EXCEPTION 'O prazo esperado não pode ser uma data que já passou.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.prazo_solicitante IS DISTINCT FROM OLD.prazo_solicitante
     AND NOT (COALESCE(auth.role() = 'service_role', false)
              OR COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false)
              OR public.tem_acesso_menu('chamados_sistemas_coordenar')) THEN
    RAISE EXCEPTION 'O prazo esperado do solicitante só pode ser alterado pela coordenação.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_prazo_solicitante() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_prazo_solicitante ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_prazo_solicitante
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_prazo_solicitante();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_prazo_solicitante ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_prazo_solicitante();
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS prazo_solicitante;
-- NOTIFY pgrst, 'reload schema';
