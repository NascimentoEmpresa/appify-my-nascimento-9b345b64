-- INCIDENTE EM PRODUÇÃO: o gerente de sistemas tem TODAS as permissões do
-- módulo Sistemas marcadas — inclusive abrir e delegar chamado — e mesmo assim
-- não consegue encaminhar chamado para outro desenvolvedor.
--
-- Causa: o menu `chamados_sistemas` (rota /app/sistemas/chamados, a tela
-- principal de chamados, onde a delegação acontece) está com ativo = false.
--
-- Por que só apareceu agora: antes, menu inativo sumia do casamento de rota,
-- a rota virava "não cadastrada" e o RouteGuard LIBERAVA. A tela funcionava
-- por acidente. Quando o acesso passou a negar por padrão
-- (20260910000005 + f49d6aa6), menu inativo passou a NEGAR — e a tela caiu,
-- sem que nenhuma permissão pudesse consertar, porque permissão não vence
-- menu inativo.
--
-- Pior: o painel "Acesso por Usuário" filtra por ativo, então esse menu nem
-- aparece lá. O admin marcava tudo o que via, e o que faltava era invisível.
--
-- As subrotas (/painel, /dev, /dashboard-tv) continuavam funcionando porque
-- têm menu próprio ATIVO e o casamento é por prefixo mais longo. Só a tela
-- raiz caiu — o que bate exatamente com o relato: "abre o módulo mas não
-- consegue delegar".
--
-- Esta migration reativa APENAS esse menu. Os outros 13 menus inativos com
-- rota (Suprimentos legado, /app/pregao, /app/triagem) ficam como estão: são
-- telas realmente aposentadas, e reativar em massa reabriria justamente as
-- rotas que o deny-by-default veio fechar.
--
-- ROLLBACK: UPDATE public.app_menu SET ativo = false WHERE codigo = 'chamados_sistemas';

UPDATE public.app_menu
   SET ativo = true, updated_at = now()
 WHERE codigo = 'chamados_sistemas'
   AND rota = '/app/sistemas/chamados'
   AND ativo = false;
