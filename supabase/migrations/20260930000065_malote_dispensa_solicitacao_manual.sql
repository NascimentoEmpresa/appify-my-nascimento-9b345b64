-- SIS-2026-0334 (Iury): "Criar um check que se marcado ele deixa a
-- classificação sem necessidade de solicitação, pulando direto para a
-- criação de despesa" — em Criar Despesa e em Ratear Classificação, um
-- checkbox permite ignorar o `requer_solicitacao` da Classificação
-- (planejamento_orcamentario_classificacao) só naquela despesa específica,
-- sem alterar a configuração da Classificação (que continua exigindo
-- solicitação por padrão pra todo mundo).
--
-- Coluna de auditoria: sistema de aprovação financeira — pular a etapa de
-- solicitação/cotação sem deixar rastro seria um risco de auditoria. Quem
-- olhar a despesa depois (aprovador, Suprimentos, auditoria) precisa saber
-- que a solicitação foi dispensada de propósito, não por engano.
ALTER TABLE public.malote_despesa
  ADD COLUMN solicitacao_dispensada_manualmente boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_despesa DROP COLUMN solicitacao_dispensada_manualmente;
-- =====================================================================
