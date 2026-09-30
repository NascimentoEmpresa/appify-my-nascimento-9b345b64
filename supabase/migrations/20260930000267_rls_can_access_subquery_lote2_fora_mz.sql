-- ============================================================================
-- RLS: can_access() em subquery escalar — lote 2 (tabelas fora do espelho mz_*)
-- ============================================================================
--
-- Continuacao da 20260930000265 (as 34 tabelas mz_*). Aqui vao as policies
-- PURAS (o filtro e so can_access(), sem user_id nem EXISTS) de tabelas fora
-- do mz_* com mais de 2000 linhas.
--
-- POR QUE
-- can_access() e STABLE mas, escrita crua, e avaliada UMA VEZ POR LINHA. Medido
-- em producao (29/09/2026) como role authenticated:
--   sst_ca_catalogo (42 mil linhas): scan puro 4,6 ms; com a policy crua 2.429 ms.
--   O custo inteiro e can_access por linha; a reescrita zera isso.
--
-- POR QUE E SEGURO
-- `X` e `(select X)` devolvem o mesmo booleano para expressao STABLE — mesma
-- decisao de acesso, muda so quantas vezes e calculada. Provado por wrap+unwrap:
-- remover os `(select ...)` devolve o texto ORIGINAL byte a byte (35 expressoes,
-- 0 divergencias). Verificacao de visibilidade por perfil em
-- docs/verificacao-rls-mz.sql (mesma logica; troque os nomes de tabela).
--
-- ESCOPO / FORA
-- So as policies PURAS. As MISTAS (user_id = auth.uid() OR can_access(...)) e as
-- com EXISTS ficam para lote proprio, com cuidado extra.
-- ============================================================================

-- aud_plano_contas_origem_diagnostico.aud_pc_select_admin_contr_pres (SELECT)
DROP POLICY IF EXISTS "aud_pc_select_admin_contr_pres" ON public."aud_plano_contas_origem_diagnostico";
CREATE POLICY "aud_pc_select_admin_contr_pres" ON public."aud_plano_contas_origem_diagnostico"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));

-- audit_log_2026_05.audit_admin_ctrl_select (SELECT)
DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public."audit_log_2026_05";
CREATE POLICY "audit_admin_ctrl_select" ON public."audit_log_2026_05"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));

-- audit_log_default.audit_admin_ctrl_select (SELECT)
DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public."audit_log_default";
CREATE POLICY "audit_admin_ctrl_select" ON public."audit_log_default"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)));

-- colaborador.col_write (ALL)
DROP POLICY IF EXISTS "col_write" ON public."colaborador";
CREATE POLICY "col_write" ON public."colaborador"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'colaboradores'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'colaboradores'::text, 'alterar'::app_acao)));

-- colaborador.col_select (SELECT)
DROP POLICY IF EXISTS "col_select" ON public."colaborador";
CREATE POLICY "col_select" ON public."colaborador"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'colaboradores'::text, 'visualizar'::app_acao)));

-- orcamento_contrato_linha.ocl_delete (DELETE)
DROP POLICY IF EXISTS "ocl_delete" ON public."orcamento_contrato_linha";
CREATE POLICY "ocl_delete" ON public."orcamento_contrato_linha"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((select can_access(auth.uid(), 'orcamento'::text, 'excluir'::app_acao)));

-- orcamento_contrato_linha.ocl_insert (INSERT)
DROP POLICY IF EXISTS "ocl_insert" ON public."orcamento_contrato_linha";
CREATE POLICY "ocl_insert" ON public."orcamento_contrato_linha"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((select can_access(auth.uid(), 'orcamento'::text, 'incluir'::app_acao)));

-- orcamento_contrato_linha.ocl_select (SELECT)
DROP POLICY IF EXISTS "ocl_select" ON public."orcamento_contrato_linha";
CREATE POLICY "ocl_select" ON public."orcamento_contrato_linha"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'orcamento'::text, 'visualizar'::app_acao)));

