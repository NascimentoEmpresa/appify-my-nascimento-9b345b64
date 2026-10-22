-- SIS-2026-0702: novo Orçamento Administrativo / Orçamento Sócios (regras do documento "Regras do Módulo de Orçamentos").
-- Desenvolvido EM PARALELO ao Orçamento Administrativo atual (planejamento_orcamentario): tabela própria, menu próprio, rota própria.
-- Nada do módulo atual é alterado; a ligação com a produção fica para depois.
--
-- Uma linha = uma Classificação Administrativo dentro de uma das duas abas (tipo). As duas abas usam as mesmas classificações, mas os
-- dados de cada uma são independentes (unique por tipo + classificação). O que é calculado (valor orçado, saldo, utilizado) NÃO é gravado:
-- vem ao vivo da Planilha de Custo (origem) e do Malote (utilizado); aqui fica só a configuração.

CREATE TABLE IF NOT EXISTS public.orcamento_adm_socios_linha (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('administrativo', 'socios')),
  classificacao_administrativa_id uuid NOT NULL REFERENCES public.malote_classificacao_administrativo(id) ON DELETE CASCADE,
  descricao text NOT NULL DEFAULT '',
  -- 'percentual': valor orçado = saldo remanescente das origens × percentual; 'manual': valor digitado e rateado entre as empresas
  modo text NOT NULL DEFAULT 'percentual' CHECK (modo IN ('percentual', 'manual')),
  percentual numeric(7,4) NOT NULL DEFAULT 0 CHECK (percentual >= 0 AND percentual <= 100),
  -- classificações do Malote (as do Orçamento Geral - Contratos) que servem de origem
  origem_classificacao_ids uuid[] NOT NULL DEFAULT '{}',
  valor_manual numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_manual >= 0),
  -- modo manual: { "<empresa_id>": percentual } — a soma tem que fechar 100
  distribuicao_empresas jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tipo, classificacao_administrativa_id)
);

DROP TRIGGER IF EXISTS orcamento_adm_socios_linha_set_updated ON public.orcamento_adm_socios_linha;
CREATE TRIGGER orcamento_adm_socios_linha_set_updated
  BEFORE UPDATE ON public.orcamento_adm_socios_linha
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.orcamento_adm_socios_linha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_adm_socios_linha_select ON public.orcamento_adm_socios_linha;
CREATE POLICY orcamento_adm_socios_linha_select ON public.orcamento_adm_socios_linha
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS orcamento_adm_socios_linha_insert ON public.orcamento_adm_socios_linha;
CREATE POLICY orcamento_adm_socios_linha_insert ON public.orcamento_adm_socios_linha
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'incluir'::public.app_acao));

DROP POLICY IF EXISTS orcamento_adm_socios_linha_update ON public.orcamento_adm_socios_linha;
CREATE POLICY orcamento_adm_socios_linha_update ON public.orcamento_adm_socios_linha
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS orcamento_adm_socios_linha_delete ON public.orcamento_adm_socios_linha;
CREATE POLICY orcamento_adm_socios_linha_delete ON public.orcamento_adm_socios_linha
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'excluir'::public.app_acao));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_adm_socios_linha TO authenticated;

-- ── app_menu + permissões (mesmo padrão de 20260901000005) ──
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_orcamento_adm_socios', 'Malote — Orçamento ADM e Sócios (novo)', '/app/malote/orcamento-adm-socios', 25
  FROM public.app_modulo m
 WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'malote_orcamento_adm_socios', a.acao, true
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
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'malote_orcamento_adm_socios';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'malote_orcamento_adm_socios';
--   DELETE FROM public.app_menu WHERE codigo = 'malote_orcamento_adm_socios';
--   DROP TABLE IF EXISTS public.orcamento_adm_socios_linha;
-- =====================================================================
