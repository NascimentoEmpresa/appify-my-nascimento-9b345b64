-- =====================================================================
-- RECRUTAMENTO E SELEÇÃO — alinhar o RLS ao padrão da ERP
--
-- Sintoma: "new row violates row-level security policy for table
-- SISTEMA_RECRUTAMENTO" ao abrir vaga.
--
-- Causa: as tabelas do Recrutamento exigiam SÓ 'incluir' no WITH CHECK,
-- enquanto a tela (Recrutamento.tsx) decide quem conduz o processo por
-- 'alterar' — `podeRecrutar = can("alterar", …, "recrutamento_gestao")`.
-- A tela liberava o botão com uma ação e o banco cobrava outra.
--
-- O padrão da ERP (JUR_PROCESSOS, JUR_PATRIMONIOS e afins) é aceitar
-- 'incluir' OU 'alterar'. Só o Recrutamento estava fora. Esta migration
-- coloca as 6 tabelas do módulo no mesmo padrão — nenhum outro sistema é
-- tocado.
--
-- O USING (leitura) não muda: continua 'visualizar'.
--
-- Idempotente (CREATE OR REPLACE POLICY não existe; DROP + CREATE).
-- ROLLBACK: recriar cada policy trocando "OR …'alterar'" de volta por nada.
-- =====================================================================

-- Escrita = incluir OU alterar, no menu que já governa a leitura da tabela.
DROP POLICY IF EXISTS sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
  )
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir')
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar')
  );

DROP POLICY IF EXISTS recrutamento_candidato_arquivos_gate ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS";
CREATE POLICY recrutamento_candidato_arquivos_gate ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
  );

DROP POLICY IF EXISTS recrutamento_entrevista_gate ON public."RECRUTAMENTO_ENTREVISTA";
CREATE POLICY recrutamento_entrevista_gate ON public."RECRUTAMENTO_ENTREVISTA"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
  );

DROP POLICY IF EXISTS sistema_recrutamento_status_log_gate ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
CREATE POLICY sistema_recrutamento_status_log_gate ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
  );

DROP POLICY IF EXISTS wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO";
CREATE POLICY wa_mensagens_recrutamento_gate ON public."WA_MENSAGENS_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
  );

-- Esta é só de INSERT e já aceitava vários menus; mantém todos e acrescenta
-- 'alterar' nos dois que são do Recrutamento. sst_aso e candidatos ficam como
-- estão — são de outros sistemas e não é para mexer neles.
DROP POLICY IF EXISTS recrutamento_historico_insert ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_insert ON public."RECRUTAMENTO_HISTORICO"
  FOR INSERT TO authenticated
  WITH CHECK (
    has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
    OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
    OR has_screen_access(auth.uid(), 'sst_aso', 'incluir')
    OR has_screen_access(auth.uid(), 'candidatos', 'incluir')
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'incluir')
    OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'alterar')
  );

NOTIFY pgrst, 'reload schema';
