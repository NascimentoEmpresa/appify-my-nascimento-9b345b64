-- =====================================================================
-- WHATSAPP — CHATBOT (integração Meta WhatsApp Cloud API)
--
-- Recebe e envia mensagens via Cloud API (Edge Functions whatsapp-webhook /
-- whatsapp-enviar) e responde com IA (Claude). Guarda contatos, conversas,
-- mensagens, a configuração do bot e a base de conhecimento.
--
-- Permissão por usuário (mesma base do resto do ERP: app_menu +
-- tem_acesso_menu). Capacidades:
--   whatsapp          → Caixa de Entrada (ver/atender conversas)
--   whatsapp_chatbot  → Chatbot (configurar persona, base de conhecimento)
-- Ambas ficam FECHADAS por padrão (MENUS_SEMPRE_RESTRITOS no front).
--
-- O webhook grava com a service_role (bypass de RLS); o front lê/escreve com a
-- sessão do usuário, limitado pela RLS por capacidade.
-- =====================================================================

-- 1) Menus / capacidades ------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('whatsapp',         'WhatsApp — Caixa de Entrada', '/app/whatsapp',         70),
    ('whatsapp_chatbot', 'WhatsApp — Chatbot',          '/app/whatsapp/chatbot', 71)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Tabelas ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_CONTATO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id       text NOT NULL UNIQUE,          -- número no formato Cloud API (ex.: 55119...)
  nome        text,
  telefone    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."WA_CONVERSA" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id               uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','pendente','fechada')),
  bot_ativo                boolean NOT NULL DEFAULT true,   -- bot responde automaticamente?
  atendente_id             uuid REFERENCES auth.users(id), -- humano que assumiu
  ultima_mensagem_em       timestamptz,
  ultima_mensagem_preview  text,
  ultima_direcao           text,                            -- entrada | saida
  nao_lidas                integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contato_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_conversa_ultima ON public."WA_CONVERSA"(ultima_mensagem_em DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public."WA_MENSAGEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id   uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  contato_id    uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  direcao       text NOT NULL CHECK (direcao IN ('entrada','saida')),
  tipo          text NOT NULL DEFAULT 'text',  -- text | image | audio | document | outro
  texto         text,
  wa_message_id text UNIQUE,                    -- id da Meta (dedupe de reentrega)
  status        text NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','enviada','entregue','lida','erro')),
  origem        text NOT NULL DEFAULT 'contato' CHECK (origem IN ('contato','bot','atendente')),
  autor_id      uuid REFERENCES auth.users(id), -- atendente que enviou (quando origem=atendente)
  meta          jsonb,
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_mensagem_conversa ON public."WA_MENSAGEM"(conversa_id, criada_em);

-- Configuração do bot — linha única (id boolean garante singleton).
CREATE TABLE IF NOT EXISTS public."WA_BOT_CONFIG" (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativo            boolean NOT NULL DEFAULT false,
  persona          text NOT NULL DEFAULT 'Você é o assistente virtual do Grupo Nascimento no WhatsApp. Seja cordial, direto e útil. Responda em português do Brasil. Se não souber ou o assunto exigir um humano, diga que vai encaminhar para um atendente.',
  saudacao         text,                                  -- opcional: 1ª resposta a um contato novo
  fallback         text NOT NULL DEFAULT 'Não consegui entender agora. Um atendente vai te responder em breve.',
  horario_inicio   time NOT NULL DEFAULT '08:00',
  horario_fim      time NOT NULL DEFAULT '18:00',
  dias_semana      int[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- 0=dom .. 6=sáb
  fora_horario_msg text NOT NULL DEFAULT 'Nosso atendimento é de segunda a sexta, das 8h às 18h. Retornaremos assim que possível.',
  modelo           text NOT NULL DEFAULT 'claude-opus-5',
  max_tokens       integer NOT NULL DEFAULT 1024,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."WA_BOT_CONFIG" (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Base de conhecimento injetada no prompt do bot.
CREATE TABLE IF NOT EXISTS public."WA_BOT_CONHECIMENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  conteudo    text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  ordem       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at automático (função set_updated_at já existe no projeto).
DROP TRIGGER IF EXISTS trg_wa_contato_updated  ON public."WA_CONTATO";
CREATE TRIGGER trg_wa_contato_updated  BEFORE UPDATE ON public."WA_CONTATO"  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_wa_conversa_updated ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_updated BEFORE UPDATE ON public."WA_CONVERSA" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_wa_bot_config_updated ON public."WA_BOT_CONFIG";
CREATE TRIGGER trg_wa_bot_config_updated BEFORE UPDATE ON public."WA_BOT_CONFIG" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) RLS ----------------------------------------------------------------
ALTER TABLE public."WA_CONTATO"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_CONVERSA"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_MENSAGEM"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_BOT_CONFIG"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_BOT_CONHECIMENTO" ENABLE ROW LEVEL SECURITY;

-- Caixa de entrada (contatos/conversas/mensagens): quem tem 'whatsapp'.
DROP POLICY IF EXISTS wa_contato_rw ON public."WA_CONTATO";
CREATE POLICY wa_contato_rw ON public."WA_CONTATO" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

DROP POLICY IF EXISTS wa_conversa_rw ON public."WA_CONVERSA";
CREATE POLICY wa_conversa_rw ON public."WA_CONVERSA" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

DROP POLICY IF EXISTS wa_mensagem_rw ON public."WA_MENSAGEM";
CREATE POLICY wa_mensagem_rw ON public."WA_MENSAGEM" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

-- Config + base de conhecimento do bot: ver com 'whatsapp'; editar com 'whatsapp_chatbot'.
DROP POLICY IF EXISTS wa_bot_config_select ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_select ON public."WA_BOT_CONFIG" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));
DROP POLICY IF EXISTS wa_bot_config_update ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_update ON public."WA_BOT_CONFIG" FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('whatsapp_chatbot')) WITH CHECK (public.tem_acesso_menu('whatsapp_chatbot'));

DROP POLICY IF EXISTS wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));
DROP POLICY IF EXISTS wa_bot_conh_cud ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_cud ON public."WA_BOT_CONHECIMENTO" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp_chatbot')) WITH CHECK (public.tem_acesso_menu('whatsapp_chatbot'));

-- 4) Helper: incremento atômico de não lidas (usado pelo webhook) -------
CREATE OR REPLACE FUNCTION public.wa_incrementar_nao_lidas(p_conversa uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ UPDATE public."WA_CONVERSA" SET nao_lidas = nao_lidas + 1 WHERE id = p_conversa; $$;
REVOKE ALL ON FUNCTION public.wa_incrementar_nao_lidas(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_incrementar_nao_lidas(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_incrementar_nao_lidas(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
