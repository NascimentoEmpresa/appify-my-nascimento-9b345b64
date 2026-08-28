-- =========================================================================
-- Consultar e movimentar estoque viram permissões separadas
--
-- PEDIDO DO CASSIO (ajuste 6 da revisão de 27/08/2026)
-- "Os estoquistas só terão permissão para consultar o estoque e somente o
-- supervisor terá no login a permissão de dar entrada."
--
-- O QUE ESTAVA ERRADO
-- A tela não tinha gate nenhum: quem enxergasse o menu `sup_estoque` podia dar
-- entrada e remover etiqueta. O banco já estava certo — `sup_est_entrada`
-- exige `alterar` e `sup_est_remover_tag` exige `excluir` — mas ninguém tinha
-- distribuído as ações, e a regra do banco nunca chegava a ser exercida porque
-- todo mundo recebia tudo junto.
--
-- Esta migration NÃO retira acesso de ninguém. Ela apenas garante que as três
-- ações existam separadas no Acesso por Usuário, para o Eduardo distribuir à
-- mão: `visualizar` para os estoquistas, `alterar` e `excluir` para o
-- supervisor.
--
-- POR QUE NÃO AUTOMATIZAR A DISTRIBUIÇÃO
-- Seria preciso adivinhar quem é estoquista e quem é supervisor a partir de
-- cargo — e cargo neste banco é texto livre, o que já causou problema antes.
-- Tirar acesso de alguém por engano trava o almoxarifado no meio do
-- expediente. A escolha fica com quem conhece as pessoas.
--
-- Idempotente.
-- ROLLBACK: nada a desfazer — não remove nem concede acesso a ninguém.
-- =========================================================================

-- Semeia as três ações no perfil `concede_tudo`, que é o que marca um menu
-- como "configurado". Sem isso, um menu sem nenhuma regra fica visível para
-- todo autenticado — o oposto do que este ajuste quer.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_estoque', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao),
   ('incluir'::public.app_acao),
   ('alterar'::public.app_acao),
   ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── Conferência ──────────────────────────────────────────────────────────
-- Quantos perfis têm cada ação hoje. Serve de retrato antes da distribuição
-- manual: se `alterar` aparecer com o mesmo número de `visualizar`, ninguém
-- foi separado ainda.
SELECT acao, count(*) AS perfis
  FROM public.perfil_acesso_permissao
 WHERE menu_codigo = 'sup_estoque' AND allow
 GROUP BY acao
 ORDER BY acao;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR, em Administração › Acesso por Usuário › Suprimentos ›
-- Estoque & Etiquetas:
--
--   estoquista  → marcar SÓ "visualizar"
--   supervisor  → marcar "visualizar", "incluir", "alterar" e "excluir"
--
-- O estoquista continua vendo tudo: saldo, tamanhos, e o histórico de quem
-- mexeu em cada item. Ele só não movimenta.
-- =========================================================================
