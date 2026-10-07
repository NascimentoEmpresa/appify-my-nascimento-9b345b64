-- =========================================================================
-- SIS-2026-0598 — SISTEMAS › LOGINS (ADMISSÃO E DEMISSÃO) (06/10/2026)
--
-- Chamado (Iury, 02/10/2026): "Criar um submódulo para nos avisar caso
-- alguém que tenha login seja demitido, a gente poder saber para excluir os
-- logins. No caso de Admissão, fazer com que o recrutamento informe se a
-- pessoa precisará de login, assim quando ela for admitida já estará com
-- tudo pronto."
-- Detalhado pelo Pablo: na vaga, "É encarregado?" → "Precisa de login para
-- a ERP?"; concluída no kanban, vai para Logins Novos com nome completo,
-- e-mail que será dele e senha aleatória, prontos para copiar; quando
-- Sistemas informa login e senha, aparece em Minhas Solicitações SÓ para
-- quem pediu a vaga.
--
-- ADMISSÃO
--   · "SISTEMA_RECRUTAMENTO".vaga_encarregado / precisa_login_erp.
--   · Gatilho em "WA_CURRICULOS": o candidato ENVIADO À ADMISSÃO
--     (enviado_admissao_em — é o que fecha a vaga como "Contratado", pelo
--     kanban ou pelo "Concluir direto") de vaga com precisa_login_erp gera
--     um "SIS_LOGIN_PEDIDO" (um por candidato), com e-mail sugerido no
--     padrão dos encarregados (primeiro.segundo@gmail.com, sem repetir) e
--     senha aleatória (gen_random_bytes).
--   · Sistemas cria a conta em Administração › Usuários e marca "criado"
--     (sis_login_marcar_criado) com o login e a senha finais.
--   · Quem pediu a vaga (SISTEMA_RECRUTAMENTO.solicitante_cpf — que na
--     prática guarda o E-MAIL do solicitante, é por ele que Minhas
--     Solicitações filtra) vê em minhas_credenciais_login() e confirma que
--     repassou; aí a senha é APAGADA do banco (sis_login_confirmar_entrega).
--     Senha guardada em texto é só a provisória, e só até ser entregue.
--
-- DEMISSÃO
--   · sis_logins_demitidos(): EMPREGADOS demitido cujo login (auth_user_id)
--     ainda existe e não está ligado a outro cadastro ativo (recontratado).
--   · "SIS_LOGIN_DESLIGAMENTO": quem já foi tratado (excluído/mantido).
--
-- ACESSO: menu sistemas_logins (nasce fechado). visualizar lê; alterar
-- marca criado / tratado. A tabela de pedidos não tem policy para o
-- solicitante: ele só enxerga pelas RPCs, que filtram pelo e-mail do login.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sistemas_logins', 'Logins — Admissão e Demissão', '/app/sistemas/logins', 7, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sis_logins_pode(_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_screen_access(auth.uid(), 'sistemas_logins', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sis_logins_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sis_logins_pode(text) TO authenticated;

-- ── 2) A vaga pergunta ───────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS vaga_encarregado  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precisa_login_erp boolean NOT NULL DEFAULT false;
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP CONSTRAINT IF EXISTS sistema_recrutamento_login_so_encarregado_chk;
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ADD CONSTRAINT sistema_recrutamento_login_so_encarregado_chk
  CHECK (NOT precisa_login_erp OR vaga_encarregado);

-- ── 3) Pedido de login da admissão ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_LOGIN_PEDIDO" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vaga_id           bigint REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE SET NULL,
  candidato_id      bigint UNIQUE,
  nome              text NOT NULL,
  cpf               text,
  contrato          text,
  cargo             text,
  email_sugerido    text NOT NULL,
  -- Provisória; apagada quando o solicitante confirma que repassou.
  senha             text,
  solicitante_email text,
  solicitante_nome  text,
  status            text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'criado', 'entregue', 'cancelado')),
  login_email       text,
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz,
  entregue_em       timestamptz,
  obs               text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sis_login_pedido_solicitante ON public."SIS_LOGIN_PEDIDO" (lower(solicitante_email)) WHERE status = 'criado';

