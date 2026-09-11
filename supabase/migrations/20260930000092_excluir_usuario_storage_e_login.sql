-- ============================================================================
-- Excluir usuário: alcançar o Storage e nomear quem barra o login
-- ----------------------------------------------------------------------------
-- CONTINUAÇÃO de 20260930000083. Aquela migration resolveu a primeira trava
-- (plano_acao_historico), e aí apareceu a segunda, na etapa seguinte:
--
--   Erro ao remover autenticação: Database error deleting user
--
-- Essa frase é do GoTrue (o serviço de login do Supabase). Ele sabe que o
-- Postgres recusou o DELETE em auth.users, mas não repassa QUAL constraint
-- recusou — some justamente a informação que resolve o caso.
--
-- DUAS MUDANÇAS, as duas na RPC admin_excluir_usuario_completo:
--
-- 1) A varredura passa a alcançar o schema `storage`.
--    A versão anterior excluía `storage` junto com os schemas internos do
--    Supabase. Só que `storage.objects` tem `owner` apontando pra auth.users,
--    e quem já subiu foto de perfil ou anexo tem linha lá. Resultado: a
--    limpeza varria o ERP inteiro e não encostava nos arquivos, então o login
--    continuava preso. `owner`/`owner_id` são colunas anuláveis, então o
--    arquivo NÃO é apagado — ele só deixa de ter dono, que é o certo: anexo de
--    processo não some porque quem subiu saiu da empresa.
--
--    Os demais schemas internos continuam de fora: `auth` cuida das próprias
--    FKs com CASCADE, e `realtime`/`vault`/`net`/etc. não têm o que limpar.
--
-- 2) A RPC passa a apagar auth.users ela mesma, e quando o banco recusa ela
--    devolve SCHEMA_NAME, TABLE_NAME e CONSTRAINT_NAME do erro real
--    (GET STACKED DIAGNOSTICS). Assim, se sobrar qualquer outro bloqueio, a
--    tarja vermelha da tela diz o nome da tabela em vez de "Database error
--    deleting user".
--
--    Se o papel que executa a função não tiver permissão em auth.users, isso
--    não é erro: a RPC devolve `auth_removido = false` com o motivo, e a Edge
--    Function segue apagando pelo GoTrue como antes.
--
-- COMO APLICAR: SQL Editor do projeto remoto. Roda sozinha e é idempotente —
-- é só um CREATE OR REPLACE de função, sem DDL em tabela, sem lock pesado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_excluir_usuario_completo(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r              record;
  v_afetadas     bigint;
  v_passe        int    := 0;
  v_no_passe     bigint;
  v_total        bigint := 0;
  v_limpou       jsonb  := '{}'::jsonb;
  v_falhas       jsonb  := '[]'::jsonb;
  v_chave        text;
  v_existia      boolean;
  v_auth_ok      boolean := false;
  v_bloqueio     jsonb   := NULL;
  v_err_schema   text;
  v_err_table    text;
  v_err_constr   text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id é obrigatório';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_existia;

  -- ---------------------------------------------------------------- varredura
  -- Passes: cada passe zera/apaga o que aponta pro usuário. Um gatilho de
  -- auditoria pode criar referência nova durante o passe (foi o caso do
  -- plano_acao_history_trg), então repete até um passe não mexer em nada.
  LOOP
    v_passe    := v_passe + 1;
    v_no_passe := 0;

    FOR r IN
      SELECT nc.nspname   AS esquema,
             tc.relname   AS tabela,
             a.attname    AS coluna,
             a.attnotnull AS obrigatoria
        FROM pg_constraint c
        JOIN pg_class     tc ON tc.oid = c.conrelid
        JOIN pg_namespace nc ON nc.oid = tc.relnamespace
        JOIN pg_class     tp ON tp.oid = c.confrelid
        JOIN pg_namespace np ON np.oid = tp.relnamespace
        JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND cardinality(c.conkey) = 1
         AND tc.relkind IN ('r', 'p')
         AND (   (np.nspname = 'public' AND tp.relname = 'profiles')
              OR (np.nspname = 'auth'   AND tp.relname = 'users'))
         -- `storage` saiu desta lista de propósito (ver cabeçalho): é onde
         -- mora storage.objects.owner, que prendia o login de quem já tinha
         -- subido foto de perfil ou anexo.
         AND nc.nspname NOT IN ('auth', 'realtime', 'vault', 'cron',
                                'extensions', 'graphql', 'graphql_public',
                                'pgsodium', 'pgsodium_masks', 'net',
                                'supabase_functions', 'supabase_migrations',
                                '_analytics', 'pgbouncer')
    LOOP
      v_chave := r.esquema || '.' || r.tabela || '.' || r.coluna;
      BEGIN
        IF r.obrigatoria THEN
          -- Sem como zerar: a linha só existe por causa deste usuário.
          EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
                         r.esquema, r.tabela, r.coluna)
            USING p_user_id;
        ELSE
          EXECUTE format('UPDATE %I.%I SET %I = NULL WHERE %I = $1',
                         r.esquema, r.tabela, r.coluna, r.coluna)
            USING p_user_id;
        END IF;
        GET DIAGNOSTICS v_afetadas = ROW_COUNT;

        IF v_afetadas > 0 THEN
          v_no_passe := v_no_passe + v_afetadas;
          v_total    := v_total + v_afetadas;
          v_limpou   := jsonb_set(
            v_limpou,
            ARRAY[v_chave],
            to_jsonb(COALESCE((v_limpou ->> v_chave)::bigint, 0) + v_afetadas));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_falhas := v_falhas || jsonb_build_object('alvo', v_chave, 'erro', SQLERRM);
      END;
    END LOOP;

    EXIT WHEN v_no_passe = 0 OR v_passe >= 5;
  END LOOP;

  -- ------------------------------------------------------------------ cadastro
  DELETE FROM public.profiles WHERE id = p_user_id;

  -- --------------------------------------------------------------------- login
  -- Apagar aqui, e não só pelo GoTrue, é o que permite dizer QUEM barrou:
  -- GET STACKED DIAGNOSTICS devolve o schema, a tabela e a constraint do erro.
  -- Falta de permissão em auth.users não é erro — a Edge Function segue pelo
  -- GoTrue, como sempre fez.
  BEGIN
    DELETE FROM auth.users WHERE id = p_user_id;
    v_auth_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_err_schema = SCHEMA_NAME,
      v_err_table  = TABLE_NAME,
      v_err_constr = CONSTRAINT_NAME;
    v_bloqueio := jsonb_build_object(
      'sqlstate',   SQLSTATE,
      'erro',       SQLERRM,
      'schema',     v_err_schema,
      'tabela',     v_err_table,
      'constraint', v_err_constr);
  END;

  RETURN jsonb_build_object(
    'ok',             true,
    'perfil_existia', v_existia,
    'passes',         v_passe,
    'vinculos',       v_total,
    'limpou',         v_limpou,
    'falhas',         v_falhas,
    'auth_removido',  v_auth_ok,
    'bloqueio',       v_bloqueio
  );
END
$fn$;

COMMENT ON FUNCTION public.admin_excluir_usuario_completo(uuid) IS
  'Apaga perfil e login zerando/removendo antes todo vínculo que aponte pra eles '
  '(varre pg_constraint em tempo de execução, incluindo storage.objects.owner, '
  'então cobre tabela nova sem manutenção). Quando o banco recusa o DELETE em '
  'auth.users, devolve em "bloqueio" a tabela e a constraint responsáveis, em vez '
  'do "Database error deleting user" genérico do GoTrue. Só service_role executa — '
  'quem chama é a Edge Function admin-delete-user, que valida can_access antes.';

REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario_completo(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK — volta a função pra versão de 20260930000083 (sem storage, sem
-- apagar auth.users). Reexecutar aquele arquivo tem o mesmo efeito.
-- ============================================================================
