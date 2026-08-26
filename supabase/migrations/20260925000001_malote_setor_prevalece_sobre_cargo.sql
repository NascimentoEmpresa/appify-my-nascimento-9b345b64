-- SIS-2026-0216 (complemento, pedido do Iury): o recorte por setor
-- (20260924000001) não estava valendo pra quem tem cargo de Controladoria/
-- Diretor/Sistemas/Presidente, porque `malote_supervisor_por_cargo` era uma
-- cláusula OR separada nas policies de leitura, ganhando de qualquer
-- configuração de setor. Achado testando com o Yuri Rosa (GERENTE
-- CONTROLADORIA, cargo bate em '%CONTROLADORIA%'): configuramos ele só pro
-- setor Operacional e ele continuou vendo despesas de todos os setores.
--
-- Cargo é 100% descritivo neste ERP (ver CLAUDE.md) — quem decide acesso é
-- Gerenciamento de Acesso. Este ajuste tira `malote_supervisor_por_cargo`
-- só das cláusulas que decidem QUEM VÊ a despesa (SELECT/USING). Continua
-- intacto em tudo que não é sobre isso: `WITH CHECK` (quem pode inserir/
-- editar rateio e parcela), as RPCs de aprovar/pagar/reenviar/justificar,
-- e o gate de quem administra a própria tabela de setores
-- (malote_setor_visivel_select/write) — nada disso muda aqui.
--
-- Efeito prático: quem não tem nenhum setor configurado continua vendo tudo
-- da empresa (malote_despesa_visivel_por_setor já retorna true nesse caso,
-- zero regressão pra quem nunca foi tocado). Só muda pra quem, como o Yuri,
-- tem um desses cargos E um setor configurado — passa a respeitar o setor.
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      empresa_id = get_user_empresa(auth.uid())
      AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id)
    )
    OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
  );

DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter as 3 policies pros CREATE POLICY de
--   20260924000001_malote_setor_visivel_usuario.sql (devolve o
--   `OR malote_supervisor_por_cargo(auth.uid())` no USING das 3).
