-- =========================================================================
-- Módulo CONCORD (03/11/2026) — 5/5: RPCs (o "socket" do Concord)
--
--   concord_conectar()                       — abre uma conexão (uma por aba)
--   concord_call(conexao, evento, dados)     — socket.emit(evento, dados, ack)
--   concord_poll(conexao, desde)             — eventos novos desta aba
--   concord_desconectar(conexao)             — aba fechando (sai da call na hora)
--   concord_integracao(ext, acao, dados)     — só service_role (Edge Function
--                                              concord-integracoes: Steam/Twitch)
--
-- O poll é barato de propósito: um DELETE do que a aba já leu, um SELECT pelo
-- índice (conexao, id) e, no máximo a cada 10 s, o sinal de vida e a faxina
-- de conexões mortas. O cliente pergunta a cada ~1 s em call, ~2 s com a aba
-- à vista e ~6 s com ela escondida.
--
-- Gate: can_access(…, 'concord', 'visualizar') ao conectar e a cada sinal
-- de vida — perder o acesso derruba a aba em até 10 s.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.concord_conectar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ext uuid := auth.uid(); v_uid text; v_first boolean; v_cx uuid;
BEGIN
  IF v_ext IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF NOT public.can_access(v_ext, 'concord', 'visualizar'::app_acao) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem_acesso');
  END IF;
  PERFORM concord.sincronizar_usuarios();
  v_uid := concord.vincular(v_ext);
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  v_first := NOT concord.online(v_uid);
  INSERT INTO concord.conexoes (user_id, ext_id, last_seen, created_at)
  VALUES (v_uid, v_ext, concord.agora(), concord.agora()) RETURNING id INTO v_cx;
  UPDATE concord.users SET last_seen = concord.agora() WHERE id = v_uid;
  IF v_first THEN PERFORM concord.broadcast_user(v_uid); END IF;
  RETURN jsonb_build_object('ok', true, 'conexao', v_cx, 'user_id', v_uid);
END $$;

-- Eventos que mexem na estrutura passam por uma fila única, como o
-- exclusive() do Otamashis: duas escritas intercaladas não se atropelam.
CREATE OR REPLACE FUNCTION public.concord_call(p_conexao uuid, p_evento text, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid text; v_nome text; r jsonb;
  fila CONSTANT text[] := ARRAY[
    'user:update', 'friend:request', 'friend:accept', 'friend:remove', 'friend:block', 'friend:unblock',
    'server:create', 'server:update', 'server:delete', 'server:transfer', 'server:leave',
    'invite:create', 'invite:accept', 'invite:delete', 'join:decide',
    'member:update', 'member:kick', 'member:ban', 'ban:remove',
    'role:create', 'role:update', 'role:delete', 'role:reorder',
    'channel:create', 'channel:update', 'channel:delete', 'channel:reorder', 'overwrite:set',
    'contact:send', 'game:invite', 'game:respond',
    'dm:open', 'dm:close', 'group:create', 'group:add', 'group:remove', 'group:update'];
BEGIN
  SELECT c.user_id INTO v_uid FROM concord.conexoes c WHERE c.id = p_conexao AND c.ext_id = auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Sem conexão.', 'reconnect', true); END IF;
  IF p_evento IS NULL OR p_evento !~ '^[a-z]+(:[a-z_-]+)?$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Evento desconhecido.');
  END IF;
  v_nome := 'ev_' || translate(p_evento, ':-', '__');
  IF to_regprocedure(format('concord.%I(text,uuid,jsonb)', v_nome)) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Evento desconhecido.');
  END IF;
  IF p_evento = ANY (fila) THEN PERFORM pg_advisory_xact_lock(hashtext('concord.estrutura')); END IF;
  BEGIN
    EXECUTE format('SELECT concord.%I($1, $2, $3)', v_nome) INTO r
      USING v_uid, p_conexao, CASE WHEN jsonb_typeof(p_dados) = 'object' THEN p_dados ELSE '{}'::jsonb END;
  EXCEPTION
    WHEN SQLSTATE 'CC001' THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
    WHEN OTHERS THEN
      RAISE WARNING '[concord] % falhou: % (%)', p_evento, SQLERRM, SQLSTATE;
      RETURN jsonb_build_object('ok', false, 'error', 'Erro interno no servidor.');
  END;
  RETURN jsonb_build_object('ok', true) || CASE WHEN jsonb_typeof(r) = 'object' THEN r ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION public.concord_poll(p_conexao uuid, p_desde bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c concord.conexoes; v_agora bigint := concord.agora(); v_eventos jsonb;
BEGIN
  SELECT * INTO c FROM concord.conexoes WHERE id = p_conexao;
  IF NOT FOUND OR c.ext_id IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('reset', true); END IF;

  -- Aba que ficou muda mais de 45 s (computador dormiu): para os outros ela
  -- já saiu. Fecha esta e o cliente reconecta, como no reconnect do socket.
  IF c.last_seen < v_agora - 45000 THEN
    IF EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = c.user_id AND conexao = c.id) THEN
      PERFORM concord.leave_voice(c.user_id, NULL);
    END IF;
    DELETE FROM concord.conexoes WHERE id = c.id;
    RETURN jsonb_build_object('reset', true);
  END IF;

  IF p_desde > 0 THEN DELETE FROM concord.eventos WHERE conexao = c.id AND id <= p_desde; END IF;

  IF v_agora - c.last_seen > 10000 THEN
    IF NOT public.can_access(c.ext_id, 'concord', 'visualizar'::app_acao) THEN
      PERFORM concord.leave_voice(c.user_id, NULL);
      DELETE FROM concord.conexoes WHERE id = c.id;
      RETURN jsonb_build_object('reset', true, 'sem_acesso', true);
    END IF;
    UPDATE concord.conexoes SET last_seen = v_agora WHERE id = c.id;
    PERFORM concord.varrer();
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_array(e.id, e.ev, e.data) ORDER BY e.id), '[]'::jsonb) INTO v_eventos
    FROM (SELECT id, ev, data FROM concord.eventos WHERE conexao = c.id AND id > coalesce(p_desde, 0) ORDER BY id LIMIT 500) e;
  RETURN jsonb_build_object('eventos', v_eventos);
