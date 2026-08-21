-- SIS-2026-0211 (melhoria visual): a leitura de malote_config e
-- malote_dia_bloqueado era restrita a admin/controladoria/diretor_adm —
-- um solicitante comum nunca consegue ver o calendário de dias bloqueados
-- pra escolher a data corretamente. Não é dado sensível (lista de datas
-- feriado/bloqueadas + 2 configs de horário/regra), então abre leitura
-- pra qualquer usuário autenticado. Escrita continua restrita (política
-- existente não é tocada).
CREATE POLICY malote_config_select_geral ON public.malote_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY malote_dia_bloqueado_select_geral ON public.malote_dia_bloqueado
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS malote_config_select_geral ON public.malote_config;
--   DROP POLICY IF EXISTS malote_dia_bloqueado_select_geral ON public.malote_dia_bloqueado;
