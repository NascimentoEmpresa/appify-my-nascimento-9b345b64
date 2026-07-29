-- Bloquear Agenda — bloqueio recorrente semanal (ex: todo domingo, 8h-11h,
-- até uma data futura) + editar/excluir em massa da série. As linhas
-- continuam sendo bloqueios normais (tipo = 'data_especifica'), só que
-- criadas em lote e marcadas com essa tag pra saber quais pertencem à
-- mesma série — mesmo padrão de serie_recorrencia_id em "reuniao".
ALTER TABLE public.reuniao_bloqueio_agenda ADD COLUMN IF NOT EXISTS serie_bloqueio_id uuid;
CREATE INDEX IF NOT EXISTS idx_reuniao_bloqueio_agenda_serie ON public.reuniao_bloqueio_agenda(serie_bloqueio_id) WHERE serie_bloqueio_id IS NOT NULL;

-- Não existia UPDATE (decisão anterior: "errou, apaga e cria de novo") —
-- editar em massa precisa de verdade de um UPDATE agora. Continua só o
-- dono mexendo no próprio bloqueio, igual SELECT/INSERT/DELETE já são.
DROP POLICY IF EXISTS reuniao_bloqueio_agenda_update ON public.reuniao_bloqueio_agenda;
CREATE POLICY reuniao_bloqueio_agenda_update ON public.reuniao_bloqueio_agenda
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
