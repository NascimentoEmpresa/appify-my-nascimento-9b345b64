-- =====================================================================
-- [SEM-CHAMADO] — Resumo dos Contratos: cada painel com acesso próprio
--
-- PEDIDO (Pablo, 13/11/2026): "Aqui cada um tem que ter o gerenciamento de
-- acesso também, lá em licitação, tenho que conseguir gerenciar por completo
-- quem acessa esses sistemas aqui."
--
-- ANTES
--   As 9 telas do submódulo "Resumo dos Contratos"
--   (/app/licitacoes/implantacao/painel e /painel/<setor>) não tinham linha
--   em app_menu: herdavam o acesso da Implantação pelo prefixo da rota.
--   Quem via a Implantação via todos os painéis, e não havia como separar.
--
-- AGORA
--   1) 9 menus no módulo Licitação, um por tela, com rota própria. O
--      casamento de rota é pelo prefixo MAIS LONGO (matchMenuCode), então
--      /painel/compras cai em 'licitacoes-implantacao-painel-compras' e não
--      mais na Implantação; um setor fora da lista cai no Resumo geral.
--      Todos aparecem em Administração › Acesso por Usuário › Licitação.
--   2) Leitura dos dados do painel (implantacao_contrato, checklist_respostas
--      e "IMPLANTACAO_SETOR_CONFIRMACAO"): continua valendo quem vê a
--      Implantação, e passa a valer também quem tem qualquer um dos 9
--      painéis — senão liberar só "Compras" abriria uma tela vazia.
--      A conta mora numa função só (implantacao_pode_ler) para não repetir
--      a lista em três policies.
--   3) Gravar não muda: checklist exige 'alterar' na Implantação
--      (20261115000300) e confirmar recebimento exige
--      'licitacoes-implantacao-confirmar-setor' (20261113220000).
--
-- SEMENTE — menu sem nenhuma linha de permissão fica FORA do controle do
-- RouteGuard (list_configured_menu_codes), ou seja, aberto. E hoje quem vê
-- a Implantação vê os painéis. Por isso cada painel nasce com quem já tem
-- 'visualizar' na Implantação (perfil ou pessoa, nos dois códigos) e os
-- perfis concede_tudo. Daí em diante o Pablo tira/dá por pessoa.
--
-- Leve (9 menus + 1 função + 3 policies). Idempotente. ROLLBACK no fim.
-- =====================================================================
SET lock_timeout = '5s';

-- 1) Menus -----------------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem, true
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('licitacoes-implantacao-painel',              'Resumo Geral dos Contratos', '/app/licitacoes/implantacao/painel',              40),
    ('licitacoes-implantacao-painel-compras',      'Resumo dos Contratos - Compras',      '/app/licitacoes/implantacao/painel/compras',      41),
    ('licitacoes-implantacao-painel-financeiro',   'Resumo dos Contratos - Financeiro',   '/app/licitacoes/implantacao/painel/financeiro',   42),
    ('licitacoes-implantacao-painel-licitacao',    'Resumo dos Contratos - Licitação',    '/app/licitacoes/implantacao/painel/licitacao',    43),
    ('licitacoes-implantacao-painel-operacional',  'Resumo dos Contratos - Operacional',  '/app/licitacoes/implantacao/painel/operacional',  44),
    ('licitacoes-implantacao-painel-recrutamento', 'Resumo dos Contratos - Recrutamento', '/app/licitacoes/implantacao/painel/recrutamento', 45),
    ('licitacoes-implantacao-painel-rh',           'Resumo dos Contratos - RH',           '/app/licitacoes/implantacao/painel/rh',           46),
    ('licitacoes-implantacao-painel-sst',          'Resumo dos Contratos - SST',          '/app/licitacoes/implantacao/painel/sst',          47),
    ('licitacoes-implantacao-painel-treinamentos', 'Resumo dos Contratos - Treinamentos', '/app/licitacoes/implantacao/painel/treinamentos', 48)
  ) AS v(codigo, nome, rota, ordem)
 WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT c, 'visualizar'
  FROM unnest(ARRAY[
    'licitacoes-implantacao-painel',
    'licitacoes-implantacao-painel-compras',
    'licitacoes-implantacao-painel-financeiro',
    'licitacoes-implantacao-painel-licitacao',
    'licitacoes-implantacao-painel-operacional',
    'licitacoes-implantacao-painel-recrutamento',
    'licitacoes-implantacao-painel-rh',
    'licitacoes-implantacao-painel-sst',
    'licitacoes-implantacao-painel-treinamentos'
  ]) AS c
