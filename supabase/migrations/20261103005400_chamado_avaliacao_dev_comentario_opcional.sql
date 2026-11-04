-- =========================================================================
-- CHAMADOS — o comentário da avaliação feita pelo DESENVOLVEDOR deixa de ser
-- obrigatório quando a nota não é cheia (03/11/2026)
--
-- PEDIDO DO PABLO (print do "Antes de concluir: avalie quem pediu" no
-- SIS-2026-0795, travado em "Faltam 10 caracteres" por uma estrela a menos):
-- "tira essa obrigatoriedade de precisar comentar se não der 5 estrelas,
-- somente pro desenvolvedor quando o dev vai avaliar o chamado".
--
-- O QUE MUDA: só a CHECK chamado_avaliacao_comentario_obrigatorio_dev de
-- "CHAMADO_SISTEMA_AVALIACAO_DEV" (mig 20261020000070) sai. O comentário
-- continua existindo, agora opcional sempre.
-- O QUE NÃO MUDA: a avaliação que o SOLICITANTE faz do chamado
-- (chamado_avaliacao_comentario_obrigatorio, mig 20260831000004) continua
-- exigindo o comentário em nota menor que 5.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO_DEV"
  DROP CONSTRAINT IF EXISTS chamado_avaliacao_comentario_obrigatorio_dev;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (só entra se nenhuma linha nova violar a regra)
-- =========================================================================
-- ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO_DEV"
--   ADD CONSTRAINT chamado_avaliacao_comentario_obrigatorio_dev CHECK (
--     (clareza = 5 AND informacoes = 5 AND retorno = 5 AND validacao = 5 AND colaboracao = 5)
--     OR (comentario IS NOT NULL AND length(btrim(comentario)) >= 10));
-- NOTIFY pgrst, 'reload schema';
