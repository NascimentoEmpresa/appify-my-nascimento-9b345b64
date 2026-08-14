-- =====================================================================
-- EMPRESA DEIXA DE FILTRAR — passo 1: as duas funções-alavanca
--
-- DECISÃO (Eduardo, 13/08/2026)
-- A empresa em que o usuário está logado é informação VISUAL. Ela não pode
-- decidir o que alguém vê ou deixa de ver. Quem governa acesso é o Acesso por
-- Usuário (can_access / has_permissao / has_screen_access).
--
-- POR QUE MEXER NA FUNÇÃO, E NÃO NAS POLICIES
-- Levantamento do schema: 97 policies filtram empresa de verdade. Delas,
-- **42 passam por estas duas funções**. Reescrever 42 policies em tabelas de
-- outros donos é risco alto e revisão difícil; trocar o corpo de duas funções
-- resolve tudo de uma vez, com um diff que cabe na tela e rollback trivial.
--
-- É o mesmo caminho que o Plano de Ações já tinha tomado: lá
-- `plano_acao_can_access` ainda RECEBE p_empresa_id, mas ignora o argumento —
-- com o comentário "não depende mais de vínculo com empresa".
--
-- NENHUMA ESCRITA FICA DESPROTEGIDA
-- Conferido policy a policy antes de aplicar: as que usam estas funções têm
-- OUTRO controle junto (can_access / has_permissao). As duas únicas em que a
-- empresa era o único controle são SELECT, e ambas devem mesmo abrir:
--   • empresas            → é a lista que alimenta o seletor da topbar;
--   • licitacao_importacao_lote → lote de importação, leitura.
-- Em particular, as escritas de fornecedor_conta_bancaria (dado bancário) e
-- de bdi_item/bdi_posto/bdi_verba_folha seguem exigindo has_permissao — elas
-- nunca dependeram só da empresa.
--
-- AS FUNÇÕES CONTINUAM EXISTINDO, e com a mesma assinatura, de propósito: 42
-- policies as chamam. Trocar o corpo é o ponto único de reversão.
-- =====================================================================

-- ── 1. user_can_see_empresa ──────────────────────────────────────────
-- Antes: can_access('administracao') OR acessa_todas_empresas OR vínculo em
-- user_empresa OR profiles.empresa_id. Bastava não ter vínculo para enxergar
-- ZERO — foi assim que o CASSIO, com todas as permissões de Suprimentos,
-- via 0 de 64 contratos.
CREATE OR REPLACE FUNCTION public.user_can_see_empresa(_empresa_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Empresa não restringe mais. A permissão de cada tela é que decide, e ela
  -- é avaliada na própria policy, ao lado desta chamada.
  SELECT auth.uid() IS NOT NULL;
$$;

COMMENT ON FUNCTION public.user_can_see_empresa(uuid) IS
  'Sempre verdadeiro para autenticado. Empresa é informação visual e não governa acesso (decisão 13/08/2026). Mantida com a assinatura original porque 42 policies a chamam.';

-- ── 2. user_pode_atuar_empresa ───────────────────────────────────────
-- `_empresa IS NOT NULL` fica: é sanidade de linha (registro sem empresa
-- continua se comportando como antes), não recorte por empresa do usuário.
CREATE OR REPLACE FUNCTION public.user_pode_atuar_empresa(_user uuid, _empresa uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL AND _empresa IS NOT NULL;
$$;

COMMENT ON FUNCTION public.user_pode_atuar_empresa(uuid, uuid) IS
  'Sempre verdadeiro para autenticado com empresa definida. Empresa não governa acesso (decisão 13/08/2026).';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS policies_que_usam_estas_funcoes
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (coalesce(qual::text, '') || coalesce(with_check::text, ''))
       ~* '(user_can_see_empresa|user_pode_atuar_empresa)';

SELECT count(*) AS empresas_visiveis FROM public.empresas;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK — restaura os dois corpos originais:
--
-- CREATE OR REPLACE FUNCTION public.user_can_see_empresa(_empresa_id uuid)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--   SELECT public.can_access(auth.uid(), 'administracao', 'alterar')
--     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--                 AND p.acessa_todas_empresas = true
--                 AND EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = _empresa_id AND e.ativa = true))
--     OR EXISTS (SELECT 1 FROM public.user_empresa ue WHERE ue.user_id = auth.uid() AND ue.empresa_id = _empresa_id)
--     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.empresa_id = _empresa_id);
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.user_pode_atuar_empresa(_user uuid, _empresa uuid)
-- RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--   SELECT _empresa IS NOT NULL AND (
--     public.can_access(_user, 'administracao', 'alterar')
--     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user
--                 AND p.acessa_todas_empresas = true
--                 AND EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = _empresa AND e.ativa = true))
--     OR EXISTS (SELECT 1 FROM public.user_empresa ue WHERE ue.user_id = _user AND ue.empresa_id = _empresa)
--     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.empresa_id = _empresa));
-- $$;
-- =====================================================================
