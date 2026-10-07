-- =========================================================================
-- SISTEMAS › LOGINS — o login nasce VINCULADO ao colaborador da Senior, e
-- demitido não entra mais no ERP (06/10/2026)
--
-- PEDIDO (Pablo, 06/10/2026, em cima da PR #811 / SIS-2026-0598)
--   1. Quando Sistemas informa o login (e-mail) de um admitido, o login do
--      ERP já fica VINCULADO ao cadastro dele na EMPREGADOS (auth_user_id).
--   2. Só dá para liberar o login depois que a pessoa está admitida na
--      Senior: o pedido tem o CPF (vem do Recrutamento) e o ERP procura na
--      EMPREGADOS a admissão com Situação = 'Trabalhando'. Sem ela, o pedido
--      fica "aguardando admissão na Senior".
--   3. Para que, quando a pessoa for DEMITIDA, o login pare de funcionar:
--      quem tem login vinculado e está demitido não acessa mais o ERP — só o
--      Portal do Colaborador (/colaborador), que tem sessão própria por CPF e
--      não passa por aqui.
--
-- O QUE MUDA
--   a) "SIS_LOGIN_PEDIDO" ganha empregado_id / auth_user_id (o vínculo feito).
--   b) sis_login_admitido_senior(cpf): a admissão Trabalhando daquele CPF.
--   c) sis_login_pedidos_lista(): os pedidos + a admissão encontrada na Senior
--      (a tela usa isto no lugar do select direto).
--   d) sis_login_definir_cpf: Sistemas completa/corrige o CPF do pedido.
--   e) sis_login_marcar_criado passa a exigir o colaborador Trabalhando e o
--      usuário já criado com aquele e-mail; grava EMPREGADOS.auth_user_id
--      (mesmo efeito do vincular_meu_empregado, mig 20260930000229).
--   f) erp_login_bloqueado(user): tem vínculo na EMPREGADOS, nenhum vínculo
--      ativo e Sistemas não marcou "mantido" em SIS_LOGIN_DESLIGAMENTO.
--      · has_screen_access passa a negar tudo para esse usuário (é a régua de
--        TODA a RLS de tela e dos menus) — patch na função VIVA, só inserindo
--        a checagem logo depois do "_user IS NULL";
--      · meu_login_erp_bloqueado(): o front (ProtectedRoute) mostra a tela de
--        acesso encerrado e manda para o Portal do Colaborador.
--      Usuário sem vínculo na EMPREGADOS (administrativo antigo, externo,
--      automação) não muda em nada.
--   g) Bolinha de Sistemas › Logins conta só pedido PRONTO (admitido na
--      Senior) — pedido de quem ainda não foi admitido não é trabalho a fazer.
--   h) Três avisos em Novidades do Sistema.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- Depende de 20261006000009 / 20261006000010 (PR #811) e de rh_norm_doc
-- (20260930000275).
-- =========================================================================

-- ── a) Vínculo gravado no pedido ─────────────────────────────────────────
ALTER TABLE public."SIS_LOGIN_PEDIDO"
  ADD COLUMN IF NOT EXISTS empregado_id bigint,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- A busca por login vinculado roda em toda checagem de acesso (f).
CREATE INDEX IF NOT EXISTS idx_empregados_auth_user_id
  ON public."EMPREGADOS" (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ── b) A admissão Trabalhando de um CPF ──────────────────────────────────
