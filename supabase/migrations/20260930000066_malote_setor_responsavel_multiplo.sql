-- SIS-2026-0335 (Iury): "Colocar em Classificação malote a opção de
-- colocar mais de um setor responsável pois existe a possibilidade de ter
-- mais de um aprovador de setor diferente" — `setor_responsavel` era
-- text (1 valor), usado hoje em 2 comparações EXATAS que precisam virar
-- "contém"/"algum bate" pra não regredir silenciosamente:
--
--   1. malote_despesa_visivel_por_setor (RLS de malote_despesa) — recorte
--      de visibilidade por setor (malote_setor_visivel_usuario). Sem
--      atualizar, quem tem recorte configurado deixaria de ver despesas
--      de Classificação com mais de um setor.
--   2. classificacaoVisivelPorSetor (orcamentoUtils.ts, client) — restrição
--      do Financeiro no Orçamento. Sem atualizar, uma Classificação
--      "Financeiro + outro setor" deixaria de ser tratada como restrita e
--      vazaria pra quem não tem acesso ao Financeiro (decisão confirmada
--      com o usuário: continua restrita se TIVER Financeiro entre os
--      setores, não só quando for SÓ Financeiro).
--
-- ── 1. Coluna vira array (mesmo padrão de aprovador1_user_ids) ──────────
-- setor_responsavel tinha uma FK pra setor_catalogo(nome) com
-- ON UPDATE CASCADE ON DELETE SET NULL (rename/delete no catálogo
-- propagava sozinho) — Postgres não permite FK direto numa coluna array,
-- então essa FK sai. Decisão explícita do usuário: não normalizar numa
-- tabela de junção só pra manter o cascade automático (catálogo de 13
-- setores curados, muda raro) — sem FK a partir daqui, a lista de opções
-- no client (SearchableSelect/checkboxes vindo de setor_catalogo) é quem
-- garante que só se escolhe setor que existe.
--
-- MAPEADO (não implementado agora — só entra se aparecer divergência real
-- em produção, ex. rename/delete de setor_catalogo deixando
-- setor_responsavel com nome órfão/desatualizado): dá pra recuperar o
-- vínculo rename/delete sem normalizar em tabela de junção, com 2 triggers
-- em setor_catalogo (não nesta tabela):
--   AFTER UPDATE OF nome ON setor_catalogo →
--     UPDATE planejamento_orcamentario_classificacao
--        SET setor_responsavel = array_replace(setor_responsavel, OLD.nome, NEW.nome)
--      WHERE OLD.nome = ANY(setor_responsavel);
--   AFTER DELETE ON setor_catalogo →
--     UPDATE planejamento_orcamentario_classificacao
--        SET setor_responsavel = array_remove(setor_responsavel, OLD.nome)
--      WHERE OLD.nome = ANY(setor_responsavel);
ALTER TABLE public.planejamento_orcamentario_classificacao
  DROP CONSTRAINT planejamento_orcamentario_classificacao_setor_responsavel_fkey;

ALTER TABLE public.planejamento_orcamentario_classificacao
  ALTER COLUMN setor_responsavel TYPE text[]
  USING CASE WHEN setor_responsavel IS NULL THEN NULL ELSE ARRAY[setor_responsavel] END;

-- ── 2. RLS: recorte de visibilidade por setor vira "algum setor da
-- Classificação bate com algum setor liberado da pessoa" ────────────────
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
          ON upper(btrim(s.setor)) = ANY (
            SELECT upper(btrim(x)) FROM unnest(c.setor_responsavel) AS x
          )
       WHERE c.id = _classificacao_id
         AND s.user_id = _user_id
         AND s.contexto = 'aprovacoes'
    )
  END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
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
--             ON upper(btrim(s.setor)) = upper(btrim(c.setor_responsavel[1]))
--          WHERE c.id = _classificacao_id
--            AND s.user_id = _user_id
--            AND s.contexto = 'aprovacoes'
--       )
--     END;
--   $$;
--   ALTER TABLE public.planejamento_orcamentario_classificacao
--     ALTER COLUMN setor_responsavel TYPE text
--     USING CASE WHEN setor_responsavel IS NULL THEN NULL ELSE setor_responsavel[1] END;
--   ALTER TABLE public.planejamento_orcamentario_classificacao
--     ADD CONSTRAINT planejamento_orcamentario_classificacao_setor_responsavel_fkey
--     FOREIGN KEY (setor_responsavel) REFERENCES public.setor_catalogo(nome)
--     ON UPDATE CASCADE ON DELETE SET NULL;
-- =====================================================================
