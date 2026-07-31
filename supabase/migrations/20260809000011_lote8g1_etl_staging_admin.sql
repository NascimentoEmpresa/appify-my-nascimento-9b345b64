-- Lote 8g, bloco 1: ferramentas internas de ETL (mz_* + "Pacote 02" staging).
-- Todas são "FOR ALL ... USING has_role(admin) WITH CHECK has_role(admin)" —
-- puro admin-only, sem tela dedicada (confirmado: zero consumidor em src/,
-- só aparecem no types.ts gerado). Usa um loop dinâmico sobre pg_policies em
-- vez de escrever 38 blocos DROP/CREATE quase idênticos à mão — descobre o
-- nome real de cada policy (algumas vêm de um loop EXECUTE format() no
-- Pacote 02, então o nome exato só existe em produção) e só troca a condição.
--
-- ROLLBACK: repetir o mesmo loop trocando 'administracao'/'alterar' de volta
-- por has_role(auth.uid(),'admin'::app_role) na condição.

DO $$
DECLARE
  r RECORD;
  v_tables text[] := ARRAY[
    'mz_01_diagnostico_arquivos_migracao', 'mz_02_dim_empresas',
    'mz_03_dim_plano_contas_atual_enriquecido', 'mz_04_dim_centros_custo_contratos_completo',
    'mz_05_dim_eventos_contabeis', 'mz_06_dim_bancos_contas_financeiras',
    'mz_10_stg_base_original_normalizada', 'mz_20_stg_mapa_de_para_contabil_financeiro',
    'mz_21_stg_mapa_de_para_bancos', 'mz_22_stg_sugestoes_novas_contas',
    'mz_23_stg_pendencias_de_para', 'mz_24_dim_plano_contas_completo_proposto',
    'mz_25_stg_mapa_de_para_orcamento_contratos', 'mz_26_template_aprovacao_contas',
    'mz_27_reconciliacao_de_para_pacote_do_zero', 'mz_30_stg_lancamentos_mestre',
    'mz_32_fato_razao_contabil', 'mz_33_fato_balancete',
    'mz_40_fato_fluxo_caixa_realizado', 'mz_41_fato_fluxo_caixa_projetado',
    'mz_60_view_dre_gerencial_competencia', 'mz_61_view_dre_caixa_gerencial',
    'mz_62_view_ativo', 'mz_63_view_passivo', 'mz_64_view_patrimonio_liquido',
    'mz_65_view_contas_resultado', 'mz_90_stg_pendencias_validacao',
    'mz_91_stg_logs_processamento', 'mz_92_stg_reconciliacao_migracao',
    'mz_status', 'mz_32_promocao_log',
    'stg_mapa_de_para_contabil_financeiro', 'stg_mapa_de_para_bancos_pacote02',
    'stg_pendencias_de_para', 'stg_plano_contas_proposto',
    'stg_mapa_de_para_orcamento_contratos', 'stg_logs_processamento',
    'stg_reconciliacao_pacotes', 'stg_aprovacao_contas', 'stg_sugestoes_novas_contas'
  ];
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(v_tables)
      AND qual ILIKE '%has_role%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_access(auth.uid(), ''administracao'', ''alterar'')) WITH CHECK (public.can_access(auth.uid(), ''administracao'', ''alterar''))',
      r.policyname, r.tablename
    );
  END LOOP;
END $$;

-- storage.objects, bucket migracao-zero (nomes fixos, não descobertos via loop)
DROP POLICY IF EXISTS "mz_storage_admin_select" ON storage.objects;
CREATE POLICY "mz_storage_admin_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='migracao-zero' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "mz_storage_admin_insert" ON storage.objects;
CREATE POLICY "mz_storage_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='migracao-zero' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "mz_storage_admin_update" ON storage.objects;
CREATE POLICY "mz_storage_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='migracao-zero' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS "mz_storage_admin_delete" ON storage.objects;
CREATE POLICY "mz_storage_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='migracao-zero' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

-- ============================================================================
-- Família adicional de staging (achada só na verificação ao vivo — não estava
-- no levantamento original): 9 tabelas com o mesmo trio de policies
-- (_delete = só admin; _read/_update = admin OU membro da empresa via
-- user_pode_atuar_empresa, que não é cargo e fica intocado).
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  v_tables2 text[] := ARRAY[
    'stg_fluxo_caixa_realizado', 'stg_colaboradores_ativos', 'stg_clientes_cnpj',
    'stg_contratos_master', 'stg_contratos_custos_wide', 'stg_contratos_custos_long',
    'stg_fluxo_caixa_projetado', 'stg_licitacoes', 'stg_colaboradores_base'
  ];
BEGIN
  -- _delete: só admin
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(v_tables2) AND policyname LIKE '%\_delete' ESCAPE '\'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_access(auth.uid(), ''administracao'', ''alterar''))',
      r.policyname, r.tablename
    );
  END LOOP;

  -- _read: admin OU membro da empresa (preserva o check de empresa, só troca o has_role)
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(v_tables2) AND policyname LIKE '%\_read' ESCAPE '\'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_access(auth.uid(), ''administracao'', ''alterar'') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))',
      r.policyname, r.tablename
    );
  END LOOP;

  -- _update: mesma regra do _read
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(v_tables2) AND policyname LIKE '%\_update' ESCAPE '\'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_access(auth.uid(), ''administracao'', ''alterar'') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))',
      r.policyname, r.tablename
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
