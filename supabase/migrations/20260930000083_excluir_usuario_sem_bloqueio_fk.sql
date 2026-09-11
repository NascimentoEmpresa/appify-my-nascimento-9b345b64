-- ============================================================================
-- Excluir usuário sem esbarrar em foreign key
-- ----------------------------------------------------------------------------
-- POR QUÊ (incidente 11/09/2026, /app/administracao?tab=usuarios):
--   Excluir a usuária CAROLINE PRISCO LOPES devolvia 500 no admin-delete-user:
--     insert or update on table "plano_acao_historico"
--     violates foreign key constraint "plano_acao_historico_criado_por_fkey"
--
--   Repare que a mensagem é do lado FILHO ("insert or update"), não do lado pai
--   ("update or delete on table profiles"). Isso não é um simples "tem linha
--   filha apontando pro perfil" — é uma reação em cadeia dentro do próprio
--   DELETE:
--     1. DELETE FROM profiles dispara as ações de FK das colunas de plano_acao
--        que apontam pro perfil;
--     2. esse UPDATE em plano_acao dispara plano_acao_history_trg, que INSERE
--        uma linha em plano_acao_historico com criado_por = NEW.atualizado_por;
--     3. se atualizado_por era justamente o usuário sendo excluído, essa linha
--        NOVA aponta pra um perfil que já não existe — e a checagem de FK, que
--        roda no fim do comando, estoura.
--   Ou seja: mesmo trocando todas as FKs pra ON DELETE SET NULL, o DELETE
--   direto continuaria falhando, porque o gatilho cria referência nova no meio
--   do caminho. Por isso a correção tem DUAS partes: arrumar as FKs (seções 1
--   e 2) E limpar os vínculos ANTES do DELETE, em passes até convergir (3).
--
-- O QUE MUDA:
--   1) Toda FK de coluna única apontando pra public.profiles(id) ou
--      auth.users(id) que hoje é NO ACTION/RESTRICT vira:
--        - ON DELETE CASCADE  -> quando a coluna faz parte da PK, ou é a coluna
--          "dona" da linha e é NOT NULL (user_id/usuario_id/profile_id/...).
--          Nesses casos a linha só existe por causa daquele usuário
--          (user_roles, user_empresa, reuniao_convidado, notificações...);
--        - ON DELETE SET NULL -> todo o resto (criado_por, autor_id,
--          solicitante_id, responsavel_*, atualizado_por, aprovado_por...).
--          O registro de negócio SOBREVIVE, só perde o nome de quem fez.
--      Coluna NOT NULL que cai no SET NULL perde o NOT NULL — de propósito.
--   2) As constraints entram NOT VALID e são validadas num bloco separado
--      (VALIDATE pega lock fraco, não trava leitura/escrita).
--   3) RPC admin_excluir_usuario_completo(uuid): varre o catálogo em tempo de
--      execução, zera/apaga todo vínculo e só então apaga o perfil. Como lê
--      pg_constraint na hora, também cobre tabela criada DEPOIS desta migration
--      (inclusive as que o Lovable regenerar) sem precisar de manutenção.
--
-- COMO APLICAR: SQL Editor do projeto remoto (migration não se auto-aplica).
--   Rodar em horário de baixo movimento: a seção 1 pega ACCESS EXCLUSIVE por
--   alguns instantes em cada tabela filha. É idempotente — se der deadlock
--   transitório, rodar de novo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Reescreve as FKs que apontam pra profiles/auth.users
-- ----------------------------------------------------------------------------
DO $mig$
DECLARE
  r      record;
  v_acao text;
  v_pk   boolean;
  -- Nomes de coluna que significam "esta linha É deste usuário" (e não
  -- "este usuário mexeu nesta linha"). Só estes viram CASCADE, e ainda assim
  -- apenas quando NOT NULL — coluna opcional não define a dona da linha.
  v_colunas_dono constant text[] := ARRAY[
    'user_id', 'usuario_id', 'profile_id', 'perfil_id', 'profile_user_id',
    'destinatario_id', 'destinatario_user_id', 'para_user_id'
  ];
