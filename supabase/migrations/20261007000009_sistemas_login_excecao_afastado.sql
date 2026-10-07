-- =========================================================================
-- SISTEMAS › LOGINS — exceção para AFASTADO (férias, licença…) (07/10/2026)
--
-- PEDIDO (Pablo): "deixa abrir exceção no sistema, pra liberar os que estão
-- de férias ou licença maternidade etc. Tem que aparecer lá o status >
-- Travado por > Licença maternidade, e opção de liberar e informar o porquê."
--
-- REGRA (em cima da mig 20261007000007)
--   · Sistemas pode LIBERAR o login de quem está travado por afastamento
--     (qualquer situação que não libera e não é desligamento). Motivo
--     obrigatório. DEMITIDO continua sem exceção — "desabilita e pronto".
--   · A liberação vale para a situação em que foi dada: fica gravada
--     (SIS_LOGIN_DESLIGAMENTO.situacao) e só vale enquanto o cadastro
--     vinculado estiver nessa mesma situação. Voltou a Trabalhando → nem
--     precisa; entrou em outro afastamento ou foi demitido → trava de novo.
--   · "Travar de novo" desfaz a liberação (vira ciência, acao 'ciente').
--
-- O QUE MUDA
--   · erp_login_travado(user): a regra pura da situação (a antiga
--     erp_login_bloqueado da mig 20261007000007).
--   · erp_login_excecao_vigente(user): liberação válida agora.
--   · erp_login_bloqueado(user) = travado E sem exceção vigente.
--   · sis_logins_bloqueados() passa a listar TODOS os travados, com a
--     liberação (se houver) — a tela mostra "Travado por <situação>" ou
--     "Liberado". Muda o retorno → DROP + CREATE (tela nova ainda não
--     publicada).
--   · sis_login_liberar(user, motivo) / sis_login_travar(user).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" DROP CONSTRAINT IF EXISTS "SIS_LOGIN_DESLIGAMENTO_acao_check";
ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" ADD CONSTRAINT "SIS_LOGIN_DESLIGAMENTO_acao_check"
  CHECK (acao IN ('excluido', 'mantido', 'ciente', 'liberado'));

-- ── Regra pura da situação (sem exceção) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_login_travado(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- duas buscas separadas (sem OR na junção) para cada uma usar o seu índice:
  -- isto roda em TODA checagem de acesso (has_screen_access).
  SELECT _user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e.auth_user_id = _user)
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                      WHERE e.auth_user_id = _user AND public.erp_situacao_libera_login(e."Situação"))
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                       JOIN public."EMPREGADOS" x ON x."CPF" = e."CPF"
                      WHERE e.auth_user_id = _user AND e."CPF" IS NOT NULL
                        AND public.erp_situacao_libera_login(x."Situação"));
$$;

-- ── Exceção válida agora: liberada para a situação atual, e não é desligamento
CREATE OR REPLACE FUNCTION public.erp_login_excecao_vigente(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."SIS_LOGIN_DESLIGAMENTO" d
      JOIN public."EMPREGADOS" e ON e.auth_user_id = d.auth_user_id
     WHERE d.auth_user_id = _user AND d.acao = 'liberado'
       AND d.situacao IS NOT DISTINCT FROM e."Situação"
       AND btrim(coalesce(e."Situação", '')) !~* '^(DEMIT|DESLIG|RESCIS)');
$$;

