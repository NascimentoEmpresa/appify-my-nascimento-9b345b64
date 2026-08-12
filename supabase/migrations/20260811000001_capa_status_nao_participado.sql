-- SIS-2026-0117: adiciona valor "Não Participado" ao enum capa_status
-- Já aplicado em produção via SQL Editor; migration aqui para rastreabilidade.
ALTER TYPE capa_status ADD VALUE IF NOT EXISTS 'Não Participado';
