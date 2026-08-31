-- =========================================================================
-- CHAT GERAL DA EMPRESA — cartão do Início (/app), ao lado dos aniversários
--
-- Uma sala só, da empresa inteira. Todo autenticado lê e escreve; cada um
-- apaga o que escreveu; quem tem o flag de moderação apaga qualquer coisa.
--
-- POR QUE NÃO REUSAR A "SISTEMA_COMENTARIOS"
-- Aquela é o feed polimórfico de comentários PRESOS A UMA ENTIDADE (modulo +
-- entidade_id: um patrimônio, um processo, uma solicitação de férias). Esta
-- aqui é uma SALA, não um comentário sobre alguma coisa — não existe
-- entidade_id que faça sentido. E, decisivo: a SISTEMA_COMENTARIOS não tem
-- coluna de autor em uuid (só `autor_nome`/`autor_cpf` em texto) e sua policy
-- é `USING (true)` para authenticated, em FOR ALL. Encaixar o chat lá exigiria
-- adicionar coluna e recortar aquela policy por módulo — mexendo na RLS de que
-- quatro módulos já dependem, para ganhar uma tabela a menos. Não compensa.
--
-- MODERAÇÃO reusa o mecanismo que já existe: um menu de capacidade em
-- `app_menu` com `rota = NULL`, igual a `novidades_publicar`
-- (20260909000011). Nada de tabela nova de permissão. Menu de capacidade
-- nasce SEM regra em perfil_acesso_permissao, e has_screen_access() devolve
-- false até alguém marcar o toggle em Administração › Acesso por Usuário —
-- ou seja, nasce fechado, que é o certo para um poder de apagar.
--
-- SEM REALTIME de propósito: não há uma única subscription
-- (`supabase.channel`) em todo o `src/` deste ERP, e o chat não é motivo para
-- estrear o mecanismo — a tela recarrega por polling do React Query, que é o
-- padrão de todo o resto.
--
-- Idempotente. Aplicar no banco do app (fwmzeaztjxrxxzxzxmgc).
-- =========================================================================

-- ── 1) Menu de capacidade: "Pode apagar mensagens do chat geral" ────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'chat_geral_moderar', 'Pode apagar mensagens do chat geral', NULL, 81, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
   AND NOT EXISTS (
     SELECT 1 FROM public.app_menu x
      WHERE x.modulo_id = m.id AND x.codigo = 'chat_geral_moderar');

-- A tela "Acesso por Usuario" so desenha o switch de uma acao quando existe a
-- linha correspondente em app_menu_acao (20260910000002 -- "fonte da verdade
-- para quais switches a tela deve mostrar"). Sem esta linha o flag acima seria
-- INCONCEDIVEL: o toggle principal do menu nunca concede 'excluir', de
-- proposito (ACOES_DO_TOGGLE_PADRAO em ModulosMenusTab.tsx = visualizar/
-- incluir/alterar/aprovar/exportar -- "liberar a tela nao e autorizar apagar
-- registro"), e sem o switch extra o admin nao teria por onde conceder. E
-- exatamente a lacuna que a 20260930000009 corrigiu no cartao de credito.
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('chat_geral_moderar', 'excluir')
ON CONFLICT DO NOTHING;

-- ── 2) A mensagem ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_CHAT_GERAL" (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  autor      uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  texto      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sistema_chat_geral_texto_tamanho
    CHECK (char_length(btrim(texto)) BETWEEN 1 AND 500)
);

COMMENT ON TABLE public."SISTEMA_CHAT_GERAL" IS
  'Sala unica de bate-papo da empresa, mostrada no Inicio. Leitura e escrita para todo autenticado; apagar so o proprio, ou tudo com o menu de capacidade chat_geral_moderar.';

-- A tela sempre pede "as N mais recentes" — o indice e nessa ordem.
CREATE INDEX IF NOT EXISTS sistema_chat_geral_recentes_idx
  ON public."SISTEMA_CHAT_GERAL" (created_at DESC);

-- ── 3) RLS ──────────────────────────────────────────────────────────────
-- Escrita direto na tabela (sem RPC) porque não há nada a validar além de
-- "o autor é você" — e isso a própria policy cobra melhor do que uma função.
ALTER TABLE public."SISTEMA_CHAT_GERAL" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sistema_chat_geral_select" ON public."SISTEMA_CHAT_GERAL";
CREATE POLICY "sistema_chat_geral_select" ON public."SISTEMA_CHAT_GERAL" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sistema_chat_geral_insert" ON public."SISTEMA_CHAT_GERAL";
CREATE POLICY "sistema_chat_geral_insert" ON public."SISTEMA_CHAT_GERAL" FOR INSERT TO authenticated WITH CHECK (autor = auth.uid());

-- Sem policy de UPDATE: mensagem de chat não se edita. Quem errou apaga e
-- manda de novo — e assim ninguém reescreve o que já foi lido por outros.
DROP POLICY IF EXISTS "sistema_chat_geral_delete" ON public."SISTEMA_CHAT_GERAL";
CREATE POLICY "sistema_chat_geral_delete" ON public."SISTEMA_CHAT_GERAL" FOR DELETE TO authenticated USING (autor = auth.uid() OR public.has_screen_access(auth.uid(), 'chat_geral_moderar', 'excluir'));

-- ── 4) Listar ───────────────────────────────────────────────────────────
-- SECURITY DEFINER só por causa do JOIN em profiles (nome e foto de quem
-- escreveu). Devolve em ordem CRESCENTE: o cartão desenha de cima para
-- baixo e a mensagem mais nova fica embaixo, como em qualquer chat.
CREATE OR REPLACE FUNCTION public.chat_geral_listar(_limite integer DEFAULT 60)
RETURNS TABLE (
  id           bigint,
  autor        uuid,
  autor_nome   text,
  autor_avatar text,
  texto        text,
  criado_em    timestamptz,
  sou_eu       boolean,
  posso_apagar boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH ultimas AS (
    SELECT c.id, c.autor, c.texto, c.created_at
      FROM public."SISTEMA_CHAT_GERAL" c
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT LEAST(GREATEST(coalesce(_limite, 60), 1), 200)
  )
  SELECT u.id,
         u.autor,
         btrim(coalesce(nullif(btrim(p.display_name), ''), p.email, 'Colega')),
         p.avatar_url,
         u.texto,
         u.created_at,
         (u.autor = auth.uid()),
         (u.autor = auth.uid()
          OR public.has_screen_access(auth.uid(), 'chat_geral_moderar', 'excluir'))
    FROM ultimas u
    LEFT JOIN public.profiles p ON p.id = u.autor
   ORDER BY u.created_at, u.id;
$fn$;

REVOKE ALL ON FUNCTION public.chat_geral_listar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_geral_listar(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chat_geral_listar(integer);
--   DROP TABLE IF EXISTS public."SISTEMA_CHAT_GERAL";
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'chat_geral_moderar';
--   DELETE FROM public.app_menu WHERE codigo = 'chat_geral_moderar';
--   NOTIFY pgrst, 'reload schema';
