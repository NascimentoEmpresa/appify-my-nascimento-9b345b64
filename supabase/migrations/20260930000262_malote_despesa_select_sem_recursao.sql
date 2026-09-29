-- [SEM-CHAMADO] (achado real, 29/09/2026 — Aprovações do Malote, Meus
-- Itens e Pagamento Malote vazios pra TODO mundo, tiles todos em 0):
-- a policy malote_despesa_select ganhou (aplicada direto no banco, sem
-- migration no git) um ramo pra despesa de rateio com
--   EXISTS (SELECT 1 FROM malote_despesa_rateio_linha rl WHERE rl.despesa_id = malote_despesa.id ...)
-- Só que a RLS de malote_despesa_rateio_linha (malote_rateio_linha_all)
-- faz EXISTS em malote_despesa de volta → despesa → linha → despesa → ...
-- e o Postgres recusa a consulta inteira com "42P17: infinite recursion
-- detected in policy for relation malote_despesa". A tela engole o erro e
-- mostra "Nenhum item encontrado".
--
-- Correção: a mesma regra (despesa de rateio visível se ALGUMA linha tem
-- classificação do setor liberado pro usuário) passa a morar numa função
-- SECURITY DEFINER — ela lê malote_despesa_rateio_linha sem passar pela
-- RLS da linha, então o ciclo some. Mesmo padrão já usado em
-- malote_despesa_visivel_por_setor. Regra de visibilidade idêntica.
--
-- ROLLBACK (volta ao estado quebrado — só se for pra trocar a solução):
--   DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
--   (recriar com o EXISTS direto em malote_despesa_rateio_linha)
--   DROP FUNCTION IF EXISTS public.malote_despesa_visivel_por_rateio(uuid, uuid);
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.malote_despesa_visivel_por_rateio(_user_id uuid, _despesa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.malote_despesa_rateio_linha rl
     WHERE rl.despesa_id = _despesa_id
       AND public.malote_despesa_visivel_por_setor(_user_id, rl.classificacao_id)
  );
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_visivel_por_rateio(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_despesa_visivel_por_rateio(uuid, uuid) TO authenticated;

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
    OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND malote_despesa_em_fase_cotacao(status))
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

NOTIFY pgrst, 'reload schema';
