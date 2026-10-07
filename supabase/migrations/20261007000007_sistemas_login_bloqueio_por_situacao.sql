-- =========================================================================
-- SISTEMAS › LOGINS — login da ERP bloqueado AUTOMATICAMENTE por situação
-- na Senior, sem exceção (07/10/2026)
--
-- PEDIDO (Pablo): "não só Já excluí, tem que desabilitar o login
-- automaticamente: se o usuário tá demitido, desabilita o login da ERP e
-- pronto. Só deixa um botão de OK. O sistema vai puxar o CPF do colaborador
-- se está como trabalhando ou não; se estiver de atestado OK, férias não
-- pode acessar também, afastamentos longos não podem deixar o usuário
-- entrar, tipo aux. doença etc."
--
-- REGRA (erp_login_bloqueado, usada por has_screen_access desde a mig
-- 20261006160000 — régua de toda a RLS de tela e dos menus):
--   · Usuário SEM cadastro vinculado na EMPREGADOS → nada muda (admin
--     antigo, externo, automação).
--   · Com vínculo: junta TODOS os cadastros do mesmo CPF (quem tem dois
--     vínculos e um está Trabalhando continua entrando). Libera se algum
--     deles está numa situação que libera (erp_situacao_libera_login):
--       Trabalhando · Atestado (dias, filho, noturno, acidente…) ·
--       Aviso Prévio Trabalhado.
--     Qualquer outra bloqueia: Férias, Auxílio Doença, Licença
--     Maternidade/Paternidade, Aposentadoria, Cárcere, Demitido…
--   · ACABA a exceção "mantido" (SIS_LOGIN_DESLIGAMENTO) — era o botão
--     "Manter". Medido em 07/10: 1 caso (MILENY DE OLIVEIRA DA ROSA,
--     demitida 28/09, "Foi promoção") passa a ficar bloqueado até a nova
--     admissão aparecer na Senior — aí o CPF libera sozinho.
--   · Passam a ficar bloqueados em 07/10: 5 de Férias, 4 de Licença
--     Maternidade e 1 de Auxílio Doença (com login). Voltando a
--     Trabalhando na Senior, o acesso volta sozinho no próximo sync.
--
-- TELA (Sistemas › Logins): a aba vira "Logins bloqueados" — todos os
-- bloqueados, com o motivo (situação), e um botão OK que só registra a
-- ciência (acao 'ciente', com a situação vista). Se a situação mudar (ex.:
-- voltou das férias e depois foi demitido), aparece de novo.
-- sis_logins_demitidos / sis_login_desligamento_tratar continuam existindo
-- para a tela antiga até a publicação; 'mantido' não libera mais nada.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- Busca por CPF roda em toda checagem de acesso.
CREATE INDEX IF NOT EXISTS idx_empregados_cpf ON public."EMPREGADOS" ("CPF");

ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" ADD COLUMN IF NOT EXISTS situacao text;
ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" DROP CONSTRAINT IF EXISTS "SIS_LOGIN_DESLIGAMENTO_acao_check";
ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" ADD CONSTRAINT "SIS_LOGIN_DESLIGAMENTO_acao_check"
  CHECK (acao IN ('excluido', 'mantido', 'ciente'));

-- ── Situação que deixa entrar na ERP ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_situacao_libera_login(_situacao text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT btrim(coalesce(_situacao, '')) ~* '^(Trabalhando|Atestado|Aviso Pr.vio Trab)'
$$;

-- ── Bloqueio ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_login_bloqueado(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- 07/10/2026 (mig 20261007000007): por situação, pelo CPF, sem exceção.
  SELECT _user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e.auth_user_id = _user)
     -- duas buscas separadas (sem OR na junção) para cada uma usar o seu índice:
     -- isto roda em TODA checagem de acesso (has_screen_access).
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                      WHERE e.auth_user_id = _user AND public.erp_situacao_libera_login(e."Situação"))
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                       JOIN public."EMPREGADOS" x ON x."CPF" = e."CPF"
                      WHERE e.auth_user_id = _user AND e."CPF" IS NOT NULL
                        AND public.erp_situacao_libera_login(x."Situação"));
$$;
REVOKE ALL ON FUNCTION public.erp_login_bloqueado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_login_bloqueado(uuid) TO authenticated;

