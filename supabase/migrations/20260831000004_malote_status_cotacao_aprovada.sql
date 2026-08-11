-- SIS-2026-0104 (ajuste de fluxo, conversa com o chefe): a cotação da
-- Solicitação roda em outro módulo (Suprimentos, ainda não construído pelo
-- Eduardo). Quando a solicitação é aprovada por lá, o Suprimentos vai
-- escrever direto na malote_despesa (mesma base) status='cotacao_aprovada'
-- + valor_aprovado_cotacao. O item fica parado nesse status até o usuário
-- clicar nele em Meus Itens e ir pra Criar Despesa converter em despesa de
-- verdade — a partir daí (status pendente_aprovacao em diante) o fluxo é
-- 100% nosso.

ALTER TABLE public.malote_despesa DROP CONSTRAINT malote_despesa_status_check;
ALTER TABLE public.malote_despesa ADD CONSTRAINT malote_despesa_status_check CHECK (status IN (
  'rascunho',
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
