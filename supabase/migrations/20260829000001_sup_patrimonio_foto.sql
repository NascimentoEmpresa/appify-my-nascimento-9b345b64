-- =====================================================================
-- PATRIMÔNIO — foto do bem
--
-- POR QUE
-- Os cards da tela de Patrimônio se distinguem só por nome e identificador,
-- e boa parte da frota entrou sem número ("sem identificador"): na prática o
-- usuário olha "MONTANA" e "ONIX" sem saber qual carro é. Uma foto resolve
-- na hora — é o mesmo papel de uma foto de perfil.
--
-- UMA foto por bem, não uma galeria: a coluna guarda o caminho no storage.
-- Documentos e notas continuam em sup_patrimonio_arquivo, que é outra coisa
-- (nota fiscal de manutenção, com valor e comentário).
--
-- STORAGE
-- Reaproveita o bucket `sup-patrimonio`, que já é PRIVADO e já tem policies
-- de insert/select/delete amarradas a can_access dos menus sup_patrimonio e
-- sup_manutencao (20260824000001). A foto entra sob o prefixo `fotos/`, então
-- nenhuma policy nova é necessária — e a foto não vaza por URL pública.
-- =====================================================================

ALTER TABLE public.sup_patrimonio
  ADD COLUMN IF NOT EXISTS foto_path text;

COMMENT ON COLUMN public.sup_patrimonio.foto_path IS
  'Caminho da foto no bucket privado sup-patrimonio (prefixo fotos/). Aberta por URL assinada; nunca é URL pública.';

-- Teto de 10 MB no bucket, o mesmo já validado no cliente para os anexos.
-- Estava sem limite: um upload de 500 MB passaria.
UPDATE storage.buckets
   SET file_size_limit = 10485760
 WHERE id = 'sup-patrimonio';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS bens, count(foto_path) AS com_foto
  FROM public.sup_patrimonio;

SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'sup-patrimonio';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.sup_patrimonio DROP COLUMN foto_path;
--   UPDATE storage.buckets SET file_size_limit = NULL WHERE id = 'sup-patrimonio';
-- =====================================================================
