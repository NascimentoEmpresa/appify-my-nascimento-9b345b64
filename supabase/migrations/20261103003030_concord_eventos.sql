-- =========================================================================
-- Módulo CONCORD (03/11/2026) — 4/5: eventos
--
-- Cada on('evento', ...) de server/realtime.js do Otamashis vira
--   concord.ev_<evento com : e - trocados por _>(uid, conexao, dados) → jsonb
-- e é chamado por public.concord_call (mig 003040). O retorno é o que o
-- Otamashis mandava no ack, sem o "ok" (quem põe é o concord_call). As
-- mensagens de erro são as mesmas, palavra por palavra.
--
-- Diferenças do original, todas por causa do ERP:
--   · não há visitante (o login é o do ERP): os pedidos de entrada de
--     visitante (join:list / join:decide) ficam sempre vazios;
--   · Steam/Twitch que precisam de chave (link-url, refresh, status) moram na
--     Edge Function concord-integracoes; aqui ficam unlink, privacidade e
--     presença, que só mexem no banco.
-- Idempotente (CREATE OR REPLACE). ROLLBACK: DROP SCHEMA concord CASCADE.
-- =========================================================================

-- ── Perfil ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.valid_city(v text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT (c.valor -> m[2]) ? m[1] FROM concord.config c WHERE c.chave = 'municipios'), false)
    FROM (SELECT regexp_match(btrim(left(coalesce(v, ''), 80)), '^(.+), ([A-Z]{2})$') AS m) t
   WHERE m IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION concord.clean_extras(d jsonb, prev jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_out jsonb := coalesce(prev, '{}'::jsonb);
  c text; g text; v_games jsonb := '[]'::jsonb; v_seen text[] := '{}';
  v_soc jsonb := '{}'::jsonb; k text; re text; v text; v_nome text;
  socials CONSTANT jsonb := '{
    "instagram": "^[A-Za-z0-9._]{1,30}$", "facebook": "^[A-Za-z0-9.]{3,50}$", "whatsapp": "^\\+?[0-9]{8,15}$",
    "tiktok": "^[A-Za-z0-9._]{2,24}$", "x": "^[A-Za-z0-9_]{1,15}$", "twitch": "^[A-Za-z0-9_]{3,25}$",
    "youtube": "^[A-Za-z0-9._-]{3,30}$", "discord": "^[A-Za-z0-9._]{2,32}$", "steam": "^[A-Za-z0-9_-]{2,32}$"}';
  interesses CONSTANT text[] := ARRAY['amizades','relacionamento','jogar_junto','conversar','networking','estudos','eventos'];
BEGIN
  IF d ? 'city' THEN
    c := btrim(concord.s(d, 'city', 80));
    PERFORM concord.need(c = '' OR concord.valid_city(c), 'Escolha uma cidade da lista.');
    v_out := v_out || jsonb_build_object('city', nullif(c, ''));
  END IF;
  IF d ? 'games' THEN
    PERFORM concord.need(jsonb_typeof(d -> 'games') = 'array', 'Lista de jogos inválida.');
    FOR g IN SELECT CASE WHEN jsonb_typeof(x) = 'string' THEN x #>> '{}' WHEN jsonb_typeof(x) = 'null' THEN '' ELSE x::text END
               FROM jsonb_array_elements(d -> 'games') x LOOP
      g := btrim(regexp_replace(left(g, 40), '[\u0001-\u001f]', '', 'g'));
      IF g <> '' AND NOT concord.fold(g) = ANY (v_seen) THEN
        v_seen := v_seen || concord.fold(g);
        v_games := v_games || to_jsonb(g);
      END IF;
      EXIT WHEN jsonb_array_length(v_games) >= 20;
    END LOOP;
    v_out := v_out || jsonb_build_object('games', v_games);
  END IF;
  IF d ? 'interests' THEN
    PERFORM concord.need(jsonb_typeof(d -> 'interests') = 'array', 'Interesses inválidos.');
    v_out := v_out || jsonb_build_object('interests', coalesce((
      SELECT jsonb_agg(i ORDER BY n) FROM (SELECT i, min(n) AS n FROM jsonb_array_elements_text(
        (SELECT jsonb_agg(x) FROM jsonb_array_elements(d -> 'interests') x WHERE jsonb_typeof(x) = 'string')) WITH ORDINALITY y(i, n)
        WHERE i = ANY (interesses) GROUP BY i) z), '[]'::jsonb));
  END IF;
  IF d ? 'socials' THEN
    PERFORM concord.need(jsonb_typeof(d -> 'socials') = 'object', 'Redes sociais inválidas.');
    FOR k, re IN SELECT key, value FROM jsonb_each_text(socials) LOOP
      v := regexp_replace(btrim(concord.s(d -> 'socials', k, 60)), '^@', '');
      IF k = 'whatsapp' THEN v := regexp_replace(v, '[\s().-]', '', 'g'); END IF;
      CONTINUE WHEN v = '';
      v_nome := CASE WHEN k = 'x' THEN 'X (Twitter)' ELSE upper(left(k, 1)) || substr(k, 2) END;
      PERFORM concord.need(v ~ re, format('Confira o campo %s.', v_nome));
      v_soc := v_soc || jsonb_build_object(k, v);
    END LOOP;
    v_out := v_out || jsonb_build_object('socials', v_soc);
  END IF;
  IF d ? 'socials_visibility' THEN
    v_out := v_out || jsonb_build_object('socials_visibility', CASE WHEN d ->> 'socials_visibility' = 'all' THEN 'all' ELSE 'friends' END);
  END IF;
  IF d ? 'discoverable' THEN v_out := v_out || jsonb_build_object('discoverable', concord.b(d, 'discoverable')); END IF;
  IF d ? 'onboarded' THEN v_out := v_out || jsonb_build_object('onboarded', concord.b(d, 'onboarded')); END IF;
  RETURN v_out;
END $$;

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
    -- A foto do ERP também vale (é a que vem por padrão).
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
  IF jsonb_typeof(d -> 'extras') = 'object' THEN
    u.extras := concord.clean_extras(d -> 'extras', u.extras); mudou := true;
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  BEGIN
    UPDATE concord.users SET display_name = u.display_name, username = u.username, avatar = u.avatar, accent = u.accent,
           bio = u.bio, custom_status = u.custom_status, status = u.status, extras = u.extras
     WHERE id = uid;
  EXCEPTION WHEN unique_violation THEN
    PERFORM concord.fail('Esse nome de usuário já está em uso.');
  END;
  PERFORM concord.broadcast_user(uid);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_user_profile(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_tid text := d ->> 'user_id'; v_pub jsonb := concord.user_pub(d ->> 'user_id');
  ex jsonb; priv jsonb; v_show boolean; v_act jsonb;
BEGIN
  PERFORM concord.need(v_pub IS NOT NULL, 'Usuário não encontrado.');
  SELECT coalesce(extras, '{}'::jsonb), activity INTO ex, v_act FROM concord.users WHERE id = v_tid;
  priv := coalesce(ex -> 'privacy', '{}'::jsonb);
  v_show := v_tid = uid OR ex ->> 'socials_visibility' = 'all' OR concord.rel_type(uid, v_tid) = 1;
  RETURN jsonb_build_object(
    'user', v_pub,
    'extras', jsonb_build_object(
      'city', ex -> 'city', 'games', coalesce(ex -> 'games', '[]'::jsonb), 'interests', coalesce(ex -> 'interests', '[]'::jsonb),
      'socials', CASE WHEN v_show THEN coalesce(ex -> 'socials', '{}'::jsonb) ELSE '{}'::jsonb END,
      'socials_hidden', NOT v_show AND coalesce(ex -> 'socials', '{}'::jsonb) <> '{}'::jsonb,
      'steam', CASE WHEN concord.scope_allows(priv -> 'steam', v_tid, uid, 'friends') THEN ex -> 'steam' END,
      'twitch', CASE WHEN concord.scope_allows(priv -> 'twitch', v_tid, uid, 'all') THEN ex -> 'twitch' END,
      'activity', CASE WHEN concord.scope_allows(priv -> 'activity', v_tid, uid, 'friends') THEN v_act END),
    'mutual_servers', coalesce((SELECT jsonb_agg(m.server_id) FROM concord.members m
                                 WHERE m.user_id = v_tid AND concord.is_member(m.server_id, uid)), '[]'::jsonb),
    'mutual_friends', coalesce((SELECT jsonb_agg(a.target_id) FROM concord.relationships a
                                  JOIN concord.relationships b ON b.user_id = v_tid AND b.target_id = a.target_id AND b.type = 1
                                 WHERE a.user_id = uid AND a.type = 1), '[]'::jsonb),
    'relationship', concord.rel_type(uid, v_tid));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_steam_unlink(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT extras ? 'steam' FROM concord.users WHERE id = uid) THEN
    UPDATE concord.users SET extras = extras - 'steam' WHERE id = uid;
    PERFORM concord.emit_user(uid, 'user:update', concord.me_out(uid));
    IF (SELECT activity ->> 'source' FROM concord.users WHERE id = uid) = 'steam' THEN PERFORM concord.set_activity(uid, NULL); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_twitch_unlink(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT extras ? 'twitch' FROM concord.users WHERE id = uid) THEN
    UPDATE concord.users SET extras = extras - 'twitch' WHERE id = uid;
    PERFORM concord.emit_user(uid, 'user:update', concord.me_out(uid));
    IF (SELECT activity ->> 'source' FROM concord.users WHERE id = uid) = 'twitch' THEN PERFORM concord.set_activity(uid, NULL); END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_privacy_set(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  p jsonb := d -> 'privacy'; v_cur jsonb; v_next jsonb; k text; v jsonb; c jsonb; r text; v_act jsonb;
  modos CONSTANT text[] := ARRAY['none', 'friends', 'all', 'servers', 'some'];
BEGIN
  PERFORM concord.need(jsonb_typeof(p) = 'object', 'Dados inválidos.');
  SELECT coalesce(extras -> 'privacy', '{}'::jsonb), activity INTO v_cur, v_act FROM concord.users WHERE id = uid;
  v_next := v_cur;
  FOREACH k IN ARRAY ARRAY['steam', 'twitch', 'activity'] LOOP
    CONTINUE WHEN NOT p ? k;
    v := p -> k;
    c := NULL;
    IF jsonb_typeof(v) = 'string' THEN
      IF (v #>> '{}') = ANY (modos) THEN c := v; END IF;
    ELSIF jsonb_typeof(v) = 'object' AND (v ->> 'mode') = ANY (modos) THEN
      c := jsonb_build_object('mode', v ->> 'mode',
        'servers', coalesce((SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(v -> 'servers') = 'array' THEN v -> 'servers' ELSE '[]' END) x
                     WHERE concord.is_member(x, uid) LIMIT 100) t), '[]'::jsonb),
        'friends', coalesce((SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(v -> 'friends') = 'array' THEN v -> 'friends' ELSE '[]' END) x
                     WHERE concord.rel_type(uid, x) = 1 LIMIT 200) t), '[]'::jsonb));
    END IF;
    IF c IS NOT NULL THEN v_next := v_next || jsonb_build_object(k, c); END IF;
  END LOOP;
  PERFORM concord.save_extras(uid, jsonb_build_object('privacy', v_next));
  -- Reenvia a atividade conforme a nova visibilidade
  FOR r IN SELECT x FROM concord.related_users(uid) x LOOP
    PERFORM concord.emit_user(r, 'user:activity', jsonb_build_object('user_id', uid,
      'activity', CASE WHEN EXISTS (SELECT 1 FROM concord.activity_audience(uid) a WHERE a = r) THEN v_act END));
  END LOOP;
  RETURN NULL;
