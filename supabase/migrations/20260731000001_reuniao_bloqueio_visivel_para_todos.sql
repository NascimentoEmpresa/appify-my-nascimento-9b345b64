-- Reverte a decisão de privacidade anterior: o motivo do bloqueio de
-- agenda deixa de ser só do dono e passa a ficar visível pra qualquer um
-- com acesso à Agenda de Reunião — decisão explícita do usuário, pra dar
-- visibilidade de "ocupado" antes de tentar agendar (hoje só descobria ao
-- salvar). INSERT/DELETE continuam só do próprio dono.

DROP POLICY IF EXISTS reuniao_bloqueio_agenda_select ON public.reuniao_bloqueio_agenda;
CREATE POLICY reuniao_bloqueio_agenda_select ON public.reuniao_bloqueio_agenda
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_reunioes'));
