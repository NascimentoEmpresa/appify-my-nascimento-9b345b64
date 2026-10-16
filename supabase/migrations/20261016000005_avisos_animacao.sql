-- =========================================================================
-- Quadro de Avisos: animação comemorativa ao abrir o aviso
--
-- Pedido do Pablo em 16/10/2026: "quero que dê pra escolher uma animação na
-- tela ao enviar o aviso, que mostre na prévia, confetes, estrelas, etc.
-- quando for algo a comemorar".
--
--   animacao text NULL
--     NULL        nenhuma (o padrão — avisos antigos ficam sem animação)
--     'confetes'  confete caindo
--     'estrelas'  estrelas douradas subindo e piscando
--     'coracoes'  corações subindo
--     'fogos'     fogos de artifício estourando
--
-- A animação é só da tela (canvas, sem lib) e respeita prefers-reduced-motion.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS animacao text;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_animacao_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_animacao_chk
  CHECK (animacao IS NULL OR animacao IN ('confetes', 'estrelas', 'coracoes', 'fogos'));

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".animacao IS
  'Animação ao abrir o aviso: NULL (nenhuma) | confetes | estrelas | coracoes | fogos. Migration 20261016000005.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_animacao_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS animacao;
