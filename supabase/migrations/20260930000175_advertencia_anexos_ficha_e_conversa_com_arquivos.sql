-- =========================================================================
-- Advertências: anexos na solicitação, ficha completa do advertido e
-- conversa com arquivos/imagens (todas as solicitações)
--
-- PEDIDO (17/09/2026, Pablo)
--   • Quem solicita a advertência anexa arquivos, se quiser (opcional).
--   • O card mostra o advertido com mais clareza: CPF, admissão, tempo de
--     empresa, contrato, posto, escala.
--   • Na conversa da solicitação dá pra mandar fotos/anexos, inclusive
--     colando imagem com Ctrl+V (e copiar com Ctrl+C).
--   • O fluxo já não passa pelo Operacional (mig 124) — só o texto da tela
--     estava desatualizado.
--
-- O QUE MUDA
--   1. SISTEMA_SOLICITACOES_ADVERTENCIA ganha colaborador_admissao (date),
--      colaborador_posto e colaborador_escala — copiados de EMPREGADOS no
--      envio, como as outras colunas colaborador_*. Tempo de empresa é
--      calculado na tela a partir da admissão.
--   2. Bucket privado `solicitacoes-anexos` (25 MB por arquivo), com
--      caminhos <modulo>/<id>/... — serve pros anexos da solicitação E
--      pros da conversa. Aberto a autenticados como o demissoes-docs: o
--      gate de verdade é a RLS da solicitação (quem não vê a advertência
--      não chega no caminho do arquivo; os nomes têm timestamp).
--   3. SISTEMA_SOLICITACOES_ANEXOS: os arquivos de uma solicitação
--      (modulo + entidade_id, mesmo par do SISTEMA_COMENTARIOS). Começa
--      pela advertência; os outros módulos podem usar sem mudar nada.
--   4. SISTEMA_COMENTARIOS.anexos jsonb: [{nome, path, tipo, tamanho}] dos
--      arquivos de uma mensagem. Texto pode ir vazio quando há anexo.
--
-- Idempotente. Aplicada no banco do app em 17/09/2026. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Ficha do advertido ─────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  ADD COLUMN IF NOT EXISTS colaborador_admissao date,
  ADD COLUMN IF NOT EXISTS colaborador_posto    text,
  ADD COLUMN IF NOT EXISTS colaborador_escala   text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_ADVERTENCIA".colaborador_posto IS
  'EMPREGADOS."Descrição do Local" no momento do pedido (o posto dentro do contrato).';

-- ── 2) Bucket dos anexos de solicitações ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('solicitacoes-anexos', 'solicitacoes-anexos', false, 26214400)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS solicitacoes_anexos_select ON storage.objects;
CREATE POLICY solicitacoes_anexos_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'solicitacoes-anexos');
DROP POLICY IF EXISTS solicitacoes_anexos_insert ON storage.objects;
CREATE POLICY solicitacoes_anexos_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'solicitacoes-anexos');
DROP POLICY IF EXISTS solicitacoes_anexos_delete ON storage.objects;
CREATE POLICY solicitacoes_anexos_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'solicitacoes-anexos' AND owner = auth.uid());

-- ── 3) Anexos da solicitação ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_ANEXOS" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  modulo       text NOT NULL,          -- advertencia | ferias | demissao | troca_funcao (mesmo par do SISTEMA_COMENTARIOS)
  entidade_id  text NOT NULL,
  nome         text NOT NULL,
  storage_path text NOT NULL,
  tipo         text,
  tamanho      bigint,
  autor_nome   text,
  autor_email  text,
  autor_id     uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sistema_solicitacoes_anexos_ent_idx
  ON public."SISTEMA_SOLICITACOES_ANEXOS" (modulo, entidade_id, id);

COMMENT ON TABLE public."SISTEMA_SOLICITACOES_ANEXOS" IS
  'Arquivos anexados a uma solicitação (advertência, férias, demissão, mudança de função), no bucket solicitacoes-anexos. Chave modulo + entidade_id, a mesma do feed SISTEMA_COMENTARIOS.';

ALTER TABLE public."SISTEMA_SOLICITACOES_ANEXOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."SISTEMA_SOLICITACOES_ANEXOS" TO authenticated;

-- Mesma régua do SISTEMA_COMENTARIOS (all_auth): quem abre a solicitação
-- (RLS dela) vê e anexa; apagar só o próprio.
DROP POLICY IF EXISTS sistema_solicitacoes_anexos_select ON public."SISTEMA_SOLICITACOES_ANEXOS";
CREATE POLICY sistema_solicitacoes_anexos_select ON public."SISTEMA_SOLICITACOES_ANEXOS"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sistema_solicitacoes_anexos_insert ON public."SISTEMA_SOLICITACOES_ANEXOS";
CREATE POLICY sistema_solicitacoes_anexos_insert ON public."SISTEMA_SOLICITACOES_ANEXOS"
  FOR INSERT TO authenticated WITH CHECK (autor_id = auth.uid());
DROP POLICY IF EXISTS sistema_solicitacoes_anexos_delete ON public."SISTEMA_SOLICITACOES_ANEXOS";
CREATE POLICY sistema_solicitacoes_anexos_delete ON public."SISTEMA_SOLICITACOES_ANEXOS"
  FOR DELETE TO authenticated USING (autor_id = auth.uid());

-- ── 4) Anexos na conversa ────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_COMENTARIOS"
  ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public."SISTEMA_COMENTARIOS".anexos IS
  'Arquivos da mensagem: [{nome, path, tipo, tamanho}], no bucket solicitacoes-anexos. Mensagem só com anexo tem texto vazio.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_COMENTARIOS" DROP COLUMN IF EXISTS anexos;
-- DROP TABLE IF EXISTS public."SISTEMA_SOLICITACOES_ANEXOS";
-- DROP POLICY IF EXISTS solicitacoes_anexos_select ON storage.objects;
-- DROP POLICY IF EXISTS solicitacoes_anexos_insert ON storage.objects;
-- DROP POLICY IF EXISTS solicitacoes_anexos_delete ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'solicitacoes-anexos';  -- só com o bucket vazio
-- ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA"
--   DROP COLUMN IF EXISTS colaborador_admissao, DROP COLUMN IF EXISTS colaborador_posto, DROP COLUMN IF EXISTS colaborador_escala;
-- NOTIFY pgrst, 'reload schema';
