-- Módulo de Cotações: comunicação Licitação → Compras
-- Status: pendente (vermelho) → visualizado (amarelo) → respondido (verde)
create table public.cotacoes_licitacao (
  id                        uuid primary key default gen_random_uuid(),
  empresa_id                uuid not null references public.empresas(id) on delete cascade,

  -- Solicitação (Licitação → Compras)
  tipo                      text not null default 'Cotação',
  comentario                text not null,
  arquivo_url               text,
  arquivo_nome              text,
  remetente_id              uuid references auth.users(id),
  remetente_nome            text,

  -- Status: pendente | visualizado | respondido
  status                    text not null default 'pendente',

  -- Visualização por Compras
  visualizado_por_id        uuid references auth.users(id),
  visualizado_por_nome      text,
  visualizado_em            timestamptz,

  -- Resposta (Compras → Licitação)
  resposta_comentario       text,
  resposta_arquivo_url      text,
  resposta_arquivo_nome     text,
  respondente_id            uuid references auth.users(id),
  respondente_nome          text,
  data_resposta             timestamptz,

  -- Visualização da resposta por Licitação
  resposta_visualizada_por_id   uuid references auth.users(id),
  resposta_visualizada_em       timestamptz,

  -- Edição
  editado_por_id            uuid references auth.users(id),
  editado_por_nome          text,
  editado_em                timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_cotacoes_empresa on public.cotacoes_licitacao(empresa_id);
create index idx_cotacoes_status  on public.cotacoes_licitacao(status);

alter table public.cotacoes_licitacao enable row level security;

-- Licitação e Compras da mesma empresa lêem tudo
create policy cotacoes_select on public.cotacoes_licitacao
  for select to authenticated
  using (empresa_id in (
    select empresa_id from public.user_empresa where user_id = auth.uid()
  ));

-- Apenas roles autorizados inserem (licitação cria, compras responde via update)
create policy cotacoes_insert on public.cotacoes_licitacao
  for insert to authenticated
  with check (empresa_id in (
    select empresa_id from public.user_empresa where user_id = auth.uid()
  ));

create policy cotacoes_update on public.cotacoes_licitacao
  for update to authenticated
  using (empresa_id in (
    select empresa_id from public.user_empresa where user_id = auth.uid()
  ));

create policy cotacoes_delete on public.cotacoes_licitacao
  for delete to authenticated
  using (
    remetente_id = auth.uid()
    or public.has_role(auth.uid(), 'admin')
  );

create trigger trg_cotacoes_updated
  before update on public.cotacoes_licitacao
  for each row execute function public.set_updated_at();

-- Registra no gerenciador de acesso (/app/administracao)
insert into public.app_menu (modulo_id, codigo, nome, rota, ordem)
select m.id, 'cotacoes-licitacao', 'Cotações', '/app/licitacoes/cotacoes', 118
from public.app_modulo m where m.codigo = 'licitacoes'
on conflict (modulo_id, codigo) do nothing;
