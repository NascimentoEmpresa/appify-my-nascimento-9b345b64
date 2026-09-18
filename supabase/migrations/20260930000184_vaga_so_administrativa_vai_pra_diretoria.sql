-- =========================================================================
-- Vaga: só a ADMINISTRATIVA (caixa marcada) nasce na Diretoria
--
-- SINTOMA (17/09/2026)
--   Diretoria com duas vagas de SERVENTE DE LIMPEZA da UFRGS (#198, #210).
--   O encarregado preencheu "Setor: Operacional" e, pela regra da mig 127
--   ("administrativa OU setor"), a vaga foi pra fila da Diretoria.
--
-- REGRA (pedido do Pablo): "só vai pra tela de diretoria se a vaga for
-- administrativa". O front mudou (ehVagaAdministrativa = só a flag; o campo
-- Setor só aparece com a caixa marcada). Aqui é o piso, porque a produção
-- ainda roda o front antigo:
--   1. Trigger rec_status_inicial_pela_flag (BEFORE INSERT): vaga SEM a
--      flag que chegar como 'Pendente Diretoria' nasce 'Pendente Analista';
--      vaga COM a flag que chegar como 'Pendente Analista' nasce 'Pendente
--      Diretoria'.
--   2. Estoque: as vagas em 'Pendente Diretoria' sem a flag voltam pra
--      'Pendente Analista' (a fila normal do analista/Operacional).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_status_inicial_pela_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF coalesce(NEW.administrativa, false) = false AND NEW.status = 'Pendente Diretoria' THEN
    NEW.status := 'Pendente Analista';
  ELSIF coalesce(NEW.administrativa, false) = true AND NEW.status = 'Pendente Analista' THEN
    NEW.status := 'Pendente Diretoria';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rec_status_inicial_pela_flag ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_status_inicial_pela_flag
  BEFORE INSERT ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_status_inicial_pela_flag();

-- Estoque: sai da Diretoria o que não é administrativa. O guard da tabela
-- (sistema_recrutamento_guard) recusa UPDATE de quem não é gestor pelo
-- auth.uid() — aqui não há sessão, então ele fica desligado só pra este
-- comando, como se faz em toda manutenção de estoque desta tabela.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET status = 'Pendente Analista', status_changed_at = now()
 WHERE status = 'Pendente Diretoria' AND coalesce(administrativa, false) = false;
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".setor IS
  'Setor de quem aprova a vaga ADMINISTRATIVA (SISTEMA_APROVADOR_SETOR). Desde 17/09/2026 o setor sozinho NÃO manda a vaga pra Diretoria — só a flag administrativa (mig 184).';

NOTIFY pgrst, 'reload schema';

-- Conferência: deve devolver 0.
-- SELECT count(*) FROM public."SISTEMA_RECRUTAMENTO" WHERE status = 'Pendente Diretoria' AND coalesce(administrativa,false) = false;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rec_status_inicial_pela_flag ON public."SISTEMA_RECRUTAMENTO";
-- DROP FUNCTION IF EXISTS public.rec_status_inicial_pela_flag();
-- NOTIFY pgrst, 'reload schema';