CREATE OR REPLACE FUNCTION public.erp_login_bloqueado(_user uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- 07/10/2026 (migs 20261007000007 e 09): pela situação, pelo CPF; afastado
  -- pode ter exceção liberada por Sistemas; desligado não. A exceção só é
  -- olhada para quem está travado — roda em TODA checagem de acesso.
  IF NOT public.erp_login_travado(_user) THEN RETURN false; END IF;
  RETURN NOT public.erp_login_excecao_vigente(_user);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['erp_login_travado(uuid)', 'erp_login_excecao_vigente(uuid)', 'erp_login_bloqueado(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ── Lista da tela: todos os travados, com a liberação ────────────────────
DROP FUNCTION IF EXISTS public.sis_logins_bloqueados();
CREATE FUNCTION public.sis_logins_bloqueados()
RETURNS TABLE(empregado_id bigint, auth_user_id uuid, nome text, cargo text, contrato text, empresa text,
              situacao text, desde date, desligado boolean, login_email text, ultimo_acesso timestamptz,
              ciente boolean, ciente_em timestamptz, ciente_por text,
              liberado boolean, liberado_motivo text, liberado_em timestamptz, liberado_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('visualizar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH t AS (
    SELECT e.*, u.id uid, u.email::text uemail, u.last_sign_in_at, d.acao, d.situacao dsit, d.obs, d.tratado_em, d.tratado_por_nome,
           (btrim(coalesce(e."Situação", '')) ~* '^(DEMIT|DESLIG|RESCIS)') desl,
           public.erp_login_excecao_vigente(u.id) lib
      FROM public."EMPREGADOS" e
      JOIN auth.users u ON u.id = e.auth_user_id
      LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = u.id
     WHERE public.erp_login_travado(u.id)
  )
  SELECT t."ID"::bigint, t.uid, t."Nome"::text, t."Título do Cargo"::text, t."Nome Filial"::text, t."Nome da Empresa"::text,
         t."Situação"::text, public.data_universal(t."Data Afastamento"::text), t.desl, t.uemail, t.last_sign_in_at,
         (t.acao = 'ciente' AND t.dsit IS NOT DISTINCT FROM t."Situação") IS TRUE,
         CASE WHEN t.acao = 'ciente' AND t.dsit IS NOT DISTINCT FROM t."Situação" THEN t.tratado_em END,
         CASE WHEN t.acao = 'ciente' AND t.dsit IS NOT DISTINCT FROM t."Situação" THEN t.tratado_por_nome END,
         t.lib,
         CASE WHEN t.lib THEN t.obs END, CASE WHEN t.lib THEN t.tratado_em END, CASE WHEN t.lib THEN t.tratado_por_nome END
    FROM t
   ORDER BY t.lib, (t.acao = 'ciente' AND t.dsit IS NOT DISTINCT FROM t."Situação") IS TRUE,
            public.data_universal(t."Data Afastamento"::text) DESC NULLS LAST, t."Nome";
END $$;

-- ── Liberar (exceção) / travar de novo ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.sis_login_liberar(p_auth_user_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quem text; v_emp bigint; v_sit text;
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo da liberação.'; END IF;
  SELECT e."ID", e."Situação" INTO v_emp, v_sit FROM public."EMPREGADOS" e WHERE e.auth_user_id = p_auth_user_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Login sem colaborador vinculado.'; END IF;
  IF btrim(coalesce(v_sit, '')) ~* '^(DEMIT|DESLIG|RESCIS)' THEN
    RAISE EXCEPTION 'Desligado não tem exceção: o login de quem foi demitido fica bloqueado.';
  END IF;
  IF NOT public.erp_login_travado(p_auth_user_id) THEN RAISE EXCEPTION 'Este login não está travado.'; END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."SIS_LOGIN_DESLIGAMENTO" (auth_user_id, empregado_id, acao, situacao, obs, tratado_por, tratado_por_nome)
  VALUES (p_auth_user_id, v_emp, 'liberado', v_sit, btrim(p_motivo), auth.uid(), v_quem)
  ON CONFLICT (auth_user_id) DO UPDATE SET empregado_id = EXCLUDED.empregado_id, acao = 'liberado', situacao = EXCLUDED.situacao,
    obs = EXCLUDED.obs, tratado_por = EXCLUDED.tratado_por, tratado_por_nome = EXCLUDED.tratado_por_nome, tratado_em = now();
END $$;

CREATE OR REPLACE FUNCTION public.sis_login_travar(p_auth_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  -- Desfaz a liberação; fica como "visto" para não voltar a acender a bolinha.
  PERFORM public.sis_login_bloqueio_ciente(p_auth_user_id);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['sis_logins_bloqueados()', 'sis_login_liberar(uuid, text)', 'sis_login_travar(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- erp_login_bloqueado: reaplicar a da mig 20261007000007 (sem exceção).
-- sis_logins_bloqueados: reaplicar a da mig 20261007000007 (DROP + CREATE, retorno antigo).
-- DROP FUNCTION IF EXISTS public.sis_login_liberar(uuid, text), public.sis_login_travar(uuid),
--   public.erp_login_excecao_vigente(uuid), public.erp_login_travado(uuid);
-- UPDATE "SIS_LOGIN_DESLIGAMENTO" SET acao = 'ciente' WHERE acao = 'liberado';  (antes de voltar o CHECK)
