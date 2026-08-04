-- Tabela oficial de postos de trabalho.
-- Serve como referência centralizada para planilha_custo, compras, RH e NF.
create table public.postos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,

  -- Identificação
  nome                text not null,
  cargo               text,
  cbo                 text,

  -- Jornada
  jornada             text,
  carga_horaria_mes   numeric(6,2),

  -- Financeiro
  salario_base        numeric(14,2),
  adicional_noturno   numeric(14,2),
  insalubridade       numeric(5,2),
  periculosidade      numeric(5,2),
  vale_transporte     numeric(14,2),
  vale_alimentacao    numeric(14,2),

  -- Equipamentos / EPI (compras)
  uniforme            text,
  epi                 text,
  equipamentos        text,

  -- Vínculo opcional com contrato oficial
  contrato_id         uuid references public.contratos(id) on delete set null,

  -- Controle
  ativo               boolean not null default true,
  observacoes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_postos_empresa on public.postos(empresa_id);
create index idx_postos_contrato on public.postos(contrato_id);

alter table public.postos enable row level security;

create policy postos_select on public.postos
  for select to authenticated
  using (empresa_id = public.get_user_empresa(auth.uid())
    or public.has_role(auth.uid(), 'admin'));

create policy postos_write on public.postos
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'controladoria')
    or public.has_role(auth.uid(), 'comprador'))
  with check (public.has_role(auth.uid(), 'admin')
    or public.has_role(auth.uid(), 'controladoria')
    or public.has_role(auth.uid(), 'comprador'));

create trigger trg_postos_updated
  before update on public.postos
  for each row execute function public.set_updated_at();
