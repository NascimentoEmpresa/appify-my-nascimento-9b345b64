-- SIS-2026-0340 (errata da 20260930000074): faltava a policy de SELECT.
--
-- Achado real, confirmado com um dry-run em BEGIN;...ROLLBACK; simulando o
-- lançador via SET LOCAL ROLE authenticated + request.jwt.claims (não deu
-- pra testar via browser nesta sessão, sem credenciais de um usuário de
-- teste — este foi o caminho equivalente): o UPDATE de malote_despesa_update
-- (20260930000074) sozinho NÃO bastava. Postgres RLS exige, pra qualquer
-- UPDATE, que a linha também passe pela policy de SELECT da tabela — tanto
-- a linha ANTIGA (senão o UPDATE nem "acha" a linha pra atualizar) quanto a
-- linha NOVA (senão dá "new row violates row-level security policy", mesmo
-- com WITH CHECK do UPDATE retornando true). Confirmado isolando o
-- comportamento numa tabela descartável antes de aplicar aqui.
--
-- Sem esta migration, um usuário configurado só como "Lançador da despesa"
-- (sem nenhuma outra permissão) não conseguia:
--   1. Nem SELECT a solicitação (useDespesa, usado por CriarDespesa.tsx) —
--      então a tela de conversão nunca carregava os dados pra começo.
--   2. Nem o 1º UPDATE de useConverterSolicitacaoEmDespesa (achava a linha
--      pela regra nova de malote_despesa_update, mas a policy de SELECT
--      ainda não deixava "ver" nem a linha antiga nem a nova).
--   3. Nem o 2º UPDATE (que seta nivel_aprovacao_atual=1) — a linha NOVA
--      resultante (já com status='pendente_aprovacao') não passava mais
--      pela condição de visibilidade testada (nivel_aprovacao_atual IS NULL),
--      então o WITH CHECK falhava mesmo com a condição própria dele OK.
--
-- Diferente da policy de UPDATE (que seguiu estreita, fechando sozinha
-- depois da conversão via nivel_aprovacao_atual IS NULL), a de SELECT aqui é
-- deliberadamente mais larga — sem essa condição — porque o Postgres exige
-- que a linha RESULTANTE do 2º update (já com nivel_aprovacao_atual=1)
-- também seja visível pra quem fez o update, ou a transação inteira falha.
-- Isso é só LEITURA (nunca escrita) e escopado à mesma Classificação onde a
-- pessoa está configurada como lançadora — mesmo padrão de "quem tem uma
-- capacidade específica vê mais amplo" que a policy já usa hoje pra
-- sup_cotacoes_malote/malote_pagamento.
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    (created_by = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
    OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND malote_despesa_em_fase_cotacao(status))
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
    OR (excecao AND (status = 'pendente_aprovacao'::text) AND malote_gerente_financeiro(auth.uid()))
    OR (
      origem = 'solicitacao'
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = malote_despesa.classificacao_id
          AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
-- CREATE POLICY malote_despesa_select ON public.malote_despesa
--   FOR SELECT TO authenticated
--   USING (
--     (created_by = auth.uid())
--     OR has_role(auth.uid(), 'admin'::app_role)
--     OR (user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
--     OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND malote_despesa_em_fase_cotacao(status))
--     OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
--     OR (excecao AND (status = 'pendente_aprovacao'::text) AND malote_gerente_financeiro(auth.uid()))
--   );
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
