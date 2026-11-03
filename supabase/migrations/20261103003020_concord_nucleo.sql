-- =========================================================================
-- Módulo CONCORD (03/11/2026) — 3/5: núcleo
--
-- Porte de server/realtime.js do Otamashis (a parte "de biblioteca"):
-- permissões, visões que o cliente recebe, envio de eventos e voz. Os nomes
-- e o formato dos JSON são os do Otamashis, porque o cliente é o mesmo.
--
--   Otamashis (Node, cache em memória)   →   Concord (Postgres)
--   online.has(uid)                      →   concord.online(uid)
--   io.to('u:'+uid).emit(ev, data)       →   concord.emit_user(uid, ev, data)
--   io.to(socket).emit(...)              →   concord.emit_conexao(conexao, ...)
--   UserError / need() / fail()          →   RAISE com SQLSTATE CC001
--   exclusive(fn) (fila de escrita)      →   pg_advisory_xact_lock (003040)
--
-- Tudo aqui é interno: só as RPCs de 003040 são expostas ao PostgREST.
-- Idempotente (CREATE OR REPLACE). ROLLBACK: DROP SCHEMA concord CASCADE.
-- =========================================================================

-- ── Utilidades ───────────────────────────────────────────────────────────
-- Tempo em ms, como o Date.now() do Otamashis (o cliente faz conta com ele).
CREATE OR REPLACE FUNCTION concord.agora() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT (extract(epoch FROM now()) * 1000)::bigint $$;

CREATE OR REPLACE FUNCTION concord.novo_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT lpad((((extract(epoch FROM clock_timestamp()) * 1000)::bigint - 1735689600000) * 4096
               + (nextval('concord.id_seq') % 4096))::text, 16, '0')
$$;

