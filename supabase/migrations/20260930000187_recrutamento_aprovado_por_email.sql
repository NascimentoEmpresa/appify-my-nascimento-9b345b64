-- =========================================================================
-- Recrutamento: quem aprovou/reprovou a vaga — NOME com o e-mail embaixo
--
-- PEDIDO (18/09/2026, Pablo)
--   No detalhe da vaga, "Aprovado/Reprovado por" mostrava o e-mail cru
--   (adm@…): quem não tem nome no user_metadata era gravado só pelo e-mail
--   em aprovado_por_nome. Tem que aparecer o nome da pessoa e o e-mail
--   embaixo, como já faz o "Solicitado por".
--
-- O QUE MUDA
--   1. Coluna aprovado_por_email: o front passa a gravar os dois (nome + e-mail)
--      em toda aprovação/reprovação; com o e-mail guardado, a tela traduz o
--      nome por EMPREGADOS (fonte oficial) mesmo quando o metadata não tem.
--   2. Backfill: linha em que aprovado_por_nome era um e-mail ganha
--      aprovado_por_email = ele, e o nome vira o de EMPREGADOS (se houver).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS aprovado_por_email text;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".aprovado_por_email IS
  'E-mail do login que aprovou/reprovou a vaga (par de aprovado_por_nome). 18/09/2026.';

-- Backfill: e-mail gravado no lugar do nome. O guard (só a data de início
-- muda depois de criada) não vale pra correção de dado — como na mig 184.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET aprovado_por_email = coalesce(r.aprovado_por_email, r.aprovado_por_nome),
       aprovado_por_nome  = coalesce((SELECT e."Nome" FROM public."EMPREGADOS" e WHERE lower(e.email) = lower(r.aprovado_por_nome) LIMIT 1), r.aprovado_por_nome)
 WHERE r.aprovado_por_nome LIKE '%@%';
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN IF EXISTS aprovado_por_email;
-- NOTIFY pgrst, 'reload schema';
