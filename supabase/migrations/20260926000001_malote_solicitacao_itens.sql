-- =====================================================================
-- SIS-2026-0207 — itens na solicitação de compra, e fornecedor de verdade
--                 na cotação
--
-- Primeira fatia do processo de compras. O fluxo em si JÁ EXISTE no Malote
-- (solicitação → cotação no Suprimentos → aprovação por alçada → despesa), e
-- bate com a máquina de estados do sistema legado. O que falta é o conteúdo.
--
-- PROBLEMA 1 — a solicitação não tem itens.
-- Hoje ela é um valor único mais texto (`nome`, `motivo`, `descricao`). Não há
-- quantidade, unidade nem vínculo com o catálogo. O gerente de Suprimentos
-- descreveu o que quer:
--
--   "Enquanto ele estiver abrindo a solicitação do pedido, quando chegar na
--    parte dos materiais, dos itens, já puxado o nosso próprio banco de dados,
--    os itens que nós temos cadastrados."
--
-- Sem isso o comprador cota lendo um texto corrido, e nada do que foi pedido
-- consegue seguir até o recebimento e a entrada no estoque.
--
-- PROBLEMA 2 — o fornecedor da cotação é só um nome.
-- `cot1_fornecedor` e irmãs são `text`. A tela JÁ oferece um select do cadastro
-- (CotacaoMaloteDetalhe.tsx:418), mas grava o NOME como valor e descarta o id.
-- Consequências: renomear um fornecedor transforma cotações antigas em "(não
-- cadastrado)", e não dá para puxar prazo ou condição de pagamento do cadastro
-- que o SIS-2026-0209 acabou de encher.
--
-- As colunas de texto CONTINUAM e seguem sendo preenchidas — é o que mantém
-- legível a cotação antiga, feita antes de existir cadastro. O id entra ao
-- lado, como vínculo.
--
-- Idempotente.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.malote_despesa_item CASCADE;
--   ALTER TABLE public.malote_despesa
--     DROP COLUMN IF EXISTS cot1_fornecedor_id,
--     DROP COLUMN IF EXISTS cot2_fornecedor_id,
--     DROP COLUMN IF EXISTS cot3_fornecedor_id;
-- =====================================================================

-- ── 1) Itens da solicitação ──────────────────────────────────────────
--
-- `sup_item_id` é OPCIONAL de propósito. A maior parte do que se compra está
-- no catálogo, mas nem tudo: "sei lá, surgiu um tapete lá na licitação, nunca
-- comprei um tapete". Item fora do catálogo entra pela descrição livre, e
-- `nome_item` é o que a tela mostra nos dois casos.
--
-- `nome_item` é snapshot, mesmo padrão de sup_pedido_item: o catálogo pode ser
-- renomeado depois, e a solicitação tem de continuar dizendo o que foi pedido
-- naquele dia.
CREATE TABLE IF NOT EXISTS public.malote_despesa_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id  uuid NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,

  sup_item_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  nome_item   text NOT NULL,
  tipo_item   text,

  quantidade  numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  unidade     text NOT NULL DEFAULT 'UN',
  tamanho     text,
  observacao  text,

  -- Preenchido quando o comprador fecha a cotação, para o Pedido de Compra
  -- saber o preço negociado de cada linha. Nulo enquanto não há cotação.
  valor_unitario numeric(14,2),

  ordem       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_malote_despesa_item_despesa
  ON public.malote_despesa_item(despesa_id, ordem);

COMMENT ON COLUMN public.malote_despesa_item.sup_item_id IS
  'Catálogo do Supply. Nulo quando é item fora do catálogo. SIS-2026-0207.';
COMMENT ON COLUMN public.malote_despesa_item.valor_unitario IS
  'Valor negociado por linha, preenchido na cotação vencedora.';

-- ── 2) Fornecedor da cotação como vínculo ────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS cot1_fornecedor_id uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cot2_fornecedor_id uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cot3_fornecedor_id uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.malote_despesa.cot1_fornecedor_id IS
  'Vínculo com o cadastro. A coluna de texto continua, como snapshot do nome.';

-- Casa o que já existe: cotação antiga cujo texto bate exatamente com um
-- fornecedor cadastrado ganha o vínculo. O que não casar fica com id nulo e
-- segue aparecendo pelo nome, como hoje.
UPDATE public.malote_despesa d
   SET cot1_fornecedor_id = f.id
  FROM public.fornecedor f
 WHERE d.cot1_fornecedor_id IS NULL
   AND d.cot1_fornecedor IS NOT NULL
   AND btrim(d.cot1_fornecedor) <> ''
   AND btrim(lower(d.cot1_fornecedor)) IN (btrim(lower(f.razao_social)), btrim(lower(coalesce(f.nome_fantasia, ''))));

UPDATE public.malote_despesa d
   SET cot2_fornecedor_id = f.id
  FROM public.fornecedor f
 WHERE d.cot2_fornecedor_id IS NULL
   AND d.cot2_fornecedor IS NOT NULL
   AND btrim(d.cot2_fornecedor) <> ''
   AND btrim(lower(d.cot2_fornecedor)) IN (btrim(lower(f.razao_social)), btrim(lower(coalesce(f.nome_fantasia, ''))));

UPDATE public.malote_despesa d
   SET cot3_fornecedor_id = f.id
  FROM public.fornecedor f
 WHERE d.cot3_fornecedor_id IS NULL
   AND d.cot3_fornecedor IS NOT NULL
   AND btrim(d.cot3_fornecedor) <> ''
   AND btrim(lower(d.cot3_fornecedor)) IN (btrim(lower(f.razao_social)), btrim(lower(coalesce(f.nome_fantasia, ''))));

