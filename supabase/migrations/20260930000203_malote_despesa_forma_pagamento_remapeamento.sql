-- [SEM-CHAMADO] (achado do usuário, 22/09/2026): SIS-2026-0439 trocou o
-- catálogo de "Forma de pagamento" do genérico (malote_tipo_forma_pagamento
-- — "Boleto", "Pix", "Cartão"...) pro nomeado (malote_forma_pagamento —
-- "Boleto Bancário", "Cartão Sicredi 119 - Final 2719"...), mas despesas já
-- gravadas com o valor genérico antigo ficaram com forma_pagamento
-- apontando pra um nome que não existe mais no catálogo novo — aparecem
-- como "(inativo)" nas telas de despesa/aprovação (DespesaVisualizar.tsx e
-- afins incluem o valor gravado na lista mesmo sem estar entre os ativos,
-- pra não "sumir" o dado, mas fica marcado assim).
--
-- Mapeamento levantado via SELECT em produção (não é chute): cada forma
-- nomeada do catálogo novo guarda em `tipo` o valor genérico de origem —
-- os 4 valores órfãos encontrados batem 1 pra 1, sem ambiguidade:
--   'Boleto'                   (289 despesas) -> 'Boleto Bancário'
--   'Mentore'                  ( 48 despesas) -> 'Banco Mentore'
--   'Cartão de Crédito - 2719' ( 13 despesas) -> 'Cartão de Crédito Sicredi HAGG 119 - Final 2719 - (Usado no Malote)'
--   'Cartão de Crédito - 0219' (  1 despesa ) -> 'Cartão de Crédito - Final 0219'
--
-- Conferido antes de rodar: o destino do Cartão 2719 é Fluxo Especial
-- (aprovador fixo), mas nenhuma das 13 despesas dele está em
-- pendente_aprovacao (9 aguardando_pagamento + 4 despesa_paga, já passaram
-- da aprovação) — trocar o rótulo agora não muda quem aprovou. Os outros 3
-- destinos são fluxo normal, então as 28 despesas "Boleto" + 1 "Cartão
-- 0219" ainda pendente_aprovacao também não mudam de aprovador.
--
-- Puramente rótulo — não altera valor, classificação, status, rateio nem
-- histórico de aprovação de nenhuma despesa.
--
-- ROLLBACK (mesmo mapeamento, invertido):
--   UPDATE public.malote_despesa SET forma_pagamento = 'Boleto' WHERE forma_pagamento = 'Boleto Bancário';
--   UPDATE public.malote_despesa SET forma_pagamento = 'Mentore' WHERE forma_pagamento = 'Banco Mentore';
--   UPDATE public.malote_despesa SET forma_pagamento = 'Cartão de Crédito - 2719' WHERE forma_pagamento = 'Cartão de Crédito Sicredi HAGG 119 - Final 2719 - (Usado no Malote)';
--   UPDATE public.malote_despesa SET forma_pagamento = 'Cartão de Crédito - 0219' WHERE forma_pagamento = 'Cartão de Crédito - Final 0219';

UPDATE public.malote_despesa
   SET forma_pagamento = 'Boleto Bancário'
 WHERE forma_pagamento = 'Boleto';

UPDATE public.malote_despesa
   SET forma_pagamento = 'Banco Mentore'
 WHERE forma_pagamento = 'Mentore';

UPDATE public.malote_despesa
   SET forma_pagamento = 'Cartão de Crédito Sicredi HAGG 119 - Final 2719 - (Usado no Malote)'
 WHERE forma_pagamento = 'Cartão de Crédito - 2719';

UPDATE public.malote_despesa
   SET forma_pagamento = 'Cartão de Crédito - Final 0219'
 WHERE forma_pagamento = 'Cartão de Crédito - 0219';

-- Verificação: deve devolver 0 linhas (nenhuma despesa órfã restante entre
-- as ATIVAS do catálogo).
-- SELECT d.forma_pagamento, count(*)
--   FROM public.malote_despesa d
--  WHERE d.forma_pagamento IS NOT NULL
--    AND NOT EXISTS (
--      SELECT 1 FROM public.malote_forma_pagamento fp
--       WHERE fp.nome = d.forma_pagamento AND fp.ativo
--    )
--  GROUP BY d.forma_pagamento;
