-- ============================================================================
-- SIS-2026-0780 — Fluxo de Caixa: alteração em massa de Centro de Custo e Classificação
-- ============================================================================
-- A tela ganha uma barra "Alteração em massa" (marcar várias linhas e trocar o Centro de Custo ou a Classificação de uma vez).
-- Só a Controladoria e o Financeiro devem ter essa barra. O acesso é por pessoa (README), então ela ganha um menu fantasma
-- (app_menu.rota = NULL) para carregar a permissão, consumido por <AcessoGate menu="financeiro-fluxo-caixa-alteracao-massa">.
--
-- A troca em si NÃO ganha função nova: o front repete, linha a linha, o que o lápis do Fluxo já faz — o ajuste de classificação
-- (financeiro_fluxo_caixa_ajuste) e fluxo_caixa_trocar_contrato(). Por isso quem usa a barra precisa também de 'alterar' em
-- financeiro-fluxo-caixa-gestao (Editar), exigido pelas duas.
--
-- SEMENTE (menu sem nenhuma linha de permissão é lido como aberto para todos, ver 20261020000020): recebem 'visualizar'
--   · perfis que concedem tudo (admin);
--   · perfis e pessoas que hoje já têm 'alterar' (Editar) no Fluxo de Caixa — são quem edita o Fluxo, ou seja, a Controladoria e o Financeiro.
--   RH (só Ratear) e quem só consulta ficam sem a barra; a Administração libera ou tira caso a caso.
--
-- Migration leve (um menu, ações e sementes): pode rodar inteira de uma vez.
--
-- ROLLBACK:
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-fluxo-caixa-alteracao-massa';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-fluxo-caixa-alteracao-massa';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-fluxo-caixa-alteracao-massa';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-fluxo-caixa-alteracao-massa';
SET lock_timeout = '5s';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'financeiro-fluxo-caixa-alteracao-massa', 'Financeiro — Fluxo de Caixa: Alteração em massa', NULL, 36, true
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-fluxo-caixa-alteracao-massa', 'visualizar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-fluxo-caixa-alteracao-massa', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'financeiro-fluxo-caixa-alteracao-massa', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'financeiro-fluxo-caixa-gestao' AND p.acao = 'alterar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Pessoas com 'alterar' no Fluxo. empresa_id nulo nunca conflita no UNIQUE: o NOT EXISTS é que garante que reexecutar não duplica.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'financeiro-fluxo-caixa-alteracao-massa', 'visualizar'::public.app_acao, true, s.empresa_id,
       'SIS-2026-0780: quem edita o Fluxo recebe a alteração em massa'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'financeiro-fluxo-caixa-gestao' AND s.acao = 'alterar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'financeiro-fluxo-caixa-alteracao-massa' AND x.acao = 'visualizar'
                      AND x.empresa_id IS NOT DISTINCT FROM s.empresa_id);

NOTIFY pgrst, 'reload schema';
