-- SIS-2026-0104: "toda alteração/modificação deve ficar registrada em
-- histórico" — adiciona o tipo de evento genérico 'edicao', usado sempre
-- que um usuário salva mudanças num item do Malote fora dos eventos já
-- nomeados (criação, cancelamento, reenvio p/ aprovação, conversão em
-- despesa, etc.), como editar uma Solicitação ainda em cotação.

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao',
  'edicao',
  'aguardando_cotacao',
  'cotacao_realizada',
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
