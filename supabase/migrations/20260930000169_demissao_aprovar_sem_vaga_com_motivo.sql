-- =========================================================================
-- Demissão: o Operacional aprova SEM a vaga de Substituição, com motivo
--
-- PEDIDO (17/09/2026, Pablo)
--   No Operacional › Solicitações de Demissão, poder "Aprovar e enviar ao
--   RH" mesmo quando não foi aberta a vaga de Substituição — desde que a
--   tela avise ("essa demissão não tem vaga de substituição aberta") e quem
--   aprova DESCREVA O MOTIVO DA EXCEÇÃO.
--
-- O QUE TRAVAVA
--   demissao_exige_vaga (mig 092/110/127): pedido com `vaga_obrigatoria`
--   (quem solicitou respondeu "Sim" à substituição) e sem `vaga_id` não sai
--   da etapa 1. No banco do app hoje há 3 pedidos presos assim — a vaga
--   nunca foi aberta e ninguém consegue dar andamento.
--
-- A REGRA AGORA
--   • Coluna `sem_vaga_motivo`: a justificativa de aprovar sem a vaga.
--   • O trigger continua barrando a saída da etapa 1 sem vaga — MENOS quando
--     `sem_vaga_motivo` vem preenchido (mín. 10 caracteres, mesma régua do
--     motivo da reprovação). A exceção fica gravada e aparece no card para
--     RH, SST e analista.
--   • Pedido sem `vaga_obrigatoria` (respondeu "Não" ou veio da tela antiga)
--     nunca foi barrado pelo banco e continua assim; a TELA é que passa a
--     pedir o motivo em qualquer aprovação sem vaga, para ficar registrado.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS sem_vaga_motivo text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".sem_vaga_motivo IS
  'Motivo da exceção quando a etapa 1 (Operacional/Diretoria) aprovou a demissão SEM a vaga de Substituição aberta. Preenchido, libera a saída da etapa 1 mesmo com vaga_obrigatoria (trigger demissao_exige_vaga).';

CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Os dois nomes da etapa 1 continuam aceitos (ver mig 110); a Diretoria
  -- também é etapa 1 (mig 127). A novidade é a última condição: com o
  -- motivo da exceção escrito, o pedido segue sem a vaga.
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada')
     AND length(btrim(coalesce(NEW.sem_vaga_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Abra a vaga de Substituição de % ou descreva o motivo da exceção antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- Conferência: pedidos ainda presos na etapa 1 sem vaga e sem exceção.
-- SELECT id, colaborador_nome, status FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
--  WHERE vaga_obrigatoria AND vaga_id IS NULL AND sem_vaga_motivo IS NULL
--    AND status IN ('Pendente Operacional', 'Pendente Diretoria');

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar o bloco CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
-- da 20260930000127 (sem a condição do sem_vaga_motivo);
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" DROP COLUMN IF EXISTS sem_vaga_motivo;
-- NOTIFY pgrst, 'reload schema';
