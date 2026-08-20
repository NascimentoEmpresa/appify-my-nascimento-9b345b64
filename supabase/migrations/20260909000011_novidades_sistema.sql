-- =========================================================================
-- Novidades do Sistema — changelog interno do ERP (pedido do Pablo, 20/08/2026)
--
-- Todo mundo LÊ; só quem tem o flag "Pode criar novidades do sistema" em
-- Administração › Acesso por Usuário PUBLICA.
--
-- O flag NÃO é um mecanismo novo: é um menu de capacidade em `app_menu` com
-- `rota = NULL`, exatamente como `recrutamento_etapa_juridico`,
-- `chamados_sistemas_aprovar` e `whatsapp_todas` já fazem. Ele aparece
-- sozinho na aba "Acesso por Usuário" (ela lista app_menu), e o toggle de lá
-- grava visualizar/incluir/alterar/aprovar/exportar em
-- screen_permission_user — por isso a RLS aqui cobra `incluir`, que é o que o
-- toggle concede. Nada de tabela nova de permissão.
--
-- A rota /app/novidades fica FORA de app_menu de propósito: rota sem entrada
-- lá é sempre aberta (ver RouteGuard/Sidebar), e a leitura é para todos.
-- =========================================================================

-- ── Menu de capacidade: "Pode criar novidades do sistema" ────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'novidades_publicar', 'Pode criar novidades do sistema', NULL, 80, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
   AND NOT EXISTS (
     SELECT 1 FROM public.app_menu x
      WHERE x.modulo_id = m.id AND x.codigo = 'novidades_publicar');

-- ── A novidade ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOVIDADES" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo          text        NOT NULL,
  descricao       text        NOT NULL,
  -- Os quatro selos que a tela mostra. Texto com CHECK em vez de enum: o
  -- Pablo pode querer um selo novo, e ALTER TYPE em enum usado por RLS é
  -- bem mais chato de reverter do que trocar um CHECK.
  tipo            text        NOT NULL DEFAULT 'NOVO'
                  CHECK (tipo IN ('NOVO', 'MELHORIA', 'AJUSTE', 'AVISO')),
  -- Destino do "Saiba mais →". Rota interna do ERP (/app/...) ou NULL.
  rota            text,
  publicado       boolean     NOT NULL DEFAULT true,
  publicado_em    timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid        DEFAULT auth.uid(),
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SISTEMA_NOVIDADES" IS
  'Changelog interno mostrado no Início e no sino de novidades. Escrita restrita ao menu de capacidade novidades_publicar (Acesso por Usuário).';

-- A lista é sempre "as mais recentes primeiro, só as publicadas".
CREATE INDEX IF NOT EXISTS sistema_novidades_publicadas_idx
  ON public."SISTEMA_NOVIDADES" (publicado_em DESC) WHERE publicado;

-- ── Quem já leu o quê (a bolinha do topo) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOVIDADES_LIDAS" (
  novidade_id bigint      NOT NULL REFERENCES public."SISTEMA_NOVIDADES"(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL DEFAULT auth.uid(),
  lido_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (novidade_id, user_id)
);
CREATE INDEX IF NOT EXISTS sistema_novidades_lidas_user_idx
  ON public."SISTEMA_NOVIDADES_LIDAS" (user_id);

-- ── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sistema_novidades_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sistema_novidades_touch ON public."SISTEMA_NOVIDADES";
CREATE TRIGGER trg_sistema_novidades_touch
  BEFORE UPDATE ON public."SISTEMA_NOVIDADES"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_novidades_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOVIDADES"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SISTEMA_NOVIDADES_LIDAS" ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer pessoa logada vê o que está publicado. Quem publica vê
-- também os rascunhos (publicado = false), senão não teria como voltar neles.
DROP POLICY IF EXISTS sistema_novidades_ler ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_ler ON public."SISTEMA_NOVIDADES"
  FOR SELECT TO authenticated
  USING (publicado OR public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

-- Escrever: só o flag. `incluir` é a ação que o toggle de "Acesso por
-- Usuário" concede — cobrar `excluir` deixaria o admin marcar o flag e o
-- botão de apagar não funcionar.
DROP POLICY IF EXISTS sistema_novidades_criar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_criar ON public."SISTEMA_NOVIDADES"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_novidades_editar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_editar ON public."SISTEMA_NOVIDADES"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_novidades_apagar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_apagar ON public."SISTEMA_NOVIDADES"
  FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

-- Lidas: cada um cuida só das próprias marcas.
DROP POLICY IF EXISTS sistema_novidades_lidas_minhas ON public."SISTEMA_NOVIDADES_LIDAS";
CREATE POLICY sistema_novidades_lidas_minhas ON public."SISTEMA_NOVIDADES_LIDAS"
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public."SISTEMA_NOVIDADES", public."SISTEMA_NOVIDADES_LIDAS" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_NOVIDADES"       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_NOVIDADES_LIDAS" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TABLE public."SISTEMA_NOVIDADES_LIDAS";
--   DROP TABLE public."SISTEMA_NOVIDADES";
--   DROP FUNCTION public.sistema_novidades_touch();
--   DELETE FROM public.app_menu WHERE codigo = 'novidades_publicar';
-- =========================================================================
