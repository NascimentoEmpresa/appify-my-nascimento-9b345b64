-- Ciencia da Operacao: recusa definitiva da SEFAZ nao pode travar a fila
--
-- INCIDENTE 01/09/2026. O worker voltou a rodar depois de um dia parado e a
-- fila de Ciencia da Operacao nao andou um documento sequer. Todo ciclo, de
-- 60 em 60 segundos, a mesma nota:
--
--   Ciencia recusada: 35260838325797000170550020001068541559754211
--   650 Rejeicao: Evento de Ciencia da Operacao para NFe cancelada ou denegada
--
-- Duas coisas se somaram em `worker/src/nfeCiencia.js`:
--
--  1. A recusa nao era gravada em lugar nenhum. `ciencia_em` continuava NULL,
--     entao a proxima passada pegava a mesma nota de novo.
--  2. Qualquer recusa abortava o lote inteiro (`return`), e a fila e ordenada
--     por NSU crescente. A nota recusada era a mais antiga.
--
-- Resultado: 1 nota cancelada bloqueou as outras 17 para sempre, e cada ciclo
-- gastava uma escrita inutil na SEFAZ. Como so o `procNFe` (a nota com itens)
-- chega DEPOIS da manifestacao, a aba automatica do /nf-entrada ficou parada
-- em resumo: fornecedor e valor, sem produto nenhum.
--
-- O `return` em si esta certo para erro sistemico -- assinatura invalida, CNPJ
-- errado, certificado vencido -- em que insistir nas seguintes vira consumo
-- indevido. O que faltava era separar disso a recusa que vale para UMA nota e
-- e definitiva: 650 nao melhora com o tempo. Nota cancelada nao tem mercadoria
-- para receber, e a SEFAZ nunca vai aceitar ciencia sobre ela.
--
-- Dai estas colunas: um lugar para dizer "esta nao vai ser manifestada, e o
-- motivo e este". Diferente de `ciencia_em`, que significa manifestada com
-- sucesso -- marcar uma coisa na outra apagaria a diferenca entre nota
-- resolvida e nota descartada.

ALTER TABLE public.nfe_dist_documento
  ADD COLUMN IF NOT EXISTS ciencia_dispensada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS ciencia_dispensa_motivo text;

COMMENT ON COLUMN public.nfe_dist_documento.ciencia_dispensada_em IS
  'Preenchido quando a SEFAZ recusou a ciencia em definitivo para esta nota (ex. cStat 650, nota cancelada ou denegada). Nao confundir com ciencia_em, que e manifestacao bem-sucedida.';

COMMENT ON COLUMN public.nfe_dist_documento.ciencia_dispensa_motivo IS
  'cStat e xMotivo devolvidos pela SEFAZ na recusa definitiva, guardados como vieram para auditoria.';

-- O indice parcial que alimenta a fila precisa ignorar as dispensadas, senao
-- elas continuam sendo varridas a cada ciclo.
DROP INDEX IF EXISTS public.idx_nfe_dist_doc_pendente_ciencia;
CREATE INDEX IF NOT EXISTS idx_nfe_dist_doc_pendente_ciencia
  ON public.nfe_dist_documento(cnpj)
  WHERE tipo = 'resumo' AND ciencia_em IS NULL AND ciencia_dispensada_em IS NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP INDEX IF EXISTS public.idx_nfe_dist_doc_pendente_ciencia;
--   CREATE INDEX IF NOT EXISTS idx_nfe_dist_doc_pendente_ciencia
--     ON public.nfe_dist_documento(cnpj)
--     WHERE tipo = 'resumo' AND ciencia_em IS NULL;
--   ALTER TABLE public.nfe_dist_documento
--     DROP COLUMN IF EXISTS ciencia_dispensa_motivo,
--     DROP COLUMN IF EXISTS ciencia_dispensada_em;
--   NOTIFY pgrst, 'reload schema';
