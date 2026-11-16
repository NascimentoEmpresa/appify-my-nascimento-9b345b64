-- SIS-2026-0872 — Fechamento dos Sócios: ações DENTRO do menu, sócios já vinculados e só o percentual editável
-- ============================================================================
-- Complementa 20261114220000. Três ajustes pedidos depois de testar a tela:
--   1) As ações saem dos menus fantasma ("... — sócios e percentuais (ação)", "... — fechar competência (ação)", que apareciam soltos em Administração >
--      Módulos) e passam a ser ações do PRÓPRIO menu fechamento-socios, como nos demais módulos:
--        alterar = "Sócios e percentuais" (mexer no percentual padrão e no de um mês);
--        aprovar = "Fechar competência"   (fechar/reabrir o mês e registrar o complemento pago).
--      app_menu_acao é o catálogo da tela de acesso (os switches). O toggle da tela NÃO concede essas duas junto (ACOES_FORA_DO_TOGGLE em
--      src/lib/acoesDoToggleAcesso.ts): ligar a tela dá só "visualizar"; as duas se ligam de propósito. As policies de escrita passam a conferir
--      fechamento-socios + alterar/aprovar. Os menus fantasma e as permissões que ficaram pendentes neles são apagados (ninguém tinha).
--   2) Os 5 sócios já entram cadastrados e vinculados ao colaborador (TODOS os cadastros de cada um em EMPREGADOS, inclusive os demitidos: quem foi
--      readmitido tem mais de um ID e o integrante do lançamento pode apontar para qualquer um). O nome é o rótulo da coluna no Fechamento da Empresa.
--      Percentual padrão 0: quem define é o Financeiro na tela (o único campo editável).
--   3) A função fechamento_socios_colaboradores() (lista de colaboradores para vincular) deixa de ser usada: o vínculo não é mais escolhido na tela.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   (reaplicar as policies de escrita e os menus fantasma de 20261114220000; recriar fechamento_socios_colaboradores() dela)
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'fechamento-socios' AND acao IN ('alterar', 'aprovar');
--   NOTIFY pgrst, 'reload schema';

-- 1) catálogo de ações do menu
INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'fechamento-socios', a::public.app_acao
  FROM unnest(ARRAY['alterar', 'aprovar']) AS a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- policies de escrita: percentuais/cadastro = alterar; fechamento da competência e complemento pago = aprovar
DROP POLICY IF EXISTS fechamento_socio_escrita ON public.fechamento_socio;
CREATE POLICY fechamento_socio_escrita ON public.fechamento_socio FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_percentual_escrita ON public.fechamento_socio_percentual;
CREATE POLICY fechamento_socio_percentual_escrita ON public.fechamento_socio_percentual FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'alterar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_competencia_escrita ON public.fechamento_socio_competencia;
CREATE POLICY fechamento_socio_competencia_escrita ON public.fechamento_socio_competencia FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'aprovar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'aprovar'::public.app_acao)));
DROP POLICY IF EXISTS fechamento_socio_competencia_socio_escrita ON public.fechamento_socio_competencia_socio;
CREATE POLICY fechamento_socio_competencia_socio_escrita ON public.fechamento_socio_competencia_socio FOR ALL TO authenticated
  USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'aprovar'::public.app_acao)))
  WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), 'fechamento-socios', 'aprovar'::public.app_acao)));

-- sai dos menus fantasma
DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('fechamento-socios-percentual', 'fechamento-socios-fechar');
DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('fechamento-socios-percentual', 'fechamento-socios-fechar');
DELETE FROM public.app_menu WHERE codigo IN ('fechamento-socios-percentual', 'fechamento-socios-fechar');

-- 2) os 5 sócios, já vinculados (percentual 0 até o Financeiro definir)
INSERT INTO public.fechamento_socio (nome, empregado_ids, percentual_padrao, ativo)
VALUES
  ('Antônio',        ARRAY[921, 9427, 12782], 0, true),
  ('Carlos Eduardo', ARRAY[9506, 13607],      0, true),
  ('Guiomar',        ARRAY[3615, 11618, 12923], 0, true),
  ('Helena',         ARRAY[11929],            0, true),
  ('Senilton',       ARRAY[12922, 12924],     0, true)
ON CONFLICT ((lower(nome))) DO NOTHING;

-- 3) lista de colaboradores para vincular: não é mais usada
DROP FUNCTION IF EXISTS public.fechamento_socios_colaboradores();

NOTIFY pgrst, 'reload schema';
