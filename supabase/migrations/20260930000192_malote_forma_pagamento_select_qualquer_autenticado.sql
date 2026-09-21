-- SIS-2026-0439 (fix urgente): a tela de Criar Despesa trocou de
-- malote_tipo_forma_pagamento (catálogo genérico, leitura liberada pra
-- todo autenticado — USING (true) em 20260909000003) para
-- malote_forma_pagamento (catálogo nomeado, necessário pro Fluxo Especial)
-- sem ajustar a RLS dessa segunda tabela — ela nasceu em
-- 20260909000001_malote_analistas_formas_pagamento.sql restrita a
-- admin/controladoria/diretor_adm, porque na época só era lida na tela de
-- Configurações (admin). Com a troca, qualquer usuário fora desses 3
-- papéis passou a ver a lista de "Forma de pagamento" vazia ao lançar
-- despesa (achado real: Juliana).
--
-- Fix: SELECT liberado pra qualquer autenticado (mesmo padrão já usado em
-- malote_tipo_forma_pagamento) — escrita continua restrita.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS malote_forma_pagamento_select ON public.malote_forma_pagamento;
--   CREATE POLICY malote_forma_pagamento_select ON public.malote_forma_pagamento FOR SELECT TO authenticated
--     USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));
--   NOTIFY pgrst, 'reload schema';

DROP POLICY IF EXISTS malote_forma_pagamento_select ON public.malote_forma_pagamento;
CREATE POLICY malote_forma_pagamento_select ON public.malote_forma_pagamento FOR SELECT TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