DROP TRIGGER IF EXISTS trg_sis_login_pedido_updated_at ON public."SIS_LOGIN_PEDIDO";
CREATE TRIGGER trg_sis_login_pedido_updated_at BEFORE UPDATE ON public."SIS_LOGIN_PEDIDO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."SIS_LOGIN_PEDIDO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sis_login_pedido_select ON public."SIS_LOGIN_PEDIDO";
CREATE POLICY sis_login_pedido_select ON public."SIS_LOGIN_PEDIDO" FOR SELECT TO authenticated USING (public.sis_logins_pode('visualizar'));
-- Escrita só pelas RPCs abaixo (SECURITY DEFINER).

-- Senha provisória: 10 caracteres sem os ambíguos (0/O, 1/l/I), com pelo
-- menos uma maiúscula, minúscula e dígito.
CREATE OR REPLACE FUNCTION public.sis_login_senha_aleatoria()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public, extensions, pg_temp AS $$
DECLARE
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  b bytea; s text;
BEGIN
  LOOP
    b := extensions.gen_random_bytes(10); s := '';
    FOR i IN 0..9 LOOP s := s || substr(alfabeto, (get_byte(b, i) % length(alfabeto)) + 1, 1); END LOOP;
    EXIT WHEN s ~ '[A-Z]' AND s ~ '[a-z]' AND s ~ '[0-9]';
  END LOOP;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.sis_login_senha_aleatoria() FROM PUBLIC, anon, authenticated;

