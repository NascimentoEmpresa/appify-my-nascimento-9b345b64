-- SIS-2026-0170 (ajuste após feedback visual): a criação de tipo inline
-- espremida ao lado do Select ficou feia — vira um modal de gerenciamento
-- (criar/excluir/ativar/desativar), então o catálogo precisa de um status.

ALTER TABLE public.malote_tipo_forma_pagamento
  ADD COLUMN ativo boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_tipo_forma_pagamento DROP COLUMN IF EXISTS ativo;
-- =====================================================================
