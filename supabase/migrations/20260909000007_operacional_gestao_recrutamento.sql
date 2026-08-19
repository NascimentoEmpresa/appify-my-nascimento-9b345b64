-- =========================================================================
-- OPERACIONAL — menu "Gestão Recrutamento"
--
-- A mesma tela do Recrutamento e Seleção, recortada na etapa 1: o Operacional
-- vê só o que está "Pendente Operacional" e decide se vira vaga. O React
-- reaproveita o componente (Recrutamento.tsx, escopo="operacional") em vez de
-- clonar a tela — o que muda aqui é QUEM entra e o que o banco deixa fazer.
--
-- POR QUE UM MENU PRÓPRIO
-- O acesso é por menu. Sem um código só dele, liberar o Operacional
-- obrigaria a conceder 'recrutamento_gestao', que é a tela inteira do
-- Recrutamento — currículos, candidatos, kanban, mover etapa. O operacional
-- não precisa de nada disso e não deveria receber junto.
--
-- AS POLICIES
-- As tabelas do Recrutamento só aceitam quem tem 'recrutamento_gestao' (ou o
-- menu do encarregado). Em vez de reescrever aquelas policies, esta migration
-- ACRESCENTA uma permissiva por tabela: no Postgres, políticas permissivas se
-- combinam por OR, então nada do que já valia deixa de valer — só passa a
-- valer também para quem tem o menu novo. Desfazer é dropar as quatro.
--
-- Só as tabelas que a etapa 1 usa de verdade: a lista/decisão, o log de
-- status, o histórico e o chat da solicitação. Currículos, entrevista e
-- arquivos do candidato ficam de fora — são das etapas seguintes, e o
-- operacional não abre nenhuma delas.
--
-- Idempotente.
-- ROLLBACK:
--   DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
--   DROP POLICY IF EXISTS sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
--   DROP POLICY IF EXISTS recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO";
--   DROP POLICY IF EXISTS recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS";
--   DELETE FROM public.app_menu WHERE codigo = 'operacional_recrutamento';
-- =========================================================================

-- ── 1. O menu ────────────────────────────────────────────────────────
-- O módulo 'operacional' nasce em 20260909000005; o COALESCE evita depender
-- da ordem em que as duas migrations forem aplicadas.
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'operacional', 'Operacional', 'Diárias, escala e aprovações',
       'CalendarCheck2',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'encarregados'),
                (SELECT max(ordem) FROM public.app_modulo), 200) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'operacional');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'operacional_recrutamento', 'Gestão Recrutamento',
       '/app/operacional/recrutamento',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── 2. As policies do menu novo ──────────────────────────────────────
-- A fila e a decisão (aprovar/reprovar é UPDATE de status).
DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar')
  );

-- O tempo em cada etapa, que a tela lê junto da lista e grava ao decidir.
DROP POLICY IF EXISTS sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
CREATE POLICY sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar')
  );

-- A timeline do drawer: sem isto a decisão do operacional não fica registrada.
DROP POLICY IF EXISTS recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'incluir')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
  );

-- O chat da solicitação, que é como o operacional pergunta algo ao solicitante
-- antes de reprovar.
DROP POLICY IF EXISTS recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS";
CREATE POLICY recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'incluir')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
  );

-- ── Conferência ──────────────────────────────────────────────────────
SELECT codigo, nome, rota, ativo FROM public.app_menu WHERE codigo = 'operacional_recrutamento';

NOTIFY pgrst, 'reload schema';
