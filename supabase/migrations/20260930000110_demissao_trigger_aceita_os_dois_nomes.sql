-- =========================================================================
-- Demissão: trigger da vaga aceita os dois nomes da etapa 1; rename refeito
--
-- Complemento da 20260930000103 (que já rodou em produção — por isso esta é
-- uma migration NOVA, regra R4: migration é append-only).
--
-- O QUE ACONTECEU (14/09/2026)
--   1. A 103 rodava o UPDATE de status ANTES de recriar demissao_exige_vaga.
--      A versão antiga do trigger viu "saiu de Pendente Analista sem vaga"
--      e estourou na #57 (MARIA APARECIDA KUNZLER). Renomear a etapa não é
--      fazer o pedido seguir — o trigger não pode barrar isso.
--   2. A 103 foi aplicada no banco antes do deploy do front; a produção
--      antiga (que lista só "Pendente Analista") deixou de ver as pendentes
--      e os analistas viam contagens diferentes conforme a hora. O banco
--      foi revertido pra "Pendente Analista" até o deploy, e depois do
--      deploy o rename foi refeito.
--
-- O QUE ESTA MIGRATION FAZ
--   • demissao_exige_vaga aceita 'Pendente Operacional' E 'Pendente
--     Analista' como etapa 1 — cobre qualquer front (antigo ou novo) e
--     qualquer ordem de aplicação/deploy.
--   • Refaz o UPDATE Analista → Operacional, idempotente: é o que vale com
--     o front novo no ar. Se por algum motivo o front antigo voltar, é este
--     UPDATE invertido que devolve a visibilidade — não edite a 103.
--
-- Idempotente. Aplicar no banco do app (já aplicada em 14/09/2026).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Os dois nomes da etapa 1 são aceitos de propósito (ver cabeçalho).
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Reprovada') THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Quem solicitou precisa abrir a vaga de Substituição de % antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_exige_vaga ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_exige_vaga
  BEFORE UPDATE OF status ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_exige_vaga();

-- Depois do trigger, de propósito (ver item 1 do cabeçalho).
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente Operacional'
 WHERE status = 'Pendente Analista';

NOTIFY pgrst, 'reload schema';

-- Conferência: deve devolver 0.
-- SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE status = 'Pendente Analista';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar o bloco CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
-- da 20260930000103 (só 'Pendente Operacional') e NOTIFY pgrst, 'reload schema';
