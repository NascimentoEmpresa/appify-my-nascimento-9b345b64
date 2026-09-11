-- =========================================================================
-- Vaga: "Você já tem recomendação para essa vaga?"
--
-- Etapa 3 da solicitação. Respondendo "Sim", quem abre a vaga informa nome
-- completo, CPF e WhatsApp de quem está indicando — a pessoa já entra no
-- processo com um candidato em mãos, em vez de o Recrutamento descobrir isso
-- por WhatsApp depois.
--
-- COLUNAS SEPARADAS, E NÃO UM TEXTO EM `observacao_importante`
--   É onde essa informação ia parar hoje. Só que CPF dentro de texto livre
--   não casa com candidato, não vira contagem ("quantas vagas vieram com
--   indicação?") e não dá para o Recrutamento filtrar. Três campos com nome
--   próprio resolvem os três.
--
-- O `tem_recomendacao` existe além dos três campos porque "não tem indicação"
-- e "tem, mas ninguém preencheu ainda" são coisas diferentes — e só a
-- primeira é uma resposta.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS tem_recomendacao      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recomendacao_nome     text,
  ADD COLUMN IF NOT EXISTS recomendacao_cpf      text,
  ADD COLUMN IF NOT EXISTS recomendacao_whatsapp text;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".tem_recomendacao IS
  'Quem abriu a vaga já tem alguém indicado? Etapa 3 da solicitação.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".recomendacao_cpf IS
  'Só dígitos, sem máscara — é assim que casa com EMPREGADOS."CPF" e com o CPF do candidato no portal.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".recomendacao_whatsapp IS
  'Só dígitos, sem DDI — mesma forma que maskFone() lê em src/lib/telefone.ts.';

-- Respondeu "Sim"? Então os três campos vêm juntos. O CHECK vale para
-- QUALQUER caminho até a tabela, não só para os dois formulários da tela —
-- é o que impede uma indicação pela metade, com nome e sem telefone para
-- ligar.
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  DROP CONSTRAINT IF EXISTS sistema_recrutamento_recomendacao_completa;
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD CONSTRAINT sistema_recrutamento_recomendacao_completa CHECK (
    NOT tem_recomendacao
    OR (
      nullif(btrim(recomendacao_nome), '')                        IS NOT NULL
      AND length(regexp_replace(coalesce(recomendacao_cpf, ''), '\D', '', 'g'))      = 11
      AND length(regexp_replace(coalesce(recomendacao_whatsapp, ''), '\D', '', 'g')) BETWEEN 10 AND 11
    )
  ) NOT VALID;

-- NOT VALID de propósito: o CHECK vale para o que entrar de agora em diante,
-- sem varrer as linhas antigas. Nenhuma delas tem `tem_recomendacao = true`
-- (a coluna nasce false), então não há o que validar — e um ALTER que
-- reescreve a tabela inteira num cadastro de vagas em uso é risco sem ganho.

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'SISTEMA_RECRUTAMENTO'
   AND column_name IN ('tem_recomendacao','recomendacao_nome','recomendacao_cpf','recomendacao_whatsapp')
 ORDER BY column_name;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO"
--   DROP CONSTRAINT IF EXISTS sistema_recrutamento_recomendacao_completa;
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO"
--   DROP COLUMN IF EXISTS recomendacao_whatsapp,
--   DROP COLUMN IF EXISTS recomendacao_cpf,
--   DROP COLUMN IF EXISTS recomendacao_nome,
--   DROP COLUMN IF EXISTS tem_recomendacao;
-- NOTIFY pgrst, 'reload schema';
