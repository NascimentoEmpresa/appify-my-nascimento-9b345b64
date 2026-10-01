-- [SEM-CHAMADO] (achado real, Anne — erro "new row violates row-level
-- security policy for table nf_emissao" ao tentar incluir/editar uma nota).
--
-- CAUSA: toda a RLS de nf_emissao (e tabelas satélites: item/anexo/
-- historico/modelo/modelo_item + bucket de storage), definida em
-- 20260809000010_lote8f_nf_emissao_conta_garantida.sql, ainda compara
-- `empresa_id = get_user_empresa(auth.uid())` diretamente — o padrão que o
-- README já marca como NÃO FAZER. Esse padrão foi varrido do resto do
-- sistema em 20260902000001_empresa_nao_filtra_alavanca_funcoes.sql
-- (decisão de 13/08, Eduardo: "a empresa em que o usuário está logado é
-- informação VISUAL, não pode decidir o que alguém vê ou faz — quem governa
-- é o Acesso por Usuário"), reescrevendo o CORPO de duas funções-alavanca
-- (`user_pode_atuar_empresa`/`user_can_see_empresa`, hoje sempre `true` pra
-- autenticado) — mas só resolveu as 42 policies que JÁ chamavam essas
-- funções. nf_emissao nunca passou por ali porque inlina `get_user_empresa`
-- direto, então ficou de fora da varredura.
--
-- CASO REAL: Anne (ANALISTA DE CONTRATO) tem `acessa_todas_empresas = true`
-- e tinha recebido ontem (30/09) incluir/alterar via exceção individual
-- (screen_permission_user) — mas NÃO 'excluir' (correto: 'excluir' aqui é
-- Nível D, "mexer em NF concluída/cancelada", e deve continuar só-admin,
-- ver trigger nf_emissao_guard_enviada, intocado por esta migration). Como
-- a policy de INSERT exige `can_access('alterar') AND (can_access('excluir')
-- OR empresa_id = get_user_empresa(...))`, e a nota que ela cria não é
-- necessariamente da MESMA empresa hoje selecionada no seletor do topo
-- (`empresa_atual_id`), o segundo AND falhava mesmo com 'alterar' concedido
-- — exatamente a classe de bug que a varredura de 02/09 existe pra evitar,
-- só que fora do alcance dela.
--
-- FIX: troca toda comparação `X = get_user_empresa(auth.uid())` (e a
-- correspondente via storage_path_empresa) pelas duas funções-alavanca já
-- usadas no resto do sistema — mesmo ponto único de reversão, sem inventar
-- padrão novo. Resultado prático: can_access(...) passa a ser o único gate
-- real (a flag 'excluir' continua distinguindo "Nível D", só deixa de
-- também significar "cross-empresa"); ninguém perde acesso que já tinha
-- dentro da própria empresa, e quem tinha 'alterar'/'incluir'/'aprovar' mas
-- não 'excluir' deixa de ficar bloqueado numa nota de outra empresa.

-- ── nf_emissao (Nível A: alterar) ──────────────────────────────────────
DROP POLICY IF EXISTS "nfe_select" ON public.nf_emissao;
CREATE POLICY "nfe_select" ON public.nf_emissao FOR SELECT TO authenticated
  USING (public.user_can_see_empresa(empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'));

DROP POLICY IF EXISTS "nfe_insert" ON public.nf_emissao;
CREATE POLICY "nfe_insert" ON public.nf_emissao FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "nfe_update" ON public.nf_emissao;
CREATE POLICY "nfe_update" ON public.nf_emissao FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "nfe_delete" ON public.nf_emissao;
CREATE POLICY "nfe_delete" ON public.nf_emissao FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'alterar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

-- ── nf_emissao_item (Nível A: alterar) ─────────────────────────────────
DROP POLICY IF EXISTS "nfei_select" ON public.nf_emissao_item;
CREATE POLICY "nfei_select" ON public.nf_emissao_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (public.user_can_see_empresa(n.empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfei_write" ON public.nf_emissao_item;
CREATE POLICY "nfei_write" ON public.nf_emissao_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), n.empresa_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), n.empresa_id))
  ));