-- ── Lista da tela: todos os logins bloqueados ────────────────────────────
CREATE OR REPLACE FUNCTION public.sis_logins_bloqueados()
RETURNS TABLE(empregado_id bigint, auth_user_id uuid, nome text, cargo text, contrato text, empresa text,
              situacao text, desde date, login_email text, ultimo_acesso timestamptz,
              ciente boolean, ciente_em timestamptz, ciente_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('visualizar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT e."ID"::bigint, u.id, e."Nome"::text, e."Título do Cargo"::text, e."Nome Filial"::text, e."Nome da Empresa"::text,
         e."Situação"::text, public.data_universal(e."Data Afastamento"::text), u.email::text, u.last_sign_in_at,
         (d.acao = 'ciente' AND d.situacao IS NOT DISTINCT FROM e."Situação") IS TRUE,
         CASE WHEN d.acao = 'ciente' AND d.situacao IS NOT DISTINCT FROM e."Situação" THEN d.tratado_em END,
         CASE WHEN d.acao = 'ciente' AND d.situacao IS NOT DISTINCT FROM e."Situação" THEN d.tratado_por_nome END
    FROM public."EMPREGADOS" e
    JOIN auth.users u ON u.id = e.auth_user_id
    LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = u.id
   WHERE public.erp_login_bloqueado(u.id)
   ORDER BY 11, public.data_universal(e."Data Afastamento"::text) DESC NULLS LAST, e."Nome";
END $$;

-- ── OK: ciência do bloqueio (não libera nada) ────────────────────────────
CREATE OR REPLACE FUNCTION public.sis_login_bloqueio_ciente(p_auth_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quem text; v_emp bigint; v_sit text;
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  SELECT e."ID", e."Situação" INTO v_emp, v_sit FROM public."EMPREGADOS" e WHERE e.auth_user_id = p_auth_user_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Login sem colaborador vinculado.'; END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."SIS_LOGIN_DESLIGAMENTO" (auth_user_id, empregado_id, acao, situacao, obs, tratado_por, tratado_por_nome)
  VALUES (p_auth_user_id, v_emp, 'ciente', v_sit, NULL, auth.uid(), v_quem)
  ON CONFLICT (auth_user_id) DO UPDATE SET empregado_id = EXCLUDED.empregado_id, acao = 'ciente', situacao = EXCLUDED.situacao,
    obs = NULL, tratado_por = EXCLUDED.tratado_por, tratado_por_nome = EXCLUDED.tratado_por_nome, tratado_em = now();
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['sis_logins_bloqueados()', 'sis_login_bloqueio_ciente(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ── Bolinha de Sistemas › Logins: bloqueados sem OK ─────────────────────
DO $$
DECLARE v_def text; v_novo text;
  velho constant text := $v$(SELECT count(*) FROM public."EMPREGADOS" e
              JOIN auth.users u ON u.id = e.auth_user_id
              LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = u.id
             WHERE e."Situação" = 'Demitido' AND d.auth_user_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" o
                                WHERE o.auth_user_id = e.auth_user_id AND public.esp_col_esta_ativo(o."Situação")))$v$;
  novo constant text := $n$(SELECT count(*) FROM public."EMPREGADOS" e
              LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = e.auth_user_id
             WHERE e.auth_user_id IS NOT NULL AND public.erp_login_bloqueado(e.auth_user_id)
               AND NOT (d.acao = 'ciente' AND d.situacao IS NOT DISTINCT FROM e."Situação") IS TRUE)$n$;
BEGIN
  v_def := pg_get_functiondef('public.minhas_pendencias_aprovacao()'::regprocedure);
  IF position('erp_login_bloqueado(e.auth_user_id)' IN v_def) > 0 THEN RETURN; END IF;   -- já aplicado
  v_novo := replace(v_def, velho, novo);
  IF v_novo = v_def THEN
    RAISE NOTICE 'minhas_pendencias_aprovacao: contagem de demitidos não encontrada — bolinha ficou como estava.';
    RETURN;
  END IF;
  EXECUTE v_novo;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- erp_login_bloqueado: reaplicar a da mig 20261006160000 (só demitido + exceção 'mantido').
-- minhas_pendencias_aprovacao: replace inverso do bloco acima.
-- DROP FUNCTION IF EXISTS public.sis_logins_bloqueados(), public.sis_login_bloqueio_ciente(uuid), public.erp_situacao_libera_login(text);
-- (a coluna situacao e o 'ciente' no CHECK podem ficar.)
