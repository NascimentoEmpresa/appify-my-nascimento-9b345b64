-- =========================================================================
-- Patrimônio: parcelas de contrato nas Contas / Obrigações
--
-- Financiamento e Consórcio não são conta de mês: são um contrato com N
-- parcelas. Cada parcela continua sendo UMA linha em
-- JUR_PATRIMONIO_OBRIGACOES — é assim que ela aparece na lista de contas,
-- vai para o Malote e recebe comprovante. O que faltava era saber que um
-- punhado dessas linhas é o MESMO contrato.
--
-- Não usa a JUR_PATRIMONIO_PARCELAS: aquela tabela guarda o histórico
-- importado do sistema antigo (1.219 linhas, presas ao patrimônio e sem
-- ligação com obrigação), e não tem status/comprovante/Malote.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS contrato_uid   uuid,
  ADD COLUMN IF NOT EXISTS parcela_numero integer,
  ADD COLUMN IF NOT EXISTS parcela_total  integer;

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".contrato_uid IS
  'Amarra as parcelas de um mesmo contrato (Financiamento/Consórcio). NULL nas contas avulsas.';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".parcela_numero IS
  'Posição da parcela dentro do contrato (1..parcela_total).';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".parcela_total IS
  'Quantas parcelas o contrato tem, para a tela mostrar "3/60".';

CREATE INDEX IF NOT EXISTS jur_patr_obr_contrato_idx
  ON public."JUR_PATRIMONIO_OBRIGACOES" (patrimonio_id, contrato_uid)
  WHERE contrato_uid IS NOT NULL;

-- "Valor que falta" do patrimônio passa a ser a soma das parcelas NÃO PAGAS
-- de Financiamento/Consórcio, calculada na hora. A coluna
-- JUR_PATRIMONIOS.valor_falta continua existindo (é o número que veio da
-- importação), mas deixa de ser o que a tela mostra: ninguém a atualizava
-- quando uma parcela era paga.
COMMENT ON COLUMN public."JUR_PATRIMONIOS".valor_falta IS
  'LEGADO da importação. A tela calcula o que falta somando as parcelas em aberto de Financiamento/Consórcio nas obrigações.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP INDEX public.jur_patr_obr_contrato_idx;
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
--     DROP COLUMN contrato_uid, DROP COLUMN parcela_numero, DROP COLUMN parcela_total;
-- =========================================================================
