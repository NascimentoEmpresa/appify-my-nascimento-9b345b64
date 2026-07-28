-- INSS por categoria de risco: Normais 11%, Insalubridade 20%->13%,
-- Periculosidade 30%->14%, Insalubridade 40%->15%. São alíquotas padrão
-- legal, fixas para qualquer contrato (confirmado com o usuário) — por isso
-- ficam hardcoded no código (calculos.ts), não cadastráveis por contrato.
-- Substitui o inss_pct único que existia antes (v1 simplificada, não cobria
-- postos insalubres/perigosos). Só o contrato TJRS tinha inss_pct cadastrado
-- (0.11, igual à categoria "Normais"), então não há perda real de dado.

alter table public.nf_emissao_item
  add column inss_categoria text not null default 'normais'
    check (inss_categoria in ('normais','insalubridade_20','periculosidade_30','insalubridade_40'));

alter table public.contrato_dados_fiscais drop column if exists inss_pct;
alter table public.nf_emissao drop column if exists inss_pct;
