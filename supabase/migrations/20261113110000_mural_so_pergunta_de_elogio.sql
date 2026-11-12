-- =========================================================================
-- MURAL DO INÍCIO — SÓ A PERGUNTA DE ELOGIO ENTRA (INCIDENTE 12/11/2026)
--
-- O INCIDENTE
--   A AVALIAÇÃO DE RECONHECIMENTO E CONVIVÊNCIA PROFISSIONAL tem DUAS
--   perguntas do tipo "colegas":
--     1. "Quem se destacou positivamente para você neste mês?"
--     2. "Quem pode melhorar algum comportamento ou atitude profissional?"
--   O mural (20261030003200) foi escrito supondo UMA pergunta "colegas" por
--   formulário e decidia "positivo" só pela NOTA (>= 80% da escala). Mas
--   cs_form_mural_linhas lia TODAS as perguntas "colegas". Na pergunta 2 a
--   nota alta não é elogio — é "precisa melhorar muito". Resultado: em
--   set/2026, 3 comentários da pergunta 2 com nota 5 (um deles com ofensas a
--   um gestor) entraram na fila como "positivos" e foram ao Início junto
--   com os 245 da pergunta 1. Os 245 de setembro foram tirados do Início na
--   mesma tarde (todos voltaram a pendente).
--
-- A CORREÇÃO
--   Só entra no mural a pergunta "colegas" MARCADA para isso:
--   config.mural = true (o editor ganha a caixa "Vai para o Mural do Início").
--   Para não apagar formulários antigos de uma pergunta só: formulário SEM
--   nenhuma pergunta marcada e com UMA única pergunta "colegas" continua como
--   antes. Formulário com duas ou mais e nenhuma marcada → nada vai ao mural
--   até alguém marcar a de elogio. Na dúvida, não publica.
--
--   A marcação deste formulário é feita aqui: a pergunta 1
--   (293b7ed3-d8e4-45f9-939c-d952a1115a1e) do formulário 0420161a-….
--
--   Vale para a fila de moderação, para a liberação e para o Início — as três
--   leem cs_form_mural_linhas. Decisões já gravadas de linhas da pergunta 2
--   ficam na tabela, mas não aparecem em lugar nenhum.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Esta pergunta "colegas" vai para o mural? ─────────────────────────
-- Marcada (config.mural = true) → sim. Sem nenhuma marcada no formulário →
-- só se ela for a ÚNICA pergunta "colegas" (o caso antigo). Desmarcada de
-- propósito (config.mural = false) → nunca.
CREATE OR REPLACE FUNCTION public.cs_form_mural_pergunta_vale(_perguntas jsonb, _p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(_p->>'tipo', '') <> 'colegas' THEN false
    WHEN lower(coalesce(_p->'config'->>'mural', '')) = 'true'  THEN true
    WHEN lower(coalesce(_p->'config'->>'mural', '')) = 'false' THEN false
    WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_perguntas, '[]'::jsonb)) q
                  WHERE q->>'tipo' = 'colegas' AND lower(coalesce(q->'config'->>'mural', '')) = 'true') THEN false
    ELSE (SELECT count(*) FROM jsonb_array_elements(coalesce(_perguntas, '[]'::jsonb)) q
           WHERE q->>'tipo' = 'colegas') = 1
  END;
$$;
GRANT EXECUTE ON FUNCTION public.cs_form_mural_pergunta_vale(jsonb, jsonb) TO authenticated;

