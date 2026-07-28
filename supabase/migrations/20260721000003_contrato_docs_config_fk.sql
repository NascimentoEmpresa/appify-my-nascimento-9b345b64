-- contrato_docs_config passa a referenciar public.contratos por id (FK real),
-- em vez de guardar o nome do contrato como texto solto (mesmo padrão já
-- adotado em cobranca_relatorio_nota, migration 20260714000003). A tabela
-- está vazia em produção (ninguém preencheu a tela "Por Contrato" ainda),
-- então a troca é limpa, sem necessidade de migrar dados.

alter table public.contrato_docs_config
  add column contrato_id uuid not null references public.contratos(id) on delete cascade;

alter table public.contrato_docs_config
  drop constraint if exists contrato_docs_config_unique;

alter table public.contrato_docs_config
  add constraint contrato_docs_config_unique unique (empresa_id, contrato_id, posto, doc_tipo_id);

alter table public.contrato_docs_config
  drop column contrato;

create index if not exists idx_contrato_docs_config_contrato_id
  on public.contrato_docs_config(contrato_id);