-- need()/fail(): erro "de usuário" — a mensagem volta para a tela.
CREATE OR REPLACE FUNCTION concord.fail(msg text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = 'CC001', MESSAGE = msg; END $$;

CREATE OR REPLACE FUNCTION concord.need(cond boolean, msg text DEFAULT 'Você não tem permissão para isso.') RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF cond IS NOT TRUE THEN PERFORM concord.fail(msg); END IF; END $$;

CREATE OR REPLACE FUNCTION concord.is_id(v text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(v ~ '^\d{16}$', false) $$;

-- str(v, max) do Otamashis: texto do campo (número vira texto), cortado.
CREATE OR REPLACE FUNCTION concord.s(d jsonb, k text, maxlen int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT left(CASE WHEN d -> k IS NULL OR jsonb_typeof(d -> k) = 'null' THEN '' ELSE d ->> k END, maxlen)
$$;

-- Number(v) || 0
CREATE OR REPLACE FUNCTION concord.n(d jsonb, k text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb := d -> k;
BEGIN
  IF v IS NULL THEN RETURN 0; END IF;
  IF jsonb_typeof(v) = 'number' THEN RETURN (v #>> '{}')::numeric; END IF;
  IF jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') ~ '^-?\d+(\.\d+)?$' THEN RETURN btrim(v #>> '{}')::numeric; END IF;
  IF jsonb_typeof(v) = 'boolean' THEN RETURN CASE WHEN v = 'true' THEN 1 ELSE 0 END; END IF;
  RETURN 0;
END $$;

-- !!v
CREATE OR REPLACE FUNCTION concord.b(d jsonb, k text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(d -> k)
    WHEN 'boolean' THEN (d ->> k)::boolean
    WHEN 'number'  THEN (d ->> k)::numeric <> 0
    WHEN 'string'  THEN d ->> k <> ''
    WHEN 'object'  THEN true
    WHEN 'array'   THEN true
    ELSE false END
$$;

-- Minúsculas e sem acento (o fold() do Otamashis).
CREATE OR REPLACE FUNCTION concord.fold(v text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(translate(lower(coalesce(v, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
    'aaaaaaeeeeiiiiooooouuuucnyy'))
$$;

-- Distância de edição com limite (erros de digitação na busca de usuários).
CREATE OR REPLACE FUNCTION concord.edit_dist(a text, b text, maxd int) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  la int := length(a); lb int := length(b);
  prev int[]; cur int[]; i int; j int; best int;
BEGIN
  IF abs(la - lb) > maxd THEN RETURN maxd + 1; END IF;
  prev := ARRAY(SELECT generate_series(0, lb));
  FOR i IN 1..la LOOP
    cur := ARRAY[i];
    best := i;
    FOR j IN 1..lb LOOP
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + CASE WHEN substr(a, i, 1) = substr(b, j, 1) THEN 0 ELSE 1 END);
      IF cur[j + 1] < best THEN best := cur[j + 1]; END IF;
    END LOOP;
    IF best > maxd THEN RETURN maxd + 1; END IF;
    prev := cur;
  END LOOP;
  RETURN prev[lb + 1];
END $$;

-- URL de arquivo do bucket do Concord (o isStorageUrl do Otamashis). O host
-- não é fixado: o mesmo banco atende a URL do cluster e a da réplica.
CREATE OR REPLACE FUNCTION concord.is_storage_url(u text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(u ~ '^https?://[^/?#]+/storage/v1/object/public/concord/[^?#]+$'
                  AND position('..' IN u) = 0 AND length(u) < 600, false)
$$;

CREATE OR REPLACE FUNCTION concord.is_image_url(u text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT concord.is_storage_url(u) AND u ~* '\.(png|jpe?g|gif|webp|avif|bmp)$'
$$;

-- ── Permissões (bitfield, igual a server/perms.js) ───────────────────────
--  VIEW_CHANNEL 1 · SEND_MESSAGES 2 · READ_HISTORY 4 · ATTACH_FILES 8
--  ADD_REACTIONS 16 · MENTION_EVERYONE 32 · MANAGE_MESSAGES 64 · CONNECT 128
--  SPEAK 256 · VIDEO 512 · MUTE_MEMBERS 1024 · DEAFEN_MEMBERS 2048
--  MOVE_MEMBERS 4096 · CREATE_INVITE 8192 · CHANGE_NICKNAME 16384
--  MANAGE_NICKNAMES 32768 · KICK_MEMBERS 65536 · BAN_MEMBERS 131072
--  TIMEOUT_MEMBERS 262144 · MANAGE_CHANNELS 524288 · MANAGE_ROLES 1048576
--  MANAGE_SERVER 2097152 · ADMINISTRATOR 4194304 · ALL 8388607
--  DEFAULT_PERMS 25503 · DM_PERMS 927

CREATE OR REPLACE FUNCTION concord.base_perms(p_sid text, p_uid text) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE v_owner text; p int;
BEGIN
  SELECT owner_id INTO v_owner FROM concord.servers WHERE id = p_sid;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF v_owner = p_uid THEN RETURN 8388607; END IF;
  IF NOT EXISTS (SELECT 1 FROM concord.members WHERE server_id = p_sid AND user_id = p_uid) THEN RETURN 0; END IF;
  SELECT coalesce((SELECT perms FROM concord.roles WHERE id = p_sid), 0) | coalesce(bit_or(r.perms), 0) INTO p
    FROM concord.member_roles mr JOIN concord.roles r ON r.id = mr.role_id
   WHERE mr.server_id = p_sid AND mr.user_id = p_uid;
  IF p & 4194304 <> 0 THEN RETURN 8388607; END IF;
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION concord.apply_overwrites(p int, p_ch text, p_sid text, p_uid text) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE o record; v_allow int := 0; v_deny int := 0;
BEGIN
  IF p_ch IS NULL OR NOT EXISTS (SELECT 1 FROM concord.overwrites WHERE channel_id = p_ch) THEN RETURN p; END IF;
  SELECT * INTO o FROM concord.overwrites WHERE channel_id = p_ch AND target_id = p_sid AND type = 'role';
  IF FOUND THEN p := (p & ~o.deny) | o.allow; END IF;
  SELECT coalesce(bit_or(ow.allow), 0), coalesce(bit_or(ow.deny), 0) INTO v_allow, v_deny
    FROM concord.overwrites ow
    JOIN concord.member_roles mr ON mr.role_id = ow.target_id AND mr.server_id = p_sid AND mr.user_id = p_uid
   WHERE ow.channel_id = p_ch AND ow.type = 'role' AND ow.target_id <> p_sid;
  p := (p & ~v_deny) | v_allow;
  SELECT * INTO o FROM concord.overwrites WHERE channel_id = p_ch AND target_id = p_uid AND type = 'member';
  IF FOUND THEN p := (p & ~o.deny) | o.allow; END IF;
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION concord.channel_perms(p_ch text, p_uid text) RETURNS int
LANGUAGE plpgsql STABLE AS $$
DECLARE c record; base int; p int; v_timeout bigint;
BEGIN
  SELECT id, type, server_id, parent_id INTO c FROM concord.channels WHERE id = p_ch;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF c.type IN ('dm', 'group') THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM concord.recipients WHERE channel_id = p_ch AND user_id = p_uid) THEN 927 ELSE 0 END;
  END IF;
  base := concord.base_perms(c.server_id, p_uid);
  IF base = 0 THEN RETURN 0; END IF;
  IF base & 4194304 <> 0 THEN RETURN 8388607; END IF;
  p := base;
  IF c.parent_id IS NOT NULL THEN p := concord.apply_overwrites(p, c.parent_id, c.server_id, p_uid); END IF;
  p := concord.apply_overwrites(p, c.id, c.server_id, p_uid);
  SELECT timeout_until INTO v_timeout FROM concord.members WHERE server_id = c.server_id AND user_id = p_uid;
  IF coalesce(v_timeout, 0) > concord.agora() THEN p := p & ~(2 | 16 | 256 | 128); END IF;
  RETURN CASE WHEN p & 1 <> 0 THEN p ELSE 0 END;
END $$;

CREATE OR REPLACE FUNCTION concord.top_position(p_sid text, p_uid text) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN (SELECT owner_id FROM concord.servers WHERE id = p_sid) = p_uid THEN 1000000000
    ELSE coalesce((SELECT max(r.position) FROM concord.member_roles mr JOIN concord.roles r ON r.id = mr.role_id
                    WHERE mr.server_id = p_sid AND mr.user_id = p_uid), 0) END
$$;

CREATE OR REPLACE FUNCTION concord.outranks(p_sid text, p_actor text, p_target text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE v_owner text;
BEGIN
  SELECT owner_id INTO v_owner FROM concord.servers WHERE id = p_sid;
  IF p_target = v_owner THEN RETURN false; END IF;
  IF p_actor = v_owner THEN RETURN true; END IF;
  RETURN concord.top_position(p_sid, p_actor) > concord.top_position(p_sid, p_target);
END $$;

CREATE OR REPLACE FUNCTION concord.require_perm(p_sid text, p_uid text, p_perm int) RETURNS void
LANGUAGE sql AS $$ SELECT concord.need((concord.base_perms(p_sid, p_uid) & p_perm) = p_perm) $$;

CREATE OR REPLACE FUNCTION concord.is_member(p_sid text, p_uid text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM concord.members WHERE server_id = p_sid AND user_id = p_uid) $$;

-- ── Presença e envio de eventos ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.online(p_uid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM concord.conexoes c WHERE c.user_id = p_uid AND c.last_seen > concord.agora() - 45000)
$$;

CREATE OR REPLACE FUNCTION concord.emit_user(p_uid text, p_ev text, p_data jsonb) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.eventos (conexao, ev, data)
  SELECT c.id, p_ev, p_data FROM concord.conexoes c
   WHERE c.user_id = p_uid AND c.last_seen > concord.agora() - 45000
$$;

-- Para as outras abas do mesmo usuário (socket.to('u:'+uid) no Otamashis).
CREATE OR REPLACE FUNCTION concord.emit_user_except(p_uid text, p_except uuid, p_ev text, p_data jsonb) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.eventos (conexao, ev, data)
  SELECT c.id, p_ev, p_data FROM concord.conexoes c
   WHERE c.user_id = p_uid AND c.id <> p_except AND c.last_seen > concord.agora() - 45000
$$;

CREATE OR REPLACE FUNCTION concord.emit_conexao(p_conexao uuid, p_ev text, p_data jsonb) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.eventos (conexao, ev, data)
  SELECT c.id, p_ev, p_data FROM concord.conexoes c WHERE c.id = p_conexao
$$;

-- ── Usuários ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.user_pub(p_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'username', u.username, 'display_name', coalesce(u.display_name, u.username), 'avatar', u.avatar,
    'accent', u.accent, 'bio', u.bio, 'custom_status', u.custom_status, 'created_at', u.created_at,
    'presence', CASE WHEN concord.online(u.id) THEN CASE WHEN u.status = 'invisible' THEN 'offline' ELSE u.status END ELSE 'offline' END,
    'guest', false)
    FROM concord.users u WHERE u.id = p_id
$$;

CREATE OR REPLACE FUNCTION concord.me_out(p_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT concord.user_pub(u.id) || jsonb_build_object(
    'status', u.status,
    'presence', CASE WHEN concord.online(u.id) THEN u.status ELSE 'offline' END,
    'email', u.email, 'linked', true, 'guest', NULL, 'extras', u.extras)
    FROM concord.users u WHERE u.id = p_id
$$;

CREATE OR REPLACE FUNCTION concord.users_map(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_object_agg(x.id, concord.user_pub(x.id)), '{}'::jsonb)
    FROM (SELECT DISTINCT i AS id FROM unnest(p_ids) i
           WHERE i IS NOT NULL AND EXISTS (SELECT 1 FROM concord.users u WHERE u.id = i)) x
$$;

-- Quem precisa saber das mudanças de alguém (servidores em comum, amizades, DMs).
CREATE OR REPLACE FUNCTION concord.related_users(p_uid text) RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT m2.user_id FROM concord.members m1 JOIN concord.members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = p_uid
  UNION SELECT target_id FROM concord.relationships WHERE user_id = p_uid
  UNION SELECT user_id FROM concord.relationships WHERE target_id = p_uid AND type <> 2
  UNION SELECT r2.user_id FROM concord.recipients r1 JOIN concord.recipients r2 ON r2.channel_id = r1.channel_id WHERE r1.user_id = p_uid
$$;

CREATE OR REPLACE FUNCTION concord.broadcast_user(p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_pub jsonb := concord.user_pub(p_uid); r text;
BEGIN
  FOR r IN SELECT x FROM concord.related_users(p_uid) x WHERE x <> p_uid LOOP
    PERFORM concord.emit_user(r, 'user:update', v_pub);
  END LOOP;
  PERFORM concord.emit_user(p_uid, 'user:update', concord.me_out(p_uid));
END $$;

-- ── Relacionamentos ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.rel_type(a text, b text) RETURNS int
LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT type::int FROM concord.relationships WHERE user_id = a AND target_id = b), 0) $$;

CREATE OR REPLACE FUNCTION concord.set_rel(a text, b text, p_type int) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_since bigint := concord.agora();
BEGIN
  IF coalesce(p_type, 0) = 0 THEN
    DELETE FROM concord.relationships WHERE user_id = a AND target_id = b;
    PERFORM concord.emit_user(a, 'relationship:remove', jsonb_build_object('id', b));
  ELSE
    INSERT INTO concord.relationships (user_id, target_id, type, since) VALUES (a, b, p_type, v_since)
    ON CONFLICT (user_id, target_id) DO UPDATE SET type = EXCLUDED.type, since = EXCLUDED.since;
    PERFORM concord.emit_user(a, 'relationship:add', jsonb_build_object('id', b, 'type', p_type, 'user', concord.user_pub(b)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION concord.is_blocked_either(a text, b text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT concord.rel_type(a, b) = 2 OR concord.rel_type(b, a) = 2 $$;

-- ── Visões de servidor e canal ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.channel_row(c concord.channels) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'type', c.type, 'name', c.name, 'icon', c.icon, 'name_font', c.name_font, 'name_size', c.name_size,
    'topic', c.topic, 'parent_id', c.parent_id, 'position', c.position, 'slowmode', c.slowmode,
    'user_limit', c.user_limit, 'last_message_id', c.last_message_id,
    'overwrites', coalesce((SELECT jsonb_agg(jsonb_build_object('target_id', o.target_id, 'type', o.type, 'allow', o.allow, 'deny', o.deny))
                              FROM concord.overwrites o WHERE o.channel_id = c.id), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION concord.member_out(p_sid text, p_uid text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'user_id', m.user_id, 'nick', m.nick, 'joined_at', m.joined_at, 'server_mute', m.server_mute,
    'server_deaf', m.server_deaf, 'timeout_until', m.timeout_until,
    'roles', coalesce((SELECT jsonb_agg(mr.role_id) FROM concord.member_roles mr
                        WHERE mr.server_id = m.server_id AND mr.user_id = m.user_id), '[]'::jsonb))
    FROM concord.members m WHERE m.server_id = p_sid AND m.user_id = p_uid
$$;

CREATE OR REPLACE FUNCTION concord.role_out(r concord.roles) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'perms', r.perms, 'position', r.position,
                            'hoist', r.hoist, 'mentionable', r.mentionable)
$$;

CREATE OR REPLACE FUNCTION concord.server_view(p_sid text, p_uid text) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE s concord.servers; v_perms int; v_channels jsonb;
BEGIN
  SELECT * INTO s FROM concord.servers WHERE id = p_sid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_perms := concord.base_perms(p_sid, p_uid);
  WITH ch AS (
    SELECT c, concord.channel_perms(c.id, p_uid) AS perms FROM concord.channels c WHERE c.server_id = p_sid
  ), vis AS (
    SELECT * FROM ch WHERE (ch.c).type <> 'category' AND ch.perms <> 0
  ), cats AS (
    SELECT * FROM ch WHERE (ch.c).type = 'category'
       AND (ch.perms <> 0 OR EXISTS (SELECT 1 FROM vis WHERE (vis.c).parent_id = (ch.c).id))
  ), todos AS (
    SELECT 0 AS grp, * FROM cats UNION ALL SELECT 1 AS grp, * FROM vis
  )
  SELECT coalesce(jsonb_agg(concord.channel_row(t.c) || jsonb_build_object('perms', t.perms)
                            ORDER BY t.grp, (t.c).position, (t.c).id), '[]'::jsonb)
    INTO v_channels FROM todos t;
  RETURN jsonb_build_object(
    'id', s.id, 'name', s.name, 'icon', s.icon, 'owner_id', s.owner_id, 'system_channel_id', s.system_channel_id,
    'created_at', s.created_at, 'perms', v_perms,
    'roles', coalesce((SELECT jsonb_agg(concord.role_out(r) ORDER BY r.position DESC) FROM concord.roles r WHERE r.server_id = p_sid), '[]'::jsonb),
    'members', coalesce((SELECT jsonb_agg(concord.member_out(p_sid, m.user_id)) FROM concord.members m WHERE m.server_id = p_sid), '[]'::jsonb),
    'channels', v_channels)
    -- pending_joins: pedidos de visitantes. No ERP não há visitante (o login é
    -- o do ERP), então fica 0 para quem poderia aprovar, como no Otamashis.
    || CASE WHEN v_perms & 2097152 <> 0 THEN jsonb_build_object('pending_joins', 0) ELSE '{}'::jsonb END;
END $$;

CREATE OR REPLACE FUNCTION concord.dm_view(p_ch text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', c.id, 'type', c.type, 'name', c.name, 'icon', c.icon, 'owner_id', c.owner_id,
    'last_message_id', c.last_message_id,
    'recipients', coalesce((SELECT jsonb_agg(r.user_id ORDER BY r.user_id) FROM concord.recipients r WHERE r.channel_id = c.id), '[]'::jsonb))
    FROM concord.channels c WHERE c.id = p_ch
$$;

CREATE OR REPLACE FUNCTION concord.dm_users(p_ch text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT concord.users_map(ARRAY(SELECT user_id FROM concord.recipients WHERE channel_id = p_ch))
$$;

CREATE OR REPLACE FUNCTION concord.sync_server(p_sid text, p_only text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  FOR r IN SELECT m.user_id FROM concord.members m
            WHERE m.server_id = p_sid AND (p_only IS NULL OR m.user_id = p_only) AND concord.online(m.user_id) LOOP
    PERFORM concord.emit_user(r, 'server:sync', concord.server_view(p_sid, r));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION concord.emit_server(p_sid text, p_ev text, p_data jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  FOR r IN SELECT user_id FROM concord.members WHERE server_id = p_sid LOOP
    PERFORM concord.emit_user(r, p_ev, p_data);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION concord.channel_audience(p_ch text) RETURNS SETOF text
LANGUAGE plpgsql STABLE AS $$
DECLARE c record;
BEGIN
  SELECT type, server_id INTO c FROM concord.channels WHERE id = p_ch;
  IF NOT FOUND THEN RETURN; END IF;
  IF c.type IN ('dm', 'group') THEN
    RETURN QUERY SELECT user_id FROM concord.recipients WHERE channel_id = p_ch;
  ELSE
    RETURN QUERY SELECT m.user_id FROM concord.members m
                  WHERE m.server_id = c.server_id AND concord.online(m.user_id) AND concord.channel_perms(p_ch, m.user_id) <> 0;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION concord.emit_channel(p_ch text, p_ev text, p_data jsonb, p_except text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  FOR r IN SELECT a FROM concord.channel_audience(p_ch) a WHERE p_except IS NULL OR a <> p_except LOOP
    PERFORM concord.emit_user(r, p_ev, p_data);
  END LOOP;
END $$;

-- ── Mensagens ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.message_json(m concord.messages) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'channel_id', m.channel_id, 'author_id', m.author_id, 'content', m.content, 'type', m.type,
    'reply_to', m.reply_to,
    'reply', CASE WHEN m.reply_to IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_build_object('id', r.id, 'author_id', r.author_id, 'content', left(r.content, 200),
                                 'has_attachments', jsonb_array_length(r.attachments) > 0)
         FROM concord.messages r WHERE r.id = m.reply_to),
      jsonb_build_object('id', m.reply_to, 'deleted', true)) END,
    'attachments', m.attachments, 'mentions', m.mentions, 'mention_roles', m.mention_roles,
    'mention_everyone', m.mention_everyone, 'edited_at', m.edited_at, 'pinned', m.pinned,
    'created_at', m.created_at, 'card', m.card,
    'reactions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('emoji', x.emoji, 'users', x.users) ORDER BY x.primeiro)
        FROM (SELECT emoji, min(created_at) AS primeiro, jsonb_agg(user_id ORDER BY created_at) AS users
                FROM concord.reactions WHERE message_id = m.id GROUP BY emoji) x), '[]'::jsonb))
$$;

-- Mensagens na ordem do array recebido.
CREATE OR REPLACE FUNCTION concord.messages_out(p_ids text[]) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(concord.message_json(m) ORDER BY o.n), '[]'::jsonb)
    FROM unnest(p_ids) WITH ORDINALITY o(id, n) JOIN concord.messages m ON m.id = o.id
$$;

CREATE OR REPLACE FUNCTION concord.message_out(p_id text) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT concord.message_json(m) FROM concord.messages m WHERE m.id = p_id $$;

-- { messages, users } com autores, autores das respostas e mencionados.
CREATE OR REPLACE FUNCTION concord.with_users(p_msgs jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('messages', p_msgs, 'users', concord.users_map(ARRAY(
    SELECT m ->> 'author_id' FROM jsonb_array_elements(p_msgs) m
    UNION SELECT m -> 'reply' ->> 'author_id' FROM jsonb_array_elements(p_msgs) m
    UNION SELECT x FROM jsonb_array_elements(p_msgs) m, jsonb_array_elements_text(m -> 'mentions') x)))
$$;

CREATE OR REPLACE FUNCTION concord.insert_message(
  p_ch text, p_author text, p_content text, p_type text DEFAULT 'default', p_reply text DEFAULT NULL,
  p_atts jsonb DEFAULT '[]', p_mentions jsonb DEFAULT '[]', p_mroles jsonb DEFAULT '[]',
  p_everyone boolean DEFAULT false, p_card jsonb DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_id text := concord.novo_id();
BEGIN
  INSERT INTO concord.messages (id, channel_id, author_id, content, type, reply_to, attachments, mentions,
                                mention_roles, mention_everyone, created_at, card)
  VALUES (v_id, p_ch, p_author, coalesce(p_content, ''), coalesce(p_type, 'default'), p_reply, coalesce(p_atts, '[]'),
          coalesce(p_mentions, '[]'), coalesce(p_mroles, '[]'), coalesce(p_everyone, false), concord.agora(), p_card);
  UPDATE concord.channels SET last_message_id = v_id WHERE id = p_ch;
  RETURN v_id;
END $$;

-- DM fechada por alguém volta a aparecer quando chega mensagem.
CREATE OR REPLACE FUNCTION concord.reopen_dm(p_ch text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  FOR r IN UPDATE concord.recipients SET closed = false WHERE channel_id = p_ch AND closed RETURNING user_id LOOP
    PERFORM concord.emit_user(r, 'dm:create', jsonb_build_object('channel', concord.dm_view(p_ch), 'users', concord.dm_users(p_ch)));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION concord.system_message(p_ch text, p_author text, p_type text, p_content text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_type text; v_id text;
BEGIN
  IF p_ch IS NULL THEN RETURN; END IF;
  SELECT type INTO v_type FROM concord.channels WHERE id = p_ch;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_type IN ('dm', 'group') THEN PERFORM concord.reopen_dm(p_ch); END IF;
  v_id := concord.insert_message(p_ch, p_author, p_content, p_type);
  PERFORM concord.emit_channel(p_ch, 'message:create',
    jsonb_build_object('message', concord.message_out(v_id), 'author', concord.user_pub(p_author)));
END $$;

CREATE OR REPLACE FUNCTION concord.bump_mentions(p_uids text[], p_ch text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.read_states (user_id, channel_id, last_read, mentions)
  SELECT DISTINCT u, p_ch, NULL::text, 1 FROM unnest(p_uids) u WHERE EXISTS (SELECT 1 FROM concord.users x WHERE x.id = u)
  ON CONFLICT (user_id, channel_id) DO UPDATE SET mentions = concord.read_states.mentions + 1
$$;

CREATE OR REPLACE FUNCTION concord.mark_read(p_uid text, p_ch text, p_msg text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.read_states (user_id, channel_id, last_read, mentions) VALUES (p_uid, p_ch, p_msg, 0)
  ON CONFLICT (user_id, channel_id) DO UPDATE
    SET last_read = greatest(coalesce(concord.read_states.last_read, ''), EXCLUDED.last_read), mentions = 0
$$;

CREATE OR REPLACE FUNCTION concord.mark_server_read(p_uid text, p_sid text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO concord.read_states (user_id, channel_id, last_read, mentions)
  SELECT p_uid, c.id, c.last_message_id, 0 FROM concord.channels c
   WHERE c.server_id = p_sid AND c.last_message_id IS NOT NULL
  ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read = EXCLUDED.last_read, mentions = 0
$$;

CREATE OR REPLACE FUNCTION concord.clean_attachments(p_list jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_agg(
           jsonb_build_object('url', a ->> 'url', 'name', coalesce(nullif(left(coalesce(a ->> 'name', ''), 120), ''), 'arquivo'),
                              'size', greatest(0, concord.n(a, 'size')), 'type', left(coalesce(a ->> 'type', ''), 80))
           || CASE WHEN concord.n(a, 'w') > 0 AND concord.n(a, 'h') > 0 AND concord.n(a, 'w') < 20000 AND concord.n(a, 'h') < 20000
                   THEN jsonb_build_object('w', round(concord.n(a, 'w')), 'h', round(concord.n(a, 'h'))) ELSE '{}'::jsonb END
           ORDER BY o.n), '[]'::jsonb)
    FROM (SELECT a, n FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_list) = 'array' THEN p_list ELSE '[]'::jsonb END)
                 WITH ORDINALITY x(a, n) WHERE n <= 10) o(a, n)
   WHERE jsonb_typeof(a) = 'object' AND concord.is_storage_url(a ->> 'url')
$$;

-- ── Voz (estado ao vivo) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.voice_out(s concord.voice_states) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('user_id', s.user_id, 'channel_id', s.channel_id, 'server_id', s.server_id,
    'self_mute', s.self_mute, 'self_deaf', s.self_deaf, 'server_mute', s.server_mute, 'server_deaf', s.server_deaf,
    'suppress', s.suppress, 'video', s.video, 'screen', s.screen, 'joined_at', s.joined_at)
$$;

CREATE OR REPLACE FUNCTION concord.voice_broadcast(p_ch text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.emit_channel(p_ch, 'voice:state', p_payload);
END $$;

CREATE OR REPLACE FUNCTION concord.leave_voice(p_uid text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states; v_type text; r text;
BEGIN
  DELETE FROM concord.voice_states WHERE user_id = p_uid RETURNING * INTO s;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM concord.voice_broadcast(s.channel_id, jsonb_build_object('user_id', p_uid, 'channel_id', NULL, 'prev_channel_id', s.channel_id));
  IF p_reason IS NOT NULL THEN PERFORM concord.emit_conexao(s.conexao, 'voice:kicked', jsonb_build_object('reason', p_reason)); END IF;
  SELECT type INTO v_type FROM concord.channels WHERE id = s.channel_id;
  IF v_type IN ('dm', 'group') AND NOT EXISTS (SELECT 1 FROM concord.voice_states WHERE channel_id = s.channel_id) THEN
    FOR r IN SELECT a FROM concord.channel_audience(s.channel_id) a LOOP
      PERFORM concord.emit_user(r, 'call:end', jsonb_build_object('channel_id', s.channel_id));
    END LOOP;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION concord.refresh_voice_member(p_sid text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states; m concord.members; p int;
BEGIN
  SELECT * INTO s FROM concord.voice_states WHERE user_id = p_uid;
  IF NOT FOUND OR s.server_id IS DISTINCT FROM p_sid THEN RETURN; END IF;
  SELECT * INTO m FROM concord.members WHERE server_id = p_sid AND user_id = p_uid;
  p := concord.channel_perms(s.channel_id, p_uid);
  IF m.user_id IS NULL OR p & 128 = 0 THEN
    PERFORM concord.leave_voice(p_uid, 'Você foi desconectado do canal de voz.');
    RETURN;
  END IF;
  UPDATE concord.voice_states SET server_mute = m.server_mute, server_deaf = m.server_deaf, suppress = (p & 256 = 0)
   WHERE user_id = p_uid RETURNING * INTO s;
  PERFORM concord.voice_broadcast(s.channel_id, concord.voice_out(s));
END $$;

CREATE OR REPLACE FUNCTION concord.refresh_voice_server(p_sid text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  FOR r IN SELECT user_id FROM concord.voice_states WHERE server_id = p_sid LOOP
    PERFORM concord.refresh_voice_member(p_sid, r);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION concord.visible_voice_states(p_uid text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(concord.voice_out(v)), '[]'::jsonb)
    FROM concord.voice_states v WHERE concord.channel_perms(v.channel_id, p_uid) <> 0
$$;

-- ── Entradas e saídas de membros ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.remove_member(p_sid text, p_uid text, p_reason text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = p_uid AND server_id = p_sid) THEN
    PERFORM concord.leave_voice(p_uid, CASE WHEN p_reason IS NOT NULL THEN 'Você foi removido do servidor.' END);
  END IF;
  DELETE FROM concord.members WHERE server_id = p_sid AND user_id = p_uid; -- member_roles em cascata
  DELETE FROM concord.read_states WHERE user_id = p_uid AND channel_id IN (SELECT id FROM concord.channels WHERE server_id = p_sid);
  DELETE FROM concord.overwrites WHERE type = 'member' AND target_id = p_uid
     AND channel_id IN (SELECT id FROM concord.channels WHERE server_id = p_sid);
  PERFORM concord.emit_user(p_uid, 'server:remove', jsonb_build_object('id', p_sid, 'reason', p_reason));
  PERFORM concord.emit_server(p_sid, 'member:remove', jsonb_build_object('server_id', p_sid, 'user_id', p_uid));
END $$;

CREATE OR REPLACE FUNCTION concord.add_member(p_sid text, p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_sys text;
BEGIN
  INSERT INTO concord.members (server_id, user_id, joined_at) VALUES (p_sid, p_uid, concord.agora());
  PERFORM concord.mark_server_read(p_uid, p_sid);
  PERFORM concord.emit_server(p_sid, 'member:add', jsonb_build_object('server_id', p_sid,
    'member', concord.member_out(p_sid, p_uid), 'user', concord.user_pub(p_uid)));
  SELECT system_channel_id INTO v_sys FROM concord.servers WHERE id = p_sid;
  IF v_sys IS NOT NULL THEN
    PERFORM concord.system_message(v_sys, p_uid, 'join', format('<@%s> entrou no servidor.', p_uid));
  END IF;
END $$;

-- ── Atividade ("Jogando X") e privacidade ────────────────────────────────
-- Escopo: 'none'|'friends'|'all' ou { mode, servers:[], friends:[] }
--   mode: none | all | friends | servers (membros dos servidores escolhidos) | some (amigos escolhidos)
CREATE OR REPLACE FUNCTION concord.scope_norm(p_scope jsonb, p_def text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_scope IS NULL OR jsonb_typeof(p_scope) = 'null' THEN jsonb_build_object('mode', p_def, 'servers', '[]'::jsonb, 'friends', '[]'::jsonb)
    WHEN jsonb_typeof(p_scope) = 'string' THEN jsonb_build_object('mode', p_scope #>> '{}', 'servers', '[]'::jsonb, 'friends', '[]'::jsonb)
    ELSE jsonb_build_object('mode', coalesce(p_scope ->> 'mode', p_def),
      'servers', CASE WHEN jsonb_typeof(p_scope -> 'servers') = 'array' THEN p_scope -> 'servers' ELSE '[]'::jsonb END,
      'friends', CASE WHEN jsonb_typeof(p_scope -> 'friends') = 'array' THEN p_scope -> 'friends' ELSE '[]'::jsonb END)
  END
$$;

CREATE OR REPLACE FUNCTION concord.scope_allows(p_scope jsonb, p_owner text, p_viewer text, p_def text) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb := concord.scope_norm(p_scope, p_def);
BEGIN
  IF p_owner = p_viewer THEN RETURN true; END IF;
  CASE s ->> 'mode'
    WHEN 'all' THEN RETURN true;
    WHEN 'none' THEN RETURN false;
    WHEN 'friends' THEN RETURN concord.rel_type(p_owner, p_viewer) = 1;
    WHEN 'some' THEN RETURN (s -> 'friends') ? p_viewer;
    WHEN 'servers' THEN RETURN EXISTS (SELECT 1 FROM jsonb_array_elements_text(s -> 'servers') x
                                         JOIN concord.members m ON m.server_id = x AND m.user_id = p_viewer);
    ELSE RETURN false;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION concord.scope_audience(p_scope jsonb, p_owner text, p_def text) RETURNS SETOF text
LANGUAGE plpgsql STABLE AS $$
DECLARE s jsonb := concord.scope_norm(p_scope, p_def);
BEGIN
  RETURN NEXT p_owner;
  CASE s ->> 'mode'
    WHEN 'all' THEN RETURN QUERY SELECT x FROM concord.related_users(p_owner) x WHERE x <> p_owner;
    WHEN 'friends' THEN RETURN QUERY SELECT target_id FROM concord.relationships WHERE user_id = p_owner AND type = 1;
    WHEN 'some' THEN RETURN QUERY SELECT x FROM jsonb_array_elements_text(s -> 'friends') x WHERE x <> p_owner;
    WHEN 'servers' THEN RETURN QUERY SELECT DISTINCT m.user_id FROM jsonb_array_elements_text(s -> 'servers') x
                                       JOIN concord.members m ON m.server_id = x WHERE m.user_id <> p_owner;
    ELSE RETURN;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION concord.activity_audience(p_owner text) RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT a FROM concord.scope_audience(
    (SELECT extras -> 'privacy' -> 'activity' FROM concord.users WHERE id = p_owner), p_owner, 'friends') a
$$;

CREATE OR REPLACE FUNCTION concord.set_activity(p_owner text, p_act jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_cur jsonb; r text;
BEGIN
  IF p_act IS NOT NULL AND jsonb_typeof(p_act) = 'null' THEN p_act := NULL; END IF;
  SELECT activity INTO v_cur FROM concord.users WHERE id = p_owner;
  IF v_cur IS NOT DISTINCT FROM p_act THEN RETURN; END IF;
  UPDATE concord.users SET activity = p_act WHERE id = p_owner;
  FOR r IN SELECT a FROM concord.activity_audience(p_owner) a LOOP
    PERFORM concord.emit_user(r, 'user:activity', jsonb_build_object('user_id', p_owner, 'activity', p_act));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION concord.save_extras(p_uid text, p_patch jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE concord.users SET extras = coalesce(extras, '{}'::jsonb) || p_patch WHERE id = p_uid;
  PERFORM concord.emit_user(p_uid, 'user:update', concord.me_out(p_uid));
END $$;

-- ── Usuários do ERP → usuários do Concord ────────────────────────────────
CREATE OR REPLACE FUNCTION concord.clean_username(v text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(x) >= 2 THEN x ELSE '' END
    FROM (SELECT left(regexp_replace(concord.fold(v), '[^a-z0-9_.]', '', 'g'), 28) AS x) t
$$;

CREATE OR REPLACE FUNCTION concord.unique_username(p_base text, p_except text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_base text := coalesce(nullif(concord.clean_username(p_base), ''), 'usuario'); v_name text; i int := 1;
BEGIN
  v_name := v_base;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM concord.users WHERE lower(username) = v_name AND id IS DISTINCT FROM p_except) THEN
      RETURN v_name;
    END IF;
    i := i + 1;
    v_name := left(left(v_base, 26) || i, 32);
  END LOOP;
END $$;

-- Nome do ERP vem em maiúsculas ("PABLO FLORES SANTAREM"); no chat fica
-- "Pablo Flores Santarem", cortado em 32 como no Otamashis.
CREATE OR REPLACE FUNCTION concord.nome_erp(v text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(left(btrim(initcap(lower(coalesce(v, '')))), 32), '') $$;

-- Cria ou atualiza o usuário do Concord a partir do perfil do ERP (o
-- linkUser do Otamashis): o que a pessoa mudou dentro do Concord fica; o que
-- continua igual ao último valor importado acompanha o ERP.
CREATE OR REPLACE FUNCTION concord.vincular(p_ext uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  p record; u concord.users; v_remote jsonb; v_prev jsonb; v_email text; v_user text;
BEGIN
  SELECT id, display_name, avatar_url, email INTO p FROM public.profiles WHERE id = p_ext;
  IF NOT FOUND THEN
    SELECT id, NULL::text AS display_name, NULL::text AS avatar_url, email INTO p FROM auth.users WHERE id = p_ext;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  v_email := lower(coalesce(p.email, ''));
  v_user := coalesce(nullif(concord.clean_username(split_part(v_email, '@', 1)), ''),
                     concord.clean_username(replace(coalesce(p.display_name, ''), ' ', '.')));
  v_remote := jsonb_build_object('username', v_user, 'display_name', concord.nome_erp(p.display_name), 'avatar', nullif(p.avatar_url, ''));

  SELECT * INTO u FROM concord.users WHERE ext_id = p_ext;
  IF NOT FOUND THEN
    v_user := concord.unique_username(v_user);
    INSERT INTO concord.users (id, ext_id, email, username, display_name, avatar, ext_profile, created_at, last_seen)
    VALUES (concord.novo_id(), p_ext, nullif(v_email, ''), v_user, coalesce(v_remote ->> 'display_name', v_user),
            v_remote ->> 'avatar', v_remote, concord.agora(), NULL)
    RETURNING * INTO u;
    RETURN u.id;
  END IF;

  v_prev := coalesce(u.ext_profile, '{}'::jsonb);
  IF v_remote IS DISTINCT FROM v_prev OR u.email IS DISTINCT FROM nullif(v_email, '') THEN
    UPDATE concord.users SET
      email = nullif(v_email, ''),
      ext_profile = v_remote,
      username = CASE WHEN v_remote ->> 'username' <> '' AND v_remote ->> 'username' IS DISTINCT FROM v_prev ->> 'username'
                       AND u.username IS NOT DISTINCT FROM v_prev ->> 'username'
                      THEN concord.unique_username(v_remote ->> 'username', u.id) ELSE username END,
      display_name = CASE WHEN v_remote ->> 'display_name' IS NOT NULL AND v_remote ->> 'display_name' IS DISTINCT FROM v_prev ->> 'display_name'
                           AND (u.display_name IS NOT DISTINCT FROM v_prev ->> 'display_name' OR u.display_name IS NULL)
                          THEN v_remote ->> 'display_name' ELSE display_name END,
      avatar = CASE WHEN v_remote ->> 'avatar' IS NOT NULL AND v_remote ->> 'avatar' IS DISTINCT FROM v_prev ->> 'avatar'
                     AND (u.avatar IS NOT DISTINCT FROM v_prev ->> 'avatar' OR u.avatar IS NULL)
                    THEN v_remote ->> 'avatar' ELSE avatar END
    WHERE id = u.id;
  END IF;
  RETURN u.id;
END $$;

-- "Dá para pesquisar os usuários do sistema": todo usuário ativo do ERP tem o
-- seu usuário no Concord, mesmo antes de abrir o módulo pela primeira vez.
-- Só cria quem falta (custo zero no dia a dia).
CREATE OR REPLACE FUNCTION concord.sincronizar_usuarios() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
  FOR r IN SELECT p.id FROM public.profiles p
            WHERE p.ativo AND NOT EXISTS (SELECT 1 FROM concord.users u WHERE u.ext_id = p.id) LOOP
    PERFORM concord.vincular(r);
  END LOOP;
END $$;

-- Usuário do ERP ainda ativo (quem saiu da empresa some da busca e das sugestões).
CREATE OR REPLACE FUNCTION concord.ativo_no_erp(p_ext uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce((SELECT ativo FROM public.profiles WHERE id = p_ext), false) $$;

-- ── Conexões mortas (aba fechada, rede caiu) ─────────────────────────────
-- O Otamashis sabia na hora pelo socket. Aqui, qualquer poll de qualquer
-- pessoa faz a faxina, no máximo uma a cada 10 s: tira da call quem sumiu e
-- avisa os outros que a pessoa ficou offline.
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
      PERFORM concord.set_activity(u, NULL);
      UPDATE concord.users SET last_seen = concord.agora() WHERE id = u;
    END IF;
  END LOOP;

  DELETE FROM concord.link_states WHERE created_at < concord.agora() - 600000;
END $$;
