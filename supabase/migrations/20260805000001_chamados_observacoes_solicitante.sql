-- =====================================================================
-- CHAMADOS DE SISTEMAS — campo "Observações do solicitante" na abertura.
-- Texto livre e opcional, separado da descrição detalhada (contexto extra,
-- expectativa de resultado etc.). Preenchido só na abertura pelo solicitante;
-- exibido nas telas de detalhe. Não entra no guard de UPDATE (campo novo,
-- editável só na criação via RLS de INSERT).
-- =====================================================================
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS observacoes_solicitante text;

NOTIFY pgrst, 'reload schema';
