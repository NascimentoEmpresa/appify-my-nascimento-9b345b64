-- =====================================================================
-- SIS-2026-0398 — múltiplos links identificados na solicitação de compra
--
-- Hoje a solicitação tem só um campo de texto pra Link(s), sem nenhuma
-- identificação de qual link é de qual fornecedor/item quando há mais de
-- um (kits, itens de fornecedores diferentes na mesma solicitação).
--
-- Mesmo padrão já usado pros Itens da solicitação (SIS-2026-0207,
-- malote_despesa_item, 20260926000001): tabela filha + RLS espelhando quem
-- já enxerga a despesa pai. A coluna antiga malote_despesa.links (texto)
-- NÃO é removida nem migrada — solicitações antigas continuam mostrando o
-- texto corrido como hoje; só as novas passam a usar esta tabela.
--
-- Idempotente.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.malote_despesa_link CASCADE;
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.malote_despesa_link (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id uuid NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,

  -- Texto livre (ex.: "Fornecedor X - Kit A") — na solicitação o fornecedor
  -- muitas vezes ainda não foi escolhido/cotado (isso é decidido depois, na
  -- cotação do Suprimentos), então não vincula ao cadastro de Fornecedor.
  rotulo     text,
  url        text NOT NULL,

  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_malote_despesa_link_despesa
  ON public.malote_despesa_link(despesa_id, ordem);

-- Espelha malote_despesa_item_select/write (20260926000001): a tabela filha
-- não decide nada por conta própria, herda quem enxerga/edita a despesa pai.
ALTER TABLE public.malote_despesa_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS malote_despesa_link_select ON public.malote_despesa_link;
CREATE POLICY malote_despesa_link_select ON public.malote_despesa_link
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.malote_despesa d
     WHERE d.id = despesa_id AND (
       d.created_by = auth.uid()
       OR has_role(auth.uid(), 'admin')
       OR public.malote_supervisor_por_cargo(auth.uid())
       OR (d.empresa_id = get_user_empresa(auth.uid())
           AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
       OR public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
       OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
     )
  ));

-- Escrita é do solicitante: os links fazem parte do que ele pede, mesma
-- regra do Rateio/Itens ("só o Solicitante edita").
DROP POLICY IF EXISTS malote_despesa_link_write ON public.malote_despesa_link;
CREATE POLICY malote_despesa_link_write ON public.malote_despesa_link
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.malote_despesa d
     WHERE d.id = despesa_id AND (
       d.created_by = auth.uid()
       OR has_role(auth.uid(), 'admin')
       OR public.malote_supervisor_por_cargo(auth.uid())
     )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.malote_despesa d
     WHERE d.id = despesa_id AND (
       d.created_by = auth.uid()
       OR has_role(auth.uid(), 'admin')
       OR public.malote_supervisor_por_cargo(auth.uid())
     )
  ));

NOTIFY pgrst, 'reload schema';