BEGIN
  FOR r IN
    SELECT c.conname,
           nc.nspname   AS esquema,
           tc.relname   AS tabela,
           a.attname    AS coluna,
           a.attnotnull AS obrigatoria,
           np.nspname   AS pai_esquema,
           tp.relname   AS pai_tabela,
           af.attname   AS pai_coluna,
           c.conrelid
      FROM pg_constraint c
      JOIN pg_class     tc ON tc.oid = c.conrelid
      JOIN pg_namespace nc ON nc.oid = tc.relnamespace
      JOIN pg_class     tp ON tp.oid = c.confrelid
      JOIN pg_namespace np ON np.oid = tp.relnamespace
      JOIN pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
     WHERE c.contype = 'f'
       AND cardinality(c.conkey) = 1
       AND c.confdeltype IN ('a', 'r')            -- NO ACTION / RESTRICT
       AND c.conparentid = 0                      -- ignora FK herdada de partição
       AND tc.relkind IN ('r', 'p')
       AND (   (np.nspname = 'public' AND tp.relname = 'profiles')
            OR (np.nspname = 'auth'   AND tp.relname = 'users'))
       AND nc.nspname NOT IN ('auth', 'storage', 'realtime', 'vault', 'cron',
                              'extensions', 'graphql', 'graphql_public',
                              'pgsodium', 'pgsodium_masks', 'net',
                              'supabase_functions', 'supabase_migrations',
                              '_analytics', 'pgbouncer')
     ORDER BY nc.nspname, tc.relname, a.attname
  LOOP
    -- Coluna que faz parte da PK não pode ficar nula: a linha inteira é do
    -- usuário, então ela vai junto.
    SELECT EXISTS (
      SELECT 1
        FROM pg_constraint pk
       WHERE pk.conrelid = r.conrelid
         AND pk.contype  = 'p'
         AND (SELECT a2.attnum
                FROM pg_attribute a2
               WHERE a2.attrelid = r.conrelid
                 AND a2.attname  = r.coluna) = ANY (pk.conkey)
    ) INTO v_pk;

    IF v_pk OR (r.obrigatoria AND r.coluna = ANY (v_colunas_dono)) THEN
      v_acao := 'CASCADE';
    ELSE
      v_acao := 'SET NULL';
    END IF;

    -- Uma tabela que resista (coluna em replica identity, lock ocupado, etc.)
    -- não pode derrubar as outras 200 — anota e segue. A RPC da seção 3 cobre
    -- o que sobrar, porque ela limpa antes de apagar em vez de depender do
    -- ON DELETE.
    BEGIN
      IF v_acao = 'SET NULL' AND r.obrigatoria THEN
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
                       r.esquema, r.tabela, r.coluna);
      END IF;

      EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
                     r.esquema, r.tabela, r.conname);
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
        || 'REFERENCES %I.%I(%I) ON DELETE %s NOT VALID',
        r.esquema, r.tabela, r.conname, r.coluna,
        r.pai_esquema, r.pai_tabela, r.pai_coluna, v_acao);

      RAISE NOTICE 'FK %.%(%) -> %.% agora ON DELETE %',
        r.esquema, r.tabela, r.coluna, r.pai_esquema, r.pai_tabela, v_acao;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'FK %.%(%) NAO convertida: %',
        r.esquema, r.tabela, r.coluna, SQLERRM;
    END;
  END LOOP;
END
$mig$;

-- ----------------------------------------------------------------------------
-- 2) Valida as constraints recriadas
--    Os dados já satisfaziam a constraint antiga (idêntica, só sem ON DELETE),
--    então o VALIDATE é formalidade. Se o script estourar o tempo do SQL
--    Editor, este bloco pode ser rodado sozinho depois — deixar NOT VALID não
--    afeta o ON DELETE nem a checagem de linha nova.
-- ----------------------------------------------------------------------------
DO $val$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, nc.nspname AS esquema, tc.relname AS tabela
      FROM pg_constraint c
      JOIN pg_class     tc ON tc.oid = c.conrelid
      JOIN pg_namespace nc ON nc.oid = tc.relnamespace
      JOIN pg_class     tp ON tp.oid = c.confrelid
      JOIN pg_namespace np ON np.oid = tp.relnamespace
     WHERE c.contype = 'f'
       AND NOT c.convalidated
       AND nc.nspname = 'public'
       AND (   (np.nspname = 'public' AND tp.relname = 'profiles')
            OR (np.nspname = 'auth'   AND tp.relname = 'users'))
  LOOP
    EXECUTE format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
                   r.esquema, r.tabela, r.conname);
  END LOOP;
END
$val$;

-- ----------------------------------------------------------------------------
-- 3) RPC de exclusão: limpa os vínculos ANTES de apagar o perfil
-- ----------------------------------------------------------------------------
-- Passes: cada passe zera/apaga o que aponta pro usuário. Um gatilho de
-- auditoria pode criar referência nova durante o passe (foi exatamente o que
-- plano_acao_history_trg fez no incidente), então repete até um passe não
-- mexer em nada — no máximo 5, pra nunca girar pra sempre.
--
-- Cada comando vai num bloco com EXCEPTION próprio: se um gatilho de guarda
-- barrar uma tabela, a exclusão continua e o relatório devolvido diz qual
-- tabela barrou e por quê, em vez de um 500 sem explicação.
CREATE OR REPLACE FUNCTION public.admin_excluir_usuario_completo(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r          record;
  v_afetadas bigint;
  v_passe    int    := 0;
  v_no_passe bigint;
  v_total    bigint := 0;
  v_limpou   jsonb  := '{}'::jsonb;
  v_falhas   jsonb  := '[]'::jsonb;
  v_chave    text;
  v_existia  boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id é obrigatório';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_existia;

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
         AND nc.nspname NOT IN ('auth', 'storage', 'realtime', 'vault', 'cron',
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

  DELETE FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok',             true,
    'perfil_existia', v_existia,
    'passes',         v_passe,
    'vinculos',       v_total,
    'limpou',         v_limpou,
    'falhas',         v_falhas
  );
END
$fn$;

COMMENT ON FUNCTION public.admin_excluir_usuario_completo(uuid) IS
  'Apaga um perfil zerando/removendo antes todo vínculo que aponte pra ele '
  '(varre pg_constraint em tempo de execução, então cobre tabela nova sem '
  'manutenção). Só service_role executa — quem chama é a Edge Function '
  'admin-delete-user, que valida can_access do chamador antes.';

REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario_completo(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
--   A seção 1 não tem volta automática: as FKs anteriores eram NO ACTION e o
--   catálogo não guarda o estado antigo depois de reescrito. Na prática, para
--   voltar ao comportamento antigo basta soltar a RPC — o bloqueio volta a
--   depender só das FKs.
--
-- DROP FUNCTION IF EXISTS public.admin_excluir_usuario_completo(uuid);
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
