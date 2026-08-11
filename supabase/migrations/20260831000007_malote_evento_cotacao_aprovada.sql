-- SIS-2026-0104: faltava o tipo de evento 'cotacao_aprovada' (só tínhamos
-- 'cotacao_realizada' e 'solicitacao_aprovada' separados) — é o evento que
-- o módulo de Suprimentos vai logar quando aprovar a cotação e a
-- malote_despesa entra no status homônimo.

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao',
  'edicao',
  'aguardando_cotacao',
  'cotacao_realizada',
  'cotacao_aprovada',
  'solicitacao_aprovada',
  'solicitacao_reprovada',
  'despesa_criada',
  'aprovacao_nivel',
  'necessidade_de_ajuste',
  'reenvio_aprovacao',
  'aguardando_pagamento',
  'despesa_paga',
  'despesa_reprovada',
  'cancelamento'
));

NOTIFY pgrst, 'reload schema';
