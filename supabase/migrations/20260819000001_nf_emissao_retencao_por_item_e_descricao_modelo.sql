-- Caso UFFS: a mesma nota mistura postos com aliquotas de IR/CSLL/COFINS/PIS
-- diferentes (ex: Limpeza+Jardinagem num codigo de receita, Motorista+Servicos
-- Gerais+Interprete+Encarregado noutro). Em vez de replicar a aba de
-- faturamento inteira, cada ITEM (posto) da nota pode opcionalmente sobrescrever
-- a retencao da nota — nulo continua usando o padrao da nota/contrato, entao
-- nenhum comportamento existente muda.
ALTER TABLE public.nf_emissao_item
  ADD COLUMN issqn_pct numeric(6,4),
  ADD COLUMN ir_pct numeric(6,4),
  ADD COLUMN cofins_pct numeric(6,4),
  ADD COLUMN pis_pct numeric(6,4),
  ADD COLUMN csll_pct numeric(6,4);

ALTER TABLE public.nf_emissao_modelo_item
  ADD COLUMN issqn_pct numeric(6,4),
  ADD COLUMN ir_pct numeric(6,4),
  ADD COLUMN cofins_pct numeric(6,4),
  ADD COLUMN pis_pct numeric(6,4),
  ADD COLUMN csll_pct numeric(6,4);

-- Descricao padrao da variacao (ex: texto de "Descricao dos servicos" que o
-- Financeiro ja mantem na planilha modelo), copiada pro campo Descricao da NF
-- quando o analista abre "Nova NF" a partir dessa variacao.
ALTER TABLE public.nf_emissao_modelo
  ADD COLUMN descricao_padrao text;