-- Mais recente primeiro (a Senior pode ter readmissão do mesmo CPF).
CREATE OR REPLACE FUNCTION public.sis_login_admitido_senior(p_cpf text)
RETURNS TABLE (empregado_id bigint, cadastro text, nome text, cargo text, filial text,
               admissao text, situacao text, auth_user_id uuid, login_vinculado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e."ID"::bigint, e."Cadastro"::text, e."Nome", e."Título do Cargo", e."Nome Filial",
         e."Admissão"::text, e."Situação", e.auth_user_id, u.email::text
    FROM public."EMPREGADOS" e
    LEFT JOIN auth.users u ON u.id = e.auth_user_id
   WHERE public.rh_norm_doc(p_cpf) IS NOT NULL
     AND public.rh_norm_doc(e."CPF"::text) = public.rh_norm_doc(p_cpf)
     AND e."Situação" = 'Trabalhando'
   ORDER BY public.data_universal(e."Admissão"::text) DESC NULLS LAST, e."ID" DESC
$$;
REVOKE ALL ON FUNCTION public.sis_login_admitido_senior(text) FROM PUBLIC, anon, authenticated;

-- ── c) Lista da tela ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sis_login_pedidos_lista()
RETURNS TABLE (
  id uuid, vaga_id bigint, candidato_id bigint, nome text, cpf text, contrato text, cargo text,
  email_sugerido text, senha text, solicitante_email text, solicitante_nome text, status text,
  login_email text, criado_por_nome text, criado_em timestamptz, entregue_em timestamptz, obs text,
  created_at timestamptz, empregado_id bigint, auth_user_id uuid,
  senior_id bigint, senior_cadastro text, senior_nome text, senior_cargo text, senior_filial text,
  senior_admissao text, senior_login text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('visualizar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT p.id, p.vaga_id, p.candidato_id, p.nome, p.cpf, p.contrato, p.cargo,
         p.email_sugerido, p.senha, p.solicitante_email, p.solicitante_nome, p.status,
         p.login_email, p.criado_por_nome, p.criado_em, p.entregue_em, p.obs,
         p.created_at, p.empregado_id, p.auth_user_id,
         s.empregado_id, s.cadastro, s.nome, s.cargo, s.filial, s.admissao, s.login_vinculado
    FROM public."SIS_LOGIN_PEDIDO" p
    LEFT JOIN LATERAL (SELECT * FROM public.sis_login_admitido_senior(p.cpf) LIMIT 1) s ON true
   ORDER BY p.created_at DESC
   LIMIT 500;
END $$;

-- ── d) Completar / corrigir o CPF ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sis_login_definir_cpf(p_id uuid, p_cpf text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF length(v_cpf) <> 11 THEN RAISE EXCEPTION 'CPF inválido: informe os 11 dígitos.'; END IF;
  UPDATE public."SIS_LOGIN_PEDIDO" SET cpf = v_cpf
   WHERE id = p_id AND status IN ('pendente', 'criado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já entregue.'; END IF;
END $$;

-- ── e) Marcar criado = vincular ──────────────────────────────────────────
-- A assinatura antiga (3 argumentos) sai: login sem vínculo é exatamente o
-- que este pedido proíbe.
DROP FUNCTION IF EXISTS public.sis_login_marcar_criado(uuid, text, text);

CREATE OR REPLACE FUNCTION public.sis_login_marcar_criado(p_id uuid, p_login text, p_senha text, p_empregado_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_login  text := lower(btrim(coalesce(p_login, '')));
  v_quem   text;
  v_ped    public."SIS_LOGIN_PEDIDO"%ROWTYPE;
  v_emp    record;
  v_uid    uuid;
  v_outro  text;
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Informe o login (e-mail) criado.'; END IF;
  IF length(btrim(coalesce(p_senha, ''))) < 6 THEN RAISE EXCEPTION 'Informe a senha (mínimo 6 caracteres).'; END IF;

  SELECT * INTO v_ped FROM public."SIS_LOGIN_PEDIDO" WHERE id = p_id AND status IN ('pendente', 'criado') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já entregue.'; END IF;
  IF public.rh_norm_doc(v_ped.cpf) IS NULL THEN
    RAISE EXCEPTION 'O pedido está sem CPF. Informe o CPF do admitido antes de liberar o login.';
  END IF;

  -- O colaborador tem que estar admitido na Senior AGORA, com o mesmo CPF.
  SELECT e."ID" AS id, e."Nome" AS nome, e."Situação" AS situacao, e.auth_user_id, e."CPF"::text AS cpf
    INTO v_emp
    FROM public."EMPREGADOS" e WHERE e."ID" = p_empregado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado na EMPREGADOS.'; END IF;
  IF v_emp.situacao IS DISTINCT FROM 'Trabalhando' THEN
    RAISE EXCEPTION 'O colaborador está "%" na Senior — o login só é liberado com a admissão Trabalhando.', coalesce(v_emp.situacao, 'sem situação');
  END IF;
  IF public.rh_norm_doc(v_emp.cpf) IS DISTINCT FROM public.rh_norm_doc(v_ped.cpf) THEN
    RAISE EXCEPTION 'O CPF do colaborador escolhido não é o CPF do pedido.';
  END IF;

  -- O usuário já tem que existir (criado em Administração › Usuários).
  SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_login;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não existe usuário com o login %. Crie a conta em Administração › Usuários e confirme de novo.', v_login;
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> v_uid THEN
    SELECT u.email INTO v_outro FROM auth.users u WHERE u.id = v_emp.auth_user_id;
    RAISE EXCEPTION 'Este colaborador já está vinculado a outro login (%).', coalesce(v_outro, 'usuário excluído');
  END IF;
  SELECT e."Nome" INTO v_outro FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = v_uid AND e."ID" <> v_emp.id AND public.esp_col_esta_ativo(e."Situação") LIMIT 1;
  IF v_outro IS NOT NULL THEN
    RAISE EXCEPTION 'O login % já está vinculado a outro colaborador ativo (%).', v_login, v_outro;
  END IF;

  -- O vínculo.
  UPDATE public."EMPREGADOS"
     SET auth_user_id = v_uid,
         "email" = CASE WHEN coalesce(btrim("email"), '') = '' THEN v_login ELSE "email" END
   WHERE "ID" = v_emp.id;
  UPDATE public.profiles SET display_name = v_emp.nome
   WHERE id = v_uid AND coalesce(btrim(display_name), '') = '';
  -- Se Sistemas tinha marcado este login como "excluído/mantido" num
  -- desligamento antigo, o vínculo novo vale mais.
  DELETE FROM public."SIS_LOGIN_DESLIGAMENTO" WHERE auth_user_id = v_uid;

  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  UPDATE public."SIS_LOGIN_PEDIDO"
     SET status = 'criado', login_email = v_login, senha = btrim(p_senha),
         empregado_id = v_emp.id, auth_user_id = v_uid,
         criado_por = auth.uid(), criado_por_nome = v_quem, criado_em = now()
   WHERE id = p_id;
END $$;

-- ── f) Demitido não entra no ERP ─────────────────────────────────────────
-- Bloqueia quando o login tem vínculo na EMPREGADOS e TODOS os vínculos estão
-- demitidos/desligados/rescindidos. Afastado, férias e aposentado-por-
-- invalidez seguem entrando (não são desligamento). "Mantido" pelo Sistemas
-- em SIS_LOGIN_DESLIGAMENTO é a exceção explícita.
CREATE OR REPLACE FUNCTION public.erp_login_bloqueado(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e.auth_user_id = _user)
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                      WHERE e.auth_user_id = _user
                        AND coalesce(e."Situação", '') !~* '(DEMIT|DESLIG|RESCIS)')
     AND NOT EXISTS (SELECT 1 FROM public."SIS_LOGIN_DESLIGAMENTO" d
                      WHERE d.auth_user_id = _user AND d.acao = 'mantido');
$$;
REVOKE ALL ON FUNCTION public.erp_login_bloqueado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_login_bloqueado(uuid) TO authenticated;

-- Para o front: o usuário logado está bloqueado? (+ o nome para a mensagem)
CREATE OR REPLACE FUNCTION public.meu_login_erp_bloqueado()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'bloqueado', public.erp_login_bloqueado(auth.uid()),
    'nome', (SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e.auth_user_id = auth.uid()
              ORDER BY public.data_universal(e."Admissão"::text) DESC NULLS LAST LIMIT 1),
    'situacao', (SELECT e."Situação" FROM public."EMPREGADOS" e WHERE e.auth_user_id = auth.uid()
              ORDER BY public.data_universal(e."Admissão"::text) DESC NULLS LAST LIMIT 1));
