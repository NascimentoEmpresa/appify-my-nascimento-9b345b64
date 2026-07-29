-- Permite que cada variação do modelo de NF (ex: uma nota de um contrato com
-- múltiplos locais/serviços, como Veranópolis) tenha sua própria retenção
-- fiscal, já que ISSQN/IR/COFINS/PIS/CSLL podem variar por nota dentro do
-- mesmo contrato (ex: municípios diferentes têm alíquotas de ISSQN diferentes).
-- Nulo = usa o padrão cadastrado no contrato (comportamento atual, inalterado).
ALTER TABLE public.nf_emissao_modelo
  ADD COLUMN issqn_pct numeric(6,4),
  ADD COLUMN ir_pct numeric(6,4),
  ADD COLUMN cofins_pct numeric(6,4),
  ADD COLUMN pis_pct numeric(6,4),
  ADD COLUMN csll_pct numeric(6,4);
