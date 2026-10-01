-- [SEM-CHAMADO] (achado real, relatado pelo Eduardo em 01/10/2026):
-- "despesas criadas no Malote com classificação que NÃO precisa de cotação,
-- quando são canceladas, aparecem todas em /app/suprimentos/cotacao-malote".
--
-- ── Causa raiz ───────────────────────────────────────────────────────────
-- `malote_despesa` guarda os DOIS fluxos na mesma tabela, e quem separa um
-- do outro é `origem`:
--   'solicitacao'                   → nasceu pedindo cotação de Suprimentos
--   'despesa_unica' / 'despesa_multi_classificacao'
--                                   → despesa lançada direto, nunca passou
--                                     por Suprimentos
--
-- A migration 20260930000068 fechou o buraco anterior (quem tinha
-- sup_cotacoes_malote:visualizar via despesa de QUALQUER status, inclusive
-- paga e de outro setor) exigindo que o status estivesse na fase de cotação
-- — malote_despesa_em_fase_cotacao(status). Melhorou muito, mas o critério
-- de status é insuficiente, porque 'cancelada' é o ÚNICO status que os dois
-- fluxos compartilham:
--
--   despesa lançada direto → pendente_aprovacao / necessidade_de_ajuste /
--     aguardando_pagamento / pronto_para_pagar / despesa_paga …
--     nenhum deles em_fase_cotacao → invisível pra Suprimentos, correto
--   … até alguém cancelar: useCancelarDespesa grava status='cancelada',
--     que em_fase_cotacao aceita → a despesa passa a ser legível (e
--     listável) por Suprimentos de uma hora pra outra.
--
-- Daí o sintoma ser *só* com canceladas, e com TODAS elas.
--
-- ── Por que `origem` e não `requer_solicitacao` da Classificação ─────────
-- Tentador gatear pelo check "Requer solicitação"
-- (planejamento_orcamentario_classificacao.requer_solicitacao, editável em
-- /app/malote/classificacao-malote), mas ele é a regra de HOJE, não o que
-- aconteceu com a linha:
--   1. desmarcar o check reescreveria o passado — despesas antigas que de
--      fato passaram por cotação sairiam da vista de Suprimentos, junto com
--      o histórico das 3 cotações que estão gravadas nelas;
--   2. existe o bypass do SIS-2026-0334 ("Não necessita solicitação" em
--      Criar Despesa / Ratear Classificação): numa classificação que exige
--      solicitação, a linha nasce origem='despesa_unica' e NÃO é assunto de
--      Suprimentos — gatear pela Classificação traria ela de volta.
-- `origem` é imutável no sentido que importa aqui: a conversão de
-- solicitação aprovada em despesa (useConverterSolicitacaoEmDespesa /
-- malote_finalizar_conversao_solicitacao) escreve na MESMA linha e mantém
-- 'solicitacao'. Então solicitação cancelada continua aparecendo pra
-- Suprimentos, como deve (a tela tem card "Cotação Cancelada").
--
-- ── deleted_at ───────────────────────────────────────────────────────────
-- Entra no mesmo pacote: item mandado pra lixeira do Fluxo de Caixa
-- (malote_despesa_excluir, 20260930000163) não é item vivo e não tem o que
-- fazer na fila de cotação. Só esta porta (a de Suprimentos) passa a exigir
-- isso — as outras ficam como estão, senão a própria tela da lixeira, que
-- lê justamente deleted_at IS NOT NULL, pararia de achar os itens.
--
-- Função nova em vez de mexer na antiga porque a assinatura muda (precisa
-- de origem e deleted_at, não só status) e o nome antigo
-- ("em_fase_cotacao") descreve exatamente o critério insuficiente. A antiga
-- é derrubada no fim, depois que as 4 policies deixam de referenciá-la.

