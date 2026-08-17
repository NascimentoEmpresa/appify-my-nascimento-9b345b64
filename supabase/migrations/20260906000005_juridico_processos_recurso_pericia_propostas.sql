-- =========================================================================
-- JURIDICO / PROCESSOS — recurso, pericia medica e propostas
--
-- Tres pedidos do juridico (17/08/2026):
--   1) Condenacao: a empresa vai recorrer? Se sim, custas recursais,
--      seguro garantia e deposito recursal.
--   2) Houve pericia MEDICA? Se sim, valor do perito judicial e do
--      assistente tecnico/medico.
--   3) Propostas (judicial/extrajudicial) na 1a e na 2a audiencia e no
--      decorrer do processo, dizendo de quem partiu: reclamante,
--      reclamada ou juiz.
--
-- ATENCAO AO MODELO — a JUR_PROCESSOS tem UMA LINHA POR MOTIVO, e os
-- campos do processo ficam repetidos em todas elas. Quem le agrupa: os
-- valores por motivo sao SOMADOS, os do processo sao lidos de uma linha
-- so. As colunas criadas aqui sao TODAS do processo, entao NAO podem
-- entrar na soma por motivo — se entrassem, um processo com 3 motivos
-- mostraria as custas recursais triplicadas. Ver `agrupar()` no
-- Processos.tsx, onde elas sao lidas com maxN/first, nunca com sum.
--
-- `valor_seguro_garantia` e `valor_deposito_recursal` JA EXISTIAM:
--   - seguro garantia estava criada e sem uso nenhum na tela;
--   - deposito recursal continua sendo preenchido POR MOTIVO (decisao do
--     Pablo, 17/08/2026); a aba de recurso so mostra a soma, em leitura.
-- Por isso nenhuma das duas e recriada aqui.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."JUR_PROCESSOS"
--     DROP COLUMN IF EXISTS vai_recorrer,
--     DROP COLUMN IF EXISTS valor_custas_recursais,
--     DROP COLUMN IF EXISTS houve_pericia_medica,
--     DROP COLUMN IF EXISTS valor_perito_judicial,
--     DROP COLUMN IF EXISTS valor_assistente_tecnico,
--     DROP COLUMN IF EXISTS propostas_json;
-- =========================================================================

ALTER TABLE public."JUR_PROCESSOS"
  -- 1) Recurso
  ADD COLUMN IF NOT EXISTS vai_recorrer             text,
  ADD COLUMN IF NOT EXISTS valor_custas_recursais   numeric,
  -- 2) Pericia medica
  ADD COLUMN IF NOT EXISTS houve_pericia_medica     text,
  ADD COLUMN IF NOT EXISTS valor_perito_judicial    numeric,
  ADD COLUMN IF NOT EXISTS valor_assistente_tecnico numeric,
  -- 3) Propostas fora de audiencia ("no decorrer do processo").
  --    As propostas DE audiencia continuam dentro de audiencias_json.
  --    text, e nao jsonb, para acompanhar o audiencias_json que ja existe
  --    — os dois sao serializados/lidos do mesmo jeito na tela.
  ADD COLUMN IF NOT EXISTS propostas_json           text;

COMMENT ON COLUMN public."JUR_PROCESSOS".vai_recorrer IS
  'Sim/Nao — a empresa vai recorrer da condenacao. Campo do PROCESSO (repetido nas linhas de motivo).';
COMMENT ON COLUMN public."JUR_PROCESSOS".houve_pericia_medica IS
  'Sim/Nao — houve pericia medica. Campo do PROCESSO (repetido nas linhas de motivo).';
COMMENT ON COLUMN public."JUR_PROCESSOS".propostas_json IS
  'Propostas fora de audiencia: [{data,tipo,quem,valor,descricao}]. As de audiencia ficam em audiencias_json.';

NOTIFY pgrst, 'reload schema';
