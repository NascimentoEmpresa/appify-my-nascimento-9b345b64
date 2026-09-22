-- [SEM-CHAMADO] (Iury): despesas presas em "Pendente aprovação N2"
-- (exceção) às vezes precisam ser empurradas direto pra "Aguardando
-- pagamento" por decisão administrativa, fora do fluxo normal de
-- aprovação (sem passar pelo clique real de Aprovar). O histórico da
-- despesa (malote_despesa_evento) não tinha nenhum tipo_evento que deixasse
-- isso registrado como diferente de uma aprovação de verdade — sem isso,
-- quem olhasse a timeline depois não teria como distinguir "aprovado pelo
-- aprovador de verdade" de "empurrado manualmente via banco".
--
-- ROLLBACK:
--   ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
--   ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
--     'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
--     'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
--     'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
--     'conferido_pagamento', 'ajuste_pagamento_solicitado',
--     'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao'
--   ));
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
  'ajuste_administrativo'
));

NOTIFY pgrst, 'reload schema';
