-- SIS-2026-0304: migra o "Checklist de Faturamento" do sistema legado
-- (Sistema Financeiro Nascimento, Python/eel/SQLite, pasta
-- ...\FINANCEIRO\ANA X ISA) pro ERP. Achado inspecionando o main.py e o
-- financeiro.db do legado (dado real: 59 contratos, 51 docs-padrão, 870
-- vínculos contrato×doc, 5034 marcações, 1122 anexos, 95 envios):
--
--   1. Catálogo de documentos-padrão exigidos por contrato.
--   2. Matriz Contrato × Documento × Competência com status de entrega
--      (ciclo pendente → a_conferir → ok → nao_aplicavel, clicável,
--      auto-save — confirmado em script.js:27 STATUS_CICLO).
--   3. Anexo real por célula.
--   4. "Concluir e baixar" fecha a competência do contrato (substitui o
--      "enviar e-mail via Outlook Desktop" do legado — automação COM
--      inviável num ERP web; decisão confirmada com o usuário: baixa
--      .zip, o usuário manda pelo e-mail dele).
--
-- Contratos NÃO viram cadastro novo — usa public.contratos direto
-- (já tem empresa_id/nome/email_envio_nf, decisão confirmada com o
-- usuário pra não duplicar cadastro).
--
-- Dado histórico do legado (5034 marcações + 1122 anexos) FICA DE FORA
-- desta migration de propósito — time ainda usa o sistema antigo ao vivo,
-- migração roda como script separado só no fim do dia (ver plano
-- sis-2026-0304-checklist-faturamento.md).

-- ── 1. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE public."CHECKLIST_FATURAMENTO_DOC" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."CHECKLIST_FATURAMENTO_CONTRATO_DOC" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  doc_id uuid NOT NULL REFERENCES public."CHECKLIST_FATURAMENTO_DOC"(id),
  ordem int NOT NULL DEFAULT 0,
  UNIQUE (contrato_id, doc_id)
);

-- 1 config por contrato: dia-limite PADRÃO de entrega (dia do mês
-- seguinte à competência). Substitui o "grava 1 linha física por
-- competência futura, propagando o dia" do legado (comentário original:
-- "propaga o mesmo dia-do-mês para competências futuras que ainda não
-- possuem data limite") por um valor único calculado dinamicamente todo
-- mês — sem risco de "esquecer de propagar".
CREATE TABLE public."CHECKLIST_FATURAMENTO_CONTRATO_CONFIG" (
  contrato_id uuid PRIMARY KEY REFERENCES public.contratos(id),
  dia_limite_padrao smallint CHECK (dia_limite_padrao BETWEEN 1 AND 31),
  -- 1ª competência que este contrato participa do checklist — null = desde sempre.
  comp_inicio date
);

-- Exceção pontual ao dia-limite padrão pra uma competência específica.
CREATE TABLE public."CHECKLIST_FATURAMENTO_COMP_LIMITE" (
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  competencia date NOT NULL,
  data_limite date NOT NULL,
  PRIMARY KEY (contrato_id, competencia)
);

CREATE TABLE public."CHECKLIST_FATURAMENTO_MARCACAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  doc_id uuid NOT NULL REFERENCES public."CHECKLIST_FATURAMENTO_DOC"(id),
  competencia date NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'a_conferir', 'ok', 'nao_aplicavel')),
  usuario_marcacao uuid REFERENCES auth.users(id),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contrato_id, doc_id, competencia)
);

CREATE TABLE public."CHECKLIST_FATURAMENTO_ANEXO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  doc_id uuid NOT NULL REFERENCES public."CHECKLIST_FATURAMENTO_DOC"(id),
  competencia date NOT NULL,
  storage_path text NOT NULL,
  nome_original text NOT NULL,
  tamanho_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."CHECKLIST_FATURAMENTO_ENVIO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  competencia date NOT NULL,
  baixado_em timestamptz NOT NULL DEFAULT now(),
  baixado_por uuid REFERENCES auth.users(id),
  UNIQUE (contrato_id, competencia)
);

CREATE INDEX idx_checklist_fat_contrato_doc_contrato ON public."CHECKLIST_FATURAMENTO_CONTRATO_DOC"(contrato_id);
CREATE INDEX idx_checklist_fat_marcacao_contrato_comp ON public."CHECKLIST_FATURAMENTO_MARCACAO"(contrato_id, competencia);
CREATE INDEX idx_checklist_fat_anexo_contrato_doc_comp ON public."CHECKLIST_FATURAMENTO_ANEXO"(contrato_id, doc_id, competencia);

