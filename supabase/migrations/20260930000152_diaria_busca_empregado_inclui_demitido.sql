-- =====================================================================
-- Controle de Diárias — o Faltante também pode ser quem já saiu da empresa.
--
-- Chamado #SIS-2026-0410: "ao acessar a solicitação de diárias o sistema não
-- está puxando funcionários que já foram demitidos. No caso a diária seria
-- para cobrir um posto do funcionário que não está mais na empresa, não
-- faltas e atestado de colaborador ativo."
--
-- Causa: diaria_buscar_empregados() (criada em 20260930000019 e regravada em
-- 20260930000065 só para trocar o gate de permissão) filtra
-- `upper("Situação") <> ALL (ARRAY['DEMITIDO','DEMITIDA','RESCISÃO',
-- 'DESLIGADO','DESLIGADA'])`. A premissa era que diária cobre falta de quem
-- está trabalhando; na prática o caso mais comum é justamente cobrir o posto
-- que ficou vago com o desligamento, e aí o nome nunca aparecia no
-- autocomplete.
--
-- Correção:
--   1) A lista deixa de esconder desligados. A "Situação" continua saindo na
--      RPC e agora o front mostra o rótulo em cada sugestão, para o
--      encarregado ver que está escolhendo alguém demitido — informar, não
--      bloquear.
--   2) Ordenação põe quem está na ativa antes de quem saiu (mesmo nome
--      digitado, o colaborador atual vem primeiro), e só então por nome.
--   3) Mínimo de 3 caracteres (era 2). "EMPREGADOS" passa de 10 mil linhas e
--      a varredura é sequencial (regexp por linha): 2 caracteres varriam a
--      tabela inteira devolvendo o teto de 30 nomes irrelevantes. O front
--      pede o mesmo mínimo antes de disparar a query.
--
-- O filtro de nomes com "teste" continua — são cadastros de homologação.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.diaria_buscar_empregados(p_termo text)
RETURNS TABLE (
  empregado_id bigint,
  nome         text,
  cpf          text,
  cargo        text,
  situacao     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      text := btrim(coalesce(p_termo, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
  v_fora   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RETURN;  -- sem a tela liberada → sem resultados
  END IF;
  IF length(v_q) < 3 THEN
    RETURN;  -- mesmo piso do campo na tela: nada de varrer a tabela por 2 letras
  END IF;

  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
      FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Situação"
    FROM public."EMPREGADOS" e
   WHERE coalesce(e."Nome", '') NOT ILIKE '%teste%'
     AND (
       ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
         AND NOT EXISTS (
           SELECT 1 FROM unnest(v_tokens) t
            WHERE t <> ''
              AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
                  NOT LIKE '%' || t || '%'
         )
       )
       OR ( length(v_digits) >= 3
            AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%' )
     )
   ORDER BY (upper(coalesce(e."Situação", '')) = ANY (v_fora)), e."Nome"
   LIMIT 30;
END $$;

REVOKE ALL ON FUNCTION public.diaria_buscar_empregados(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_buscar_empregados(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (volta ao corpo de 20260930000065: esconde desligados e
-- aceita busca com 2 caracteres)
--
-- CREATE OR REPLACE FUNCTION public.diaria_buscar_empregados(p_termo text)
-- RETURNS TABLE (
--   empregado_id bigint,
--   nome         text,
--   cpf          text,
--   cargo        text,
--   situacao     text
-- )
-- LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_q      text   := btrim(coalesce(p_termo, ''));
--   v_digits text   := regexp_replace(v_q, '\D', '', 'g');
--   v_tokens text[];
--   v_bloq   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
-- BEGIN
--   IF NOT public.diaria_pode('visualizar') THEN
--     RETURN;
--   END IF;
--   IF length(v_q) < 2 THEN
--     RETURN;
--   END IF;
--   v_tokens := ARRAY(
--     SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
--       FROM regexp_split_to_table(v_q, '\s+') AS w
--   );
--   RETURN QUERY
--   SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Situação"
--     FROM public."EMPREGADOS" e
--    WHERE upper(coalesce(e."Situação", '')) <> ALL (v_bloq)
--      AND coalesce(e."Nome", '') NOT ILIKE '%teste%'
--      AND (
--        ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
--          AND NOT EXISTS (
--            SELECT 1 FROM unnest(v_tokens) t
--             WHERE t <> ''
--               AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
--                   NOT LIKE '%' || t || '%'
--          )
--        )
--        OR ( length(v_digits) >= 3
--             AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%' )
--      )
--    ORDER BY e."Nome"
--    LIMIT 30;
-- END $$;
-- NOTIFY pgrst, 'reload schema';
