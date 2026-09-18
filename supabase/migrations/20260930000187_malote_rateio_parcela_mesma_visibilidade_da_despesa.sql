-- [SEM-CHAMADO] (achado real, SIS-2026-0464: DM-2026-0924 mostrava Empresa
-- mas não Contrato em Aprovações, mesmo com o rateio certinho no banco).
--
-- Causa raiz: a RLS de malote_despesa (malote_despesa_select, migration
-- 20260930000075) já tem várias "portas de entrada" além do
-- created_by/setor — a mais relevante aqui é
-- `can_access(auth.uid(), 'malote_pagamento', 'aprovar')`, que libera ver
-- QUALQUER despesa pra quem aprova pagamento, sem exigir bater o setor
-- (malote_despesa_visivel_por_setor). As RLS de malote_despesa_rateio_linha
-- e malote_despesa_parcela nunca ganharam essas mesmas portas — só têm
-- created_by/admin/setor/lancador. Resultado: quem enxerga a despesa via
-- essas portas extras (aprovador de pagamento, comprador em cotação,
-- gerente financeiro de exceção) via a despesa (Empresa/Classificação
-- resolvidos do cabeçalho dela), mas NÃO via as linhas do rateio — onde
-- mora o Contrato/Fornecedor de verdade quando não está no nível da
-- despesa. Mesmo buraco nas duas tabelas, mesmo fix.
--
-- Só o USING (leitura) ganha as portas novas — o WITH CHECK (escrita) fica
-- como está, edição continua restrita a quem já podia editar.
--
-- ROLLBACK: reaplicar o USING de 20260930000089 (sem as 3 cláusulas novas)
-- pras duas policies abaixo.

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
           OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND public.malote_despesa_em_fase_cotacao(d.status))
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
           OR (can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AND public.malote_despesa_em_fase_cotacao(d.status))
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

NOTIFY pgrst, 'reload schema';
