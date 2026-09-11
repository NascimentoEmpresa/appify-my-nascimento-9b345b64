-- ============================================================================
-- Excluir usuário: regra de negócio deixa de barrar a faxina
-- ----------------------------------------------------------------------------
-- Terceira e última trava da série 20260930000083 / 20260930000092. Diagnóstico
-- rodado em produção em 11/09/2026, com o motivo exato na mão:
--
--   SQLSTATE P0001 — "Sem permissão para coordenar/editar este chamado."
--   alvo: public.CHAMADO_SISTEMA.solicitante_id
--
--   SQLSTATE P0001 — "Esta NF já foi concluida pelo Financeiro e não pode mais
--                     ser alterada."
--   alvo: public.nf_emissao.created_by / updated_by
--
-- P0001 é RAISE EXCEPTION: regra de negócio, não chave estrangeira. A corrente:
-- apagar o login obriga o banco a zerar CHAMADO_SISTEMA.solicitante_id (a FK é
-- ON DELETE SET NULL); zerar é um UPDATE; o UPDATE acorda chamado_sistema_guard(),
-- que decide por auth.uid(); quem roda a exclusão é o servidor, sem sessão, então
-- auth.uid() é NULL, nenhuma permissão confere, e o guard recusa. Tudo volta.
--
-- O guard não existe pra isso. Ele existe pra impedir que um usuário comum edite
-- o chamado dos outros. Ele só não sabe separar "usuário tentando burlar" de
-- "sistema fazendo faxina depois que a pessoa saiu da empresa".
--
-- ESTE PROJETO JÁ DECIDIU ISSO UMA VEZ. Em 20260901000006_chamado_guard_service_role.sql,
-- pro mesmo guard, pelo mesmo motivo (automação sem sessão), com a justificativa:
--
--   "quem tem a service_role já pode alterar qualquer linha, desabilitar o
--    trigger ou o próprio RLS. A checagem existe para proteger o usuário
--    logado, não para conter o servidor."
--
-- Só que aquela liberação entrou apenas no bloco de troca de status. O bloco que
-- protege solicitante_id ficou de fora — e é por ele que a exclusão passa.
--
-- DUAS CAMADAS:
--
-- 1) SINAL EXPLÍCITO. A RPC marca `app.exclusao_usuario = on` (escopo de
--    transação, some sozinho no fim) e chamado_sistema_guard() passa a respeitar
--    essa marca. É mais estreito que o v_auto de 20260901000006: vale só dentro
--    da exclusão de usuário, não pra qualquer coisa que use service_role. E é
--    rastreável — dá pra procurar quem lê essa marca.
--
-- 2) REDE DE SEGURANÇA GENÉRICA. Se qualquer outro guard barrar — como o da
--    nf_emissao, que nem está versionado neste repositório —, a limpeza repete
--    o comando com os gatilhos de negócio daquela tabela desligados, e religa
--    logo em seguida, tudo dentro da mesma transação. Se a segunda tentativa
--    também falhar, o desligamento é desfeito junto com ela.
--
--    A decisão de política, dita com todas as letras: NA EXCLUSÃO DE USUÁRIO,
--    REGRA DE NEGÓCIO NÃO TEM VOTO. Ela protege a operação do dia a dia; não
--    cabe a ela decidir se alguém que saiu da empresa continua no sistema.
--    Nada é apagado por causa disso — só o nome do autor sai do registro.
--
--    Ressalva registrada: ENABLE TRIGGER USER religa TODOS os gatilhos de
--    usuário da tabela. Se algum estivesse desligado de propósito antes, ele
--    volta ligado. Em 700+ migrations não há caso assim, mas fica o aviso.
--
-- COMO APLICAR: SQL Editor do projeto remoto. Só troca corpo de função — sem
-- DDL em tabela, sem lock pesado. Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) O guard do chamado passa a reconhecer a faxina de usuário
--    Corpo idêntico ao de 20260901000006, com a saída antecipada no começo.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Faxina de exclusão de usuário (admin_excluir_usuario_completo).
  v_faxina boolean := COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false);
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  v_coord boolean;
  v_aprov boolean;
  v_resp  boolean;