-- E-mail no padrão dos encarregados: primeiro.segundo@gmail.com (sem
-- "de/da/dos…"), sem acento; se já existe login ou pedido com ele, tenta
-- primeiro.último, depois primeiro.segundo2, 3…
CREATE OR REPLACE FUNCTION public.sis_login_email_sugerido(p_nome text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  partes text[]; base text; cand text; n int := 1;
  livre boolean;
BEGIN
  partes := ARRAY(
    SELECT p FROM unnest(string_to_array(
      regexp_replace(lower(translate(btrim(coalesce(p_nome, '')),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ', 'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z ]', '', 'g'), ' ')) p
     WHERE p <> '' AND p NOT IN ('de', 'da', 'do', 'dos', 'das', 'e'));
  IF coalesce(array_length(partes, 1), 0) = 0 THEN partes := ARRAY['colaborador']; END IF;
  base := partes[1] || CASE WHEN array_length(partes, 1) > 1 THEN '.' || partes[2] ELSE '' END;
  cand := base;
  LOOP
    SELECT NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = cand || '@gmail.com')
       AND NOT EXISTS (SELECT 1 FROM public."SIS_LOGIN_PEDIDO" p WHERE lower(p.email_sugerido) = cand || '@gmail.com' AND p.status <> 'cancelado')
      INTO livre;
    EXIT WHEN livre;
    n := n + 1;
    cand := CASE WHEN n = 2 AND array_length(partes, 1) > 2 THEN partes[1] || '.' || partes[array_length(partes, 1)] ELSE base || n END;
  END LOOP;
  RETURN cand || '@gmail.com';
END $$;
REVOKE ALL ON FUNCTION public.sis_login_email_sugerido(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sis_login_pedido_da_admissao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_nome text;
BEGIN
  IF NEW.enviado_admissao_em IS NULL OR NEW.vaga_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.enviado_admissao_em IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id, contrato, cargo, solicitante_cpf, solicitante_nome, precisa_login_erp
    INTO v FROM public."SISTEMA_RECRUTAMENTO" WHERE id = NEW.vaga_id;
  IF NOT coalesce(v.precisa_login_erp, false) THEN RETURN NEW; END IF;
  v_nome := upper(btrim(coalesce(public.rh_nome_oficial_por_cpf(coalesce(NEW.cpf, NEW.cpf_cand)), NEW.nome, '')));
  IF v_nome = '' THEN RETURN NEW; END IF;
  -- Este gatilho roda dentro do kanban do Recrutamento: falhar aqui não pode
  -- travar a admissão. Erro vira aviso no log e o pedido fica de fora.
  BEGIN
    INSERT INTO public."SIS_LOGIN_PEDIDO"
      (vaga_id, candidato_id, nome, cpf, contrato, cargo, email_sugerido, senha, solicitante_email, solicitante_nome)
    VALUES
      (v.id, NEW.id, v_nome, coalesce(NEW.cpf, NEW.cpf_cand), v.contrato, v.cargo,
       public.sis_login_email_sugerido(v_nome), public.sis_login_senha_aleatoria(),
       CASE WHEN v.solicitante_cpf LIKE '%@%' THEN lower(btrim(v.solicitante_cpf)) END, v.solicitante_nome)
    ON CONFLICT (candidato_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'sis_login_pedido_da_admissao (candidato %): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sis_login_pedido_da_admissao ON public."WA_CURRICULOS";
CREATE TRIGGER trg_sis_login_pedido_da_admissao AFTER INSERT OR UPDATE OF enviado_admissao_em ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.sis_login_pedido_da_admissao();

-- Sistemas: login criado (e-mail e senha finais, se mudaram).
CREATE OR REPLACE FUNCTION public.sis_login_marcar_criado(p_id uuid, p_login text, p_senha text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_login text := lower(btrim(coalesce(p_login, ''))); v_quem text;
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'Informe o login (e-mail) criado.'; END IF;
  IF length(btrim(coalesce(p_senha, ''))) < 6 THEN RAISE EXCEPTION 'Informe a senha (mínimo 6 caracteres).'; END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  UPDATE public."SIS_LOGIN_PEDIDO"
     SET status = 'criado', login_email = v_login, senha = btrim(p_senha),
         criado_por = auth.uid(), criado_por_nome = v_quem, criado_em = now()
   WHERE id = p_id AND status IN ('pendente', 'criado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já entregue.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sis_login_cancelar(p_id uuid, p_obs text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  UPDATE public."SIS_LOGIN_PEDIDO" SET status = 'cancelado', senha = NULL, obs = nullif(btrim(p_obs), '')
   WHERE id = p_id AND status IN ('pendente', 'criado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou já entregue.'; END IF;
END $$;

-- Quem pediu a vaga: só os logins prontos das vagas DELE (pelo e-mail do login).
CREATE OR REPLACE FUNCTION public.minhas_credenciais_login()
RETURNS TABLE (id uuid, vaga_id bigint, nome text, cargo text, contrato text, login_email text, senha text, criado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.vaga_id, p.nome, p.cargo, p.contrato, p.login_email, p.senha, p.criado_em
    FROM public."SIS_LOGIN_PEDIDO" p
   WHERE p.status = 'criado'
     AND p.solicitante_email IS NOT NULL
     AND p.solicitante_email = (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid())
   ORDER BY p.criado_em DESC
$$;

CREATE OR REPLACE FUNCTION public.sis_login_confirmar_entrega(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public."SIS_LOGIN_PEDIDO"
     SET status = 'entregue', entregue_em = now(), senha = NULL
   WHERE id = p_id AND status = 'criado'
     AND solicitante_email = (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Login não encontrado.'; END IF;
END $$;

-- ── 4) Demitidos com login ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SIS_LOGIN_DESLIGAMENTO" (
  auth_user_id    uuid PRIMARY KEY,
  empregado_id    bigint,
  acao            text NOT NULL CHECK (acao IN ('excluido', 'mantido')),
  obs             text,
  tratado_por     uuid DEFAULT auth.uid(),
  tratado_por_nome text,
  tratado_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."SIS_LOGIN_DESLIGAMENTO" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sis_login_desligamento_select ON public."SIS_LOGIN_DESLIGAMENTO";
CREATE POLICY sis_login_desligamento_select ON public."SIS_LOGIN_DESLIGAMENTO" FOR SELECT TO authenticated USING (public.sis_logins_pode('visualizar'));

-- Demitido cujo login ainda existe e não serve a outro cadastro ativo.
-- Login que Sistemas marcou "mantido" sai da lista; "excluído" sai porque o
-- usuário some de auth.users.
CREATE OR REPLACE FUNCTION public.sis_logins_demitidos()
RETURNS TABLE (empregado_id bigint, auth_user_id uuid, nome text, cargo text, contrato text, empresa text,
               desligamento date, login_email text, ultimo_acesso timestamptz, tratado text, tratado_em timestamptz, tratado_por text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.sis_logins_pode('visualizar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT e."ID", u.id, e."Nome", e."Título do Cargo", e."Nome Filial", e."Nome da Empresa",
         public.data_universal(e."Data Afastamento"), u.email::text, u.last_sign_in_at,
         d.acao, d.tratado_em, d.tratado_por_nome
    FROM public."EMPREGADOS" e
    JOIN auth.users u ON u.id = e.auth_user_id
    LEFT JOIN public."SIS_LOGIN_DESLIGAMENTO" d ON d.auth_user_id = u.id
   WHERE e."Situação" = 'Demitido'
     AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" o
                      WHERE o.auth_user_id = e.auth_user_id AND public.esp_col_esta_ativo(o."Situação"))
   ORDER BY (d.acao IS NOT NULL), public.data_universal(e."Data Afastamento") DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.sis_login_desligamento_tratar(p_auth_user_id uuid, p_empregado_id bigint, p_acao text, p_obs text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quem text;
BEGIN
  IF NOT public.sis_logins_pode('alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF p_acao NOT IN ('excluido', 'mantido') THEN RAISE EXCEPTION 'Ação inválida.'; END IF;
  IF p_acao = 'mantido' AND length(btrim(coalesce(p_obs, ''))) < 5 THEN
    RAISE EXCEPTION 'Diga por que o login vai ser mantido.';
  END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_quem FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."SIS_LOGIN_DESLIGAMENTO" (auth_user_id, empregado_id, acao, obs, tratado_por, tratado_por_nome)
  VALUES (p_auth_user_id, p_empregado_id, p_acao, nullif(btrim(p_obs), ''), auth.uid(), v_quem)
  ON CONFLICT (auth_user_id) DO UPDATE SET acao = EXCLUDED.acao, obs = EXCLUDED.obs,
    tratado_por = EXCLUDED.tratado_por, tratado_por_nome = EXCLUDED.tratado_por_nome, tratado_em = now();
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['sis_login_marcar_criado(uuid, text, text)', 'sis_login_cancelar(uuid, text)',
    'minhas_credenciais_login()', 'sis_login_confirmar_entrega(uuid)', 'sis_logins_demitidos()',
    'sis_login_desligamento_tratar(uuid, bigint, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_sis_login_pedido_da_admissao ON public."WA_CURRICULOS";
-- DROP FUNCTION IF EXISTS public.sis_login_pedido_da_admissao(), public.sis_login_marcar_criado(uuid, text, text),
--   public.sis_login_cancelar(uuid, text), public.minhas_credenciais_login(), public.sis_login_confirmar_entrega(uuid),
--   public.sis_logins_demitidos(), public.sis_login_desligamento_tratar(uuid, bigint, text, text),
--   public.sis_login_email_sugerido(text), public.sis_login_senha_aleatoria(), public.sis_logins_pode(text);
-- DROP TABLE IF EXISTS public."SIS_LOGIN_PEDIDO", public."SIS_LOGIN_DESLIGAMENTO";
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP CONSTRAINT IF EXISTS sistema_recrutamento_login_so_encarregado_chk,
--   DROP COLUMN IF EXISTS precisa_login_erp, DROP COLUMN IF EXISTS vaga_encarregado;
-- DELETE FROM public.app_menu WHERE codigo = 'sistemas_logins';
