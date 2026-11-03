-- =========================================================================
-- Módulo CONCORD (03/11/2026) — 6: versão corporativa
--
-- PEDIDO (Pablo): "não é app pra conversar sobre jogo nem encontros… é
-- empresarial e profissional". O Concord deixa de ter o que o Otamashis tinha
-- de rede social:
--   · sai o cadastro de perfil (cidade, jogos, interesses, redes sociais,
--     "aparecer nas sugestões") e as sugestões de amizade por gosto;
--   · sai o convite de jogo, a presença "Jogando/Assistindo", Steam e Twitch;
--   · o perfil mostra o que vem do ERP: cargo e setor (EMPREGADOS, como no
--     Organograma) e o e-mail corporativo;
--   · "amigos" viram CONTATOS, e conversa em grupo aceita qualquer colega
--     (antes só amigos) — numa empresa ninguém precisa ser "amigo" para falar.
--
-- Por que migration nova, e não editar as 003000-003040: essas já subiram na
-- branch pablo. Se fossem alteradas, o aplicador as veria como já registradas
-- e a mudança nunca chegaria ao banco.
--
-- Idempotente. ROLLBACK: reaplicar 20261103003010, 003030 e 003040 (recriam o
-- que foi removido aqui).
-- =========================================================================

-- ── 1. Fora: sugestões, jogos, presença, Steam/Twitch, cadastro de perfil ─
DROP FUNCTION IF EXISTS concord.ev_user_suggestions(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_game_invite(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_game_respond(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_presence_set(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_privacy_set(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_steam_unlink(text, uuid, jsonb);
DROP FUNCTION IF EXISTS concord.ev_twitch_unlink(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.concord_integracao(uuid, text, jsonb);
DROP TABLE IF EXISTS concord.link_states;
DELETE FROM concord.config WHERE chave = 'municipios';

-- Faxina sem o link_states (que saiu acima)
CREATE OR REPLACE FUNCTION concord.varrer() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_ult bigint; c record; u text; v_users text[] := '{}';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('concord.varrer')) THEN RETURN; END IF;
  SELECT ultima INTO v_ult FROM concord.manutencao WHERE id = 1;
  IF concord.agora() - coalesce(v_ult, 0) < 10000 THEN RETURN; END IF;
  UPDATE concord.manutencao SET ultima = concord.agora() WHERE id = 1;

  FOR c IN SELECT id, user_id FROM concord.conexoes WHERE last_seen < concord.agora() - 45000 LOOP
    IF EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = c.user_id AND conexao = c.id) THEN
      PERFORM concord.leave_voice(c.user_id, NULL);
    END IF;
    DELETE FROM concord.conexoes WHERE id = c.id;
    v_users := array_append(v_users, c.user_id);
  END LOOP;

  FOR u IN SELECT DISTINCT x FROM unnest(v_users) x LOOP
    IF NOT concord.online(u) THEN
      PERFORM concord.broadcast_user(u);
      UPDATE concord.users SET last_seen = concord.agora() WHERE id = u;
    END IF;
  END LOOP;
END $$;

-- Perfil do Concord: só nome, @, foto, cor, status e "sobre" (sem extras)
CREATE OR REPLACE FUNCTION concord.ev_user_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE u concord.users; v text; mudou boolean := false;
BEGIN
  SELECT * INTO u FROM concord.users WHERE id = uid;
  IF d ? 'display_name' THEN
    v := btrim(concord.s(d, 'display_name', 32));
    PERFORM concord.need(length(v) >= 1, 'Nome de exibição inválido.');
    u.display_name := v; mudou := true;
  END IF;
  IF d ? 'username' THEN
    v := lower(btrim(concord.s(d, 'username', 32)));
    PERFORM concord.need(v ~ '^[a-z0-9_.]{2,32}$', 'Nome de usuário: 2–32 caracteres (a-z, 0-9, _ e .)');
    PERFORM concord.need(NOT EXISTS (SELECT 1 FROM concord.users WHERE lower(username) = v AND id <> uid), 'Esse nome de usuário já está em uso.');
    u.username := v; mudou := true;
  END IF;
  IF d ? 'avatar' THEN
    v := CASE WHEN jsonb_typeof(d -> 'avatar') = 'null' THEN NULL ELSE d ->> 'avatar' END;
    PERFORM concord.need(v IS NULL OR concord.is_image_url(v) OR v = (u.ext_profile ->> 'avatar'), 'Imagem inválida.');
    u.avatar := v; mudou := true;
  END IF;
  IF d ? 'accent' THEN
    v := CASE WHEN jsonb_typeof(d -> 'accent') = 'null' THEN NULL ELSE d ->> 'accent' END;
    PERFORM concord.need(v IS NULL OR v ~* '^#[0-9a-f]{6}$', 'Cor inválida.');
    u.accent := v; mudou := true;
  END IF;
  IF d ? 'bio' THEN u.bio := nullif(concord.s(d, 'bio', 190), ''); mudou := true; END IF;
  IF d ? 'custom_status' THEN u.custom_status := nullif(btrim(concord.s(d, 'custom_status', 128)), ''); mudou := true; END IF;
  IF d ? 'status' THEN
    PERFORM concord.need(d ->> 'status' IN ('online', 'idle', 'dnd', 'invisible'), 'Status inválido.');
    u.status := d ->> 'status'; mudou := true;
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  BEGIN
    UPDATE concord.users SET display_name = u.display_name, username = u.username, avatar = u.avatar, accent = u.accent,
           bio = u.bio, custom_status = u.custom_status, status = u.status
     WHERE id = uid;
  EXCEPTION WHEN unique_violation THEN
    PERFORM concord.fail('Esse nome de usuário já está em uso.');
  END;
  PERFORM concord.broadcast_user(uid);
  RETURN NULL;
END $$;

DROP FUNCTION IF EXISTS concord.clean_extras(jsonb, jsonb);
DROP FUNCTION IF EXISTS concord.valid_city(text);

-- ── 2. Perfil com o que vem do ERP ───────────────────────────────────────
-- Cargo e setor como no Organograma (mig 277): o vínculo mais recente de
-- EMPREGADOS pelo auth_user_id, preferindo quem está trabalhando; setor cai
-- para user_setor quando o cadastro não tem.
CREATE OR REPLACE FUNCTION concord.erp_info(p_ext uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'cargo', nullif(btrim(e."Título do Cargo"), ''),
    'setor', coalesce(nullif(btrim(e."Setor_ERP"), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = p.id)),
    'email', nullif(btrim(p.email), '')))
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT x."Título do Cargo", x."Setor_ERP" FROM public."EMPREGADOS" x
       WHERE x.auth_user_id = p.id
       ORDER BY (x."Situação" = 'Trabalhando') DESC NULLS LAST, x."ID" DESC LIMIT 1
    ) e ON true
   WHERE p.id = p_ext
$$;

CREATE OR REPLACE FUNCTION concord.ev_user_profile(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_tid text := d ->> 'user_id'; v_pub jsonb := concord.user_pub(d ->> 'user_id'); v_ext uuid;
BEGIN
  PERFORM concord.need(v_pub IS NOT NULL, 'Usuário não encontrado.');
  SELECT ext_id INTO v_ext FROM concord.users WHERE id = v_tid;
  RETURN jsonb_build_object(
    'user', v_pub,
    'erp', coalesce(concord.erp_info(v_ext), '{}'::jsonb),
    'mutual_servers', coalesce((SELECT jsonb_agg(m.server_id) FROM concord.members m
                                 WHERE m.user_id = v_tid AND concord.is_member(m.server_id, uid)), '[]'::jsonb),
    'mutual_friends', coalesce((SELECT jsonb_agg(a.target_id) FROM concord.relationships a
                                  JOIN concord.relationships b ON b.user_id = v_tid AND b.target_id = a.target_id AND b.type = 1
                                 WHERE a.user_id = uid AND a.type = 1), '[]'::jsonb),
    'relationship', concord.rel_type(uid, v_tid));
END $$;

-- ── 3. Contatos (antes "amigos"): mensagens no tom do ERP ────────────────
CREATE OR REPLACE FUNCTION concord.ev_friend_request(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE tid text; mine int;
BEGIN
  PERFORM concord.sincronizar_usuarios();
  IF concord.s(d, 'user_id', 32) <> '' THEN
    SELECT id INTO tid FROM concord.users WHERE id = d ->> 'user_id';
  ELSE
    tid := concord.find_user_by_name(d ->> 'username');
  END IF;
  PERFORM concord.need(tid IS DISTINCT FROM 'AMBIGUO', 'Mais de uma pessoa tem esse nome. Use o nome de usuário (@).');
  PERFORM concord.need(tid IS NOT NULL, 'Não encontramos ninguém com esse nome. Confira a ortografia.');
  PERFORM concord.need(tid <> uid, 'Você não pode adicionar a si mesmo.');
  mine := concord.rel_type(uid, tid);
  PERFORM concord.need(mine <> 1, 'Essa pessoa já está nos seus contatos.');
  PERFORM concord.need(mine <> 2, 'Desbloqueie essa pessoa antes de adicioná-la.');
  PERFORM concord.need(concord.rel_type(tid, uid) <> 2, 'Não foi possível enviar a solicitação de contato.');
  IF mine = 4 THEN RETURN jsonb_build_object('status', 'pending'); END IF;
  IF mine = 3 THEN
    PERFORM concord.set_rel(uid, tid, 1);
    PERFORM concord.set_rel(tid, uid, 1);
    RETURN jsonb_build_object('status', 'friends');
  END IF;
  PERFORM concord.set_rel(uid, tid, 4);
  PERFORM concord.set_rel(tid, uid, 3);
  RETURN jsonb_build_object('status', 'sent');
END $$;

CREATE OR REPLACE FUNCTION concord.ev_friend_accept(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE t text := d ->> 'user_id';
BEGIN
  IF concord.rel_type(uid, t) = 1 THEN RETURN NULL; END IF; -- clique duplo: já aceito
  PERFORM concord.need(concord.rel_type(uid, t) = 3, 'Solicitação não encontrada.');
  PERFORM concord.set_rel(uid, t, 1);
  PERFORM concord.set_rel(t, uid, 1);
  RETURN NULL;
END $$;

-- Colega que pode entrar numa conversa: usuário ativo do ERP, sem bloqueio entre os dois
CREATE OR REPLACE FUNCTION concord.colega_disponivel(p_uid text, p_outro text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM concord.users u WHERE u.id = p_outro AND concord.ativo_no_erp(u.ext_id))
     AND NOT concord.is_blocked_either(p_uid, p_outro)
$$;

-- Grupo com qualquer colega (no Otamashis, só amigos)
CREATE OR REPLACE FUNCTION concord.ev_group_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ids text[]; x text; v_ch text := concord.novo_id(); v_view jsonb; v_users jsonb;
BEGIN
  PERFORM concord.need(jsonb_typeof(d -> 'user_ids') = 'array' AND jsonb_array_length(d -> 'user_ids') BETWEEN 1 AND 9, 'Selecione de 1 a 9 pessoas.');
  v_ids := ARRAY(SELECT DISTINCT y FROM jsonb_array_elements_text(d -> 'user_ids') y WHERE y <> uid);
  FOREACH x IN ARRAY v_ids LOOP
    PERFORM concord.need(concord.colega_disponivel(uid, x), 'Uma das pessoas escolhidas não pode entrar na conversa.');
  END LOOP;
  INSERT INTO concord.channels (id, type, owner_id, created_at) VALUES (v_ch, 'group', uid, concord.agora());
  INSERT INTO concord.recipients (channel_id, user_id, closed) SELECT v_ch, y, false FROM unnest(uid || v_ids) y;
  v_view := concord.dm_view(v_ch);
  v_users := concord.dm_users(v_ch);
  FOREACH x IN ARRAY (uid || v_ids) LOOP
    PERFORM concord.emit_user(x, 'dm:create', jsonb_build_object('channel', v_view, 'users', v_users));
  END LOOP;
  RETURN jsonb_build_object('channel_id', v_ch);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_group_add(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ch text := d ->> 'channel_id'; tid text := d ->> 'user_id'; v_view jsonb; v_users jsonb; r text;
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_ch AND type = 'group') AND concord.channel_perms(v_ch, uid) <> 0,
                       'Grupo não encontrado.');
  PERFORM concord.need(concord.colega_disponivel(uid, tid), 'Essa pessoa não pode entrar no grupo.');
  PERFORM concord.need(NOT EXISTS (SELECT 1 FROM concord.recipients WHERE channel_id = v_ch AND user_id = tid), 'Já está no grupo.');
  PERFORM concord.need((SELECT count(*) FROM concord.recipients WHERE channel_id = v_ch) < 10, 'O grupo está cheio (máx. 10).');
  INSERT INTO concord.recipients (channel_id, user_id, closed) VALUES (v_ch, tid, false);
  v_view := concord.dm_view(v_ch);
  v_users := concord.dm_users(v_ch);
  FOR r IN SELECT user_id FROM concord.recipients WHERE channel_id = v_ch LOOP
    PERFORM concord.emit_user(r, CASE WHEN r = tid THEN 'dm:create' ELSE 'dm:update' END, jsonb_build_object('channel', v_view, 'users', v_users));
  END LOOP;
  PERFORM concord.system_message(v_ch, uid, 'group_add', format('<@%s> adicionou <@%s> ao grupo.', uid, tid));
  RETURN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
