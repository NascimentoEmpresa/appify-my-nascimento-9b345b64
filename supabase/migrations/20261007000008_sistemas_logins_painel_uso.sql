-- =========================================================================
-- SISTEMAS › LOGINS — painel de uso (07/10/2026)
--
-- PEDIDO (Pablo): "faz alguns dashboards nesse sistema de logins, tipo
-- quais setores têm mais logins, quais setores mais acessam etc."
--
-- FONTES
--   · Logins = auth.users (159 em 07/10). Setor = public.user_setor
--     (Administração › Setores) — cobre TODOS os usuários; o Setor_ERP da
--     EMPREGADOS só cobre 73. Um usuário pode ter mais de um setor: conta
--     em cada um (por isso a soma por setor pode passar do total).
--   · Acesso = uma linha em public.sessoes_ativas — o Topbar grava uma por
--     abertura do ERP (por aba/navegador, sessionStorage), desde mai/2026.
--     Não mede tempo nem tela visitada.
--   · Telas negadas = public.access_audit_log (allowed = false): alguém
--     tentou abrir uma tela sem liberação — mostra onde falta permissão.
--   · Bloqueados = erp_login_bloqueado (mig 20261007000007).
--   Horas e dias em America/Sao_Paulo.
--
-- sis_logins_painel(_dias): _dias = janela dos acessos (7, 30, 90…);
-- NULL = desde o início do registro. Acesso: sis_logins_pode('visualizar').
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_sessoes_ativas_iniciada_em ON public.sessoes_ativas (iniciada_em);

