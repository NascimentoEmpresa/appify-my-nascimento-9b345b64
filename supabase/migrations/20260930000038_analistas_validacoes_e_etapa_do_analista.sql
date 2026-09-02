-- =====================================================================
-- ANALISTAS VALIDAÇÕES — a etapa do analista entra na frente de três
-- fluxos, e o submódulo nasce em Licitações.
--
-- Pedido do Pablo em 02/09/2026, em três partes:
--
--   1. "cria um submódulo novo em licitações: Analistas Validações onde vai
--      ter GESTÃO RECRUTAMENTO (troca o status é pendente analista e não
--      operacional, são os analistas que aprovam). pode deixar a gestão
--      recrutamento no operacional só pra eles verem os andamentos das
--      solicitações mas nenhuma interação".
--
--   2. "Mudança de função a mesma coisa, PRIMEIRO o analista aprova, depois
--      vai pro operacional e depois vai pro SST aprovar, depois vai pro RH.
--      atualmente tem dois mudança de função no RH precisa ter só um."
--
--   3. A demissão passa a ser: analista aprova → SST marca o ASO
--      demissional → RH confirma. Isso INVERTE a ordem de RH e SST, que
--      desde 25/08/2026 era RH e depois SST.
--
-- O que esta migration faz: cria os três menus do submódulo e CONVERTE as
-- linhas que já existem. Sem a conversão, tudo que estava em "Pendente
-- Operacional" sumiria das telas — o `.in("status", ...)` do front não
-- pediria mais esse valor, e a solicitação viraria um registro invisível
-- parado no banco.
--
-- O que ela NÃO faz: renomear as colunas `operacional_*` da demissão. Elas
-- passam a guardar a decisão do analista, mas têm histórico gravado e o
-- rótulo de tela já diz "Analista" — trocar o nome de três colunas por
-- causa disso é migração de dados sem ganho para quem lê.
-- =====================================================================

-- 1) Os três menus do submódulo ----------------------------------------
-- README: "toda tela nova ganha 1 linha em app_menu". Sem isso a tela não
-- aparece em Gerenciamento de Acesso, e o RouteGuard trata a rota como
-- "não cadastrada" = aberta para qualquer autenticado, o oposto do
-- deny-by-default do projeto.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT id, v.codigo, v.nome, v.rota, v.ordem, true
  FROM public.app_modulo,
       (VALUES
         ('licitacoes_analistas_recrutamento', 'Analistas — Gestão Recrutamento',      '/app/licitacoes/analistas/recrutamento',  280),
         ('licitacoes_analistas_troca_funcao', 'Analistas — Mudança de Função',        '/app/licitacoes/analistas/troca-funcao',  281),
         ('licitacoes_analistas_demissao',     'Analistas — Solicitações de Demissão', '/app/licitacoes/analistas/demissao',      282)
       ) AS v(codigo, nome, rota, ordem)
 WHERE public.app_modulo.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Recrutamento: a etapa 1 passa a ser do analista --------------------
--
-- Os dois gatilhos saem do caminho, e cada um por um motivo diferente:
--
--   • `trg_sistema_recrutamento_guard` recusaria o UPDATE. Ele só deixa
--     "quem decide sobre a vaga" mexer em coluna que não seja a data, e
--     decide isso por `has_screen_access(auth.uid(), ...)`. Numa migration
--     não existe `auth.uid()` — ele é NULL, a checagem dá falso e a
--     conversão morre com "você só pode alterar a Data de Início Prevista".
--
--   • `trg_sr_track_status` gravaria uma linha de histórico por vaga,
--     dizendo que alguém moveu a solicitação para "Pendente Analista". Não
--     moveu: ela está exatamente onde estava, o nome da etapa é que mudou.
--     Histórico inventado é pior que histórico faltando.
--
-- DISABLE/ENABLE em vez de DROP/CREATE de propósito: reexecutar esta
-- migration não pode deixar a tabela sem gatilho se algo estourar no meio.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sr_track_status;

UPDATE public."SISTEMA_RECRUTAMENTO"
   SET status = 'Pendente Analista'
 WHERE status = 'Pendente Operacional';

ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sr_track_status;
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

-- O histórico REAL registra o status de destino de cada movimentação;
-- deixá-lo com o valor antigo faria a timeline contar uma etapa que não
-- existe mais. Aqui é renomear o passado, não inventá-lo.
UPDATE public."RECRUTAMENTO_HISTORICO"
   SET para_status = 'Pendente Analista'
 WHERE para_status = 'Pendente Operacional';

-- 3) Mudança de função: o analista entra ANTES da aprovação -------------
-- Quem já estava numa fila de aprovação FICA onde está: puxar de volta para
-- uma etapa nova seria refazer trabalho que já foi feito. A etapa do
-- analista vale para o que nasce daqui em diante — `statusInicial` no
-- front já devolve 'Pendente Analista'.
--
-- Nada a converter aqui, portanto. O bloco existe para deixar registrado
-- que a decisão foi deliberada, e não esquecimento.

-- 4) Demissão: analista na frente, e SST antes do RH --------------------
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente Analista'
 WHERE status = 'Pendente Operacional';

-- A INVERSÃO. Quem estava em "Pendente RH" ainda NÃO tinha ASO marcado (no
-- fluxo antigo o SST vinha depois), então essas vão para o SST — é a etapa
-- que agora vem primeiro. As que já estavam em "Pendente SST" continuam
-- lá: o ASO delas também está por marcar, e depois seguem para o RH
-- confirmar, que é o caminho novo.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente SST'
 WHERE status = 'Pendente RH'
   AND sst_data_exame IS NULL;

-- Caso de borda: linha em "Pendente RH" COM exame já marcado não deveria
-- existir no fluxo antigo, mas se existir ela já cumpriu a etapa do SST e
-- fica esperando o RH — que é exatamente o que "Pendente RH" quer dizer
-- agora. Nada a fazer.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET status = 'Pendente RH'
--  WHERE status = 'Pendente SST' AND sst_data_exame IS NULL;
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET status = 'Pendente Operacional'
--  WHERE status = 'Pendente Analista';
-- UPDATE public."RECRUTAMENTO_HISTORICO" SET para_status = 'Pendente Operacional'
--  WHERE para_status = 'Pendente Analista';
-- UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Pendente Operacional'
--  WHERE status = 'Pendente Analista';
-- DELETE FROM public.app_menu WHERE codigo IN (
--   'licitacoes_analistas_recrutamento',
--   'licitacoes_analistas_troca_funcao',
--   'licitacoes_analistas_demissao');
-- NOTIFY pgrst, 'reload schema';
