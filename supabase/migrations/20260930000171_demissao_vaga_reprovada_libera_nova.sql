-- =========================================================================
-- Demissão ↔ Vaga: vaga REPROVADA/CANCELADA libera abrir outra pra mesma demissão
--
-- SINTOMA (17/09/2026, Encarregados › Solicitar Vaga)
--   "Erro ao solicitar vaga: duplicate key value violates unique constraint
--   uq_sistema_recrutamento_demissao". A demissão de GUILHERME AGUIAR DE
--   OLIVEIRA (#69) tinha a vaga #195, que foi REPROVADA; o encarregado
--   tentou abrir a substituição de novo e o banco recusou.
--
-- CAUSA
--   A mig 092 criou o índice "uma demissão abre UMA vaga" sem a cláusula que
--   a mig 20260909000009 já usava no índice do substituído: vaga Reprovada
--   ou Cancelada não repõe ninguém e não pode segurar a demissão. A própria
--   tela (ModalNovaVaga) assume isso — "a vaga anterior pode ter sido
--   reprovada ou cancelada" — e o banco contradizia.
--
-- O QUE MUDA
--   1. O índice passa a valer só para vaga VIVA (status fora de Reprovada /
--      Cancelada), igual ao do substituído.
--   2. rec_vaga_avisa_demissao também roda quando o STATUS da vaga muda:
--      vaga que morre solta a demissão (vaga_id = NULL) — assim a lista do
--      encarregado volta a mostrar "Falta a vaga · Solicitar vaga", e a
--      demissão presa na etapa 1 continua presa até a vaga nova (ou a
--      exceção da mig 169). Vaga que "ressuscita" volta a apontar.
--   3. Estoque: demissões apontando pra vaga morta ficam sem vaga_id.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Índice: uma demissão tem UMA vaga VIVA ───────────────────────────
DROP INDEX IF EXISTS public.uq_sistema_recrutamento_demissao;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sistema_recrutamento_demissao
  ON public."SISTEMA_RECRUTAMENTO" (demissao_id)
  WHERE demissao_id IS NOT NULL
    AND status NOT IN ('Reprovada', 'Cancelada');

-- ── 2) Vaga que morre solta a demissão; vaga nova (ou viva) aponta ──────
CREATE OR REPLACE FUNCTION public.rec_vaga_avisa_demissao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_morta boolean := coalesce(NEW.status, '') IN ('Reprovada', 'Cancelada');
BEGIN
  IF NEW.demissao_id IS NOT NULL THEN
    IF v_morta THEN
      -- Só solta se a demissão apontava pra ESTA vaga (outra viva pode já ter assumido).
      UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
         SET vaga_id = NULL
       WHERE id = NEW.demissao_id AND vaga_id = NEW.id;
    ELSE
      UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
         SET vaga_id = NEW.id
       WHERE id = NEW.demissao_id AND vaga_id IS DISTINCT FROM NEW.id;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.demissao_id IS NOT NULL AND OLD.demissao_id IS DISTINCT FROM NEW.demissao_id THEN
    UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
       SET vaga_id = NULL
     WHERE id = OLD.demissao_id AND vaga_id = NEW.id;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_vaga_avisa_demissao ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_vaga_avisa_demissao
  AFTER INSERT OR UPDATE OF demissao_id, status ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_vaga_avisa_demissao();

-- ── 3) Estoque: demissão apontando pra vaga morta fica sem vaga ─────────
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" d
   SET vaga_id = NULL
  FROM public."SISTEMA_RECRUTAMENTO" r
 WHERE r.id = d.vaga_id
   AND coalesce(r.status, '') IN ('Reprovada', 'Cancelada');

NOTIFY pgrst, 'reload schema';

-- Conferência: nenhuma demissão apontando pra vaga morta.
-- SELECT d.id, d.colaborador_nome, r.id AS vaga, r.status
--   FROM public."SISTEMA_SOLICITACOES_DEMISSAO" d JOIN public."SISTEMA_RECRUTAMENTO" r ON r.id = d.vaga_id
--  WHERE r.status IN ('Reprovada', 'Cancelada');

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP INDEX IF EXISTS public.uq_sistema_recrutamento_demissao;
-- CREATE UNIQUE INDEX uq_sistema_recrutamento_demissao ON public."SISTEMA_RECRUTAMENTO" (demissao_id) WHERE demissao_id IS NOT NULL;
-- Reaplicar rec_vaga_avisa_demissao e o trigger (AFTER INSERT OR UPDATE OF demissao_id) da 20260930000092.
-- NOTIFY pgrst, 'reload schema';
