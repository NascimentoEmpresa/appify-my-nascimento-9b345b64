-- SIS-2026-0337 (Iury): "Verificar por que o filtro de empresa ativa esta
-- interferindo na necessidade de justificativa nos itens do malote."
--
-- Causa raiz encontrada: planejamento_orcamentario, malote_despesa e as
-- tabelas filhas (malote_despesa_evento/item/parcela/rateio_linha) tinham
-- RLS usando `empresa_id = get_user_empresa(auth.uid())` — e
-- get_user_empresa() lê profiles.empresa_atual_id, que é exatamente o
-- valor gravado pelo seletor "empresa ativa" da barra superior
-- (EmpresaAtivaContext.setEmpresa).
--
-- O grupo Nascimento tem várias empresas e a maioria dos usuários atende
-- todas — só existe UMA empresa "ativa" por vez no seletor. Resultado: um
-- usuário com a Empresa A selecionada no topo, olhando uma despesa da
-- Empresa B, tinha o RLS de planejamento_orcamentario devolvendo ZERO
-- linhas de orçamento pra Empresa B (mesmo o client pedindo certo via
-- .eq("empresa_id", B) em usePlanejamentosOrcamento) — orçado calculado
-- como 0, e qualquer despesa com valor positivo aparecia como "estourou",
-- disparando justificativa indevida (useOrcadoClassificacao/
-- useOrcadoClassificacaoMultiMes, RateioGrid/RateioParceladoTable). Mesma
-- causa também restringia malote_despesa_select e as 4 tabelas filhas —
-- despesas de outra empresa que não a "ativa" no momento podiam ficar
-- invisíveis pra quem teria direito de vê-las.
--
-- get_user_empresa() já está documentada no README como o padrão de RLS a
-- NÃO seguir (`empresa_id = get_user_empresa(...)`), exatamente por
-- amarrar visibilidade a UMA empresa por vez em vez de a todas que o
-- usuário de fato acessa.
--
-- Fix (escopo desta migration: só as tabelas do Malote/Orçamento que
-- geram o bug relatado — as 12 tabelas restantes que também usam
-- get_user_empresa(), ex. nf_emissao/anexos/postos, ficam pra uma
-- 2ª etapa, fora deste chamado): nova função user_pode_ver_empresa()
-- decide por VÍNCULO (mesma fonte que já popula a lista do seletor em
-- EmpresaAtivaContext — acessa_todas_empresas / user_empresa /
-- profiles.empresa_id como fallback), não pela empresa "ativa" do
-- momento. Trocar ou remover o seletor (SIS-2026-0309, PR separada) nunca
-- mais deveria afetar visibilidade de dado depois disso.

-- ── 1. Função de visibilidade por vínculo (substitui get_user_empresa() ──
-- nestas policies) ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_pode_ver_empresa(_user_id uuid, _empresa_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _empresa_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND acessa_todas_empresas)
    OR EXISTS (SELECT 1 FROM public.user_empresa WHERE user_id = _user_id AND empresa_id = _empresa_id)
    -- fallback: mesmo comportamento do EmpresaAtivaContext quando o
    -- usuário não tem nenhum vínculo em user_empresa ainda cadastrado.
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND empresa_id = _empresa_id)
  );
$$;

-- ── 2. malote_despesa e tabelas filhas ───────────────────────────────────
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa
  FOR SELECT TO authenticated
  USING (
    (created_by = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (public.user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
    OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
    OR (excecao AND status = 'pendente_aprovacao'::text AND malote_gerente_financeiro(auth.uid()))
  );

DROP POLICY IF EXISTS malote_evento_select ON public.malote_despesa_evento;
CREATE POLICY malote_evento_select ON public.malote_despesa_evento
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_evento.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR malote_supervisor_por_cargo(auth.uid())
           OR public.user_pode_ver_empresa(auth.uid(), d.empresa_id)
         )
    )
  );

DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_item.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR malote_supervisor_por_cargo(auth.uid())
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
           OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
         )
    )
  );

DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid()))
    )
  );

DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           has_role(auth.uid(), 'admin'::app_role)
           OR (
             (d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
             AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text]))
           )
         )
    )
  );

