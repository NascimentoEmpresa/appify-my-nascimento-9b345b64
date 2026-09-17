-- =========================================================================
-- app_acao ganha o valor 'responder'
--
-- Pedido do Pablo (17/09/2026): controlar em Administração › Acesso por
-- Usuário QUEM RESPONDE as dúvidas do Parecer Jurídico — hoje responde quem
-- é do setor JURIDICO ou está em JUR_DUVIDAS_RESPONSAVEIS (tabela sem tela).
-- A mig 119 já tinha levado o "aprovar" pro Acesso por Usuário e deixou
-- registrado: "não há ação 'responder' no enum". Agora há.
--
-- ⚠ ARQUIVO SEPARADO DE PROPÓSITO: o Postgres não deixa USAR um valor novo
-- de enum na mesma transação em que ele foi adicionado. A mig 173 (que usa
-- 'responder'::app_acao) tem que rodar em OUTRA execução — primeiro esta,
-- depois aquela. Não junte as duas num SQL Editor só.
--
-- Idempotente. Aplicada no banco do app em 17/09/2026.
-- =========================================================================
ALTER TYPE public.app_acao ADD VALUE IF NOT EXISTS 'responder';

-- ROLLBACK: Postgres não remove valor de enum; fica sem uso (a 173 tem o seu).
