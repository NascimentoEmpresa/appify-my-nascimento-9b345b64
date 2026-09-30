-- ============================================================================
-- Espelho contabil (mz_*): can_access() em subquery escalar dentro das policies
-- ============================================================================
--
-- POR QUE ISSO EXISTE
-- -------------------
-- As 34 tabelas do espelho contabil (mz_*) tem uma unica policy cada, todas
-- identicas:
--
--   FOR ALL TO authenticated
--   USING      ( can_access(auth.uid(), 'administracao', 'alterar') )
--   WITH CHECK ( can_access(auth.uid(), 'administracao', 'alterar') )
--
-- can_access() e STABLE, mas escrita CRUA no filtro ela e avaliada UMA VEZ POR
-- LINHA. Nessas tabelas isso e catastrofico, porque elas sao grandes:
--
--   Medido em producao (29/09/2026), EXPLAIN ANALYZE como role authenticated,
--   em mz_32_fato_razao_contabil (207 mil linhas):
--
--     count(*) com a policy crua ................ 12.364 ms (usuario COM acesso)
--                                                 20.601 ms (avaliando por linha)
--     mesma consulta com (select can_access(...))     0,3 ms
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
-- Envelopa a chamada em subquery escalar: `(select can_access(...))`. Com isso o
-- Postgres avalia a funcao UMA VEZ por query, como InitPlan, em vez de uma vez
-- por linha. E o padrao que a propria Supabase recomenda para RLS.
--
-- POR QUE E SEGURO (NAO MUDA QUEM VE O QUE)
-- -----------------------------------------
-- `X` e `(SELECT X)` retornam o MESMO booleano para uma expressao STABLE. O
-- valor logico do filtro e identico; muda so QUANTAS VEZES ele e calculado.
-- Nao ha como vazar dado entre usuarios, porque a decisao de acesso e a mesma.
-- Mesma funcao, mesmos argumentos, mesmo resultado.
--
-- O roteiro de verificacao de visibilidade por perfil (antes/depois) esta em
-- docs/verificacao-rls-mz.sql — rode ANTES e DEPOIS de aplicar e confirme que
-- as contagens batem linha a linha.
--
-- ESCOPO
-- ------
-- So as 34 tabelas mz_*, que tem forma identica e uma unica policy cada (zero
-- interacao com outras policies). NAO e um mass rewrite das ~700 policies do
-- banco: essas serao tratadas caso a caso, medindo antes, porque em tabela
-- pequena (ex. sup_pedido, ~2300 linhas) a reescrita nao muda nada (medido:
-- 226ms -> 222ms).
-- ============================================================================

