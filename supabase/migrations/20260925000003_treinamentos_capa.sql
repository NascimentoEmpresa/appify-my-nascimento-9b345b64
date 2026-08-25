-- =========================================================================
-- TREINAMENTOS — foto de capa do card
--
-- O card desenhava um gradiente com o ícone de capelo para todo mundo, então
-- a grade inteira ficava igual e o olho não distinguia um treinamento do
-- outro. A capa é opcional: sem ela, o gradiente continua valendo.
--
-- NÃO entra no CHECK `trn_precisa_de_conteudo`: capa é enfeite, não
-- material. Card que só tem capa continua sem ensinar nada.
--
-- Fica no mesmo bucket privado `treinamentos`, lido por URL assinada em
-- lote na carga da grade (createSignedUrls), não uma chamada por card.
--
-- Idempotente.
-- ROLLBACK: ALTER TABLE public."TREINAMENTOS" DROP COLUMN IF EXISTS capa_path;
-- =========================================================================

ALTER TABLE public."TREINAMENTOS"
  ADD COLUMN IF NOT EXISTS capa_path text;

COMMENT ON COLUMN public."TREINAMENTOS".capa_path IS
  'Caminho da imagem de capa no bucket treinamentos. Opcional; sem ela o card usa o gradiente padrão.';

NOTIFY pgrst, 'reload schema';
