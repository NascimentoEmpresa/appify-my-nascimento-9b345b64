-- =========================================================================
-- CHAMADOS › CONVERSA — QUEM VISUALIZOU, MESMO DE FORA DO GRUPO (11/11/2026)
--
-- Pablo: "desenvolve pra conseguir ver quem visualizou as mensagens, mesmo
-- sendo de fora, tipo o Iury e a Helena ali" (popover "Informações da
-- mensagem", seção Gestão — todos apareciam como "não leu").
--
-- Duas falhas:
--   1. chamado_marcar_lido só gravava a leitura de quem pode CONVERSAR
--      (solicitante, responsável, gestão de chamados, participante). Quem só
--      enxerga o chamado (Dashboard de chamados / Dashboard Dev geral —
--      chamado_sistema_pode_ver_todos) abria a conversa e nada ficava gravado:
--      o RPC dava 42501 e a tela engolia o erro.
--   2. chamado_participantes (mig 20261009000003) listava solicitante,
--      responsável, gestores e participantes — quem abriu a conversa sem estar
--      nessa lista não aparecia em lugar nenhum.
--
-- Agora: grava a leitura de quem ENXERGA o chamado (a mesma regra da policy
-- chamado_sistema_select), e a lista traz também quem abriu a conversa,
-- com o papel 'visualizou'. Continua fora do selo ✓✓ (principal = false) —
-- o selo segue olhando só solicitante e responsável.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_marcar_lido(p_chamado_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_agora timestamptz := now();
BEGIN
  -- Quem enxerga o chamado (policy chamado_sistema_select): conversa ou só vê.
  IF NOT (public.chamado_pode_conversar(p_chamado_id) OR public.chamado_sistema_pode_ver_todos()) THEN
    RAISE EXCEPTION 'Sem acesso a este chamado.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id) THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, auth.uid(), v_agora)
  ON CONFLICT (chamado_id, user_id)
  -- Só avança: reabrir uma tela antiga não pode "desler" o que já foi lido.
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  RETURN v_agora;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_marcar_lido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_marcar_lido(uuid) TO authenticated;

-- Mesmo corpo da mig 20261009000003 + quem abriu a conversa ('visualizou').
CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
 RETURNS TABLE(user_id uuid, nome text, papel text, ve_interno boolean, principal boolean, lido_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (public.chamado_pode_conversar(p_chamado_id) OR public.chamado_sistema_pode_ver_todos())
  ),
  gestores AS (
    SELECT DISTINCT s.user_id AS uid
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_painel',
                             'chamados_sistemas_coordenar',
                             'chamados_sistemas_aprovar')
       AND s.acao = 'visualizar'::public.app_acao
       AND s.allow = true
       AND s.empresa_id IS NULL
  ),
  extras AS (
    SELECT pp.user_id AS uid FROM public."CHAMADO_SISTEMA_PARTICIPANTE" pp JOIN ch ON ch.id = pp.chamado_id
  ),
  leitores AS (
    SELECT l.user_id AS uid FROM public."CHAMADO_SISTEMA_LEITURA" l JOIN ch ON ch.id = l.chamado_id
  ),
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT g.uid FROM gestores g CROSS JOIN ch
    UNION
    SELECT uid FROM extras
    UNION
    SELECT uid FROM leitores
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              WHEN g.uid IN (SELECT uid FROM extras) THEN 'participante'
              WHEN g.uid IN (SELECT uid FROM gestores) THEN 'gestao'
              ELSE 'visualizou' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         g.uid IN (ch.solicitante_id, ch.responsavel_id),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   WHERE COALESCE(p.ativo, true) AND g.uid IS NOT NULL
   ORDER BY CASE WHEN g.uid = ch.solicitante_id THEN 1
                 WHEN g.uid = ch.responsavel_id THEN 2
                 WHEN g.uid IN (SELECT uid FROM extras) THEN 3
                 WHEN g.uid IN (SELECT uid FROM gestores) THEN 4
                 ELSE 5 END,
            2;
$function$;
REVOKE ALL ON FUNCTION public.chamado_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participantes(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reexecutar o CREATE de chamado_marcar_lido da mig 20260831000001 e o de
-- chamado_participantes da mig 20261009000003.
-- NOTIFY pgrst, 'reload schema';