$$;
REVOKE ALL ON FUNCTION public.meu_login_erp_bloqueado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_login_erp_bloqueado() TO authenticated;

-- has_screen_access: insere "bloqueado → false" logo depois do teste de
-- _user nulo, na definição VIVA (não reescreve as regras de perfil que já
-- estão lá).
DO $$
DECLARE v_def text; v_novo text;
BEGIN
  v_def := pg_get_functiondef('public.has_screen_access(uuid, text, public.app_acao, uuid)'::regprocedure);
  IF v_def LIKE '%erp_login_bloqueado%' THEN RETURN; END IF;   -- já aplicado
  v_novo := regexp_replace(v_def,
    '(IF\s+_user\s+IS\s+NULL\s+THEN\s+RETURN\s+false;\s+END\s+IF;)',
    E'\\1\n\n  -- Login vinculado a colaborador demitido não acessa o ERP (mig 20261006160000).\n  IF public.erp_login_bloqueado(_user) THEN\n    RETURN false;\n  END IF;',
    'i');
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'has_screen_access mudou: não achei o "IF _user IS NULL THEN RETURN false; END IF;".';
  END IF;
  EXECUTE v_novo;
END $$;

-- ── g) Bolinha: só pedido pronto ─────────────────────────────────────────
DO $$
DECLARE v_def text; v_novo text;
BEGIN
  v_def := pg_get_functiondef('public.minhas_pendencias_aprovacao()'::regprocedure);
  IF v_def LIKE '%sis_login_admitido_senior%' THEN RETURN; END IF;   -- já aplicado
  v_novo := replace(v_def,
    $a$(SELECT count(*) FROM public."SIS_LOGIN_PEDIDO" WHERE status = 'pendente')$a$,
    $b$(SELECT count(*) FROM public."SIS_LOGIN_PEDIDO" p WHERE p.status = 'pendente' AND EXISTS (SELECT 1 FROM public.sis_login_admitido_senior(p.cpf)))$b$);
  IF v_novo = v_def THEN
    RAISE NOTICE 'minhas_pendencias_aprovacao: contagem de pedidos não encontrada — bolinha ficou como estava.';
    RETURN;
  END IF;
  EXECUTE v_novo;
