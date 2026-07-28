-- Guarda, no header da NF, as alíquotas fiscais realmente aplicadas no
-- momento da emissão (vêm de contrato_dados_fiscais, mas são copiadas aqui
-- para não depender de um valor que pode mudar depois no cadastro do
-- contrato). Sem isso, não há como auditar/exibir "por que" um valor de
-- retenção deu tal número numa NF já salva. Iguais para todos os itens de
-- uma mesma NF, por isso ficam no header e não em nf_emissao_item.

alter table public.nf_emissao
  add column issqn_pct numeric(6,4) not null default 0,
  add column inss_pct  numeric(6,4) not null default 0,
  add column ir_pct    numeric(6,4) not null default 0,
  add column cofins_pct numeric(6,4) not null default 0,
  add column pis_pct   numeric(6,4) not null default 0,
  add column csll_pct  numeric(6,4) not null default 0;