-- ── 2) A pergunta de elogio da Avaliação de Reconhecimento ───────────────
-- Marca a pergunta 1 como a do mural e a 2 ("Quem pode melhorar") como fora.
-- Sem o formulário (banco de teste), não faz nada.
UPDATE public."CS_FORMULARIOS" f
   SET perguntas = (
     SELECT jsonb_agg(
              CASE
                WHEN q->>'id' = '293b7ed3-d8e4-45f9-939c-d952a1115a1e'
                  THEN q || jsonb_build_object('config', coalesce(q->'config', '{}'::jsonb) || '{"mural": true}'::jsonb)
                WHEN q->>'tipo' = 'colegas'
                  THEN q || jsonb_build_object('config', coalesce(q->'config', '{}'::jsonb) || '{"mural": false}'::jsonb)
                ELSE q
              END ORDER BY ord)
       FROM jsonb_array_elements(f.perguntas) WITH ORDINALITY t(q, ord))
 WHERE f.id = '0420161a-665e-42a4-9af6-c853a107f614'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.perguntas) q
                WHERE q->>'id' = '293b7ed3-d8e4-45f9-939c-d952a1115a1e');

-- ── 3) As linhas do mural: só a pergunta que vale ───────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_mural_linhas(_form_id uuid, _ini timestamptz, _fim timestamptz)
RETURNS TABLE (
  resposta_id uuid, formulario_id uuid, formulario text, pergunta_id text, linha integer,
  colaborador text, setor text, nota text, escala integer, comentario text,
  enviado_em timestamptz, assinatura text, positivo boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT x.resposta_id, x.formulario_id, x.formulario, x.pergunta_id, x.linha,
         x.colaborador, x.setor, x.nota, x.escala, x.comentario, x.enviado_em,
         md5(upper(x.colaborador) || '|' || x.comentario),
         public.cs_form_mural_positivo(x.nota, x.comentario, x.escala)
    FROM (
      SELECT r.id AS resposta_id, r.formulario_id, f.titulo::text AS formulario,
             p->>'id' AS pergunta_id, (l.ord - 1)::int AS linha,
             btrim(l.v->>'colaborador') AS colaborador,
             nullif(btrim(coalesce(l.v->>'setor', '')), '') AS setor,
             nullif(btrim(coalesce(l.v->>'nota', '')), '') AS nota,
             CASE WHEN coalesce(p->'config'->>'escala_max', '') ~ '^[0-9]+$'
                  THEN (p->'config'->>'escala_max')::int ELSE 5 END AS escala,
             btrim(coalesce(l.v->>'comentario', '')) AS comentario,
             r.enviado_em
        FROM public."CS_FORM_RESPOSTAS" r
        JOIN public."CS_FORMULARIOS" f ON f.id = r.formulario_id AND f.deleted_at IS NULL
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.perguntas, '[]'::jsonb)) p
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.itens -> (p->>'id')) = 'array'
               THEN r.itens -> (p->>'id') ELSE '[]'::jsonb END) WITH ORDINALITY l(v, ord)
       WHERE p->>'tipo' = 'colegas'
         AND public.cs_form_mural_pergunta_vale(f.perguntas, p)
         AND (_form_id IS NULL OR r.formulario_id = _form_id)
         AND r.enviado_em >= _ini AND r.enviado_em < _fim
         AND jsonb_typeof(l.v) = 'object'
         AND btrim(coalesce(l.v->>'colaborador', '')) <> ''
    ) x;
$$;
REVOKE ALL ON FUNCTION public.cs_form_mural_linhas(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 4) Conferência: perguntas "colegas" e se vão para o mural ───────────
SELECT f.titulo, q->>'id' AS pergunta, left(coalesce(q->>'titulo', q->>'texto', ''), 60) AS texto,
       public.cs_form_mural_pergunta_vale(f.perguntas, q) AS vai_ao_mural
  FROM public."CS_FORMULARIOS" f
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(f.perguntas, '[]'::jsonb)) q
 WHERE f.deleted_at IS NULL AND q->>'tipo' = 'colegas';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (reabre o incidente — só em emergência)
--   Recriar cs_form_mural_linhas como em 20261030003200 (sem a linha
--   `AND public.cs_form_mural_pergunta_vale(f.perguntas, p)`) e
--   DROP FUNCTION IF EXISTS public.cs_form_mural_pergunta_vale(jsonb, jsonb);
--   (a marca config.mural nas perguntas pode ficar: nada mais a lê)
-- =========================================================================
