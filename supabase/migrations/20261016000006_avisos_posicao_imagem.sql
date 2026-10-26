-- =========================================================================
-- Quadro de Avisos: imagem ao lado do texto (ou em cima, como antes)
--
-- Pedido do Pablo em 16/10/2026, com a foto do "3 Anos de Empresa" aberto no
-- notebook: o cartaz quadrado ocupava o modal e era preciso rolar para ler a
-- mensagem e chegar no botão. "O ideal é aparecer a imagem inteira de um lado
-- e a mensagem do outro, ou conseguir escolher esse layout".
--
--   imagens_posicao text NULL
--     NULL    em cima (como sempre foi — avisos antigos não mudam)
--     'cima'  em cima, escolhido
--     'lado'  imagem inteira à esquerda, texto à direita (empilha no celular).
--             É o padrão da tela para aviso novo com imagem.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS imagens_posicao text;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_imagens_posicao_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_imagens_posicao_chk
  CHECK (imagens_posicao IS NULL OR imagens_posicao IN ('cima', 'lado'));

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".imagens_posicao IS
  'Onde a imagem fica no aviso: NULL/cima (em cima do texto) | lado (à esquerda do texto). Migration 20261016000006.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_imagens_posicao_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS imagens_posicao;
