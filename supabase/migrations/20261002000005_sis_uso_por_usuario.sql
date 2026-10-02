-- =========================================================================
-- Sistemas › Checklist de Módulos › Uso do ERP: HISTÓRICO POR USUÁRIO
-- (02/10/2026)
--
-- Pedido do Pablo: na aba "Uso do ERP", o histórico de cada usuário — o que
-- cada pessoa mais acessa, quando, quais módulos. A medição já existia
-- (SIS_USO_TELA: pessoa × tela × dia, com primeiro/último acesso do dia,
-- gravada pelo RouteGuard desde a mig 291); faltava ler POR PESSOA.
--
--   sis_uso_usuarios(_dias)        lista: cada usuário ativo com acessos,
--                                  dias ativos, telas/módulos distintos,
--                                  último acesso e a tela que MAIS usa.
--                                  Quem não usou no período vem com zero.
--   sis_uso_usuario(_user, _dias)  detalhe de uma pessoa: telas e módulos
--                                  mais usados, acessos por dia e o
--                                  histórico (dia × tela, 1ª e última hora).
--
-- Mesma trava das outras RPCs de uso: só quem vê o Checklist de Módulos.
-- SIS_USO_TELA continua sem policy de leitura direta.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sis_uso_usuarios(_dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_desde date := (now() AT TIME ZONE 'America/Sao_Paulo')::date - greatest(coalesce(_dias, 30), 1) + 1;
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH uso AS (
      SELECT u.user_id, sum(u.acessos) acessos, count(DISTINCT u.dia) dias,
             count(DISTINCT u.menu_id) telas, count(DISTINCT u.modulo_id) modulos, max(u.ultimo_em) ultimo
        FROM public."SIS_USO_TELA" u WHERE u.dia >= v_desde GROUP BY u.user_id),
    geral AS (
      SELECT u.user_id, max(u.ultimo_em) ultimo, min(u.dia) primeiro_dia
        FROM public."SIS_USO_TELA" u GROUP BY u.user_id),
    top AS (
      SELECT DISTINCT ON (x.user_id) x.user_id, a.nome tela, a.rota, m.nome modulo, x.acessos
        FROM (SELECT user_id, menu_id, sum(acessos) acessos FROM public."SIS_USO_TELA"
               WHERE dia >= v_desde GROUP BY 1, 2) x
        JOIN public.app_menu a ON a.id = x.menu_id
        JOIN public.app_modulo m ON m.id = a.modulo_id
       ORDER BY x.user_id, x.acessos DESC, a.nome),
    cargo AS (
      SELECT DISTINCT ON (e.auth_user_id) e.auth_user_id, nullif(btrim(e."Título do Cargo"), '') cargo, nullif(btrim(e."Setor_ERP"), '') setor
        FROM public."EMPREGADOS" e WHERE e.auth_user_id IS NOT NULL
       ORDER BY e.auth_user_id, public.col_desligado(e."Situação") ASC, e."ID" DESC),
    pessoas AS (
      SELECT p.id FROM public.profiles p WHERE coalesce(p.ativo, true)
      UNION SELECT user_id FROM uso)
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', pe.id, 'nome', public.sis_ck_nome_usuario(pe.id), 'email', pr.email,
             'cargo', c.cargo, 'setor', c.setor,
             'acessos', coalesce(u.acessos, 0), 'dias', coalesce(u.dias, 0),
             'telas', coalesce(u.telas, 0), 'modulos', coalesce(u.modulos, 0),
             'ultimo', coalesce(u.ultimo, g.ultimo), 'primeiro_dia', g.primeiro_dia,
             'tela_top', t.tela, 'tela_top_rota', t.rota, 'modulo_top', t.modulo, 'tela_top_acessos', t.acessos)
           ORDER BY coalesce(u.acessos, 0) DESC, public.sis_ck_nome_usuario(pe.id))
      FROM pessoas pe
      LEFT JOIN public.profiles pr ON pr.id = pe.id
      LEFT JOIN uso u ON u.user_id = pe.id
      LEFT JOIN geral g ON g.user_id = pe.id
      LEFT JOIN top t ON t.user_id = pe.id
      LEFT JOIN cargo c ON c.auth_user_id = pe.id
  ), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.sis_uso_usuarios(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_uso_usuarios(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.sis_uso_usuario(_user uuid, _dias integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_ate   date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_desde date := v_ate - greatest(coalesce(_dias, 30), 1) + 1;
BEGIN
  IF NOT public.sis_ck_pode('visualizar') THEN
    RAISE EXCEPTION 'Sem acesso ao Checklist de Módulos.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'telas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('menu_id', x.menu_id, 'tela', a.nome, 'rota', a.rota, 'modulo', m.nome,
                                          'acessos', x.acessos, 'dias', x.dias, 'ultimo', x.ultimo)
                       ORDER BY x.acessos DESC, x.ultimo DESC)
        FROM (SELECT menu_id, sum(acessos) acessos, count(DISTINCT dia) dias, max(ultimo_em) ultimo
                FROM public."SIS_USO_TELA" WHERE user_id = _user AND dia >= v_desde GROUP BY menu_id) x
        JOIN public.app_menu a ON a.id = x.menu_id
        JOIN public.app_modulo m ON m.id = a.modulo_id), '[]'::jsonb),
    'modulos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('modulo', m.nome, 'acessos', x.acessos, 'telas', x.telas, 'dias', x.dias)
                       ORDER BY x.acessos DESC)
        FROM (SELECT modulo_id, sum(acessos) acessos, count(DISTINCT menu_id) telas, count(DISTINCT dia) dias
                FROM public."SIS_USO_TELA" WHERE user_id = _user AND dia >= v_desde GROUP BY modulo_id) x
        JOIN public.app_modulo m ON m.id = x.modulo_id), '[]'::jsonb),
    'por_dia', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dia', d.dia::date, 'acessos', coalesce(x.acessos, 0), 'telas', coalesce(x.telas, 0)) ORDER BY d.dia)
        FROM generate_series(v_desde, v_ate, interval '1 day') AS d(dia)
        LEFT JOIN (SELECT dia, sum(acessos) acessos, count(DISTINCT menu_id) telas
                     FROM public."SIS_USO_TELA" WHERE user_id = _user GROUP BY dia) x ON x.dia = d.dia::date), '[]'::jsonb),
    'historico', coalesce((
      SELECT jsonb_agg(h ORDER BY h->>'ultimo_em' DESC)
        FROM (SELECT jsonb_build_object('dia', u.dia, 'tela', a.nome, 'rota', a.rota, 'modulo', m.nome,
                                        'acessos', u.acessos, 'primeiro_em', u.primeiro_em, 'ultimo_em', u.ultimo_em) h
                FROM public."SIS_USO_TELA" u
                JOIN public.app_menu a ON a.id = u.menu_id
                JOIN public.app_modulo m ON m.id = u.modulo_id
               WHERE u.user_id = _user AND u.dia >= v_desde
               ORDER BY u.ultimo_em DESC LIMIT 1000) s), '[]'::jsonb)
  );
END $f$;
REVOKE ALL ON FUNCTION public.sis_uso_usuario(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_uso_usuario(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sis_uso_usuarios(integer);
-- DROP FUNCTION IF EXISTS public.sis_uso_usuario(uuid, integer);
-- NOTIFY pgrst, 'reload schema';
