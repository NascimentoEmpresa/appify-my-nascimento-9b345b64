-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — quem manda na frota é o Patrimônio
--
-- A 20260828000001 criou um menu próprio (`central_servicos_veiculos_gestor`)
-- para dizer quem pode mexer na reserva dos outros. Era um segundo lugar
-- respondendo a mesma pergunta que Suprimentos › Patrimônio já responde — e
-- dois lugares para a mesma permissão sempre acabam discordando.
--
-- Agora o gate é o próprio menu do painel de Patrimônio: quem administra a
-- frota lá é quem cancela reserva alheia aqui. O menu extra é removido.
--
-- Continua valendo que NADA em sup_patrimonio é escrito por este módulo —
-- aqui só se LÊ a permissão dele, via can_access().
--
-- ROLLBACK: reaplicar as policies da 20260828000001 e reinserir o menu.
-- =====================================================================

-- ── 1. Policies passam a consultar o Patrimônio ──────────────────────
DROP POLICY IF EXISTS cs_veic_agend_update ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_update ON public.cs_veiculo_agendamento
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid()
     OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  )
  WITH CHECK (
    (solicitante_id = auth.uid()
     OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  );

DROP POLICY IF EXISTS cs_veic_agend_delete ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_delete ON public.cs_veiculo_agendamento
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'excluir'));

DROP POLICY IF EXISTS cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid()
            OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid()
            OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
  ));

-- ── 2. Fora o menu que sobrou ────────────────────────────────────────
DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_veiculos_gestor';
DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'central_servicos_veiculos_gestor';
DELETE FROM public.app_menu                WHERE codigo      = 'central_servicos_veiculos_gestor';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT codigo, nome, rota FROM public.app_menu WHERE codigo LIKE 'central_servicos_veiculos%';

NOTIFY pgrst, 'reload schema';
