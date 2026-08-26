-- =========================================================================
-- TROCA DE FUNÇÃO — semear os menus nos perfis de módulo
--
-- Complementa 20260925000004. A migration original criou os menus e parou
-- aí: quem quisesse liberar tinha que marcar usuário por usuário, mesmo
-- para os perfis que já existem exatamente para isso.
--
-- NÃO é correção de segurança. O menu novo NÃO nasce aberto — medido no
-- banco em 25/08/2026: dos 194 usuários, 8 enxergavam a tela, e são
-- exatamente os 8 de perfil `concede_tudo`; zero fora disso. O RouteGuard
-- nega por padrão ("não existe mais o ramo 'ninguém configurou nada ainda
-- => aberto'", ver src/components/auth/RouteGuard.tsx). O que faltava era
-- conveniência, não tranca.
--
-- AS AÇÕES seguem o que os menus do fluxo de Demissão já têm nesses mesmos
-- perfis: `visualizar` para as telas de solicitação (a RLS da tabela é
-- aberta e quem gateia é o menu/RouteGuard, então visualizar basta) e
-- `alterar` a mais no SST, igual ao `sst_aso`.
--
-- `escritorio_troca_funcao` FICA DE FORA de propósito: aquela fila é de duas
-- pessoas do administrativo, não do RH inteiro. Semear no perfil RH daria a
-- fila do escritório para todo mundo do setor — o contrário do motivo pelo
-- qual ela foi separada do Operacional. Essa continua sendo liberação
-- individual, em Acesso por Usuário.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu, x.acao::public.app_acao, true
  FROM (VALUES
    ('Encarregados', 'encarregados_troca_funcao', 'visualizar'),
    ('Operacional',  'operacional_troca_funcao',  'visualizar'),
    ('SST',          'sst_troca_funcao',          'visualizar'),
    ('SST',          'sst_troca_funcao',          'alterar'),
    ('RH',           'rh_troca_funcao',           'visualizar')
  ) AS x(perfil, menu, acao)
  JOIN public.perfil_acesso pa ON pa.nome = x.perfil AND pa.ativo
 WHERE EXISTS (SELECT 1 FROM public.app_menu m WHERE m.codigo = x.menu)
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao p
      WHERE p.perfil_id = pa.id AND p.menu_codigo = x.menu AND p.acao::text = x.acao);

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT pa.nome AS perfil, pap.menu_codigo,
       string_agg(pap.acao::text, ', ' ORDER BY pap.acao::text) AS acoes
  FROM public.perfil_acesso pa
  JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow
 WHERE pap.menu_codigo LIKE '%troca_funcao%'
 GROUP BY 1, 2 ORDER BY 1, 2;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo IN ('encarregados_troca_funcao','operacional_troca_funcao',
--                          'sst_troca_funcao','rh_troca_funcao');
-- =========================================================================
