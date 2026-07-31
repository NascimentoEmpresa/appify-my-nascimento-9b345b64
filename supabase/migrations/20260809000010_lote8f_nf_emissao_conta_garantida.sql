-- Lote 8f: Emissão de NF e Conta Garantida — duas funcionalidades construídas
-- DEPOIS da virada pro perfil_acesso (21-28/jul e 09/ago), inteiramente em
-- has_role(), nunca migradas. Registra 2 menus novos (nf-emissao, conta-garantida
-- sob o módulo financeiro) e reescreve toda a RLS.
--
-- nf_emissao tem 4 níveis de escrita diferentes hoje (confirmado lendo o estado
-- atual de todas as migrations, incluindo o ajuste recente de outro dev em
-- 20260809000003_nf_emissao_role_financeiro.sql) — cada um mapeado pra uma ação
-- diferente do MESMO menu 'nf-emissao', pra preservar exatamente quem podia
-- fazer o quê:
--   'alterar' = dia a dia (criar/editar/excluir NF): admin/controladoria/diretor_adm/financeiro
--   'aprovar' = configurar modelo de NF / dados fiscais do contrato: admin/controladoria/diretor_adm (sem financeiro)
--   'incluir' = editar uma NF já "enviada": admin/controladoria/financeiro (sem diretor_adm)
--   'excluir' = mexer numa NF já "concluída"/"cancelada": só admin
-- 'visualizar' = leitura (empresa bate OU esse acesso) — não é gate real de
-- cargo hoje (todo mundo da empresa já lia), só substitui o bypass do admin
-- pra ver de outras empresas.
--
-- Conta Garantida é mais simples: leitura sempre livre (USING true, inalterado
-- — nunca foi restrita por cargo), escrita hoje é admin/controladoria/diretor_adm
-- → 'alterar' no menu 'conta-garantida'.
--
-- ROLLBACK: recriar cada policy abaixo com has_role() nas combinações descritas
-- acima (texto exato em cada migration original: 20260721000001_nf_emissao.sql,
-- 20260722000002_nf_emissao_historico.sql, 20260722000004_nf_emissao_pagamento.sql,
-- 20260728000001_nf_emissao_modelo.sql, 20260728000003_nf_emissao_tipo_reconciliacao.sql,
-- 20260809000003_nf_emissao_role_financeiro.sql, 20260723000002_conta_garantida.sql).

-- ============================================================================
-- Menus novos
-- ============================================================================
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
FROM public.app_modulo m, (VALUES
  ('financeiro', 'nf-emissao',      'Emissão de NF',   '/app/financeiro/nf-emissao',      32),
  ('financeiro', 'conta-garantida', 'Conta Garantida', '/app/financeiro/conta-garantida', 33)
) AS x(modulo_codigo, codigo, nome, rota, ordem)
WHERE m.codigo = x.modulo_codigo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ============================================================================
-- contrato_dados_fiscais: NÃO existe em produção (confirmado via
-- information_schema.tables) — a migration original que a criava
-- (20260721000001_nf_emissao.sql) nunca rodou completa, ou essa tabela
-- específica foi abandonada. Nada a migrar aqui; se a tabela for criada no
-- futuro, replicar o mesmo padrão de "nf_emissao" abaixo (Nível B: aprovar).
-- ============================================================================

-- ============================================================================
-- nf_emissao (Nível A: alterar)
-- ============================================================================
DROP POLICY IF EXISTS "nfe_select" ON public.nf_emissao;
CREATE POLICY "nfe_select" ON public.nf_emissao FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'));

DROP POLICY IF EXISTS "nfe_insert" ON public.nf_emissao;
CREATE POLICY "nfe_insert" ON public.nf_emissao FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

DROP POLICY IF EXISTS "nfe_update" ON public.nf_emissao;
CREATE POLICY "nfe_update" ON public.nf_emissao FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

DROP POLICY IF EXISTS "nfe_delete" ON public.nf_emissao;
CREATE POLICY "nfe_delete" ON public.nf_emissao FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

-- ============================================================================
-- nf_emissao_item (Nível A: alterar)
-- ============================================================================
DROP POLICY IF EXISTS "nfei_select" ON public.nf_emissao_item;
CREATE POLICY "nfei_select" ON public.nf_emissao_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfei_write" ON public.nf_emissao_item;
CREATE POLICY "nfei_write" ON public.nf_emissao_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

-- ============================================================================
-- nf_emissao_anexo (Nível A: alterar)
-- ============================================================================
DROP POLICY IF EXISTS "nfea_select" ON public.nf_emissao_anexo;
CREATE POLICY "nfea_select" ON public.nf_emissao_anexo FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfea_write" ON public.nf_emissao_anexo;
CREATE POLICY "nfea_write" ON public.nf_emissao_anexo FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

