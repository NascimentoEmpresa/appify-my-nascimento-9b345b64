-- ============================================================================
-- Fechamento da Empresa — ajuste do que compõe a coluna Total Desp. Adm (só no Fechamento)
-- ============================================================================
-- Pedido da Controladoria: no detalhamento do Total Desp. Adm, adicionar, alterar ou tirar as classificações e os contratos que compõem a
-- coluna, "só para o Fechamento". A ligação Classificação → Rubrica da Lucratividade (lucratividade_rubrica_classificacao) é GLOBAL: vale
-- para Faturamento, Lucratividade e Fechamento. Aqui nascem duas tabelas só do Fechamento, que se sobrepõem àquela só na despesa administrativa:
--
--   fechamento_adm_classificacao  classificação → rubrica (ou 'nao_custo' = fora do Total Desp. Adm). Sem linha, vale a ligação global.
--   fechamento_adm_contrato       contratos "ADMINISTRATIVO - …" que a Controladoria TIROU da despesa administrativa do Fechamento.
--                                 Sem linha, o contrato conta (como sempre contou).
--
-- Nada muda no Lucro dos Contratos, nos sócios nem nos Tributos, nem nas outras telas.
--
-- Acesso: menu fantasma 'fechamento-empresa-despesa-adm' (ação alterar), consumido por useScreenAccess no modal. Menu sem nenhuma linha de
-- permissão é lido como aberto para todos (ver 20261020000020), então recebem 'alterar' quem hoje já altera as rubricas da Lucratividade
-- ('lucratividade-rubricas'), que é a mesma Controladoria, e os perfis que concedem tudo. Ler vale para quem vê o Fechamento.
--
-- Migration leve (2 tabelas pequenas e 1 menu): pode rodar inteira de uma vez.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.fechamento_adm_contrato;
--   DROP TABLE IF EXISTS public.fechamento_adm_classificacao;
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'fechamento-empresa-despesa-adm';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'fechamento-empresa-despesa-adm';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'fechamento-empresa-despesa-adm';
--   DELETE FROM public.app_menu WHERE codigo = 'fechamento-empresa-despesa-adm';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.fechamento_adm_classificacao (
  classificacao_id uuid PRIMARY KEY REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  rubrica text NOT NULL CHECK (rubrica IN ('salarios', 'ferias', 'rescisoes', 'fgts', 'inss', 'va', 'vt', 'outras', 'nao_custo')),
  updated_by uuid DEFAULT auth.uid(), -- sem FK para auth.users: a FK trava a tabela do Auth ao aplicar com o ERP em uso
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fechamento_adm_contrato (
  contrato_id uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fechamento_adm_classificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamento_adm_contrato ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fechamento_adm_classificacao_select ON public.fechamento_adm_classificacao;
CREATE POLICY fechamento_adm_classificacao_select ON public.fechamento_adm_classificacao
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_classificacao_insert ON public.fechamento_adm_classificacao;
CREATE POLICY fechamento_adm_classificacao_insert ON public.fechamento_adm_classificacao
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_classificacao_update ON public.fechamento_adm_classificacao;
CREATE POLICY fechamento_adm_classificacao_update ON public.fechamento_adm_classificacao
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_classificacao_delete ON public.fechamento_adm_classificacao;
CREATE POLICY fechamento_adm_classificacao_delete ON public.fechamento_adm_classificacao
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_contrato_select ON public.fechamento_adm_contrato;
CREATE POLICY fechamento_adm_contrato_select ON public.fechamento_adm_contrato
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_contrato_insert ON public.fechamento_adm_contrato;
CREATE POLICY fechamento_adm_contrato_insert ON public.fechamento_adm_contrato
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS fechamento_adm_contrato_delete ON public.fechamento_adm_contrato;
CREATE POLICY fechamento_adm_contrato_delete ON public.fechamento_adm_contrato
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamento_adm_classificacao TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.fechamento_adm_contrato TO authenticated;

-- Menu fantasma + semente de quem pode alterar.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'fechamento-empresa-despesa-adm', 'Controladoria — Fechamento: ajustar o Total Desp. Adm', NULL, 54, true
  FROM public.app_modulo m WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('fechamento-empresa-despesa-adm', 'alterar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'lucratividade-rubricas' AND p.acao = 'alterar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'fechamento-empresa-despesa-adm', 'alterar'::public.app_acao, true, s.empresa_id,
       'Fechamento: quem altera as rubricas da Lucratividade ajusta o Total Desp. Adm'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'lucratividade-rubricas' AND s.acao = 'alterar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'fechamento-empresa-despesa-adm' AND x.acao = 'alterar'
                      AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

NOTIFY pgrst, 'reload schema';
