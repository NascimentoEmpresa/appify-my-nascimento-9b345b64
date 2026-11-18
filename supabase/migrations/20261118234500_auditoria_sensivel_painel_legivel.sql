-- =========================================================================
-- CONFIGURAÇÕES DO ERP › AUDITORIA SENSÍVEL — painel legível (18/11/2026)
--
-- PEDIDO (Pablo, 18/11/2026, com print da aba): "mostre exatamente o usuário
-- que fez a alteração, horário, data, permissão que adicionou e pra quem
-- adicionou, se fez algum login novo também e coisas assim".
--
-- COMO ERA
--   A aba lia os últimos 150 registros de public.audit_log e mostrava o JSON
--   cru (UPDATE / public.profiles / uuid / {"new": {...}}). E o que mais
--   interessa NÃO estava lá: audit_log só tinha gatilho em profiles,
--   user_roles, role_permissions, empresas e nas tabelas do BDI. Dar ou tirar
--   permissão (screen_permission_user), perfil de acesso, vínculo do login com
--   o empregado e as ações das Edge admin-* não deixavam rastro nenhum.
--
-- O QUE ESTA MIGRATION FAZ
--   1) Passa a registrar (só daqui pra frente — não existe histórico de antes):
--      · screen_permission_user        → permissões por pessoa
--      · usuario_perfil_acesso         → perfil de acesso dado/tirado
--      · perfil_acesso / perfil_acesso_permissao → mudança no próprio perfil
--      · EMPREGADOS.auth_user_id       → login vinculado/desvinculado
--      Todos pelo audit_trigger() que já existe (grava auth.uid() = quem fez),
--      menos EMPREGADOS: lá é gatilho próprio, só da coluna auth_user_id —
--      o sync da Senior reescreve a tabela de 15 em 15 min e gravar a linha
--      inteira encheria o audit_log.
--   2) auditoria_registrar_acao_admin(): as Edge admin-create-user,
--      admin-delete-user, admin-reset-password, admin-update-email e
--      admin-revoke-session rodam com service_role, então auth.uid() é NULL
--      nos gatilhos ("Sistema"). Elas passam a gravar quem as chamou.
--   3) auditoria_sensivel_eventos(): lista PAGINADA no servidor, já traduzida
--      (quem fez, para quem, tela/módulo/ação, campos antes → depois), juntando
--      audit_log + MENU_LIBERACAO_HISTORICO (Novos Módulos) +
--      auth.audit_log_entries (entradas no sistema, GoTrue).
--      auditoria_sensivel_resumo(): os contadores do topo.
--      Ambas exigem has_screen_access(auth.uid(), 'administracao', 'visualizar')
--      — a mesma régua da aba e da RLS do audit_log.
--
-- DETALHE QUE MOLDA A LEITURA DAS PERMISSÕES
--   Módulos & Menus salva cada tela com DELETE das ações e depois INSERT de
--   todas de novo (ModulosMenusTab.handleSave) — duas requisições, duas
--   transações. Lido cru, "salvar sem mudar nada" pareceria "tirou e deu tudo
--   de novo". Por isso a leitura junta o DELETE com o INSERT da mesma chave
--   (pessoa, tela, ação, empresa) feito pela mesma pessoa em até 2 minutos e
--   mostra só a mudança líquida (antes → depois); o que não mudou some. Depois
--   agrupa o que a mesma pessoa mexeu para o mesmo alvo numa rajada (intervalo
--   ≤ 2 min) num evento só: "Fulano deu 3 e tirou 1 permissão de Beltrano".
--
-- O QUE NÃO DÁ
--   · Login com SENHA ERRADA: o GoTrue não grava tentativa falha em
--     auth.audit_log_entries; o ERP também não. Fica de fora.
--   · Quem fez antes de hoje: as tabelas novas não tinham gatilho; e nas
--     antigas, o que veio de Edge/robô ficou como "Sistema".
--
-- Idempotente. Aplica sozinha no merge (cluster_pos_merge.yml).
-- =========================================================================

