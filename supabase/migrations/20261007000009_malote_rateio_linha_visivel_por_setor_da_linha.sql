-- ============================================================================
-- Malote — aprovador com recorte de setor não via as linhas do rateio
-- ============================================================================
-- Sintoma (Cassio, N1 de Suprimentos, DM-2026-2186 e DM-2026-2192): despesa
-- rateada não aparece nas pendências dele em Aprovações, apesar de todas as
-- classificações do rateio serem de Suprimentos e dele ser o aprovador N1.
--
-- Causa: a tela só o reconhece como aprovador de uma despesa rateada
-- (souAprovadorDoNivelComRateio) lendo malote_despesa_rateio_linha, direto, sujeita
-- à RLS dela. A política malote_rateio_linha_all decide a visibilidade olhando
-- d.classificacao_id, o campo do CABEÇALHO da despesa — que em rateio é sempre
-- NULL. Para quem tem recorte de setor, malote_despesa_visivel_por_setor(uid, NULL)
-- é falso, e nenhuma das outras portas se aplica a ele: as linhas voltam vazias,
-- ele não é reconhecido como aprovador e a despesa some das pendências dele. O
-- cabeçalho ele já enxerga (malote_despesa_select, mig. 262, via
-- malote_despesa_visivel_por_rateio) — só as linhas é que faltavam.
--
-- Correção: nova porta de LEITURA (USING) — despesa rateada (classificacao_id nulo)
-- de empresa que o usuário pode ver, com a classificação DA PRÓPRIA LINHA liberada
-- pelo recorte de setor dele. Quem tem recorte passa a ler as linhas do SEU setor,
-- não as dos outros setores da mesma despesa. Sem recursão: só chama
-- malote_despesa_visivel_por_setor (SECURITY DEFINER, não lê malote_despesa nem a
-- tabela de linhas). O WITH CHECK (escrita) fica idêntico.
--
-- Base: a política vigente de 20260930000281 (que trocou a regra de cotação para
-- malote_despesa_escopo_cotacao). Substitui o rascunho antigo
-- 20260930000271_malote_rateio_linha_visivel_por_setor.sql, que parte de uma versão
-- anterior da política e desfaria a 281 se aplicado — NÃO aplicar aquele.
--
-- Requer: public.malote_despesa_escopo_cotacao (criada na 281).
--
-- ROLLBACK: reaplicar a política malote_rateio_linha_all de
-- 20260930000281_malote_escopo_cotacao_exige_origem_solicitacao.sql.

SET lock_timeout = '5s';

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
           OR (
             d.classificacao_id IS NULL
             AND public.user_pode_ver_empresa(auth.uid(), d.empresa_id)
             AND malote_despesa_visivel_por_setor(auth.uid(), malote_despesa_rateio_linha.classificacao_id)
           )
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

NOTIFY pgrst, 'reload schema';
