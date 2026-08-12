-- =====================================================================
-- CHAMADOS — avaliação: comentário obrigatório quando não é nota cheia,
--                       e as notas UMA A UMA para a coordenação
--
-- POR QUE
-- Duas dores do mesmo pedido:
--   1. Nota baixa chegava sem explicação nenhuma — dava pra ver que caiu, não
--      ONDE melhorar. Agora, se qualquer critério sair abaixo de 5, o
--      comentário passa a ser obrigatório.
--   2. O Painel de Distribuição só mostrava a MÉDIA por integrante. Não dava
--      pra saber quem deu cada nota nem o que a pessoa escreveu.
--
-- O QUE MUDA
--   1. CHECK chamado_avaliacao_comentario_obrigatorio — a regra vale no banco,
--      não só na tela (a tela pode ser contornada; o banco não).
--      Entra como NOT VALID de propósito: as avaliações que já existem ficam
--      como estão (não dá pra pedir comentário retroativo a quem já avaliou),
--      e a exigência vale da migration em diante.
--   2. chamados_avaliacoes_detalhe() — cada avaliação com quem deu a nota, o
--      chamado, o responsável avaliado, os 6 critérios e o comentário.
--      Só a gestão de chamados enxerga.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Comentário obrigatório quando não é 5 em tudo ─────────────────
ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  DROP CONSTRAINT IF EXISTS chamado_avaliacao_comentario_obrigatorio;

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  ADD CONSTRAINT chamado_avaliacao_comentario_obrigatorio CHECK (
    (qualidade = 5 AND prazo = 5 AND comunicacao = 5
     AND clareza = 5 AND facilidade = 5 AND satisfacao = 5)
    OR (comentario IS NOT NULL AND length(btrim(comentario)) >= 10)
  ) NOT VALID;

COMMENT ON CONSTRAINT chamado_avaliacao_comentario_obrigatorio
  ON public."CHAMADO_SISTEMA_AVALIACAO" IS
  'Nota cheia (5 em tudo) dispensa comentário; qualquer critério abaixo de 5 exige pelo menos 10 caracteres explicando o que melhorar.';

-- ── 2. Avaliações uma a uma (para a coordenação) ─────────────────────
DROP FUNCTION IF EXISTS public.chamados_avaliacoes_detalhe();

CREATE OR REPLACE FUNCTION public.chamados_avaliacoes_detalhe()
RETURNS TABLE(
  avaliacao_id   uuid,
  chamado_id     uuid,
  numero         text,
  assunto        text,
  responsavel_id uuid,
  avaliador_id   uuid,
  avaliador_nome text,
  setor          text,
  qualidade      smallint,
  prazo          smallint,
  comunicacao    smallint,
  clareza        smallint,
  facilidade     smallint,
  satisfacao     smallint,
  comentario     text,
  created_at     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id, c.id, c.numero, c.assunto, c.responsavel_id,
         a.solicitante_id,
         -- O nome do perfil é a fonte boa; solicitante_nome do chamado é o
         -- retrato de quem abriu e serve de reserva.
         COALESCE(NULLIF(btrim(p.display_name), ''),
                  NULLIF(btrim(p.email), ''),
                  NULLIF(btrim(c.solicitante_nome), ''),
                  'Usuário'),
         c.setor,
         a.qualidade, a.prazo, a.comunicacao, a.clareza, a.facilidade, a.satisfacao,
         a.comentario, a.created_at
    FROM public."CHAMADO_SISTEMA_AVALIACAO" a
    JOIN public."CHAMADO_SISTEMA" c ON c.id = a.chamado_id
    LEFT JOIN public.profiles p ON p.id = a.solicitante_id
   WHERE public.chamado_sistema_gestor()
   ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.chamados_avaliacoes_detalhe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_avaliacoes_detalhe() TO authenticated;

COMMENT ON FUNCTION public.chamados_avaliacoes_detalhe() IS
  'Avaliações individuais (quem deu a nota, critérios e comentário) para o Painel de Distribuição. Só gestão.';

-- ── Conferência ──────────────────────────────────────────────────────
-- Quantas avaliações JÁ EXISTENTES não passariam na nova regra (ficam
-- válidas pelo NOT VALID; é só pra saber o tamanho do buraco de informação).
SELECT count(*) FILTER (
         WHERE NOT (qualidade = 5 AND prazo = 5 AND comunicacao = 5
                    AND clareza = 5 AND facilidade = 5 AND satisfacao = 5)
           AND (comentario IS NULL OR length(btrim(comentario)) < 10)
       ) AS sem_comentario_antigas,
       count(*) AS total
  FROM public."CHAMADO_SISTEMA_AVALIACAO";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
--     DROP CONSTRAINT IF EXISTS chamado_avaliacao_comentario_obrigatorio;
--   DROP FUNCTION IF EXISTS public.chamados_avaliacoes_detalhe();
-- =====================================================================
