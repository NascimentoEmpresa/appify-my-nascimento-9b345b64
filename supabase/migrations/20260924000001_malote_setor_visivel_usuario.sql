-- SIS-2026-0216 (Iury): hoje qualquer pessoa da mesma empresa vê todas as
-- despesas em Aprovações do Malote (RLS `empresa_id = get_user_empresa`) —
-- não dá pra restringir quem vê o quê por setor, e tem setor com mais de
-- uma pessoa lançando/aprovando. Modelo opt-in: sem nenhuma linha nesta
-- tabela pra um usuário, ele continua vendo tudo da empresa (comportamento
-- atual, zero regressão); com linha(s), passa a ver só despesas cujo
-- Setor Responsável (na Classificação Malote) esteja na lista dele — além
-- do que ele mesmo criou, que nunca deixa de aparecer.
--
-- Isso só afeta QUEM VÊ a despesa (visualizar/listar). Quem pode agir
-- (aprovar/reprovar/pagar) continua 100% baseado no aprovador1/2/3_user_id
-- já configurado na Classificação — nada muda nessa parte.
CREATE TABLE public.malote_setor_visivel_usuario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  setor       text NOT NULL,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, setor)
);
CREATE INDEX idx_malote_setor_visivel_user ON public.malote_setor_visivel_usuario(user_id);

ALTER TABLE public.malote_setor_visivel_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_setor_visivel_select ON public.malote_setor_visivel_usuario
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR malote_supervisor_por_cargo(auth.uid())
    OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
  );

-- Mesmo gate que já protege a tela inteira de Gerenciamento de Acesso
-- (podeGerenciar em ModulosMenusTab.tsx = can("alterar", undefined,
-- "administracao") no client).
CREATE POLICY malote_setor_visivel_write ON public.malote_setor_visivel_usuario
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR malote_supervisor_por_cargo(auth.uid())
    OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR malote_supervisor_por_cargo(auth.uid())
    OR can_access(auth.uid(), 'administracao'::text, 'alterar'::app_acao)
  );

-- Esta pessoa tem recorte de setor configurado? (opt-in)
CREATE OR REPLACE FUNCTION public.malote_tem_recorte_setor(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_setor_visivel_usuario WHERE user_id = _user_id
  );
$$;

-- A despesa (via classificação) é visível para _user_id considerando o
-- recorte por setor? Sem recorte = sempre true (comportamento atual,
-- "empresa inteira"). Com recorte = só se o setor_responsavel da
-- classificação da despesa estiver na lista da pessoa. classificacao_id
-- NULL (ex.: rascunho antes de classificar) nunca casa — despesa sem
-- setor definido não pode vazar pra quem só tem acesso a setores
-- específicos (quem tem recorte só vê essas se for dono).
CREATE OR REPLACE FUNCTION public.malote_despesa_visivel_por_setor(_user_id uuid, _classificacao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.malote_tem_recorte_setor(_user_id) THEN true
    ELSE EXISTS (
      SELECT 1
        FROM public.planejamento_orcamentario_classificacao c
        JOIN public.malote_setor_visivel_usuario s
          ON upper(btrim(s.setor)) = upper(btrim(c.setor_responsavel))
       WHERE c.id = _classificacao_id
         AND s.user_id = _user_id
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.malote_tem_recorte_setor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.malote_despesa_visivel_por_setor(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.malote_tem_recorte_setor(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.malote_despesa_visivel_por_setor(uuid, uuid) TO authenticated;

-- Troca só a cláusula empresa_id = get_user_empresa(...) — todas as outras
-- cláusulas ficam idênticas (dono, admin, supervisor por cargo, cotações,
-- pagamento).
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR malote_supervisor_por_cargo(auth.uid())
    OR (
      empresa_id = get_user_empresa(auth.uid())
      AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id)
    )
    OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
    OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
  );

DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (d.empresa_id = get_user_empresa(auth.uid()) AND public.malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY malote_despesa_select ON public.malote_despesa;
--   CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
--     USING (
--       created_by = auth.uid()
--       OR has_role(auth.uid(), 'admin'::app_role)
--       OR malote_supervisor_por_cargo(auth.uid())
--       OR (empresa_id = get_user_empresa(auth.uid()))
--       OR can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao)
--       OR can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao)
--     );
--   (idem malote_rateio_linha_all/malote_parcela_all, devolvendo a cláusula
--   d.empresa_id = get_user_empresa(auth.uid()) sem o AND extra)
--   DROP FUNCTION IF EXISTS public.malote_despesa_visivel_por_setor(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.malote_tem_recorte_setor(uuid);
--   DROP TABLE IF EXISTS public.malote_setor_visivel_usuario;
