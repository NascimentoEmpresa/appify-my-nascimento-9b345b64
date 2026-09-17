-- SIS-2026-0427: migração do Extrator/Gerador de Planilha VA e VT (app
-- Python desktop da Ana) pro ERP, como nova Ferramenta do Financeiro.
--
-- Processamento pesado (extração de PDF, decodificação Type3 da TRI) roda
-- no worker/ (Node, fora do request/response) — mesmo padrão já usado por
-- worker/src/emailAta.js: frontend grava 1 linha de job, worker detecta no
-- próximo ciclo de polling, processa, grava o resultado de volta.
--
-- Escopo confirmado com o usuário: 4 tomadores (UFRGS, SAMU, SMS, TJ —
-- "Jardinagem" é o mesmo contexto/contrato da UFRGS, não é tomador
-- separado); jobs visíveis pra todo o financeiro (não só quem criou).
--
-- Idempotente.

-- ── 1. Tabela de job ─────────────────────────────────────────────────────
CREATE TABLE public.extrator_beneficios_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tomador text NOT NULL CHECK (tomador IN ('ufrgs', 'samu', 'sms', 'tj')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'processando', 'concluido', 'erro')),
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb, -- tipo_beneficio, valor_unitario, periodo, etc — varia por tomador
  arquivos_entrada jsonb NOT NULL, -- {base: path, va: path, vt: path, ponto: path} — chaves variam por tomador
  arquivo_saida_path text, -- preenchido pelo worker quando status='concluido'
  mensagem_erro text, -- preenchido pelo worker quando status='erro'
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_extrator_beneficios_job_status ON public.extrator_beneficios_job(status);

CREATE TRIGGER extrator_beneficios_job_set_updated BEFORE UPDATE ON public.extrator_beneficios_job
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. RLS — visualizar é compartilhado (decisão do usuário: qualquer um
-- com acesso à tela vê o histórico de todo o financeiro); incluir exige a
-- ação e só grava em nome de quem está logado ─────────────────────────────
ALTER TABLE public.extrator_beneficios_job ENABLE ROW LEVEL SECURITY;

CREATE POLICY extrator_beneficios_job_select ON public.extrator_beneficios_job
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-extrator-beneficios', 'visualizar'::public.app_acao));

CREATE POLICY extrator_beneficios_job_insert ON public.extrator_beneficios_job
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'financeiro-extrator-beneficios', 'incluir'::public.app_acao)
    AND created_by = auth.uid()
  );
-- Sem policy de UPDATE/DELETE pra authenticated de propósito: só o worker
-- (service_role, ignora RLS) atualiza status/arquivo_saida_path/mensagem_erro.

-- ── 3. Storage — bucket privado (arquivos de entrada e planilha gerada;
-- dado de funcionário/financeiro, não pode ser público) ───────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('extrator-beneficios', 'extrator-beneficios', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY extrator_beneficios_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'extrator-beneficios' AND public.can_access(auth.uid(), 'financeiro-extrator-beneficios', 'visualizar'::public.app_acao));

CREATE POLICY extrator_beneficios_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'extrator-beneficios' AND public.can_access(auth.uid(), 'financeiro-extrator-beneficios', 'incluir'::public.app_acao));

-- ── 4. Menu novo + ações + seed de acesso (J1.A/J2 — menu novo nasce
-- ABERTO pra qualquer autenticado sem isso; 'incluir'/'visualizar' já
-- vêm no toggle padrão, mas a tela só some do "nasce aberto" se alguém
-- semear explicitamente aqui, mesmo padrão de 20260930000059) ─────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-extrator-beneficios', 'Financeiro — Extrator de Benefícios (VA/VT)', '/app/financeiro/gestao-financeira/extrator-beneficios', 34
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-extrator-beneficios', 'visualizar'),
  ('financeiro-extrator-beneficios', 'incluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-extrator-beneficios', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-extrator-beneficios';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-extrator-beneficios';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-extrator-beneficios';
--   DROP POLICY IF EXISTS extrator_beneficios_storage_insert ON storage.objects;
--   DROP POLICY IF EXISTS extrator_beneficios_storage_select ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'extrator-beneficios';
--   DROP TABLE IF EXISTS public.extrator_beneficios_job;
-- =====================================================================
