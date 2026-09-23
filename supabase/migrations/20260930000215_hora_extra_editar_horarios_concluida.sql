-- =====================================================================
-- HORA EXTRA — corrigir o horário de ponto de uma HE já CONCLUÍDA.
--
-- O fluxo tinha uma porta só de ida: aguardando_liberacao aceita ajuste
-- (hora_extra_liberar_com_horarios, mig 186) e aguardando_validacao também
-- (hora_extra_validar_com_horarios, mig 193) — mas depois que a validação
-- fecha a solicitação em 'concluida', o ponto vira pedra. Cartão de ponto
-- que chega atrasado, batida esquecida e correção do RH não tinham por onde
-- entrar, e o total_real_min ficava divergente do que foi efetivamente pago.
--
-- Esta RPC é a terceira porta, e a mais estreita das três:
--   * exige a ação 'editar_concluida' (mig 214), que NÃO vem no pacote do
--     toggle da tela — tem switch próprio no Gerenciamento de Acesso;
--   * só aceita status = 'concluida' (as outras duas etapas já têm a sua);
--   * NÃO reabre a solicitação: o status continua 'concluida'. Corrigir a
--     hora não é devolver a HE para a fila de validação.
--
-- Recalcula trabalhado/excedente/início pelas MESMAS funções das outras
-- RPCs, então a regra de jornada da escala (inclusive jornada zero no fim de
-- semana, mig 196) continua valendo — não há segunda fórmula aqui.
--
-- O antes/depois inteiro vai para HORA_EXTRA_EVENTO como 'editada'. É o
-- único rastro de que a hora paga mudou depois de fechada; não remova.
--
-- ⚠ Aplique DEPOIS da 20260930000214, em execução separada (valor de enum
-- novo não pode ser usado na transação que o criou).
-- =====================================================================

-- 1) A ação aparece no Gerenciamento de Acesso ------------------------
-- Sem esta linha o switch não existe na tela de Acesso por Usuário e não há
-- como conceder a permissão a ninguém.
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sistemas_hora_extra', 'editar_concluida'::public.app_acao)
ON CONFLICT DO NOTHING;

-- Administrador Geral (concede_tudo) já passaria por has_screen_access sem
-- esta linha; ela existe para a caixinha aparecer marcada na tela, igual ao
-- que a mig 162 fez com as outras ações de Hora Extra.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sistemas_hora_extra', 'editar_concluida'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) A RPC -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_editar_horarios_concluida(p_id uuid, p_horarios jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_entrada time; v_saida_intervalo time; v_retorno_intervalo time; v_saida time;
  v_jornada integer; v_trabalhado integer; v_total integer; v_inicio time;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'editar_concluida') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar os horários de uma HE já concluída.';
  END IF;

  SELECT * INTO v_s FROM public."HORA_EXTRA_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'Solicitação de HE não encontrada.'; END IF;
  IF v_s.status <> 'concluida' THEN
    RAISE EXCEPTION 'Esta correção é só para HE já concluída; a solicitação está como "%".', v_s.status;
  END IF;
  IF p_horarios IS NULL OR jsonb_typeof(p_horarios) <> 'object' THEN
    RAISE EXCEPTION 'Informe os horários efetivos do ponto.';
  END IF;

  -- No dia sem pausa os dois registros do meio repetem a entrada, o mesmo
  -- contrato de quatro horários que hora_extra_salvar grava (mig 196). A
  -- normalização fica aqui e não só no navegador: assim um POST direto no
  -- PostgREST não consegue inventar um intervalo em HE marcada sem pausa.
  v_entrada := nullif(btrim(p_horarios->>'entrada'), '')::time;
  v_saida := nullif(btrim(p_horarios->>'saida'), '')::time;
  IF coalesce(v_s.sem_intervalo, false) THEN
    v_saida_intervalo := v_entrada;
    v_retorno_intervalo := v_entrada;
  ELSE
    v_saida_intervalo := nullif(btrim(p_horarios->>'saida_intervalo'), '')::time;
    v_retorno_intervalo := nullif(btrim(p_horarios->>'retorno_intervalo'), '')::time;
  END IF;
  IF v_entrada IS NULL OR v_saida IS NULL OR v_saida_intervalo IS NULL OR v_retorno_intervalo IS NULL THEN
    RAISE EXCEPTION 'Informe os quatro horários efetivos do ponto.';
  END IF;

  v_jornada := CASE WHEN coalesce(v_s.seguir_escala, true)
    THEN coalesce(v_s.jornada_minutos, (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1))
    ELSE 0 END;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'A solicitação não possui uma jornada de trabalho válida.'; END IF;

  v_trabalhado := public.hora_extra_minutos_trabalhados(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida);
  v_total := public.hora_extra_excedente(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  v_inicio := public.hora_extra_inicio(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Os horários informados somam %, dentro da jornada de %. A HE ficaria zerada — devolva a solicitação em vez de corrigir.',
      public.hora_extra_formatar_minutos(v_trabalhado), public.hora_extra_formatar_minutos(v_jornada);
  END IF;

  -- Status intocado: continua 'concluida'.
  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET ponto_entrada_real = v_entrada,
      ponto_saida_intervalo_real = v_saida_intervalo,
      ponto_retorno_intervalo_real = v_retorno_intervalo,
      ponto_saida_real = v_saida,
      trabalhado_real_min = v_trabalhado,
      he_inicio_real = v_inicio,
      he_fim_real = v_saida,
      total_real_min = v_total
  WHERE id = p_id;

  INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta)
  VALUES (
    p_id, v_uid, 'editada',
    'Horários efetivos do ponto corrigidos após a conclusão',
    jsonb_build_object(
      'apos_conclusao', true,
      'antes', jsonb_build_object(
        'entrada', v_s.ponto_entrada_real, 'saida_intervalo', v_s.ponto_saida_intervalo_real,
        'retorno_intervalo', v_s.ponto_retorno_intervalo_real, 'saida', v_s.ponto_saida_real,
        'trabalhado_real_min', v_s.trabalhado_real_min, 'total_real_min', v_s.total_real_min),
      'depois', jsonb_build_object(
        'entrada', v_entrada, 'saida_intervalo', v_saida_intervalo,
        'retorno_intervalo', v_retorno_intervalo, 'saida', v_saida,
        'trabalhado_real_min', v_trabalhado, 'total_real_min', v_total))
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_editar_horarios_concluida(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_editar_horarios_concluida(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.hora_extra_editar_horarios_concluida(uuid, jsonb);
-- DELETE FROM public.screen_permission_user
--  WHERE menu_codigo = 'sistemas_hora_extra' AND acao = 'editar_concluida';
-- DELETE FROM public.perfil_acesso_permissao
--  WHERE menu_codigo = 'sistemas_hora_extra' AND acao = 'editar_concluida';
-- DELETE FROM public.app_menu_acao
--  WHERE menu_codigo = 'sistemas_hora_extra' AND acao = 'editar_concluida';
-- NOTIFY pgrst, 'reload schema';