ON CONFLICT DO NOTHING;

-- 2) Semente ------------------------------------------------------------------
-- Os 9 menus acabados de criar (o prefixo só casa com eles).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, pn.codigo, 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa CROSS JOIN (SELECT DISTINCT codigo FROM public.app_menu WHERE codigo LIKE 'licitacoes-implantacao-painel%') pn
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT p.perfil_id, pn.codigo, 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
  CROSS JOIN (SELECT DISTINCT codigo FROM public.app_menu WHERE codigo LIKE 'licitacoes-implantacao-painel%') pn
 WHERE p.menu_codigo IN ('licitacoes.implantacao', 'implantacao')
   AND p.acao = 'visualizar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT DISTINCT s.user_id, pn.codigo, 'visualizar'::public.app_acao, true, s.empresa_id,
       'Resumo dos Contratos: quem via a Implantação continua vendo o painel (acesso separado em 15/11/2026)'
  FROM public.screen_permission_user s
  CROSS JOIN (SELECT DISTINCT codigo FROM public.app_menu WHERE codigo LIKE 'licitacoes-implantacao-painel%') pn
 WHERE s.menu_codigo IN ('licitacoes.implantacao', 'implantacao')
   AND s.acao = 'visualizar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = pn.codigo
                      AND x.acao = 'visualizar' AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

-- 3) Quem lê os dados da Implantação ---------------------------------------------
CREATE OR REPLACE FUNCTION public.implantacao_pode_ler(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public.can_access(_user, 'licitacoes.implantacao', 'visualizar'::app_acao)
      OR public.can_access(_user, 'implantacao', 'visualizar'::app_acao)
      OR EXISTS (
        SELECT 1
          FROM unnest(ARRAY[
            'licitacoes-implantacao-painel',
            'licitacoes-implantacao-painel-compras',
            'licitacoes-implantacao-painel-financeiro',
            'licitacoes-implantacao-painel-licitacao',
            'licitacoes-implantacao-painel-operacional',
            'licitacoes-implantacao-painel-recrutamento',
            'licitacoes-implantacao-painel-rh',
            'licitacoes-implantacao-painel-sst',
            'licitacoes-implantacao-painel-treinamentos'
          ]) AS c
         WHERE public.can_access(_user, c, 'visualizar'::app_acao)
      );
$$;

REVOKE ALL ON FUNCTION public.implantacao_pode_ler(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.implantacao_pode_ler(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.implantacao_pode_ler(uuid) TO authenticated;

DROP POLICY IF EXISTS implantacao_select ON public.implantacao_contrato;
CREATE POLICY implantacao_select ON public.implantacao_contrato FOR SELECT TO authenticated
  USING ((SELECT public.implantacao_pode_ler(auth.uid())));

DROP POLICY IF EXISTS checklist_respostas_select ON public.checklist_respostas;
CREATE POLICY checklist_respostas_select ON public.checklist_respostas FOR SELECT TO authenticated
  USING ((SELECT public.implantacao_pode_ler(auth.uid())));

DROP POLICY IF EXISTS implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
CREATE POLICY implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO" FOR SELECT TO authenticated
  USING ((SELECT public.implantacao_pode_ler(auth.uid())));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--
-- DROP POLICY IF EXISTS implantacao_select ON public.implantacao_contrato;
-- CREATE POLICY implantacao_select ON public.implantacao_contrato FOR SELECT TO authenticated
--   USING (
--     public.can_access(auth.uid(), 'licitacoes.implantacao', 'visualizar'::app_acao)
--     OR public.can_access(auth.uid(), 'implantacao', 'visualizar'::app_acao)
--   );
-- DROP POLICY IF EXISTS checklist_respostas_select ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_select ON public.checklist_respostas FOR SELECT TO authenticated
--   USING ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)
--   ));
-- DROP POLICY IF EXISTS implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO";
-- CREATE POLICY implantacao_setor_confirmacao_select ON public."IMPLANTACAO_SETOR_CONFIRMACAO" FOR SELECT TO authenticated
--   USING ((
--     SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'visualizar'::app_acao)
--         OR public.can_access(auth.uid(), 'implantacao'::text, 'visualizar'::app_acao)
--   ));
-- DROP FUNCTION IF EXISTS public.implantacao_pode_ler(uuid);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo LIKE 'licitacoes-implantacao-painel%';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo LIKE 'licitacoes-implantacao-painel%';
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo LIKE 'licitacoes-implantacao-painel%';
-- DELETE FROM public.app_menu                WHERE codigo      LIKE 'licitacoes-implantacao-painel%';
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
