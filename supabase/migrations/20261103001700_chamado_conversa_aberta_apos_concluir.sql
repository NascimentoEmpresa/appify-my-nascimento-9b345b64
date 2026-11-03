-- ============================================================================
-- Chamados: a conversa com o grupo continua aberta depois de CONCLUÍDO
-- (03/11/2026, pedido do Pablo: "o chat some quando o chamado é concluído,
-- mas deve continuar ali aparecendo").
--
-- Desde a mig 20260930000260 a função recusava mensagem pública em chamado
-- concluido/reprovado/cancelado — só o registro interno da equipe passava, e
-- a tela trocava a caixa de escrita por "a conversa está fechada". Concluído
-- é justamente quando o solicitante testa a entrega e volta com dúvida; sem
-- canal, ele abria outro chamado para perguntar do anterior.
--
-- Agora só reprovado e cancelado fecham a conversa. A mensagem do
-- solicitante num concluído NÃO muda o status (só o 'aguardando_retorno'
-- volta para o time, como antes); para refazer o trabalho segue o Reabrir.
-- Mesmo corpo da 260, só a lista do bloqueio mudou.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.chamado_enviar_mensagem(p_chamado_id uuid, p_texto text, p_interno boolean DEFAULT false, p_tem_anexo boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_solicitante uuid;
  v_responsavel uuid;
  v_status      text;
  v_equipe      boolean;
  v_texto       text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_id          uuid;
BEGIN
  IF v_texto IS NULL AND NOT p_tem_anexo THEN
    RAISE EXCEPTION 'Escreva uma mensagem ou anexe um arquivo.' USING ERRCODE = '22023';
  END IF;

  SELECT c.solicitante_id, c.responsavel_id, c.status
    INTO v_solicitante, v_responsavel, v_status
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = '42704';
  END IF;

  v_equipe := (v_responsavel = v_uid) OR public.chamado_sistema_gestor();

  IF NOT (v_equipe OR v_solicitante = v_uid) THEN
    RAISE EXCEPTION 'Sem acesso à conversa deste chamado.' USING ERRCODE = '42501';
  END IF;
  IF p_interno AND NOT v_equipe THEN
    RAISE EXCEPTION 'Somente a equipe registra mensagens internas.' USING ERRCODE = '42501';
  END IF;
  -- Reprovado/cancelado ainda aceitam registro interno (a equipe documenta o que
  -- ficou), mas não conversa com o solicitante. Concluído segue aberto (mig 1700).
  IF v_status IN ('reprovado', 'cancelado') AND NOT p_interno THEN
    RAISE EXCEPTION 'Chamado encerrado — a conversa está fechada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, v_uid,
          CASE WHEN p_interno THEN 'observacao_interna' ELSE 'comentario' END,
          v_texto)
  RETURNING id INTO v_id;

  -- Quem escreveu já leu a própria mensagem.
  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, v_uid, now())
  ON CONFLICT (chamado_id, user_id)
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  -- Solicitante respondeu o "aguardando retorno" → volta pro time.
  IF v_solicitante = v_uid AND NOT v_equipe AND v_status = 'aguardando_retorno' THEN
    PERFORM set_config('app.chamado_solicitante', 'on', true);
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
    PERFORM set_config('app.chamado_solicitante', 'off', true);
  END IF;

  RETURN v_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar chamado_enviar_mensagem da mig 20260930000260
-- (bloqueio com IN ('concluido', 'reprovado', 'cancelado')).