END $$;

-- ── Grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['sis_login_pedidos_lista()', 'sis_login_definir_cpf(uuid, text)',
    'sis_login_marcar_criado(uuid, text, text, bigint)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ── h) Novidades do Sistema ──────────────────────────────────────────────
INSERT INTO public."SISTEMA_NOVIDADES" (titulo, descricao, tipo, rota, criado_por_nome)
SELECT x.titulo, x.descricao, x.tipo, x.rota, 'Sistemas'
  FROM (VALUES
    ('Login do ERP agora nasce vinculado ao colaborador',
     'Em Sistemas › Logins, ao informar o e-mail do novo login, o ERP já vincula a conta ao cadastro do colaborador na Senior (EMPREGADOS). O login só pode ser liberado depois que a admissão aparece na Senior com a situação Trabalhando — até lá o pedido fica "Aguardando admissão na Senior".',
     'NOVO', '/app/sistemas/logins'),
    ('Demitido não acessa mais o ERP',
     'Quem tem login vinculado a um colaborador demitido perde o acesso ao ERP automaticamente e é encaminhado ao Portal do Colaborador (/colaborador), onde continua vendo holerite, ponto e histórico. Se for preciso manter o acesso (ex.: recontratação), Sistemas marca "Manter" em Logins › Demitidos com login.',
     'AVISO', '/app/sistemas/logins'),
    ('Contratar com login exige o CPF',
     'No kanban do Recrutamento, ao contratar (enviar à Admissão) o candidato de uma vaga que precisa de login para o ERP, o CPF é obrigatório: é por ele que Sistemas encontra a admissão na Senior para liberar e vincular o login.',
     'MELHORIA', '/app/rh/recrutamento')
  ) AS x(titulo, descricao, tipo, rota)
 WHERE NOT EXISTS (SELECT 1 FROM public."SISTEMA_NOVIDADES" n WHERE n.titulo = x.titulo);

NOTIFY pgrst, 'reload schema';

-- Conferência (antes de liberar, veja quem será bloqueado):
-- SELECT u.email, max(e."Nome"), string_agg(DISTINCT e."Situação", ', ')
--   FROM public."EMPREGADOS" e JOIN auth.users u ON u.id = e.auth_user_id
--  WHERE public.erp_login_bloqueado(u.id) GROUP BY u.email ORDER BY 1;

-- ROLLBACK
-- has_screen_access: reaplicar a definição sem o bloco "erp_login_bloqueado"
--   (regexp_replace inverso, ou a versão de 20260718000001).
-- minhas_pendencias_aprovacao: reaplicar 20261006000010.
-- DROP FUNCTION IF EXISTS public.meu_login_erp_bloqueado(), public.erp_login_bloqueado(uuid),
--   public.sis_login_marcar_criado(uuid, text, text, bigint), public.sis_login_definir_cpf(uuid, text),
--   public.sis_login_pedidos_lista(), public.sis_login_admitido_senior(text);
-- reaplicar sis_login_marcar_criado(uuid, text, text) de 20261006000009.
-- ALTER TABLE public."SIS_LOGIN_PEDIDO" DROP COLUMN IF EXISTS empregado_id, DROP COLUMN IF EXISTS auth_user_id;
-- DELETE FROM public."SISTEMA_NOVIDADES" WHERE titulo IN ('Login do ERP agora nasce vinculado ao colaborador',
--   'Demitido não acessa mais o ERP', 'Contratar com login exige o CPF');
