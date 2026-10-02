-- =========================================================================
-- EMPREGADOS: CPF sempre no padrão 000.000.000-00 (02/10/2026)
--
-- INCIDENTE 02/10/2026: SUELEN RAMOS BRONGAR não entrava no Portal do
-- Colaborador (treinamentos) — "Seu cadastro consta como desligado". Ela tem
-- DOIS cadastros: o antigo (ID 8421, CPF "022.229.960-66", Demitido) e o
-- readmitido em 22/09/2026 (ID 13683, Trabalhando), que o sync da Senior
-- gravou como "2222996066": a Senior guarda numcpf como NÚMERO e o zero à
-- esquerda some. O login procura o CPF por igualdade (formatado ou 11
-- dígitos), não achava o cadastro novo e caía no demitido.
--
-- Não era só ela: 817 linhas fora do padrão (509 com 11 dígitos sem
-- pontuação, 308 com zero perdido), 186 delas de quem NÃO está demitido.
-- Todo cadastro inserido pelo sync desde a mig 275 nasce assim.
--
-- Correção:
--   1) rh_fmt_cpf(): dígitos → completa zeros à esquerda até 11 → máscara.
--   2) Gatilho BEFORE INSERT/UPDATE OF "CPF" no EMPREGADOS: qualquer caminho
--      (sync da Senior, importação, tela) grava no padrão.
--   3) Padroniza as linhas atuais (backup em EMPREGADOS_CPF_BKP).
--   4) col_empregado_por_cpf compara pelos DÍGITOS (sem zero à esquerda),
--      não pelo texto — formato nenhum volta a esconder cadastro.
--
-- Regra de acesso dos treinamentos (Pablo, 02/10): só não entra quem está
-- DEMITIDO (Cod Situacao 7). Férias, auxílio-doença, licença, atestado etc.
-- entram. É o que col_desligado já faz pelo texto ("Demitido" = cód. 7 em
-- todas as 10.884 linhas; as 22 sem código também são "Demitido").
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Formatação ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_fmt_cpf(_t text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE d text := regexp_replace(coalesce(_t, ''), '\D', '', 'g');
BEGIN
  IF d = '' THEN RETURN nullif(btrim(coalesce(_t, '')), ''); END IF;
  -- Mais de 11 dígitos não é CPF: deixa como veio para alguém olhar.
  IF length(d) > 11 THEN RETURN btrim(_t); END IF;
  d := lpad(d, 11, '0');
  RETURN substr(d,1,3) || '.' || substr(d,4,3) || '.' || substr(d,7,3) || '-' || substr(d,10,2);
END $$;

-- ── 2) Gatilho ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_empregados_cpf_padrao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW."CPF" := public.rh_fmt_cpf(NEW."CPF");
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rh_empregados_cpf_padrao ON public."EMPREGADOS";
CREATE TRIGGER trg_rh_empregados_cpf_padrao BEFORE INSERT OR UPDATE OF "CPF" ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.rh_empregados_cpf_padrao();

-- ── 3) Linhas atuais ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_CPF_BKP" (
  empregado_id bigint PRIMARY KEY,
  cpf_antigo   text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
-- Guarda CPF: RLS ligada e sem policy (só service_role / SQL Editor leem).
ALTER TABLE public."EMPREGADOS_CPF_BKP" ENABLE ROW LEVEL SECURITY;

INSERT INTO public."EMPREGADOS_CPF_BKP"(empregado_id, cpf_antigo)
SELECT e."ID", e."CPF" FROM public."EMPREGADOS" e
 WHERE e."CPF" IS DISTINCT FROM public.rh_fmt_cpf(e."CPF")
ON CONFLICT (empregado_id) DO NOTHING;

UPDATE public."EMPREGADOS" e
   SET "CPF" = public.rh_fmt_cpf(e."CPF")
 WHERE e."CPF" IS DISTINCT FROM public.rh_fmt_cpf(e."CPF");

-- ── 4) Login do Portal do Colaborador ────────────────────────────────────
-- O cadastro de um CPF: quem não está desligado primeiro, depois a admissão
-- mais recente (readmitido tem várias linhas e vale a atual). Compara pelos
-- dígitos sem zero à esquerda — igual ao rh_norm_doc do sync.
CREATE OR REPLACE FUNCTION public.col_empregado_por_cpf(p_cpf text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpf text := public.col_digitos(p_cpf); v_id bigint;
BEGIN
  IF length(v_cpf) <> 11 THEN RETURN NULL; END IF;
  SELECT e."ID" INTO v_id
    FROM public."EMPREGADOS" e
   WHERE e."CPF" = public.rh_fmt_cpf(v_cpf)
      OR public.rh_norm_doc(e."CPF") = public.rh_norm_doc(v_cpf)
   ORDER BY public.col_desligado(e."Situação") ASC,
            public.rh_data(e."Admissão"::text) DESC NULLS LAST,
            e."ID" DESC
   LIMIT 1;
  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rh_empregados_cpf_padrao ON public."EMPREGADOS";
-- DROP FUNCTION IF EXISTS public.rh_empregados_cpf_padrao();
-- UPDATE public."EMPREGADOS" e SET "CPF" = b.cpf_antigo
--   FROM public."EMPREGADOS_CPF_BKP" b WHERE b.empregado_id = e."ID";
-- Reaplicar col_empregado_por_cpf da 20260930000196 (WHERE e."CPF" IN (v_cpf, v_fmt)).
-- NOTIFY pgrst, 'reload schema';
