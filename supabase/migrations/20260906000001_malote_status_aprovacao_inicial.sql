-- SIS-2026-0132 Fase 2: Aprovação Inicial da Solicitação — antes disso,
-- "Enviar solicitação" pulava direto pra status='aguardando_cotacao', sem
-- nenhuma etapa de aprovação. Agora entra em 'aguardando_aprovacao_inicial'
-- primeiro; só depois de aprovado pelo aprovador da Classificação Malote é
-- que vai pro Suprimentos cotar (aguardando_cotacao).

ALTER TABLE public.malote_despesa DROP CONSTRAINT malote_despesa_status_check;
ALTER TABLE public.malote_despesa ADD CONSTRAINT malote_despesa_status_check CHECK (status IN (
  'rascunho',
  'aguardando_aprovacao_inicial',
  'aguardando_cotacao',
  'cotacao_realizada',
  'cotacao_aprovada',
  'solicitacao_reprovada',
  'pendente_aprovacao',
  'necessidade_de_ajuste',
  'aguardando_pagamento',
  'despesa_paga',
  'despesa_reprovada',
  'cancelada'
));

NOTIFY pgrst, 'reload schema';
