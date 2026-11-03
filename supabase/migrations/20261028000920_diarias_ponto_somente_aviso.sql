-- =========================================================================
-- DIÁRIAS: PONTO BATIDO PASSA A SER SOMENTE AVISO (28/10/2026)
--
-- RELATO: uma diária do turno da tarde não podia ser lançada porque o
-- faltante tinha batidas apenas pela manhã. A presença de alguma marcação no
-- dia não prova conflito com o turno coberto pela diária.
--
-- DECISÃO: permitir criar e ajustar a solicitação mesmo quando houver batida.
-- A tela continua mostrando o aviso vermelho e os horários; a lista e o
-- Malote também continuam sinalizando o caso para conferência.
--
-- A aprovação já havia sido liberada pela mig 20261013000001. Esta migration
-- remove a barreira restante do lançamento/ajuste, criada na mig
-- 20261007000021. A função é preservada para permitir rollback simples.
-- =========================================================================

DROP TRIGGER IF EXISTS diaria_linha_ponto_trg ON public."DIARIA_LINHA";

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS diaria_linha_ponto_trg ON public."DIARIA_LINHA";
-- CREATE TRIGGER diaria_linha_ponto_trg
--   BEFORE INSERT OR UPDATE OF data, solicitacao_id ON public."DIARIA_LINHA"
--   FOR EACH ROW EXECUTE FUNCTION public.diaria_linha_ponto_valida();