END $$;

-- Presença vinda do app de Windows (Jogando/Assistindo detectado localmente)
CREATE OR REPLACE FUNCTION concord.ev_presence_set(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE a jsonb := d -> 'activity'; v_name text;
BEGIN
  IF jsonb_typeof(a) = 'object' THEN
    v_name := concord.s(a, 'name', 80);
    IF v_name <> '' THEN
      PERFORM concord.set_activity(uid, jsonb_build_object('type', CASE WHEN a ->> 'type' = 'watching' THEN 'watching' ELSE 'playing' END,
                                                           'name', v_name, 'image', NULL, 'source', 'app'));
    END IF;
  ELSIF (SELECT activity ->> 'source' FROM concord.users WHERE id = uid) = 'app' THEN
    PERFORM concord.set_activity(uid, NULL);
  END IF;
  RETURN NULL;
END $$;

-- ── Amizades ─────────────────────────────────────────────────────────────
-- Sugestões: quem aceitou aparecer e tem algo em comum.
CREATE OR REPLACE FUNCTION concord.ev_user_suggestions(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  me jsonb; v_my_games text[]; v_my_city text; u record; ex jsonb;
  v_games jsonb; v_interests jsonb; v_same boolean; v_mf int; v_ms int; v_score int; v_reasons jsonb; v_out jsonb := '[]'::jsonb;
  lbl CONSTANT jsonb := '{"amizades":"novas amizades","relacionamento":"um relacionamento","jogar_junto":"gente para jogar","conversar":"conversar","networking":"networking","estudos":"estudar junto","eventos":"eventos"}';
BEGIN
  SELECT coalesce(extras, '{}'::jsonb) INTO me FROM concord.users WHERE id = uid;
  v_my_games := ARRAY(SELECT concord.fold(x) FROM jsonb_array_elements_text(coalesce(me -> 'games', '[]')) x);
  v_my_city := concord.fold(me ->> 'city');
  FOR u IN SELECT x.id, x.extras FROM concord.users x
            WHERE x.id <> uid AND coalesce((x.extras ->> 'discoverable')::boolean, false) AND concord.ativo_no_erp(x.ext_id)
              AND concord.rel_type(uid, x.id) = 0 AND concord.rel_type(x.id, uid) = 0 LOOP
    ex := coalesce(u.extras, '{}'::jsonb);
    v_games := coalesce((SELECT jsonb_agg(g ORDER BY n) FROM jsonb_array_elements_text(coalesce(ex -> 'games', '[]')) WITH ORDINALITY t(g, n)
                          WHERE concord.fold(g) = ANY (v_my_games)), '[]'::jsonb);
    v_interests := coalesce((SELECT jsonb_agg(i ORDER BY n) FROM jsonb_array_elements_text(coalesce(ex -> 'interests', '[]')) WITH ORDINALITY t(i, n)
                              WHERE coalesce(me -> 'interests', '[]') ? i), '[]'::jsonb);
    v_same := v_my_city <> '' AND concord.fold(ex ->> 'city') = v_my_city;
    SELECT count(*) INTO v_mf FROM concord.relationships a
      JOIN concord.relationships b ON b.user_id = uid AND b.target_id = a.target_id AND b.type = 1
     WHERE a.user_id = u.id AND a.type = 1;
    SELECT count(*) INTO v_ms FROM concord.members a JOIN concord.members b ON b.server_id = a.server_id AND b.user_id = uid
     WHERE a.user_id = u.id;
    v_score := jsonb_array_length(v_games) * 3 + jsonb_array_length(v_interests) * 2 + CASE WHEN v_same THEN 4 ELSE 0 END + v_mf * 2 + v_ms;
    IF v_interests ? 'relacionamento' THEN v_score := v_score + 3; END IF;
    CONTINUE WHEN v_score = 0;
    v_reasons := '[]'::jsonb;
    IF jsonb_array_length(v_games) > 0 THEN
      v_reasons := v_reasons || to_jsonb(
        CASE WHEN jsonb_array_length(v_games) = 1 THEN 'Também joga' ELSE 'Jogos em comum:' END || ' ' ||
        (SELECT string_agg(g, ', ' ORDER BY n) FROM jsonb_array_elements_text(v_games) WITH ORDINALITY t(g, n) WHERE n <= 3) ||
        CASE WHEN jsonb_array_length(v_games) > 3 THEN ' +' || (jsonb_array_length(v_games) - 3) ELSE '' END);
    END IF;
    IF v_same THEN v_reasons := v_reasons || to_jsonb('Também é de ' || (ex ->> 'city')); END IF;
    IF jsonb_array_length(v_interests) > 0 THEN
      v_reasons := v_reasons || to_jsonb('Também procura ' ||
        (SELECT string_agg(lbl ->> i, ', ' ORDER BY n) FROM jsonb_array_elements_text(v_interests) WITH ORDINALITY t(i, n)));
    END IF;
    IF v_mf > 0 THEN v_reasons := v_reasons || to_jsonb(v_mf || ' amigo' || CASE WHEN v_mf > 1 THEN 's' ELSE '' END || ' em comum'); END IF;
    IF v_ms > 0 THEN v_reasons := v_reasons || to_jsonb(v_ms || ' servidor' || CASE WHEN v_ms > 1 THEN 'es' ELSE '' END || ' em comum'); END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object('user', concord.user_pub(u.id), 'score', v_score, 'reasons', v_reasons,
      'city', ex -> 'city', 'games', coalesce(ex -> 'games', '[]'::jsonb), 'interests', coalesce(ex -> 'interests', '[]'::jsonb),
      '_online', concord.online(u.id)));
  END LOOP;
  RETURN jsonb_build_object('suggestions', coalesce((
    SELECT jsonb_agg(x - '_online' ORDER BY (x ->> 'score')::int DESC, (x ->> '_online')::boolean DESC)
      FROM (SELECT x FROM jsonb_array_elements(v_out) x ORDER BY (x ->> 'score')::int DESC, (x ->> '_online')::boolean DESC LIMIT 24) t), '[]'::jsonb));
END $$;

-- Pontua o quanto um usuário combina com a busca (0 = não combina)
CREATE OR REPLACE FUNCTION concord.match_score(p_username text, p_display text, q text) RETURNS int
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  uname text := lower(p_username); dname text := concord.fold(p_display);
  qs text := regexp_replace(q, '[^a-z0-9_.]', '', 'g');
  words text[]; qw text[]; w text; t text; ok boolean; maxd int; best int;
BEGIN
  IF uname = qs OR dname = q THEN RETURN 100; END IF;
  IF starts_with(uname, qs) OR starts_with(dname, q) THEN RETURN 80; END IF;
  words := ARRAY(SELECT x FROM unnest(regexp_split_to_array(dname, '\s+') || regexp_split_to_array(uname, '[._]+')) x WHERE x <> '');
  IF EXISTS (SELECT 1 FROM unnest(words) x WHERE starts_with(x, q)) THEN RETURN 70; END IF;
  IF strpos(uname, qs) > 0 OR strpos(dname, q) > 0 THEN RETURN 55; END IF;
  -- Cada palavra digitada aparece em algum lugar ("pablo tas" → "Pablo Tasuyuki")
  qw := ARRAY(SELECT x FROM unnest(regexp_split_to_array(q, '\s+')) x WHERE x <> '');
  IF array_length(qw, 1) > 1 THEN
    ok := true;
    FOREACH w IN ARRAY qw LOOP
      IF NOT (EXISTS (SELECT 1 FROM unnest(words) x WHERE starts_with(x, w)) OR strpos(dname, w) > 0) THEN ok := false; EXIT; END IF;
    END LOOP;
    IF ok THEN RETURN 60; END IF;
  END IF;
  -- Erros de digitação: compara com o começo de cada palavra/nome
  IF length(q) >= 3 THEN
    maxd := CASE WHEN length(q) >= 7 THEN 2 ELSE 1 END;
    best := maxd + 1;
    FOREACH t IN ARRAY (ARRAY[uname, dname] || words) LOOP
      best := least(best, concord.edit_dist(q, left(t, length(q)), maxd), concord.edit_dist(q, t, maxd));
    END LOOP;
    IF best <= maxd THEN RETURN 40 - best * 10; END IF;
  END IF;
  RETURN 0;
END $$;

-- Busca de usuários do ERP (todos os ativos, não só quem já abriu o Concord).
CREATE OR REPLACE FUNCTION concord.ev_user_search(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE q text := regexp_replace(regexp_replace(concord.fold(concord.s(d, 'query', 64)), '^@', ''), '\s+', ' ', 'g');
BEGIN
  IF length(q) < 2 THEN RETURN jsonb_build_object('results', '[]'::jsonb); END IF;
  PERFORM concord.sincronizar_usuarios();
  RETURN jsonb_build_object('results', coalesce((
    SELECT jsonb_agg(jsonb_build_object('user', concord.user_pub(h.id), 'relationship', concord.rel_type(uid, h.id))
                     ORDER BY h.score DESC, h.amigo DESC, h.username)
      FROM (SELECT x.id, x.username, concord.match_score(x.username, x.display_name, q) AS score,
                   concord.rel_type(uid, x.id) = 1 AS amigo
              FROM concord.users x
             WHERE x.id <> uid AND concord.rel_type(x.id, uid) <> 2 AND concord.ativo_no_erp(x.ext_id)
               AND concord.match_score(x.username, x.display_name, q) > 0
             ORDER BY 3 DESC, 4 DESC, x.username LIMIT 10) h), '[]'::jsonb));
END $$;

-- "Adicionar amigo": nome de usuário (com maiúsculas, acentos e espaços) e
-- depois nome de exibição. Devolve NULL, o id, ou 'AMBIGUO'.
CREATE OR REPLACE FUNCTION concord.find_user_by_name(p_input text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE raw text := regexp_replace(concord.fold(left(coalesce(p_input, ''), 64)), '^@', ''); v text; n int;
BEGIN
  IF raw = '' THEN RETURN NULL; END IF;
  SELECT id INTO v FROM concord.users WHERE lower(username) IN (raw, regexp_replace(raw, '[^a-z0-9_.]', '', 'g')) LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT count(*), min(id) INTO n, v FROM concord.users WHERE display_name IS NOT NULL AND concord.fold(display_name) = raw;
  RETURN CASE WHEN n = 1 THEN v WHEN n > 1 THEN 'AMBIGUO' ELSE NULL END;
END $$;

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
  PERFORM concord.need(tid IS DISTINCT FROM 'AMBIGUO', 'Mais de uma pessoa usa esse nome de exibição. Use o nome de usuário (@) dela.');
  PERFORM concord.need(tid IS NOT NULL, 'Não encontramos nenhum usuário com esse nome. Confira a ortografia.');
  PERFORM concord.need(tid <> uid, 'Você não pode adicionar a si mesmo.');
  mine := concord.rel_type(uid, tid);
  PERFORM concord.need(mine <> 1, 'Vocês já são amigos.');
  PERFORM concord.need(mine <> 2, 'Desbloqueie esse usuário antes de enviar um pedido.');
  PERFORM concord.need(concord.rel_type(tid, uid) <> 2, 'Não foi possível enviar o pedido de amizade.');
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
  PERFORM concord.need(concord.rel_type(uid, t) = 3, 'Pedido não encontrado.');
  PERFORM concord.set_rel(uid, t, 1);
  PERFORM concord.set_rel(t, uid, 1);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_friend_remove(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE t text := d ->> 'user_id'; mine int := concord.rel_type(uid, d ->> 'user_id');
BEGIN
  PERFORM concord.need(mine <> 0 AND mine <> 2, 'Nada para remover.');
  PERFORM concord.set_rel(uid, t, 0);
  IF concord.rel_type(t, uid) <> 2 THEN PERFORM concord.set_rel(t, uid, 0); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_friend_block(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE t text := d ->> 'user_id';
BEGIN
  PERFORM concord.need(concord.is_id(t) AND t <> uid AND EXISTS (SELECT 1 FROM concord.users WHERE id = t), 'Usuário inválido.');
  PERFORM concord.set_rel(uid, t, 2);
  IF concord.rel_type(t, uid) NOT IN (0, 2) THEN PERFORM concord.set_rel(t, uid, 0); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_friend_unblock(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.need(concord.rel_type(uid, d ->> 'user_id') = 2, 'Usuário não está bloqueado.');
  PERFORM concord.set_rel(uid, d ->> 'user_id', 0);
  RETURN NULL;
END $$;

-- ── Servidores ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.ev_server_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_name text := btrim(concord.s(d, 'name', 100)); v_icon text := nullif(concord.s(d, 'icon', 600), '');
  sid text; v_now bigint := concord.agora(); cat_t text; cat_v text; geral text; voz text;
BEGIN
  PERFORM concord.need(length(v_name) >= 2, 'O nome do servidor precisa ter pelo menos 2 caracteres.');
  PERFORM concord.need(v_icon IS NULL OR concord.is_image_url(v_icon), 'Ícone inválido.');
  sid := concord.novo_id(); cat_t := concord.novo_id(); cat_v := concord.novo_id(); geral := concord.novo_id(); voz := concord.novo_id();
  INSERT INTO concord.servers (id, name, icon, owner_id, system_channel_id, created_at) VALUES (sid, v_name, v_icon, uid, geral, v_now);
  INSERT INTO concord.roles (id, server_id, name, perms, position) VALUES (sid, sid, '@everyone', 25503, 0);
  INSERT INTO concord.channels (id, server_id, parent_id, type, name, position, created_at) VALUES
    (cat_t, sid, NULL, 'category', 'Canais de texto', 0, v_now),
    (cat_v, sid, NULL, 'category', 'Canais de voz', 1, v_now),
    (geral, sid, cat_t, 'text', 'geral', 0, v_now),
    (voz, sid, cat_v, 'voice', 'Geral', 0, v_now);
  INSERT INTO concord.members (server_id, user_id, joined_at) VALUES (sid, uid, v_now);
  PERFORM concord.emit_user(uid, 'server:add', jsonb_build_object('server', concord.server_view(sid, uid), 'users', concord.users_map(ARRAY[uid])));
  RETURN jsonb_build_object('server_id', sid, 'channel_id', geral);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_server_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; v text; mudou boolean := false;
BEGIN
  PERFORM concord.require_perm(sid, uid, 2097152);
  IF d ? 'name' THEN
    v := btrim(concord.s(d, 'name', 100));
    PERFORM concord.need(length(v) >= 2, 'Nome muito curto.');
    UPDATE concord.servers SET name = v WHERE id = sid; mudou := true;
  END IF;
  IF d ? 'icon' THEN
    v := CASE WHEN jsonb_typeof(d -> 'icon') = 'null' THEN NULL ELSE d ->> 'icon' END;
    PERFORM concord.need(v IS NULL OR concord.is_image_url(v), 'Ícone inválido.');
    UPDATE concord.servers SET icon = v WHERE id = sid; mudou := true;
  END IF;
  IF d ? 'system_channel_id' THEN
    v := CASE WHEN jsonb_typeof(d -> 'system_channel_id') = 'null' THEN NULL ELSE nullif(d ->> 'system_channel_id', '') END;
    PERFORM concord.need(v IS NULL OR EXISTS (SELECT 1 FROM concord.channels WHERE id = v AND server_id = sid AND type = 'text'), 'Canal inválido.');
    UPDATE concord.servers SET system_channel_id = v WHERE id = sid; mudou := true;
  END IF;
  IF mudou THEN PERFORM concord.sync_server(sid); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_server_delete(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; v_members text[]; r text;
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.servers WHERE id = sid AND owner_id = uid), 'Somente o dono pode excluir o servidor.');
  v_members := ARRAY(SELECT user_id FROM concord.members WHERE server_id = sid);
  FOR r IN SELECT user_id FROM concord.voice_states WHERE server_id = sid LOOP
    PERFORM concord.leave_voice(r, 'O servidor foi excluído.');
  END LOOP;
  DELETE FROM concord.servers WHERE id = sid;
  FOREACH r IN ARRAY v_members LOOP
    PERFORM concord.emit_user(r, 'server:remove', jsonb_build_object('id', sid, 'reason', CASE WHEN r = uid THEN NULL ELSE 'deleted' END));
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_server_transfer(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id';
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.servers WHERE id = sid AND owner_id = uid), 'Somente o dono pode transferir o servidor.');
  PERFORM concord.need(concord.is_member(sid, d ->> 'user_id'), 'Membro não encontrado.');
  UPDATE concord.servers SET owner_id = d ->> 'user_id' WHERE id = sid;
  PERFORM concord.sync_server(sid);
  PERFORM concord.refresh_voice_server(sid);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_server_leave(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id';
BEGIN
  PERFORM concord.need(concord.is_member(sid, uid), 'Servidor não encontrado.');
  PERFORM concord.need((SELECT owner_id FROM concord.servers WHERE id = sid) <> uid, 'Transfira a posse ou exclua o servidor antes de sair.');
  PERFORM concord.remove_member(sid, uid, NULL);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_server_read(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id';
BEGIN
  PERFORM concord.need(concord.is_member(sid, uid), 'Servidor não encontrado.');
  PERFORM concord.mark_server_read(uid, sid);
  RETURN jsonb_build_object('readStates', coalesce((
    SELECT jsonb_object_agg(c.id, jsonb_build_object('last_read', c.last_message_id, 'mentions', 0))
      FROM concord.channels c WHERE c.server_id = sid AND c.last_message_id IS NOT NULL), '{}'::jsonb));
END $$;

-- ── Convites ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.ev_invite_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  sid text := d ->> 'server_id';
  v_max int := greatest(0, least(100, trunc(concord.n(d, 'max_uses'))::int));
  v_age int := greatest(0, least(30 * 86400, trunc(concord.n(d, 'max_age'))::int));
  v_code text;
BEGIN
  PERFORM concord.require_perm(sid, uid, 8192);
  IF v_max = 0 AND v_age = 0 THEN
    SELECT code INTO v_code FROM concord.invites
     WHERE server_id = sid AND inviter_id = uid AND max_uses = 0 AND expires_at = 0 LIMIT 1;
    IF v_code IS NOT NULL THEN RETURN jsonb_build_object('code', v_code); END IF;
  END IF;
  LOOP
    v_code := left(translate(encode(decode(md5(gen_random_uuid()::text), 'hex'), 'base64'), '+/=', 'xxx'), 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM concord.invites WHERE code = v_code);
  END LOOP;
  INSERT INTO concord.invites (code, server_id, channel_id, inviter_id, uses, max_uses, expires_at, created_at)
  VALUES (v_code, sid, nullif(d ->> 'channel_id', ''), uid, 0, v_max,
          CASE WHEN v_age > 0 THEN concord.agora() + v_age * 1000::bigint ELSE 0 END, concord.agora());
  RETURN jsonb_build_object('code', v_code);
END $$;

CREATE OR REPLACE FUNCTION concord.valid_invite(p_code text) RETURNS concord.invites
LANGUAGE plpgsql AS $$
DECLARE i concord.invites;
BEGIN
  SELECT * INTO i FROM concord.invites WHERE code = left(coalesce(p_code, ''), 32);
  PERFORM concord.need(FOUND, 'Convite inválido ou expirado.');
  IF (i.expires_at <> 0 AND i.expires_at < concord.agora()) OR (i.max_uses <> 0 AND i.uses >= i.max_uses) THEN
    DELETE FROM concord.invites WHERE code = i.code;
    -- O erro abaixo desfaria o DELETE junto; o convite vencido é limpo de novo
    -- na próxima tentativa válida (fica só ocupando uma linha).
    PERFORM concord.fail('Convite inválido ou expirado.');
  END IF;
  RETURN i;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_invite_info(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE i concord.invites := concord.valid_invite(d ->> 'code'); s concord.servers;
BEGIN
  SELECT * INTO s FROM concord.servers WHERE id = i.server_id;
  RETURN jsonb_build_object('invite', jsonb_build_object(
    'code', i.code, 'inviter', concord.user_pub(i.inviter_id),
    'server', jsonb_build_object('id', s.id, 'name', s.name, 'icon', s.icon,
      'member_count', (SELECT count(*) FROM concord.members WHERE server_id = s.id),
      'online_count', (SELECT count(*) FROM concord.members WHERE server_id = s.id AND concord.online(user_id))),
    'joined', concord.is_member(s.id, uid)));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_invite_accept(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE i concord.invites := concord.valid_invite(d ->> 'code'); v_view jsonb;
BEGIN
  IF concord.is_member(i.server_id, uid) THEN RETURN jsonb_build_object('server_id', i.server_id); END IF;
  PERFORM concord.need(NOT EXISTS (SELECT 1 FROM concord.bans WHERE server_id = i.server_id AND user_id = uid), 'Você está banido deste servidor.');
  UPDATE concord.invites SET uses = uses + 1 WHERE code = i.code;
  PERFORM concord.add_member(i.server_id, uid);
  v_view := concord.server_view(i.server_id, uid);
  PERFORM concord.emit_user(uid, 'server:add', jsonb_build_object('server', v_view,
    'users', concord.users_map(ARRAY(SELECT user_id FROM concord.members WHERE server_id = i.server_id))));
  RETURN jsonb_build_object('server_id', i.server_id, 'channel_id', i.channel_id);
END $$;

-- Pedidos de entrada são de visitantes — no ERP não existem.
CREATE OR REPLACE FUNCTION concord.ev_join_list(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.servers WHERE id = d ->> 'server_id')
                       AND concord.base_perms(d ->> 'server_id', uid) & 2097152 <> 0);
  RETURN jsonb_build_object('requests', '[]'::jsonb, 'users', '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_join_decide(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.need(concord.base_perms(d ->> 'server_id', uid) & 2097152 <> 0);
  PERFORM concord.fail('Esse pedido não existe mais.');
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_invite_list(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id';
BEGIN
  PERFORM concord.require_perm(sid, uid, 2097152);
  RETURN jsonb_build_object(
    'invites', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at DESC) FROM concord.invites i WHERE i.server_id = sid), '[]'::jsonb),
    'users', concord.users_map(ARRAY(SELECT inviter_id FROM concord.invites WHERE server_id = sid)));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_invite_delete(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE i concord.invites;
BEGIN
  SELECT * INTO i FROM concord.invites WHERE code = d ->> 'code';
  PERFORM concord.need(FOUND, 'Convite não encontrado.');
  PERFORM concord.need(i.inviter_id = uid OR concord.base_perms(i.server_id, uid) & 2097152 <> 0);
  DELETE FROM concord.invites WHERE code = i.code;
  RETURN NULL;
END $$;

-- ── Membros ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.ev_member_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  sid text := d ->> 'server_id'; tid text := d ->> 'user_id'; v_owner text; perms int; my_top int;
  v_next text[]; v_cur text[]; rid text; r concord.roles; add_roles text[] := '{}'; del_roles text[] := '{}';
  t concord.members; mudou_perm boolean := false; mudou_voz boolean := false;
BEGIN
  SELECT owner_id INTO v_owner FROM concord.servers WHERE id = sid;
  PERFORM concord.need(v_owner IS NOT NULL AND (concord.is_member(sid, uid) OR v_owner = uid), 'Servidor não encontrado.');
  SELECT * INTO t FROM concord.members WHERE server_id = sid AND user_id = tid;
  PERFORM concord.need(FOUND, 'Membro não encontrado.');
  perms := concord.base_perms(sid, uid);
  IF d ? 'nick' THEN
    IF tid = uid THEN PERFORM concord.need(perms & (16384 | 32768) <> 0, 'Você não pode alterar seu apelido.');
    ELSE PERFORM concord.need(perms & 32768 <> 0 AND concord.outranks(sid, uid, tid)); END IF;
    t.nick := nullif(btrim(concord.s(d, 'nick', 32)), '');
  END IF;
  IF d ? 'roles' THEN
    PERFORM concord.need(perms & 1048576 <> 0);
    PERFORM concord.need(jsonb_typeof(d -> 'roles') = 'array', 'Cargos inválidos.');
    v_next := ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(d -> 'roles') x WHERE x <> sid);
    v_cur := ARRAY(SELECT role_id FROM concord.member_roles WHERE server_id = sid AND user_id = tid);
    my_top := concord.top_position(sid, uid);
    FOR rid IN SELECT DISTINCT x FROM unnest(v_cur || v_next) x LOOP
      CONTINUE WHEN (rid = ANY (v_cur)) = (rid = ANY (v_next));
      SELECT * INTO r FROM concord.roles WHERE id = rid AND server_id = sid;
      PERFORM concord.need(FOUND, 'Cargo inválido.');
      PERFORM concord.need(r.position < my_top, format('Você não pode gerenciar o cargo "%s".', r.name));
      IF rid = ANY (v_next) THEN add_roles := add_roles || rid; ELSE del_roles := del_roles || rid; END IF;
    END LOOP;
    mudou_perm := cardinality(add_roles) > 0 OR cardinality(del_roles) > 0;
  END IF;
  IF d ? 'server_mute' THEN PERFORM concord.need(perms & 1024 <> 0); t.server_mute := concord.b(d, 'server_mute'); mudou_voz := true; END IF;
  IF d ? 'server_deaf' THEN PERFORM concord.need(perms & 2048 <> 0); t.server_deaf := concord.b(d, 'server_deaf'); mudou_voz := true; END IF;
  IF d ? 'timeout' THEN
    PERFORM concord.need(perms & 262144 <> 0 AND tid <> uid AND concord.outranks(sid, uid, tid));
    t.timeout_until := CASE WHEN greatest(0, least(28 * 86400, trunc(concord.n(d, 'timeout')))) > 0
      THEN concord.agora() + greatest(0, least(28 * 86400, trunc(concord.n(d, 'timeout'))))::bigint * 1000 ELSE 0 END;
    mudou_perm := true;
  END IF;
  UPDATE concord.members SET nick = t.nick, server_mute = t.server_mute, server_deaf = t.server_deaf, timeout_until = t.timeout_until
   WHERE server_id = sid AND user_id = tid;
  INSERT INTO concord.member_roles (server_id, user_id, role_id) SELECT sid, tid, x FROM unnest(add_roles) x ON CONFLICT DO NOTHING;
  DELETE FROM concord.member_roles WHERE server_id = sid AND user_id = tid AND role_id = ANY (del_roles);
  PERFORM concord.emit_server(sid, 'member:update', jsonb_build_object('server_id', sid, 'member', concord.member_out(sid, tid)));
  IF mudou_perm THEN PERFORM concord.sync_server(sid, tid); END IF;
  IF mudou_perm OR mudou_voz THEN PERFORM concord.refresh_voice_member(sid, tid); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_member_kick(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; tid text := d ->> 'user_id';
BEGIN
  PERFORM concord.require_perm(sid, uid, 65536);
  PERFORM concord.need(concord.is_member(sid, tid), 'Membro não encontrado.');
  PERFORM concord.need(tid <> uid AND concord.outranks(sid, uid, tid), 'Você não pode expulsar esse membro.');
  PERFORM concord.remove_member(sid, tid, 'kick');
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_member_ban(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; tid text := d ->> 'user_id'; r record;
BEGIN
  PERFORM concord.require_perm(sid, uid, 131072);
  PERFORM concord.need(concord.is_id(tid) AND tid <> uid, 'Usuário inválido.');
  IF concord.is_member(sid, tid) THEN PERFORM concord.need(concord.outranks(sid, uid, tid), 'Você não pode banir esse membro.'); END IF;
  INSERT INTO concord.bans (server_id, user_id, reason, mod_id, created_at)
  VALUES (sid, tid, nullif(concord.s(d, 'reason', 512), ''), uid, concord.agora())
  ON CONFLICT (server_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, mod_id = EXCLUDED.mod_id, created_at = EXCLUDED.created_at;
  IF concord.b(d, 'delete_messages') THEN
    FOR r IN WITH apagadas AS (
               DELETE FROM concord.messages
                WHERE channel_id IN (SELECT id FROM concord.channels WHERE server_id = sid)
                  AND author_id = tid AND created_at > concord.agora() - 7 * 86400000
               RETURNING id, channel_id)
             SELECT channel_id, jsonb_agg(id) AS ids FROM apagadas GROUP BY channel_id LOOP
      PERFORM concord.emit_channel(r.channel_id, 'message:bulk_delete', jsonb_build_object('channel_id', r.channel_id, 'ids', r.ids));
    END LOOP;
  END IF;
  IF concord.is_member(sid, tid) THEN PERFORM concord.remove_member(sid, tid, 'ban'); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_ban_list(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id';
BEGIN
  PERFORM concord.require_perm(sid, uid, 131072);
  RETURN jsonb_build_object(
    'bans', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC) FROM concord.bans b WHERE b.server_id = sid), '[]'::jsonb),
    'users', concord.users_map(ARRAY(SELECT user_id FROM concord.bans WHERE server_id = sid
                                     UNION SELECT mod_id FROM concord.bans WHERE server_id = sid)));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_ban_remove(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.require_perm(d ->> 'server_id', uid, 131072);
  DELETE FROM concord.bans WHERE server_id = d ->> 'server_id' AND user_id = d ->> 'user_id';
  RETURN NULL;
END $$;

-- ── Cargos ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.renumber_roles(p_sid text) RETURNS void
LANGUAGE sql AS $$
  UPDATE concord.roles r SET position = v.p
    FROM (SELECT id, row_number() OVER (ORDER BY position, id)::int AS p FROM concord.roles
           WHERE server_id = p_sid AND id <> p_sid) v
   WHERE r.id = v.id
$$;

CREATE OR REPLACE FUNCTION concord.ev_role_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; rid text := concord.novo_id();
BEGIN
  PERFORM concord.require_perm(sid, uid, 1048576);
  PERFORM concord.need((SELECT count(*) FROM concord.roles WHERE server_id = sid) < 100, 'Limite de cargos atingido.');
  INSERT INTO concord.roles (id, server_id, name, perms, position) VALUES (rid, sid, 'novo cargo', 0, 0);
  PERFORM concord.renumber_roles(sid);
  PERFORM concord.sync_server(sid);
  RETURN jsonb_build_object('role_id', rid);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_role_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r concord.roles; mine int; v text; v_perms int; mudou boolean := false; mudou_perms boolean := false;
BEGIN
  SELECT * INTO r FROM concord.roles WHERE id = d ->> 'role_id';
  PERFORM concord.need(FOUND, 'Cargo não encontrado.');
  mine := concord.base_perms(r.server_id, uid);
  PERFORM concord.need(mine & 1048576 <> 0);
  PERFORM concord.need(r.id = r.server_id OR r.position < concord.top_position(r.server_id, uid), 'Esse cargo está acima do seu cargo mais alto.');
  IF d ? 'name' AND r.id <> r.server_id THEN
    v := btrim(concord.s(d, 'name', 100));
    PERFORM concord.need(length(v) >= 1, 'Nome inválido.');
    r.name := v; mudou := true;
  END IF;
  IF d ? 'color' THEN
    v := CASE WHEN jsonb_typeof(d -> 'color') = 'null' THEN NULL ELSE d ->> 'color' END;
    PERFORM concord.need(v IS NULL OR v ~* '^#[0-9a-f]{6}$', 'Cor inválida.');
    r.color := v; mudou := true;
  END IF;
  IF d ? 'hoist' THEN r.hoist := concord.b(d, 'hoist'); mudou := true; END IF;
  IF d ? 'mentionable' THEN r.mentionable := concord.b(d, 'mentionable'); mudou := true; END IF;
  IF d ? 'perms' THEN
    v_perms := (trunc(concord.n(d, 'perms'))::bigint & 8388607)::int;
    IF mine <> 8388607 THEN
      PERFORM concord.need(((v_perms # r.perms) & ~mine) = 0, 'Você não pode conceder permissões que não possui.');
    END IF;
    r.perms := v_perms; mudou := true; mudou_perms := true;
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  UPDATE concord.roles SET name = r.name, color = r.color, hoist = r.hoist, mentionable = r.mentionable, perms = r.perms WHERE id = r.id;
  PERFORM concord.sync_server(r.server_id);
  IF mudou_perms THEN PERFORM concord.refresh_voice_server(r.server_id); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_role_delete(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r concord.roles;
BEGIN
  SELECT * INTO r FROM concord.roles WHERE id = d ->> 'role_id';
  PERFORM concord.need(FOUND AND r.id <> r.server_id, 'Esse cargo não pode ser excluído.');
  PERFORM concord.require_perm(r.server_id, uid, 1048576);
  PERFORM concord.need(r.position < concord.top_position(r.server_id, uid), 'Esse cargo está acima do seu cargo mais alto.');
  DELETE FROM concord.overwrites WHERE target_id = r.id AND type = 'role';
  DELETE FROM concord.roles WHERE id = r.id; -- member_roles em cascata
  PERFORM concord.renumber_roles(r.server_id);
  PERFORM concord.sync_server(r.server_id);
  PERFORM concord.refresh_voice_server(r.server_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_role_reorder(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; v_ids text[]; n int; my_top int; r concord.roles; np int;
BEGIN
  PERFORM concord.require_perm(sid, uid, 1048576);
  PERFORM concord.need(jsonb_typeof(d -> 'ids') = 'array', 'Ordem inválida.');
  v_ids := ARRAY(SELECT x FROM jsonb_array_elements_text(d -> 'ids') x);
  n := coalesce(array_length(v_ids, 1), 0);
  PERFORM concord.need(n = (SELECT count(*) FROM concord.roles WHERE server_id = sid AND id <> sid)
    AND NOT EXISTS (SELECT 1 FROM concord.roles WHERE server_id = sid AND id <> sid AND NOT id = ANY (v_ids)), 'Ordem inválida.');
  my_top := concord.top_position(sid, uid);
  FOR r IN SELECT * FROM concord.roles WHERE server_id = sid AND id <> sid LOOP
    np := n - array_position(v_ids, r.id) + 1;
    IF r.position >= my_top THEN PERFORM concord.need(np = r.position, 'Você só pode reordenar cargos abaixo do seu.');
    ELSE PERFORM concord.need(np < my_top, 'Você não pode mover um cargo acima do seu.'); END IF;
  END LOOP;
  UPDATE concord.roles x SET position = n - v.i + 1
    FROM unnest(v_ids) WITH ORDINALITY v(id, i) WHERE x.id = v.id AND x.server_id = sid;
  PERFORM concord.sync_server(sid);
  RETURN NULL;
END $$;

-- ── Canais ───────────────────────────────────────────────────────────────
-- O nome fica exatamente como a pessoa digitou (maiúsculas, espaços, acentos, emojis)
CREATE OR REPLACE FUNCTION concord.channel_name(v text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE x text := btrim(regexp_replace(left(coalesce(v, ''), 100), '[\u0001-\u001f\u007f]', '', 'g'));
BEGIN
  PERFORM concord.need(length(x) >= 1, 'Nome de canal inválido.');
  RETURN x;
END $$;

-- Aparência: ícone (classe Font Awesome, emoji ou "none")
CREATE OR REPLACE FUNCTION concord.channel_icon(p jsonb) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text := CASE WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN NULL ELSE left(p #>> '{}', 48) END;
BEGIN
  IF v IS NULL OR v = '' OR v = 'default' THEN RETURN NULL; END IF;
  IF v = 'none' THEN RETURN 'none'; END IF;
  IF v ~ '^fa-[a-z0-9-]{2,40}$' THEN RETURN v; END IF;
  -- Emoji: começa fora do ASCII e tem até 8 caracteres
  PERFORM concord.need(ascii(v) > 255 AND char_length(v) <= 8, 'Ícone inválido.');
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_channel_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  sid text := d ->> 'server_id'; v_type text := d ->> 'type'; v_parent text := nullif(d ->> 'parent_id', '');
  v_id text := concord.novo_id(); v_pos int; v_name text;
BEGIN
  PERFORM concord.require_perm(sid, uid, 524288);
  PERFORM concord.need(v_type IN ('text', 'voice', 'category'), 'Tipo inválido.');
  IF v_type = 'category' THEN v_parent := NULL; END IF;
  IF v_parent IS NOT NULL THEN
    PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_parent AND server_id = sid AND type = 'category'), 'Categoria inválida.');
  END IF;
  PERFORM concord.need((SELECT count(*) FROM concord.channels WHERE server_id = sid) < 500, 'Limite de canais atingido.');
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM concord.channels WHERE server_id = sid AND parent_id IS NOT DISTINCT FROM v_parent;
  v_name := concord.channel_name(d ->> 'name');
  INSERT INTO concord.channels (id, server_id, parent_id, type, name, position, created_at)
  VALUES (v_id, sid, v_parent, v_type, v_name, v_pos, concord.agora());
  IF concord.b(d, 'private') THEN
    INSERT INTO concord.overwrites (channel_id, target_id, type, allow, deny) VALUES
      (v_id, sid, 'role', 0, 1 | 128),
      (v_id, uid, 'member', 1 | 128, 0);
  END IF;
  PERFORM concord.sync_server(sid);
  RETURN jsonb_build_object('channel_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_channel_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c concord.channels; v text; mudou boolean := false;
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = d ->> 'channel_id';
  PERFORM concord.need(FOUND AND c.server_id IS NOT NULL, 'Canal não encontrado.');
  PERFORM concord.need(concord.channel_perms(c.id, uid) & 524288 <> 0 OR concord.base_perms(c.server_id, uid) & 524288 <> 0);
  IF d ? 'name' THEN c.name := concord.channel_name(d ->> 'name'); mudou := true; END IF;
  IF d ? 'icon' AND c.type <> 'category' THEN c.icon := concord.channel_icon(d -> 'icon'); mudou := true; END IF;
  IF d ? 'name_font' THEN
    v := CASE WHEN jsonb_typeof(d -> 'name_font') = 'null' THEN NULL ELSE d ->> 'name_font' END;
    PERFORM concord.need(v IS NULL OR v IN ('default', 'mono', 'serif', 'hand', 'pixel', 'future', 'bold'), 'Fonte inválida.');
    c.name_font := nullif(v, 'default'); mudou := true;
  END IF;
  IF d ? 'name_size' THEN
    c.name_size := CASE WHEN jsonb_typeof(d -> 'name_size') = 'null' THEN NULL
      ELSE greatest(11, least(24, coalesce(nullif(round(concord.n(d, 'name_size')), 0), 15))) END;
    mudou := true;
  END IF;
  IF d ? 'topic' THEN c.topic := nullif(btrim(concord.s(d, 'topic', 1024)), ''); mudou := true; END IF;
  IF d ? 'slowmode' THEN c.slowmode := greatest(0, least(21600, trunc(concord.n(d, 'slowmode')))); mudou := true; END IF;
  IF d ? 'user_limit' THEN c.user_limit := greatest(0, least(99, trunc(concord.n(d, 'user_limit')))); mudou := true; END IF;
  IF d ? 'parent_id' AND c.type <> 'category' THEN
    v := nullif(d ->> 'parent_id', '');
    IF v IS NOT NULL THEN
      PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v AND server_id = c.server_id AND type = 'category'), 'Categoria inválida.');
    END IF;
    c.parent_id := v; mudou := true;
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  UPDATE concord.channels SET name = c.name, icon = c.icon, name_font = c.name_font, name_size = c.name_size, topic = c.topic,
         slowmode = c.slowmode, user_limit = c.user_limit, parent_id = c.parent_id
   WHERE id = c.id;
  PERFORM concord.sync_server(c.server_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_channel_delete(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c concord.channels; r text;
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = d ->> 'channel_id';
  PERFORM concord.need(FOUND AND c.server_id IS NOT NULL, 'Canal não encontrado.');
  PERFORM concord.require_perm(c.server_id, uid, 524288);
  FOR r IN SELECT user_id FROM concord.voice_states WHERE channel_id = c.id LOOP
    PERFORM concord.leave_voice(r, 'O canal de voz foi excluído.');
  END LOOP;
  IF c.type = 'category' THEN UPDATE concord.channels SET parent_id = NULL WHERE parent_id = c.id; END IF;
  UPDATE concord.servers SET system_channel_id = NULL WHERE id = c.server_id AND system_channel_id = c.id;
  DELETE FROM concord.channels WHERE id = c.id;
  PERFORM concord.sync_server(c.server_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_channel_reorder(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE sid text := d ->> 'server_id'; it jsonb; c concord.channels; v_parent text;
BEGIN
  PERFORM concord.require_perm(sid, uid, 524288);
  PERFORM concord.need(jsonb_typeof(d -> 'items') = 'array' AND jsonb_array_length(d -> 'items') <= 500, 'Ordem inválida.');
  FOR it IN SELECT x FROM jsonb_array_elements(d -> 'items') x LOOP
    SELECT * INTO c FROM concord.channels WHERE id = it ->> 'id';
    PERFORM concord.need(FOUND AND c.server_id = sid, 'Canal inválido.');
    v_parent := CASE WHEN c.type = 'category' THEN NULL ELSE nullif(it ->> 'parent_id', '') END;
    IF v_parent IS NOT NULL THEN
      PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_parent AND server_id = sid AND type = 'category'), 'Categoria inválida.');
    END IF;
    UPDATE concord.channels SET parent_id = v_parent, position = trunc(concord.n(it, 'position')) WHERE id = c.id;
  END LOOP;
  PERFORM concord.sync_server(sid);
  PERFORM concord.refresh_voice_server(sid);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_overwrite_set(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  c concord.channels; mine int; v_type text := d ->> 'type'; tid text := d ->> 'target_id';
  v_allow int; v_deny int; prev concord.overwrites; changed int;
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = d ->> 'channel_id';
  PERFORM concord.need(FOUND AND c.server_id IS NOT NULL, 'Canal não encontrado.');
  mine := concord.channel_perms(c.id, uid);
  IF mine = 0 THEN mine := concord.base_perms(c.server_id, uid); END IF;
  PERFORM concord.need(concord.base_perms(c.server_id, uid) & (1048576 | 524288) <> 0);
  PERFORM concord.need(v_type IN ('role', 'member'), 'Tipo inválido.');
  IF v_type = 'role' THEN PERFORM concord.need(EXISTS (SELECT 1 FROM concord.roles WHERE id = tid AND server_id = c.server_id), 'Cargo inválido.');
  ELSE PERFORM concord.need(concord.is_member(c.server_id, tid), 'Membro inválido.'); END IF;
  v_allow := (trunc(concord.n(d, 'allow'))::bigint & 4194303)::int;
  v_deny := (trunc(concord.n(d, 'deny'))::bigint & 4194303)::int & ~v_allow;
  SELECT * INTO prev FROM concord.overwrites WHERE channel_id = c.id AND target_id = tid;
  changed := (v_allow # coalesce(prev.allow, 0)) | (v_deny # coalesce(prev.deny, 0));
  IF mine <> 8388607 THEN PERFORM concord.need((changed & ~mine) = 0, 'Você não pode alterar permissões que não possui.'); END IF;
  IF v_allow = 0 AND v_deny = 0 THEN
    DELETE FROM concord.overwrites WHERE channel_id = c.id AND target_id = tid;
  ELSE
    INSERT INTO concord.overwrites (channel_id, target_id, type, allow, deny) VALUES (c.id, tid, v_type, v_allow, v_deny)
    ON CONFLICT (channel_id, target_id) DO UPDATE SET type = EXCLUDED.type, allow = EXCLUDED.allow, deny = EXCLUDED.deny;
  END IF;
  PERFORM concord.sync_server(c.server_id);
  PERFORM concord.refresh_voice_server(c.server_id);
  RETURN NULL;
END $$;

-- ── Mensagens ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.readable(p_ch text, p_uid text) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE v_type text; p int;
BEGIN
  SELECT type INTO v_type FROM concord.channels WHERE id = p_ch;
  PERFORM concord.need(FOUND AND v_type <> 'category', 'Canal não encontrado.');
  p := concord.channel_perms(p_ch, p_uid);
  PERFORM concord.need(p & 1 <> 0 AND p & 4 <> 0, 'Você não tem acesso a este canal.');
  RETURN p;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_messages_fetch(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  ch text := d ->> 'channel_id'; lim int := greatest(1, least(100, coalesce(nullif(trunc(concord.n(d, 'limit')), 0), 50)));
  v_ids text[]; half int;
BEGIN
  PERFORM concord.readable(ch, uid);
  IF concord.is_id(d ->> 'around') THEN
    half := lim / 2;
    v_ids := ARRAY(SELECT id FROM (SELECT id FROM concord.messages WHERE channel_id = ch AND id <= d ->> 'around' ORDER BY id DESC LIMIT half + 1) a ORDER BY id)
          || ARRAY(SELECT id FROM concord.messages WHERE channel_id = ch AND id > d ->> 'around' ORDER BY id LIMIT half);
  ELSIF concord.is_id(d ->> 'after') THEN
    v_ids := ARRAY(SELECT id FROM concord.messages WHERE channel_id = ch AND id > d ->> 'after' ORDER BY id LIMIT lim);
  ELSE
    v_ids := ARRAY(SELECT id FROM (SELECT id FROM concord.messages WHERE channel_id = ch
                    AND id < CASE WHEN concord.is_id(d ->> 'before') THEN d ->> 'before' ELSE '9999999999999999' END
                    ORDER BY id DESC LIMIT lim) a ORDER BY id);
  END IF;
  RETURN concord.with_users(concord.messages_out(v_ids));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_message_send(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  c concord.channels; p int; v_content text; v_atts jsonb; v_other text; v_last bigint; v_wait bigint;
  v_reply text := nullif(d ->> 'reply_to', ''); v_reply_author text; v_reply_ch text;
  v_mentions jsonb; v_mroles jsonb; v_every boolean; v_id text; v_msg jsonb; v_targets text[];
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = d ->> 'channel_id';
  PERFORM concord.need(FOUND AND c.type IN ('text', 'dm', 'group'), 'Canal não encontrado.');
  p := concord.channel_perms(c.id, uid);
  PERFORM concord.need(p & 1 <> 0 AND p & 2 <> 0, 'Você não tem permissão para enviar mensagens aqui.');
  v_content := regexp_replace(concord.s(d, 'content', 4000), '^\s*\n|\s+$', '', 'g');
  v_atts := concord.clean_attachments(d -> 'attachments');
  IF jsonb_array_length(v_atts) > 0 THEN PERFORM concord.need(p & 8 <> 0, 'Você não pode enviar arquivos aqui.'); END IF;
  PERFORM concord.need(btrim(v_content, E' \t\n\r') <> '' OR jsonb_array_length(v_atts) > 0, 'Mensagem vazia.');
  IF c.type = 'dm' THEN
    SELECT user_id INTO v_other FROM concord.recipients WHERE channel_id = c.id AND user_id <> uid LIMIT 1;
    PERFORM concord.need(v_other IS NULL OR NOT concord.is_blocked_either(uid, v_other),
      'Sua mensagem não pôde ser entregue. Isso geralmente acontece quando há um bloqueio entre vocês.');
  END IF;
  IF c.slowmode > 0 AND p & 64 = 0 THEN
    SELECT max(created_at) INTO v_last FROM concord.messages WHERE channel_id = c.id AND author_id = uid AND type = 'default';
    v_wait := c.slowmode * 1000::bigint - (concord.agora() - coalesce(v_last, 0));
    PERFORM concord.need(v_wait <= 0, format('Modo lento ativo. Aguarde %ss.', ceil(v_wait / 1000.0)::int));
  END IF;
  IF v_reply IS NOT NULL THEN
    SELECT channel_id, author_id INTO v_reply_ch, v_reply_author FROM concord.messages WHERE id = v_reply AND concord.is_id(v_reply);
    IF v_reply_ch IS DISTINCT FROM c.id THEN v_reply := NULL; v_reply_author := NULL; END IF;
  END IF;
  v_mentions := coalesce((SELECT jsonb_agg(x ORDER BY n) FROM (
      SELECT m[1] AS x, min(n) AS n FROM regexp_matches(v_content, '<@(\d{16})>', 'g') WITH ORDINALITY t(m, n) GROUP BY m[1]) y
     WHERE CASE WHEN c.server_id IS NOT NULL THEN concord.is_member(c.server_id, x) ELSE EXISTS (SELECT 1 FROM concord.users WHERE id = x) END
     AND n IS NOT NULL), '[]'::jsonb);
  IF jsonb_array_length(v_mentions) > 50 THEN
    v_mentions := (SELECT jsonb_agg(x) FROM (SELECT x FROM jsonb_array_elements(v_mentions) x LIMIT 50) t);
  END IF;
  v_mroles := '[]'::jsonb;
  v_every := false;
  IF c.server_id IS NOT NULL THEN
    v_mroles := coalesce((SELECT jsonb_agg(DISTINCT m[1]) FROM regexp_matches(v_content, '<@&(\d{16})>', 'g') t(m)
                            JOIN concord.roles r ON r.id = m[1] AND r.server_id = c.server_id
                           WHERE r.mentionable OR p & 32 <> 0), '[]'::jsonb);
    v_every := v_content ~ '(^|\s)@(everyone|here)\y' AND p & 32 <> 0;
  END IF;

  v_id := concord.insert_message(c.id, uid, v_content, 'default', v_reply, v_atts, v_mentions, v_mroles, v_every);
  IF c.server_id IS NULL THEN PERFORM concord.reopen_dm(c.id); END IF;
  v_msg := concord.message_out(v_id);
  PERFORM concord.emit_channel(c.id, 'message:create', jsonb_build_object('message', v_msg, 'author', concord.user_pub(uid), 'nonce', d -> 'nonce'));

  IF c.server_id IS NULL THEN
    v_targets := ARRAY(SELECT user_id FROM concord.recipients WHERE channel_id = c.id AND user_id <> uid);
  ELSE
    v_targets := ARRAY(
      SELECT x FROM (
        SELECT jsonb_array_elements_text(v_mentions) AS x
        UNION SELECT user_id FROM concord.members WHERE server_id = c.server_id AND v_every
        UNION SELECT mr.user_id FROM concord.member_roles mr WHERE mr.server_id = c.server_id
                 AND mr.role_id IN (SELECT jsonb_array_elements_text(v_mroles))
        UNION SELECT v_reply_author WHERE v_reply_author IS NOT NULL) t
      WHERE x <> uid AND concord.channel_perms(c.id, x) <> 0);
  END IF;
  PERFORM concord.mark_read(uid, c.id, v_id);
  PERFORM concord.bump_mentions(v_targets, c.id);
  RETURN jsonb_build_object('message', v_msg);
END $$;

-- Mensagem-card (contato compartilhado, convite de jogo)
CREATE OR REPLACE FUNCTION concord.send_card(p_uid text, p_ch text, p_type text, p_card jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE c concord.channels; p int; v_other text; v_id text; t text;
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = p_ch;
  PERFORM concord.need(FOUND AND c.type IN ('text', 'dm', 'group'), 'Canal não encontrado.');
  p := concord.channel_perms(c.id, p_uid);
  PERFORM concord.need(p & 1 <> 0 AND p & 2 <> 0, 'Você não pode enviar mensagens aqui.');
  IF c.type = 'dm' THEN
    SELECT user_id INTO v_other FROM concord.recipients WHERE channel_id = c.id AND user_id <> p_uid LIMIT 1;
    PERFORM concord.need(v_other IS NULL OR NOT concord.is_blocked_either(p_uid, v_other),
      'Sua mensagem não pôde ser entregue (há um bloqueio entre vocês).');
  END IF;
  v_id := concord.insert_message(c.id, p_uid, '', p_type, NULL, '[]', '[]', '[]', false, p_card);
  IF c.server_id IS NULL THEN PERFORM concord.reopen_dm(c.id); END IF;
  PERFORM concord.emit_channel(c.id, 'message:create', jsonb_build_object('message', concord.message_out(v_id), 'author', concord.user_pub(p_uid)));
  IF c.server_id IS NULL THEN
    FOR t IN SELECT user_id FROM concord.recipients WHERE channel_id = c.id AND user_id <> p_uid LOOP
      PERFORM concord.bump_mentions(ARRAY[t], c.id);
    END LOOP;
  ELSE
    PERFORM concord.bump_mentions(ARRAY(SELECT user_id FROM concord.members WHERE server_id = c.server_id AND user_id <> p_uid
                                          AND concord.channel_perms(c.id, user_id) & 1 <> 0), c.id);
  END IF;
  RETURN jsonb_build_object('message_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_contact_send(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.need(concord.is_id(d ->> 'user_id') AND EXISTS (SELECT 1 FROM concord.users WHERE id = d ->> 'user_id'), 'Contato inválido.');
  RETURN concord.send_card(uid, d ->> 'channel_id', 'contact', jsonb_build_object('kind', 'contact', 'user_id', d ->> 'user_id'));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_game_invite(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE g jsonb := d -> 'game'; v_name text; v_img text := NULL; v_app numeric;
BEGIN
  PERFORM concord.need(jsonb_typeof(g) = 'object', 'Jogo inválido.');
  v_name := btrim(concord.s(g, 'name', 80));
  PERFORM concord.need(v_name <> '', 'Escolha um jogo.');
  IF concord.s(g, 'image', 300) ~* '^https://[\w./-]*(akamai|steamstatic|steamcdn)[\w./-]+\.(jpg|png)$' THEN v_img := g ->> 'image'; END IF;
  v_app := CASE WHEN jsonb_typeof(g -> 'appid') = 'number' THEN (g ->> 'appid')::numeric END;
  IF NOT (v_app IS NOT NULL AND v_app = trunc(v_app) AND v_app > 0 AND v_app < 100000000) THEN v_app := NULL; END IF;
  RETURN concord.send_card(uid, d ->> 'channel_id', 'game', jsonb_build_object('kind', 'game',
    'game', jsonb_build_object('name', v_name, 'image', v_img, 'appid', v_app), 'responses', '{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_game_respond(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE m concord.messages;
BEGIN
  SELECT * INTO m FROM concord.messages WHERE id = d ->> 'message_id' AND concord.is_id(d ->> 'message_id');
  PERFORM concord.need(FOUND AND m.type = 'game' AND m.card IS NOT NULL, 'Convite não encontrado.');
  PERFORM concord.need(concord.channel_perms(m.channel_id, uid) & 1 <> 0, 'Sem acesso.');
  UPDATE concord.messages SET card = jsonb_set(coalesce(card, '{}'), '{responses}',
           coalesce(card -> 'responses', '{}'::jsonb) || jsonb_build_object(uid, CASE WHEN concord.b(d, 'ok') THEN 'yes' ELSE 'no' END))
   WHERE id = m.id;
  PERFORM concord.emit_channel(m.channel_id, 'message:update', jsonb_build_object('message', concord.message_out(m.id)));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_message_edit(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE m concord.messages; v_content text; v_mentions jsonb;
BEGIN
  SELECT * INTO m FROM concord.messages WHERE id = d ->> 'message_id' AND concord.is_id(d ->> 'message_id');
  PERFORM concord.need(FOUND AND m.author_id = uid AND m.type = 'default', 'Você só pode editar suas próprias mensagens.');
  PERFORM concord.need(concord.channel_perms(m.channel_id, uid) <> 0, 'Sem acesso.');
  v_content := regexp_replace(concord.s(d, 'content', 4000), '\s+$', '');
  PERFORM concord.need(btrim(v_content, E' \t\n\r') <> '' OR jsonb_array_length(m.attachments) > 0, 'A mensagem não pode ficar vazia.');
  v_mentions := coalesce((SELECT jsonb_agg(x ORDER BY n) FROM (
      SELECT m2[1] AS x, min(n) AS n FROM regexp_matches(v_content, '<@(\d{16})>', 'g') WITH ORDINALITY t(m2, n) GROUP BY m2[1]
      ORDER BY 2 LIMIT 50) y), '[]'::jsonb);
  UPDATE concord.messages SET content = v_content, mentions = v_mentions, edited_at = concord.agora() WHERE id = m.id;
  PERFORM concord.emit_channel(m.channel_id, 'message:update', jsonb_build_object('message', concord.message_out(m.id)));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_message_delete(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE m concord.messages; v_srv text; p int;
BEGIN
  SELECT * INTO m FROM concord.messages WHERE id = d ->> 'message_id' AND concord.is_id(d ->> 'message_id');
  PERFORM concord.need(FOUND, 'Mensagem não encontrada.');
  SELECT server_id INTO v_srv FROM concord.channels WHERE id = m.channel_id;
  p := concord.channel_perms(m.channel_id, uid);
  PERFORM concord.need(p <> 0 AND (m.author_id = uid OR (v_srv IS NOT NULL AND p & 64 <> 0)), 'Você não pode excluir essa mensagem.');
  DELETE FROM concord.messages WHERE id = m.id;
  PERFORM concord.emit_channel(m.channel_id, 'message:delete', jsonb_build_object('channel_id', m.channel_id, 'id', m.id));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_message_pin(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE m concord.messages; v_srv text; p int; v_pin boolean := concord.b(d, 'pinned');
BEGIN
  SELECT * INTO m FROM concord.messages WHERE id = d ->> 'message_id' AND concord.is_id(d ->> 'message_id');
  PERFORM concord.need(FOUND, 'Mensagem não encontrada.');
  SELECT server_id INTO v_srv FROM concord.channels WHERE id = m.channel_id;
  p := concord.channel_perms(m.channel_id, uid);
  PERFORM concord.need(p <> 0 AND (v_srv IS NULL OR p & 64 <> 0), 'Você não pode fixar mensagens aqui.');
  IF v_pin THEN
    PERFORM concord.need((SELECT count(*) FROM concord.messages WHERE channel_id = m.channel_id AND pinned) < 50, 'Limite de 50 mensagens fixadas.');
  END IF;
  UPDATE concord.messages SET pinned = v_pin WHERE id = m.id;
  PERFORM concord.emit_channel(m.channel_id, 'message:update', jsonb_build_object('message', concord.message_out(m.id)));
  IF v_pin THEN PERFORM concord.system_message(m.channel_id, uid, 'pin', format('<@%s> fixou uma mensagem neste canal.', uid)); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_pins_fetch(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM concord.readable(d ->> 'channel_id', uid);
  RETURN concord.with_users(concord.messages_out(ARRAY(
    SELECT id FROM concord.messages WHERE channel_id = d ->> 'channel_id' AND pinned ORDER BY id DESC)));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_messages_search(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE q text := btrim(concord.s(d, 'query', 200)); v_chs text[]; sid text := nullif(d ->> 'server_id', '');
BEGIN
  PERFORM concord.need(length(q) >= 1, 'Digite algo para buscar.');
  IF sid IS NOT NULL THEN
    PERFORM concord.need(concord.is_member(sid, uid), 'Servidor não encontrado.');
    v_chs := ARRAY(SELECT id FROM concord.channels WHERE server_id = sid AND type = 'text' AND concord.channel_perms(id, uid) & 4 <> 0);
  ELSE
    PERFORM concord.readable(d ->> 'channel_id', uid);
    v_chs := ARRAY[d ->> 'channel_id'];
  END IF;
  RETURN concord.with_users(concord.messages_out(ARRAY(
    SELECT id FROM concord.messages
     WHERE channel_id = ANY (v_chs) AND type = 'default'
       AND content ILIKE '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
     ORDER BY id DESC LIMIT 50)));
END $$;

CREATE OR REPLACE FUNCTION concord.ev_reaction_toggle(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_emoji text := btrim(concord.s(d, 'emoji', 32)); m concord.messages; p int; v_add boolean; n int; tem boolean;
BEGIN
  PERFORM concord.need(v_emoji <> '' AND v_emoji !~ '\s', 'Emoji inválido.');
  SELECT * INTO m FROM concord.messages WHERE id = d ->> 'message_id' AND concord.is_id(d ->> 'message_id');
  PERFORM concord.need(FOUND, 'Mensagem não encontrada.');
  p := concord.channel_perms(m.channel_id, uid);
  PERFORM concord.need(p & 4 <> 0, 'Sem acesso.');
  DELETE FROM concord.reactions WHERE message_id = m.id AND user_id = uid AND emoji = v_emoji;
  v_add := NOT FOUND;
  IF v_add THEN
    PERFORM concord.need(p & 16 <> 0, 'Você não pode reagir aqui.');
    SELECT count(DISTINCT emoji), coalesce(bool_or(emoji = v_emoji), false) INTO n, tem FROM concord.reactions WHERE message_id = m.id;
    PERFORM concord.need(n < 20 OR tem, 'Limite de reações atingido.');
    INSERT INTO concord.reactions (message_id, user_id, emoji, created_at) VALUES (m.id, uid, v_emoji, concord.agora()) ON CONFLICT DO NOTHING;
  END IF;
  PERFORM concord.emit_channel(m.channel_id, 'reaction', jsonb_build_object('channel_id', m.channel_id, 'message_id', m.id,
    'emoji', v_emoji, 'user_id', uid, 'add', v_add));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_typing(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF concord.channel_perms(d ->> 'channel_id', uid) & 2 = 0 THEN RETURN NULL; END IF;
  PERFORM concord.emit_channel(d ->> 'channel_id', 'typing', jsonb_build_object('channel_id', d ->> 'channel_id', 'user_id', uid), uid);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_channel_ack(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT concord.is_id(d ->> 'channel_id') OR NOT concord.is_id(d ->> 'message_id') THEN RETURN NULL; END IF;
  IF concord.channel_perms(d ->> 'channel_id', uid) = 0 THEN RETURN NULL; END IF;
  PERFORM concord.mark_read(uid, d ->> 'channel_id', d ->> 'message_id');
  PERFORM concord.emit_user_except(uid, cx, 'read', jsonb_build_object('channel_id', d ->> 'channel_id', 'last_read', d ->> 'message_id'));
  RETURN NULL;
END $$;

-- ── DMs e grupos ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.ev_dm_open(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE tid text := d ->> 'user_id'; v_ch text; v_closed boolean;
BEGIN
  PERFORM concord.need(concord.is_id(tid) AND tid <> uid AND EXISTS (SELECT 1 FROM concord.users WHERE id = tid), 'Usuário inválido.');
  SELECT c.id, r1.closed INTO v_ch, v_closed FROM concord.channels c
    JOIN concord.recipients r1 ON r1.channel_id = c.id AND r1.user_id = uid
    JOIN concord.recipients r2 ON r2.channel_id = c.id AND r2.user_id = tid
   WHERE c.type = 'dm' LIMIT 1;
  IF v_ch IS NULL THEN
    v_ch := concord.novo_id();
    INSERT INTO concord.channels (id, type, created_at) VALUES (v_ch, 'dm', concord.agora());
    INSERT INTO concord.recipients (channel_id, user_id, closed) VALUES (v_ch, uid, false), (v_ch, tid, true);
  ELSIF v_closed THEN
    UPDATE concord.recipients SET closed = false WHERE channel_id = v_ch AND user_id = uid;
  END IF;
  PERFORM concord.emit_user(uid, 'dm:create', jsonb_build_object('channel', concord.dm_view(v_ch), 'users', concord.dm_users(v_ch)));
  RETURN jsonb_build_object('channel_id', v_ch);
END $$;

CREATE OR REPLACE FUNCTION concord.ev_dm_close(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ch text := d ->> 'channel_id';
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_ch AND type = 'dm') AND concord.channel_perms(v_ch, uid) <> 0,
                       'Conversa não encontrada.');
  UPDATE concord.recipients SET closed = true WHERE channel_id = v_ch AND user_id = uid;
  PERFORM concord.emit_user(uid, 'dm:remove', jsonb_build_object('id', v_ch));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_group_create(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ids text[]; x text; v_ch text := concord.novo_id(); v_view jsonb; v_users jsonb;
BEGIN
  PERFORM concord.need(jsonb_typeof(d -> 'user_ids') = 'array' AND jsonb_array_length(d -> 'user_ids') BETWEEN 1 AND 9, 'Selecione de 1 a 9 amigos.');
  v_ids := ARRAY(SELECT DISTINCT y FROM jsonb_array_elements_text(d -> 'user_ids') y WHERE y <> uid);
  FOREACH x IN ARRAY v_ids LOOP
    PERFORM concord.need(concord.rel_type(uid, x) = 1, 'Você só pode adicionar amigos ao grupo.');
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
  PERFORM concord.need(concord.rel_type(uid, tid) = 1, 'Você só pode adicionar amigos.');
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

CREATE OR REPLACE FUNCTION concord.ev_group_remove(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ch text := d ->> 'channel_id'; tid text := coalesce(nullif(d ->> 'user_id', ''), uid); v_owner text; v_rest text; v_view jsonb; r text;
BEGIN
  SELECT owner_id INTO v_owner FROM concord.channels WHERE id = v_ch AND type = 'group';
  PERFORM concord.need(FOUND AND concord.channel_perms(v_ch, uid) <> 0, 'Grupo não encontrado.');
  IF tid <> uid THEN PERFORM concord.need(v_owner = uid, 'Somente o dono do grupo pode remover membros.'); END IF;
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.recipients WHERE channel_id = v_ch AND user_id = tid), 'Não está no grupo.');
  IF EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = tid AND channel_id = v_ch) THEN
    PERFORM concord.leave_voice(tid, 'Você saiu do grupo.');
  END IF;
  DELETE FROM concord.recipients WHERE channel_id = v_ch AND user_id = tid;
  PERFORM concord.emit_user(tid, 'dm:remove', jsonb_build_object('id', v_ch));
  SELECT min(user_id) INTO v_rest FROM concord.recipients WHERE channel_id = v_ch;
  IF v_rest IS NULL THEN DELETE FROM concord.channels WHERE id = v_ch; RETURN NULL; END IF;
  IF v_owner = tid THEN UPDATE concord.channels SET owner_id = v_rest WHERE id = v_ch; END IF;
  v_view := concord.dm_view(v_ch);
  FOR r IN SELECT user_id FROM concord.recipients WHERE channel_id = v_ch LOOP
    PERFORM concord.emit_user(r, 'dm:update', jsonb_build_object('channel', v_view, 'users', '{}'::jsonb));
  END LOOP;
  PERFORM concord.system_message(v_ch, tid, 'group_remove',
    CASE WHEN tid = uid THEN format('<@%s> saiu do grupo.', uid) ELSE format('<@%s> removeu <@%s> do grupo.', uid, tid) END);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_group_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ch text := d ->> 'channel_id'; v text; mudou boolean := false; v_view jsonb; r text;
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_ch AND type = 'group') AND concord.channel_perms(v_ch, uid) <> 0,
                       'Grupo não encontrado.');
  IF d ? 'name' THEN
    UPDATE concord.channels SET name = nullif(btrim(concord.s(d, 'name', 100)), '') WHERE id = v_ch; mudou := true;
  END IF;
  IF d ? 'icon' THEN
    v := CASE WHEN jsonb_typeof(d -> 'icon') = 'null' THEN NULL ELSE d ->> 'icon' END;
    PERFORM concord.need(v IS NULL OR concord.is_image_url(v), 'Ícone inválido.');
    UPDATE concord.channels SET icon = v WHERE id = v_ch; mudou := true;
  END IF;
  IF NOT mudou THEN RETURN NULL; END IF;
  v_view := concord.dm_view(v_ch);
  FOR r IN SELECT user_id FROM concord.recipients WHERE channel_id = v_ch LOOP
    PERFORM concord.emit_user(r, 'dm:update', jsonb_build_object('channel', v_view, 'users', '{}'::jsonb));
  END LOOP;
  IF d ? 'name' THEN
    PERFORM concord.system_message(v_ch, uid, 'group_name', format('<@%s> alterou o nome do grupo para **%s**.', uid,
      replace(coalesce(nullif(btrim(concord.s(d, 'name', 100)), ''), 'padrão'), '*', '')));
  END IF;
  RETURN NULL;
END $$;

-- ── Voz / chamadas ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION concord.ev_voice_join(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  c concord.channels; p int; v_present text[]; v_other text; prev concord.voice_states; m concord.members; s concord.voice_states; r text;
BEGIN
  SELECT * INTO c FROM concord.channels WHERE id = d ->> 'channel_id';
  PERFORM concord.need(FOUND AND c.type IN ('voice', 'dm', 'group'), 'Canal de voz não encontrado.');
  p := concord.channel_perms(c.id, uid);
  PERFORM concord.need(p & 128 <> 0, 'Você não tem permissão para conectar neste canal.');
  v_present := ARRAY(SELECT user_id FROM concord.voice_states WHERE channel_id = c.id AND user_id <> uid ORDER BY joined_at);
  IF c.user_limit > 0 AND p & 4096 = 0 THEN
    PERFORM concord.need(coalesce(array_length(v_present, 1), 0) < c.user_limit, 'Esse canal de voz está cheio.');
  END IF;
  IF c.type = 'dm' THEN
    SELECT user_id INTO v_other FROM concord.recipients WHERE channel_id = c.id AND user_id <> uid LIMIT 1;
    PERFORM concord.need(v_other IS NULL OR NOT concord.is_blocked_either(uid, v_other), 'Não é possível ligar para esse usuário.');
  END IF;
  SELECT * INTO prev FROM concord.voice_states WHERE user_id = uid;
  IF FOUND THEN
    IF prev.conexao <> cx THEN PERFORM concord.emit_conexao(prev.conexao, 'voice:kicked', jsonb_build_object('reason', NULL, 'moved', true)); END IF;
    PERFORM concord.leave_voice(uid, NULL);
  END IF;
  IF c.server_id IS NOT NULL THEN SELECT * INTO m FROM concord.members WHERE server_id = c.server_id AND user_id = uid; END IF;
  INSERT INTO concord.voice_states (user_id, channel_id, server_id, conexao, self_mute, self_deaf, server_mute, server_deaf, suppress, joined_at)
  VALUES (uid, c.id, c.server_id, cx, concord.b(d, 'self_mute'), concord.b(d, 'self_deaf'), coalesce(m.server_mute, false),
          coalesce(m.server_deaf, false), p & 256 = 0, concord.agora())
  RETURNING * INTO s;
  PERFORM concord.voice_broadcast(c.id, concord.voice_out(s));
  IF c.type IN ('dm', 'group') AND coalesce(array_length(v_present, 1), 0) = 0 THEN
    PERFORM concord.system_message(c.id, uid, 'call', format('<@%s> iniciou uma chamada.', uid));
    FOR r IN SELECT a FROM concord.channel_audience(c.id) a
              WHERE a <> uid AND NOT EXISTS (SELECT 1 FROM concord.voice_states v WHERE v.user_id = a AND v.channel_id = c.id) LOOP
      PERFORM concord.emit_user(r, 'call:ring', jsonb_build_object('channel_id', c.id, 'from', uid));
    END LOOP;
  END IF;
  RETURN jsonb_build_object('peers', to_jsonb(v_present), 'state', concord.voice_out(s), 'can_video', p & 512 <> 0);
END $$;

-- Sair vale de qualquer aba/conexão do usuário.
CREATE OR REPLACE FUNCTION concord.ev_voice_leave(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$ BEGIN PERFORM concord.leave_voice(uid, NULL); RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_snapshot(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE sql AS $$ SELECT jsonb_build_object('voice', concord.visible_voice_states(uid)) $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_update(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states;
BEGIN
  SELECT * INTO s FROM concord.voice_states WHERE user_id = uid;
  PERFORM concord.need(FOUND AND s.conexao = cx, 'Você não está em um canal de voz.');
  IF (concord.b(d, 'video') OR concord.b(d, 'screen')) AND concord.channel_perms(s.channel_id, uid) & 512 = 0 THEN
    PERFORM concord.fail('Você não tem permissão de vídeo neste canal.');
  END IF;
  IF d ? 'self_mute' THEN s.self_mute := concord.b(d, 'self_mute'); END IF;
  IF d ? 'self_deaf' THEN s.self_deaf := concord.b(d, 'self_deaf'); END IF;
  IF d ? 'video' THEN s.video := concord.b(d, 'video'); END IF;
  IF d ? 'screen' THEN s.screen := concord.b(d, 'screen'); END IF;
  UPDATE concord.voice_states SET self_mute = s.self_mute, self_deaf = s.self_deaf, video = s.video, screen = s.screen WHERE user_id = uid;
  PERFORM concord.voice_broadcast(s.channel_id, concord.voice_out(s));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_signal(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE eu concord.voice_states; ele concord.voice_states;
BEGIN
  SELECT * INTO eu FROM concord.voice_states WHERE user_id = uid;
  SELECT * INTO ele FROM concord.voice_states WHERE user_id = d ->> 'to';
  IF eu.user_id IS NULL OR ele.user_id IS NULL OR eu.channel_id <> ele.channel_id OR eu.conexao <> cx THEN RETURN NULL; END IF;
  PERFORM concord.emit_conexao(ele.conexao, 'voice:signal', jsonb_build_object('from', uid, 'data', d -> 'data'));
  RETURN NULL;
END $$;

-- Controle remoto: o banco só faz o handshake entre dois membros da mesma
-- call; mouse/teclado vão pelo canal de dados P2P.
CREATE OR REPLACE FUNCTION concord.ev_rc_request(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE eu concord.voice_states; ele concord.voice_states;
BEGIN
  SELECT * INTO eu FROM concord.voice_states WHERE user_id = uid;
  SELECT * INTO ele FROM concord.voice_states WHERE user_id = d ->> 'user_id';
  PERFORM concord.need(eu.user_id IS NOT NULL AND ele.user_id IS NOT NULL AND eu.channel_id = ele.channel_id AND eu.conexao = cx,
                       'Vocês não estão na mesma chamada.');
  PERFORM concord.need(ele.screen, 'Essa pessoa não está compartilhando a tela.');
  PERFORM concord.emit_conexao(ele.conexao, 'rc:request', jsonb_build_object('from', uid));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_rc_response(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE eu concord.voice_states; ele concord.voice_states;
BEGIN
  SELECT * INTO eu FROM concord.voice_states WHERE user_id = uid;
  SELECT * INTO ele FROM concord.voice_states WHERE user_id = d ->> 'user_id';
  IF eu.user_id IS NULL OR ele.user_id IS NULL OR eu.channel_id <> ele.channel_id OR eu.conexao <> cx THEN RETURN NULL; END IF;
  PERFORM concord.emit_conexao(ele.conexao, 'rc:response', jsonb_build_object('from', uid, 'ok', concord.b(d, 'ok'),
    'reason', CASE WHEN concord.b(d, 'reason') THEN d -> 'reason' END));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_rc_stop(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_cx uuid;
BEGIN
  SELECT conexao INTO v_cx FROM concord.voice_states WHERE user_id = d ->> 'user_id';
  IF v_cx IS NOT NULL THEN PERFORM concord.emit_conexao(v_cx, 'rc:stop', jsonb_build_object('from', uid)); END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_speaking(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states;
BEGIN
  SELECT * INTO s FROM concord.voice_states WHERE user_id = uid;
  IF NOT FOUND OR s.conexao <> cx THEN RETURN NULL; END IF;
  PERFORM concord.voice_broadcast(s.channel_id, jsonb_build_object('speaking_user', uid, 'channel_id', s.channel_id, 'speaking', concord.b(d, 'speaking')));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_move(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states; v_dest text := d ->> 'channel_id';
BEGIN
  SELECT * INTO s FROM concord.voice_states WHERE user_id = d ->> 'user_id';
  PERFORM concord.need(FOUND AND s.server_id IS NOT NULL, 'O usuário não está em um canal de voz.');
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_dest AND type = 'voice' AND server_id = s.server_id), 'Canal inválido.');
  PERFORM concord.need(concord.channel_perms(s.channel_id, uid) & 4096 <> 0 AND concord.channel_perms(v_dest, uid) & 4096 <> 0);
  PERFORM concord.need(concord.channel_perms(v_dest, s.user_id) & 128 <> 0, 'Esse membro não pode acessar esse canal.');
  PERFORM concord.emit_conexao(s.conexao, 'voice:moved', jsonb_build_object('channel_id', v_dest));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_voice_disconnect(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE s concord.voice_states;
BEGIN
  SELECT * INTO s FROM concord.voice_states WHERE user_id = d ->> 'user_id';
  PERFORM concord.need(FOUND AND s.server_id IS NOT NULL, 'O usuário não está em um canal de voz.');
  PERFORM concord.need(s.user_id = uid OR concord.channel_perms(s.channel_id, uid) & 4096 <> 0);
  PERFORM concord.leave_voice(s.user_id, 'Você foi desconectado do canal de voz.');
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION concord.ev_call_ring(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_ch text := d ->> 'channel_id'; r text;
BEGIN
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.channels WHERE id = v_ch AND type IN ('dm', 'group'))
                       AND concord.channel_perms(v_ch, uid) <> 0, 'Conversa não encontrada.');
  PERFORM concord.need(EXISTS (SELECT 1 FROM concord.voice_states WHERE user_id = uid AND channel_id = v_ch), 'Entre na chamada primeiro.');
  FOR r IN SELECT a FROM concord.channel_audience(v_ch) a
            WHERE a <> uid AND NOT EXISTS (SELECT 1 FROM concord.voice_states v WHERE v.user_id = a AND v.channel_id = v_ch) LOOP
    PERFORM concord.emit_user(r, 'call:ring', jsonb_build_object('channel_id', v_ch, 'from', uid));
  END LOOP;
  RETURN NULL;
END $$;

-- ── init: tudo o que o cliente precisa ao (re)conectar ───────────────────
CREATE OR REPLACE FUNCTION concord.ev_init(uid text, cx uuid, d jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_servers jsonb; v_dms jsonb; v_rels jsonb; v_reads jsonb; v_voice jsonb; v_ids text[];
BEGIN
  SELECT coalesce(jsonb_agg(concord.server_view(m.server_id, uid) ORDER BY m.joined_at), '[]'::jsonb) INTO v_servers
    FROM concord.members m WHERE m.user_id = uid;
  SELECT coalesce(jsonb_agg(concord.dm_view(r.channel_id)), '[]'::jsonb) INTO v_dms
    FROM concord.recipients r WHERE r.user_id = uid AND NOT r.closed;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', target_id, 'type', type, 'since', since)), '[]'::jsonb) INTO v_rels
    FROM concord.relationships WHERE user_id = uid;
  SELECT coalesce(jsonb_object_agg(channel_id, jsonb_build_object('last_read', last_read, 'mentions', mentions)), '{}'::jsonb) INTO v_reads
    FROM concord.read_states WHERE user_id = uid;
  v_voice := concord.visible_voice_states(uid);
  v_ids := ARRAY[uid]
    || ARRAY(SELECT DISTINCT m2.user_id FROM concord.members m1 JOIN concord.members m2 ON m2.server_id = m1.server_id WHERE m1.user_id = uid)
    || ARRAY(SELECT x FROM jsonb_array_elements(v_dms) dm, jsonb_array_elements_text(dm -> 'recipients') x)
    || ARRAY(SELECT target_id FROM concord.relationships WHERE user_id = uid)
    || ARRAY(SELECT v ->> 'user_id' FROM jsonb_array_elements(v_voice) v);
  RETURN jsonb_build_object('me', concord.me_out(uid), 'users', concord.users_map(v_ids), 'servers', v_servers, 'dms', v_dms,
                            'relationships', v_rels, 'readStates', v_reads, 'voice', v_voice);
END $$;
