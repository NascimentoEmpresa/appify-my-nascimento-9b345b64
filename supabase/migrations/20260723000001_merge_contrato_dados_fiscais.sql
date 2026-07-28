-- Consolidação de tabelas (pedido do Eduardo: minimizar tabelas novas).
-- contrato_dados_fiscais era 1:1 com contratos (contrato_id UNIQUE) — não
-- havia motivo real pra ser uma tabela à parte. Vira colunas direto em
-- public.contratos, eliminando a tabela e suas próprias RLS policies.

ALTER TABLE public.contratos
  ADD COLUMN IF NOT EXISTS issqn_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ir_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cofins_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pis_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS csll_pct numeric(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prazo_pagamento text,
  ADD COLUMN IF NOT EXISTS codigo_servico_lc116 text,
  ADD COLUMN IF NOT EXISTS codigo_servico_municipal_cnae text,
  ADD COLUMN IF NOT EXISTS conta_pagamento text,
  ADD COLUMN IF NOT EXISTS email_envio_nf text,
  ADD COLUMN IF NOT EXISTS instrucoes_envio text;

UPDATE public.contratos c SET
  issqn_pct = f.issqn_pct,
  ir_pct = f.ir_pct,
  cofins_pct = f.cofins_pct,
  pis_pct = f.pis_pct,
  csll_pct = f.csll_pct,
  prazo_pagamento = f.prazo_pagamento,
  codigo_servico_lc116 = f.codigo_servico_lc116,
  codigo_servico_municipal_cnae = f.codigo_servico_municipal_cnae,
  conta_pagamento = f.conta_pagamento,
  email_envio_nf = f.email_envio_nf,
  instrucoes_envio = f.instrucoes_envio
FROM public.contrato_dados_fiscais f
WHERE f.contrato_id = c.id;

DROP TABLE public.contrato_dados_fiscais;
