-- =====================================================================
-- SIS-2026-0446 — GRADE: ata de classificação anexa ao processo
--
-- PEDIDO
--   Depois que o edital entra em "Em Andamento", precisamos anexar a ata de
--   classificação junto ao processo da grade, pra identificar nas reuniões
--   quais empresas entraram na licitação. A ata (empresa + anexo) passa a ser
--   exigida no momento em que o edital MUDA para "Em Andamento" (validado no
--   frontend — GradeSheet; ver SIS-2026-0463 pra empresa).
--
-- O QUE MUDA
--   1. `grade` ganha as colunas da ata (um arquivo por processo): caminho no
--      Storage, nome original, tamanho, quem enviou e quando.
--   2. Bucket privado `grade-atas` (10 MB por arquivo). Sem allowed_mime_types:
--      o que protege é o download forçado no cliente (createSignedUrl com
--      `download`), que impede .html/.svg de renderizar na aba — mesma decisão
--      do bucket cotacoes-arquivos (20260826000001).
--   3. Policies de storage.objects abertas a autenticados: o gate real é a RLS
--      da grade (quem não enxerga a grade não chega ao caminho do arquivo; os
--      nomes têm timestamp) — mesma régua do solicitacoes-anexos (20260930000175).
--
-- RLS da grade é can_access('pipeline', ...) — não filtra por empresa —, então
-- nada de novo do lado da tabela: as colunas viajam no mesmo UPDATE/INSERT.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── 1) Colunas da ata na grade ───────────────────────────────────────
ALTER TABLE public.grade
  ADD COLUMN IF NOT EXISTS ata_caminho    text,
  ADD COLUMN IF NOT EXISTS ata_nome       text,
  ADD COLUMN IF NOT EXISTS ata_tamanho    bigint,
  ADD COLUMN IF NOT EXISTS ata_enviado_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS ata_enviado_em  timestamptz;

COMMENT ON COLUMN public.grade.ata_caminho IS
  'Caminho no bucket grade-atas da ata de classificação (SIS-2026-0446). NULL = sem ata.';

-- ── 2) Bucket privado das atas ───────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('grade-atas', 'grade-atas', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- ── 3) Policies de storage.objects ───────────────────────────────────
-- Autenticado enxerga/anexa; apagar só quem subiu. O gate de negócio é a
-- RLS da grade, não estas policies (mesma decisão do solicitacoes-anexos).
DROP POLICY IF EXISTS grade_atas_select ON storage.objects;
CREATE POLICY grade_atas_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'grade-atas');
DROP POLICY IF EXISTS grade_atas_insert ON storage.objects;
CREATE POLICY grade_atas_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'grade-atas');
DROP POLICY IF EXISTS grade_atas_delete ON storage.objects;
CREATE POLICY grade_atas_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'grade-atas' AND owner = auth.uid());

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS grade_atas_select ON storage.objects;
--   DROP POLICY IF EXISTS grade_atas_insert ON storage.objects;
--   DROP POLICY IF EXISTS grade_atas_delete ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'grade-atas';  -- só com o bucket vazio
--   ALTER TABLE public.grade
--     DROP COLUMN IF EXISTS ata_caminho, DROP COLUMN IF EXISTS ata_nome,
--     DROP COLUMN IF EXISTS ata_tamanho, DROP COLUMN IF EXISTS ata_enviado_por,
--     DROP COLUMN IF EXISTS ata_enviado_em;
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
