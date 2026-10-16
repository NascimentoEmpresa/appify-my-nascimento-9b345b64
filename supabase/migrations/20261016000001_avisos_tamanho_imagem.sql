-- =========================================================================
-- Quadro de Avisos: quem publica escolhe o tamanho da imagem no aviso
--
-- Pedido do Pablo em 16/10/2026, com o print do "3 Anos de Empresa": o cartaz
-- quadrado saía pequeno no meio do modal (caixa 16:9 de 512 px de largura,
-- object-contain), e só dava para ver direito pelo "Ver imagem em tamanho
-- real". Agora quem cria o aviso escolhe:
--
--   imagens_tamanho text NULL
--     NULL       como sempre foi (caixa 16:9 na largura do modal)
--     'pequena'  caixa baixa (~160 px)
--     'media'    caixa média (~256 px)
--     'grande'   caixa alta (~384 px) e o modal mais largo
--     'total'    a imagem inteira na largura do modal (o mais largo), na
--                proporção dela, sem caixa — o cartaz é o aviso
--
-- NULL é o padrão de propósito: avisos antigos ficam exatamente como estão,
-- sem UPDATE de estoque.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS imagens_tamanho text;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_imagens_tamanho_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_imagens_tamanho_chk
  CHECK (imagens_tamanho IS NULL OR imagens_tamanho IN ('pequena', 'media', 'grande', 'total'));

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".imagens_tamanho IS
  'Tamanho da imagem no modal: NULL (padrão 16:9) | pequena | media | grande | total. Migration 20261016000001.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_imagens_tamanho_chk;
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS imagens_tamanho;
