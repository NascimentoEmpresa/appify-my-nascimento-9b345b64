-- Ajuste após feedback do usuário na 20260930000006: a correção anterior
-- abriu SELECT com "USING (true)" solto, e as policies de escrita
-- (malote_adm_class_link_write / malote_lic_class_link_write) continuavam
-- com has_role('admin'/'controladoria'/'diretor_adm') hardcoded — em
-- desacordo com o modelo do projeto (acesso 100% via Gerenciamento de
-- Acesso, /app/administracao?tab=modulos, nunca por cargo/role — ver
-- README.md).
--
-- O frontend (Configuracoes.tsx:42) já gateia a edição dessas duas seções
-- de Ligação por can("alterar", "malote", "malote_configuracoes") — RLS
-- passa a espelhar exatamente isso, em vez de reinventar com has_role.
-- Confirmado que é a causa raiz certa: o Eduardo (que não tem nenhum dos 3
-- roles hardcoded) já tem can_access(..., 'malote_configuracoes', 'alterar')
-- = true pelo Gerenciamento de Acesso — só a RLS antiga é que não
-- reconhecia isso.
--
-- SELECT soma 'malote_criar_despesa' (visualizar) porque a leitura dessas
-- ligações também alimenta useRubricasVinculadas() em Criar Despesa — tela
-- usada por qualquer um que lança despesa, não só quem administra a
-- ligação em Configurações.

DROP POLICY IF EXISTS malote_adm_class_link_select ON public.malote_administrativo_classificacao_link;
CREATE POLICY malote_adm_class_link_select ON public.malote_administrativo_classificacao_link FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'malote_configuracoes', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'malote_criar_despesa', 'visualizar'::public.app_acao)
  );

DROP POLICY IF EXISTS malote_adm_class_link_write ON public.malote_administrativo_classificacao_link;
CREATE POLICY malote_adm_class_link_write ON public.malote_administrativo_classificacao_link FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS malote_lic_class_link_select ON public.malote_licitacao_classificacao_link;
CREATE POLICY malote_lic_class_link_select ON public.malote_licitacao_classificacao_link FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'malote_configuracoes', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'malote_criar_despesa', 'visualizar'::public.app_acao)
  );

DROP POLICY IF EXISTS malote_lic_class_link_write ON public.malote_licitacao_classificacao_link;
CREATE POLICY malote_lic_class_link_write ON public.malote_licitacao_classificacao_link FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_adm_class_link_select ON public.malote_administrativo_classificacao_link;
--   CREATE POLICY malote_adm_class_link_select ON public.malote_administrativo_classificacao_link FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS malote_adm_class_link_write ON public.malote_administrativo_classificacao_link;
--   CREATE POLICY malote_adm_class_link_write ON public.malote_administrativo_classificacao_link FOR ALL TO authenticated
--     USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
--     WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));
--   DROP POLICY IF EXISTS malote_lic_class_link_select ON public.malote_licitacao_classificacao_link;
--   CREATE POLICY malote_lic_class_link_select ON public.malote_licitacao_classificacao_link FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS malote_lic_class_link_write ON public.malote_licitacao_classificacao_link;
--   CREATE POLICY malote_lic_class_link_write ON public.malote_licitacao_classificacao_link FOR ALL TO authenticated
--     USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
--     WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));
-- =====================================================================