-- ── 2b) Gravar o vínculo junto com o nome ────────────────────────────
--
-- As duas RPCs de cotação (salvar rascunho e enviar) delegam a gravação a
-- sup_malote_aplicar_cotacoes — então basta esta, e as duas passam a gravar o
-- id. Redefinida por inteiro, idêntica à 20260831000001 exceto pelas três
-- linhas `cotN_fornecedor_id`.
--
-- O id é OPCIONAL no payload: cotação de fornecedor ainda não cadastrado
-- continua valendo, gravando só o nome — é como o módulo funciona hoje e não
-- se perde nada.
CREATE OR REPLACE FUNCTION public.sup_malote_aplicar_cotacoes(_id uuid, _cot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c1 jsonb := _cot->0; c2 jsonb := _cot->1; c3 jsonb := _cot->2;
BEGIN
  UPDATE public.malote_despesa SET
    cot1_fornecedor    = nullif(btrim(c1->>'fornecedor'), ''),
    cot1_fornecedor_id = nullif(c1->>'fornecedor_id', '')::uuid,
    cot1_valor         = nullif(c1->>'valor', '')::numeric,
    cot1_prazo         = nullif(c1->>'prazo', '')::date,
    cot1_link          = nullif(btrim(c1->>'link'), ''),
    cot1_anexo_path    = nullif(btrim(c1->>'anexo_path'), ''),
    cot1_anexo_nome    = nullif(btrim(c1->>'anexo_nome'), ''),
    cot2_fornecedor    = nullif(btrim(c2->>'fornecedor'), ''),
    cot2_fornecedor_id = nullif(c2->>'fornecedor_id', '')::uuid,
    cot2_valor         = nullif(c2->>'valor', '')::numeric,
    cot2_prazo         = nullif(c2->>'prazo', '')::date,
    cot2_link          = nullif(btrim(c2->>'link'), ''),
    cot2_anexo_path    = nullif(btrim(c2->>'anexo_path'), ''),
    cot2_anexo_nome    = nullif(btrim(c2->>'anexo_nome'), ''),
    cot3_fornecedor    = nullif(btrim(c3->>'fornecedor'), ''),
    cot3_fornecedor_id = nullif(c3->>'fornecedor_id', '')::uuid,
    cot3_valor         = nullif(c3->>'valor', '')::numeric,
    cot3_prazo         = nullif(c3->>'prazo', '')::date,
    cot3_link          = nullif(btrim(c3->>'link'), ''),
    cot3_anexo_path    = nullif(btrim(c3->>'anexo_path'), ''),
    cot3_anexo_nome    = nullif(btrim(c3->>'anexo_nome'), ''),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.sup_malote_aplicar_cotacoes(uuid, jsonb) FROM PUBLIC, anon;

-- ── 3) RLS ───────────────────────────────────────────────────────────
--
-- Espelha malote_rateio_linha_all (20260924000001): a tabela filha não decide
-- nada por conta própria, herda quem enxerga a despesa. Repetir a expressão em
-- vez de confiar na RLS do pai é o padrão do módulo — política não aplica RLS
-- da tabela consultada de forma óbvia, e o time preferiu deixar explícito.
--
-- ⚠️ UMA DIFERENÇA DELIBERADA em relação ao rateio: aqui entra também
-- `sup_cotacoes_malote`. O comprador precisa ENXERGAR OS ITENS para cotar —
-- sem esse ramo ele abriria a solicitação e veria a lista vazia, que é
-- exatamente o problema que este chamado veio resolver.
ALTER TABLE public.malote_despesa_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
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

-- Escrita é do solicitante: os itens fazem parte do que ele pede, e a mesma
-- regra do Rateio vale aqui — "só o Solicitante edita".
DROP POLICY IF EXISTS malote_despesa_item_write ON public.malote_despesa_item;
CREATE POLICY malote_despesa_item_write ON public.malote_despesa_item
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

-- ── 4) Valor negociado por item ──────────────────────────────────────
--
-- Chamada pelo Suprimentos ao fechar a cotação, para o Pedido de Compra ter o
-- preço de cada linha e não só o total. Passa por RPC porque quem cota não é o
-- criador da solicitação, e a policy de escrita acima (de propósito) não o
-- deixaria gravar direto.
CREATE OR REPLACE FUNCTION public.malote_item_valor(p_item_id uuid, p_valor numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para precificar itens da solicitação';
  END IF;

  UPDATE public.malote_despesa_item
     SET valor_unitario = p_valor
   WHERE id = p_item_id;
END $$;

REVOKE ALL ON FUNCTION public.malote_item_valor(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_item_valor(uuid, numeric) TO authenticated;

-- ── Conferência ──────────────────────────────────────────────────────
-- Quantas cotações antigas ganharam vínculo com o cadastro de fornecedor.
SELECT count(*) FILTER (WHERE cot1_fornecedor_id IS NOT NULL) AS cot1_vinculadas,
       count(*) FILTER (WHERE cot2_fornecedor_id IS NOT NULL) AS cot2_vinculadas,
       count(*) FILTER (WHERE cot3_fornecedor_id IS NOT NULL) AS cot3_vinculadas
  FROM public.malote_despesa;

NOTIFY pgrst, 'reload schema';
