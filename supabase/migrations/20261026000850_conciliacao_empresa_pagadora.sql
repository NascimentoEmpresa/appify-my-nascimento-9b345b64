-- [SEM-CHAMADO] Conciliação: "quem pagou" a despesa rateada entre empresas.
--
-- Uma despesa rateada entre empresas (ex.: boleto de R$ 821,60 = 742,60 da HAGG + 79,00 da NH) sai de UMA conta só; no extrato cai o valor
-- total. O Fluxo só guarda a empresa de cada fatia (a do contrato), então a conciliação da outra empresa (NH) mostrava a fatia dela como
-- "Consta no Fluxo, não caiu no extrato". Esta tabela diz de qual empresa saiu o pagamento: na conciliação, a despesa inteira passa a
-- pertencer à empresa pagadora (o total no extrato dela, nada nas demais). Vale só para a conciliação: o Fluxo de Caixa, o Orçamento e o
-- rateio continuam exatamente como estão.
--
-- Sem registro = comportamento de sempre (cada fatia na empresa do contrato).

CREATE TABLE IF NOT EXISTS public.financeiro_conciliacao_empresa_pagadora (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem               text NOT NULL,
  despesa_id           uuid NOT NULL,
  -- null = vale para a despesa inteira (todas as parcelas); preenchido = só aquela parcela.
  numero_parcela       int,
  empresa_pagadora_id  uuid NOT NULL REFERENCES public.empresas(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Sem FK para auth.users: quem aplica a migration no cluster nem sempre tem REFERENCES nessa tabela ("permission denied for table users").
  updated_by           uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_empresa_pagadora_uniq_com_parcela
  ON public.financeiro_conciliacao_empresa_pagadora (origem, despesa_id, numero_parcela)
  WHERE numero_parcela IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conciliacao_empresa_pagadora_uniq_sem_parcela
  ON public.financeiro_conciliacao_empresa_pagadora (origem, despesa_id)
  WHERE numero_parcela IS NULL;

DROP TRIGGER IF EXISTS conciliacao_empresa_pagadora_set_updated ON public.financeiro_conciliacao_empresa_pagadora;
CREATE TRIGGER conciliacao_empresa_pagadora_set_updated
  BEFORE UPDATE ON public.financeiro_conciliacao_empresa_pagadora
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financeiro_conciliacao_empresa_pagadora ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacao_empresa_pagadora_select ON public.financeiro_conciliacao_empresa_pagadora;
CREATE POLICY conciliacao_empresa_pagadora_select ON public.financeiro_conciliacao_empresa_pagadora
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS conciliacao_empresa_pagadora_write ON public.financeiro_conciliacao_empresa_pagadora;
CREATE POLICY conciliacao_empresa_pagadora_write ON public.financeiro_conciliacao_empresa_pagadora
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'alterar'));

-- No cluster tabela nova não herda privilégio: sem o GRANT o Postgres nega antes de avaliar a RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financeiro_conciliacao_empresa_pagadora TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.financeiro_conciliacao_empresa_pagadora;
--   NOTIFY pgrst, 'reload schema';
