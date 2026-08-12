-- SIS-2026-0106: aprovador da solicitação é diferente do aprovador da
-- despesa no Malote (aprovador1/2/3). Quando "Requer solicitação" está
-- marcado, a classificação precisa dizer quem aprova a solicitação em si.
alter table public.planejamento_orcamentario_classificacao
  add column if not exists aprovador_solicitacao_user_id uuid references public.profiles(id),
  add column if not exists aprovador_solicitacao_nome text;
