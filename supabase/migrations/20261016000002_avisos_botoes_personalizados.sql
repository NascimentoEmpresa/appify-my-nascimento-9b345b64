-- =========================================================================
-- Quadro de Avisos: quem publica escolhe os botões de resposta
--
-- Pedido do Pablo em 16/10/2026: "também quero uma opção de escolher quais
-- vão ser os botões, não só concordo ou discordo".
--
--   SISTEMA_NOTIFICACOES.botoes jsonb  [{ "rotulo": "Vou participar", "estilo": "principal" }, ...]
--     Vazio ('[]', o padrão) = o comportamento de antes, decidido por
--     permitir_escolha (CONCORDO/DISCORDO ou um "Estou ciente"). Avisos
--     antigos ficam exatamente como estão — sem UPDATE de estoque.
--     estilo: 'principal' | 'contorno' | 'perigo' (só a aparência do botão).
--
--   SISTEMA_NOTIFICACAO_CIENCIA.resposta text
--     O rótulo do botão que a pessoa apertou, num aviso com botões próprios.
--     A `escolha` continua obrigatória e vai como 'CIENTE' nesses avisos: o
--     CHECK de escolha, o "quem respondeu?" e as contagens antigas seguem
--     valendo, e a pergunta "o que ela respondeu?" fica com esta coluna.
--     Rótulo, e não índice do botão: quem edita o aviso depois e reordena os
--     botões não pode trocar a resposta de quem já respondeu.
--
-- Nada de RLS nova: a ciência continua gravável só pela própria pessoa
-- (sistema_notif_ciencia_gravar) e lida por quem já lia.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS botoes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_botoes_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_botoes_chk
  CHECK (jsonb_typeof(botoes) = 'array' AND jsonb_array_length(botoes) <= 4);

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".botoes IS
  'Botões de resposta próprios: [{rotulo, estilo}]. Vazio = CONCORDO/DISCORDO ou "Estou ciente" (permitir_escolha). Migration 20261016000002.';

ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
  ADD COLUMN IF NOT EXISTS resposta text;

ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" DROP CONSTRAINT IF EXISTS sistema_notif_ciencia_resposta_chk;
ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
  ADD CONSTRAINT sistema_notif_ciencia_resposta_chk
  CHECK (resposta IS NULL OR char_length(resposta) <= 60);

COMMENT ON COLUMN public."SISTEMA_NOTIFICACAO_CIENCIA".resposta IS
  'Rótulo do botão apertado num aviso com botões próprios (escolha = CIENTE). NULL nos avisos de CONCORDO/DISCORDO/Estou ciente. Migration 20261016000002.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" DROP CONSTRAINT IF EXISTS sistema_notif_ciencia_resposta_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" DROP COLUMN IF EXISTS resposta;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_botoes_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS botoes;
