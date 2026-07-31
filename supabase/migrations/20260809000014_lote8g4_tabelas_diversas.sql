-- Lote 8g, bloco 4: tabelas diversas sem tela dedicada (a maioria zero
-- consumidor em src/) — consolidado no menu 'administracao', conforme
-- decidido: 'alterar' cobre qualquer combinação de cargo (admin sozinho, ou
-- admin+controladoria+diretor_adm, etc — todas viram a mesma bandeira);
-- 'visualizar' cobre os casos só-leitura; 'excluir' é reservado
-- especificamente para "admin de verdade ignora o escopo de empresa" nos
-- poucos casos em que isso existia (mesma convenção usada em nf-emissao no
-- Lote 8f) — preserva essa fronteira de tenant, que não é cargo.
-- Checks de dono (self/criado_por/enviado_por) e de empresa
-- (get_user_empresa/user_pode_atuar_empresa/foldername) ficam intocados.
--
-- ROLLBACK: recriar cada policy com has_role() nas combinações originais
-- (arquivos citados em cada bloco de comentário abaixo).

-- anexos (20260429183011)
DROP POLICY IF EXISTS anex_select ON public.anexos;
CREATE POLICY anex_select ON public.anexos FOR SELECT TO authenticated
  USING (empresa_id = public.get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS anex_insert ON public.anexos;
CREATE POLICY anex_insert ON public.anexos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = public.get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS anex_update ON public.anexos;
CREATE POLICY anex_update ON public.anexos FOR UPDATE TO authenticated
  USING (empresa_id = public.get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS anex_delete ON public.anexos;
CREATE POLICY anex_delete ON public.anexos FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar') OR (empresa_id = public.get_user_empresa(auth.uid()) AND enviado_por = auth.uid()));

-- storage.objects, bucket anexos (mesmo arquivo)
DROP POLICY IF EXISTS anexos_select ON storage.objects;
CREATE POLICY anexos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'anexos' AND (public.can_access(auth.uid(), 'administracao', 'visualizar') OR public.storage_path_empresa(name) = public.get_user_empresa(auth.uid())));
DROP POLICY IF EXISTS anexos_insert ON storage.objects;
CREATE POLICY anexos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'anexos' AND (public.can_access(auth.uid(), 'administracao', 'alterar') OR public.storage_path_empresa(name) = public.get_user_empresa(auth.uid())));
DROP POLICY IF EXISTS anexos_update ON storage.objects;
CREATE POLICY anexos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'anexos' AND (public.can_access(auth.uid(), 'administracao', 'alterar') OR public.storage_path_empresa(name) = public.get_user_empresa(auth.uid())));
DROP POLICY IF EXISTS anexos_delete ON storage.objects;
CREATE POLICY anexos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'anexos' AND (public.can_access(auth.uid(), 'administracao', 'alterar') OR public.storage_path_empresa(name) = public.get_user_empresa(auth.uid())));

-- ia_provedores / ia_feedback / ia_triagens (20260429183011 + 20260527182227)
DROP POLICY IF EXISTS iap_admin_all ON public.ia_provedores;
CREATE POLICY iap_admin_all ON public.ia_provedores FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS iap_select_admin ON public.ia_provedores;
CREATE POLICY iap_select_admin ON public.ia_provedores FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS iaf_select ON public.ia_feedback;
CREATE POLICY iaf_select ON public.ia_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar') OR EXISTS (SELECT 1 FROM public.ia_triagens t WHERE t.id = triagem_id AND t.empresa_id = public.get_user_empresa(auth.uid())));
DROP POLICY IF EXISTS iaf_delete ON public.ia_feedback;
CREATE POLICY iaf_delete ON public.ia_feedback FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS iat_select ON public.ia_triagens;
CREATE POLICY iat_select ON public.ia_triagens FOR SELECT TO authenticated
  USING (empresa_id = public.get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS iat_insert ON public.ia_triagens;
CREATE POLICY iat_insert ON public.ia_triagens FOR INSERT TO authenticated
  WITH CHECK (empresa_id = public.get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS iat_update ON public.ia_triagens;
CREATE POLICY iat_update ON public.ia_triagens FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar') OR (empresa_id = public.get_user_empresa(auth.uid()) AND solicitado_por = auth.uid()));

-- estoque_movimento / estoque_saldo (trava de integridade, mantida — só troca o mecanismo)
DROP POLICY IF EXISTS mov_admin_modify ON public.estoque_movimento;
CREATE POLICY mov_admin_modify ON public.estoque_movimento FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS saldo_admin_write ON public.estoque_saldo;
CREATE POLICY saldo_admin_write ON public.estoque_saldo FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- planejamento_orcamentario / _classificacao (20260715000004/5)
DROP POLICY IF EXISTS "po_orc_select" ON public.planejamento_orcamentario;
CREATE POLICY "po_orc_select" ON public.planejamento_orcamentario FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "po_orc_insert" ON public.planejamento_orcamentario;
CREATE POLICY "po_orc_insert" ON public.planejamento_orcamentario FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar') AND (public.can_access(auth.uid(), 'administracao', 'excluir') OR empresa_id = get_user_empresa(auth.uid())));
DROP POLICY IF EXISTS "po_orc_update" ON public.planejamento_orcamentario;
CREATE POLICY "po_orc_update" ON public.planejamento_orcamentario FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar') AND (public.can_access(auth.uid(), 'administracao', 'excluir') OR empresa_id = get_user_empresa(auth.uid())))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar') AND (public.can_access(auth.uid(), 'administracao', 'excluir') OR empresa_id = get_user_empresa(auth.uid())));