-- ── 3. planejamento_orcamentario (Orçamento Administrativo) ─────────────
DROP POLICY IF EXISTS po_orc_select ON public.planejamento_orcamentario;
CREATE POLICY po_orc_select ON public.planejamento_orcamentario
  FOR SELECT TO authenticated
  USING (
    public.user_pode_ver_empresa(auth.uid(), empresa_id)
    OR can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao)
  );

DROP POLICY IF EXISTS po_orc_insert ON public.planejamento_orcamentario;
CREATE POLICY po_orc_insert ON public.planejamento_orcamentario
  FOR INSERT TO authenticated
  WITH CHECK (
    can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
    AND (
      can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao)
      OR public.user_pode_ver_empresa(auth.uid(), empresa_id)
    )
  );

DROP POLICY IF EXISTS po_orc_update ON public.planejamento_orcamentario;
CREATE POLICY po_orc_update ON public.planejamento_orcamentario
  FOR UPDATE TO authenticated
  USING (
    can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
    AND (
      can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao)
      OR public.user_pode_ver_empresa(auth.uid(), empresa_id)
    )
  )
  WITH CHECK (
    can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
    AND (
      can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao)
      OR public.user_pode_ver_empresa(auth.uid(), empresa_id)
    )
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
--   CREATE POLICY malote_despesa_select ON public.malote_despesa
--     FOR SELECT TO authenticated
--     USING (
--       (created_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)
--       OR ((empresa_id = get_user_empresa(auth.uid())) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id))
--       OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
--       OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
--       OR (excecao AND status = 'pendente_aprovacao'::text AND malote_gerente_financeiro(auth.uid()))
--     );
--   DROP POLICY IF EXISTS malote_evento_select ON public.malote_despesa_evento;
--   CREATE POLICY malote_evento_select ON public.malote_despesa_evento
--     FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_evento.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid()) OR d.empresa_id = get_user_empresa(auth.uid()))));
--   DROP POLICY IF EXISTS malote_despesa_item_select ON public.malote_despesa_item;
--   CREATE POLICY malote_despesa_item_select ON public.malote_despesa_item
--     FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_item.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
--       OR (d.empresa_id = get_user_empresa(auth.uid()) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
--       OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao))));
--   DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
--   CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
--     FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--       OR (d.empresa_id = get_user_empresa(auth.uid()) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id)))))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid()))));
--   DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
--   CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
--     FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--       AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--       OR (d.empresa_id = get_user_empresa(auth.uid()) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id)))))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--       AND (has_role(auth.uid(), 'admin'::app_role) OR ((d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
--       AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text,'pronto_para_pagar'::text,'ajuste_pagamento'::text,'despesa_paga'::text]))))));
--   DROP POLICY IF EXISTS po_orc_select ON public.planejamento_orcamentario;
--   CREATE POLICY po_orc_select ON public.planejamento_orcamentario
--     FOR SELECT TO authenticated
--     USING ((empresa_id = get_user_empresa(auth.uid())) OR can_access(auth.uid(), 'administracao'::text, 'visualizar'::app_acao));
--   DROP POLICY IF EXISTS po_orc_insert ON public.planejamento_orcamentario;
--   CREATE POLICY po_orc_insert ON public.planejamento_orcamentario
--     FOR INSERT TO authenticated
--     WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
--       AND (can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao) OR (empresa_id = get_user_empresa(auth.uid()))));
--   DROP POLICY IF EXISTS po_orc_update ON public.planejamento_orcamentario;
--   CREATE POLICY po_orc_update ON public.planejamento_orcamentario
--     FOR UPDATE TO authenticated
--     USING (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
--       AND (can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao) OR (empresa_id = get_user_empresa(auth.uid()))))
--     WITH CHECK (can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
--       AND (can_access(auth.uid(), 'administracao'::text, 'excluir'::app_acao) OR (empresa_id = get_user_empresa(auth.uid()))));
--   DROP FUNCTION IF EXISTS public.user_pode_ver_empresa(uuid, uuid);
-- =====================================================================
