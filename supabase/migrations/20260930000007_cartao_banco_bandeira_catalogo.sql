-- SIS-2026-0224 (ajuste): Banco (texto livre) e Bandeira (5 valores fixos
-- no código) do Cartão de Crédito viram catálogos de verdade, com logo
-- próprio e tela de gerenciamento dentro da própria página de Cartão de
-- Crédito — pedido do usuário depois de baixar os logos reais dos bancos/
-- bandeiras usados na empresa.
--
-- malote_cartao_credito (criada nesta mesma sessão, 20260930000005) está
-- vazia em produção — confirmado antes de escrever esta migration — então
-- as colunas banco/bandeira (texto) trocam por FK sem precisar de
-- backfill.

-- ── 1. Bucket de logos ────────────────────────────────────────────────
-- Público: logo de banco/bandeira não é dado sensível, serve direto por
-- URL pública (sem o custo de signed URL por request feito em
-- identidade-visual, que é dado sensível por empresa).
INSERT INTO storage.buckets (id, name, public)
VALUES ('cartao-logos', 'cartao-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública dispensa policy (bucket public=true serve GET sem RLS),
-- mas escrita passa por RLS normal — mesmo menu já criado pro Cartão de
-- Crédito (20260930000005), sem inventar has_role nem menu novo pra uma
-- sub-tela da mesma página.
CREATE POLICY cartao_logos_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cartao-logos' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

CREATE POLICY cartao_logos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'cartao-logos' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

-- ── 2. Catálogos ─────────────────────────────────────────────────────
CREATE TABLE public.malote_cartao_banco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  logo_path text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE public.malote_cartao_bandeira (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  logo_path text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.malote_cartao_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malote_cartao_bandeira ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_cartao_banco_select ON public.malote_cartao_banco FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));
CREATE POLICY malote_cartao_banco_insert ON public.malote_cartao_banco FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));
CREATE POLICY malote_cartao_banco_update ON public.malote_cartao_banco FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

CREATE POLICY malote_cartao_bandeira_select ON public.malote_cartao_bandeira FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'visualizar'::public.app_acao));
CREATE POLICY malote_cartao_bandeira_insert ON public.malote_cartao_bandeira FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));
CREATE POLICY malote_cartao_bandeira_update ON public.malote_cartao_bandeira FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

-- ── 3. malote_cartao_credito passa a referenciar os catálogos ──────────
ALTER TABLE public.malote_cartao_credito
  DROP COLUMN banco,
  DROP COLUMN bandeira,
  ADD COLUMN banco_id uuid REFERENCES public.malote_cartao_banco(id),
  ADD COLUMN bandeira_id uuid REFERENCES public.malote_cartao_bandeira(id);

ALTER TABLE public.malote_cartao_credito
  ALTER COLUMN banco_id SET NOT NULL,
  ALTER COLUMN bandeira_id SET NOT NULL;

-- ── 4. Seed dos nomes (logo entra depois via storage cp + UPDATE) ──────
INSERT INTO public.malote_cartao_banco (nome) VALUES
  ('Banco do Brasil'), ('Itaú'), ('Bradesco'), ('Santander'), ('Mentore'), ('Prospera')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO public.malote_cartao_bandeira (nome) VALUES
  ('Visa'), ('Mastercard'), ('Elo'), ('American Express'), ('Diners Club')
ON CONFLICT (nome) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public.malote_cartao_credito
--     DROP COLUMN banco_id, DROP COLUMN bandeira_id,
--     ADD COLUMN banco text, ADD COLUMN bandeira text;
--   DROP TABLE IF EXISTS public.malote_cartao_banco;
--   DROP TABLE IF EXISTS public.malote_cartao_bandeira;
--   DROP POLICY IF EXISTS cartao_logos_write ON storage.objects;
--   DROP POLICY IF EXISTS cartao_logos_update ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'cartao-logos';
--   DELETE FROM storage.buckets WHERE id = 'cartao-logos';
-- =====================================================================