CREATE TRIGGER checklist_fat_marcacao_set_updated BEFORE UPDATE ON public."CHECKLIST_FATURAMENTO_MARCACAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public."CHECKLIST_FATURAMENTO_DOC" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_CONTRATO_DOC" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_CONTRATO_CONFIG" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_COMP_LIMITE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_MARCACAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_ANEXO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHECKLIST_FATURAMENTO_ENVIO" ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_fat_doc_select ON public."CHECKLIST_FATURAMENTO_DOC"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_doc_alterar ON public."CHECKLIST_FATURAMENTO_DOC"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

CREATE POLICY checklist_fat_contrato_doc_select ON public."CHECKLIST_FATURAMENTO_CONTRATO_DOC"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_contrato_doc_alterar ON public."CHECKLIST_FATURAMENTO_CONTRATO_DOC"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

CREATE POLICY checklist_fat_config_select ON public."CHECKLIST_FATURAMENTO_CONTRATO_CONFIG"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_config_alterar ON public."CHECKLIST_FATURAMENTO_CONTRATO_CONFIG"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

CREATE POLICY checklist_fat_comp_limite_select ON public."CHECKLIST_FATURAMENTO_COMP_LIMITE"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_comp_limite_alterar ON public."CHECKLIST_FATURAMENTO_COMP_LIMITE"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

CREATE POLICY checklist_fat_marcacao_select ON public."CHECKLIST_FATURAMENTO_MARCACAO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_marcacao_alterar ON public."CHECKLIST_FATURAMENTO_MARCACAO"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'alterar'));

CREATE POLICY checklist_fat_anexo_select ON public."CHECKLIST_FATURAMENTO_ANEXO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_anexo_incluir ON public."CHECKLIST_FATURAMENTO_ANEXO"
  FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'incluir'));
CREATE POLICY checklist_fat_anexo_excluir ON public."CHECKLIST_FATURAMENTO_ANEXO"
  FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'excluir'));

CREATE POLICY checklist_fat_envio_select ON public."CHECKLIST_FATURAMENTO_ENVIO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));
CREATE POLICY checklist_fat_envio_incluir ON public."CHECKLIST_FATURAMENTO_ENVIO"
  FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'incluir'));

-- ── 3. Storage — bucket privado ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('checklist-faturamento-anexos', 'checklist-faturamento-anexos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY checklist_fat_anexos_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'checklist-faturamento-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'visualizar'));

CREATE POLICY checklist_fat_anexos_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'checklist-faturamento-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'incluir'));

CREATE POLICY checklist_fat_anexos_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'checklist-faturamento-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-checklist-faturamento', 'excluir'));

-- ── 4. Menu + acesso ─────────────────────────────────────────────────────
-- Achado real do validador de PR em chamados anteriores desta sessão:
-- menu novo sem seed em app_menu_acao/perfil_acesso_permissao nasce
-- ABERTO pra qualquer autenticado, e 'excluir' nunca sai do toggle padrão
-- de "Acesso por Usuário" sem seed explícito.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-checklist-faturamento', 'Financeiro — Checklist de Faturamento',
  '/app/financeiro/checklist-faturamento', 35
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-checklist-faturamento', 'incluir'),
  ('financeiro-checklist-faturamento', 'alterar'),
  ('financeiro-checklist-faturamento', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-checklist-faturamento', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-checklist-faturamento';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-checklist-faturamento';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-checklist-faturamento';
--   DROP POLICY IF EXISTS checklist_fat_anexos_bucket_delete ON storage.objects;
--   DROP POLICY IF EXISTS checklist_fat_anexos_bucket_insert ON storage.objects;
--   DROP POLICY IF EXISTS checklist_fat_anexos_bucket_select ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'checklist-faturamento-anexos';
--   DELETE FROM storage.buckets WHERE id = 'checklist-faturamento-anexos';
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_ENVIO";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_ANEXO";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_MARCACAO";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_COMP_LIMITE";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_CONTRATO_CONFIG";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_CONTRATO_DOC";
--   DROP TABLE IF EXISTS public."CHECKLIST_FATURAMENTO_DOC";
-- =====================================================================
