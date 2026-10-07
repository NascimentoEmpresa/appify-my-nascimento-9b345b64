-- ============================================================================
-- Lucratividade de Contratos — painel de ligação Classificação × Rubrica de custo
-- ============================================================================
-- As colunas de custo da Lucratividade (Salários, Férias, Rescisões, FGTS, INSS,
-- VA, VT, Outras Despesas) eram decididas por palavra no NOME da classificação
-- do Malote. Esta tabela guarda só as ESCOLHAS MANUAIS da Controladoria
-- (classificação → rubrica). Classificação sem linha aqui continua no automático
-- (nome casa → rubrica certa; resto → Outras Despesas), então uma classificação
-- nova nunca fica sem destino. 'nao_custo' tira a classificação do cálculo
-- (juros, consignado, etc.).
--
-- Acesso: menu fantasma 'lucratividade-rubricas' (visualizar / alterar), liberado
-- por usuário em /app/administracao?tab=modulos. Leitura também para quem vê a
-- Lucratividade, que precisa do mapa para calcular as colunas.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.lucratividade_rubrica_classificacao;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'lucratividade-rubricas';
--   DELETE FROM public.app_menu WHERE codigo = 'lucratividade-rubricas';
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.lucratividade_rubrica_classificacao (
  classificacao_id uuid PRIMARY KEY
    REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  rubrica text NOT NULL
    CHECK (rubrica IN ('salarios', 'ferias', 'rescisoes', 'fgts', 'inss', 'va', 'vt', 'outras', 'nao_custo')),
  -- Sem FK para auth.users de propósito: a FK trava a tabela do Auth (lock
  -- compartilhado) e já causou deadlock ao aplicar esta migration com o ERP em uso.
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS lrc_set_updated ON public.lucratividade_rubrica_classificacao;
CREATE TRIGGER lrc_set_updated BEFORE UPDATE ON public.lucratividade_rubrica_classificacao
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.lucratividade_rubrica_classificacao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lrc_select ON public.lucratividade_rubrica_classificacao;
CREATE POLICY lrc_select ON public.lucratividade_rubrica_classificacao
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'lucratividade-rubricas', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'lucratividade-contratos', 'visualizar'::public.app_acao)
  );

DROP POLICY IF EXISTS lrc_insert ON public.lucratividade_rubrica_classificacao;
CREATE POLICY lrc_insert ON public.lucratividade_rubrica_classificacao
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'lucratividade-rubricas', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS lrc_update ON public.lucratividade_rubrica_classificacao;
CREATE POLICY lrc_update ON public.lucratividade_rubrica_classificacao
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'lucratividade-rubricas', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'lucratividade-rubricas', 'alterar'::public.app_acao));

-- "Voltar ao automático" = apagar a linha.
DROP POLICY IF EXISTS lrc_delete ON public.lucratividade_rubrica_classificacao;
CREATE POLICY lrc_delete ON public.lucratividade_rubrica_classificacao
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'lucratividade-rubricas', 'alterar'::public.app_acao));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lucratividade_rubrica_classificacao TO authenticated;

-- Menu fantasma (sem rota): só dá visibilidade própria à aba no Gerenciamento de Acesso.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'lucratividade-rubricas', 'Lucratividade — Rubricas de custo', NULL, 53
  FROM public.app_modulo m
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'lucratividade-rubricas', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
