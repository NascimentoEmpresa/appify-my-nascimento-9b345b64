-- Histórico de auditoria de nf_emissao — mesmo padrão de reuniao_log
-- (supabase/migrations/20260709000005_reuniao_log.sql): log gravado pela
-- aplicação (não por trigger de banco), uma linha por ação relevante
-- (criação, edição, mudança de status), pra acompanhamento e relatórios
-- futuros. Não logamos cada campo alterado, só "ações grandes" — mesmo
-- racional já usado em Reuniões.

create table if not exists public.nf_emissao_historico (
  id uuid primary key default gen_random_uuid(),
  nf_emissao_id uuid not null references public.nf_emissao(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  acao text not null,
  detalhe text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_nf_emissao_historico_nf on public.nf_emissao_historico(nf_emissao_id, created_at desc);

alter table public.nf_emissao_historico enable row level security;

create policy nf_emissao_historico_select on public.nf_emissao_historico for select to authenticated
  using (exists (
    select 1 from public.nf_emissao n
    where n.id = nf_emissao_id
      and (n.empresa_id = get_user_empresa(auth.uid()) or has_role(auth.uid(), 'admin'))
  ));

create policy nf_emissao_historico_insert on public.nf_emissao_historico for insert to authenticated
  with check (exists (
    select 1 from public.nf_emissao n
    where n.id = nf_emissao_id
      and (n.empresa_id = get_user_empresa(auth.uid()) or has_role(auth.uid(), 'admin'))
  ));
