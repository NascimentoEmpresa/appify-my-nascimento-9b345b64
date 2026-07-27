-- Conta Garantida: backfill de taxa_mensal/vencimento que ficou pra trás na
-- migração original. O sistema legado guardava essas taxas num arquivo à
-- parte (config_taxas_cg.json, chave "PADRAO" por banco) que não foi portado
-- junto com o seed de bancos — só o `limite` veio. Sem taxa configurada, o
-- motor de cálculo (calculos.ts) nunca acumula juros pendente (taxaFinal fica
-- sempre 0), o que fazia o KPI "Juros Pendentes" ficar zerado mesmo com a
-- planilha de fluxo de caixa correta.
--
-- Valores conferidos direto no config_taxas_cg.json do sistema legado (chave
-- PADRAO de cada banco). perc_cdi permanece 0 pra todos — o sistema legado
-- nunca usou %CDI na prática, só taxa fixa mensal.

UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 2.96, vencimento = '2026-08-28' WHERE nome = 'BB SN';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 1.97, vencimento = '2026-09-01' WHERE nome = 'BB HAGG';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 15.95 WHERE nome = 'BANRI HAGG';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 15.95 WHERE nome = 'BANRI CANAA';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 15.95 WHERE nome = 'BANRI NH';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 7.53, vencimento = '2025-11-10' WHERE nome = 'BRADESCO HAGG';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 2.19, vencimento = '2026-04-01' WHERE nome = 'BRADESCO SN';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 15.00 WHERE nome = 'CAIXA HAGG';
UPDATE public.fin_conta_garantida_banco SET taxa_mensal = 2.07 WHERE nome = 'CAIXA SN';