-- ── 1) Gatilhos novos de auditoria ───────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_screen_permission_user ON public.screen_permission_user;
CREATE TRIGGER trg_audit_screen_permission_user AFTER INSERT OR UPDATE OR DELETE ON public.screen_permission_user
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_usuario_perfil_acesso ON public.usuario_perfil_acesso;
CREATE TRIGGER trg_audit_usuario_perfil_acesso AFTER INSERT OR UPDATE OR DELETE ON public.usuario_perfil_acesso
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_perfil_acesso ON public.perfil_acesso;
CREATE TRIGGER trg_audit_perfil_acesso AFTER INSERT OR UPDATE OR DELETE ON public.perfil_acesso
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_perfil_acesso_permissao ON public.perfil_acesso_permissao;
CREATE TRIGGER trg_audit_perfil_acesso_permissao AFTER INSERT OR UPDATE OR DELETE ON public.perfil_acesso_permissao
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- Vínculo login ↔ empregado. Só a coluna, só quando muda.
CREATE OR REPLACE FUNCTION public.auditoria_empregado_vinculo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, schema_name, table_name, op, pk, diff)
  VALUES (auth.uid(), TG_TABLE_SCHEMA, TG_TABLE_NAME, 'U', NEW."ID"::text,
          jsonb_build_object('old', jsonb_build_object('auth_user_id', OLD.auth_user_id),
                             'new', jsonb_build_object('auth_user_id', NEW.auth_user_id),
                             'nome', NEW."Nome"));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.auditoria_empregado_vinculo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auditoria_empregado_vinculo ON public."EMPREGADOS";
CREATE TRIGGER trg_auditoria_empregado_vinculo AFTER UPDATE OF auth_user_id ON public."EMPREGADOS"
  FOR EACH ROW WHEN (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id)
  EXECUTE FUNCTION public.auditoria_empregado_vinculo();

