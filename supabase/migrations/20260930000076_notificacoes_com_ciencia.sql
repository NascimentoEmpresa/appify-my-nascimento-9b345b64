-- =========================================================================
-- Notificações com CIÊNCIA — o aviso que trava a tela até a pessoa responder.
--
-- Diferente da Novidade, que é changelog passivo (a pessoa lê se quiser), a
-- Notificação aparece no CENTRO da tela e exige um clique em CONCORDO ou
-- DISCORDO para sair da frente.
--
-- A escolha não muda nada no sistema, e isso é de propósito: o que se quer
-- registrar é que a pessoa VIU e RESPONDEU. Guardar qual botão ela apertou
-- serve para o histórico — "todo mundo leu, e três discordaram" é uma
-- informação diferente de "todo mundo leu".
--
-- Quem publica é o MESMO de Novidades (`novidades_publicar`), porque foi o
-- pedido: "quem pode criar novidade" ganha Notificações ao lado. Não há menu
-- de permissão novo — ver o README sobre não criar tela de permissão à parte.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."SISTEMA_NOTIFICACOES" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo          text        NOT NULL,
  mensagem        text        NOT NULL,
  publicado       boolean     NOT NULL DEFAULT true,
  publicado_em    timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid        DEFAULT auth.uid(),
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SISTEMA_NOTIFICACOES" IS
  'Avisos que aparecem no centro da tela e exigem CONCORDO/DISCORDO. Escrita restrita a novidades_publicar.';

CREATE INDEX IF NOT EXISTS sistema_notificacoes_pub_idx
  ON public."SISTEMA_NOTIFICACOES" (publicado_em DESC) WHERE publicado;

-- ── O histórico: quem respondeu o quê, e quando ──────────────────────────
-- Uma linha por pessoa por notificação. A PK composta é o que garante que
-- responder duas vezes não vira duas linhas — e é também o que faz a
-- notificação parar de aparecer para quem já respondeu.
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOTIFICACAO_CIENCIA" (
  notificacao_id bigint      NOT NULL REFERENCES public."SISTEMA_NOTIFICACOES"(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL DEFAULT auth.uid(),
  -- Texto com CHECK, não enum: se um dia aparecer um terceiro botão, trocar
  -- CHECK é bem mais fácil de reverter que ALTER TYPE usado por RLS.
  escolha        text        NOT NULL CHECK (escolha IN ('CONCORDO', 'DISCORDO')),
  respondido_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notificacao_id, user_id)
);

CREATE INDEX IF NOT EXISTS sistema_notif_ciencia_user_idx
  ON public."SISTEMA_NOTIFICACAO_CIENCIA" (user_id);

COMMENT ON TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" IS
  'Histórico de ciência: quem leu a notificação, o que respondeu e quando. Linha nunca é apagada nem alterada.';

-- ── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sistema_notificacoes_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sistema_notificacoes_touch ON public."SISTEMA_NOTIFICACOES";
CREATE TRIGGER trg_sistema_notificacoes_touch
  BEFORE UPDATE ON public."SISTEMA_NOTIFICACOES"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_notificacoes_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOTIFICACOES"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES" FOR SELECT TO authenticated
  USING (publicado OR public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_notificacoes_incluir ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_incluir ON public."SISTEMA_NOTIFICACOES" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_notificacoes_alterar ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_alterar ON public."SISTEMA_NOTIFICACOES" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_notificacoes_excluir ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_excluir ON public."SISTEMA_NOTIFICACOES" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

-- Ciência: cada um grava a SUA resposta. Quem publica lê a de todos — é o
-- histórico. Ninguém edita nem apaga: registro de ciência que pode ser
-- alterado depois não serve como registro de ciência.
DROP POLICY IF EXISTS sistema_notif_ciencia_ler ON public."SISTEMA_NOTIFICACAO_CIENCIA";
CREATE POLICY sistema_notif_ciencia_ler ON public."SISTEMA_NOTIFICACAO_CIENCIA" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_notif_ciencia_gravar ON public."SISTEMA_NOTIFICACAO_CIENCIA";
CREATE POLICY sistema_notif_ciencia_gravar ON public."SISTEMA_NOTIFICACAO_CIENCIA" FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT 'SISTEMA_NOTIFICACOES' AS tabela, count(*) FROM public."SISTEMA_NOTIFICACOES"
UNION ALL
SELECT 'SISTEMA_NOTIFICACAO_CIENCIA', count(*) FROM public."SISTEMA_NOTIFICACAO_CIENCIA";

-- =========================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public."SISTEMA_NOTIFICACAO_CIENCIA";
--   DROP TABLE IF EXISTS public."SISTEMA_NOTIFICACOES";
--   DROP FUNCTION IF EXISTS public.sistema_notificacoes_touch();
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
