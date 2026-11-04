-- =========================================================================
-- FÉRIAS — data do malote e retorno da documentação (04/11/2026)
--
-- Pablo, com o print das colunas MALOTE e RETORNO DA DOCUMENTAÇÃO da planilha
-- de férias: "essas duas informações são importantes, a data que foi enviado
-- pro malote e o retorno da documentação. Precisa ter dois campos novos."
--
--   data_malote           date  — dia em que a documentação foi para o malote
--   retorno_documentacao  text  — como/quando voltou assinada ("RETORNOU
--                                 ZAPSIGN - 02/10/2026", "ENTREGUE FÍSICO",
--                                 "CANCELADA"...). Texto livre de propósito: a
--                                 planilha mistura canal, data e situação.
--
-- O RH preenche na Gestão de Férias (src/pages/rh/Ferias.tsx). O histórico
-- das planilhas foi preenchido pela carga de 04/11/2026 (ver mig
-- 20261104002000). Nenhuma regra nem gatilho olha estas colunas.
-- Idempotente.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS data_malote date,
  ADD COLUMN IF NOT EXISTS retorno_documentacao text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".data_malote IS 'Data em que a documentação das férias foi enviada para o malote (RH).';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_FERIAS".retorno_documentacao IS 'Retorno da documentação assinada: canal e data (ex.: RETORNOU ZAPSIGN - 02/10/2026).';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP COLUMN IF EXISTS data_malote, DROP COLUMN IF EXISTS retorno_documentacao;
-- NOTIFY pgrst, 'reload schema';