-- mz_01_diagnostico_arquivos_migracao
DROP POLICY IF EXISTS "mz_01_admin" ON public."mz_01_diagnostico_arquivos_migracao";
CREATE POLICY "mz_01_admin" ON public."mz_01_diagnostico_arquivos_migracao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_02_dim_empresas
DROP POLICY IF EXISTS "mz_02_admin" ON public."mz_02_dim_empresas";
CREATE POLICY "mz_02_admin" ON public."mz_02_dim_empresas"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_03_dim_plano_contas_atual_enriquecido
DROP POLICY IF EXISTS "mz_03_admin" ON public."mz_03_dim_plano_contas_atual_enriquecido";
CREATE POLICY "mz_03_admin" ON public."mz_03_dim_plano_contas_atual_enriquecido"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_04_dim_centros_custo_contratos_completo
DROP POLICY IF EXISTS "mz_04_admin" ON public."mz_04_dim_centros_custo_contratos_completo";
CREATE POLICY "mz_04_admin" ON public."mz_04_dim_centros_custo_contratos_completo"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_05_dim_eventos_contabeis
DROP POLICY IF EXISTS "mz_05_admin" ON public."mz_05_dim_eventos_contabeis";
CREATE POLICY "mz_05_admin" ON public."mz_05_dim_eventos_contabeis"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_06_dim_bancos_contas_financeiras
DROP POLICY IF EXISTS "mz_06_admin" ON public."mz_06_dim_bancos_contas_financeiras";
CREATE POLICY "mz_06_admin" ON public."mz_06_dim_bancos_contas_financeiras"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_10_stg_base_original_normalizada
DROP POLICY IF EXISTS "mz_10_admin" ON public."mz_10_stg_base_original_normalizada";
CREATE POLICY "mz_10_admin" ON public."mz_10_stg_base_original_normalizada"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_20_stg_mapa_de_para_contabil_financeiro
DROP POLICY IF EXISTS "mz_20_admin" ON public."mz_20_stg_mapa_de_para_contabil_financeiro";
CREATE POLICY "mz_20_admin" ON public."mz_20_stg_mapa_de_para_contabil_financeiro"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_21_stg_mapa_de_para_bancos
DROP POLICY IF EXISTS "mz_21_admin" ON public."mz_21_stg_mapa_de_para_bancos";
CREATE POLICY "mz_21_admin" ON public."mz_21_stg_mapa_de_para_bancos"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_22_stg_sugestoes_novas_contas
DROP POLICY IF EXISTS "mz_22_admin" ON public."mz_22_stg_sugestoes_novas_contas";
CREATE POLICY "mz_22_admin" ON public."mz_22_stg_sugestoes_novas_contas"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_23_stg_pendencias_de_para
DROP POLICY IF EXISTS "mz_23_admin" ON public."mz_23_stg_pendencias_de_para";
CREATE POLICY "mz_23_admin" ON public."mz_23_stg_pendencias_de_para"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_24_dim_plano_contas_completo_proposto
DROP POLICY IF EXISTS "mz_24_admin" ON public."mz_24_dim_plano_contas_completo_proposto";
CREATE POLICY "mz_24_admin" ON public."mz_24_dim_plano_contas_completo_proposto"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_25_stg_mapa_de_para_orcamento_contratos
DROP POLICY IF EXISTS "mz_25_admin" ON public."mz_25_stg_mapa_de_para_orcamento_contratos";
CREATE POLICY "mz_25_admin" ON public."mz_25_stg_mapa_de_para_orcamento_contratos"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_26_template_aprovacao_contas
DROP POLICY IF EXISTS "mz_26_admin" ON public."mz_26_template_aprovacao_contas";
CREATE POLICY "mz_26_admin" ON public."mz_26_template_aprovacao_contas"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_27_reconciliacao_de_para_pacote_do_zero
DROP POLICY IF EXISTS "mz_27_admin" ON public."mz_27_reconciliacao_de_para_pacote_do_zero";
CREATE POLICY "mz_27_admin" ON public."mz_27_reconciliacao_de_para_pacote_do_zero"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_29_stg_titulos_migracao
DROP POLICY IF EXISTS "mz_29_admin" ON public."mz_29_stg_titulos_migracao";
CREATE POLICY "mz_29_admin" ON public."mz_29_stg_titulos_migracao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_30_stg_lancamentos_mestre
DROP POLICY IF EXISTS "mz_30_admin" ON public."mz_30_stg_lancamentos_mestre";
CREATE POLICY "mz_30_admin" ON public."mz_30_stg_lancamentos_mestre"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_31_fato_partidas_dobradas
DROP POLICY IF EXISTS "mz_31_admin" ON public."mz_31_fato_partidas_dobradas";
CREATE POLICY "mz_31_admin" ON public."mz_31_fato_partidas_dobradas"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_32_fato_razao_contabil
DROP POLICY IF EXISTS "mz_32_admin" ON public."mz_32_fato_razao_contabil";
CREATE POLICY "mz_32_admin" ON public."mz_32_fato_razao_contabil"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_32_promocao_log
DROP POLICY IF EXISTS "mz_32_promocao_log_admin" ON public."mz_32_promocao_log";
CREATE POLICY "mz_32_promocao_log_admin" ON public."mz_32_promocao_log"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_33_fato_balancete
DROP POLICY IF EXISTS "mz_33_admin" ON public."mz_33_fato_balancete";
CREATE POLICY "mz_33_admin" ON public."mz_33_fato_balancete"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_40_fato_fluxo_caixa_realizado
DROP POLICY IF EXISTS "mz_40_admin" ON public."mz_40_fato_fluxo_caixa_realizado";
CREATE POLICY "mz_40_admin" ON public."mz_40_fato_fluxo_caixa_realizado"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_41_fato_fluxo_caixa_projetado
DROP POLICY IF EXISTS "mz_41_admin" ON public."mz_41_fato_fluxo_caixa_projetado";
CREATE POLICY "mz_41_admin" ON public."mz_41_fato_fluxo_caixa_projetado"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_50_fato_orcamento_contratos_competencia
DROP POLICY IF EXISTS "mz_50_admin" ON public."mz_50_fato_orcamento_contratos_competencia";
CREATE POLICY "mz_50_admin" ON public."mz_50_fato_orcamento_contratos_competencia"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_60_view_dre_gerencial_competencia
DROP POLICY IF EXISTS "mz_60_admin" ON public."mz_60_view_dre_gerencial_competencia";
CREATE POLICY "mz_60_admin" ON public."mz_60_view_dre_gerencial_competencia"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_61_view_dre_caixa_gerencial
DROP POLICY IF EXISTS "mz_61_admin" ON public."mz_61_view_dre_caixa_gerencial";
CREATE POLICY "mz_61_admin" ON public."mz_61_view_dre_caixa_gerencial"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_62_view_ativo
DROP POLICY IF EXISTS "mz_62_admin" ON public."mz_62_view_ativo";
CREATE POLICY "mz_62_admin" ON public."mz_62_view_ativo"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_63_view_passivo
DROP POLICY IF EXISTS "mz_63_admin" ON public."mz_63_view_passivo";
CREATE POLICY "mz_63_admin" ON public."mz_63_view_passivo"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_64_view_patrimonio_liquido
DROP POLICY IF EXISTS "mz_64_admin" ON public."mz_64_view_patrimonio_liquido";
CREATE POLICY "mz_64_admin" ON public."mz_64_view_patrimonio_liquido"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_65_view_contas_resultado
DROP POLICY IF EXISTS "mz_65_admin" ON public."mz_65_view_contas_resultado";
CREATE POLICY "mz_65_admin" ON public."mz_65_view_contas_resultado"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_90_stg_pendencias_validacao
DROP POLICY IF EXISTS "mz_90_admin" ON public."mz_90_stg_pendencias_validacao";
CREATE POLICY "mz_90_admin" ON public."mz_90_stg_pendencias_validacao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_91_stg_logs_processamento
DROP POLICY IF EXISTS "mz_91_admin" ON public."mz_91_stg_logs_processamento";
CREATE POLICY "mz_91_admin" ON public."mz_91_stg_logs_processamento"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_92_stg_reconciliacao_migracao
DROP POLICY IF EXISTS "mz_92_admin" ON public."mz_92_stg_reconciliacao_migracao";
CREATE POLICY "mz_92_admin" ON public."mz_92_stg_reconciliacao_migracao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- mz_status
DROP POLICY IF EXISTS "mz_status_admin" ON public."mz_status";
CREATE POLICY "mz_status_admin" ON public."mz_status"
  AS PERMISSIVE FOR ALL TO authenticated
  USING      ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK  (volta as policies para a forma crua, byte a byte a original)