CREATE OR REPLACE FUNCTION public.malote_despesa_escopo_cotacao(
  _status text,
  _origem text,
  _deleted_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _origem = 'solicitacao'
     AND _deleted_at IS NULL
     AND _status = ANY (ARRAY[
           'aguardando_cotacao',
           'cotacao_realizada',
           'cotacao_aprovada',
           'solicitacao_reprovada',
           'cancelada'
         ]);
$$;

COMMENT ON FUNCTION public.malote_despesa_escopo_cotacao(text, text, timestamptz) IS
  'Linha de malote_despesa que é assunto de Suprimentos (fila de Cotações do Malote). Substitui malote_despesa_em_fase_cotacao(text), que olhava só o status e por isso deixava TODA despesa cancelada do Malote cair na fila — ''cancelada'' é o único status comum aos dois fluxos.';

-- ── 1. malote_despesa ────────────────────────────────────────────────────
-- Base: 20260930000262 (versão vigente, a que tirou a recursão do ramo de
-- rateio). Muda SÓ o ramo de sup_cotacoes_malote.
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    (created_by = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
    OR (
      classificacao_id IS NULL
      AND user_pode_ver_empresa(auth.uid(), empresa_id)
      AND malote_despesa_visivel_por_rateio(auth.uid(), id)
    )
    OR (
      can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
      AND public.malote_despesa_escopo_cotacao(status, origem, deleted_at)
    )
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
    OR (excecao AND status = 'pendente_aprovacao'::text AND malote_gerente_financeiro(auth.uid()))
    OR (
      origem = 'solicitacao'::text
      AND EXISTS (
        SELECT 1 FROM planejamento_orcamentario_classificacao c
         WHERE c.id = malote_despesa.classificacao_id
           AND auth.uid() = ANY (c.lancador_despesa_user_ids)
      )
    )
  );

-- ── 2. malote_despesa_item ───────────────────────────────────────────────
-- Base: 20260930000068 (versão vigente).
DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_item.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR malote_supervisor_por_cargo(auth.uid())
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (
             can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
             AND public.malote_despesa_escopo_cotacao(d.status, d.origem, d.deleted_at)
           )
           OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
         )
    )
  );

-- ── 3. malote_despesa_rateio_linha ───────────────────────────────────────
-- Base: 20260930000187 (versão vigente). Só o USING muda; o WITH CHECK
-- (escrita) é reaplicado idêntico.
DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
           OR (
             can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
             AND public.malote_despesa_escopo_cotacao(d.status, d.origem, d.deleted_at)
           )
           OR (d.excecao AND d.status = 'pendente_aprovacao'::text AND public.malote_gerente_financeiro(auth.uid()))
           OR (
             d.origem = 'solicitacao' AND (d.nivel_aprovacao_atual IS NULL OR d.status = 'necessidade_de_ajuste')
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           has_role(auth.uid(), 'admin'::app_role)
           OR (
             (d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
             AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text]))
           )
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

-- ── 4. malote_despesa_parcela ────────────────────────────────────────────
-- Base: 20260930000187 (versão vigente). Mesma troca, mesmo WITH CHECK.
DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
           OR (
             can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
             AND public.malote_despesa_escopo_cotacao(d.status, d.origem, d.deleted_at)
           )
           OR (d.excecao AND d.status = 'pendente_aprovacao'::text AND public.malote_gerente_financeiro(auth.uid()))
           OR (
             d.origem = 'solicitacao' AND (d.nivel_aprovacao_atual IS NULL OR d.status = 'necessidade_de_ajuste')
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

-- ── Derruba a função antiga ──────────────────────────────────────────────
-- As 4 policies acima eram as únicas que a referenciavam (conferido no
-- git: 20260930000068, 0075, 0187, 0262). Se o DROP falhar, é porque EXISTE
-- um 5º objeto no banco real dependendo dela — e esse objeto é outro buraco
-- igual a este, ainda aberto. Por isso o DROP não aborta a migration: o
-- fix acima vale de qualquer jeito, e a dependência aparece como WARNING
-- com o nome do objeto pra ser tratada depois.
DO $$
BEGIN
  BEGIN
    DROP FUNCTION IF EXISTS public.malote_despesa_em_fase_cotacao(text);
    RAISE NOTICE 'malote_despesa_em_fase_cotacao(text) removida — nada mais dependia dela.';
  EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE WARNING 'malote_despesa_em_fase_cotacao(text) NAO removida: ainda tem objeto dependendo dela (%). Esse objeto tem o mesmo buraco corrigido aqui — conferir.', SQLERRM;
  END;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   -- volta o critério só-status (reabre o vazamento das canceladas):
--   CREATE OR REPLACE FUNCTION public.malote_despesa_em_fase_cotacao(_status text)
--   RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
--     SELECT _status = ANY (ARRAY['aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada', 'solicitacao_reprovada', 'cancelada']);
--   $fn$;
--   -- reaplicar as 4 policies trocando
--   --   malote_despesa_escopo_cotacao(status, origem, deleted_at)
--   -- por
--   --   malote_despesa_em_fase_cotacao(status)
--   -- (malote_despesa_select ← 20260930000262; malote_despesa_item_select ←
--   --  20260930000068; malote_rateio_linha_all e malote_parcela_all ←
--   --  20260930000187)
--   DROP FUNCTION IF EXISTS public.malote_despesa_escopo_cotacao(text, text, timestamptz);
--   NOTIFY pgrst, 'reload schema';
