-- =========================================================================
-- Quadro de Avisos: "para quem é este aviso?"
--
-- Até aqui todo aviso ia para todo mundo — a coluna `publico_alvo` existia
-- com o valor 'todos' e mais nada. O pedido: na hora de criar, escolher
-- SETOR, PESSOA ou TODOS.
--
-- O DESENHO É O MESMO DOS LINKS DE BI (migration 20260930000079), de
-- propósito: duas telas que fazem a mesma pergunta ("quem vê isto?") devem
-- respondê-la do mesmo jeito, senão quem administra aprende duas regras.
--
--   • Aviso SEM nenhuma linha de alvo é de TODOS. Restringir é o ato
--     explícito. Obrigar a listar setor a setor faria todo aviso novo nascer
--     invisível e parecer que não salvou.
--   • A fonte do setor é `setor_catalogo` + `user_setor`. NÃO a tabela
--     "SETORES", que guarda os nomes em caixa alta ("LICITACAO") enquanto
--     user_setor grava "Licitações" — só "RH" casa nas duas.
--
-- ⚠ `publico_alvo` SAI.
--   Ter a coluna E a tabela de alvos seria duas fontes para a mesma verdade,
--   e o dia em que discordassem ("publico_alvo = todos" com três setores
--   listados) ninguém saberia qual vale. A tabela é a fonte. A coluna nasceu
--   hoje, na 078, e nunca guardou nada além de 'todos' — não há dado a
--   preservar.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."SISTEMA_NOTIFICACAO_ALVO" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id bigint NOT NULL REFERENCES public."SISTEMA_NOTIFICACOES"(id) ON DELETE CASCADE,
  setor          text,
  user_id        uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Setor OU pessoa, nunca os dois: são duas formas de dizer "este aviso é
  -- seu", e uma linha com os dois não teria leitura óbvia (é E ou é OU?).
  CONSTRAINT sistema_notificacao_alvo_um_alvo CHECK (
    (setor IS NOT NULL AND user_id IS NULL) OR (setor IS NULL AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sistema_notif_alvo_setor_uk
  ON public."SISTEMA_NOTIFICACAO_ALVO" (notificacao_id, setor) WHERE setor IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sistema_notif_alvo_user_uk
  ON public."SISTEMA_NOTIFICACAO_ALVO" (notificacao_id, user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public."SISTEMA_NOTIFICACAO_ALVO" IS
  'Para quem é o aviso (setor ou pessoa). Sem linha nenhuma = para todos.';

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS publico_alvo;

-- ── O aviso é meu? ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notificacao_para_mim(_notificacao bigint, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
           SELECT 1 FROM public."SISTEMA_NOTIFICACAO_ALVO" a
            WHERE a.notificacao_id = _notificacao
         )
      OR EXISTS (
           SELECT 1
             FROM public."SISTEMA_NOTIFICACAO_ALVO" a
            WHERE a.notificacao_id = _notificacao
              AND (
                a.user_id = _user
                OR a.setor IN (SELECT u.setor FROM public.user_setor u WHERE u.user_id = _user)
              )
         );
$$;

REVOKE ALL ON FUNCTION public.notificacao_para_mim(bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notificacao_para_mim(bigint, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.notificacao_para_mim(bigint, uuid) TO authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOTIFICACAO_ALVO" ENABLE ROW LEVEL SECURITY;

-- O recorte entra AQUI, no SELECT do aviso: assim o gate que trava a tela, o
-- mural do Início e a lista do Quadro herdam a mesma regra sem cada um
-- refazer o filtro — e sem o risco de um deles discordar dos outros.
DROP POLICY IF EXISTS sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES" FOR SELECT TO authenticated
  USING (
    public.pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao)
    OR (publicado AND public.notificacao_para_mim(id, auth.uid()))
  );

-- Quem gere edita os alvos; cada um lê os seus, que é o que permite a tela
-- explicar "você recebeu este aviso porque é do setor X".
DROP POLICY IF EXISTS sistema_notif_alvo_ler ON public."SISTEMA_NOTIFICACAO_ALVO";
CREATE POLICY sistema_notif_alvo_ler ON public."SISTEMA_NOTIFICACAO_ALVO" FOR SELECT TO authenticated
  USING (
    public.pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao)
    OR user_id = auth.uid()
    OR setor IN (SELECT u.setor FROM public.user_setor u WHERE u.user_id = auth.uid())
  );

DROP POLICY IF EXISTS sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO";
CREATE POLICY sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO";
CREATE POLICY sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR DELETE TO authenticated
  USING (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO";
-- DROP POLICY IF EXISTS sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO";
-- DROP POLICY IF EXISTS sistema_notif_alvo_ler     ON public."SISTEMA_NOTIFICACAO_ALVO";
-- DROP TABLE IF EXISTS public."SISTEMA_NOTIFICACAO_ALVO";
-- DROP FUNCTION IF EXISTS public.notificacao_para_mim(bigint, uuid);
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" ADD COLUMN publico_alvo text NOT NULL DEFAULT 'todos';
-- DROP POLICY IF EXISTS sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES";
-- CREATE POLICY sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES" FOR SELECT TO authenticated
--   USING (publicado OR public.pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao));
-- NOTIFY pgrst, 'reload schema';
