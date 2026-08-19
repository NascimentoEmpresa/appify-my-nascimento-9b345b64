-- SIS-2026-0170 (ajuste após feedback do Iury): "Tipo" de Formas de
-- Pagamento deixa de ser um CHECK fixo de 5 valores e vira um catálogo
-- editável — mesmo padrão já usado em malote_tipo_bloqueio
-- (20260827000002_malote_config.sql), incluindo o fluxo de "criar novo
-- tipo" inline na tela.
--
-- malote_forma_pagamento ainda estava vazia (confirmado antes de rodar
-- isto), então dá pra trocar o CHECK por FK sem migração de dado.

CREATE TABLE public.malote_tipo_forma_pagamento (
  nome text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

INSERT INTO public.malote_tipo_forma_pagamento (nome) VALUES
  ('Transferência Bancária'), ('PIX'), ('Boleto'), ('Cartão'), ('Dinheiro')
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE public.malote_tipo_forma_pagamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_tipo_forma_pagamento_select ON public.malote_tipo_forma_pagamento FOR SELECT TO authenticated
  USING (true);

CREATE POLICY malote_tipo_forma_pagamento_write ON public.malote_tipo_forma_pagamento FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

ALTER TABLE public.malote_forma_pagamento
  DROP CONSTRAINT IF EXISTS malote_forma_pagamento_tipo_check,
  ADD CONSTRAINT malote_forma_pagamento_tipo_fkey FOREIGN KEY (tipo)
    REFERENCES public.malote_tipo_forma_pagamento(nome) ON UPDATE CASCADE;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_forma_pagamento DROP CONSTRAINT IF EXISTS malote_forma_pagamento_tipo_fkey;
--   DROP TABLE IF EXISTS public.malote_tipo_forma_pagamento;
-- =====================================================================
