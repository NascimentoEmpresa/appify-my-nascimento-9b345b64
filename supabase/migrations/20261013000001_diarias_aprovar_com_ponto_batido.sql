-- =========================================================================
-- DIÁRIAS: APROVAR MESMO COM PONTO BATIDO DO FALTANTE (13/10/2026)
--
-- PEDIDO (Pablo): "a regra não está deixando aprovar a diária se tiver
-- batida — deixa sempre liberado pra aprovar, aí eles decidem se pode ou não".
--
-- Caso que motivou: SD-2026-000155 — faltante com batidas 07:02/11:05 no dia
-- e diária no turno da TARDE. A batida existe, mas não prova que a pessoa
-- cobriu o turno pedido; quem aprova é quem sabe.
--
-- O QUE MUDA: sai só a barreira da APROVAÇÃO (trigger diaria_aprovacao_ponto_trg,
-- mig 20261007000021). O aviso continua na tela (vermelho, com os horários)
-- e na lista ("Bateu ponto") — a decisão passa a ser do aprovador.
-- A barreira do LANÇAMENTO (diaria_linha_ponto_trg em DIARIA_LINHA) fica.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

DROP TRIGGER IF EXISTS diaria_aprovacao_ponto_trg ON public."DIARIA_SOLICITACAO";

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS diaria_aprovacao_ponto_trg ON public."DIARIA_SOLICITACAO";
-- CREATE TRIGGER diaria_aprovacao_ponto_trg
--   BEFORE UPDATE OF status ON public."DIARIA_SOLICITACAO"
--   FOR EACH ROW EXECUTE FUNCTION public.diaria_aprovacao_ponto_valida();
