-- Marca automaticamente plano_acao como "atrasada" quando a Data de
-- conclusão (data_fim_planejado) já passou — mesmo padrão de cron job já
-- usado no projeto (sla-escalonamento-tick, regua-cobranca-tick), só que
-- direto em SQL: não precisa de edge function, é só um UPDATE de coluna.
--
-- Isentos (não viram "atrasada" mesmo com prazo vencido): já concluídos/
-- cancelados (concluida_validada, cancelada, concluida_pendente_evidencia).
-- aguardando_validacao NÃO é isento — decisão do usuário.
--
-- "atrasada" deixou de ser selecionável manualmente no formulário (ver
-- Detalhe.tsx/Kanban.tsx) — só este job define esse status.
DO $$
BEGIN
  PERFORM cron.unschedule('plano-acao-marcar-atrasadas');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'plano-acao-marcar-atrasadas',
  '0 6 * * *',
  $$
  UPDATE public.plano_acao
     SET status_normalizado = 'atrasada'
   WHERE deleted_at IS NULL
     AND data_fim_planejado IS NOT NULL
     AND data_fim_planejado < CURRENT_DATE
     AND status_normalizado NOT IN ('atrasada', 'concluida_validada', 'cancelada', 'concluida_pendente_evidencia');
  $$
);
