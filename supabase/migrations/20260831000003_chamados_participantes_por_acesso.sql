-- =====================================================================
-- CHAMADOS — o grupo da conversa passa a ser QUEM TEM ACESSO
--
-- POR QUE
-- A versão da 20260831000001 montava o grupo por PARTICIPAÇÃO ("quem já
-- escreveu ou já abriu"). Ficava errado nos dois sentidos: o cabeçalho dizia
-- "3 pessoas" quando na verdade a gestão inteira enxerga o chamado, e um
-- gestor que ainda não tinha entrado simplesmente não existia na lista.
--
-- Agora o grupo é a lista de acesso de verdade:
--   solicitante + responsável designado + quem tem capacidade de gestão
--   (painel / coordenar / aprovar) — exatamente quem a RLS deixa ler.
--
-- O QUE MUDA
--   · papel passa a ser solicitante | responsavel | gestao;
--   · entra `principal`: solicitante e responsável são as pessoas de quem se
--     ESPERA resposta. É esse conjunto que a tela usa pra decidir o ✓✓ azul —
--     senão "lida por todos" dependeria dos 4 gestores abrirem o chamado e
--     nunca acenderia. A leitura da gestão continua vindo na mesma consulta,
--     e a tela mostra à parte, como informação.
--   · perfil inativo fica de fora (não é gente que vai responder).
--
-- Idempotente. Substitui a função da 20260831000001.
-- =====================================================================

DROP FUNCTION IF EXISTS public.chamado_participantes(uuid);

CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
RETURNS TABLE(
  user_id    uuid,
  nome       text,
  papel      text,     -- solicitante | responsavel | gestao
  ve_interno boolean,
  principal  boolean,  -- de quem se espera resposta (solicitante/responsável)
  lido_em    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND public.chamado_pode_conversar(p_chamado_id)
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
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT g.uid FROM gestores g CROSS JOIN ch
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              ELSE 'gestao' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         g.uid IN (ch.solicitante_id, ch.responsavel_id),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   WHERE COALESCE(p.ativo, true)
   ORDER BY CASE WHEN g.uid = ch.solicitante_id THEN 1
                 WHEN g.uid = ch.responsavel_id THEN 2
                 ELSE 3 END,
            2;
$$;
REVOKE ALL ON FUNCTION public.chamado_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participantes(uuid) TO authenticated;

COMMENT ON FUNCTION public.chamado_participantes(uuid) IS
  'Grupo do chamado = quem tem acesso (solicitante + responsável + gestão), com o carimbo de leitura de cada um.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS gestores FROM (
  SELECT DISTINCT s.user_id
    FROM public.screen_permission_user s
   WHERE s.menu_codigo IN ('chamados_sistemas_painel','chamados_sistemas_coordenar','chamados_sistemas_aprovar')
     AND s.acao = 'visualizar'::public.app_acao AND s.allow AND s.empresa_id IS NULL
) x;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: recriar chamado_participantes como na 20260831000001.
-- =====================================================================