-- orcamento_contrato_linha.ocl_update (UPDATE)
DROP POLICY IF EXISTS "ocl_update" ON public."orcamento_contrato_linha";
CREATE POLICY "ocl_update" ON public."orcamento_contrato_linha"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((select can_access(auth.uid(), 'orcamento'::text, 'alterar'::app_acao)));

-- orcamento_contrato_linha_audit.ocla_select (SELECT)
DROP POLICY IF EXISTS "ocla_select" ON public."orcamento_contrato_linha_audit";
CREATE POLICY "ocla_select" ON public."orcamento_contrato_linha_audit"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'orcamento'::text, 'visualizar'::app_acao)));

-- perfil_acesso_permissao.pap_write (ALL)
DROP POLICY IF EXISTS "pap_write" ON public."perfil_acesso_permissao";
CREATE POLICY "pap_write" ON public."perfil_acesso_permissao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- screen_permission_user.spu_write (ALL)
DROP POLICY IF EXISTS "spu_write" ON public."screen_permission_user";
CREATE POLICY "spu_write" ON public."screen_permission_user"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)));

-- sst_ca_catalogo.sst_ca_catalogo_select (SELECT)
DROP POLICY IF EXISTS "sst_ca_catalogo_select" ON public."sst_ca_catalogo";
CREATE POLICY "sst_ca_catalogo_select" ON public."sst_ca_catalogo"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sst_ca'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sst_laudo'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao))));

-- stg_colaboradores_base.stg_colaboradores_base_delete (DELETE)
DROP POLICY IF EXISTS "stg_colaboradores_base_delete" ON public."stg_colaboradores_base";
CREATE POLICY "stg_colaboradores_base_delete" ON public."stg_colaboradores_base"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((select can_access(auth.uid(), 'integracao'::text, 'excluir'::app_acao)));

-- stg_colaboradores_base.stg_colaboradores_base_insert (INSERT)
DROP POLICY IF EXISTS "stg_colaboradores_base_insert" ON public."stg_colaboradores_base";
CREATE POLICY "stg_colaboradores_base_insert" ON public."stg_colaboradores_base"
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((select can_access(auth.uid(), 'integracao'::text, 'incluir'::app_acao)));

-- stg_colaboradores_base.stg_colaboradores_base_read (SELECT)
DROP POLICY IF EXISTS "stg_colaboradores_base_read" ON public."stg_colaboradores_base";
CREATE POLICY "stg_colaboradores_base_read" ON public."stg_colaboradores_base"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'integracao'::text, 'visualizar'::app_acao)));

-- stg_colaboradores_base.stg_colaboradores_base_update (UPDATE)
DROP POLICY IF EXISTS "stg_colaboradores_base_update" ON public."stg_colaboradores_base";
CREATE POLICY "stg_colaboradores_base_update" ON public."stg_colaboradores_base"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((select can_access(auth.uid(), 'integracao'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'integracao'::text, 'alterar'::app_acao)));

-- sup_cat_alteracao.sup_cat_alteracao_write (ALL)
DROP POLICY IF EXISTS "sup_cat_alteracao_write" ON public."sup_cat_alteracao";
CREATE POLICY "sup_cat_alteracao_write" ON public."sup_cat_alteracao"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)));

-- sup_cat_alteracao.sup_cat_alteracao_select (SELECT)
DROP POLICY IF EXISTS "sup_cat_alteracao_select" ON public."sup_cat_alteracao";
CREATE POLICY "sup_cat_alteracao_select" ON public."sup_cat_alteracao"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_catalogo_aprovacao'::text, 'visualizar'::app_acao))));

-- sup_estoque_consumo.sup_estoque_consumo_select (SELECT)
DROP POLICY IF EXISTS "sup_estoque_consumo_select" ON public."sup_estoque_consumo";
CREATE POLICY "sup_estoque_consumo_select" ON public."sup_estoque_consumo"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao))));

-- sup_estoque_movimento.sup_estoque_mov_select (SELECT)
DROP POLICY IF EXISTS "sup_estoque_mov_select" ON public."sup_estoque_movimento";
CREATE POLICY "sup_estoque_mov_select" ON public."sup_estoque_movimento"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao)));