-- ── nf_emissao_anexo (Nível A: alterar) ────────────────────────────────
DROP POLICY IF EXISTS "nfea_select" ON public.nf_emissao_anexo;
CREATE POLICY "nfea_select" ON public.nf_emissao_anexo FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (public.user_can_see_empresa(n.empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfea_write" ON public.nf_emissao_anexo;
CREATE POLICY "nfea_write" ON public.nf_emissao_anexo FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), n.empresa_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'alterar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), n.empresa_id))
  ));

-- ── nf_emissao_historico ────────────────────────────────────────────────
DROP POLICY IF EXISTS "nf_emissao_historico_select" ON public.nf_emissao_historico;
CREATE POLICY "nf_emissao_historico_select" ON public.nf_emissao_historico FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (public.user_can_see_empresa(n.empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nf_emissao_historico_insert" ON public.nf_emissao_historico;
CREATE POLICY "nf_emissao_historico_insert" ON public.nf_emissao_historico FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (public.user_pode_atuar_empresa(auth.uid(), n.empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

-- ── nf_emissao_modelo / nf_emissao_modelo_item (Nível B: aprovar) ──────
DROP POLICY IF EXISTS "nfem_select" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_select" ON public.nf_emissao_modelo FOR SELECT TO authenticated
  USING (public.user_can_see_empresa(empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'));

DROP POLICY IF EXISTS "nfem_insert" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_insert" ON public.nf_emissao_modelo FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "nfem_update" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_update" ON public.nf_emissao_modelo FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  )
  WITH CHECK (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "nfem_delete" ON public.nf_emissao_modelo;
CREATE POLICY "nfem_delete" ON public.nf_emissao_modelo FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
    AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), empresa_id))
  );

DROP POLICY IF EXISTS "nfemi_select" ON public.nf_emissao_modelo_item;
CREATE POLICY "nfemi_select" ON public.nf_emissao_modelo_item FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND (public.user_can_see_empresa(m.empresa_id) OR public.can_access(auth.uid(), 'nf-emissao', 'visualizar'))
  ));

DROP POLICY IF EXISTS "nfemi_write" ON public.nf_emissao_modelo_item;
CREATE POLICY "nfemi_write" ON public.nf_emissao_modelo_item FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), m.empresa_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao_modelo m WHERE m.id = nf_emissao_modelo_id
      AND public.can_access(auth.uid(), 'nf-emissao', 'aprovar')
      AND (public.can_access(auth.uid(), 'nf-emissao', 'excluir') OR public.user_pode_atuar_empresa(auth.uid(), m.empresa_id))
  ));

-- ── storage.objects (bucket nf-emissao) ────────────────────────────────
DROP POLICY IF EXISTS "nf_emissao_storage_select" ON storage.objects;
CREATE POLICY "nf_emissao_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'visualizar') OR public.user_can_see_empresa(storage_path_empresa(name))));

DROP POLICY IF EXISTS "nf_emissao_storage_insert" ON storage.objects;
CREATE POLICY "nf_emissao_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'visualizar') OR public.user_pode_atuar_empresa(auth.uid(), storage_path_empresa(name))));

DROP POLICY IF EXISTS "nf_emissao_storage_delete" ON storage.objects;
CREATE POLICY "nf_emissao_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nf-emissao' AND (public.can_access(auth.uid(), 'nf-emissao', 'alterar') OR public.user_pode_atuar_empresa(auth.uid(), storage_path_empresa(name))));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: recriar as policies acima com `empresa_id = get_user_empresa(auth.uid())`
-- no lugar de cada chamada a user_can_see_empresa/user_pode_atuar_empresa
-- (texto exato em 20260809000010_lote8f_nf_emissao_conta_garantida.sql).
-- =====================================================================
