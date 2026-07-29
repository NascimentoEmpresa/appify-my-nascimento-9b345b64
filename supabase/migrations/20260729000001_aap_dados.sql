ALTER TABLE sistema_solicitacao
  ADD COLUMN IF NOT EXISTS aap_dados JSONB;
