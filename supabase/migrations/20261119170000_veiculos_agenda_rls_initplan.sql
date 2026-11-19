-- =========================================================================
-- AGENDAMENTO DE VEÍCULOS — RLS COM A CHECAGEM DE ACESSO UMA VEZ SÓ (18/11/2026)
--
-- PROBLEMA (Pablo, com print da Daiane Martins, Central de Serviços ›
-- Agendamento de Veículos): "na tela dela não tá aparecendo nada". No console
-- dela: GET /rest/v1/cs_veiculo_agendamento?select=*,contratos:... → 500,
-- "canceling statement due to statement timeout"; e o checklist também
-- ("[checklist veículo] não carregou").
--
-- CAUSA: as policies chamavam tem_acesso_menu()/can_access()/auth.uid() SOLTOS
-- no USING — o Postgres reavalia a função em CADA linha. A tela lê a agenda
-- inteira (~190 reservas) com os contratos embutidos, e a policy dos contratos
-- faz EXISTS na reserva, que roda a policy da reserva de novo. Para quem não é
-- administrador a checagem de acesso é cara (exceções, perfis, bloqueio de
-- login por situação) → estoura o statement timeout. Com a tela vazia, a
-- Daiane não viu a reserva nº 249 (JEEP COMPAS, 18/11) que tinha feito.
--
-- CORREÇÃO: as MESMAS regras, com cada chamada dentro de (SELECT ...) — o
-- Postgres calcula uma vez por consulta (initPlan), o padrão M1 do guardião
-- de desempenho. Ninguém ganha nem perde acesso.
--
-- Definições de origem: 20260828000007 (select/insert), 20260828000003
-- (update/delete/contrato_write), 20260828000001 (contrato_select/log_select),
-- 20261105009300 (checklist_select). Idempotente.
-- =========================================================================

DROP POLICY IF EXISTS cs_veic_agend_select ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_select ON public.cs_veiculo_agendamento FOR SELECT TO authenticated
  USING ((SELECT public.tem_acesso_menu('central_servicos_veiculos')));

DROP POLICY IF EXISTS cs_veic_agend_insert ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_insert ON public.cs_veiculo_agendamento FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.tem_acesso_menu('central_servicos_veiculos', 'incluir'))
    AND solicitante_id = (SELECT auth.uid())   -- ninguém reserva em nome de outro
    AND status = 'confirmado'
  );

DROP POLICY IF EXISTS cs_veic_agend_update ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_update ON public.cs_veiculo_agendamento FOR UPDATE TO authenticated
  USING (
    (solicitante_id = (SELECT auth.uid())
     OR (SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'visualizar')))
    AND (SELECT public.tem_acesso_menu('central_servicos_veiculos'))
  )
  WITH CHECK (
    (solicitante_id = (SELECT auth.uid())
     OR (SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'visualizar')))
    AND (SELECT public.tem_acesso_menu('central_servicos_veiculos'))
  );

DROP POLICY IF EXISTS cs_veic_agend_delete ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_delete ON public.cs_veiculo_agendamento FOR DELETE TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'excluir')));

-- Os contratos herdam a visibilidade da reserva (o EXISTS passa pela RLS dela).
DROP POLICY IF EXISTS cs_veic_contrato_select ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_select ON public.cs_veiculo_agendamento_contrato FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a WHERE a.id = agendamento_id));

DROP POLICY IF EXISTS cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = (SELECT auth.uid())
            OR (SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'visualizar')))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = (SELECT auth.uid())
            OR (SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'visualizar')))
  ));

DROP POLICY IF EXISTS cs_veic_log_select ON public.cs_veiculo_agendamento_log;
CREATE POLICY cs_veic_log_select ON public.cs_veiculo_agendamento_log FOR SELECT TO authenticated
  USING ((SELECT public.tem_acesso_menu('central_servicos_veiculos')));

DROP POLICY IF EXISTS cs_veic_checklist_select ON public."CS_VEICULO_CHECKLIST";
CREATE POLICY cs_veic_checklist_select ON public."CS_VEICULO_CHECKLIST" FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cs_veiculo_agendamento a
                  WHERE a.id = agendamento_id
                    AND (a.solicitante_id = (SELECT auth.uid())
                         OR (SELECT public.can_access((SELECT auth.uid()), 'sup_patrimonio', 'visualizar'::public.app_acao)))));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar as policies das migrations 20260828000001, 20260828000003,
-- 20260828000007 e 20261105009300 (mesmas regras, chamadas sem SELECT).
-- NOTIFY pgrst, 'reload schema';
