-- SIS-2026-0492 (Iury): conciliação bancária nova, automática, puxando o
-- lado "Fluxo" direto do Fluxo de Caixa interno (useFluxoCaixaCombinado —
-- as 3 views de malote/débito automático/cartão) em vez de planilha
-- subida manualmente. O usuário ainda sobe os .OFX do banco; quando bater
-- 100%, salva a conciliação (arquivos + resultado) pra consulta futura.
--
-- A tela antiga (planilha + OFX, menu_codigo 'conciliacao-bancaria')
-- continua existindo pra quem ainda controla o fluxo em planilha — só
-- muda de nome no menu, pra não confundir com a nova.
--
-- 1) Renomeia a tela antiga.
-- 2) Registra a tela nova em app_menu — menu_codigo PRÓPRIO (não
--    reaproveita 'financeiro-fluxo-caixa-gestao'), pra aparecer como
--    toggle independente em Gerenciamento de Acesso (pedido explícito do
--    usuário: "precisamos de permissão também no gerenciamento de
--    acesso"). Semeada de propósito pro perfil "Malote" (mesmo público
--    que já usa Fluxo de Caixa/Malote hoje) — sem isso, J2 do nosso guia
--    de PR se aplica: menu novo sem seed em perfil_acesso_permissao nasce
--    ABERTO pra qualquer autenticado (RouteGuard trata "sem seed" como
--    "ninguém configurou ainda"). Ajustável depois em Gerenciamento de
--    Acesso sem tocar na permissão do Fluxo de Caixa (Gestão).
-- 3) Tabelas da conciliação salva (header + arquivos + linhas) — snapshot
--    read-only de uma conciliação que já bateu 100%, não um rascunho
--    editável.
-- 4) Bucket de Storage pros .OFX originais.

-- ── 1. Renomeia a tela antiga ────────────────────────────────────────
UPDATE public.app_menu
SET nome = 'Conciliação Bancária (Planilha Manual)'
WHERE codigo = 'conciliacao-bancaria';

-- ── 2. Tela nova ─────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'conciliacao-fluxo-caixa', 'Conciliação Bancária', '/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa', 34
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'conciliacao-fluxo-caixa', acao.nome::public.app_acao, true
FROM public.perfil_acesso pa
CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('aprovar'), ('exportar')) AS acao(nome)
WHERE pa.nome = 'Malote'
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

-- ── 3. Conciliação salva ─────────────────────────────────────────────
CREATE TABLE public.financeiro_conciliacao_fluxo_caixa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_inicio date NOT NULL,
  data_fim date NOT NULL,
  observacoes text,
  total_linhas int NOT NULL DEFAULT 0,
  linhas_ajustadas int NOT NULL DEFAULT 0,
  linhas_criadas int NOT NULL DEFAULT 0,
  linhas_ignoradas int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.financeiro_conciliacao_fluxo_caixa_arquivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conciliacao_id uuid NOT NULL REFERENCES public.financeiro_conciliacao_fluxo_caixa(id) ON DELETE CASCADE,
  nome_arquivo text NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Snapshot das linhas do resultado final — despesa_id/numero_parcela só
-- fazem sentido quando origem = 'fluxo' (mesma limitação de FK que as
-- views do Fluxo de Caixa já têm, ver 20260930000212: aponta pra uma de 3
-- tabelas diferentes dependendo da origem real do lançamento, não dá pra
-- ser FK única de banco).
CREATE TABLE public.financeiro_conciliacao_fluxo_caixa_linha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conciliacao_id uuid NOT NULL REFERENCES public.financeiro_conciliacao_fluxo_caixa(id) ON DELETE CASCADE,
  dia date NOT NULL,
  origem text NOT NULL CHECK (origem IN ('fluxo', 'extrato')),
  tipo text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  valor numeric NOT NULL,
  descricao text,
  banco text,
  status text NOT NULL CHECK (status IN ('ok', 'ajustado', 'ignorado', 'criado')),
  observacao text,
  despesa_id uuid,
  numero_parcela int
);
CREATE INDEX idx_conciliacao_fluxo_caixa_linha_conciliacao ON public.financeiro_conciliacao_fluxo_caixa_linha(conciliacao_id);

ALTER TABLE public.financeiro_conciliacao_fluxo_caixa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_conciliacao_fluxo_caixa_arquivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro_conciliacao_fluxo_caixa_linha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_select ON public.financeiro_conciliacao_fluxo_caixa;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_select ON public.financeiro_conciliacao_fluxo_caixa
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_insert ON public.financeiro_conciliacao_fluxo_caixa;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_insert ON public.financeiro_conciliacao_fluxo_caixa
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_delete ON public.financeiro_conciliacao_fluxo_caixa;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_delete ON public.financeiro_conciliacao_fluxo_caixa
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'excluir'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_arquivo_select ON public.financeiro_conciliacao_fluxo_caixa_arquivo;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_arquivo_select ON public.financeiro_conciliacao_fluxo_caixa_arquivo
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_arquivo_insert ON public.financeiro_conciliacao_fluxo_caixa_arquivo;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_arquivo_insert ON public.financeiro_conciliacao_fluxo_caixa_arquivo
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_linha_select ON public.financeiro_conciliacao_fluxo_caixa_linha;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_linha_select ON public.financeiro_conciliacao_fluxo_caixa_linha
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS financeiro_conciliacao_fluxo_caixa_linha_insert ON public.financeiro_conciliacao_fluxo_caixa_linha;
CREATE POLICY financeiro_conciliacao_fluxo_caixa_linha_insert ON public.financeiro_conciliacao_fluxo_caixa_linha
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'));

-- ── 4. Bucket dos .OFX originais ─────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('conciliacao-fluxo-caixa', 'conciliacao-fluxo-caixa', false, 10485760)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS conciliacao_fluxo_caixa_storage_select ON storage.objects;
CREATE POLICY conciliacao_fluxo_caixa_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'conciliacao-fluxo-caixa' AND public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'visualizar'));

DROP POLICY IF EXISTS conciliacao_fluxo_caixa_storage_insert ON storage.objects;
CREATE POLICY conciliacao_fluxo_caixa_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conciliacao-fluxo-caixa' AND public.can_access(auth.uid(), 'conciliacao-fluxo-caixa', 'incluir'));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DELETE FROM storage.objects WHERE bucket_id = 'conciliacao-fluxo-caixa';
--   DELETE FROM storage.buckets WHERE id = 'conciliacao-fluxo-caixa';
--   DROP TABLE IF EXISTS public.financeiro_conciliacao_fluxo_caixa_linha;
--   DROP TABLE IF EXISTS public.financeiro_conciliacao_fluxo_caixa_arquivo;
--   DROP TABLE IF EXISTS public.financeiro_conciliacao_fluxo_caixa;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'conciliacao-fluxo-caixa';
--   DELETE FROM public.app_menu WHERE codigo = 'conciliacao-fluxo-caixa';
--   UPDATE public.app_menu SET nome = 'Conciliação Bancária' WHERE codigo = 'conciliacao-bancaria';
