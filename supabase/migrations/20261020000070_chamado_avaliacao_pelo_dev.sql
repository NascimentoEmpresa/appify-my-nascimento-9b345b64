-- =====================================================================
-- Chamados de Sistemas › AVALIAÇÃO NAS DUAS PONTAS (20/10/2026).
--
-- Pedido do Pablo:
--   1. Solicitante: a trava "avalie antes de abrir outro" passa a valer só
--      com 3 avaliações pendentes. Com 1 ou 2 ele abre normalmente (a tela
--      avisa); na 3ª sem avaliar, só abre depois de avaliar.
--      Antes (mig 269/273/291 + participantes 20261009000003) a trava era
--      na PRIMEIRA pendente.
--   2. Desenvolvedor: a mesma mecânica (critérios de 1 a 5 + comentário
--      obrigatório quando não é nota cheia) para o dev avaliar QUEM PEDIU.
--      Uma avaliação por pessoa por chamado — o solicitante e cada
--      participante extra têm a sua. É pedida ao concluir, mas o dev pode
--      "Concluir sem avaliar": aqui não existe trava, só a tabela e o RLS.
--      Chamados concluídos antes desta mudança não entram em pendência
--      nenhuma — a tela só oferece avaliar chamado concluído daqui pra frente.
--
--   · CHAMADO_SISTEMA_AVALIACAO_DEV — tabela à parte, como a de participante:
--     CHAMADO_SISTEMA_AVALIACAO é UMA por chamado e várias telas leem com
--     maybeSingle.
--   · Quem vê: o próprio avaliador, o responsável do chamado e a gestão de
--     chamados. O avaliado NÃO vê a nota que recebeu (decisão de produto a
--     confirmar; abrir para ele é só uma linha na policy).
--   · chamados_ranking_solicitantes(): média por pessoa avaliada, para o
--     Painel de Distribuição. Só a gestão recebe linhas.
-- =====================================================================

-- ── 1. Solicitante: trava só com 3 pendentes ──────────────────────────
-- Mesmo corpo da mig 20260930000291 (desvio do encaminhamento de bug
-- preservado); muda só o EXISTS para contagem >= 3.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(current_setting('app.chamado_encaminhamento_bug', true) = 'on', false) THEN
    RETURN NEW;
  END IF;
  -- 3 = LIMITE_AVALIACOES_PENDENTES em src/pages/chamados/validacaoPresidencia.ts.
  IF (SELECT count(*) FROM public.chamado_pendencias_solicitante(NEW.solicitante_id)) >= 3 THEN
    RAISE EXCEPTION 'Você tem 3 chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 2. Avaliação feita pelo desenvolvedor ─────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_AVALIACAO_DEV" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id    uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  avaliado_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  avaliador_id  uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  papel         text NOT NULL CHECK (papel IN ('solicitante', 'participante')),
  -- Critérios e pesos: CRITERIOS_AVALIACAO_SOLICITANTE em src/pages/chamados/types.tsx.
  clareza       smallint NOT NULL CHECK (clareza       BETWEEN 1 AND 5),
  informacoes   smallint NOT NULL CHECK (informacoes   BETWEEN 1 AND 5),
  retorno       smallint NOT NULL CHECK (retorno       BETWEEN 1 AND 5),
  validacao     smallint NOT NULL CHECK (validacao     BETWEEN 1 AND 5),
  colaboracao   smallint NOT NULL CHECK (colaboracao   BETWEEN 1 AND 5),
  comentario    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chamado_id, avaliado_id),
  -- Mesma regra da avaliação do solicitante (mig 20260831000004): nota que
  -- não é cheia só entra explicando o que faltou.
  CONSTRAINT chamado_avaliacao_comentario_obrigatorio_dev CHECK (
    (clareza = 5 AND informacoes = 5 AND retorno = 5 AND validacao = 5 AND colaboracao = 5)
    OR (comentario IS NOT NULL AND length(btrim(comentario)) >= 10))
);
CREATE INDEX IF NOT EXISTS idx_chamado_avaliacao_dev_avaliado ON public."CHAMADO_SISTEMA_AVALIACAO_DEV"(avaliado_id);

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO_DEV" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_avaliacao_dev_select ON public."CHAMADO_SISTEMA_AVALIACAO_DEV";
CREATE POLICY chamado_avaliacao_dev_select ON public."CHAMADO_SISTEMA_AVALIACAO_DEV"
  FOR SELECT TO authenticated
  USING (avaliador_id = auth.uid()
         OR public.chamado_sistema_gestor()
         OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id AND c.responsavel_id = auth.uid()));