BEGIN
  -- A faxina não é alguém editando o chamado: é o sistema tirando o nome de
  -- quem saiu da empresa. Nenhum campo de negócio muda — só as colunas que
  -- apontam pro usuário, e por ação de chave estrangeira. Os automatismos de
  -- status continuam valendo.
  IF v_faxina THEN
    IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
    IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
    RETURN NEW;
  END IF;

  v_coord := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  := COALESCE(OLD.responsavel_id = auth.uid(), false);

  -- Campos de abertura + coordenação só mudam com "coordenar".
  IF NOT v_coord THEN
    IF NEW.assunto              IS DISTINCT FROM OLD.assunto
    OR NEW.categorias           IS DISTINCT FROM OLD.categorias
    OR NEW.tipo_solicitacao     IS DISTINCT FROM OLD.tipo_solicitacao
    OR NEW.prioridade           IS DISTINCT FROM OLD.prioridade
    OR NEW.descricao            IS DISTINCT FROM OLD.descricao
    OR NEW.impacto_trabalho     IS DISTINCT FROM OLD.impacto_trabalho
    OR NEW.urgencia             IS DISTINCT FROM OLD.urgencia
    OR NEW.modulo_sistema       IS DISTINCT FROM OLD.modulo_sistema
    OR NEW.modulo_sistema_outro IS DISTINCT FROM OLD.modulo_sistema_outro
    OR NEW.afeta_usuarios       IS DISTINCT FROM OLD.afeta_usuarios
    OR NEW.solicitante_id       IS DISTINCT FROM OLD.solicitante_id
    OR NEW.solicitante_nome     IS DISTINCT FROM OLD.solicitante_nome
    OR NEW.setor                IS DISTINCT FROM OLD.setor
    OR NEW.responsavel_id       IS DISTINCT FROM OLD.responsavel_id
    OR NEW.observacao_gerente   IS DISTINCT FROM OLD.observacao_gerente
    OR NEW.comentario_gerente   IS DISTINCT FROM OLD.comentario_gerente THEN
      RAISE EXCEPTION 'Sem permissão para coordenar/editar este chamado.';
    END IF;
  END IF;

  -- Reprovar/motivo só com "aprovar".
  IF (NEW.status = 'reprovado' AND OLD.status <> 'reprovado') AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;
  IF NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;

  -- Demais mudanças de status: coordenar, aprovar, o dev responsável OU a
  -- automação de servidor (conclusão no merge da PR).
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) A faxina, com a rede de segurança
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_excluir_usuario_completo(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  r            record;
  v_sql        text;
  v_ok         boolean;
  v_erro       text;
  v_afetadas   bigint;
  v_passe      int    := 0;
  v_no_passe   bigint;
  v_total      bigint := 0;
  v_limpou     jsonb  := '{}'::jsonb;
  v_falhas     jsonb  := '[]'::jsonb;
  v_forcadas   jsonb  := '[]'::jsonb;
  v_chave      text;
  v_existia    boolean;
  v_auth_ok    boolean := false;
  v_bloqueio   jsonb   := NULL;
  v_err_schema text;
  v_err_table  text;
  v_err_constr text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id é obrigatório';
  END IF;

  -- Marca a transação como faxina. Escopo local: some sozinha no COMMIT/ROLLBACK,
  -- então não vaza pra nenhuma outra operação da mesma conexão.
  PERFORM set_config('app.exclusao_usuario', 'on', true);

  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) INTO v_existia;

  -- ---------------------------------------------------------------- varredura
  -- Passes até convergir: um gatilho de auditoria pode criar referência nova
  -- durante o passe (foi o que plano_acao_history_trg fez no primeiro incidente).
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
         AND nc.nspname NOT IN ('auth', 'realtime', 'vault', 'cron',
                                'extensions', 'graphql', 'graphql_public',
                                'pgsodium', 'pgsodium_masks', 'net',
                                'supabase_functions', 'supabase_migrations',
                                '_analytics', 'pgbouncer')
    LOOP
      v_chave    := r.esquema || '.' || r.tabela || '.' || r.coluna;
      v_afetadas := 0;
      v_ok       := false;
      v_erro     := NULL;

      IF r.obrigatoria THEN
        -- Sem como zerar: a linha só existe por causa deste usuário.
        v_sql := format('DELETE FROM %I.%I WHERE %I = $1', r.esquema, r.tabela, r.coluna);
      ELSE
        v_sql := format('UPDATE %I.%I SET %I = NULL WHERE %I = $1',
                        r.esquema, r.tabela, r.coluna, r.coluna);
      END IF;

      -- 1ª tentativa: do jeito normal, com todos os gatilhos ligados.
      BEGIN
        EXECUTE v_sql USING p_user_id;
        GET DIAGNOSTICS v_afetadas = ROW_COUNT;
        v_ok := true;
      EXCEPTION WHEN OTHERS THEN
        v_erro := SQLERRM;
      END;

      -- 2ª tentativa: a rede de segurança. Desliga os gatilhos de negócio desta
      -- tabela só pelo tempo do comando. Se esta também falhar, o bloco inteiro
      -- volta atrás — inclusive o desligamento.
      IF NOT v_ok THEN
        BEGIN
          EXECUTE format('ALTER TABLE %I.%I DISABLE TRIGGER USER', r.esquema, r.tabela);
          EXECUTE v_sql USING p_user_id;
          GET DIAGNOSTICS v_afetadas = ROW_COUNT;
          EXECUTE format('ALTER TABLE %I.%I ENABLE TRIGGER USER', r.esquema, r.tabela);
          v_ok := true;
          IF v_afetadas > 0 THEN
            v_forcadas := v_forcadas || jsonb_build_object('alvo', v_chave, 'guard', v_erro);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_falhas := v_falhas || jsonb_build_object(
            'alvo', v_chave, 'erro', v_erro, 'erro_2a_tentativa', SQLERRM);
        END;
      END IF;

      IF v_ok AND v_afetadas > 0 THEN
        v_no_passe := v_no_passe + v_afetadas;
        v_total    := v_total + v_afetadas;
        v_limpou   := jsonb_set(
          v_limpou, ARRAY[v_chave],
          to_jsonb(COALESCE((v_limpou ->> v_chave)::bigint, 0) + v_afetadas));
      END IF;
    END LOOP;

    EXIT WHEN v_no_passe = 0 OR v_passe >= 5;
  END LOOP;

  -- ------------------------------------------------------------------ cadastro
  BEGIN
    DELETE FROM public.profiles WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
    EXECUTE 'ALTER TABLE public.profiles DISABLE TRIGGER USER';
    DELETE FROM public.profiles WHERE id = p_user_id;
    EXECUTE 'ALTER TABLE public.profiles ENABLE TRIGGER USER';
    v_forcadas := v_forcadas || jsonb_build_object('alvo', 'public.profiles', 'guard', v_erro);
  END;

  -- --------------------------------------------------------------------- login
  -- Depois da varredura não deve sobrar nada apontando pro login, então aqui o
  -- DELETE é só a formalidade. Se ainda assim recusar, devolve o motivo com
  -- nome e código em vez do "Database error deleting user" do GoTrue.
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
    'forcadas',       v_forcadas,
    'auth_removido',  v_auth_ok,
    'bloqueio',       v_bloqueio
  );
END
$fn$;

COMMENT ON FUNCTION public.admin_excluir_usuario_completo(uuid) IS
  'Apaga perfil e login zerando/removendo antes todo vínculo que aponte pra eles. '
  'Varre pg_constraint em tempo de execução, então cobre tabela nova sem manutenção. '
  'Marca a transação com app.exclusao_usuario=on e, se um guard de negócio ainda '
  'barrar, repete o comando com os gatilhos daquela tabela desligados pelo tempo '
  'do comando (devolvido em "forcadas"). Só service_role executa — quem chama é a '
  'Edge Function admin-delete-user, que valida can_access antes.';

REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_excluir_usuario_completo(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_excluir_usuario_completo(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
--   Reexecutar 20260901000006_chamado_guard_service_role.sql devolve o guard ao
--   estado anterior, e 20260930000092_excluir_usuario_storage_e_login.sql
--   devolve a faxina sem a rede de segurança.
-- ============================================================================
