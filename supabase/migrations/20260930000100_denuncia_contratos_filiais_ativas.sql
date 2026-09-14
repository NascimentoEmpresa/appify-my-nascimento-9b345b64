-- =========================================================================
-- Canal de Ética: "Qual o seu local de trabalho?" lista FILIAIS ATIVAS
--
-- O PEDIDO (11/09/2026)
--   O campo vira obrigatório e a lista tem que ser a das filiais da empresa
--   escolhida — escolhi "NH", só filiais da NH — e sem filial inativa.
--
-- O QUE ESTAVA
--   `denuncia_contratos` devolvia "Descrição do Local" distinta (o POSTO do
--   organograma: "1109 - DECA", "PALÁCIO DA POLÍCIA"...) filtrando por
--   "Nome da Empresa" ILIKE padrão — coluna que está NULL ou trocada em parte
--   do cadastro (há NH com "Empresa" = 2 e Nascimento com "Empresa" = 5).
--
-- O QUE FICA
--   • CANAL_DENUNCIA_EMPRESA ganha `senior_empresa` (1 Nascimento, 2 SN,
--     3 Canaa, 5 NH): a chave firme da empresa no cadastro de pessoal.
--   • A lista é o "Nome Filial" ("1109 - POLICIA CIVIL RS LIMPEZA 066.2026")
--     das linhas com "Empresa" = senior_empresa e alguém TRABALHANDO — filial
--     sem ninguém ativo é filial inativa e não aparece.
--   • Empresa sem `senior_empresa` cai no padrão antigo (por nome), para
--     não zerar a lista de quem ainda não configurou.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."CANAL_DENUNCIA_EMPRESA"
  ADD COLUMN IF NOT EXISTS senior_empresa smallint;
COMMENT ON COLUMN public."CANAL_DENUNCIA_EMPRESA".senior_empresa IS
  'Código da empresa no Senior (EMPREGADOS."Empresa"): 1 Nascimento, 2 SN, 3 Canaa, 5 NH. É por ele que o canal lista as filiais da empresa.';

UPDATE public."CANAL_DENUNCIA_EMPRESA" SET senior_empresa = v.cod
  FROM (VALUES ('Nascimento', 1), ('SN', 2), ('Canaa', 3), ('NH', 5)) AS v(rotulo, cod)
 WHERE "CANAL_DENUNCIA_EMPRESA".rotulo = v.rotulo AND senior_empresa IS DISTINCT FROM v.cod;

CREATE OR REPLACE FUNCTION public.denuncia_contratos(p_empresa_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_padrao text;
  v_senior smallint;
  v_itens  jsonb;
BEGIN
  SELECT e.padrao_empregados, e.senior_empresa INTO v_padrao, v_senior
    FROM public."CANAL_DENUNCIA_EMPRESA" e WHERE e.id = p_empresa_id AND e.ativo;

  SELECT COALESCE(jsonb_agg(x.filial ORDER BY x.filial), '[]'::jsonb) INTO v_itens
    FROM (
      SELECT DISTINCT btrim(e."Nome Filial") AS filial
        FROM public."EMPREGADOS" e
       WHERE COALESCE(btrim(e."Nome Filial"), '') <> ''
         -- Filial ativa = tem alguém trabalhando nela hoje.
         AND e."Situação" = 'Trabalhando'
         AND CASE
               WHEN v_senior IS NOT NULL THEN e."Empresa" = v_senior
               WHEN v_padrao IS NOT NULL THEN e."Nome da Empresa" ILIKE v_padrao
               ELSE true
             END
    ) x;

  RETURN jsonb_build_object('contratos', v_itens);
END $fn$;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- SELECT rotulo, jsonb_array_length(public.denuncia_contratos(id)->'contratos') AS filiais
--   FROM public."CANAL_DENUNCIA_EMPRESA" ORDER BY ordem;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (recriar denuncia_contratos pela versão anterior — Descrição do Local por padrão de nome)
-- ALTER TABLE public."CANAL_DENUNCIA_EMPRESA" DROP COLUMN IF EXISTS senior_empresa;
-- NOTIFY pgrst, 'reload schema';
