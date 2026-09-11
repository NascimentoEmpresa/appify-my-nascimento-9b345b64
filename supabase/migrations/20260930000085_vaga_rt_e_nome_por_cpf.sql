-- =========================================================================
-- Duas coisas do Recrutamento
--   1. A vaga passa a dizer se é Reposição Técnica (RT).
--   2. O portal público preenche o nome sozinho a partir do CPF.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1. Reposição Técnica ─────────────────────────────────────────────────
-- Pergunta de sim/não na etapa 2 do "Solicitar Nova Vaga". Coluna própria e
-- não um texto dentro de `observacoes`: RT é o tipo de coisa que vira filtro e
-- contagem no primeiro mês de uso, e texto livre não se agrupa.
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS reposicao_tecnica boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".reposicao_tecnica IS
  'A vaga é Reposição Técnica (RT)? Perguntado na etapa 2 da solicitação.';

-- ── 2. Nome pelo CPF, no portal público ──────────────────────────────────
/**
 * Devolve o nome de quem está se candidatando, para a tela preencher sozinha.
 *
 * ⚠ POR QUE PEDE A DATA DE NASCIMENTO JUNTO, E NÃO SÓ O CPF
 *
 *   Esta função é chamada da página /vagas, que é PÚBLICA — roda para `anon`,
 *   sem login. Uma função que traduz CPF em nome completo, aberta na internet,
 *   é uma máquina de descobrir nome alheio: lista de CPF se compra aos milhões,
 *   e quem quisesse era só varrer. Como ela enxerga EMPREGADOS, o que vazaria
 *   seria o quadro de pessoal inteiro (13.271 nomes hoje).
 *
 *   Exigir CPF **e** data de nascimento fecha isso: quem já sabe os dois não
 *   está descobrindo nada — está provando que os dados são dele. E não custa
 *   nada à pessoa certa, porque o formulário já pede a data de nascimento
 *   logo acima do CPF.
 *
 *   Errou um dos dois? Devolve NULL. Nunca "achei o CPF mas a data não bate":
 *   isso confirmaria que o CPF existe no cadastro, que é metade do vazamento.
 *
 * A ORDEM DAS FONTES importa: primeiro o que a própria pessoa já preencheu
 * numa candidatura anterior, depois o cadastro de pessoal. Se ela se
 * candidatou com um nome, é esse que ela espera ver de volta.
 */
CREATE OR REPLACE FUNCTION public.portal_nome_por_cpf(
  p_cpf         text,
  p_nascimento  date
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cpf  text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_nome text;
BEGIN
  -- Sem os dois, não responde. Vale também para CPF curto/colado errado.
  IF length(v_cpf) <> 11 OR p_nascimento IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fonte 1: candidatura anterior dela mesma.
  SELECT btrim(c.nome) INTO v_nome
    FROM public."WA_CURRICULOS" c
   WHERE regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = v_cpf
     AND c.data_nascimento = p_nascimento
     AND nullif(btrim(c.nome), '') IS NOT NULL
   ORDER BY c.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_nome IS NOT NULL THEN
    RETURN v_nome;
  END IF;

  -- Fonte 2: cadastro de pessoal. `Nascimento` é texto e vem em dois
  -- formatos (ISO na maioria, DD/MM/AAAA na minoria) — daí o conversor, em
  -- vez de um cast que estouraria na metade das linhas.
  SELECT btrim(e."Nome") INTO v_nome
    FROM public."EMPREGADOS" e
   WHERE regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') = v_cpf
     AND public.rh_data_br_para_date(e."Nascimento") = p_nascimento
     AND nullif(btrim(e."Nome"), '') IS NOT NULL
   ORDER BY e."ID" DESC
   LIMIT 1;

  RETURN v_nome;
END $fn$;

COMMENT ON FUNCTION public.portal_nome_por_cpf(text, date) IS
  'Portal público: nome completo a partir de CPF + data de nascimento (os dois, sempre). Devolve NULL se qualquer um não bater — nunca revela que o CPF existe.';

-- `anon` PRECISA executar: a página /vagas é aberta, sem login. É a exceção
-- deliberada à regra de revogar de anon — e é justamente por ela estar aberta
-- que a função exige os dois dados.
REVOKE ALL ON FUNCTION public.portal_nome_por_cpf(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_nome_por_cpf(text, date) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_nome_por_cpf(text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- Acerto: CPF + nascimento corretos de alguém do cadastro devolvem o nome.
-- Erro:   mesmo CPF com a data errada devolve NULL (não "existe mas errou").
SELECT
  (SELECT public.portal_nome_por_cpf(e."CPF", public.rh_data_br_para_date(e."Nascimento"))
     FROM public."EMPREGADOS" e
    WHERE nullif(btrim(e."CPF"), '') IS NOT NULL
      AND public.rh_data_br_para_date(e."Nascimento") IS NOT NULL
    LIMIT 1) AS com_os_dois_certos,
  (SELECT public.portal_nome_por_cpf(e."CPF", DATE '1900-01-01')
     FROM public."EMPREGADOS" e
    WHERE nullif(btrim(e."CPF"), '') IS NOT NULL
      AND public.rh_data_br_para_date(e."Nascimento") IS NOT NULL
    LIMIT 1) AS com_a_data_errada;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.portal_nome_por_cpf(text, date);
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS reposicao_tecnica;
-- NOTIFY pgrst, 'reload schema';
