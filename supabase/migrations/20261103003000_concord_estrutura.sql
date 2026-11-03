-- =========================================================================
-- Módulo CONCORD (03/11/2026) — 1/5: estrutura
--
-- PEDIDO (Pablo): replicar dentro do ERP o app de mensagens que ele criou
-- (Otamashis, estilo Discord) como o módulo "Concord". Um módulo sem
-- submódulos: clicar nele abre o Concord. O login é o do ERP (não há
-- cadastro nem senha próprios) e dá para achar qualquer usuário do sistema.
--
-- POR QUE NÃO HÁ SERVIDOR NODE (o Otamashis tinha um, com Socket.IO)
--   O ERP só tem Postgres + PostgREST + Edge Functions, e o Realtime do
--   Supabase foi desligado em 21/09/2026 por falta de conexões (ver
--   docs/plano-otimizacao-banco.md, R7: não religar). Decisão do Pablo
--   para o Concord: polling no PostgREST. Então a lógica do servidor do
--   Otamashis (server/realtime.js) virou funções no banco (migrations
--   20261103003020/003030) e o "socket" virou duas RPCs:
--     concord_call(conexao, evento, dados) — o antigo socket.emit com ack
--     concord_poll(conexao, desde)         — busca os eventos da aba
--   Cada aba aberta é uma linha em concord.conexoes; o "io.to(usuario).emit"
--   do Otamashis é um INSERT em concord.eventos para cada conexão viva do
--   destinatário. A aba apaga o que já leu no poll seguinte, então a tabela
--   fica sempre pequena. Nada disso abre conexão nova no banco: é tudo
--   requisição comum do PostgREST.
--
-- POR QUE UM SCHEMA PRÓPRIO (e não "CONCORD_*" em public)
--   Como no Otamashis, nenhuma tabela é lida pela API direto: tudo passa
--   pelas funções SECURITY DEFINER, que fazem a conta de permissão de
--   servidor/canal/cargo (23 permissões, sobrescritas por canal). Num schema
--   fora do PostgREST e sem GRANT, não existe caminho para ler mensagem de
--   canal privado por fora delas. Os nomes das tabelas seguem os do
--   Otamashis para a função portada continuar legível lado a lado com o
--   original.
--
-- ACESSO — módulo próprio, menu `concord` (deny-by-default): visualizar =
-- usar o Concord. Nasce liberado só para o Pablo; o resto se libera em
-- Administração › Acesso por Usuário.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Módulo e menu ─────────────────────────────────────────────────────
INSERT INTO public.app_modulo (codigo, nome, ordem, ativo)
VALUES ('concord', 'Concord', 7, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'concord', 'Concord', '/app/concord', 10, true
  FROM public.app_modulo m WHERE m.codigo = 'concord'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Schema e tabelas (mesmo desenho do Otamashis) ─────────────────────
CREATE SCHEMA IF NOT EXISTS concord;
REVOKE ALL ON SCHEMA concord FROM PUBLIC, anon, authenticated;

-- IDs ordenáveis (snowflake, 16 dígitos): ordem do texto = ordem no tempo.
-- O cliente compara IDs como texto (não lidas, "novas mensagens").
CREATE SEQUENCE IF NOT EXISTS concord.id_seq;

CREATE TABLE IF NOT EXISTS concord.users (
  id            text PRIMARY KEY,
  ext_id        uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  email         text,
  username      text NOT NULL,
  display_name  text,
  avatar        text,
  accent        text,
  bio           text,
  status        text NOT NULL DEFAULT 'online',
  custom_status text,
  ext_profile   jsonb,                       -- último nome/foto vindos do ERP
  extras        jsonb NOT NULL DEFAULT '{}', -- cidade, jogos, redes, privacidade, Steam/Twitch
  activity      jsonb,                       -- "Jogando X" ao vivo (some ao sair)
  last_seen     bigint,
  created_at    bigint NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS concord_users_username_key ON concord.users (lower(username));

CREATE TABLE IF NOT EXISTS concord.servers (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  icon              text,
  owner_id          text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  system_channel_id text,
  created_at        bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS concord.members (
  server_id     text NOT NULL REFERENCES concord.servers (id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  nick          text,
  joined_at     bigint NOT NULL,
  server_mute   boolean NOT NULL DEFAULT false,
  server_deaf   boolean NOT NULL DEFAULT false,
  timeout_until bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS concord_members_user_idx ON concord.members (user_id);

CREATE TABLE IF NOT EXISTS concord.roles (
  id          text PRIMARY KEY,
  server_id   text NOT NULL REFERENCES concord.servers (id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text,
  perms       integer NOT NULL DEFAULT 0,
  position    integer NOT NULL DEFAULT 0,
  hoist       boolean NOT NULL DEFAULT false,
  mentionable boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS concord_roles_server_idx ON concord.roles (server_id);

CREATE TABLE IF NOT EXISTS concord.member_roles (
  server_id text NOT NULL,
  user_id   text NOT NULL,
  role_id   text NOT NULL REFERENCES concord.roles (id) ON DELETE CASCADE,
  PRIMARY KEY (server_id, user_id, role_id),
  FOREIGN KEY (server_id, user_id) REFERENCES concord.members (server_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS concord.channels (
  id              text PRIMARY KEY,
  server_id       text REFERENCES concord.servers (id) ON DELETE CASCADE,
  parent_id       text,
  type            text NOT NULL,
  name            text,
  topic           text,
  icon            text,
  name_font       text,
  name_size       smallint,
  owner_id        text,
  position        integer NOT NULL DEFAULT 0,
  slowmode        integer NOT NULL DEFAULT 0,
  user_limit      integer NOT NULL DEFAULT 0,
  last_message_id text,
  created_at      bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS concord_channels_server_idx ON concord.channels (server_id);

CREATE TABLE IF NOT EXISTS concord.overwrites (
  channel_id text NOT NULL REFERENCES concord.channels (id) ON DELETE CASCADE,
  target_id  text NOT NULL,
  type       text NOT NULL,
  allow      integer NOT NULL DEFAULT 0,
  deny       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, target_id)
);

CREATE TABLE IF NOT EXISTS concord.recipients (
  channel_id text NOT NULL REFERENCES concord.channels (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  closed     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS concord_recipients_user_idx ON concord.recipients (user_id);

CREATE TABLE IF NOT EXISTS concord.messages (
  id               text PRIMARY KEY,
  channel_id       text NOT NULL REFERENCES concord.channels (id) ON DELETE CASCADE,
  author_id        text NOT NULL,
  content          text NOT NULL DEFAULT '',
  type             text NOT NULL DEFAULT 'default',
  reply_to         text,
  attachments      jsonb NOT NULL DEFAULT '[]',
  mentions         jsonb NOT NULL DEFAULT '[]',
  mention_roles    jsonb NOT NULL DEFAULT '[]',
  mention_everyone boolean NOT NULL DEFAULT false,
  card             jsonb,
  edited_at        bigint,
  pinned           boolean NOT NULL DEFAULT false,
  created_at       bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS concord_messages_channel_idx ON concord.messages (channel_id, id);
CREATE INDEX IF NOT EXISTS concord_messages_author_idx ON concord.messages (author_id, created_at);

CREATE TABLE IF NOT EXISTS concord.reactions (
  message_id text NOT NULL REFERENCES concord.messages (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  emoji      text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS concord.invites (
  code       text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES concord.servers (id) ON DELETE CASCADE,
  channel_id text,
  inviter_id text NOT NULL,
  uses       integer NOT NULL DEFAULT 0,
  max_uses   integer NOT NULL DEFAULT 0,
  expires_at bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS concord.bans (
  server_id  text NOT NULL REFERENCES concord.servers (id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  reason     text,
  mod_id     text,
  created_at bigint NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS concord.relationships (
  user_id   text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  target_id text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  type      smallint NOT NULL, -- 1 amigo · 2 bloqueado · 3 pedido recebido · 4 pedido enviado
  since     bigint NOT NULL,
  PRIMARY KEY (user_id, target_id)
);
CREATE INDEX IF NOT EXISTS concord_relationships_target_idx ON concord.relationships (target_id);

CREATE TABLE IF NOT EXISTS concord.read_states (
  user_id    text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES concord.channels (id) ON DELETE CASCADE,
  last_read  text,
  mentions   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

-- ── 3. O que no Otamashis vivia na memória do servidor ───────────────────
-- Uma linha por aba aberta. Viva = last_seen nos últimos 45 s (a aba manda
-- sinal a cada ~10 s pelo poll). ext_id deixa o poll conferir o dono sem join.
CREATE TABLE IF NOT EXISTS concord.conexoes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  ext_id     uuid NOT NULL,
  last_seen  bigint NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS concord_conexoes_user_idx ON concord.conexoes (user_id, last_seen);

-- Caixa de saída por conexão: o que o socket.io entregava na hora.
CREATE TABLE IF NOT EXISTS concord.eventos (
  id      bigserial PRIMARY KEY,
  conexao uuid NOT NULL REFERENCES concord.conexoes (id) ON DELETE CASCADE,
  ev      text NOT NULL,
  data    jsonb,
  at      bigint NOT NULL DEFAULT (extract(epoch FROM now()) * 1000)::bigint
);
CREATE INDEX IF NOT EXISTS concord_eventos_conexao_idx ON concord.eventos (conexao, id);

-- Quem está em qual canal de voz/chamada (estado ao vivo, como no Otamashis).
CREATE TABLE IF NOT EXISTS concord.voice_states (
  user_id     text PRIMARY KEY REFERENCES concord.users (id) ON DELETE CASCADE,
  channel_id  text NOT NULL REFERENCES concord.channels (id) ON DELETE CASCADE,
  server_id   text,
  conexao     uuid NOT NULL,
  self_mute   boolean NOT NULL DEFAULT false,
  self_deaf   boolean NOT NULL DEFAULT false,
  server_mute boolean NOT NULL DEFAULT false,
  server_deaf boolean NOT NULL DEFAULT false,
  suppress    boolean NOT NULL DEFAULT false,
  video       boolean NOT NULL DEFAULT false,
  screen      boolean NOT NULL DEFAULT false,
  joined_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS concord_voice_channel_idx ON concord.voice_states (channel_id);

-- Login da Steam/Twitch em andamento (o "state" do OAuth, 10 min).
CREATE TABLE IF NOT EXISTS concord.link_states (
  state      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES concord.users (id) ON DELETE CASCADE,
  kind       text NOT NULL,
  created_at bigint NOT NULL
);

-- Marca da última faxina de conexões mortas (uma linha só).
CREATE TABLE IF NOT EXISTS concord.manutencao (
  id     int PRIMARY KEY CHECK (id = 1),
  ultima bigint NOT NULL DEFAULT 0
);
INSERT INTO concord.manutencao (id, ultima) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- Valores fixos (lista de municípios do IBGE para o perfil — mig 003010).
CREATE TABLE IF NOT EXISTS concord.config (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL
);

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'concord' LOOP
    EXECUTE format('ALTER TABLE concord.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON concord.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- ── 4. Storage: anexos, avatares e ícones ────────────────────────────────
-- Público como no Otamashis: o chat mostra imagem/vídeo direto pela URL, e o
-- caminho leva 24 caracteres aleatórios. Cada um só grava na própria pasta
-- (a primeira pasta é o auth.uid()).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('concord', 'concord', true, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "concord upload na propria pasta" ON storage.objects;
CREATE POLICY "concord upload na propria pasta" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'concord'
              AND (storage.foldername(name))[1] = (select auth.uid())::text
              AND (select public.can_access(auth.uid(), 'concord', 'visualizar'::app_acao)));

-- ── 5. Primeiro acesso: quem pediu ───────────────────────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT p.id, 'concord', 'visualizar'::app_acao, true, NULL, 'Concord (mig 20261103003000): quem pediu o módulo'
  FROM public.profiles p
 WHERE p.ativo AND upper(btrim(p.display_name)) = 'PABLO FLORES SANTAREM'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (apaga TODAS as conversas do Concord)
-- =========================================================================
-- DROP POLICY IF EXISTS "concord upload na propria pasta" ON storage.objects;
-- DELETE FROM storage.objects WHERE bucket_id = 'concord';
-- DELETE FROM storage.buckets WHERE id = 'concord';
-- DROP SCHEMA IF EXISTS concord CASCADE;
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'concord';
-- DELETE FROM public.app_menu               WHERE codigo      = 'concord';
-- DELETE FROM public.app_modulo             WHERE codigo      = 'concord';
-- NOTIFY pgrst, 'reload schema';
