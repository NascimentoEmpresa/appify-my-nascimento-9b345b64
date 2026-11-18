-- =========================================================================
-- AUDITORIA SENSÍVEL — tirar e dar de novo aparecem os dois (18/11/2026)
--
-- PEDIDO (Pablo, testando a aba depois do merge da mig 20261118234500):
--   "tirei as permissões do Otniel pra ver os indicadores do Comitê de
--   Ética, OK apareceu ali, mas após eu adicionar novamente SUMIU o
--   registro, em vez de aparecer que eu coloquei de novo a permissão".
--
-- CAUSA
--   auditoria_sensivel_base juntava numa "rajada" tudo o que a mesma pessoa
--   mexeu no mesmo alvo com intervalo de até 2 MINUTOS e, dentro dela,
--   mostrava só o saldo de cada ação (o "antes" da primeira mexida contra o
--   "depois" da última — CTE perm_c). Tirar e dar de novo = saldo zero = a
--   linha sumia, apagando inclusive o "tirou" que já estava na tela.
--   O DELETE+INSERT do mesmo salvar também era emparelhado com folga de 2 min,
--   o que podia colar dois cliques diferentes.
--
-- O QUE MUDA (só a leitura; nada do que foi gravado muda)
--   1) DELETE+INSERT viram uma mudança só apenas quando são o MESMO salvar:
--      mesma chave, mesma pessoa, até 10 segundos (o handleSave de Módulos &
--      Menus faz os dois em sequência, milissegundos um do outro).
--   2) Sem saldo dentro da rajada: cada mudança real fica na lista. Tirar e
--      dar de novo aparecem como dois itens.
--   3) Rajada = um clique em Salvar: a mesma pessoa mexendo no mesmo alvo
--      com intervalo de até 10 segundos entre um registro e o próximo. Dois
--      salvares separados viram dois eventos ("tirou 5" e depois "deu 5").
--
-- Idempotente (CREATE OR REPLACE da mesma assinatura). Aplica sozinha no merge.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.auditoria_sensivel_base(_de timestamptz, _ate timestamptz)
RETURNS TABLE (id text, ts timestamptz, tipo text, evento text, ator_id uuid, alvo_id uuid, detalhes jsonb, bruto jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH
-- Permissões por pessoa e por perfil: mudança líquida, item a item
perm_raw AS (
  SELECT a.id, a.ts, a.user_id AS ator, a.op, a.table_name AS src,
         CASE a.op WHEN 'U' THEN a.diff -> 'old' WHEN 'D' THEN a.diff END AS o,
         CASE a.op WHEN 'U' THEN a.diff -> 'new' WHEN 'I' THEN a.diff END AS n
    FROM public.audit_log a
   WHERE a.table_name IN ('screen_permission_user', 'perfil_acesso_permissao')
     AND a.ts >= _de - interval '5 minutes' AND a.ts < _ate
),
perm_k AS (
  SELECT r.*,
         CASE r.src WHEN 'screen_permission_user' THEN coalesce(r.n, r.o) ->> 'user_id'
                    ELSE coalesce(r.n, r.o) ->> 'perfil_id' END AS grupo,
         coalesce(r.n, r.o) ->> 'menu_codigo' AS menu,
         coalesce(r.n, r.o) ->> 'acao' AS acao,
         coalesce(coalesce(r.n, r.o) ->> 'empresa_id', '') AS emp
    FROM perm_raw r
),
perm_w AS (
  SELECT k.*,
         lead(k.op) OVER w AS nop, lead(k.ts) OVER w AS nts, lead(k.ator) OVER w AS nator,
         lag(k.op)  OVER w AS lop, lag(k.ts)  OVER w AS lts, lag(k.ator)  OVER w AS lator, lag(k.o) OVER w AS lo
    FROM perm_k k
  WINDOW w AS (PARTITION BY k.src, k.grupo, k.menu, k.acao, k.emp ORDER BY k.ts, k.id)
),
perm_net AS (
  SELECT w.id, w.ts, w.ator, w.src, w.grupo, w.menu, w.acao, w.emp,
         CASE WHEN w.op = 'I' AND w.lop = 'D' AND w.lator IS NOT DISTINCT FROM w.ator
                   AND w.ts - w.lts <= interval '10 seconds'   -- mig 20261119020000: era 2 min
                THEN (w.lo ->> 'allow')::boolean
              WHEN w.op = 'I' THEN NULL
              ELSE (w.o ->> 'allow')::boolean END AS antes,
         CASE WHEN w.op = 'D' THEN NULL ELSE (w.n ->> 'allow')::boolean END AS depois
    FROM perm_w w
   -- DELETE que vira INSERT da mesma chave no mesmo salvar: fica só o INSERT
   WHERE NOT (w.op = 'D' AND w.nop = 'I' AND w.nator IS NOT DISTINCT FROM w.ator
              AND w.nts - w.ts <= interval '10 seconds')
),
perm_itens AS (
  SELECT * FROM perm_net n WHERE n.antes IS DISTINCT FROM n.depois AND n.ts >= _de
),
perm_b AS (
  SELECT i.*,
         -- Rajada = um clique em Salvar (era 2 min e juntava cliques diferentes)
         CASE WHEN i.ts - lag(i.ts) OVER g <= interval '10 seconds' THEN 0 ELSE 1 END AS novo
    FROM perm_itens i
  WINDOW g AS (PARTITION BY i.src, i.grupo, i.ator ORDER BY i.ts, i.id)
),
perm_g AS (
  SELECT b.*, sum(b.novo) OVER (PARTITION BY b.src, b.grupo, b.ator ORDER BY b.ts, b.id) AS gid
    FROM perm_b b
),
-- mig 20261119020000: sem saldo dentro da rajada (a CTE perm_c sumiu) —
-- tirar e dar de novo são duas mudanças e as duas aparecem.
perm AS (
  SELECT 'perm:' || min(g.id) AS id, min(g.ts) AS ts, 'permissao'::text AS tipo,
         CASE WHEN g.src = 'screen_permission_user' THEN 'permissoes_usuario' ELSE 'permissoes_perfil' END AS evento,
         g.ator AS ator_id,
         CASE WHEN g.src = 'screen_permission_user' THEN public.auditoria_uuid(g.grupo) END AS alvo_id,
         jsonb_build_object(
           'perfil_id', CASE WHEN g.src <> 'screen_permission_user' THEN g.grupo END,
           'dadas', count(*) FILTER (WHERE g.depois IS TRUE),
           'removidas', count(*) FILTER (WHERE g.antes IS TRUE AND g.depois IS NOT TRUE),
           'itens', jsonb_agg(jsonb_build_object('menu', g.menu, 'acao', g.acao, 'antes', g.antes,
                                                 'depois', g.depois, 'empresa_id', nullif(g.emp, ''))
                              ORDER BY g.menu, g.acao, g.ts, g.id)) AS detalhes,
         NULL::jsonb AS bruto
    FROM perm_g g
   GROUP BY g.src, g.grupo, g.ator, g.gid
),
-- Perfil de acesso dado/tirado a uma pessoa
upa AS (
  SELECT 'aud:' || a.id, a.ts, 'permissao'::text,
         CASE a.op WHEN 'I' THEN 'perfil_concedido' WHEN 'D' THEN 'perfil_removido' ELSE 'perfil_alterado' END,
         a.user_id, public.auditoria_uuid(coalesce(a.diff -> 'new', a.diff) ->> 'user_id'),
         jsonb_build_object('perfil_id', coalesce(a.diff -> 'new', a.diff) ->> 'perfil_id'),
         a.diff
    FROM public.audit_log a
   WHERE a.table_name = 'usuario_perfil_acesso' AND a.ts >= _de AND a.ts < _ate
),
-- Papel legado (user_roles)
papel AS (
  SELECT 'aud:' || a.id, a.ts, 'permissao'::text,
         CASE a.op WHEN 'I' THEN 'papel_concedido' WHEN 'D' THEN 'papel_removido' ELSE 'papel_alterado' END,
         a.user_id, public.auditoria_uuid(coalesce(a.diff -> 'new', a.diff) ->> 'user_id'),
         jsonb_build_object('papel', coalesce(a.diff -> 'new', a.diff) ->> 'role',
                            'papel_anterior', a.diff -> 'old' ->> 'role'),
         a.diff
    FROM public.audit_log a
   WHERE a.table_name = 'user_roles' AND a.ts >= _de AND a.ts < _ate
),
-- O próprio perfil de acesso (nome, "concede tudo", ativo)
perfil AS (
  SELECT 'aud:' || a.id, a.ts, 'permissao'::text,
         CASE a.op WHEN 'I' THEN 'perfil_criado' WHEN 'D' THEN 'perfil_excluido' ELSE 'perfil_editado' END,
         a.user_id, NULL::uuid,
         jsonb_build_object('perfil_id', a.pk,
                            'perfil_nome', coalesce(a.diff -> 'new', a.diff) ->> 'nome',
                            'campos', CASE WHEN a.op = 'U' THEN public.auditoria_campos_alterados(a.diff -> 'old', a.diff -> 'new', ARRAY['updated_at']) END),
         a.diff
    FROM public.audit_log a
   WHERE a.table_name = 'perfil_acesso' AND a.ts >= _de AND a.ts < _ate
     AND (a.op <> 'U' OR public.auditoria_campos_alterados(a.diff -> 'old', a.diff -> 'new', ARRAY['updated_at']) <> '{}'::jsonb)
),
-- Novos Módulos (SIS-2026-0931): já tinha histórico próprio com feito_por
novos AS (
  SELECT 'mlh:' || h.id, h.feito_em, 'permissao'::text, 'modulo_' || h.evento,
         h.feito_por, NULL::uuid,
         jsonb_build_object('menu', h.menu_codigo, 'menu_nome', h.menu_nome,
                            'adicionados', cardinality(h.adicionados), 'removidos', cardinality(h.removidos),
                            'pessoas_com_acesso', h.pessoas_com_acesso,
                            'setores', to_jsonb(h.setores), 'cargos', to_jsonb(h.cargos)),
         NULL::jsonb
    FROM public."MENU_LIBERACAO_HISTORICO" h
   WHERE h.feito_em >= _de AND h.feito_em < _ate
),
-- Cadastro do login (profiles)
prof AS (
  SELECT a.*, public.auditoria_campos_alterados(a.diff -> 'old', a.diff -> 'new',
                ARRAY['updated_at', 'created_at', 'empresa_atual_id']) AS campos
    FROM public.audit_log a
   WHERE a.table_name = 'profiles' AND a.schema_name = 'public' AND a.ts >= _de AND a.ts < _ate
),
prof_ev AS (
  SELECT 'aud:' || p.id, p.ts,
         CASE WHEN p.op = 'U' AND p.campos ? 'ativo' THEN 'login' ELSE 'cadastro' END,
         CASE p.op WHEN 'I' THEN 'usuario_criado' WHEN 'D' THEN 'usuario_excluido'
              ELSE CASE WHEN p.campos ? 'ativo'
                        THEN CASE WHEN (p.diff -> 'new' ->> 'ativo')::boolean THEN 'conta_ativada' ELSE 'conta_desativada' END
                        ELSE 'cadastro_alterado' END END,
         -- Criar/excluir vêm da Edge (service_role): quem chamou está na linha auth_admin
         coalesce(p.user_id,
                  (SELECT e.user_id FROM public.audit_log e
                    WHERE e.table_name = 'auth_admin' AND e.pk = p.pk
                      AND e.ts BETWEEN p.ts - interval '10 minutes' AND p.ts + interval '10 minutes'
                      AND e.diff ->> 'acao' = CASE p.op WHEN 'I' THEN 'criar_usuario' WHEN 'D' THEN 'excluir_usuario' ELSE 'alterar_email' END
                    ORDER BY abs(extract(epoch FROM e.ts - p.ts)) LIMIT 1)),
         public.auditoria_uuid(p.pk),
         CASE p.op WHEN 'U' THEN jsonb_build_object('campos', p.campos)
              ELSE jsonb_build_object('email', coalesce(p.diff -> 'new', p.diff) ->> 'email',
                                      'nome', coalesce(p.diff -> 'new', p.diff) ->> 'display_name') END,
         p.diff
    FROM prof p
   WHERE (p.op <> 'U' OR p.campos <> '{}'::jsonb)
     -- O upsert que a Edge faz logo depois de criar o login é parte da criação
     AND NOT (p.op = 'U' AND p.user_id IS NULL AND EXISTS (
           SELECT 1 FROM public.audit_log c
            WHERE c.table_name = 'profiles' AND c.op = 'I' AND c.pk = p.pk
              AND c.ts BETWEEN p.ts - interval '2 minutes' AND p.ts))
),
-- Login ligado/desligado do cadastro do empregado
vinculo AS (
  SELECT 'aud:' || a.id, a.ts, 'login'::text,
         CASE WHEN a.diff -> 'new' ->> 'auth_user_id' IS NOT NULL THEN 'login_vinculado' ELSE 'login_desvinculado' END,
         a.user_id,
         public.auditoria_uuid(coalesce(a.diff -> 'new' ->> 'auth_user_id', a.diff -> 'old' ->> 'auth_user_id')),
         jsonb_build_object('empregado_id', a.pk, 'empregado_nome', a.diff ->> 'nome',
                            'login_anterior', CASE WHEN a.diff -> 'new' ->> 'auth_user_id' IS NOT NULL
                                                   THEN a.diff -> 'old' ->> 'auth_user_id' END),
         a.diff
    FROM public.audit_log a
   WHERE a.table_name = 'EMPREGADOS' AND a.ts >= _de AND a.ts < _ate
),
-- Ações das Edge admin-* que não aparecem em outra tabela
edge AS (
  SELECT 'aud:' || a.id, a.ts, 'login'::text, a.diff ->> 'acao', a.user_id, public.auditoria_uuid(a.pk),
         a.diff - 'acao', a.diff
    FROM public.audit_log a
   WHERE a.table_name = 'auth_admin' AND a.ts >= _de AND a.ts < _ate
     AND a.diff ->> 'acao' IN ('redefinir_senha', 'alterar_email', 'encerrar_sessao')
),
-- Entradas no sistema (GoTrue). token_refreshed/revoked ficam de fora: são
-- a renovação automática da sessão, não alguém entrando.
gt AS (
  -- payload é json (não jsonb) no GoTrue
  SELECT e.id, e.created_at, e.ip_address, e.payload::jsonb AS payload, e.payload ->> 'action' AS acao
    FROM auth.audit_log_entries e
   WHERE e.created_at >= _de AND e.created_at < _ate
     AND e.payload ->> 'action' IN ('login', 'logout', 'user_recovery_requested', 'user_updated_password')
),
gt_ev AS (
  SELECT 'gt:' || g.id, g.created_at, 'login'::text,
         CASE g.acao WHEN 'login' THEN 'entrou' WHEN 'logout' THEN 'saiu'
                     WHEN 'user_recovery_requested' THEN 'recuperacao_senha' ELSE 'senha_trocada' END,
         public.auditoria_uuid(g.payload ->> 'actor_id'), public.auditoria_uuid(g.payload ->> 'actor_id'),
         jsonb_build_object('ip', nullif(g.ip_address, ''), 'email', g.payload ->> 'actor_username',
                            'metodo', g.payload -> 'traits' ->> 'provider'),
         g.payload
    FROM gt g
),
-- Sem registro do GoTrue no período (auditoria dele desligada no cluster),
-- cai para as aberturas do ERP que o Topbar grava.
sessoes AS (
  SELECT 'ses:' || s.id, s.iniciada_em, 'login'::text, 'abriu_erp'::text, s.user_id, s.user_id,
         jsonb_build_object('ip', s.ip, 'navegador', s.user_agent), NULL::jsonb
    FROM public.sessoes_ativas s
   WHERE s.iniciada_em >= _de AND s.iniciada_em < _ate
     AND NOT EXISTS (SELECT 1 FROM gt WHERE gt.acao = 'login')
),
-- Tudo o mais que o audit_log registra (empresas, BDI, role_permissions…)
outros AS (
  SELECT 'aud:' || a.id, a.ts, 'outros'::text,
         CASE a.op WHEN 'I' THEN 'registro_criado' WHEN 'D' THEN 'registro_excluido' ELSE 'registro_alterado' END,
         a.user_id, NULL::uuid,
         jsonb_build_object('tabela', a.table_name, 'registro', a.pk,
                            'campos', CASE WHEN a.op = 'U' THEN public.auditoria_campos_alterados(a.diff -> 'old', a.diff -> 'new', ARRAY['updated_at']) END),
         a.diff
    FROM public.audit_log a
   WHERE a.ts >= _de AND a.ts < _ate
     AND a.table_name NOT IN ('screen_permission_user', 'perfil_acesso_permissao', 'usuario_perfil_acesso',
                              'user_roles', 'perfil_acesso', 'profiles', 'EMPREGADOS', 'auth_admin')
     AND (a.op <> 'U' OR public.auditoria_campos_alterados(a.diff -> 'old', a.diff -> 'new', ARRAY['updated_at']) <> '{}'::jsonb)
)
SELECT * FROM perm
UNION ALL SELECT * FROM upa
UNION ALL SELECT * FROM papel
UNION ALL SELECT * FROM perfil
UNION ALL SELECT * FROM novos
UNION ALL SELECT * FROM prof_ev
UNION ALL SELECT * FROM vinculo
UNION ALL SELECT * FROM edge
UNION ALL SELECT * FROM gt_ev
UNION ALL SELECT * FROM sessoes
UNION ALL SELECT * FROM outros
$$;
REVOKE ALL ON FUNCTION public.auditoria_sensivel_base(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a seção "CREATE OR REPLACE FUNCTION public.auditoria_sensivel_base"
-- de 20261118234500_auditoria_sensivel_painel_legivel.sql (janelas de 2 min
-- e a CTE perm_c que soma a rajada).