DROP POLICY IF EXISTS "poc_insert" ON public.planejamento_orcamentario_classificacao;
CREATE POLICY "poc_insert" ON public.planejamento_orcamentario_classificacao FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS "poc_update" ON public.planejamento_orcamentario_classificacao;
CREATE POLICY "poc_update" ON public.planejamento_orcamentario_classificacao FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- plano_acao (só a policy de delete direto na tabela — 20260508160553)
DROP POLICY IF EXISTS pa_delete ON public.plano_acao;
CREATE POLICY pa_delete ON public.plano_acao FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'));

-- plano_acao_comentario (20260602231345)
DROP POLICY IF EXISTS pac_update ON public.plano_acao_comentario;
CREATE POLICY pac_update ON public.plano_acao_comentario FOR UPDATE TO authenticated
  USING (criado_por = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK ((criado_por = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar')) AND public.plano_acao_visible_by_user(auth.uid(), plano_acao_id) AND EXISTS (SELECT 1 FROM public.plano_acao p WHERE p.id = plano_acao_id AND p.empresa_id = empresa_id));
DROP POLICY IF EXISTS pac_delete ON public.plano_acao_comentario;
CREATE POLICY pac_delete ON public.plano_acao_comentario FOR DELETE TO authenticated
  USING ((criado_por = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar')) AND public.plano_acao_visible_by_user(auth.uid(), plano_acao_id));

-- user_empresa (20260519190953)
DROP POLICY IF EXISTS "user_empresa_select_self_or_admin" ON public.user_empresa;
CREATE POLICY "user_empresa_select_self_or_admin" ON public.user_empresa FOR SELECT
  USING (auth.uid() = user_id OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "user_empresa_admin_all" ON public.user_empresa;
CREATE POLICY "user_empresa_admin_all" ON public.user_empresa FOR ALL
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- RECRUTAMENTO_EPIS: NÃO existe em produção (mesma situação de
-- contrato_dados_fiscais no Lote 8f) — nada a migrar.

-- cfop (20260430021948)
DROP POLICY IF EXISTS "cfop_manage_admin" ON cfop;
CREATE POLICY "cfop_manage_admin" ON cfop FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- plano_contas_master (20260429191233)
DROP POLICY IF EXISTS pcm_admin_ins ON public.plano_contas_master;
CREATE POLICY pcm_admin_ins ON public.plano_contas_master FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS pcm_admin_upd ON public.plano_contas_master;
CREATE POLICY pcm_admin_upd ON public.plano_contas_master FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS pcm_admin_del ON public.plano_contas_master;
CREATE POLICY pcm_admin_del ON public.plano_contas_master FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'));

-- storage.objects, bucket fcr-uploads (20260518040008 + 20260518080555)
DROP POLICY IF EXISTS "fcr_uploads_select_global" ON storage.objects;
CREATE POLICY "fcr_uploads_select_global" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fcr-uploads' AND public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS "fcr_uploads_select_empresa" ON storage.objects;
CREATE POLICY "fcr_uploads_select_empresa" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'fcr-uploads'
    AND (storage.foldername(name))[1] <> 'consolidado'
    AND (storage.foldername(name))[1] = public.get_user_empresa(auth.uid())::text
    AND public.can_access(auth.uid(), 'administracao', 'visualizar')
  );
DROP POLICY IF EXISTS fcr_uploads_insert ON storage.objects;
CREATE POLICY fcr_uploads_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fcr-uploads' AND public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS fcr_uploads_update ON storage.objects;
CREATE POLICY fcr_uploads_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'fcr-uploads' AND public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS fcr_uploads_delete ON storage.objects;
CREATE POLICY fcr_uploads_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fcr-uploads' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

-- centros_custo_empresa_log (20260520161217)
DROP POLICY IF EXISTS "Admins veem log de troca de empresa do CC" ON public.centros_custo_empresa_log;
CREATE POLICY "Admins veem log de troca de empresa do CC" ON public.centros_custo_empresa_log FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "Admins inserem log de troca de empresa do CC" ON public.centros_custo_empresa_log;
CREATE POLICY "Admins inserem log de troca de empresa do CC" ON public.centros_custo_empresa_log FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- notificacoes (20260429224756 + 20260529153842) — usado pelo sino no Topbar
DROP POLICY IF EXISTS "ver minhas notificacoes" ON public.notificacoes;
CREATE POLICY "ver minhas notificacoes" ON public.notificacoes FOR SELECT
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "criar notificacoes admin" ON public.notificacoes;
CREATE POLICY "criar notificacoes admin" ON public.notificacoes FOR INSERT
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar') OR user_id = auth.uid());
DROP POLICY IF EXISTS "marcar minhas notificacoes" ON public.notificacoes;
CREATE POLICY "marcar minhas notificacoes" ON public.notificacoes FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK ((user_id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));

-- sessoes_ativas (20260429224756 + 20260529153607) — usado no widget do Topbar
DROP POLICY IF EXISTS "ver minhas sessoes" ON public.sessoes_ativas;
CREATE POLICY "ver minhas sessoes" ON public.sessoes_ativas FOR SELECT
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "atualizar minhas sessoes" ON public.sessoes_ativas;
CREATE POLICY "atualizar minhas sessoes" ON public.sessoes_ativas FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK ((user_id = auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'alterar'));

-- permissoes_especiais (20260520163846) — usado por SaudeAlcadasPanel.tsx (Lote 8b)
DROP POLICY IF EXISTS "admins ver permissoes especiais" ON public.permissoes_especiais;
CREATE POLICY "admins ver permissoes especiais" ON public.permissoes_especiais FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS "admins gerenciar permissoes especiais" ON public.permissoes_especiais;
CREATE POLICY "admins gerenciar permissoes especiais" ON public.permissoes_especiais FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar')) WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- access_audit_log (20260519192945) — usado por RouteGuard.tsx
DROP POLICY IF EXISTS aal_self_select ON public.access_audit_log;
CREATE POLICY aal_self_select ON public.access_audit_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'visualizar'));

-- storage.objects, bucket avatars (20260513195255)
DROP POLICY IF EXISTS "Admins manage any avatar" ON storage.objects;
CREATE POLICY "Admins manage any avatar" ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (bucket_id = 'avatars' AND public.can_access(auth.uid(), 'administracao', 'alterar'));

-- plano_contas_solicitacao (20260429222206) — usado por PlanoContas.tsx
DROP POLICY IF EXISTS pcs_select ON public.plano_contas_solicitacao;
CREATE POLICY pcs_select ON public.plano_contas_solicitacao FOR SELECT TO authenticated
  USING (empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'visualizar'));
DROP POLICY IF EXISTS pcs_insert ON public.plano_contas_solicitacao;
CREATE POLICY pcs_insert ON public.plano_contas_solicitacao FOR INSERT TO authenticated
  WITH CHECK (solicitado_por = auth.uid() AND (empresa_id = get_user_empresa(auth.uid()) OR public.can_access(auth.uid(), 'administracao', 'excluir')) AND status = 'pendente');
DROP POLICY IF EXISTS pcs_update_approver ON public.plano_contas_solicitacao;
CREATE POLICY pcs_update_approver ON public.plano_contas_solicitacao FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar') AND (public.can_access(auth.uid(), 'administracao', 'excluir') OR empresa_id = get_user_empresa(auth.uid())))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));
DROP POLICY IF EXISTS pcs_delete ON public.plano_contas_solicitacao;
CREATE POLICY pcs_delete ON public.plano_contas_solicitacao FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'excluir'));

NOTIFY pgrst, 'reload schema';