END $$;

CREATE OR REPLACE FUNCTION public.concord_desconectar(p_conexao uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c concord.conexoes;
BEGIN
  SELECT * INTO c FROM concord.conexoes WHERE id = p_conexao AND ext_id = auth.uid();
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = c.user_id AND conexao = c.id) THEN
    PERFORM concord.leave_voice(c.user_id, NULL);
  END IF;
  DELETE FROM concord.conexoes WHERE id = c.id;
  IF NOT concord.online(c.user_id) THEN
    UPDATE concord.users SET last_seen = concord.agora() WHERE id = c.user_id;
    PERFORM concord.broadcast_user(c.user_id);
    PERFORM concord.set_activity(c.user_id, NULL);
  END IF;
END $$;

-- Ponte da Edge Function concord-integracoes (Steam/Twitch). Ela valida o JWT
-- de quem chamou e passa o auth.uid() em p_ext; nas rotas de retorno do
-- OAuth (sem JWT) quem identifica a pessoa é o state, de uso único e 10 min.
CREATE OR REPLACE FUNCTION public.concord_integracao(p_ext uuid, p_acao text, p_dados jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid text; v_state text; s concord.link_states; v jsonb; a jsonb;
BEGIN
  IF p_ext IS NOT NULL THEN
    IF NOT public.can_access(p_ext, 'concord', 'visualizar'::app_acao) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Sem acesso ao Concord.');
    END IF;
    SELECT id INTO v_uid FROM concord.users WHERE ext_id = p_ext;
    IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Abra o Concord primeiro.'); END IF;
  END IF;

  CASE p_acao
    WHEN 'state_criar' THEN
      v_state := md5(gen_random_uuid()::text || clock_timestamp()::text);
      INSERT INTO concord.link_states (state, user_id, kind, created_at) VALUES (v_state, v_uid, p_dados ->> 'kind', concord.agora());
      RETURN jsonb_build_object('ok', true, 'state', v_state);

    WHEN 'state_usar' THEN
      DELETE FROM concord.link_states WHERE state = p_dados ->> 'state' RETURNING * INTO s;
      IF NOT FOUND OR s.kind IS DISTINCT FROM p_dados ->> 'kind' OR s.created_at < concord.agora() - 600000 THEN
        RETURN jsonb_build_object('ok', false);
      END IF;
      RETURN jsonb_build_object('ok', true, 'user_id', s.user_id);

    WHEN 'salvar' THEN
      -- { user_id (de state_usar) ou p_ext, kind: steam|twitch, conta: {...} }
      v_uid := coalesce(v_uid, p_dados ->> 'user_id');
      IF v_uid IS NULL OR p_dados ->> 'kind' NOT IN ('steam', 'twitch') THEN RETURN jsonb_build_object('ok', false); END IF;
      PERFORM concord.save_extras(v_uid, jsonb_build_object(p_dados ->> 'kind', p_dados -> 'conta'));
      IF p_dados ->> 'kind' = 'steam' AND jsonb_typeof(p_dados -> 'conta' -> 'playing') = 'object' THEN
        PERFORM concord.set_activity(v_uid, jsonb_build_object('type', 'playing', 'name', p_dados -> 'conta' -> 'playing' ->> 'name',
          'image', p_dados -> 'conta' -> 'playing' -> 'image', 'source', 'steam'));
      END IF;
      RETURN jsonb_build_object('ok', true);

    WHEN 'contas' THEN
      SELECT extras INTO v FROM concord.users WHERE id = v_uid;
      RETURN jsonb_build_object('ok', true, 'steam', v -> 'steam', 'twitch', v -> 'twitch');

    WHEN 'atividade' THEN
      -- { source: steam|twitch, activity: {...} | null } — só troca/limpa a da mesma origem
      SELECT activity INTO a FROM concord.users WHERE id = v_uid;
      IF jsonb_typeof(p_dados -> 'activity') = 'object' THEN
        PERFORM concord.set_activity(v_uid, (p_dados -> 'activity') || jsonb_build_object('source', p_dados ->> 'source'));
      ELSIF a ->> 'source' = p_dados ->> 'source' THEN
        PERFORM concord.set_activity(v_uid, NULL);
      END IF;
      RETURN jsonb_build_object('ok', true);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Ação desconhecida.');
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.concord_conectar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concord_call(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concord_poll(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concord_desconectar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.concord_integracao(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concord_conectar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.concord_call(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concord_poll(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concord_desconectar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.concord_integracao(uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.concord_integracao(uuid, text, jsonb);
-- DROP FUNCTION IF EXISTS public.concord_desconectar(uuid);
-- DROP FUNCTION IF EXISTS public.concord_poll(uuid, bigint);
-- DROP FUNCTION IF EXISTS public.concord_call(uuid, text, jsonb);
-- DROP FUNCTION IF EXISTS public.concord_conectar();
-- NOTIFY pgrst, 'reload schema';
