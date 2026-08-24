-- =========================================================================
-- WHATSAPP — BIBLIOTECA DE MENSAGENS PRONTAS (o menu da "/")
--
-- O PROBLEMA
--   Só existiam dois textos padronizados no módulo: a abertura (um só, em
--   WA_BOT_CONFIG.abertura_*) e os do recrutamento (presos a uma etapa do
--   processo, em RECRUTAMENTO_MENSAGENS). Para qualquer outra conversa o
--   atendente digitava na mão — e, fora da janela de 24h, nem digitando: a
--   Meta só aceita TEMPLATE aprovado para quem não escreveu primeiro.
--
-- O QUE ISTO CRIA
--   Uma biblioteca de mensagens que o atendente escolhe na Caixa de Entrada
--   digitando "/" no campo de mensagem. Cada linha guarda o texto que a
--   pessoa vai receber E o nome do template correspondente na Meta, porque
--   os dois caminhos precisam dizer a mesma coisa:
--     * dentro da janela de 24h → texto livre (não custa conversa nova);
--     * fora dela              → o template aprovado, mesmo texto.
--   É o mesmo desenho já usado pela abertura (whatsapp-abertura), agora com
--   várias mensagens em vez de uma.
--
--   `variaveis` são os RÓTULOS das {{1}}, {{2}}… na ordem — é o que a tela
--   pergunta antes de enviar. Mensagem sem variável (o caso da saudação)
--   vai direto, sem formulário no meio.
--
-- PERMISSÃO
--   Ler: quem tem a Caixa de Entrada ('whatsapp') — é quem vai usar o menu.
--   Escrever: quem tem o Chatbot ('whatsapp_chatbot', alterar) — mexer aqui
--   é configuração, e o texto ainda passa por revisão da Meta. Mesma régua
--   de whatsapp-abertura/criar_template.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."WA_TEMPLATE" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- O que se digita depois da "/". Minúsculo e sem espaço para poder ser
  -- filtrado enquanto a pessoa digita.
  codigo         text NOT NULL UNIQUE CHECK (codigo ~ '^[a-z0-9_]{2,40}$'),
  titulo         text NOT NULL,
  texto          text NOT NULL,
  -- Rótulos das {{n}}, na ordem. Vazio = mensagem fixa.
  variaveis      text[] NOT NULL DEFAULT '{}',
  -- Nome na Meta. NULL = só serve dentro da janela de 24h (texto livre).
  template_nome  text UNIQUE,
  idioma         text NOT NULL DEFAULT 'pt_BR',
  -- UTILITY x MARKETING muda o preço da conversa e o rigor da revisão. Quem
  -- decide de verdade é a Meta; aqui é o que se pede na submissão.
  categoria      text NOT NULL DEFAULT 'UTILITY' CHECK (categoria IN ('UTILITY','MARKETING')),
  ativo          boolean NOT NULL DEFAULT true,
  ordem          integer NOT NULL DEFAULT 100,
  created_at     timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS wa_template_menu_idx ON public."WA_TEMPLATE"(ativo, ordem, titulo);

ALTER TABLE public."WA_TEMPLATE" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_template_select ON public."WA_TEMPLATE";
CREATE POLICY wa_template_select ON public."WA_TEMPLATE"
  FOR SELECT TO authenticated USING (public.tem_acesso_menu('whatsapp'));

DROP POLICY IF EXISTS wa_template_write ON public."WA_TEMPLATE";
CREATE POLICY wa_template_write ON public."WA_TEMPLATE"
  FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp_chatbot', 'alterar'))
  WITH CHECK (public.tem_acesso_menu('whatsapp_chatbot', 'alterar'));

-- ── Semente ──────────────────────────────────────────────────────────────
-- A saudação pedida pelo Pablo (24/08/2026). Sem variável: o texto sai igual
-- para todo mundo, então nada a preencher antes de enviar.
--
-- MARKETING e não UTILITY: é abordagem que parte da empresa, pedindo
-- consentimento para continuar o contato — não é aviso sobre algo que a
-- pessoa começou. Submeter como UTILITY é o caminho curto para a Meta
-- reprovar (ou reclassificar) o template.
INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, template_nome, categoria, ordem)
SELECT 'saudacao',
       'Saudação — confirmar contato',
       E'Olá! Somos do Grupo Nascimento, como você está?\n\nPara confirmar que podemos entrar em contato com você, responda essa mensagem.',
       'saudacao_contato', 'MARKETING', 10
 WHERE NOT EXISTS (SELECT 1 FROM public."WA_TEMPLATE" WHERE codigo = 'saudacao');

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT codigo, titulo, template_nome, categoria, ativo FROM public."WA_TEMPLATE" ORDER BY ordem;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public."WA_TEMPLATE";
-- =========================================================================
