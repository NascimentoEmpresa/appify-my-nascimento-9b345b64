-- =========================================================================
-- RH — tabela SITUACOES e a coluna "Cod Situacao" em EMPREGADOS
--
-- `BiEmpregados.sitafa` e a SITUACAO ATUAL do colaborador (7 = Demitido,
-- 1 = Trabalhando, 3 = Auxilio Doenca...), nao a data de afastamento. Ate
-- aqui a sincronizacao gravava so a DESCRICAO, em "Situação". Passa a
-- gravar tambem o CODIGO, que e o que casa com a tabela de dominio.
--
-- CUIDADO COM O TIPO — no Senior os dois lados nao batem sozinhos:
--   BiEmpregados.sitafa   smallint      -> 7
--   BiSituacoes.situacao  varchar(10)   -> "007"  (com zero a esquerda)
-- O MySQL casa por coercao implicita. Aqui os dois viram INTEGER, o que
-- mata essa armadilha: "007" e 7 passam a ser o mesmo valor sempre.
--
-- SEM foreign key de EMPREGADOS para SITUACOES de proposito: a EMPREGADOS
-- tem 13 mil linhas de carga historica e uma FK faria a sincronizacao
-- inteira falhar por causa de um codigo novo que o Senior criasse antes de
-- a dimensao ser replicada. O indice resolve a consulta; a integridade e
-- garantida pelo robo, que replica SITUACOES antes dos empregados.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."EMPREGADOS" DROP COLUMN IF EXISTS "Cod Situacao";
--   DROP FUNCTION IF EXISTS public.rh_sync_senior_situacoes(jsonb);
--   DROP TABLE IF EXISTS public."SITUACOES";
-- =========================================================================

-- ── 1) Dimensao: replica da BiSituacoes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SITUACOES" (
  codigo          integer PRIMARY KEY,
  descricao       text NOT NULL,
  abreviatura     text,
  tipo            text,
  tipo_descricao  text,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SITUACOES" IS
  'Situacoes do colaborador, replicadas de hagg.BiSituacoes (Senior). Casa com EMPREGADOS."Cod Situacao".';

ALTER TABLE public."SITUACOES" ENABLE ROW LEVEL SECURITY;

-- Tabela de dominio: quem esta logado le (as telas precisam do rotulo).
-- Escrita so pelo robo — nao ha GRANT de INSERT/UPDATE para authenticated.
DROP POLICY IF EXISTS situacoes_select ON public."SITUACOES";
CREATE POLICY situacoes_select ON public."SITUACOES" FOR SELECT TO authenticated USING (true);

-- ── 2) O codigo no cadastro ─────────────────────────────────────────────
ALTER TABLE public."EMPREGADOS"
  ADD COLUMN IF NOT EXISTS "Cod Situacao" integer;

COMMENT ON COLUMN public."EMPREGADOS"."Cod Situacao" IS
  'Codigo da situacao atual (BiEmpregados.sitafa). Casa com SITUACOES.codigo. "Situação" guarda a descricao.';

CREATE INDEX IF NOT EXISTS empregados_cod_situacao_idx
  ON public."EMPREGADOS" ("Cod Situacao");

-- ── 3) Sincronizacao da dimensao ────────────────────────────────────────
-- Upsert simples: a BiSituacoes tem 110 linhas e o codigo e a chave.
CREATE OR REPLACE FUNCTION public.rh_sync_senior_situacoes(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_qtd int := 0;
BEGIN
  INSERT INTO public."SITUACOES" (codigo, descricao, abreviatura, tipo, tipo_descricao, atualizado_em)
  SELECT x.codigo, x.descricao, x.abreviatura, x.tipo, x.tipo_descricao, now()
    FROM jsonb_to_recordset(coalesce(_linhas, '[]'::jsonb)) AS x(
           codigo integer, descricao text, abreviatura text, tipo text, tipo_descricao text)
   WHERE x.codigo IS NOT NULL AND coalesce(btrim(x.descricao), '') <> ''
      ON CONFLICT (codigo) DO UPDATE
         SET descricao      = EXCLUDED.descricao,
             abreviatura    = EXCLUDED.abreviatura,
             tipo           = EXCLUDED.tipo,
             tipo_descricao = EXCLUDED.tipo_descricao,
             atualizado_em  = now()
       WHERE public."SITUACOES".descricao      IS DISTINCT FROM EXCLUDED.descricao
          OR public."SITUACOES".abreviatura    IS DISTINCT FROM EXCLUDED.abreviatura
          OR public."SITUACOES".tipo           IS DISTINCT FROM EXCLUDED.tipo
          OR public."SITUACOES".tipo_descricao IS DISTINCT FROM EXCLUDED.tipo_descricao;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN jsonb_build_object('gravadas', v_qtd);
END $$;

REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_situacoes(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