-- ============================================================================
-- nf_emissao_historico (leitura/insert já eram só empresa+admin, sem outro
-- cargo restringindo — só troca o bypass de "outra empresa")
-- ============================================================================
DROP POLICY IF EXISTS "nf_emissao_historico_select" ON public.nf_emissao_historico;
CREATE POLICY "nf_emissao_historico_select" ON public.nf_emissao_historico FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nf_emissao_historico_insert" ON public.nf_emissao_historico;
CREATE POLICY "nf_emissao_historico_insert" ON public.nf_emissao_historico FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (n.empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

-- ============================================================================
-- nf_emissao_modelo / nf_emissao_modelo_item (Nível B: aprovar)
-- ============================================================================
DROP POLICY IF EXISTS "nfem_select" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_select" ON public.nf_emissao_modelo FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'));

DROP POLICY IF EXISTS "nfem_insert" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_insert" ON public.nf_emissao_modelo FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

DROP POLICY IF EXISTS "nfem_update" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_update" ON public.nf_emissao_modelo FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

DROP POLICY IF EXISTS "nfem_delete" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_delete" ON public.nf_emissao_modelo FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR empresa_id = get_user_empresa(auth.uid()))
  );

DROP POLICY IF EXISTS "nfemi_select" ON public.nf_emissao_modelo_item;
CREATE POLICY "nfemi_select" ON public.nf_emissao_modelo_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND (m.empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfemi_write" ON public.nf_emissao_modelo_item;
CREATE POLICY "nfemi_write" ON public.nf_emissao_modelo_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR m.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR m.empresa_id = get_user_empresa(auth.uid()))
  ));

-- ============================================================================
-- storage.objects (bucket nf-emissao)
-- ============================================================================
DROP POLICY IF EXISTS "nf_emissao_storage_select" ON storage.objects;
CREATE POLICY "nf_emissao_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'visualizar') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

DROP POLICY IF EXISTS "nf_emissao_storage_insert" ON storage.objects;
CREATE POLICY "nf_emissao_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'visualizar') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

DROP POLICY IF EXISTS "nf_emissao_storage_delete" ON storage.objects;
CREATE POLICY "nf_emissao_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'alterar') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

-- ============================================================================
-- Trigger de imutabilidade — Nível C ('incluir': editar NF 'enviada') e
-- Nível D ('excluir': mexer em NF 'concluida'/'cancelada', só quem tem essa
-- ação — hoje só admin via concede_tudo).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
  v_campos_livres text[] := ARRAY[
    'data_pagamento', 'valor_pago',
    'situacao_site_pmt', 'situacao_dominio',
    'desconto_conta_vinculada', 'recebimento_extra', 'falta_receber', 'pago_a_mais',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - v_campos_livres) = (to_jsonb(NEW) - v_campos_livres);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT public.can_access(auth.uid(), 'nf-emissao', 'excluir') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- Conta Garantida — leitura sempre livre (inalterado), escrita = 'alterar'
-- ============================================================================
DROP POLICY IF EXISTS "fcgb_write" ON public.fin_conta_garantida_banco;
CREATE POLICY fcgb_write ON public.fin_conta_garantida_banco FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'conta-garantida', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conta-garantida', 'alterar'));

DROP POLICY IF EXISTS "fcgm_write" ON public.fin_conta_garantida_movimento;
CREATE POLICY fcgm_write ON public.fin_conta_garantida_movimento FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'conta-garantida', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conta-garantida', 'alterar'));

DROP POLICY IF EXISTS "fcdi_write" ON public.fin_cdi_historico;
CREATE POLICY fcdi_write ON public.fin_cdi_historico FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'conta-garantida', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'conta-garantida', 'alterar'));

-- ============================================================================
-- Backfill dos perfis Legado — menus novos, ninguém tem nada neles ainda.
-- Legado: admin não precisa (cobre tudo via "Administrador Geral"/concede_tudo).
-- ============================================================================
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu_codigo, x.acao::public.app_acao, true
FROM public.perfil_acesso pa, (VALUES
  ('Legado: controladoria', 'nf-emissao', 'visualizar'),
  ('Legado: controladoria', 'nf-emissao', 'alterar'),
  ('Legado: controladoria', 'nf-emissao', 'aprovar'),
  ('Legado: controladoria', 'nf-emissao', 'incluir'),
  ('Legado: controladoria', 'conta-garantida', 'alterar'),
  ('Legado: diretor_adm', 'nf-emissao', 'visualizar'),
  ('Legado: diretor_adm', 'nf-emissao', 'alterar'),
  ('Legado: diretor_adm', 'nf-emissao', 'aprovar'),
  ('Legado: diretor_adm', 'conta-garantida', 'alterar'),
  ('Legado: financeiro', 'nf-emissao', 'visualizar'),
  ('Legado: financeiro', 'nf-emissao', 'alterar'),
  ('Legado: financeiro', 'nf-emissao', 'incluir')
) AS x(perfil_nome, menu_codigo, acao)
WHERE pa.nome = x.perfil_nome
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = x.menu_codigo AND pap.acao = x.acao::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
