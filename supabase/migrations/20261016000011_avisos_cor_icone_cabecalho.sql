-- =========================================================================
-- Quadro de Avisos: cor e ícone do cabeçalho do aviso
--
-- Pedido do Pablo em 16/10/2026: "deixa customizar essa cor e ícone aqui de
-- cima também onde tá amarelo" (a faixa do topo da janela do aviso e o
-- quadrado com o "!").
--
--   cabecalho_cor   text NULL  NULL = amarelo (o de sempre) | azul | verde |
--                              vermelho | roxo | rosa | cinza | laranja
--   cabecalho_icone text NULL  NULL = alerta "!" (o de sempre) | megafone |
--                              festa | trofeu | coracao | estrela | calendario |
--                              info | escudo | presente | bolo | sino
--
-- NULL nos dois = o cabeçalho de antes: avisos antigos não mudam, sem UPDATE.
-- As classes de cada cor ficam na tela (src/lib/notificacoes.ts); o banco só
-- guarda o nome, com CHECK para não entrar valor que a tela não conhece.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS cabecalho_cor   text,
  ADD COLUMN IF NOT EXISTS cabecalho_icone text;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_cabecalho_cor_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_cabecalho_cor_chk
  CHECK (cabecalho_cor IS NULL OR cabecalho_cor IN
         ('amarelo', 'azul', 'verde', 'vermelho', 'roxo', 'rosa', 'cinza', 'laranja'));

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_cabecalho_icone_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_cabecalho_icone_chk
  CHECK (cabecalho_icone IS NULL OR cabecalho_icone IN
         ('alerta', 'megafone', 'festa', 'trofeu', 'coracao', 'estrela',
          'calendario', 'info', 'escudo', 'presente', 'bolo', 'sino'));

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".cabecalho_cor IS
  'Cor do cabeçalho do aviso. NULL = amarelo (padrão). Migration 20261016000011.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".cabecalho_icone IS
  'Ícone do cabeçalho do aviso. NULL = alerta "!" (padrão). Migration 20261016000011.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_cabecalho_cor_chk,
--   DROP CONSTRAINT IF EXISTS sistema_notificacoes_cabecalho_icone_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS cabecalho_cor, DROP COLUMN IF EXISTS cabecalho_icone;
