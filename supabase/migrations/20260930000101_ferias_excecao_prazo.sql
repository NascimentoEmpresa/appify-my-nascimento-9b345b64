-- =========================================================================
-- RH — Férias: exceção de prazo (saída com menos de 30 dias)
--
-- Até 14/09/2026 a tela barrava a solicitação com saída a menos de 30 dias
-- da data de hoje. Agora ela deixa passar, mas avisa que está FORA DO PRAZO
-- e que pode ser recusada; quem confirma ("Solicitar mesmo assim") manda a
-- solicitação marcada como exceção, pra quem aprova ver de cara.
--
--  excecao — true quando a saída foi pedida com menos de 30 dias de
--            antecedência e o solicitante confirmou mesmo assim.
--
-- Idempotente.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" ADD COLUMN IF NOT EXISTS excecao boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP COLUMN IF EXISTS excecao;
-- NOTIFY pgrst, 'reload schema';
