-- Achado real do Iury/usuário (pós SIS-2026-0265): "ao botar um setor em
-- Aprovações — Malote em /app/administracao, ele já puxa para os
-- orçamentos" — hoje `malote_setor_visivel_usuario` é UMA lista só, marcada
-- como (user_id, setor), compartilhada de propósito entre os 4 menus de
-- MALOTE_SETOR_MENU_CODIGOS (Aprovações/Meus Itens e as 3 telas de
-- Orçamento) — decisão do SIS-2026-0265, documentada em
-- useMaloteAcessoOrcamento.ts, "reaproveitando o MESMO recorte de setor".
-- Na prática as duas coisas são parecidas mas semanticamente diferentes
-- (fallback oposto: em Aprovações "sem recorte = vê tudo", em Orçamento
-- "sem recorte = Financeiro fica oculto") e configuráveis por telas
-- distintas — reaproveitar a mesma linha fazia uma marcação em Aprovações
-- silenciosamente mudar o que aparece em Orçamento, sem o usuário pedir.
--
-- Adiciona uma coluna `contexto` pra separar as duas listas dentro da MESMA
-- tabela (menor mudança de schema/RLS/client do que duplicar a tabela).
-- Backfill: toda linha existente é de Aprovações (único contexto que já
-- existia até aqui, pois o painel de Orçamento ainda não tinha gravado
-- nada de fato diferenciado) — vira 'aprovacoes', preservando 100% do
-- comportamento atual de quem já configurou por lá. Orçamento nasce
-- zerado: quem gerencia via /app/administracao precisa reconfigurar lá
-- quem vê o Financeiro (aviso dado ao usuário, decisão consciente).

ALTER TABLE public.malote_setor_visivel_usuario
  ADD COLUMN contexto text NOT NULL DEFAULT 'aprovacoes';

ALTER TABLE public.malote_setor_visivel_usuario
  ADD CONSTRAINT malote_setor_visivel_contexto_check
  CHECK (contexto IN ('aprovacoes', 'orcamento'));

-- A UNIQUE antiga era (user_id, setor) — agora cada contexto tem sua
-- própria linha, então a mesma pessoa pode ter "Financeiro" marcado em
-- Aprovações e/ou em Orçamento independentemente.
ALTER TABLE public.malote_setor_visivel_usuario
  DROP CONSTRAINT malote_setor_visivel_usuario_user_id_setor_key;
ALTER TABLE public.malote_setor_visivel_usuario
  ADD CONSTRAINT malote_setor_visivel_usuario_user_id_setor_contexto_key
  UNIQUE (user_id, setor, contexto);

CREATE INDEX idx_malote_setor_visivel_contexto ON public.malote_setor_visivel_usuario(contexto);

-- RLS (select/write) não muda — continua baseada em user_id/admin/supervisor/
-- gerenciamento de acesso, contexto é só mais uma coluna dentro da mesma
-- linha, não afeta quem pode ler/escrever.

-- Funções usadas pela RLS de malote_despesa (Aprovações/Meus Itens) —
-- passam a olhar só contexto='aprovacoes', pra não misturar com o que for
-- marcado em Orçamento.
CREATE OR REPLACE FUNCTION public.malote_tem_recorte_setor(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_setor_visivel_usuario
     WHERE user_id = _user_id AND contexto = 'aprovacoes'
  );
$$;

CREATE OR REPLACE FUNCTION public.malote_despesa_visivel_por_setor(_user_id uuid, _classificacao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.malote_tem_recorte_setor(_user_id) THEN true
    ELSE EXISTS (
      SELECT 1
        FROM public.planejamento_orcamentario_classificacao c
        JOIN public.malote_setor_visivel_usuario s
          ON upper(btrim(s.setor)) = upper(btrim(c.setor_responsavel))
       WHERE c.id = _classificacao_id
         AND s.user_id = _user_id
         AND s.contexto = 'aprovacoes'
    )
  END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   CREATE OR REPLACE FUNCTION public.malote_tem_recorte_setor(_user_id uuid)
--   RETURNS boolean
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
--   AS $$
--     SELECT EXISTS (
--       SELECT 1 FROM public.malote_setor_visivel_usuario WHERE user_id = _user_id
--     );
--   $$;
--   CREATE OR REPLACE FUNCTION public.malote_despesa_visivel_por_setor(_user_id uuid, _classificacao_id uuid)
--   RETURNS boolean
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
--   AS $$
--     SELECT CASE
--       WHEN NOT public.malote_tem_recorte_setor(_user_id) THEN true
--       ELSE EXISTS (
--         SELECT 1
--           FROM public.planejamento_orcamentario_classificacao c
--           JOIN public.malote_setor_visivel_usuario s
--             ON upper(btrim(s.setor)) = upper(btrim(c.setor_responsavel))
--          WHERE c.id = _classificacao_id
--            AND s.user_id = _user_id
--       )
--     END;
--   $$;
--   DROP INDEX IF EXISTS idx_malote_setor_visivel_contexto;
--   ALTER TABLE public.malote_setor_visivel_usuario
--     DROP CONSTRAINT malote_setor_visivel_usuario_user_id_setor_contexto_key;
--   ALTER TABLE public.malote_setor_visivel_usuario
--     ADD CONSTRAINT malote_setor_visivel_usuario_user_id_setor_key UNIQUE (user_id, setor);
--   ALTER TABLE public.malote_setor_visivel_usuario
--     DROP CONSTRAINT malote_setor_visivel_contexto_check;
--   ALTER TABLE public.malote_setor_visivel_usuario
--     DROP COLUMN contexto;