CREATE OR REPLACE FUNCTION public.sis_logins_painel(_dias int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_de timestamptz;
  v_out jsonb;
BEGIN
  IF NOT public.sis_logins_pode('visualizar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF _dias IS NOT NULL AND (_dias < 1 OR _dias > 3650) THEN RAISE EXCEPTION 'Período inválido.'; END IF;
  v_de := CASE WHEN _dias IS NULL THEN '-infinity'::timestamptz
               ELSE (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => _dias - 1)) AT TIME ZONE 'America/Sao_Paulo' END;

  WITH u AS MATERIALIZED (
    SELECT x.id, coalesce(nullif(btrim(p.display_name), ''), x.email::text) nome, x.email::text email,
           x.created_at, public.erp_login_bloqueado(x.id) bloqueado
      FROM auth.users x LEFT JOIN public.profiles p ON p.id = x.id
  ),
  st AS MATERIALIZED (   -- setor(es) de cada usuário; sem setor vira "(sem setor)"
    SELECT u.id, coalesce(s.setor, '(sem setor)') setor
      FROM u LEFT JOIN public.user_setor s ON s.user_id = u.id
  ),
  se AS MATERIALIZED (   -- acessos no período
    SELECT s.user_id, s.iniciada_em, s.iniciada_em AT TIME ZONE 'America/Sao_Paulo' local,
           CASE WHEN s.user_agent ~* '(Android|iPhone|iPad|Mobile)' THEN 'Celular / tablet' ELSE 'Computador' END dispositivo
      FROM public.sessoes_ativas s
     WHERE s.iniciada_em >= v_de AND s.user_id IN (SELECT id FROM u)
  ),
  ult AS (               -- último acesso de cada usuário (todo o histórico)
    SELECT u.id, greatest(max(s.iniciada_em), max(a.last_sign_in_at)) ultimo
      FROM u LEFT JOIN public.sessoes_ativas s ON s.user_id = u.id
             LEFT JOIN auth.users a ON a.id = u.id
     GROUP BY u.id
  ),
  pu AS MATERIALIZED (   -- por usuário
    SELECT u.*, ult.ultimo, (SELECT count(*) FROM se WHERE se.user_id = u.id) acessos,
           (SELECT count(DISTINCT se.local::date) FROM se WHERE se.user_id = u.id) dias_ativos
      FROM u JOIN ult USING (id)
  )
  SELECT jsonb_build_object(
    'dias', _dias, 'de', CASE WHEN _dias IS NULL THEN (SELECT min(iniciada_em) FROM public.sessoes_ativas) ELSE v_de END,
    'gerado_em', now(),
    'total_logins', (SELECT count(*) FROM pu),
    'ativos', (SELECT count(*) FROM pu WHERE acessos > 0),
    'acessos', (SELECT count(*) FROM se),
    'bloqueados', (SELECT count(*) FROM pu WHERE bloqueado),
    'nunca_acessaram', (SELECT count(*) FROM pu WHERE ultimo IS NULL),
    'sem_acesso_30d', (SELECT count(*) FROM pu WHERE NOT bloqueado AND (ultimo IS NULL OR ultimo < now() - interval '30 days')),
    'por_setor', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'setor', x.setor, 'logins', x.logins, 'ativos', x.ativos, 'acessos', x.acessos, 'bloqueados', x.bloq)
                     ORDER BY x.logins DESC, x.setor), '[]'::jsonb)
                    FROM (SELECT st.setor, count(*) logins, count(*) FILTER (WHERE pu.acessos > 0) ativos,
                                 sum(pu.acessos) acessos, count(*) FILTER (WHERE pu.bloqueado) bloq
                            FROM st JOIN pu ON pu.id = st.id GROUP BY 1) x),
    'por_dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', x.dia, 'acessos', x.n, 'usuarios', x.us) ORDER BY x.dia), '[]'::jsonb)
                  FROM (SELECT local::date dia, count(*) n, count(DISTINCT user_id) us FROM se GROUP BY 1) x),
    'por_hora', (SELECT jsonb_agg(jsonb_build_object('hora', h, 'acessos', coalesce(x.n, 0)) ORDER BY h)
                   FROM generate_series(0, 23) h
                   LEFT JOIN (SELECT extract(hour FROM local)::int hr, count(*) n FROM se GROUP BY 1) x ON x.hr = h),
    'por_semana', (SELECT jsonb_agg(jsonb_build_object('dow', d, 'acessos', coalesce(x.n, 0)) ORDER BY d)
                     FROM generate_series(0, 6) d
                     LEFT JOIN (SELECT extract(dow FROM local)::int dw, count(*) n FROM se GROUP BY 1) x ON x.dw = d),
    'dispositivos', (SELECT coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.dispositivo, 'acessos', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                       FROM (SELECT dispositivo, count(*) n FROM se GROUP BY 1) x),
    'top_usuarios', (SELECT coalesce(jsonb_agg(x ORDER BY x.acessos DESC, x.nome), '[]'::jsonb) FROM (
                       SELECT pu.nome, pu.email, pu.acessos, pu.dias_ativos, pu.ultimo,
                              (SELECT string_agg(st.setor, ', ' ORDER BY st.setor) FROM st WHERE st.id = pu.id) setores
                         FROM pu WHERE pu.acessos > 0 ORDER BY pu.acessos DESC, pu.nome LIMIT 15) x),
    'sem_acesso', (SELECT coalesce(jsonb_agg(x ORDER BY x.ultimo NULLS FIRST, x.nome), '[]'::jsonb) FROM (
                     SELECT pu.nome, pu.email, pu.ultimo, pu.created_at criado_em,
                            (SELECT string_agg(st.setor, ', ' ORDER BY st.setor) FROM st WHERE st.id = pu.id) setores
                       FROM pu WHERE NOT pu.bloqueado AND (pu.ultimo IS NULL OR pu.ultimo < now() - interval '30 days')) x),
    'telas_negadas', (SELECT coalesce(jsonb_agg(jsonb_build_object('tela', x.tela, 'tentativas', x.n, 'usuarios', x.us) ORDER BY x.n DESC), '[]'::jsonb)
                        FROM (SELECT coalesce(nullif(a.rota, ''), a.menu_codigo) tela, count(*) n, count(DISTINCT a.user_id) us
                                FROM public.access_audit_log a
                               WHERE NOT a.allowed AND a.created_at >= v_de
                               GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.sis_logins_painel(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_logins_painel(int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sis_logins_painel(int);
-- DROP INDEX IF EXISTS public.idx_sessoes_ativas_iniciada_em;