-- Inserir: quem conclui (o responsável ou a gestão), avaliando o solicitante
-- ou um participante extra DESTE chamado — nunca a si mesmo. O papel tem de
-- bater com o vínculo real, para o ranking não misturar.
DROP POLICY IF EXISTS chamado_avaliacao_dev_insert ON public."CHAMADO_SISTEMA_AVALIACAO_DEV";
CREATE POLICY chamado_avaliacao_dev_insert ON public."CHAMADO_SISTEMA_AVALIACAO_DEV"
  FOR INSERT TO authenticated
  WITH CHECK (
    avaliador_id = auth.uid()
    AND avaliado_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public."CHAMADO_SISTEMA" c
       WHERE c.id = chamado_id
         AND c.status NOT IN ('reprovado', 'cancelado')
         AND (c.responsavel_id = auth.uid() OR public.chamado_sistema_gestor())
         AND ((papel = 'solicitante' AND c.solicitante_id = avaliado_id)
              OR (papel = 'participante' AND public.chamado_eh_participante(c.id, avaliado_id)))));

GRANT SELECT, INSERT ON public."CHAMADO_SISTEMA_AVALIACAO_DEV" TO authenticated;

-- ── 3. Média por pessoa avaliada (Painel de Distribuição) ─────────────
-- Pesos = CRITERIOS_AVALIACAO_SOLICITANTE: Clareza 0,30 · Informações 0,20 ·
-- Retorno 0,20 · Validação 0,15 · Colaboração 0,15.
CREATE OR REPLACE FUNCTION public.chamados_ranking_solicitantes()
RETURNS TABLE(
  avaliado_id  uuid,
  nome         text,
  setor        text,
  avaliacoes   bigint,
  media        numeric,
  clareza      numeric,
  informacoes  numeric,
  retorno      numeric,
  validacao    numeric,
  colaboracao  numeric,
  ultimo_comentario text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.avaliado_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         (SELECT c.setor FROM public."CHAMADO_SISTEMA" c
           WHERE c.solicitante_id = a.avaliado_id AND c.setor IS NOT NULL
           ORDER BY c.created_at DESC LIMIT 1),
         count(*)::bigint,
         avg(a.clareza * 0.30 + a.informacoes * 0.20 + a.retorno * 0.20
             + a.validacao * 0.15 + a.colaboracao * 0.15)::numeric,
         avg(a.clareza)::numeric,
         avg(a.informacoes)::numeric,
         avg(a.retorno)::numeric,
         avg(a.validacao)::numeric,
         avg(a.colaboracao)::numeric,
         (array_agg(a.comentario ORDER BY a.created_at DESC) FILTER (WHERE a.comentario IS NOT NULL))[1]
    FROM public."CHAMADO_SISTEMA_AVALIACAO_DEV" a
    LEFT JOIN public.profiles p ON p.id = a.avaliado_id
   WHERE public.chamado_sistema_gestor()
   GROUP BY a.avaliado_id, p.display_name, p.email;
$$;
REVOKE ALL ON FUNCTION public.chamados_ranking_solicitantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_ranking_solicitantes() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamados_ranking_solicitantes();
-- DROP POLICY IF EXISTS chamado_avaliacao_dev_insert ON public."CHAMADO_SISTEMA_AVALIACAO_DEV";
-- DROP POLICY IF EXISTS chamado_avaliacao_dev_select ON public."CHAMADO_SISTEMA_AVALIACAO_DEV";
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_AVALIACAO_DEV";
-- Trava do solicitante: recriar chamado_sistema_bloqueia_avaliacao_pendente
-- como na mig 20260930000291 (IF EXISTS em vez de count(*) >= 3).