-- ── 2) Registro explícito das Edge admin-* (service_role) ────────────────
-- _acao: criar_usuario | excluir_usuario | redefinir_senha | alterar_email |
-- encerrar_sessao. Só service_role executa.
CREATE OR REPLACE FUNCTION public.auditoria_registrar_acao_admin(
  _ator uuid, _acao text, _alvo uuid, _detalhes jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.audit_log (user_id, schema_name, table_name, op, pk, diff)
  VALUES (_ator, 'auth', 'auth_admin', 'I', _alvo::text,
          jsonb_build_object('acao', _acao) || coalesce(_detalhes, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.auditoria_registrar_acao_admin(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_registrar_acao_admin(uuid, text, uuid, jsonb) TO service_role;

-- ── 3) Leitura ───────────────────────────────────────────────────────────
-- Campos que mudaram entre dois jsonb: {campo: {antes, depois}}.
CREATE OR REPLACE FUNCTION public.auditoria_campos_alterados(_old jsonb, _new jsonb, _ignorar text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('antes', _old -> k, 'depois', _new -> k)), '{}'::jsonb)
    FROM (SELECT jsonb_object_keys(coalesce(_old, '{}'::jsonb)) k
          UNION
          SELECT jsonb_object_keys(coalesce(_new, '{}'::jsonb))) x
   WHERE NOT (k = ANY (coalesce(_ignorar, '{}')))
     AND (_old -> k) IS DISTINCT FROM (_new -> k);
$$;

CREATE OR REPLACE FUNCTION public.auditoria_uuid(_t text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND _t <> '00000000-0000-0000-0000-000000000000'
         THEN _t::uuid END;
$$;

-- Todos os eventos do período, já classificados. Interna: só as RPCs abaixo
-- (SECURITY DEFINER, mesmo dono) a chamam.
--   tipo: permissao | login | cadastro | outros
--   evento: código estável; o front transforma em frase (src/lib/auditoriaSensivel.ts)
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
                   AND w.ts - w.lts <= interval '2 minutes'
                THEN (w.lo ->> 'allow')::boolean
              WHEN w.op = 'I' THEN NULL
              ELSE (w.o ->> 'allow')::boolean END AS antes,
         CASE WHEN w.op = 'D' THEN NULL ELSE (w.n ->> 'allow')::boolean END AS depois
    FROM perm_w w
   -- DELETE que vira INSERT da mesma chave logo em seguida: fica só o INSERT
   WHERE NOT (w.op = 'D' AND w.nop = 'I' AND w.nator IS NOT DISTINCT FROM w.ator
              AND w.nts - w.ts <= interval '2 minutes')
),
perm_itens AS (
  SELECT * FROM perm_net n WHERE n.antes IS DISTINCT FROM n.depois AND n.ts >= _de
),
perm_b AS (
  SELECT i.*,
         CASE WHEN i.ts - lag(i.ts) OVER g <= interval '2 minutes' THEN 0 ELSE 1 END AS novo
    FROM perm_itens i
  WINDOW g AS (PARTITION BY i.src, i.grupo, i.ator ORDER BY i.ts, i.id)
),
perm_g AS (
  SELECT b.*, sum(b.novo) OVER (PARTITION BY b.src, b.grupo, b.ator ORDER BY b.ts, b.id) AS gid
    FROM perm_b b
),
-- Dentro da rajada, a mesma ação mexida duas vezes vale pelo começo e pelo fim
perm_c AS (
  SELECT x.src, x.grupo, x.ator, x.gid, x.menu, x.acao, x.emp, min(x.id) AS id, min(x.ts) AS ts,
         (array_agg(x.antes ORDER BY x.ts, x.id))[1] AS antes,
         (array_agg(x.depois ORDER BY x.ts DESC, x.id DESC))[1] AS depois
    FROM perm_g x
   GROUP BY x.src, x.grupo, x.ator, x.gid, x.menu, x.acao, x.emp
),
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
                              ORDER BY g.menu, g.acao)) AS detalhes,
         NULL::jsonb AS bruto
    FROM perm_c g
   WHERE g.antes IS DISTINCT FROM g.depois
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

