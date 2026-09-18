-- =====================================================================
-- Hora Extra — ajuste do ponto durante a liberação.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.hora_extra_liberar_com_horarios(p_id uuid, p_horarios jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_entrada time; v_saida_intervalo time; v_retorno_intervalo time; v_saida time;
  v_jornada integer; v_trabalhado integer; v_total integer; v_inicio time;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN RAISE EXCEPTION 'Você não tem permissão para aprovar.'; END IF;
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'alterar') THEN RAISE EXCEPTION 'Você não tem permissão para alterar os horários da solicitação.'; END IF;
  SELECT * INTO v_s FROM public."HORA_EXTRA_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF v_s.id IS NULL OR v_s.status <> 'aguardando_liberacao' THEN RAISE EXCEPTION 'A solicitação não aguarda liberação.'; END IF;
  IF p_horarios IS NULL OR jsonb_typeof(p_horarios) <> 'object' THEN RAISE EXCEPTION 'Informe os quatro horários do ponto.'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ((p_horarios->>'entrada')), ((p_horarios->>'saida_intervalo')), ((p_horarios->>'retorno_intervalo')), ((p_horarios->>'saida'))) AS horarios(valor) WHERE nullif(btrim(valor), '') IS NULL) THEN RAISE EXCEPTION 'Informe os quatro horários do ponto.'; END IF;
  v_entrada := (p_horarios->>'entrada')::time; v_saida_intervalo := (p_horarios->>'saida_intervalo')::time; v_retorno_intervalo := (p_horarios->>'retorno_intervalo')::time; v_saida := (p_horarios->>'saida')::time;
  v_jornada := coalesce(v_s.jornada_minutos, (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1));
  IF coalesce(v_jornada, 0) <= 0 THEN RAISE EXCEPTION 'A solicitação não possui uma jornada de trabalho válida.'; END IF;
  v_trabalhado := public.hora_extra_minutos_trabalhados(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida);
  v_total := public.hora_extra_excedente(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  v_inicio := public.hora_extra_inicio(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Os horários informados somam %, dentro da jornada de %. Não há hora extra a liberar.', public.hora_extra_formatar_minutos(v_trabalhado), public.hora_extra_formatar_minutos(v_jornada); END IF;
  UPDATE public."HORA_EXTRA_SOLICITACAO" SET ponto_entrada = v_entrada, ponto_saida_intervalo = v_saida_intervalo, ponto_retorno_intervalo = v_retorno_intervalo, ponto_saida = v_saida, trabalhado_previsto_min = v_trabalhado, he_inicio_previsto = v_inicio, he_fim_previsto = v_saida, total_previsto_min = v_total, status = 'aprovada', liberado_por = v_uid, liberado_em = now(), motivo_reprovacao = NULL WHERE id = p_id;
  INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta) VALUES
    (p_id, v_uid, 'editada', 'Horários do ponto ajustados durante a análise da solicitação', jsonb_build_object('antes', jsonb_build_object('entrada', v_s.ponto_entrada, 'saida_intervalo', v_s.ponto_saida_intervalo, 'retorno_intervalo', v_s.ponto_retorno_intervalo, 'saida', v_s.ponto_saida, 'total_previsto_min', v_s.total_previsto_min), 'depois', jsonb_build_object('entrada', v_entrada, 'saida_intervalo', v_saida_intervalo, 'retorno_intervalo', v_retorno_intervalo, 'saida', v_saida, 'total_previsto_min', v_total))),
    (p_id, v_uid, 'liberada', 'Solicitação liberada com os horários ajustados', jsonb_build_object('horarios_ajustados', true));
END;
$fn$;
REVOKE ALL ON FUNCTION public.hora_extra_liberar_com_horarios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_liberar_com_horarios(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
