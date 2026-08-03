-- Lote 8g, bloco 3: as 3 tabelas do motor de aprovação de Suprimentos que
-- ainda restavam com has_role (as irmãs sup_aprov_fluxo/sup_aprov_etapa já
-- foram migradas antes, em 20260730000001_fix_menu_codigo_colisoes.sql, pro
-- menu 'suprimentos_aprovacoes' — reaproveita o mesmo aqui, pra manter a
-- família inteira consistente) + a função sup_aprov_registrar_voto.
--
-- ROLLBACK: recriar com has_role(auth.uid(),'admin'::app_role) (ver
-- 20260520033145_...sql).

DROP POLICY IF EXISTS "regua_admin_write" ON public.sup_aprov_regua_escalonamento;
CREATE POLICY "regua_admin_write" ON public.sup_aprov_regua_escalonamento FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'suprimentos_aprovacoes', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'suprimentos_aprovacoes', 'alterar'));

DROP POLICY IF EXISTS "regua_deg_admin_write" ON public.sup_aprov_regua_degrau;
CREATE POLICY "regua_deg_admin_write" ON public.sup_aprov_regua_degrau FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'suprimentos_aprovacoes', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'suprimentos_aprovacoes', 'alterar'));

DROP POLICY IF EXISTS "alerta_read_admin" ON public.sup_aprov_alerta_log;
CREATE POLICY "alerta_read_admin" ON public.sup_aprov_alerta_log FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'suprimentos_aprovacoes', 'visualizar'));

CREATE OR REPLACE FUNCTION public.sup_aprov_registrar_voto(
  _instancia_id uuid, _etapa_id uuid, _parecer public.sup_aprov_parecer, _justificativa text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _resp uuid; _tipo public.sup_aprov_tipo_parecer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tipo_parecer, public.sup_aprov_responsavel_efetivo(id) INTO _tipo, _resp
    FROM public.sup_aprov_etapa WHERE id = _etapa_id AND ativo;
  IF _resp IS NULL THEN RAISE EXCEPTION 'Etapa não encontrada'; END IF;
  IF _resp <> _uid AND NOT public.can_access(_uid, 'suprimentos_aprovacoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta etapa';
  END IF;
  IF _parecer = 'reprovado' AND (_justificativa IS NULL OR length(trim(_justificativa)) = 0) THEN
    RAISE EXCEPTION 'Justificativa obrigatória para reprovar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sup_aprov_voto WHERE instancia_id=_instancia_id AND etapa_id=_etapa_id AND usuario_id=_uid) THEN
    RAISE EXCEPTION 'Voto já registrado';
  END IF;
  INSERT INTO public.sup_aprov_voto(instancia_id, etapa_id, usuario_id, parecer, justificativa)
  VALUES (_instancia_id, _etapa_id, _uid, _parecer, _justificativa);
  IF _tipo = 'bloqueante' THEN
    IF _parecer = 'reprovado' THEN
      UPDATE public.sup_aprov_instancia SET status='reprovado', etapa_atual_id=NULL, fechada_em=now() WHERE id=_instancia_id;
    ELSE
      PERFORM public.sup_aprov_avancar(_instancia_id);
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