-- Nome de tela, módulo e perfil nos detalhes (só nas linhas da página).
CREATE OR REPLACE FUNCTION public.auditoria_detalhes_legiveis(_d jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(_d, '{}'::jsonb)
    || CASE WHEN jsonb_typeof(_d -> 'itens') = 'array' THEN jsonb_build_object('itens', (
         SELECT coalesce(jsonb_agg(x.it || jsonb_build_object('menu_nome', mn.nome, 'modulo_nome', mn.modulo) ORDER BY x.ord), '[]'::jsonb)
           FROM jsonb_array_elements(_d -> 'itens') WITH ORDINALITY x(it, ord)
           LEFT JOIN LATERAL (
             SELECT m.nome, mo.nome AS modulo
               FROM public.app_menu m LEFT JOIN public.app_modulo mo ON mo.id = m.modulo_id
              WHERE m.codigo = x.it ->> 'menu'
              ORDER BY m.ativo DESC, m.created_at LIMIT 1) mn ON true))
       ELSE '{}'::jsonb END
    || coalesce(CASE WHEN _d ? 'menu' THEN (
         SELECT jsonb_build_object('menu_nome', coalesce(_d ->> 'menu_nome', m.nome), 'modulo_nome', mo.nome)
           FROM public.app_menu m LEFT JOIN public.app_modulo mo ON mo.id = m.modulo_id
          WHERE m.codigo = _d ->> 'menu'
          ORDER BY m.ativo DESC, m.created_at LIMIT 1) END, '{}'::jsonb)
    || coalesce(CASE WHEN _d ->> 'perfil_id' IS NOT NULL THEN (
         SELECT jsonb_build_object('perfil_nome', pa.nome) FROM public.perfil_acesso pa
          WHERE pa.id::text = _d ->> 'perfil_id') END, '{}'::jsonb)
    || coalesce(CASE WHEN _d ->> 'login_anterior' IS NOT NULL THEN (
         SELECT jsonb_build_object('login_anterior_nome', coalesce(nullif(btrim(p.display_name), ''), p.email))
           FROM public.profiles p WHERE p.id::text = _d ->> 'login_anterior') END, '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.auditoria_detalhes_legiveis(jsonb) FROM PUBLIC, anon, authenticated;

-- Lista paginada. _ator: uuid em texto, ou 'sistema' (feito sem usuário).
CREATE OR REPLACE FUNCTION public.auditoria_sensivel_eventos(
  _de timestamptz, _ate timestamptz,
  _tipo text DEFAULT NULL, _ator text DEFAULT NULL, _alvo uuid DEFAULT NULL, _busca text DEFAULT NULL,
  _limite int DEFAULT 50, _offset int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_out jsonb;
  v_busca text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'administracao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate <= _de OR _ate - _de > interval '370 days' THEN
    RAISE EXCEPTION 'Período inválido (máximo de um ano).';
  END IF;
  -- 50 por página na tela; o "Exportar CSV" pede até 5.000 de uma vez.
  _limite := greatest(1, least(coalesce(_limite, 50), 5000));
  _offset := greatest(0, coalesce(_offset, 0));

  WITH b AS MATERIALIZED (
    SELECT * FROM public.auditoria_sensivel_base(_de, _ate)
  ),
  n AS (
    SELECT b.*,
           coalesce(nullif(btrim(pa.display_name), ''), pa.email) AS ator_nome,
           coalesce(nullif(btrim(pb.display_name), ''), pb.email, b.detalhes ->> 'email') AS alvo_nome
      FROM b
      LEFT JOIN public.profiles pa ON pa.id = b.ator_id
      LEFT JOIN public.profiles pb ON pb.id = b.alvo_id
  ),
  f AS (
    SELECT * FROM n
     WHERE (_tipo IS NULL OR n.tipo = _tipo)
       AND (_ator IS NULL OR (_ator = 'sistema' AND n.ator_id IS NULL) OR n.ator_id::text = _ator)
       AND (_alvo IS NULL OR n.alvo_id = _alvo)
       AND (v_busca IS NULL OR concat_ws(' ', n.ator_nome, n.alvo_nome, n.evento,
                                         public.auditoria_detalhes_legiveis(n.detalhes)::text) ILIKE '%' || v_busca || '%')
  ),
  pg AS (
    SELECT * FROM f ORDER BY f.ts DESC, f.id DESC LIMIT _limite OFFSET _offset
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'id', pg.id, 'ts', pg.ts, 'tipo', pg.tipo, 'evento', pg.evento,
                 'ator_id', pg.ator_id, 'ator_nome', pg.ator_nome,
                 'alvo_id', pg.alvo_id, 'alvo_nome', pg.alvo_nome,
                 'detalhes', public.auditoria_detalhes_legiveis(pg.detalhes),
                 'bruto', pg.bruto) ORDER BY pg.ts DESC, pg.id DESC) FROM pg), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.auditoria_sensivel_eventos(timestamptz, timestamptz, text, text, uuid, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_sensivel_eventos(timestamptz, timestamptz, text, text, uuid, text, int, int) TO authenticated;

-- Contadores do topo (só o período; os outros filtros não mexem aqui).
CREATE OR REPLACE FUNCTION public.auditoria_sensivel_resumo(_de timestamptz, _ate timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'administracao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate <= _de OR _ate - _de > interval '370 days' THEN
    RAISE EXCEPTION 'Período inválido (máximo de um ano).';
  END IF;

  WITH b AS MATERIALIZED (SELECT * FROM public.auditoria_sensivel_base(_de, _ate))
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM b),
    'por_tipo', (SELECT coalesce(jsonb_object_agg(x.tipo, x.n), '{}'::jsonb)
                   FROM (SELECT b.tipo, count(*) n FROM b GROUP BY 1) x),
    'permissoes_dadas', (SELECT coalesce(sum((b.detalhes ->> 'dadas')::int), 0) FROM b WHERE b.evento = 'permissoes_usuario'),
    'permissoes_removidas', (SELECT coalesce(sum((b.detalhes ->> 'removidas')::int), 0) FROM b WHERE b.evento = 'permissoes_usuario'),
    'perfis_concedidos', (SELECT count(*) FROM b WHERE b.evento IN ('perfil_concedido', 'papel_concedido')),
    'perfis_removidos', (SELECT count(*) FROM b WHERE b.evento IN ('perfil_removido', 'papel_removido')),
    'modulos_liberados', (SELECT count(*) FROM b WHERE b.evento = 'modulo_liberado'),
    'usuarios_criados', (SELECT count(*) FROM b WHERE b.evento = 'usuario_criado'),
    'contas_desativadas', (SELECT count(*) FROM b WHERE b.evento = 'conta_desativada'),
    'contas_ativadas', (SELECT count(*) FROM b WHERE b.evento = 'conta_ativada'),
    'logins_vinculados', (SELECT count(*) FROM b WHERE b.evento = 'login_vinculado'),
    'logins_desvinculados', (SELECT count(*) FROM b WHERE b.evento = 'login_desvinculado'),
    'entradas', (SELECT count(*) FROM b WHERE b.evento IN ('entrou', 'abriu_erp')),
    'entradas_fonte', CASE WHEN EXISTS (SELECT 1 FROM b WHERE b.evento = 'abriu_erp') THEN 'sessoes' ELSE 'gotrue' END,
    'pessoas_que_entraram', (SELECT count(DISTINCT b.ator_id) FROM b WHERE b.evento IN ('entrou', 'abriu_erp')),
    -- Quem mais mexeu: só ações feitas por alguém sobre o sistema (entrar/sair não conta)
    'top_atores', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.ator_id, 'nome', x.nome, 'eventos', x.n) ORDER BY x.n DESC, x.nome), '[]'::jsonb)
                     FROM (SELECT b.ator_id, coalesce(nullif(btrim(p.display_name), ''), p.email, 'Sistema') nome, count(*) n
                             FROM b LEFT JOIN public.profiles p ON p.id = b.ator_id
                            WHERE b.evento NOT IN ('entrou', 'saiu', 'abriu_erp', 'recuperacao_senha', 'senha_trocada')
                            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5) x)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.auditoria_sensivel_resumo(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_sensivel_resumo(timestamptz, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.auditoria_sensivel_resumo(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.auditoria_sensivel_eventos(timestamptz, timestamptz, text, text, uuid, text, int, int);
-- DROP FUNCTION IF EXISTS public.auditoria_detalhes_legiveis(jsonb);
-- DROP FUNCTION IF EXISTS public.auditoria_sensivel_base(timestamptz, timestamptz);
-- DROP FUNCTION IF EXISTS public.auditoria_uuid(text);
-- DROP FUNCTION IF EXISTS public.auditoria_campos_alterados(jsonb, jsonb, text[]);
-- DROP FUNCTION IF EXISTS public.auditoria_registrar_acao_admin(uuid, text, uuid, jsonb);
-- DROP TRIGGER IF EXISTS trg_auditoria_empregado_vinculo ON public."EMPREGADOS";
-- DROP FUNCTION IF EXISTS public.auditoria_empregado_vinculo();
-- DROP TRIGGER IF EXISTS trg_audit_perfil_acesso_permissao ON public.perfil_acesso_permissao;
-- DROP TRIGGER IF EXISTS trg_audit_perfil_acesso ON public.perfil_acesso;
-- DROP TRIGGER IF EXISTS trg_audit_usuario_perfil_acesso ON public.usuario_perfil_acesso;
-- DROP TRIGGER IF EXISTS trg_audit_screen_permission_user ON public.screen_permission_user;
-- NOTIFY pgrst, 'reload schema';