-- ============================================================================
-- DROP POLICY IF EXISTS "mz_01_admin" ON public."mz_01_diagnostico_arquivos_migracao";
-- CREATE POLICY "mz_01_admin" ON public."mz_01_diagnostico_arquivos_migracao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_02_admin" ON public."mz_02_dim_empresas";
-- CREATE POLICY "mz_02_admin" ON public."mz_02_dim_empresas"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_03_admin" ON public."mz_03_dim_plano_contas_atual_enriquecido";
-- CREATE POLICY "mz_03_admin" ON public."mz_03_dim_plano_contas_atual_enriquecido"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_04_admin" ON public."mz_04_dim_centros_custo_contratos_completo";
-- CREATE POLICY "mz_04_admin" ON public."mz_04_dim_centros_custo_contratos_completo"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_05_admin" ON public."mz_05_dim_eventos_contabeis";
-- CREATE POLICY "mz_05_admin" ON public."mz_05_dim_eventos_contabeis"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_06_admin" ON public."mz_06_dim_bancos_contas_financeiras";
-- CREATE POLICY "mz_06_admin" ON public."mz_06_dim_bancos_contas_financeiras"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_10_admin" ON public."mz_10_stg_base_original_normalizada";
-- CREATE POLICY "mz_10_admin" ON public."mz_10_stg_base_original_normalizada"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_20_admin" ON public."mz_20_stg_mapa_de_para_contabil_financeiro";
-- CREATE POLICY "mz_20_admin" ON public."mz_20_stg_mapa_de_para_contabil_financeiro"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_21_admin" ON public."mz_21_stg_mapa_de_para_bancos";
-- CREATE POLICY "mz_21_admin" ON public."mz_21_stg_mapa_de_para_bancos"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_22_admin" ON public."mz_22_stg_sugestoes_novas_contas";
-- CREATE POLICY "mz_22_admin" ON public."mz_22_stg_sugestoes_novas_contas"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_23_admin" ON public."mz_23_stg_pendencias_de_para";
-- CREATE POLICY "mz_23_admin" ON public."mz_23_stg_pendencias_de_para"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_24_admin" ON public."mz_24_dim_plano_contas_completo_proposto";
-- CREATE POLICY "mz_24_admin" ON public."mz_24_dim_plano_contas_completo_proposto"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_25_admin" ON public."mz_25_stg_mapa_de_para_orcamento_contratos";
-- CREATE POLICY "mz_25_admin" ON public."mz_25_stg_mapa_de_para_orcamento_contratos"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_26_admin" ON public."mz_26_template_aprovacao_contas";
-- CREATE POLICY "mz_26_admin" ON public."mz_26_template_aprovacao_contas"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_27_admin" ON public."mz_27_reconciliacao_de_para_pacote_do_zero";
-- CREATE POLICY "mz_27_admin" ON public."mz_27_reconciliacao_de_para_pacote_do_zero"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_29_admin" ON public."mz_29_stg_titulos_migracao";
-- CREATE POLICY "mz_29_admin" ON public."mz_29_stg_titulos_migracao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_30_admin" ON public."mz_30_stg_lancamentos_mestre";
-- CREATE POLICY "mz_30_admin" ON public."mz_30_stg_lancamentos_mestre"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_31_admin" ON public."mz_31_fato_partidas_dobradas";
-- CREATE POLICY "mz_31_admin" ON public."mz_31_fato_partidas_dobradas"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_32_admin" ON public."mz_32_fato_razao_contabil";
-- CREATE POLICY "mz_32_admin" ON public."mz_32_fato_razao_contabil"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_32_promocao_log_admin" ON public."mz_32_promocao_log";
-- CREATE POLICY "mz_32_promocao_log_admin" ON public."mz_32_promocao_log"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_33_admin" ON public."mz_33_fato_balancete";
-- CREATE POLICY "mz_33_admin" ON public."mz_33_fato_balancete"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_40_admin" ON public."mz_40_fato_fluxo_caixa_realizado";
-- CREATE POLICY "mz_40_admin" ON public."mz_40_fato_fluxo_caixa_realizado"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_41_admin" ON public."mz_41_fato_fluxo_caixa_projetado";
-- CREATE POLICY "mz_41_admin" ON public."mz_41_fato_fluxo_caixa_projetado"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_50_admin" ON public."mz_50_fato_orcamento_contratos_competencia";
-- CREATE POLICY "mz_50_admin" ON public."mz_50_fato_orcamento_contratos_competencia"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_60_admin" ON public."mz_60_view_dre_gerencial_competencia";
-- CREATE POLICY "mz_60_admin" ON public."mz_60_view_dre_gerencial_competencia"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_61_admin" ON public."mz_61_view_dre_caixa_gerencial";
-- CREATE POLICY "mz_61_admin" ON public."mz_61_view_dre_caixa_gerencial"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_62_admin" ON public."mz_62_view_ativo";
-- CREATE POLICY "mz_62_admin" ON public."mz_62_view_ativo"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_63_admin" ON public."mz_63_view_passivo";
-- CREATE POLICY "mz_63_admin" ON public."mz_63_view_passivo"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_64_admin" ON public."mz_64_view_patrimonio_liquido";
-- CREATE POLICY "mz_64_admin" ON public."mz_64_view_patrimonio_liquido"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_65_admin" ON public."mz_65_view_contas_resultado";
-- CREATE POLICY "mz_65_admin" ON public."mz_65_view_contas_resultado"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_90_admin" ON public."mz_90_stg_pendencias_validacao";
-- CREATE POLICY "mz_90_admin" ON public."mz_90_stg_pendencias_validacao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_91_admin" ON public."mz_91_stg_logs_processamento";
-- CREATE POLICY "mz_91_admin" ON public."mz_91_stg_logs_processamento"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_92_admin" ON public."mz_92_stg_reconciliacao_migracao";
-- CREATE POLICY "mz_92_admin" ON public."mz_92_stg_reconciliacao_migracao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "mz_status_admin" ON public."mz_status";
-- CREATE POLICY "mz_status_admin" ON public."mz_status"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING      (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- NOTIFY pgrst, 'reload schema';
