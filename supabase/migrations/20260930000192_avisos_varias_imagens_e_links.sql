-- =========================================================================
-- Quadro de Avisos: várias imagens (carrossel ou grade) e links com nome
--
-- Pedido do Pablo em 21/09/2026: "opção de colocar mais imagens, ir
-- passando pro lado ou aparecer ao mesmo tempo; e ao adicionar um link tem
-- que ser CLICÁVEL, com o nome LINK ou eu escolher o nome".
--
--   imagens        jsonb  [{ "url": "...", "nome": "cartaz.png" }, ...]
--                         Todas as imagens do aviso, na ordem. anexo_url /
--                         anexo_nome continuam sendo a PRIMEIRA (capa) — é o
--                         que a lista do Início, o gate e a miniatura leem;
--                         a tela grava os dois juntos.
--   imagens_layout text   'carrossel' (passa pro lado, padrão) | 'grade'
--                         (todas de uma vez).
--   links          jsonb  [{ "rotulo": "Abrir formulário", "url": "https://..." }]
--                         Botões clicáveis abaixo do texto. Além disso, URL
--                         colada no meio do texto vira link na tela.
--
-- Estoque: quem já tem anexo_url ganha imagens = [{url, nome}] pra não ter
-- dois formatos convivendo.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS imagens        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS imagens_layout text  NOT NULL DEFAULT 'carrossel',
  ADD COLUMN IF NOT EXISTS links          jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP CONSTRAINT IF EXISTS sistema_notificacoes_imagens_layout_chk;
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD CONSTRAINT sistema_notificacoes_imagens_layout_chk CHECK (imagens_layout IN ('carrossel', 'grade'));

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".imagens IS
  'Todas as imagens do aviso, na ordem: [{url, nome}]. anexo_url/anexo_nome = a primeira (capa). Migration 20260930000192.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".imagens_layout IS
  'carrossel (passa pro lado) | grade (todas de uma vez).';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".links IS
  'Links clicáveis do aviso: [{rotulo, url}].';

-- Estoque: a imagem que já existia vira a primeira da lista.
UPDATE public."SISTEMA_NOTIFICACOES"
   SET imagens = jsonb_build_array(jsonb_build_object('url', anexo_url, 'nome', coalesce(anexo_nome, '')))
 WHERE anexo_url IS NOT NULL AND btrim(anexo_url) <> '' AND imagens = '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS imagens, DROP COLUMN IF EXISTS imagens_layout, DROP COLUMN IF EXISTS links;
