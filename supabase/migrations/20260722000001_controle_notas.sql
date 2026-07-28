-- Controle de Notas (validação do Financeiro): próxima etapa depois de
-- "enviada" pelo Analista. Confirmado no Controle de Notas.xlsm legado que
-- multas/glosas/outros descontos podem ser lançados "antes" (já temos) e
-- "depois" da emissão (o cliente aplica depois de já emitida a NF) — por
-- isso as 3 colunas novas em nf_emissao_item. observacoes_financeiro é
-- separado de observacoes (do Analista) pra não sobrescrever uma anotação
-- da outra.

alter type public.nf_emissao_status add value if not exists 'concluida';
alter type public.nf_emissao_status add value if not exists 'cancelada';

alter table public.nf_emissao_item
  add column multas_pos_emissao numeric(14,2) not null default 0,
  add column glosas_pos_emissao numeric(14,2) not null default 0,
  add column outros_descontos_pos_emissao numeric(14,2) not null default 0;

alter table public.nf_emissao
  add column observacoes_financeiro text;