-- sup_funcao_item.sup_funcao_item_write (ALL)
DROP POLICY IF EXISTS "sup_funcao_item_write" ON public."sup_funcao_item";
CREATE POLICY "sup_funcao_item_write" ON public."sup_funcao_item"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)));

-- sup_funcao_item.sup_funcao_item_select (SELECT)
DROP POLICY IF EXISTS "sup_funcao_item_select" ON public."sup_funcao_item";
CREATE POLICY "sup_funcao_item_select" ON public."sup_funcao_item"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((select can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao)));

-- sup_item.sup_item_write (ALL)
DROP POLICY IF EXISTS "sup_item_write" ON public."sup_item";
CREATE POLICY "sup_item_write" ON public."sup_item"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao)));

-- sup_item.sup_item_select (SELECT)
DROP POLICY IF EXISTS "sup_item_select" ON public."sup_item";
CREATE POLICY "sup_item_select" ON public."sup_item"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (((select can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao)) OR (select can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao))));

-- sup_pedido.sup_pedido_delete (DELETE)
DROP POLICY IF EXISTS "sup_pedido_delete" ON public."sup_pedido";
CREATE POLICY "sup_pedido_delete" ON public."sup_pedido"
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'excluir'::app_acao)));

-- sup_pedido.sup_pedido_update (UPDATE)
DROP POLICY IF EXISTS "sup_pedido_update" ON public."sup_pedido";
CREATE POLICY "sup_pedido_update" ON public."sup_pedido"
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao)))
  WITH CHECK ((select can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao)));
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (volta cada policy a forma crua original)
-- ============================================================================
-- DROP POLICY IF EXISTS "aud_pc_select_admin_contr_pres" ON public."aud_plano_contas_origem_diagnostico";
-- CREATE POLICY "aud_pc_select_admin_contr_pres" ON public."aud_plano_contas_origem_diagnostico"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public."audit_log_2026_05";
-- CREATE POLICY "audit_admin_ctrl_select" ON public."audit_log_2026_05"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "audit_admin_ctrl_select" ON public."audit_log_default";
-- CREATE POLICY "audit_admin_ctrl_select" ON public."audit_log_default"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "col_write" ON public."colaborador";
-- CREATE POLICY "col_write" ON public."colaborador"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'colaboradores'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'colaboradores'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "col_select" ON public."colaborador";
-- CREATE POLICY "col_select" ON public."colaborador"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'colaboradores'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "ocl_delete" ON public."orcamento_contrato_linha";
-- CREATE POLICY "ocl_delete" ON public."orcamento_contrato_linha"
--   AS PERMISSIVE FOR DELETE TO authenticated
--   USING (can_access(auth.uid(), 'orcamento'::text, 'excluir'::app_acao));
-- DROP POLICY IF EXISTS "ocl_insert" ON public."orcamento_contrato_linha";
-- CREATE POLICY "ocl_insert" ON public."orcamento_contrato_linha"
--   AS PERMISSIVE FOR INSERT TO authenticated
--   WITH CHECK (can_access(auth.uid(), 'orcamento'::text, 'incluir'::app_acao));
-- DROP POLICY IF EXISTS "ocl_select" ON public."orcamento_contrato_linha";
-- CREATE POLICY "ocl_select" ON public."orcamento_contrato_linha"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'orcamento'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "ocl_update" ON public."orcamento_contrato_linha";
-- CREATE POLICY "ocl_update" ON public."orcamento_contrato_linha"
--   AS PERMISSIVE FOR UPDATE TO authenticated
--   USING (can_access(auth.uid(), 'orcamento'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "ocla_select" ON public."orcamento_contrato_linha_audit";
-- CREATE POLICY "ocla_select" ON public."orcamento_contrato_linha_audit"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'orcamento'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "pap_write" ON public."perfil_acesso_permissao";
-- CREATE POLICY "pap_write" ON public."perfil_acesso_permissao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "spu_write" ON public."screen_permission_user";
-- CREATE POLICY "spu_write" ON public."screen_permission_user"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sst_ca_catalogo_select" ON public."sst_ca_catalogo";
-- CREATE POLICY "sst_ca_catalogo_select" ON public."sst_ca_catalogo"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sst_ca'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sst_laudo'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "stg_colaboradores_base_delete" ON public."stg_colaboradores_base";
-- CREATE POLICY "stg_colaboradores_base_delete" ON public."stg_colaboradores_base"
--   AS PERMISSIVE FOR DELETE TO authenticated
--   USING (can_access(auth.uid(), 'integracao'::text, 'excluir'::app_acao));
-- DROP POLICY IF EXISTS "stg_colaboradores_base_insert" ON public."stg_colaboradores_base";
-- CREATE POLICY "stg_colaboradores_base_insert" ON public."stg_colaboradores_base"
--   AS PERMISSIVE FOR INSERT TO authenticated
--   WITH CHECK (can_access(auth.uid(), 'integracao'::text, 'incluir'::app_acao));
-- DROP POLICY IF EXISTS "stg_colaboradores_base_read" ON public."stg_colaboradores_base";
-- CREATE POLICY "stg_colaboradores_base_read" ON public."stg_colaboradores_base"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'integracao'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "stg_colaboradores_base_update" ON public."stg_colaboradores_base";
-- CREATE POLICY "stg_colaboradores_base_update" ON public."stg_colaboradores_base"
--   AS PERMISSIVE FOR UPDATE TO authenticated
--   USING (can_access(auth.uid(), 'integracao'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'integracao'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sup_cat_alteracao_write" ON public."sup_cat_alteracao";
-- CREATE POLICY "sup_cat_alteracao_write" ON public."sup_cat_alteracao"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sup_cat_alteracao_select" ON public."sup_cat_alteracao";
-- CREATE POLICY "sup_cat_alteracao_select" ON public."sup_cat_alteracao"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_catalogo_aprovacao'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_estoque_consumo_select" ON public."sup_estoque_consumo";
-- CREATE POLICY "sup_estoque_consumo_select" ON public."sup_estoque_consumo"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_estoque_mov_select" ON public."sup_estoque_movimento";
-- CREATE POLICY "sup_estoque_mov_select" ON public."sup_estoque_movimento"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "sup_funcao_item_write" ON public."sup_funcao_item";
-- CREATE POLICY "sup_funcao_item_write" ON public."sup_funcao_item"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sup_funcao_item_select" ON public."sup_funcao_item";
-- CREATE POLICY "sup_funcao_item_select" ON public."sup_funcao_item"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING (can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao));
-- DROP POLICY IF EXISTS "sup_item_write" ON public."sup_item";
-- CREATE POLICY "sup_item_write" ON public."sup_item"
--   AS PERMISSIVE FOR ALL TO authenticated
--   USING (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'sup_catalogo'::text, 'alterar'::app_acao));
-- DROP POLICY IF EXISTS "sup_item_select" ON public."sup_item";
-- CREATE POLICY "sup_item_select" ON public."sup_item"
--   AS PERMISSIVE FOR SELECT TO authenticated
--   USING ((can_access(auth.uid(), 'sup_catalogo'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'sup_estoque'::text, 'visualizar'::app_acao)));
-- DROP POLICY IF EXISTS "sup_pedido_delete" ON public."sup_pedido";
-- CREATE POLICY "sup_pedido_delete" ON public."sup_pedido"
--   AS PERMISSIVE FOR DELETE TO authenticated
--   USING (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'excluir'::app_acao));
-- DROP POLICY IF EXISTS "sup_pedido_update" ON public."sup_pedido";
-- CREATE POLICY "sup_pedido_update" ON public."sup_pedido"
--   AS PERMISSIVE FOR UPDATE TO authenticated
--   USING (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao))
--   WITH CHECK (can_access(auth.uid(), 'sup_pedidos_materiais'::text, 'alterar'::app_acao));
-- NOTIFY pgrst, 'reload schema';
