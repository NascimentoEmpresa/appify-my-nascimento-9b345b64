-- =============================================================
-- APLICAR NO BANCO DO APP  (projeto Supabase fwmzeaztjxrxxzxzxmgc)
-- Cole tudo no SQL Editor desse projeto e rode. É idempotente.
-- =============================================================

-- ===== 20260618000001_recrutamento_status_tracking =====
-- =========================================================================
-- INDICADORES DE TEMPO POR ETAPA (Recrutamento)
--
-- Objetivo: saber "quantos dias a vaga está parada no status atual" e ter
-- base para indicadores de qual etapa demora mais.
--
-- 1. Coluna status_changed_at em SISTEMA_RECRUTAMENTO (carimbo da última troca).
-- 2. Tabela de log de transições (status anterior → novo + dias no anterior).
-- 3. Trigger BEFORE UPDATE que carimba a data e grava o log a cada troca.
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

-- Inicializa o carimbo das linhas antigas com a data de criação.
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET status_changed_at = created_at
 WHERE status_changed_at IS NULL OR status_changed_at < created_at;

-- Log de transições de status (para indicadores de tempo por etapa).
CREATE TABLE IF NOT EXISTS public."SISTEMA_RECRUTAMENTO_STATUS_LOG" (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitacao_id   integer REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE,
  status_anterior  text,
  status_novo      text,
  dias_no_anterior numeric,
  changed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS srsl_solicitacao_idx
  ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"(solicitacao_id);

ALTER TABLE public."SISTEMA_RECRUTAMENTO_STATUS_LOG" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG" TO authenticated;

DROP POLICY IF EXISTS srsl_all_auth ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
CREATE POLICY srsl_all_auth ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger: a cada troca de status, carimba status_changed_at e registra o log.
CREATE OR REPLACE FUNCTION public.sr_track_status_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dias numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_dias := EXTRACT(EPOCH FROM (now() - COALESCE(OLD.status_changed_at, OLD.created_at))) / 86400.0;
    NEW.status_changed_at := now();
    -- O log nunca pode bloquear a atualização principal da solicitação.
    BEGIN
      INSERT INTO public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
        (solicitacao_id, status_anterior, status_novo, dias_no_anterior)
      VALUES (NEW.id, OLD.status, NEW.status, round(v_dias, 2));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sr_track_status ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_sr_track_status
  BEFORE UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sr_track_status_change();

-- ===== 20260618000002_vincular_empregado_rpc =====
-- =========================================================================
-- VÍNCULO via RPC (substitui a Edge Function auth-vincular-empregado)
--
-- Motivo: a chamada à Edge Function vinha falhando no client com
-- "Failed to send a request to the Edge Function" (falha de rede/boot/CORS).
-- Mover a lógica para uma RPC SECURITY DEFINER (PostgREST) elimina essa
-- dependência: vai pelo mesmo endpoint /rest/v1/rpc já usado pelo app.
--
-- Confirma identidade por CPF + data de nascimento, exclui desligados,
-- escolhe a admissão mais recente e grava auth_user_id = auth.uid().
--
-- Idempotente e autossuficiente: garante a coluna/índice e recria meu_empregado,
-- caso a migration 20260617000003 não tenha sido aplicada no ambiente.
-- =========================================================================

ALTER TABLE public."EMPREGADOS"
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS empregados_auth_user_id_uidx
  ON public."EMPREGADOS"(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Leitura segura do "meu cadastro" (campos não-sensíveis).
CREATE OR REPLACE FUNCTION public.meu_empregado()
RETURNS TABLE (
  id bigint, nome text, cpf text, cargo text, setor text, perfil text,
  lider text, situacao text, admissao text, empresa text, filial text, email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    "ID", "Nome", "CPF", "Título do Cargo", "Setor_ERP", "Perfil_ERP",
    "LIDER", "Situação", "Admissão", "Nome da Empresa", "Nome Filial", "email"
  FROM public."EMPREGADOS"
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;
-- Apenas usuários autenticados: o Supabase concede EXECUTE a anon por padrão
-- (default privileges), então é preciso revogar de PUBLIC e de anon.
REVOKE ALL ON FUNCTION public.meu_empregado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_empregado() TO authenticated;

-- ── RPC de vínculo ───────────────────────────────────────────────────────
-- p_confirmar = false  → apenas valida e devolve o preview do cadastro
-- p_confirmar = true   → valida de novo e grava o vínculo
CREATE OR REPLACE FUNCTION public.vincular_meu_empregado(
  p_cpf        text,
  p_nascimento text,
  p_confirmar  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_cpf     text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_nasc    text := regexp_replace(coalesce(p_nascimento, ''), '\D', '', 'g');
  v_cpf_fmt text;
  v_emp     public."EMPREGADOS"%ROWTYPE;
  v_bloq    text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
  v_preview jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;
  IF length(v_cpf) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um CPF válido (11 dígitos).');
  END IF;
  IF length(v_nasc) <> 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe a data de nascimento (DD/MM/AAAA).');
  END IF;

  v_cpf_fmt := substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2);

  -- Não-desligados primeiro; depois admissão mais recente.
  SELECT * INTO v_emp
  FROM public."EMPREGADOS" e
  WHERE e."CPF" IN (v_cpf, v_cpf_fmt)
  ORDER BY
    (CASE WHEN upper(coalesce(e."Situação",'')) = ANY (v_bloq) THEN 1 ELSE 0 END) ASC,
    (CASE WHEN e."Admissão" ~ '^\d{2}/\d{2}/\d{4}$'
          THEN (substr(e."Admissão",7,4) || substr(e."Admissão",4,2) || substr(e."Admissão",1,2))::bigint
          ELSE 0 END) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro consta como desligado. Procure o RH.');
  END IF;

  IF regexp_replace(coalesce(v_emp."Nascimento",''), '\D', '', 'g') <> v_nasc THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF e data de nascimento não conferem.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário. Procure o RH.');
  END IF;

  v_preview := jsonb_build_object(
    'id',       v_emp."ID",
    'nome',     coalesce(v_emp."Nome", ''),
    'cargo',    coalesce(v_emp."Título do Cargo", ''),
    'setor',    coalesce(v_emp."Setor_ERP", ''),
    'perfil',   coalesce(v_emp."Perfil_ERP", ''),
    'lider',    coalesce(v_emp."LIDER", ''),
    'situacao', coalesce(v_emp."Situação", ''),
    'admissao', coalesce(v_emp."Admissão", ''),
    'empresa',  coalesce(v_emp."Nome da Empresa", ''),
    'filial',   coalesce(v_emp."Nome Filial", '')
  );

  IF NOT p_confirmar THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', (v_emp.auth_user_id = v_uid), 'empregado', v_preview);
  END IF;

  -- Confirmar: grava o elo e preenche o e-mail se estiver vazio.
  UPDATE public."EMPREGADOS"
     SET auth_user_id = v_uid,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = v_uid)
                     ELSE "email"
                   END
   WHERE "ID" = v_emp."ID";

  RETURN jsonb_build_object('ok', true, 'vinculado', true, 'empregado', v_preview);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sua conta já está vinculada a outro cadastro.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_meu_empregado(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_meu_empregado(text, text, boolean) TO authenticated;

-- ===== 20260618000003_portal_candidatura =====
-- =========================================================================
-- PORTAL PÚBLICO DE CANDIDATURA
--
-- Fluxo (rota pública, sem login): o colaborador escolhe a CIDADE que tem vaga,
-- vê as VAGAS daquela cidade, escolhe uma, envia o CURRÍCULO. O arquivo vai
-- para o Storage e a candidatura é gravada em WA_CURRICULOS (vaga_id), aparecendo
-- no card "Currículos" da solicitação no Recrutamento.
--
-- "Vaga disponível" = status 'Seleção de Currículos'.
--
-- Segurança: anon NÃO acessa as tabelas direto — só via RPCs SECURITY DEFINER
-- que expõem apenas campos seguros e validam a vaga. O upload do arquivo é a
-- única ação direta do anon, restrita ao bucket 'curriculos'.
--
-- Idempotente.
-- =========================================================================

-- CPF do candidato (novo campo).
ALTER TABLE public."WA_CURRICULOS" ADD COLUMN IF NOT EXISTS cpf_cand text;

-- Bucket privado para os currículos enviados pelo portal.
INSERT INTO storage.buckets (id, name, public)
VALUES ('curriculos', 'curriculos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage: anon pode ENVIAR (upload) só no bucket 'curriculos';
-- leitura/download fica para usuários autenticados (RH) via signed URL.
DROP POLICY IF EXISTS "curriculos_insert_publico" ON storage.objects;
CREATE POLICY "curriculos_insert_publico" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'curriculos');

DROP POLICY IF EXISTS "curriculos_select_auth" ON storage.objects;
CREATE POLICY "curriculos_select_auth" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'curriculos');

-- ── Cidades que têm vaga em 'Seleção de Currículos' ──────────────────────
CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE (cidade text, vagas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(btrim("cidade"), '') AS cidade, count(*)::bigint AS vagas
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Seleção de Currículos'
    AND NULLIF(btrim("cidade"), '') IS NOT NULL
  GROUP BY NULLIF(btrim("cidade"), '')
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.portal_cidades_com_vagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_cidades_com_vagas() TO anon, authenticated;

-- ── Vagas abertas de uma cidade ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE (
  id integer, cargo text, contrato text, cidade text,
  escala text, salario text, beneficios text, quantidade_vagas integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT "id", "cargo", "contrato", "cidade",
         "escala", "salario", "beneficios", "quantidade_vagas"
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Seleção de Currículos'
    AND btrim(lower("cidade")) = btrim(lower(coalesce(p_cidade, '')))
  ORDER BY "cargo";
$$;
REVOKE ALL ON FUNCTION public.portal_vagas_por_cidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_vagas_por_cidade(text) TO anon, authenticated;

-- ── Registrar candidatura ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_candidatar(
  p_vaga_id      integer,
  p_nome         text,
  p_telefone     text,
  p_email        text,
  p_cpf          text,
  p_mensagem     text,
  p_arquivo_nome text,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_id     bigint;
  v_field  record;
  v_col    text;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.');
  END IF;
  IF coalesce(btrim(p_telefone), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.');
  END IF;

  SELECT "status" INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE "id" = p_vaga_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.');
  END IF;
  IF v_status <> 'Seleção de Currículos' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
  END IF;

  -- Linha base com o vínculo da vaga + origem.
  INSERT INTO public."WA_CURRICULOS" (vaga_id, origem)
  VALUES (p_vaga_id, 'Portal')
  RETURNING id INTO v_id;

  -- Preenche cada campo na coluna que EXISTIR. O schema de WA_CURRICULOS varia
  -- entre ambientes (nome vs nome_cand, email vs email_cand, etc.), então
  -- gravamos no primeiro nome de coluna que existir de fato.
  FOR v_field IN
    SELECT t.cands, t.val FROM (VALUES
      (ARRAY['nome','nome_cand','nome_candidato'],    btrim(p_nome)),
      (ARRAY['telefone','fone','celular','whatsapp'], btrim(p_telefone)),
      (ARRAY['email','email_cand'],                   NULLIF(btrim(p_email), '')),
      (ARRAY['cpf','cpf_cand'],                       NULLIF(btrim(p_cpf), '')),
      (ARRAY['mensagem','observacao','obs'],          NULLIF(btrim(p_mensagem), '')),
      (ARRAY['arquivo_nome','nome_arquivo'],          NULLIF(btrim(p_arquivo_nome), '')),
      (ARRAY['storage_path','arquivo_path','path'],   NULLIF(btrim(p_storage_path), ''))
    ) AS t(cands, val)
    WHERE t.val IS NOT NULL
  LOOP
    SELECT c.column_name INTO v_col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'WA_CURRICULOS'
      AND c.column_name::text = ANY (v_field.cands)
    ORDER BY array_position(v_field.cands, c.column_name::text)
    LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('UPDATE public."WA_CURRICULOS" SET %I = $1 WHERE id = $2', v_col)
        USING v_field.val, v_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260619000001_fix_portal_candidatar_colunas =====
-- =========================================================================
-- FIX: portal_candidatar grava na coluna que EXISTIR (schema-agnóstico)
--
-- A WA_CURRICULOS tem nomes de coluna diferentes entre ambientes (ex.: nome vs
-- nome_cand, email vs email_cand). A versão anterior inseria colunas fixas
-- (nome_cand, ...) e quebrava com "column nome_cand does not exist".
--
-- Esta versão insere a linha base (vaga_id, origem) e preenche cada campo na
-- primeira coluna que realmente existir. Migration aditivo e idempotente —
-- aplica o fix em ambientes que já rodaram 20260618000003.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.portal_candidatar(
  p_vaga_id      integer,
  p_nome         text,
  p_telefone     text,
  p_email        text,
  p_cpf          text,
  p_mensagem     text,
  p_arquivo_nome text,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_id     bigint;
  v_field  record;
  v_col    text;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.');
  END IF;
  IF coalesce(btrim(p_telefone), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.');
  END IF;

  SELECT "status" INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE "id" = p_vaga_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.');
  END IF;
  IF v_status <> 'Seleção de Currículos' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
  END IF;

  INSERT INTO public."WA_CURRICULOS" (vaga_id, origem)
  VALUES (p_vaga_id, 'Portal')
  RETURNING id INTO v_id;

  FOR v_field IN
    SELECT t.cands, t.val FROM (VALUES
      (ARRAY['nome','nome_cand','nome_candidato'],    btrim(p_nome)),
      (ARRAY['telefone','fone','celular','whatsapp'], btrim(p_telefone)),
      (ARRAY['email','email_cand'],                   NULLIF(btrim(p_email), '')),
      (ARRAY['cpf','cpf_cand'],                       NULLIF(btrim(p_cpf), '')),
      (ARRAY['mensagem','observacao','obs'],          NULLIF(btrim(p_mensagem), '')),
      (ARRAY['arquivo_nome','nome_arquivo'],          NULLIF(btrim(p_arquivo_nome), '')),
      (ARRAY['storage_path','arquivo_path','path'],   NULLIF(btrim(p_storage_path), ''))
    ) AS t(cands, val)
    WHERE t.val IS NOT NULL
  LOOP
    SELECT c.column_name INTO v_col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'WA_CURRICULOS'
      AND c.column_name::text = ANY (v_field.cands)
    ORDER BY array_position(v_field.cands, c.column_name::text)
    LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('UPDATE public."WA_CURRICULOS" SET %I = $1 WHERE id = $2', v_col)
        USING v_field.val, v_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260619000002_recrutamento_blacklist_empregados =====
-- =========================================================================
-- RECRUTAMENTO: validação de CPF, e-mail obrigatório, cruzamento com
-- EMPREGADOS e lista negra (blacklist) de CPF.
--
-- 1. is_cpf_valido(text)        — valida dígitos verificadores do CPF.
-- 2. portal_candidatar          — passa a exigir e-mail e CPF válido.
-- 3. empregados_por_cpfs(text[])— lista os cadastros do candidato em EMPREGADOS.
-- 4. RECRUTAMENTO_CPF_BLACKLIST — lista negra de CPF + motivo.
--
-- Idempotente.
-- =========================================================================

-- 1) Validação de CPF (dígitos verificadores) ----------------------------
CREATE OR REPLACE FUNCTION public.is_cpf_valido(p_cpf text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  c  text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  s  int;
  d1 int;
  d2 int;
  i  int;
BEGIN
  IF length(c) <> 11 THEN RETURN false; END IF;
  IF c ~ '^(\d)\1{10}$' THEN RETURN false; END IF;   -- todos os dígitos iguais
  s := 0;
  FOR i IN 1..9 LOOP s := s + substr(c, i, 1)::int * (11 - i); END LOOP;
  d1 := 11 - (s % 11); IF d1 >= 10 THEN d1 := 0; END IF;
  IF d1 <> substr(c, 10, 1)::int THEN RETURN false; END IF;
  s := 0;
  FOR i IN 1..10 LOOP s := s + substr(c, i, 1)::int * (12 - i); END LOOP;
  d2 := 11 - (s % 11); IF d2 >= 10 THEN d2 := 0; END IF;
  RETURN d2 = substr(c, 11, 1)::int;
END;
$$;

-- 2) portal_candidatar: exige e-mail e CPF válido -----------------------
CREATE OR REPLACE FUNCTION public.portal_candidatar(
  p_vaga_id      integer,
  p_nome         text,
  p_telefone     text,
  p_email        text,
  p_cpf          text,
  p_mensagem     text,
  p_arquivo_nome text,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_id     bigint;
  v_field  record;
  v_col    text;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.');
  END IF;
  IF coalesce(btrim(p_telefone), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.');
  END IF;
  IF NOT public.is_cpf_valido(p_cpf) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF inválido.');
  END IF;
  IF coalesce(btrim(p_email), '') = '' OR position('@' in p_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um e-mail válido.');
  END IF;

  SELECT "status" INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE "id" = p_vaga_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.');
  END IF;
  IF v_status <> 'Seleção de Currículos' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
  END IF;

  INSERT INTO public."WA_CURRICULOS" (vaga_id, origem)
  VALUES (p_vaga_id, 'Portal')
  RETURNING id INTO v_id;

  FOR v_field IN
    SELECT t.cands, t.val FROM (VALUES
      (ARRAY['nome','nome_cand','nome_candidato'],    btrim(p_nome)),
      (ARRAY['telefone','fone','celular','whatsapp'], btrim(p_telefone)),
      (ARRAY['email','email_cand'],                   NULLIF(btrim(p_email), '')),
      (ARRAY['cpf','cpf_cand'],                       NULLIF(btrim(p_cpf), '')),
      (ARRAY['mensagem','observacao','obs'],          NULLIF(btrim(p_mensagem), '')),
      (ARRAY['arquivo_nome','nome_arquivo'],          NULLIF(btrim(p_arquivo_nome), '')),
      (ARRAY['storage_path','arquivo_path','path'],   NULLIF(btrim(p_storage_path), ''))
    ) AS t(cands, val)
    WHERE t.val IS NOT NULL
  LOOP
    SELECT c.column_name INTO v_col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'WA_CURRICULOS'
      AND c.column_name::text = ANY (v_field.cands)
    ORDER BY array_position(v_field.cands, c.column_name::text)
    LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('UPDATE public."WA_CURRICULOS" SET %I = $1 WHERE id = $2', v_col)
        USING v_field.val, v_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) TO anon, authenticated;

-- 3) Cadastros do candidato em EMPREGADOS (por CPF, casando por dígitos) --
CREATE OR REPLACE FUNCTION public.empregados_por_cpfs(p_cpfs text[])
RETURNS TABLE (
  cpf_match text, id bigint, nome text, cargo text, setor text, perfil text,
  lider text, situacao text, admissao text, empresa text, filial text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT regexp_replace(coalesce(e."CPF",''), '\D','','g') AS cpf_match,
         e."ID", e."Nome", e."Título do Cargo", e."Setor_ERP", e."Perfil_ERP",
         e."LIDER", e."Situação", e."Admissão", e."Nome da Empresa", e."Nome Filial"
  FROM public."EMPREGADOS" e
  WHERE regexp_replace(coalesce(e."CPF",''), '\D','','g') = ANY (
    SELECT regexp_replace(coalesce(x,''), '\D','','g')
    FROM unnest(p_cpfs) AS x
    WHERE coalesce(btrim(x),'') <> ''
  );
$$;
REVOKE ALL ON FUNCTION public.empregados_por_cpfs(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empregados_por_cpfs(text[]) TO authenticated;

-- 4) Lista negra de CPF --------------------------------------------------
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_CPF_BLACKLIST" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cpf_digits text NOT NULL UNIQUE,
  cpf_fmt    text,
  motivo     text NOT NULL,
  criado_por text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECRUTAMENTO_CPF_BLACKLIST" TO authenticated;
DROP POLICY IF EXISTS rcb_all_auth ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY rcb_all_auth ON public."RECRUTAMENTO_CPF_BLACKLIST"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ===== 20260622000010_juridico_patrimonios =====
-- =========================================================================
-- JURÍDICO — Gestão Patrimonial e Obrigações
--
-- Tabelas:
--   JUR_PATRIMONIOS   — imóveis, veículos, terrenos, equipamentos...
--   JUR_OBRIGACOES    — despesas/obrigações por patrimônio (IPTU, energia,
--                       seguro, IPVA...) com vencimento, status e campos de seguro
--   JUR_DOCUMENTOS    — documentos anexados (escritura, apólice, CRLV...)
--   JUR_CONTATOS      — corretor, imobiliária, administradora, seguradora...
--   JUR_ACESSOS       — portais/sistemas: link, usuário e ONDE a senha está
--                       (por segurança NÃO guarda a senha)
--   JUR_HISTORICO     — movimentações (anexos, renovações, pagamentos...)
--
-- Bucket de Storage 'juridico-docs' (privado) para os documentos.
-- RLS: authenticated (padrão do app). Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIOS" (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  codigo      text,
  tipo        text NOT NULL DEFAULT 'Imóvel',   -- Imóvel, Veículo, Terreno, Equipamento, Outros
  descricao   text NOT NULL,
  localizacao text,
  placa       text,
  cidade      text,
  empresa     text,
  responsavel text,
  centro_custo text,
  status      text NOT NULL DEFAULT 'Ativo',    -- Ativo / Inativo
  observacoes text,
  onde_pagar  text                              -- tipo 'Conta': URL do site de pagamento
);
-- garante a coluna mesmo se a tabela já existir
ALTER TABLE public."JUR_PATRIMONIOS" ADD COLUMN IF NOT EXISTS onde_pagar text;

CREATE TABLE IF NOT EXISTS public."JUR_OBRIGACOES" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  patrimonio_id   bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  categoria       text NOT NULL,                -- IPTU, Condomínio, Energia, Água, Internet, Seguro, Aluguel, IPVA, Licenciamento, Manutenção...
  descricao       text,
  valor           numeric,
  vencimento      date,
  periodicidade   text DEFAULT 'Mensal',        -- Mensal, Anual, Único, Trimestral...
  forma_pagamento text,                         -- Boleto, Débito em conta, Pix...
  responsavel     text,
  status          text NOT NULL DEFAULT 'Pendente',  -- Pendente, Pago, Vencido
  pago_em         date,
  -- seguro (categoria = 'Seguro')
  seguradora      text,
  apolice         text,
  vigencia_inicio date,
  vigencia_fim    date,
  premio          numeric,
  parcelas        text
);

CREATE TABLE IF NOT EXISTS public."JUR_DOCUMENTOS" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  tipo          text,        -- Escritura, Matrícula, Contrato, IPTU, Apólice, CRLV, NF, Laudo...
  nome          text,
  storage_path  text,
  versao        int DEFAULT 1,
  criado_por    text
);

CREATE TABLE IF NOT EXISTS public."JUR_CONTATOS" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  tipo          text,        -- Corretor, Imobiliária, Administradora, Seguradora...
  nome          text,
  telefone      text,
  email         text,
  observacao    text
);

CREATE TABLE IF NOT EXISTS public."JUR_ACESSOS" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  servico       text,        -- Energia, Condomínio, Seguro, Água...
  link          text,
  usuario       text,
  local_senha   text,        -- ONDE a senha está guardada (Cofre, TI...) — nunca a senha
  observacao    text
);

CREATE TABLE IF NOT EXISTS public."JUR_HISTORICO" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  acao          text NOT NULL,
  detalhe       text,
  autor         text
);

CREATE INDEX IF NOT EXISTS jur_obr_pat_idx  ON public."JUR_OBRIGACOES"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_obr_venc_idx ON public."JUR_OBRIGACOES"(vencimento);
CREATE INDEX IF NOT EXISTS jur_doc_pat_idx  ON public."JUR_DOCUMENTOS"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_cont_pat_idx ON public."JUR_CONTATOS"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_acc_pat_idx  ON public."JUR_ACESSOS"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_hist_pat_idx ON public."JUR_HISTORICO"(patrimonio_id);

-- RLS: liberado para authenticated (padrão do app; controle fino fica no painel de acessos).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['JUR_PATRIMONIOS','JUR_OBRIGACOES','JUR_DOCUMENTOS','JUR_CONTATOS','JUR_ACESSOS','JUR_HISTORICO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_all_auth', t);
  END LOOP;
END $$;

-- Bucket privado para documentos do patrimônio.
INSERT INTO storage.buckets (id, name, public)
VALUES ('juridico-docs', 'juridico-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "jur_docs_rw_auth" ON storage.objects;
CREATE POLICY "jur_docs_rw_auth" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'juridico-docs') WITH CHECK (bucket_id = 'juridico-docs');

NOTIFY pgrst, 'reload schema';

-- ===== 20260622000011_jur_contas =====
-- =========================================================================
-- JURÍDICO — Submódulo CONTAS (recorrentes) + lançamentos por mês
--
-- JUR_CONTAS            — conta-mestra (água, luz, internet...): onde pagar,
--                         recorrência (a cada 7/15/20/30 dias), valor de ref.
-- JUR_CONTA_LANCAMENTOS — ocorrência por competência (mês), com status próprio
--                         (Pendente / Pago / Vencido). UNIQUE(conta_id,vencimento)
--                         permite gerar o mês sem duplicar.
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."JUR_CONTAS" (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  patrimonio_id      bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  descricao          text NOT NULL,
  categoria          text,                 -- Água, Luz, Internet, Aluguel...
  empresa            text,
  responsavel        text,
  onde_pagar         text,                 -- URL do site de pagamento
  possui_recorrencia boolean NOT NULL DEFAULT false,
  intervalo_dias     int,                  -- 7, 15, 20, 30 (quando recorrente)
  data_inicio        date,                 -- referência p/ gerar ocorrências / 1º vencimento
  valor              numeric,
  status             text NOT NULL DEFAULT 'Ativo',  -- Ativo / Inativo
  observacoes        text
);

CREATE TABLE IF NOT EXISTS public."JUR_CONTA_LANCAMENTOS" (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  conta_id    bigint REFERENCES public."JUR_CONTAS"(id) ON DELETE CASCADE,
  competencia text,                        -- 'YYYY-MM'
  vencimento  date,
  valor       numeric,
  status      text NOT NULL DEFAULT 'Pendente',  -- Pendente, Pago, Vencido
  pago_em     date,
  UNIQUE (conta_id, vencimento)
);

CREATE INDEX IF NOT EXISTS jur_clanc_conta_idx ON public."JUR_CONTA_LANCAMENTOS"(conta_id);
CREATE INDEX IF NOT EXISTS jur_clanc_comp_idx  ON public."JUR_CONTA_LANCAMENTOS"(competencia);

-- Contas vinculadas ao patrimônio (garante a coluna mesmo se a tabela já existir).
ALTER TABLE public."JUR_CONTAS" ADD COLUMN IF NOT EXISTS patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS jur_contas_pat_idx ON public."JUR_CONTAS"(patrimonio_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['JUR_CONTAS','JUR_CONTA_LANCAMENTOS'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all_auth', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_all_auth', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Comentários por patrimônio: usam o feed único SISTEMA_COMENTARIOS
-- (modulo='patrimonio'), criado no bloco de consolidação (016) mais abaixo.
-- A antiga JUR_COMENTARIOS não é mais criada (ver 20260710000001).
-- =========================================================================

-- =========================================================================
-- JURÍDICO — Patrimônio: novos campos + fusão Contas → Obrigações
-- =========================================================================
ALTER TABLE public."JUR_PATRIMONIOS" ADD COLUMN IF NOT EXISTS transferida      boolean NOT NULL DEFAULT false;
ALTER TABLE public."JUR_PATRIMONIOS" ADD COLUMN IF NOT EXISTS proprietario     text;
ALTER TABLE public."JUR_PATRIMONIOS" ADD COLUMN IF NOT EXISTS empresa_pagadora text;

INSERT INTO public."JUR_OBRIGACOES"
  (patrimonio_id, categoria, descricao, valor, vencimento, periodicidade, responsavel, status, created_at)
SELECT
  c.patrimonio_id,
  COALESCE(NULLIF(btrim(c.categoria), ''), 'Outros'),
  c.descricao, c.valor, c.data_inicio,
  CASE WHEN c.possui_recorrencia THEN 'Mensal' ELSE 'Único' END,
  c.responsavel, 'Pendente', c.created_at
FROM public."JUR_CONTAS" c
WHERE c.patrimonio_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."JUR_OBRIGACOES" o
    WHERE o.patrimonio_id = c.patrimonio_id
      AND COALESCE(o.descricao, '') = COALESCE(c.descricao, '')
      AND o.categoria = COALESCE(NULLIF(btrim(c.categoria), ''), 'Outros')
      AND o.valor IS NOT DISTINCT FROM c.valor
  );

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Central de Dúvidas Jurídicas (base de conhecimento Q&A)
-- Todos perguntam/leem; só Jurídico (Trabalhando) responde (via is_juridico_ativo).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_juridico_ativo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
    WHERE e.auth_user_id = auth.uid()
      AND e."Setor_ERP" = 'JURIDICO'
      AND e."Situação"  = 'Trabalhando'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_juridico_ativo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_juridico_ativo() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_juridico_ativo() TO authenticated;

CREATE TABLE IF NOT EXISTS public."JUR_DUVIDAS" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  autor_id       uuid DEFAULT auth.uid(),
  autor_nome     text,
  titulo         text NOT NULL,
  pergunta       text NOT NULL,
  categoria      text,
  status         text NOT NULL DEFAULT 'Aberta',
  resposta       text,
  respondido_por text,
  respondido_em  timestamptz,
  publicada      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS jur_duvidas_status_idx ON public."JUR_DUVIDAS"(status);
CREATE INDEX IF NOT EXISTS jur_duvidas_autor_idx  ON public."JUR_DUVIDAS"(autor_id);
CREATE INDEX IF NOT EXISTS jur_duvidas_criado_idx ON public."JUR_DUVIDAS"(created_at DESC);
ALTER TABLE public."JUR_DUVIDAS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_DUVIDAS" TO authenticated;
DROP POLICY IF EXISTS jur_duvidas_select ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_select ON public."JUR_DUVIDAS" FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS jur_duvidas_insert ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_insert ON public."JUR_DUVIDAS" FOR INSERT TO authenticated WITH CHECK (autor_id = auth.uid());
DROP POLICY IF EXISTS jur_duvidas_update ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_update ON public."JUR_DUVIDAS" FOR UPDATE TO authenticated USING (public.is_juridico_ativo()) WITH CHECK (public.is_juridico_ativo());
DROP POLICY IF EXISTS jur_duvidas_delete ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_delete ON public."JUR_DUVIDAS" FOR DELETE TO authenticated USING (public.is_juridico_ativo());

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Sistema de Processos (RLS/grants das tabelas migradas do Flask)
-- Leitura: autenticados; escrita: só Jurídico (is_juridico_ativo).
-- Comentários de processo usam o feed único SISTEMA_COMENTARIOS
-- (modulo='processo'); a antiga SISTEMA_JURIDICO_COMENTARIOS não é mais
-- criada (ver 20260710000001).
-- =========================================================================
DO $$
DECLARE t text; seqname text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SISTEMA_JURIDICORT','SISTEMA_JURIDICORT_dort'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      seqname := pg_get_serial_sequence('public."'||t||'"', 'id');
      IF seqname IS NOT NULL THEN
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seqname);
      END IF;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_all_auth', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_all_auth', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- CONSOLIDAÇÃO E RENOMEAÇÃO DE TABELAS (016)
--   1. Dropa mortas JUR_CONTAS / JUR_CONTA_LANCAMENTOS (já fundidas em Obrigações).
--   2. SISTEMA_COMENTARIOS = feed único (patrimônio/processo/férias/bonif) + drop dos 4.
--   3. Renomeia filhas de patrimônio -> JUR_PATRIMONIO_* e Flask -> JUR_PROCESSOS*.
-- Idempotente. Renames via to_regclass; backfill some ao re-rodar (origens dropadas).
-- =========================================================================

-- 1. Contas (mortas) → Obrigações, depois drop ----------------------------
DO $$
BEGIN
  IF to_regclass('public."JUR_CONTAS"') IS NOT NULL
     AND to_regclass('public."JUR_OBRIGACOES"') IS NOT NULL THEN
    INSERT INTO public."JUR_OBRIGACOES"
      (patrimonio_id, categoria, descricao, valor, vencimento, periodicidade, responsavel, status, created_at)
    SELECT c.patrimonio_id, COALESCE(NULLIF(btrim(c.categoria), ''), 'Outros'),
           c.descricao, c.valor, c.data_inicio,
           CASE WHEN c.possui_recorrencia THEN 'Mensal' ELSE 'Único' END,
           c.responsavel, 'Pendente', c.created_at
    FROM public."JUR_CONTAS" c
    WHERE c.patrimonio_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public."JUR_OBRIGACOES" o
        WHERE o.patrimonio_id = c.patrimonio_id
          AND COALESCE(o.descricao, '') = COALESCE(c.descricao, '')
          AND o.categoria = COALESCE(NULLIF(btrim(c.categoria), ''), 'Outros')
          AND o.valor IS NOT DISTINCT FROM c.valor);
  END IF;
END $$;
DROP TABLE IF EXISTS public."JUR_CONTA_LANCAMENTOS";
DROP TABLE IF EXISTS public."JUR_CONTAS";

-- 2. Feed único de comentários --------------------------------------------
CREATE TABLE IF NOT EXISTS public."SISTEMA_COMENTARIOS" (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  modulo      text NOT NULL,
  entidade_id text NOT NULL,
  autor_nome  text,
  autor_cpf   text,
  texto       text NOT NULL
);
CREATE INDEX IF NOT EXISTS sistema_coment_ent_idx ON public."SISTEMA_COMENTARIOS"(modulo, entidade_id);

DO $$
BEGIN
  IF to_regclass('public."JUR_COMENTARIOS"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto, created_at)
    SELECT 'patrimonio', c.patrimonio_id::text, c.autor, c.texto, c.created_at
      FROM public."JUR_COMENTARIOS" c WHERE c.patrimonio_id IS NOT NULL;
    DROP TABLE public."JUR_COMENTARIOS";
  END IF;
  IF to_regclass('public."SISTEMA_JURIDICO_COMENTARIOS"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto, created_at)
    SELECT 'processo', c.numero_processo, c.autor, c.comentario, c.criado_em
      FROM public."SISTEMA_JURIDICO_COMENTARIOS" c WHERE c.numero_processo IS NOT NULL;
    DROP TABLE public."SISTEMA_JURIDICO_COMENTARIOS";
  END IF;
  IF to_regclass('public."SISTEMA_SOL_FERIAS_CHAT"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto, created_at)
    SELECT 'ferias', c.solicitacao_id::text, c.autor_nome, c.autor_cpf, c.mensagem, c.criado_em
      FROM public."SISTEMA_SOL_FERIAS_CHAT" c WHERE c.solicitacao_id IS NOT NULL;
    DROP TABLE public."SISTEMA_SOL_FERIAS_CHAT";
  END IF;
  IF to_regclass('public."SISTEMA_SOL_BONIF_CHAT"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto, created_at)
    SELECT 'bonificacao', c.solicitacao_id::text, c.autor_nome, c.autor_cpf, c.mensagem, c.criado_em
      FROM public."SISTEMA_SOL_BONIF_CHAT" c WHERE c.solicitacao_id IS NOT NULL;
    DROP TABLE public."SISTEMA_SOL_BONIF_CHAT";
  END IF;
END $$;

ALTER TABLE public."SISTEMA_COMENTARIOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_COMENTARIOS" TO authenticated;
DROP POLICY IF EXISTS "SISTEMA_COMENTARIOS_all_auth" ON public."SISTEMA_COMENTARIOS";
CREATE POLICY "SISTEMA_COMENTARIOS_all_auth" ON public."SISTEMA_COMENTARIOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Renomeia tabelas p/ nomes autoexplicativos ---------------------------
DO $$
BEGIN
  IF to_regclass('public."JUR_OBRIGACOES"') IS NOT NULL AND to_regclass('public."JUR_PATRIMONIO_OBRIGACOES"') IS NULL THEN
    ALTER TABLE public."JUR_OBRIGACOES" RENAME TO "JUR_PATRIMONIO_OBRIGACOES";
    DROP POLICY IF EXISTS "JUR_OBRIGACOES_all_auth" ON public."JUR_PATRIMONIO_OBRIGACOES";
  END IF;
  IF to_regclass('public."JUR_DOCUMENTOS"') IS NOT NULL AND to_regclass('public."JUR_PATRIMONIO_DOCUMENTOS"') IS NULL THEN
    ALTER TABLE public."JUR_DOCUMENTOS" RENAME TO "JUR_PATRIMONIO_DOCUMENTOS";
    DROP POLICY IF EXISTS "JUR_DOCUMENTOS_all_auth" ON public."JUR_PATRIMONIO_DOCUMENTOS";
  END IF;
  IF to_regclass('public."JUR_CONTATOS"') IS NOT NULL AND to_regclass('public."JUR_PATRIMONIO_CONTATOS"') IS NULL THEN
    ALTER TABLE public."JUR_CONTATOS" RENAME TO "JUR_PATRIMONIO_CONTATOS";
    DROP POLICY IF EXISTS "JUR_CONTATOS_all_auth" ON public."JUR_PATRIMONIO_CONTATOS";
  END IF;
  IF to_regclass('public."JUR_ACESSOS"') IS NOT NULL AND to_regclass('public."JUR_PATRIMONIO_ACESSOS"') IS NULL THEN
    ALTER TABLE public."JUR_ACESSOS" RENAME TO "JUR_PATRIMONIO_ACESSOS";
    DROP POLICY IF EXISTS "JUR_ACESSOS_all_auth" ON public."JUR_PATRIMONIO_ACESSOS";
  END IF;
  IF to_regclass('public."JUR_HISTORICO"') IS NOT NULL AND to_regclass('public."JUR_PATRIMONIO_HISTORICO"') IS NULL THEN
    ALTER TABLE public."JUR_HISTORICO" RENAME TO "JUR_PATRIMONIO_HISTORICO";
    DROP POLICY IF EXISTS "JUR_HISTORICO_all_auth" ON public."JUR_PATRIMONIO_HISTORICO";
  END IF;
  IF to_regclass('public."SISTEMA_JURIDICORT"') IS NOT NULL AND to_regclass('public."JUR_PROCESSOS"') IS NULL THEN
    ALTER TABLE public."SISTEMA_JURIDICORT" RENAME TO "JUR_PROCESSOS";
    DROP POLICY IF EXISTS "SISTEMA_JURIDICORT_all_auth" ON public."JUR_PROCESSOS";
  END IF;
  IF to_regclass('public."SISTEMA_JURIDICORT_dort"') IS NOT NULL AND to_regclass('public."JUR_PROCESSOS_DORT"') IS NULL THEN
    ALTER TABLE public."SISTEMA_JURIDICORT_dort" RENAME TO "JUR_PROCESSOS_DORT";
    DROP POLICY IF EXISTS "SISTEMA_JURIDICORT_dort_all_auth" ON public."JUR_PROCESSOS_DORT";
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'JUR_PATRIMONIO_OBRIGACOES','JUR_PATRIMONIO_DOCUMENTOS','JUR_PATRIMONIO_CONTATOS',
    'JUR_PATRIMONIO_ACESSOS','JUR_PATRIMONIO_HISTORICO','JUR_PROCESSOS','JUR_PROCESSOS_DORT'
  ] LOOP
    IF to_regclass('public."'||t||'"') IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all_auth', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t || '_all_auth', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Patrimônio: funde 4 filhas-sidecar em JUR_PATRIMONIO_ITENS (017)
--   CONTATOS + ACESSOS + DOCUMENTOS + HISTORICO -> 1 tabela (coluna `kind`).
--   OBRIGACOES fica separada (núcleo financeiro). Filhas de patrimônio: 5 -> 2.
-- Idempotente: backfill some ao re-rodar (origens dropadas).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_ITENS" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  patrimonio_id bigint REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  kind          text NOT NULL,        -- 'contato' | 'acesso' | 'documento' | 'historico'
  tipo          text, nome text, telefone text, email text, observacao text,
  servico       text, link text, usuario text, local_senha text,
  storage_path  text, versao int, criado_por text,
  acao          text, detalhe text, autor text
);
CREATE INDEX IF NOT EXISTS jur_pat_itens_idx ON public."JUR_PATRIMONIO_ITENS"(patrimonio_id, kind);

DO $$
BEGIN
  IF to_regclass('public."JUR_PATRIMONIO_CONTATOS"') IS NOT NULL THEN
    INSERT INTO public."JUR_PATRIMONIO_ITENS" (patrimonio_id, kind, tipo, nome, telefone, email, observacao, created_at)
    SELECT patrimonio_id, 'contato', tipo, nome, telefone, email, observacao, created_at FROM public."JUR_PATRIMONIO_CONTATOS";
    DROP TABLE public."JUR_PATRIMONIO_CONTATOS";
  END IF;
  IF to_regclass('public."JUR_PATRIMONIO_ACESSOS"') IS NOT NULL THEN
    INSERT INTO public."JUR_PATRIMONIO_ITENS" (patrimonio_id, kind, servico, link, usuario, local_senha, observacao, created_at)
    SELECT patrimonio_id, 'acesso', servico, link, usuario, local_senha, observacao, created_at FROM public."JUR_PATRIMONIO_ACESSOS";
    DROP TABLE public."JUR_PATRIMONIO_ACESSOS";
  END IF;
  IF to_regclass('public."JUR_PATRIMONIO_DOCUMENTOS"') IS NOT NULL THEN
    INSERT INTO public."JUR_PATRIMONIO_ITENS" (patrimonio_id, kind, tipo, nome, storage_path, versao, criado_por, created_at)
    SELECT patrimonio_id, 'documento', tipo, nome, storage_path, versao, criado_por, created_at FROM public."JUR_PATRIMONIO_DOCUMENTOS";
    DROP TABLE public."JUR_PATRIMONIO_DOCUMENTOS";
  END IF;
  IF to_regclass('public."JUR_PATRIMONIO_HISTORICO"') IS NOT NULL THEN
    INSERT INTO public."JUR_PATRIMONIO_ITENS" (patrimonio_id, kind, acao, detalhe, autor, created_at)
    SELECT patrimonio_id, 'historico', acao, detalhe, autor, created_at FROM public."JUR_PATRIMONIO_HISTORICO";
    DROP TABLE public."JUR_PATRIMONIO_HISTORICO";
  END IF;
END $$;

ALTER TABLE public."JUR_PATRIMONIO_ITENS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_PATRIMONIO_ITENS" TO authenticated;
DROP POLICY IF EXISTS "JUR_PATRIMONIO_ITENS_all_auth" ON public."JUR_PATRIMONIO_ITENS";
CREATE POLICY "JUR_PATRIMONIO_ITENS_all_auth" ON public."JUR_PATRIMONIO_ITENS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Processos: colunas de valor bigint/integer -> numeric (018)
--   (guardam centavos; bigint quebrava carga e gravação pela tela). Idempotente.
-- =========================================================================
DO $$
DECLARE c text;
BEGIN
  IF to_regclass('public."JUR_PROCESSOS"') IS NOT NULL THEN
    FOREACH c IN ARRAY ARRAY[
      'valor_pericia_empresa','valor_pedidos','valor_acordo','valor_sentenca','valor_final',
      'valor_deposito_recursal','valor_seguro_garantia','valor_custas_processuais',
      'valor_pericia_contabil','valor_outros_custos','demais_encargos','valor_causa'
    ] LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='JUR_PROCESSOS'
          AND column_name=c AND data_type IN ('bigint','integer')
      ) THEN
        EXECUTE format('ALTER TABLE public."JUR_PROCESSOS" ALTER COLUMN %I TYPE numeric USING %I::numeric', c, c);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Processos: PK no surrogate id (identity); "ID" vira coluna comum (019)
--
-- Veio do Flask com a PK na coluna legada "ID", mas o modelo é "1 linha por
-- motivo" (mesmo processo em várias linhas, "ID" repetido/NULL). A PK real é
-- id (minúsculo, identity) — por onde o app ordena/deduplica. Sem isso o seed
-- estourava (duplicate key / null em id). O reload no fim é obrigatório: sem
-- ele a tela fica vazia (load() engole o erro do schema cache velho). Idempotente.
-- =========================================================================
DO $$
DECLARE
  v_pk   text;
  v_base bigint;
  v_max  bigint;
BEGIN
  IF to_regclass('public."JUR_PROCESSOS"') IS NULL THEN
    RETURN;
  END IF;

  -- 1) Coluna surrogate id.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='JUR_PROCESSOS' AND column_name='id'
  ) THEN
    EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN id bigint';
  END IF;

  -- 2) Backfill de ids nulos (acima do maior id já existente).
  SELECT COALESCE(max(id), 0) INTO v_base FROM public."JUR_PROCESSOS" WHERE id IS NOT NULL;
  EXECUTE format($f$
    UPDATE public."JUR_PROCESSOS" p
       SET id = s.rn
      FROM (
        SELECT ctid, %s + row_number() OVER (ORDER BY ctid) AS rn
          FROM public."JUR_PROCESSOS" WHERE id IS NULL
      ) s
     WHERE p.ctid = s.ctid
  $f$, v_base);

  -- 3) Remove a PRIMARY KEY atual se ela NÃO for exatamente (id).
  SELECT conname INTO v_pk FROM pg_constraint
   WHERE conrelid='public."JUR_PROCESSOS"'::regclass AND contype='p';
  IF v_pk IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.conname=v_pk AND con.conrelid='public."JUR_PROCESSOS"'::regclass
      AND a.attname='id' AND array_length(con.conkey,1)=1
  ) THEN
    EXECUTE format('ALTER TABLE public."JUR_PROCESSOS" DROP CONSTRAINT %I', v_pk);
  END IF;

  -- 4) "ID" legado vira coluna comum, anulável.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='JUR_PROCESSOS' AND column_name='ID'
  ) THEN
    EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ALTER COLUMN "ID" DROP NOT NULL';
  END IF;

  -- 5) id NOT NULL + IDENTITY.
  EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ALTER COLUMN id SET NOT NULL';
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='JUR_PROCESSOS'
      AND column_name='id' AND is_identity='YES'
  ) THEN
    EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ALTER COLUMN id DROP DEFAULT';
    EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY';
  END IF;

  -- 6) id como PRIMARY KEY (se ainda não houver PK).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public."JUR_PROCESSOS"'::regclass AND contype='p'
  ) THEN
    EXECUTE 'ALTER TABLE public."JUR_PROCESSOS" ADD PRIMARY KEY (id)';
  END IF;

  -- 7) Sequência da identity acima do maior id (evita colisão em INSERT futuro).
  SELECT COALESCE(max(id), 0) INTO v_max FROM public."JUR_PROCESSOS";
  PERFORM setval(pg_get_serial_sequence('public."JUR_PROCESSOS"','id'), v_max + 1, false);
END $$;

ALTER TABLE public."JUR_PROCESSOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_PROCESSOS" TO authenticated;
DROP POLICY IF EXISTS "JUR_PROCESSOS_all_auth" ON public."JUR_PROCESSOS";
CREATE POLICY "JUR_PROCESSOS_all_auth" ON public."JUR_PROCESSOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Gestão de Advertências (020): solicitação → aprovação → jurídico
--   Encarregado cria → 'Aguardando Aprovação' → analista do contrato aprova/
--   reprova → 'Aguardando Jurídico' | 'Reprovada' → Jurídico conclui →
--   'Concluída'. Colaborador obrigatório (EMPREGADOS). Idempotente.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_ADVERTENCIA" (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  status_changed_at   timestamptz NOT NULL DEFAULT now(),
  solicitante_nome    text,
  solicitante_email   text,
  colaborador_id      bigint,
  colaborador_nome    text NOT NULL,
  colaborador_cpf     text,
  colaborador_cargo   text,
  colaborador_filial  text,
  contrato            text,
  contrato_id         bigint,
  tipo_advertencia        text,
  grau                    text,
  descricao_ocorrido      text,
  data_ocorrido           date,
  ja_advertencia_anterior boolean NOT NULL DEFAULT false,
  detalhe_anterior        text,
  advertencia_verbal_dada boolean NOT NULL DEFAULT false,
  data_advertencia_verbal date,
  status              text NOT NULL DEFAULT 'Aguardando Aprovação',
  aprovado_por_nome   text,
  motivo_reprovacao   text,
  parecer_juridico    text,
  resultado           text,
  concluido_por_nome  text
);
CREATE INDEX IF NOT EXISTS adv_status_idx      ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"(status);
CREATE INDEX IF NOT EXISTS adv_contrato_idx    ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"(contrato_id);
CREATE INDEX IF NOT EXISTS adv_solicitante_idx ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"(solicitante_email);
CREATE INDEX IF NOT EXISTS adv_criado_idx      ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"(created_at DESC);

CREATE OR REPLACE FUNCTION public.adv_track_status_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_adv_track_status ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_track_status
  BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.adv_track_status_change();

ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" TO authenticated;
DROP POLICY IF EXISTS "SISTEMA_SOLICITACOES_ADVERTENCIA_all_auth" ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY "SISTEMA_SOLICITACOES_ADVERTENCIA_all_auth" ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ORIENTAÇÕES JURÍDICAS (021): aprovação (Diretor Administrativo/aprovadores)
--   antes do Jurídico responder. Biblioteca pública sem nome de quem perguntou.
-- =========================================================================
ALTER TABLE public."JUR_DUVIDAS" ADD COLUMN IF NOT EXISTS aprovado_por      text;
ALTER TABLE public."JUR_DUVIDAS" ADD COLUMN IF NOT EXISTS aprovado_em       timestamptz;
ALTER TABLE public."JUR_DUVIDAS" ADD COLUMN IF NOT EXISTS motivo_reprovacao text;

CREATE TABLE IF NOT EXISTS public."JUR_DUVIDAS_APROVADORES" (
  empregado_id bigint PRIMARY KEY,
  nome         text,
  criado_por   text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."JUR_DUVIDAS_APROVADORES" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_DUVIDAS_APROVADORES" TO authenticated;
DROP POLICY IF EXISTS jur_duvidas_aprov_all ON public."JUR_DUVIDAS_APROVADORES";
CREATE POLICY jur_duvidas_aprov_all ON public."JUR_DUVIDAS_APROVADORES"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.pode_aprovar_duvida()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
    WHERE e.auth_user_id = auth.uid()
      AND e."Situação" = 'Trabalhando'
      AND ( e."Setor_ERP" = 'DIRETOR ADMINISTRATIVO'
            OR EXISTS (SELECT 1 FROM public."JUR_DUVIDAS_APROVADORES" a WHERE a.empregado_id = e."ID") )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.pode_aprovar_duvida() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pode_aprovar_duvida() TO authenticated;

DROP POLICY IF EXISTS jur_duvidas_update ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_update ON public."JUR_DUVIDAS" FOR UPDATE TO authenticated
  USING (public.is_juridico_ativo() OR public.pode_aprovar_duvida())
  WITH CHECK (public.is_juridico_ativo() OR public.pode_aprovar_duvida());

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- JURÍDICO — Obrigações: caminho para pagar + comprovante (022). Idempotente.
-- =========================================================================
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" ADD COLUMN IF NOT EXISTS onde_pagar       text;
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" ADD COLUMN IF NOT EXISTS comprovante_path text;
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" ADD COLUMN IF NOT EXISTS comprovante_nome text;
NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- JURÍDICO — Advertências: exceção de prazo (024). Idempotente.
-- =========================================================================
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA" ADD COLUMN IF NOT EXISTS excecao               boolean NOT NULL DEFAULT false;
ALTER TABLE public."SISTEMA_SOLICITACOES_ADVERTENCIA" ADD COLUMN IF NOT EXISTS justificativa_excecao text;
NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- RH — Colaboradores: UPDATE de campos RH na EMPREGADOS (025). Idempotente.
-- =========================================================================
ALTER TABLE public."EMPREGADOS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empregados_update_rh ON public."EMPREGADOS";
CREATE POLICY empregados_update_rh ON public."EMPREGADOS"
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ORIENTAÇÕES JURÍDICAS — respondedores configuráveis (003). Idempotente.
-- Admin (Parecer Jurídico) define pessoas que respondem ALÉM do setor JURIDICO.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public."JUR_DUVIDAS_RESPONSAVEIS" (
  empregado_id bigint PRIMARY KEY,
  nome         text,
  criado_por   text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."JUR_DUVIDAS_RESPONSAVEIS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_DUVIDAS_RESPONSAVEIS" TO authenticated;
DROP POLICY IF EXISTS jur_duvidas_resp_all ON public."JUR_DUVIDAS_RESPONSAVEIS";
CREATE POLICY jur_duvidas_resp_all ON public."JUR_DUVIDAS_RESPONSAVEIS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.pode_responder_duvida()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
    WHERE e.auth_user_id = auth.uid()
      AND e."Situação" = 'Trabalhando'
      AND ( e."Setor_ERP" = 'JURIDICO'
            OR EXISTS (SELECT 1 FROM public."JUR_DUVIDAS_RESPONSAVEIS" r WHERE r.empregado_id = e."ID") )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.pode_responder_duvida() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pode_responder_duvida() TO authenticated;

DROP POLICY IF EXISTS jur_duvidas_update ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_update ON public."JUR_DUVIDAS" FOR UPDATE TO authenticated
  USING (public.pode_responder_duvida() OR public.pode_aprovar_duvida())
  WITH CHECK (public.pode_responder_duvida() OR public.pode_aprovar_duvida());

DROP POLICY IF EXISTS jur_duvidas_delete ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_delete ON public."JUR_DUVIDAS" FOR DELETE TO authenticated
  USING (public.pode_responder_duvida());

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260630000001_recrutamento_fluxo_candidatos.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO: novo fluxo em 2 níveis
--
-- 1. Solicitação (board externo) — fluxo curto:
--    Pendente Operacional → Pendente Recrutamento → Seleção de Candidato
--    → Concluída (manual) ; Reprovada continua existindo.
--
-- 2. Candidato (kanban interno por solicitação) — anda dentro de WA_CURRICULOS:
--    Selecionado → Pendente Jurídico → ASO → Admissão ; estado Reprovado.
--    Jurídico e SST têm fila própria via VW_RECRUTAMENTO_CANDIDATOS.
--
-- O portal público continua publicando as vagas que estão em 'Seleção de Candidato'.
--
-- Idempotente: pode rodar mais de uma vez sem erro.
-- =========================================================================

-- ── 1a. Renomear/consolidar status das solicitações existentes ───────────
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Pendente Operacional'
  WHERE status = 'Aguardando Aprovação';
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Pendente Recrutamento'
  WHERE status = 'Aguardando Recrutamento';
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Seleção de Candidato'
  WHERE status IN (
    'Aprovada','Vaga Aberta','Seleção de Currículos','Em Processo Seletivo',
    'Entrevistas','Entrevista com Gestor','Entrevista com Psicóloga',
    'Aguardando Documentação','Aguardando ASO','Funcionário Selecionado'
  );
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Concluída'
  WHERE status = 'Contratado';

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ALTER COLUMN status SET DEFAULT 'Pendente Operacional';

-- ── 1b. Colunas de processo do candidato em WA_CURRICULOS ────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS cpf               text,
  ADD COLUMN IF NOT EXISTS cpf_cand          text,
  ADD COLUMN IF NOT EXISTS etapa_processo    text,
  ADD COLUMN IF NOT EXISTS etapa_changed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS selecionado_por   text,
  ADD COLUMN IF NOT EXISTS selecionado_em    timestamptz,
  ADD COLUMN IF NOT EXISTS juridico_ok       boolean,
  ADD COLUMN IF NOT EXISTS juridico_obs      text,
  ADD COLUMN IF NOT EXISTS juridico_por      text,
  ADD COLUMN IF NOT EXISTS juridico_em       timestamptz,
  ADD COLUMN IF NOT EXISTS sst_ok            boolean,
  ADD COLUMN IF NOT EXISTS sst_obs           text,
  ADD COLUMN IF NOT EXISTS sst_por           text,
  ADD COLUMN IF NOT EXISTS sst_em            timestamptz,
  ADD COLUMN IF NOT EXISTS admitido_em       timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_reprovacao text;

CREATE INDEX IF NOT EXISTS wac_etapa_idx ON public."WA_CURRICULOS"(etapa_processo);

-- ── 1c. View das filas Jurídico/SST (candidato × vaga) ───────────────────
-- Junta os candidatos em processo (etapa_processo preenchida) com os dados da
-- vaga, para as telas de Jurídico (Pendente Jurídico) e SST (ASO).
CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id                        AS candidato_id,
    c.vaga_id,
    c.nome,
    c.telefone,
    c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem,
    c.storage_path,
    c.mensagem,
    c.etapa_processo,
    c.etapa_changed_at,
    c.selecionado_por,
    c.selecionado_em,
    c.juridico_ok,
    c.juridico_obs,
    c.juridico_por,
    c.juridico_em,
    c.sst_ok,
    c.sst_obs,
    c.sst_por,
    c.sst_em,
    c.admitido_em,
    c.motivo_reprovacao,
    c.created_at                AS candidatura_em,
    s.cargo,
    s.contrato,
    s.cidade,
    s.status                    AS vaga_status
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  WHERE c.etapa_processo IS NOT NULL;

GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

-- ── 1d. RPCs do portal: publicar vagas em 'Seleção de Candidato' ─────────
CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE (cidade text, vagas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(btrim("cidade"), '') AS cidade, count(*)::bigint AS vagas
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Seleção de Candidato'
    AND NULLIF(btrim("cidade"), '') IS NOT NULL
  GROUP BY NULLIF(btrim("cidade"), '')
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.portal_cidades_com_vagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_cidades_com_vagas() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE (
  id integer, cargo text, contrato text, cidade text,
  escala text, salario text, beneficios text, quantidade_vagas integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT "id", "cargo", "contrato", "cidade",
         "escala", "salario", "beneficios", "quantidade_vagas"
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Seleção de Candidato'
    AND btrim(lower("cidade")) = btrim(lower(coalesce(p_cidade, '')))
  ORDER BY "cargo";
$$;
REVOKE ALL ON FUNCTION public.portal_vagas_por_cidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_vagas_por_cidade(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_candidatar(
  p_vaga_id      integer,
  p_nome         text,
  p_telefone     text,
  p_email        text,
  p_cpf          text,
  p_mensagem     text,
  p_arquivo_nome text,
  p_storage_path text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_id     bigint;
  v_field  record;
  v_col    text;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.');
  END IF;
  IF coalesce(btrim(p_telefone), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.');
  END IF;

  SELECT "status" INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE "id" = p_vaga_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.');
  END IF;
  IF v_status <> 'Seleção de Candidato' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
  END IF;

  INSERT INTO public."WA_CURRICULOS" (vaga_id, origem)
  VALUES (p_vaga_id, 'Portal')
  RETURNING id INTO v_id;

  FOR v_field IN
    SELECT t.cands, t.val FROM (VALUES
      (ARRAY['nome','nome_cand','nome_candidato'],    btrim(p_nome)),
      (ARRAY['telefone','fone','celular','whatsapp'], btrim(p_telefone)),
      (ARRAY['email','email_cand'],                   NULLIF(btrim(p_email), '')),
      (ARRAY['cpf','cpf_cand'],                       NULLIF(btrim(p_cpf), '')),
      (ARRAY['mensagem','observacao','obs'],          NULLIF(btrim(p_mensagem), '')),
      (ARRAY['arquivo_nome','nome_arquivo'],          NULLIF(btrim(p_arquivo_nome), '')),
      (ARRAY['storage_path','arquivo_path','path'],   NULLIF(btrim(p_storage_path), ''))
    ) AS t(cands, val)
    WHERE t.val IS NOT NULL
  LOOP
    SELECT c.column_name INTO v_col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'WA_CURRICULOS'
      AND c.column_name::text = ANY (v_field.cands)
    ORDER BY array_position(v_field.cands, c.column_name::text)
    LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('UPDATE public."WA_CURRICULOS" SET %I = $1 WHERE id = $2', v_col)
        USING v_field.val, v_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260703000001_recrutamento_historico.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO_HISTORICO — trilha (append-only) de movimentações
--
-- Registra QUALQUER movimento de uma solicitação e de seus candidatos:
-- criação, aprovação do Operacional, confirmação do Recrutamento, seleção de
-- candidato, liberação do Jurídico, ASO do SST, conclusão e reprovações.
-- Cada linha guarda o evento, de/para status, o papel e QUEM fez.
--
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_HISTORICO" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  solicitacao_id  bigint REFERENCES public."SISTEMA_RECRUTAMENTO"(id) ON DELETE CASCADE,
  candidato_id    bigint,
  candidato_nome  text,
  evento          text,        -- ex.: 'Aprovada pelo Operacional', 'Candidato selecionado'
  de_status       text,
  para_status     text,
  papel           text,        -- 'Solicitante','Operacional','Recrutamento','Jurídico','SST'
  usuario_nome    text,
  usuario_email   text,
  detalhe         text         -- motivo/observação
);

CREATE INDEX IF NOT EXISTS rec_hist_sol_idx
  ON public."RECRUTAMENTO_HISTORICO"(solicitacao_id, created_at);

ALTER TABLE public."RECRUTAMENTO_HISTORICO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public."RECRUTAMENTO_HISTORICO" TO authenticated;

DROP POLICY IF EXISTS rec_hist_all ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY rec_hist_all ON public."RECRUTAMENTO_HISTORICO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260704000001_recrutamento_fluxo_completo.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO: pipeline completo por setor
--
-- Etapas do candidato (WA_CURRICULOS.etapa_processo):
--   Selecionado → Pendente Jurídico → Entrevista Comportamental →
--   (Exame Médico | Entrevista Técnica → Exame Médico) → Compras → Admissão
--   ; Reprovado (terminal).
--
-- Cada setor tem fila própria via VW_RECRUTAMENTO_CANDIDATOS (agora com a vaga
-- COMPLETA + restrição do CPF). Restrição = RECRUTAMENTO_CPF_BLACKLIST (só o
-- Jurídico define), por CPF, aparece em qualquer vaga.
--
-- Idempotente.
-- =========================================================================

-- ── Colunas novas das etapas em WA_CURRICULOS ────────────────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS comportamental_por   text,
  ADD COLUMN IF NOT EXISTS comportamental_em    timestamptz,
  ADD COLUMN IF NOT EXISTS comportamental_obs   text,
  ADD COLUMN IF NOT EXISTS tecnica_por          text,
  ADD COLUMN IF NOT EXISTS tecnica_em           timestamptz,
  ADD COLUMN IF NOT EXISTS tecnica_obs          text,
  ADD COLUMN IF NOT EXISTS compras_necessidades text,
  ADD COLUMN IF NOT EXISTS compras_por          text,
  ADD COLUMN IF NOT EXISTS compras_em           timestamptz,
  ADD COLUMN IF NOT EXISTS compras_obs          text,
  ADD COLUMN IF NOT EXISTS admitido_por         text,
  ADD COLUMN IF NOT EXISTS empregado_id         bigint;

-- Dados antigos: ASO vira "Exame Médico".
UPDATE public."WA_CURRICULOS" SET etapa_processo = 'Exame Médico'
  WHERE etapa_processo = 'ASO';

-- ── View das filas: vaga COMPLETA + candidato + restrição do CPF ─────────
CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id                        AS candidato_id,
    c.vaga_id,
    c.nome,
    c.telefone,
    c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem,
    c.storage_path,
    c.mensagem,
    c.etapa_processo,
    c.etapa_changed_at,
    c.selecionado_por,
    c.selecionado_em,
    c.juridico_ok,   c.juridico_obs,   c.juridico_por,   c.juridico_em,
    c.comportamental_por, c.comportamental_em, c.comportamental_obs,
    c.tecnica_por,   c.tecnica_em,     c.tecnica_obs,
    c.sst_ok,        c.sst_obs,        c.sst_por,        c.sst_em,
    c.compras_necessidades,
    c.compras_por,   c.compras_em,     c.compras_obs,
    c.admitido_por,  c.admitido_em,    c.empregado_id,
    c.motivo_reprovacao,
    c.created_at                AS candidatura_em,
    -- Vaga (completa)
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    -- Restrição do CPF (definida só pelo Jurídico)
    (b.cpf_digits IS NOT NULL)  AS possui_restricao,
    b.motivo                    AS restricao_motivo
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

-- ── EMPREGADOS: liberar INSERT (admissão cria novo colaborador) ──────────
-- Hoje só existe policy de UPDATE; a tela "Novas Admissões" precisa inserir.
ALTER TABLE public."EMPREGADOS" ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public."EMPREGADOS" TO authenticated;

DROP POLICY IF EXISTS empregados_insert_auth ON public."EMPREGADOS";
CREATE POLICY empregados_insert_auth ON public."EMPREGADOS"
  FOR INSERT TO authenticated WITH CHECK (true);

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260705000001_recrutamento_dois_trilhos.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO — dois trilhos de status
--
-- 1) Status da Solicitação (SISTEMA_RECRUTAMENTO.status) avança AUTOMATICAMENTE
--    espelhando o candidato selecionado mais avançado (trigger).
-- 2) Status do Candidato (WA_CURRICULOS.etapa_processo) = kanban de 9 colunas:
--    ENTRADA → TRIAGEM → JURÍDICO → ENTREVISTA → ENTREVISTA GESTOR → APROVADOS →
--    EXAME SST → COMPRAS → DOCUMENTAÇÃO  (+ Reprovado).
--
-- Idempotente.
-- =========================================================================

-- ── Colunas usadas pela view/fluxo (auto-suficiente; IF NOT EXISTS) ──────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS cpf                  text,
  ADD COLUMN IF NOT EXISTS cpf_cand             text,
  ADD COLUMN IF NOT EXISTS etapa_processo       text,
  ADD COLUMN IF NOT EXISTS etapa_changed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS selecionado_por      text,
  ADD COLUMN IF NOT EXISTS selecionado_em       timestamptz,
  ADD COLUMN IF NOT EXISTS juridico_ok          boolean,
  ADD COLUMN IF NOT EXISTS juridico_obs         text,
  ADD COLUMN IF NOT EXISTS juridico_por         text,
  ADD COLUMN IF NOT EXISTS juridico_em          timestamptz,
  ADD COLUMN IF NOT EXISTS sst_ok               boolean,
  ADD COLUMN IF NOT EXISTS sst_obs              text,
  ADD COLUMN IF NOT EXISTS sst_por              text,
  ADD COLUMN IF NOT EXISTS sst_em               timestamptz,
  ADD COLUMN IF NOT EXISTS compras_necessidades text,
  ADD COLUMN IF NOT EXISTS compras_por          text,
  ADD COLUMN IF NOT EXISTS compras_em           timestamptz,
  ADD COLUMN IF NOT EXISTS compras_obs          text,
  ADD COLUMN IF NOT EXISTS admitido_por         text,
  ADD COLUMN IF NOT EXISTS admitido_em          timestamptz,
  ADD COLUMN IF NOT EXISTS empregado_id         bigint,
  ADD COLUMN IF NOT EXISTS motivo_reprovacao    text,
  ADD COLUMN IF NOT EXISTS epis_informados      boolean,
  ADD COLUMN IF NOT EXISTS epis_informados_em   timestamptz,
  ADD COLUMN IF NOT EXISTS enviado_admissao_por text,
  ADD COLUMN IF NOT EXISTS enviado_admissao_em  timestamptz;

CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_CPF_BLACKLIST" (
  cpf_digits text PRIMARY KEY, cpf_fmt text, motivo text, criado_por text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."RECRUTAMENTO_CPF_BLACKLIST" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECRUTAMENTO_CPF_BLACKLIST" TO authenticated;
DROP POLICY IF EXISTS rec_cpf_bl_all ON public."RECRUTAMENTO_CPF_BLACKLIST";
CREATE POLICY rec_cpf_bl_all ON public."RECRUTAMENTO_CPF_BLACKLIST"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Migrar etapas antigas → novas ────────────────────────────────────────
UPDATE public."WA_CURRICULOS" SET etapa_processo = CASE etapa_processo
  WHEN 'Selecionado'              THEN 'ENTRADA'
  WHEN 'Pendente Jurídico'        THEN 'JURÍDICO'
  WHEN 'Entrevista Comportamental'THEN 'ENTREVISTA'
  WHEN 'Entrevista Técnica'       THEN 'ENTREVISTA GESTOR'
  WHEN 'ASO'                      THEN 'EXAME SST'
  WHEN 'Exame Médico'             THEN 'EXAME SST'
  WHEN 'Compras'                  THEN 'COMPRAS'
  WHEN 'Admissão'                 THEN 'DOCUMENTAÇÃO'
  ELSE etapa_processo END
WHERE etapa_processo IN ('Selecionado','Pendente Jurídico','Entrevista Comportamental',
  'Entrevista Técnica','ASO','Exame Médico','Compras','Admissão');

-- ── Migrar status da solicitação ─────────────────────────────────────────
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Vaga aberta - Seleção de Currículos'
  WHERE status = 'Seleção de Candidato';
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Concluído - Enviado para Admissão'
  WHERE status = 'Concluída';

-- ── Tabela TR de EPIs/uniforme (preenchida pelo Recrutamento) ────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_EPIS" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  candidato_id  bigint REFERENCES public."WA_CURRICULOS"(id) ON DELETE CASCADE,
  vaga_id       bigint,
  item          text,        -- Itens do TR
  tamanho       text,        -- Tamanho por item
  quantidade    text,        -- Quantidade prevista
  periodicidade text,        -- Periodicidade
  observacoes   text,        -- Observações
  responsavel   text         -- Responsável (automático)
);
CREATE INDEX IF NOT EXISTS rec_epis_cand_idx ON public."RECRUTAMENTO_EPIS"(candidato_id);
ALTER TABLE public."RECRUTAMENTO_EPIS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECRUTAMENTO_EPIS" TO authenticated;
DROP POLICY IF EXISTS rec_epis_all ON public."RECRUTAMENTO_EPIS";
CREATE POLICY rec_epis_all ON public."RECRUTAMENTO_EPIS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Trigger: status da solicitação = candidato mais avançado ─────────────
CREATE OR REPLACE FUNCTION public.sr_rank_etapa(p text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'ENTRADA' THEN 1 WHEN 'TRIAGEM' THEN 2 WHEN 'JURÍDICO' THEN 3
    WHEN 'ENTREVISTA' THEN 4 WHEN 'ENTREVISTA GESTOR' THEN 5 WHEN 'APROVADOS' THEN 6
    WHEN 'EXAME SST' THEN 7 WHEN 'COMPRAS' THEN 8 WHEN 'DOCUMENTAÇÃO' THEN 9 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.sr_sync_status_solicitacao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_vaga   bigint;
  v_atual  text;
  v_rank   int;
  v_epis   boolean;
  v_envadm timestamptz;
  v_new    text;
BEGIN
  v_vaga := COALESCE(NEW.vaga_id, OLD.vaga_id);
  IF v_vaga IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_atual FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
  IF v_atual IS NULL OR v_atual IN ('Pendente Operacional','Pendente Recrutamento','Reprovada') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT sr_rank_etapa(c.etapa_processo), c.epis_informados, c.enviado_admissao_em
    INTO v_rank, v_epis, v_envadm
  FROM public."WA_CURRICULOS" c
  WHERE c.vaga_id = v_vaga AND c.etapa_processo IS NOT NULL AND c.etapa_processo <> 'Reprovado'
  ORDER BY sr_rank_etapa(c.etapa_processo) DESC,
           c.enviado_admissao_em DESC NULLS LAST,
           c.epis_informados DESC NULLS LAST
  LIMIT 1;

  IF v_rank IS NULL OR v_rank <= 2 THEN
    v_new := 'Vaga aberta - Seleção de Currículos';
  ELSIF v_rank = 3 THEN v_new := 'Em análise jurídica';
  ELSIF v_rank = 4 THEN v_new := 'Entrevista e Avaliação';
  ELSIF v_rank = 5 THEN v_new := 'Entrevista com Gestor';
  ELSIF v_rank = 6 THEN v_new := 'Aprovado - Aguardando SST';
  ELSIF v_rank = 7 THEN v_new := 'Encaminhado para SST (ASO)';
  ELSIF v_rank = 8 THEN
    v_new := CASE WHEN COALESCE(v_epis,false) THEN 'Aguardando Confirmação Compras'
                  ELSE 'ASO Aprovado - Aguardando Informe de EPIs' END;
  ELSIF v_rank = 9 THEN
    v_new := CASE WHEN v_envadm IS NOT NULL THEN 'Concluído - Enviado para Admissão'
                  ELSE 'Compras Confirmou - Aguardando Documentação' END;
  ELSE v_new := v_atual;
  END IF;

  IF v_new IS DISTINCT FROM v_atual THEN
    UPDATE public."SISTEMA_RECRUTAMENTO" SET status = v_new WHERE id = v_vaga;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sr_sync_status ON public."WA_CURRICULOS";
CREATE TRIGGER trg_sr_sync_status
  AFTER INSERT OR UPDATE ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.sr_sync_status_solicitacao();

-- ── View das filas (inclui flags novas) ──────────────────────────────────
DROP VIEW IF EXISTS public."VW_RECRUTAMENTO_CANDIDATOS";
CREATE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id AS candidato_id, c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf, c.origem, c.storage_path, c.mensagem,
    c.etapa_processo, c.etapa_changed_at, c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.comportamental_por, c.comportamental_em, c.comportamental_obs,
    c.tecnica_por, c.tecnica_em, c.tecnica_obs,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em,
    c.admitido_por, c.admitido_em, c.empregado_id, c.motivo_reprovacao,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;
GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

-- ── RPCs do portal: publicar onde 'Vaga aberta - Seleção de Currículos' ──
CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE (cidade text, vagas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(btrim("cidade"), '') AS cidade, count(*)::bigint AS vagas
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Vaga aberta - Seleção de Currículos'
    AND NULLIF(btrim("cidade"), '') IS NOT NULL
  GROUP BY NULLIF(btrim("cidade"), '') ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.portal_cidades_com_vagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_cidades_com_vagas() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE (id integer, cargo text, contrato text, cidade text, escala text, salario text, beneficios text, quantidade_vagas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT "id", "cargo", "contrato", "cidade", "escala", "salario", "beneficios", "quantidade_vagas"
  FROM public."SISTEMA_RECRUTAMENTO"
  WHERE "status" = 'Vaga aberta - Seleção de Currículos'
    AND btrim(lower("cidade")) = btrim(lower(coalesce(p_cidade, '')))
  ORDER BY "cargo";
$$;
REVOKE ALL ON FUNCTION public.portal_vagas_por_cidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_vagas_por_cidade(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.portal_candidatar(
  p_vaga_id integer, p_nome text, p_telefone text, p_email text, p_cpf text,
  p_mensagem text, p_arquivo_nome text, p_storage_path text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_id bigint; v_field record; v_col text;
BEGIN
  IF coalesce(btrim(p_nome), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.'); END IF;
  IF coalesce(btrim(p_telefone), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.'); END IF;
  SELECT "status" INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE "id" = p_vaga_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.'); END IF;
  IF v_status <> 'Vaga aberta - Seleção de Currículos' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
  END IF;
  INSERT INTO public."WA_CURRICULOS" (vaga_id, origem) VALUES (p_vaga_id, 'Portal') RETURNING id INTO v_id;
  FOR v_field IN
    SELECT t.cands, t.val FROM (VALUES
      (ARRAY['nome','nome_cand','nome_candidato'], btrim(p_nome)),
      (ARRAY['telefone','fone','celular','whatsapp'], btrim(p_telefone)),
      (ARRAY['email','email_cand'], NULLIF(btrim(p_email), '')),
      (ARRAY['cpf','cpf_cand'], NULLIF(btrim(p_cpf), '')),
      (ARRAY['mensagem','observacao','obs'], NULLIF(btrim(p_mensagem), '')),
      (ARRAY['arquivo_nome','nome_arquivo'], NULLIF(btrim(p_arquivo_nome), '')),
      (ARRAY['storage_path','arquivo_path','path'], NULLIF(btrim(p_storage_path), ''))
    ) AS t(cands, val) WHERE t.val IS NOT NULL
  LOOP
    SELECT c.column_name INTO v_col FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'WA_CURRICULOS' AND c.column_name::text = ANY (v_field.cands)
    ORDER BY array_position(v_field.cands, c.column_name::text) LIMIT 1;
    IF v_col IS NOT NULL THEN
      EXECUTE format('UPDATE public."WA_CURRICULOS" SET %I = $1 WHERE id = $2', v_col) USING v_field.val, v_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar(integer,text,text,text,text,text,text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── EMPREGADOS: liberar INSERT (admissão cria novo colaborador) ──────────
ALTER TABLE public."EMPREGADOS" ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public."EMPREGADOS" TO authenticated;
DROP POLICY IF EXISTS empregados_insert_auth ON public."EMPREGADOS";
CREATE POLICY empregados_insert_auth ON public."EMPREGADOS"
  FOR INSERT TO authenticated WITH CHECK (true);

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260706000001_portal_cadastro_completo.sql
-- =========================================================================
-- =========================================================================
-- PORTAL DE CANDIDATURA — cadastro completo + candidatura geral
--
-- 1) Campos de perfil do candidato em WA_CURRICULOS.
-- 2) Candidatura GERAL (sem vaga): vaga_id NULL, tipo_candidatura='geral'.
-- 3) Anexos múltiplos (currículo + CTPS) em RECRUTAMENTO_CANDIDATO_ARQUIVOS.
-- 4) RPC portal_candidatar_v2(jsonb) p/ o portal público (anon).
--
-- Idempotente.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS data_nascimento          date,
  ADD COLUMN IF NOT EXISTS rg                       text,
  ADD COLUMN IF NOT EXISTS sexo                     text,
  ADD COLUMN IF NOT EXISTS nome_mae                 text,
  ADD COLUMN IF NOT EXISTS nome_pai                 text,
  ADD COLUMN IF NOT EXISTS escolaridade             text,
  ADD COLUMN IF NOT EXISTS cidade_residencia        text,
  ADD COLUMN IF NOT EXISTS estado_desejado          text,
  ADD COLUMN IF NOT EXISTS cidade_desejada          text,
  ADD COLUMN IF NOT EXISTS cargos_interesse         text,
  ADD COLUMN IF NOT EXISTS disponibilidade_horarios text,
  ADD COLUMN IF NOT EXISTS disp_fim_semana          boolean,
  ADD COLUMN IF NOT EXISTS possui_cnh               boolean,
  ADD COLUMN IF NOT EXISTS experiencia_previa       boolean,
  ADD COLUMN IF NOT EXISTS estrangeiro              boolean,
  ADD COLUMN IF NOT EXISTS tipo_candidatura         text;

-- Candidatura geral não tem vaga → vaga_id precisa aceitar NULL.
ALTER TABLE public."WA_CURRICULOS" ALTER COLUMN vaga_id DROP NOT NULL;

-- ── Anexos do candidato (currículo + CTPS, múltiplos) ────────────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_CANDIDATO_ARQUIVOS" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  candidato_id bigint REFERENCES public."WA_CURRICULOS"(id) ON DELETE CASCADE,
  tipo         text,        -- 'curriculo' | 'ctps'
  storage_path text,
  nome         text
);
CREATE INDEX IF NOT EXISTS rec_cand_arq_idx ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"(candidato_id);
ALTER TABLE public."RECRUTAMENTO_CANDIDATO_ARQUIVOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS" TO authenticated;
DROP POLICY IF EXISTS rec_cand_arq_all ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS";
CREATE POLICY rec_cand_arq_all ON public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── RPC do portal (candidatura geral OU para vaga) ───────────────────────
CREATE OR REPLACE FUNCTION public.portal_candidatar_v2(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_vaga     bigint;
  v_status   text;
  v_id       bigint;
  v_tipo     text;
  v_arq      jsonb;
  v_first_cv text;
BEGIN
  v_vaga := NULLIF(p_payload->>'vaga_id', '')::bigint;
  v_tipo := CASE WHEN v_vaga IS NULL THEN 'geral' ELSE 'vaga' END;

  IF coalesce(btrim(p_payload->>'nome'), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.');
  END IF;
  IF coalesce(btrim(p_payload->>'telefone'), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.');
  END IF;
  IF length(regexp_replace(coalesce(p_payload->>'cpf',''), '\D', '', 'g')) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF inválido.');
  END IF;

  IF v_vaga IS NOT NULL THEN
    SELECT status INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
    IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.'); END IF;
    IF v_status <> 'Vaga aberta - Seleção de Currículos' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
    END IF;
  END IF;

  SELECT (elem->>'path') INTO v_first_cv
  FROM jsonb_array_elements(coalesce(p_payload->'curriculos', '[]'::jsonb)) elem LIMIT 1;

  INSERT INTO public."WA_CURRICULOS" (
    vaga_id, origem, tipo_candidatura, nome, telefone, email, cpf, cpf_cand, mensagem, storage_path,
    data_nascimento, rg, sexo, nome_mae, nome_pai, escolaridade, cidade_residencia,
    estado_desejado, cidade_desejada, cargos_interesse, disponibilidade_horarios,
    disp_fim_semana, possui_cnh, experiencia_previa, estrangeiro
  ) VALUES (
    v_vaga, 'Portal', v_tipo,
    btrim(p_payload->>'nome'), btrim(p_payload->>'telefone'), NULLIF(btrim(p_payload->>'email'), ''),
    NULLIF(btrim(p_payload->>'cpf'), ''), NULLIF(btrim(p_payload->>'cpf'), ''),
    NULLIF(btrim(p_payload->>'mensagem'), ''), v_first_cv,
    NULLIF(p_payload->>'data_nascimento', '')::date, NULLIF(btrim(p_payload->>'rg'), ''),
    NULLIF(btrim(p_payload->>'sexo'), ''), NULLIF(btrim(p_payload->>'nome_mae'), ''),
    NULLIF(btrim(p_payload->>'nome_pai'), ''), NULLIF(btrim(p_payload->>'escolaridade'), ''),
    NULLIF(btrim(p_payload->>'cidade_residencia'), ''), NULLIF(btrim(p_payload->>'estado_desejado'), ''),
    NULLIF(btrim(p_payload->>'cidade_desejada'), ''), NULLIF(btrim(p_payload->>'cargos_interesse'), ''),
    NULLIF(btrim(p_payload->>'disponibilidade_horarios'), ''),
    NULLIF(p_payload->>'disp_fim_semana', '')::boolean, NULLIF(p_payload->>'possui_cnh', '')::boolean,
    NULLIF(p_payload->>'experiencia_previa', '')::boolean, NULLIF(p_payload->>'estrangeiro', '')::boolean
  ) RETURNING id INTO v_id;

  FOR v_arq IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'curriculos', '[]'::jsonb)) LOOP
    INSERT INTO public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"(candidato_id, tipo, storage_path, nome)
    VALUES (v_id, 'curriculo', v_arq->>'path', v_arq->>'nome');
  END LOOP;
  FOR v_arq IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'ctps', '[]'::jsonb)) LOOP
    INSERT INTO public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"(candidato_id, tipo, storage_path, nome)
    VALUES (v_id, 'ctps', v_arq->>'path', v_arq->>'nome');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar_v2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar_v2(jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260707000001_recrutamento_refinamentos.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO — refinamentos
-- 1) Candidatura a vaga entra DIRETO em ENTRADA (portal_candidatar_v2).
-- 2) 3 experiências relevantes.
-- 3) SST em 2 partes (agendar data/hora/local → realizar).
-- 4) EPIs: flag "obrigatório"; Compras informa data de chegada.
-- 5) Roteiro de entrevista (RECRUTAMENTO_ENTREVISTA).
-- 6) "Enviar para Admissão" → status final "Contratado".
-- Idempotente.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS experiencia_1       text,
  ADD COLUMN IF NOT EXISTS experiencia_2       text,
  ADD COLUMN IF NOT EXISTS experiencia_3       text,
  ADD COLUMN IF NOT EXISTS sst_data_exame      date,
  ADD COLUMN IF NOT EXISTS sst_hora_exame      text,
  ADD COLUMN IF NOT EXISTS sst_local_exame     text,
  ADD COLUMN IF NOT EXISTS sst_agendado_por    text,
  ADD COLUMN IF NOT EXISTS sst_agendado_em     timestamptz,
  ADD COLUMN IF NOT EXISTS compras_data_chegada date;

ALTER TABLE public."RECRUTAMENTO_EPIS"
  ADD COLUMN IF NOT EXISTS obrigatorio boolean;

-- ── Roteiro de entrevista (perguntas/respostas por candidato/etapa) ──────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ENTREVISTA" (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  candidato_id bigint REFERENCES public."WA_CURRICULOS"(id) ON DELETE CASCADE,
  etapa        text,        -- 'ENTREVISTA' | 'ENTREVISTA GESTOR'
  ordem        int,
  pergunta     text,
  resposta     text
);
CREATE INDEX IF NOT EXISTS rec_entrev_idx ON public."RECRUTAMENTO_ENTREVISTA"(candidato_id, etapa);
ALTER TABLE public."RECRUTAMENTO_ENTREVISTA" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECRUTAMENTO_ENTREVISTA" TO authenticated;
DROP POLICY IF EXISTS rec_entrev_all ON public."RECRUTAMENTO_ENTREVISTA";
CREATE POLICY rec_entrev_all ON public."RECRUTAMENTO_ENTREVISTA"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Status final: "Concluído - Enviado para Admissão" → "Contratado" ─────
UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Contratado'
  WHERE status = 'Concluído - Enviado para Admissão';

-- ── Trigger de auto-status: DOCUMENTAÇÃO + enviado → Contratado ──────────
CREATE OR REPLACE FUNCTION public.sr_sync_status_solicitacao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_vaga bigint; v_atual text; v_rank int; v_epis boolean; v_envadm timestamptz; v_new text;
BEGIN
  v_vaga := COALESCE(NEW.vaga_id, OLD.vaga_id);
  IF v_vaga IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO v_atual FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
  IF v_atual IS NULL OR v_atual IN ('Pendente Operacional','Pendente Recrutamento','Reprovada') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT sr_rank_etapa(c.etapa_processo), c.epis_informados, c.enviado_admissao_em
    INTO v_rank, v_epis, v_envadm
  FROM public."WA_CURRICULOS" c
  WHERE c.vaga_id = v_vaga AND c.etapa_processo IS NOT NULL AND c.etapa_processo <> 'Reprovado'
  ORDER BY sr_rank_etapa(c.etapa_processo) DESC, c.enviado_admissao_em DESC NULLS LAST, c.epis_informados DESC NULLS LAST
  LIMIT 1;
  IF v_rank IS NULL OR v_rank <= 2 THEN v_new := 'Vaga aberta - Seleção de Currículos';
  ELSIF v_rank = 3 THEN v_new := 'Em análise jurídica';
  ELSIF v_rank = 4 THEN v_new := 'Entrevista e Avaliação';
  ELSIF v_rank = 5 THEN v_new := 'Entrevista com Gestor';
  ELSIF v_rank = 6 THEN v_new := 'Aprovado - Aguardando SST';
  ELSIF v_rank = 7 THEN v_new := 'Encaminhado para SST (ASO)';
  ELSIF v_rank = 8 THEN v_new := CASE WHEN COALESCE(v_epis,false) THEN 'Aguardando Confirmação Compras' ELSE 'ASO Aprovado - Aguardando Informe de EPIs' END;
  ELSIF v_rank = 9 THEN v_new := CASE WHEN v_envadm IS NOT NULL THEN 'Contratado' ELSE 'Compras Confirmou - Aguardando Documentação' END;
  ELSE v_new := v_atual; END IF;
  IF v_new IS DISTINCT FROM v_atual THEN
    UPDATE public."SISTEMA_RECRUTAMENTO" SET status = v_new WHERE id = v_vaga;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── portal_candidatar_v2: candidatura a vaga entra DIRETO em ENTRADA ─────
CREATE OR REPLACE FUNCTION public.portal_candidatar_v2(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vaga bigint; v_status text; v_id bigint; v_tipo text; v_arq jsonb; v_first_cv text;
  v_etapa text; v_now timestamptz := now();
BEGIN
  v_vaga := NULLIF(p_payload->>'vaga_id', '')::bigint;
  v_tipo := CASE WHEN v_vaga IS NULL THEN 'geral' ELSE 'vaga' END;
  v_etapa := CASE WHEN v_vaga IS NULL THEN NULL ELSE 'ENTRADA' END;

  IF coalesce(btrim(p_payload->>'nome'), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Informe seu nome.'); END IF;
  IF coalesce(btrim(p_payload->>'telefone'), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'Informe seu telefone.'); END IF;
  IF length(regexp_replace(coalesce(p_payload->>'cpf',''), '\D', '', 'g')) <> 11 THEN RETURN jsonb_build_object('ok', false, 'error', 'CPF inválido.'); END IF;

  IF v_vaga IS NOT NULL THEN
    SELECT status INTO v_status FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
    IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Vaga não encontrada.'); END IF;
    IF v_status <> 'Vaga aberta - Seleção de Currículos' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esta vaga não está mais recebendo currículos.');
    END IF;
  END IF;

  SELECT (elem->>'path') INTO v_first_cv FROM jsonb_array_elements(coalesce(p_payload->'curriculos', '[]'::jsonb)) elem LIMIT 1;

  INSERT INTO public."WA_CURRICULOS" (
    vaga_id, origem, tipo_candidatura, etapa_processo, etapa_changed_at, selecionado_por, selecionado_em,
    nome, telefone, email, cpf, cpf_cand, mensagem, storage_path,
    data_nascimento, rg, sexo, nome_mae, nome_pai, escolaridade, cidade_residencia,
    estado_desejado, cidade_desejada, cargos_interesse, disponibilidade_horarios,
    disp_fim_semana, possui_cnh, experiencia_previa, estrangeiro,
    experiencia_1, experiencia_2, experiencia_3
  ) VALUES (
    v_vaga, 'Portal', v_tipo, v_etapa,
    CASE WHEN v_etapa IS NULL THEN NULL ELSE v_now END,
    CASE WHEN v_etapa IS NULL THEN NULL ELSE 'Portal' END,
    CASE WHEN v_etapa IS NULL THEN NULL ELSE v_now END,
    btrim(p_payload->>'nome'), btrim(p_payload->>'telefone'), NULLIF(btrim(p_payload->>'email'), ''),
    NULLIF(btrim(p_payload->>'cpf'), ''), NULLIF(btrim(p_payload->>'cpf'), ''),
    NULLIF(btrim(p_payload->>'mensagem'), ''), v_first_cv,
    NULLIF(p_payload->>'data_nascimento', '')::date, NULLIF(btrim(p_payload->>'rg'), ''),
    NULLIF(btrim(p_payload->>'sexo'), ''), NULLIF(btrim(p_payload->>'nome_mae'), ''),
    NULLIF(btrim(p_payload->>'nome_pai'), ''), NULLIF(btrim(p_payload->>'escolaridade'), ''),
    NULLIF(btrim(p_payload->>'cidade_residencia'), ''), NULLIF(btrim(p_payload->>'estado_desejado'), ''),
    NULLIF(btrim(p_payload->>'cidade_desejada'), ''), NULLIF(btrim(p_payload->>'cargos_interesse'), ''),
    NULLIF(btrim(p_payload->>'disponibilidade_horarios'), ''),
    NULLIF(p_payload->>'disp_fim_semana', '')::boolean, NULLIF(p_payload->>'possui_cnh', '')::boolean,
    NULLIF(p_payload->>'experiencia_previa', '')::boolean, NULLIF(p_payload->>'estrangeiro', '')::boolean,
    NULLIF(btrim(p_payload->>'experiencia_1'), ''), NULLIF(btrim(p_payload->>'experiencia_2'), ''),
    NULLIF(btrim(p_payload->>'experiencia_3'), '')
  ) RETURNING id INTO v_id;

  FOR v_arq IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'curriculos', '[]'::jsonb)) LOOP
    INSERT INTO public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"(candidato_id, tipo, storage_path, nome)
    VALUES (v_id, 'curriculo', v_arq->>'path', v_arq->>'nome');
  END LOOP;
  FOR v_arq IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'ctps', '[]'::jsonb)) LOOP
    INSERT INTO public."RECRUTAMENTO_CANDIDATO_ARQUIVOS"(candidato_id, tipo, storage_path, nome)
    VALUES (v_id, 'ctps', v_arq->>'path', v_arq->>'nome');
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_candidatar_v2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_candidatar_v2(jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260708000001_recrutamento_favoritos.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO — Banco de Talentos: favoritos
-- Marca candidatos como favoritos (estrela). Idempotente.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS favorito boolean;

CREATE INDEX IF NOT EXISTS wac_favorito_idx ON public."WA_CURRICULOS"(favorito) WHERE favorito;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260709000001_view_campos_completos.sql
-- =========================================================================
-- =========================================================================
-- RECRUTAMENTO — recria VW_RECRUTAMENTO_CANDIDATOS com TODAS as colunas
-- (agendamento SST, data de chegada Compras, experiências, favorito).
-- Corrige "column ... does not exist" nas telas dos setores.
-- Auto-suficiente e idempotente.
-- =========================================================================

-- Garante as colunas usadas pela view (idempotente).
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS sst_data_exame       date,
  ADD COLUMN IF NOT EXISTS sst_hora_exame       text,
  ADD COLUMN IF NOT EXISTS sst_local_exame      text,
  ADD COLUMN IF NOT EXISTS sst_agendado_por     text,
  ADD COLUMN IF NOT EXISTS sst_agendado_em      timestamptz,
  ADD COLUMN IF NOT EXISTS compras_data_chegada date,
  ADD COLUMN IF NOT EXISTS experiencia_1        text,
  ADD COLUMN IF NOT EXISTS experiencia_2        text,
  ADD COLUMN IF NOT EXISTS experiencia_3        text,
  ADD COLUMN IF NOT EXISTS favorito             boolean;

DROP VIEW IF EXISTS public."VW_RECRUTAMENTO_CANDIDATOS";
CREATE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id AS candidato_id, c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf, c.origem, c.storage_path, c.mensagem,
    c.etapa_processo, c.etapa_changed_at, c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em,
    c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame, c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em,
    c.admitido_por, c.admitido_em, c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3, c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- EMPREGADOS — coluna "Nome do Cargo" (migration 20260701000002)
--
-- A EMPREGADOS traz o cargo em "Título do Cargo", que em vários registros
-- veio da folha só com o CÓDIGO do cargo (ex.: "0182"), não o nome legível.
-- Esta coluna guarda o nome do cargo já traduzido (ex.: "ADVOGADO"), obtido
-- ao integrar uma planilha de referência (Cargo → Nome do Cargo) na tela
-- RH → Colaboradores ("Integrar Cargos").
-- =========================================================================

ALTER TABLE public."EMPREGADOS"
  ADD COLUMN IF NOT EXISTS "Nome do Cargo" text;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- EMPREGADOS — recodificação de "Cargo" (migration 20260701000003)
--
-- A planilha de referência de cargos tinha o mesmo nome com códigos
-- diferentes (ex.: AGENTE DE PORTARIA = 0009 e 0011) e códigos que colidem
-- quando viram bigint (ex.: "0225" e "225" ambos = 225, mas com nomes
-- diferentes). Esta migration:
--
-- 1) Zera (NULL) o "Cargo" de quem está hoje em um dos 27 códigos ambíguos
--    abaixo (não dá pra saber qual dos 2 nomes é correto) e marca
--    "Nome do Cargo" com um aviso — pra não colidir com o esquema novo E
--    pra não ser confundido depois com "Vazio" (sem cargo nenhum) caso o
--    "Integrar Cargos" seja rodado de novo.
-- 2) Recodifica os demais para um esquema NOVO sequencial (1, 2, 3…), um
--    código único por nome de cargo, e já preenche "Nome do Cargo" junto.
--
-- Gerado a partir de CARGOS.xlsx + CARGOS_RENUMERADOS.xlsx (aba De-Para).
-- Idempotente: rodar de novo não faz nada (os códigos antigos já não
-- existem mais depois da 1ª aplicação).
-- =========================================================================

-- 1) Códigos ambíguos na planilha de origem — zera e marca pra revisão manual.
UPDATE public."EMPREGADOS"
SET "Cargo" = NULL, "Nome do Cargo" = 'AMBÍGUO - REVISAR MANUALMENTE'
WHERE "Cargo" IN (194, 195, 196, 197, 199, 200, 201, 205, 206, 207, 208, 209, 210, 214, 215, 216, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228);

-- 2) Recodificação: código antigo → código novo sequencial + nome do cargo.
UPDATE public."EMPREGADOS" e
SET "Cargo" = v.novo, "Nome do Cargo" = v.nome
FROM (VALUES
(1, 55, 'AUXILIAR ADMINISTRATIVO'),
  (2, 206, 'VIGIA DE PORTARIA'),
  (3, 55, 'AUXILIAR ADMINISTRATIVO'),
  (4, 201, 'VARREDOR DE RUA - LIMPEZA URBANA'),
  (5, 170, 'SERVIÇOS GERAIS'),
  (6, 201, 'VARREDOR DE RUA - LIMPEZA URBANA'),
  (7, 185, 'SUPERVISOR OPERACIONAL'),
  (8, 201, 'VARREDOR DE RUA - LIMPEZA URBANA'),
  (9, 2, 'AGENTE DE PORTARIA'),
  (10, 56, 'AUXILIAR ADMNISTRATIVO'),
  (11, 2, 'AGENTE DE PORTARIA'),
  (12, 205, 'VIGIA'),
  (13, 154, 'PORTEIRO'),
  (14, 205, 'VIGIA'),
  (15, 165, 'SERVENTE DE LIMPEZA'),
  (16, 101, 'ESTAGIARIO'),
  (17, 165, 'SERVENTE DE LIMPEZA'),
  (18, 89, 'COZINHEIRA HOSPITALAR'),
  (19, 91, 'COZINHEIRO GERAL'),
  (20, 172, 'SOCIO'),
  (21, 60, 'AUXILIAR DE COZINHA'),
  (22, 60, 'AUXILIAR DE COZINHA'),
  (23, 60, 'AUXILIAR DE COZINHA'),
  (24, 166, 'SERVENTE DE LIMPEZA - D'),
  (25, 111, 'JARDINEIRO'),
  (26, 200, 'TRATORISTA FUGS'),
  (27, 53, 'AUX ADMINISTRATIVO DE PESSOAL'),
  (28, 157, 'PSICOLOGA DO TRABALHO'),
  (29, 150, 'PEDAGOGA'),
  (30, 134, 'MOTORISTA'),
  (31, 151, 'PEDREIRO'),
  (32, 204, 'VIDRACEIRO'),
  (33, 97, 'ELETRICISTA'),
  (34, 96, 'ELETRECISTA'),
  (35, 97, 'ELETRICISTA'),
  (36, 168, 'SERVENTE DE OBRAS'),
  (37, 153, 'PINTOR'),
  (38, 77, 'CARPINTEIRO'),
  (39, 133, 'MESTRE DE OBRAS'),
  (40, 98, 'ENCANADOR'),
  (41, 158, 'RECEPCIONISTA'),
  (42, 54, 'AUX. ADMINISTRATIVO'),
  (43, 29, 'APRENDIZ AUXILIAR ADMINISTRATIVO'),
  (44, 18, 'ANALISTA DE LOGISTICA'),
  (45, 66, 'AUXILIAR DE PINTOR'),
  (46, 18, 'ANALISTA DE LOGISTICA'),
  (47, 132, 'MERENDEIRA'),
  (48, 105, 'GERENTE ADMINISTRATIVO'),
  (49, 132, 'MERENDEIRA'),
  (50, 19, 'ANALISTA DE RECURSOS HUMANOS'),
  (51, 88, 'COZINHEIRA'),
  (52, 19, 'ANALISTA DE RECURSOS HUMANOS'),
  (53, 146, 'OPERADOR DE MAQUINA'),
  (54, 185, 'SUPERVISOR OPERACIONAL'),
  (55, 146, 'OPERADOR DE MAQUINA'),
  (56, 65, 'AUXILIAR DE MANUTENÇÃO PREDIAL'),
  (57, 72, 'AUXILIAR FINANCEIRO'),
  (58, 65, 'AUXILIAR DE MANUTENÇÃO PREDIAL'),
  (59, 158, 'RECEPCIONISTA'),
  (60, 73, 'AUXILIAR NOS SERVIÇOS DE ALIMENTAÇÃO'),
  (61, 158, 'RECEPCIONISTA'),
  (62, 167, 'SERVENTE DE LIMPEZA - II'),
  (63, 62, 'AUXILIAR DE LAVANDERIA'),
  (64, 155, 'PROFESSOR'),
  (65, 190, 'TEC AGRICOLA'),
  (66, 19, 'ANALISTA DE RECURSOS HUMANOS'),
  (67, 52, 'ATENDENTE DE CRECHE'),
  (68, 128, 'MECANICO'),
  (69, 18, 'ANALISTA DE LOGISTICA'),
  (70, 100, 'ESTAGIARIA'),
  (71, 87, 'COVEIRO'),
  (72, 154, 'PORTEIRO'),
  (73, 61, 'AUXILIAR DE EDUCACAO INFANTIL'),
  (74, 104, 'EXUMADOR'),
  (75, 84, 'COPEIRO'),
  (76, 191, 'TECNICA EM ENFERMAGEM'),
  (77, 90, 'COZINHEIRO'),
  (78, 191, 'TECNICA EM ENFERMAGEM'),
  (79, 188, 'SUPERVISORA DE COZINHA'),
  (80, 199, 'TRATORISTA'),
  (81, 207, 'ZELADOR'),
  (82, 58, 'AUXILIAR DE ALMOXARIFADO'),
  (83, 202, 'VENDEDORA'),
  (84, 67, 'AUXILIAR DE SERVICOS GERAIS'),
  (85, 140, 'OFFICEBOY'),
  (86, 92, 'CUIDADOR EM SAUDE'),
  (87, 58, 'AUXILIAR DE ALMOXARIFADO'),
  (88, 193, 'TECNICO EM SEGURANCA DO TRABALHO'),
  (89, 121, 'LIDER DE SERVENTE DE LIMPEZA'),
  (90, 207, 'ZELADOR'),
  (91, 134, 'MOTORISTA'),
  (92, 8, 'ALMOXARIFE'),
  (93, 64, 'AUXILIAR DE MANUTENCAO PREDIAL'),
  (94, 57, 'AUXILIAR DE ALMOXARIDADO'),
  (95, 104, 'EXUMADOR'),
  (96, 58, 'AUXILIAR DE ALMOXARIFADO'),
  (97, 87, 'COVEIRO'),
  (98, 3, 'AJUDANTE DE CARGA E DESCARGA'),
  (99, 128, 'MECANICO'),
  (100, 174, 'SUPERVISOR ADMINISTRATIVO'),
  (101, 169, 'SERVENTE DE OBRAS - MEIO OFICIAL'),
  (102, 67, 'AUXILIAR DE SERVICOS GERAIS'),
  (103, 152, 'PEDREIRO - OFICIAL'),
  (104, 84, 'COPEIRO'),
  (105, 101, 'ESTAGIARIO'),
  (106, 144, 'OPERADOR DE BOB-CAT'),
  (107, 132, 'MERENDEIRA'),
  (108, 30, 'ARQUIVISTA'),
  (109, 143, 'OFICIAL DE MANUTENÇAO PREDIAL'),
  (110, 59, 'AUXILIAR DE ARQUIVO'),
  (111, 97, 'ELETRICISTA'),
  (112, 125, 'MAQUEIRO'),
  (113, 195, 'TELEFONISTA'),
  (114, 164, 'SECRETARIO EXECUTIVO'),
  (115, 148, 'OPERADOR DE MAQUINAS'),
  (116, 192, 'TECNICO EM SECRETARIADO'),
  (117, 199, 'TRATORISTA'),
  (118, 99, 'ENCARREGADO ADMINISTRATIVO'),
  (119, 138, 'MOTORISTA DE CAMINHAO'),
  (120, 195, 'TELEFONISTA'),
  (121, 128, 'MECANICO'),
  (122, 63, 'AUXILIAR DE LIMPEZA'),
  (123, 130, 'MEIO OFICIAL - PEDREIRO'),
  (124, 141, 'OFICIAL - LIDER DE MANUTENCAO PREDIAL'),
  (125, 194, 'TELEATENDENTE'),
  (126, 142, 'OFICIAL DE MANUTENCAO'),
  (127, 129, 'MEIO OFICIAL'),
  (128, 129, 'MEIO OFICIAL'),
  (129, 60, 'AUXILIAR DE COZINHA'),
  (130, 113, 'LAVADOR DE ROUPAS A MAQUINA'),
  (131, 85, 'COSTUREIRO'),
  (132, 75, 'CAMAREIRO'),
  (133, 114, 'LAVADOR DE VEICULO'),
  (134, 82, 'COLETOR DE LIXO'),
  (135, 52, 'ATENDENTE DE CRECHE'),
  (136, 71, 'AUXILIAR EM SAUDE BUCAL'),
  (137, 182, 'SUPERVISOR DE SERVICOS DE SAUDE'),
  (138, 134, 'MOTORISTA'),
  (139, 198, 'TRADUTOR E INTERPRETE DE LIBRAS'),
  (140, 197, 'TRABALHADOR VOLANTE DA AGRICULTURA'),
  (141, 78, 'CARREGADOR'),
  (142, 74, 'AUXLIAR DE ALMOXARIFADO'),
  (143, 69, 'AUXILIAR DE VETERINARIO'),
  (144, 160, 'RECEPCIONISTA HOSPITALAR'),
  (145, 110, 'GUARDADOR DE VEÍCULOS'),
  (146, 154, 'PORTEIRO'),
  (147, 181, 'SUPERVISOR DE RECEPCIONISTAS'),
  (148, 159, 'RECEPCIONISTA BILINGUE'),
  (149, 132, 'MERENDEIRA'),
  (150, 81, 'CARREGADOR NAO EXCLUSIVO'),
  (151, 194, 'TELEATENDENTE'),
  (152, 32, 'ASSISTENTE ADMINISTRATIVO'),
  (153, 176, 'SUPERVISOR DE ATENDIMENTO'),
  (154, 102, 'ESTAGIARIO EM  PEDAGOGIA'),
  (155, 135, 'MOTORISTA CAT B'),
  (156, 136, 'MOTORISTA CAT C'),
  (157, 137, 'MOTORISTA CAT D'),
  (158, 76, 'Sem Nome'),
  (159, 145, 'OPERADOR DE ESCAVADEIRA'),
  (160, 183, 'SUPERVISOR DE TRANSPORTES'),
  (161, 186, 'SUPERVISOR TECNICO OPERACIONAL'),
  (162, 83, 'COORDENADOR ADMINISTRATIVO'),
  (163, 6, 'ALMOX. HU DIURNO 12X36'),
  (164, 7, 'ALMOX. HU NOTURNO 12X36'),
  (165, 4, 'ALMOX. HU 36H 6X1'),
  (166, 5, 'ALMOX. HU 40H 5X2'),
  (167, 80, 'CARREGADOR HU 40H 5X2 INSALUB.'),
  (168, 79, 'CARREGADOR HU 40H 5X2'),
  (169, 86, 'COSTUREIRO HU 40H 5X2'),
  (170, 127, 'MAQUEIRO HU 30H 5X2 INSALUB.'),
  (171, 163, 'ROUPEIRO 44H 6X1 INSALUB.'),
  (172, 126, 'MAQUEIRO HU 30H 5X2'),
  (173, 161, 'ROUPEIRO 220H  12X36'),
  (174, 103, 'ESTAGIO ADMINISTRATIVO'),
  (175, 120, 'LIDER DE RECURSOS HUMANOS'),
  (176, 124, 'LIDER OPERACIONAL'),
  (177, 118, 'LIDER DE LICITACOES'),
  (178, 122, 'LIDER FINANCEIRO'),
  (179, 115, 'LIDER DE COMPRAS'),
  (180, 119, 'LIDER DE QUALIDADE'),
  (181, 117, 'LIDER DE IMPORTAÇÃO'),
  (182, 1, 'ADVOGADO'),
  (183, 131, 'MENSAGEIRO'),
  (193, 123, 'LIDER JURIDICO'),
  (198, 41, 'ASSISTENTE FINANCEIRO I'),
  (202, 43, 'ASSISTENTE FINANCEIRO III'),
  (203, 149, 'OPERADOR DE RADIO CHAMADA - OPERADOR CENTRAL DE MONITORAMENT'),
  (204, 173, 'SUPERVISOR'),
  (211, 171, 'SERVIÇOS GERAIS-CARGA E DESCAR'),
  (212, 9, 'ANALISTA DE COMPRAS JUNIOR'),
  (213, 180, 'SUPERVISOR DE LIMPEZA'),
  (217, 28, 'APRENDIZ'),
  (229, 107, 'GERENTE DE SUPLY'),
  (1051, 88, 'COZINHEIRA'),
  (1100, 13, 'ANALISTA DE DEP PESSOAL I'),
  (1101, 38, 'ASSISTENTE DE DEP PESSOAL II'),
  (1102, 21, 'ANALISTA FINANCEIRO I'),
  (1103, 22, 'ANALISTA FINANCEIRO II'),
  (1104, 14, 'ANALISTA DE DEP PESSOAL JR'),
  (1105, 35, 'ASSISTENTE DE COMPRAS I'),
  (1106, 50, 'ASSISTENTE OPERACIONAL III'),
  (1107, 50, 'ASSISTENTE OPERACIONAL III')
) AS v(antigo, novo, nome)
WHERE e."Cargo" = v.antigo;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- CARGOS — tabela de referência de cargos (migration 20260702000001)
--
-- "Cargo" (código) e "Nome do Cargo" deixam de ser campos independentes na
-- EMPREGADOS: passam a referenciar esta tabela. A tela RH → Colaboradores
-- seleciona o cargo daqui e permite criar um novo (que recebe o próximo
-- código sequencial).
--
-- A tabela pode já ter sido criada à mão no banco do app (Table Editor) —
-- tudo aqui é idempotente: garante PK, unicidade de nome, RLS/GRANT e
-- semeia a partir dos pares (Cargo, Nome do Cargo) já gravados na
-- EMPREGADOS pela recodificação (migration 20260701000003).
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CARGOS" (
  "Cargo"         bigint NOT NULL,
  "Nome do Cargo" text   NOT NULL
);

-- PK em "Cargo" (a tabela criada à mão pode não ter).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."CARGOS"'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public."CARGOS" ADD PRIMARY KEY ("Cargo");
  END IF;
END $$;

-- Um código por nome: evita cadastrar o mesmo cargo duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS cargos_nome_unico
  ON public."CARGOS" (upper(btrim("Nome do Cargo")));

-- Semeia com o que a recodificação já gravou na EMPREGADOS
-- (ignora "Vazio" e os marcados como ambíguos).
INSERT INTO public."CARGOS" ("Cargo", "Nome do Cargo")
SELECT DISTINCT ON (e."Cargo") e."Cargo", btrim(e."Nome do Cargo")
FROM public."EMPREGADOS" e
WHERE e."Cargo" IS NOT NULL
  AND COALESCE(btrim(e."Nome do Cargo"), '') NOT IN ('', 'Vazio', 'AMBÍGUO - REVISAR MANUALMENTE')
ORDER BY e."Cargo"
ON CONFLICT DO NOTHING;

-- Tabela criada pelo Table Editor vem com RLS ligado e SEM policy — o app
-- (authenticated) lê vazio. Libera leitura/escrita para usuários logados.
ALTER TABLE public."CARGOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CARGOS" TO authenticated;
DROP POLICY IF EXISTS cargos_all_auth ON public."CARGOS";
CREATE POLICY cargos_all_auth ON public."CARGOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- WA_CURRICULOS — nome do candidato SEMPRE em maiúsculo (migration 20260702000002)
--
-- O nome digitado no portal público (e o que vier do bot do WhatsApp) é
-- normalizado para maiúsculo no banco, via trigger — assim vale para
-- qualquer origem, não só o formulário do site. Também corrige os
-- registros já existentes. Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.wa_curriculos_nome_upper()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nome IS NOT NULL THEN NEW.nome := upper(btrim(NEW.nome)); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_curriculos_nome_upper ON public."WA_CURRICULOS";
CREATE TRIGGER trg_wa_curriculos_nome_upper
  BEFORE INSERT OR UPDATE OF nome ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.wa_curriculos_nome_upper();

-- Corrige os registros já gravados.
UPDATE public."WA_CURRICULOS"
SET nome = upper(btrim(nome))
WHERE nome IS NOT NULL AND nome <> upper(btrim(nome));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- SST — link do Google Maps do local do exame (migration 20260702000003)
--
-- Além do texto livre "Local do exame", o SST pode colar o link do Google
-- Maps do lugar exato (Compartilhar → Copiar link). A coluna entra na
-- VW_RECRUTAMENTO_CANDIDATOS (recriada com TODAS as colunas + a nova).
-- Idempotente.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS sst_maps_url text;

DROP VIEW IF EXISTS public."VW_RECRUTAMENTO_CANDIDATOS";
CREATE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
  SELECT
    c.id AS candidato_id, c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf, c.origem, c.storage_path, c.mensagem,
    c.etapa_processo, c.etapa_changed_at, c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em,
    c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame, c.sst_agendado_por, c.sst_agendado_em,
    c.sst_maps_url,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em,
    c.admitido_por, c.admitido_em, c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3, c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status,
    s.motivo_vaga, s.nome_substituido, s.escala, s.horario, s.salario,
    s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto, s.local_exato,
    s.data_inicio_prevista, s.quantidade_vagas, s.req_obrigatorios, s.req_desejaveis,
    s.exp_minima, s.exp_minima_qual, s.grau_urgencia, s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260709000002_central_servicos_denuncias =====
-- =========================================================================
-- CENTRAL DE SERVIÇOS — Denúncias (Canal de Ética / Contato Seguro)
--
-- Espelho local das denúncias ANÔNIMAS registradas na plataforma Contato
-- Seguro, sincronizadas pela edge function sync-denuncias-contato-seguro
-- (service role — bypassa RLS). LEITURA SOMENTE PARA ADMIN: nenhuma policy
-- de INSERT/UPDATE/DELETE para authenticated; a escrita é exclusiva do sync.
--
-- CS_DENUNCIAS          — uma linha por denúncia (upsert por cs_id).
-- CS_DENUNCIAS_SYNC_LOG — histórico das execuções do sync.
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_DENUNCIAS" (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cs_id                text NOT NULL UNIQUE,   -- identificador da denúncia na Contato Seguro
  protocolo            text,
  categoria            text,
  assunto              text,
  relato               text,
  status               text,
  canal                text,                   -- site / app / telefone / whatsapp
  empresa              text,
  area                 text,
  criado_na_origem     timestamptz,
  atualizado_na_origem timestamptz,
  raw                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- payload completo da API (à prova de campos novos)
  sincronizado_em      timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cs_denuncias_status_idx    ON public."CS_DENUNCIAS"(status);
CREATE INDEX IF NOT EXISTS cs_denuncias_categoria_idx ON public."CS_DENUNCIAS"(categoria);
CREATE INDEX IF NOT EXISTS cs_denuncias_criado_idx    ON public."CS_DENUNCIAS"(criado_na_origem DESC);

CREATE TABLE IF NOT EXISTS public."CS_DENUNCIAS_SYNC_LOG" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executado_em    timestamptz NOT NULL DEFAULT now(),
  executado_por   uuid,
  sucesso         boolean NOT NULL DEFAULT false,
  mensagem        text,
  total_recebidas integer,
  novas           integer,
  atualizadas     integer
);

ALTER TABLE public."CS_DENUNCIAS"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_DENUNCIAS_SYNC_LOG" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."CS_DENUNCIAS"          TO authenticated;
GRANT SELECT ON public."CS_DENUNCIAS_SYNC_LOG" TO authenticated;

-- Leitura: SOMENTE admin. Escrita: nenhuma policy — só o service role (sync).
DROP POLICY IF EXISTS cs_denuncias_select_admin ON public."CS_DENUNCIAS";
CREATE POLICY cs_denuncias_select_admin ON public."CS_DENUNCIAS"
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS cs_denuncias_sync_log_select_admin ON public."CS_DENUNCIAS_SYNC_LOG";
CREATE POLICY cs_denuncias_sync_log_select_admin ON public."CS_DENUNCIAS_SYNC_LOG"
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Garante o módulo pai (20260625000003). A tela do hub (/app/central-servicos)
-- é cadastrada UMA única vez, guardada por rota, na seção 20260710000003.
INSERT INTO public.app_modulo (codigo, nome, ordem, icone)
SELECT 'central_servicos', 'Central de Serviços',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'sistemas'), 200) + 5,
       'Headset'
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'central_servicos');

-- Tela na matriz de menus. A liberação para os admins é feita em
-- 20260709000005 (a RPC list_accessible_menus vigente exige allow=true
-- explícito por usuário — sem bypass de role). Mesmo que alguém sem papel
-- admin ganhe o menu, a RLS acima continua bloqueando os dados.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('central_servicos_denuncias', 'Denúncias (Canal de Ética)', '/app/central-servicos/denuncias', 20)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';


-- ===== 20260709000003_cs_denuncias_config_vault =====
-- =========================================================================
-- CENTRAL DE SERVIÇOS — Denúncias: config da integração via Supabase Vault
--
-- A conta que administra este projeto no CLI não tem privilégio de org para
-- gravar secrets de edge function, então as credenciais da Contato Seguro
-- vivem no Vault (criptografadas). Esta função é a ÚNICA porta de leitura e
-- só o service_role (edge function) pode executá-la.
--
-- Os VALORES não ficam no repositório: são criados direto no banco com
--   SELECT vault.create_secret('<valor>', 'cs_api_key',  'API Key Contato Seguro');
--   SELECT vault.create_secret('<valor>', 'cs_api_secret','Secret Contato Seguro');
--   SELECT vault.create_secret('<url>',   'cs_base_url',  'Base URL Contato Seguro');
--   SELECT vault.create_secret('<rota>',  'cs_complaints_path', 'Rota de denúncias');
-- (para trocar TST→PROD, atualizar com vault.update_secret)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_denuncias_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    FROM vault.decrypted_secrets
   WHERE name IN ('cs_api_key','cs_api_secret','cs_base_url','cs_complaints_path');
$fn$;

REVOKE ALL ON FUNCTION public.cs_denuncias_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cs_denuncias_config() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cs_denuncias_config() TO service_role;


-- ===== 20260709000004_cs_denuncias_responsaveis =====
-- =========================================================================
-- CENTRAL DE SERVIÇOS — Denúncias: responsáveis pelo tratamento
--
-- CS_DENUNCIAS_RESPONSAVEIS — lista (curada pelos admins) de quem cuida das
-- denúncias do Canal de Ética. Colunas responsavel_* em CS_DENUNCIAS
-- registram o responsável atribuído a cada denúncia.
--
-- Visibilidade continua SOMENTE ADMIN (regra do módulo): estar na lista de
-- responsáveis NÃO concede leitura — é registro/atribuição. Se um dia os
-- responsáveis não-admin precisarem ver as denúncias deles, estender a
-- policy de SELECT de CS_DENUNCIAS.
-- Idempotente.
-- =========================================================================

ALTER TABLE public."CS_DENUNCIAS"
  ADD COLUMN IF NOT EXISTS responsavel_user_id      uuid,
  ADD COLUMN IF NOT EXISTS responsavel_definido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS responsavel_definido_por uuid;

CREATE INDEX IF NOT EXISTS cs_denuncias_responsavel_idx
  ON public."CS_DENUNCIAS"(responsavel_user_id);

CREATE TABLE IF NOT EXISTS public."CS_DENUNCIAS_RESPONSAVEIS" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."CS_DENUNCIAS_RESPONSAVEIS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."CS_DENUNCIAS_RESPONSAVEIS" TO authenticated;

DROP POLICY IF EXISTS cs_denuncias_resp_select_admin ON public."CS_DENUNCIAS_RESPONSAVEIS";
CREATE POLICY cs_denuncias_resp_select_admin ON public."CS_DENUNCIAS_RESPONSAVEIS"
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS cs_denuncias_resp_insert_admin ON public."CS_DENUNCIAS_RESPONSAVEIS";
CREATE POLICY cs_denuncias_resp_insert_admin ON public."CS_DENUNCIAS_RESPONSAVEIS"
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS cs_denuncias_resp_delete_admin ON public."CS_DENUNCIAS_RESPONSAVEIS";
CREATE POLICY cs_denuncias_resp_delete_admin ON public."CS_DENUNCIAS_RESPONSAVEIS"
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Atribuição de responsável pelo app: UPDATE de admins limitado (grant por
-- coluna) aos campos responsavel_* — o conteúdo da denúncia continua
-- imutável pela API; só o sync (service role) escreve o resto.
GRANT UPDATE (responsavel_user_id, responsavel_definido_em, responsavel_definido_por)
  ON public."CS_DENUNCIAS" TO authenticated;

DROP POLICY IF EXISTS cs_denuncias_update_admin ON public."CS_DENUNCIAS";
CREATE POLICY cs_denuncias_update_admin ON public."CS_DENUNCIAS"
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

NOTIFY pgrst, 'reload schema';


-- ===== 20260710000001_drop_tabelas_comentarios_legadas =====
-- =========================================================================
-- COMENTÁRIOS — remove de vez as tabelas legadas duplicadas
-- JUR_COMENTARIOS e SISTEMA_JURIDICO_COMENTARIOS foram substituídas pelo
-- feed único SISTEMA_COMENTARIOS (modulo + entidade_id) na 016, mas
-- continuavam existindo porque os CREATEs legados eram reexecutados.
-- Idempotente: migra o que ainda houver e dropa as duas.
-- =========================================================================
DO $$
BEGIN
  IF to_regclass('public."JUR_COMENTARIOS"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto, created_at)
    SELECT 'patrimonio', c.patrimonio_id::text, c.autor, c.texto, c.created_at
      FROM public."JUR_COMENTARIOS" c
     WHERE c.patrimonio_id IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public."SISTEMA_COMENTARIOS" s
              WHERE s.modulo = 'patrimonio'
                AND s.entidade_id = c.patrimonio_id::text
                AND s.texto = c.texto
                AND s.created_at = c.created_at
           );
    DROP TABLE public."JUR_COMENTARIOS";
  END IF;

  IF to_regclass('public."SISTEMA_JURIDICO_COMENTARIOS"') IS NOT NULL THEN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto, created_at)
    SELECT 'processo', c.numero_processo, c.autor, c.comentario, c.criado_em
      FROM public."SISTEMA_JURIDICO_COMENTARIOS" c
     WHERE c.numero_processo IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public."SISTEMA_COMENTARIOS" s
              WHERE s.modulo = 'processo'
                AND s.entidade_id = c.numero_processo
                AND s.texto = c.comentario
                AND s.created_at = c.criado_em
           );
    DROP TABLE public."SISTEMA_JURIDICO_COMENTARIOS";
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ===== 20260710000004_central_servicos_formularios =====
-- =========================================================================
-- CENTRAL DE SERVIÇOS — Nascimento Formulários (construtor de formulários)
--
-- Sistema estilo survey: o gestor monta formulários com vários tipos de
-- pergunta (texto, múltipla escolha, caixas, lista, escala, data, número),
-- imagens (capa e por pergunta), define vigência (início/fim), limite de
-- respostas e publica numa URL pública (/formularios/<slug>) que qualquer
-- pessoa responde sem login.
--
-- Modelo:
--   CS_FORMULARIOS    — formulário (slug único da URL, status, vigência)
--   CS_FORM_PERGUNTAS — perguntas ordenadas (opcoes/config em jsonb)
--   CS_FORM_RESPOSTAS — 1 linha por envio; itens = {pergunta_id: valor}
--
-- Acesso:
--   Gestão (/app/central-servicos/formularios): tela no painel Módulos &
--   Menus (tela cadastrada = governada pelo painel; seed p/ admins atuais).
--   Público (anon): SELECT só de formulário publicado; INSERT de resposta só
--   com formulário publicado, dentro da janela e abaixo do limite.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORMULARIOS" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  titulo               text NOT NULL,
  descricao            text,
  slug                 text NOT NULL UNIQUE,
  status               text NOT NULL DEFAULT 'rascunho',  -- rascunho | publicado | encerrado
  inicia_em            timestamptz,
  encerra_em           timestamptz,
  max_respostas        integer,
  coleta_identificacao boolean NOT NULL DEFAULT false,    -- pede nome/e-mail do respondente
  imagem_capa_url      text,
  criado_por           uuid DEFAULT auth.uid(),
  criado_por_nome      text
);
CREATE INDEX IF NOT EXISTS cs_forms_status_idx ON public."CS_FORMULARIOS"(status);
CREATE INDEX IF NOT EXISTS cs_forms_slug_idx   ON public."CS_FORMULARIOS"(slug);

CREATE TABLE IF NOT EXISTS public."CS_FORM_PERGUNTAS" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  ordem         integer NOT NULL DEFAULT 0,
  tipo          text NOT NULL DEFAULT 'texto_curto',
  -- texto_curto | texto_longo | multipla_escolha | caixas_selecao |
  -- lista_suspensa | escala | data | numero
  titulo        text NOT NULL DEFAULT '',
  descricao     text,
  obrigatoria   boolean NOT NULL DEFAULT false,
  imagem_url    text,
  opcoes        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- ["Opção A", "Opção B", ...]
  config        jsonb NOT NULL DEFAULT '{}'::jsonb   -- escala: {min,max,rotulo_min,rotulo_max}
);
CREATE INDEX IF NOT EXISTS cs_form_perg_form_idx ON public."CS_FORM_PERGUNTAS"(formulario_id, ordem);

CREATE TABLE IF NOT EXISTS public."CS_FORM_RESPOSTAS" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id     uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  enviado_em        timestamptz NOT NULL DEFAULT now(),
  respondente_nome  text,
  respondente_email text,
  itens             jsonb NOT NULL DEFAULT '{}'::jsonb  -- {pergunta_id: valor}
);
CREATE INDEX IF NOT EXISTS cs_form_resp_form_idx ON public."CS_FORM_RESPOSTAS"(formulario_id, enviado_em);

DROP TRIGGER IF EXISTS trg_cs_forms_updated ON public."CS_FORMULARIOS";
CREATE TRIGGER trg_cs_forms_updated BEFORE UPDATE ON public."CS_FORMULARIOS"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_FORM_PERGUNTAS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_FORM_RESPOSTAS" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_FORMULARIOS", public."CS_FORM_PERGUNTAS", public."CS_FORM_RESPOSTAS" TO authenticated;
GRANT SELECT ON public."CS_FORMULARIOS", public."CS_FORM_PERGUNTAS" TO anon;
GRANT INSERT ON public."CS_FORM_RESPOSTAS" TO anon;

-- Gestão: qualquer autenticado (o acesso à TELA é governado pelo painel).
DROP POLICY IF EXISTS cs_forms_auth ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_auth ON public."CS_FORMULARIOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cs_form_perg_auth ON public."CS_FORM_PERGUNTAS";
CREATE POLICY cs_form_perg_auth ON public."CS_FORM_PERGUNTAS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cs_form_resp_auth ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_auth ON public."CS_FORM_RESPOSTAS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Público (anon): lê só formulário PUBLICADO (a página trata janela/encerrado).
DROP POLICY IF EXISTS cs_forms_public_read ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_public_read ON public."CS_FORMULARIOS"
  FOR SELECT TO anon USING (status = 'publicado');
DROP POLICY IF EXISTS cs_form_perg_public_read ON public."CS_FORM_PERGUNTAS";
CREATE POLICY cs_form_perg_public_read ON public."CS_FORM_PERGUNTAS"
  FOR SELECT TO anon USING (EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = formulario_id AND f.status = 'publicado'));

-- Resposta anônima: só com formulário publicado, dentro da janela e
-- abaixo do limite de respostas (quando definido).
DROP POLICY IF EXISTS cs_form_resp_public_insert ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_public_insert ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO anon WITH CHECK (EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = formulario_id
       AND f.status = 'publicado'
       AND (f.inicia_em  IS NULL OR now() >= f.inicia_em)
       AND (f.encerra_em IS NULL OR now() <= f.encerra_em)
       AND (f.max_respostas IS NULL OR
            (SELECT count(*) FROM public."CS_FORM_RESPOSTAS" r
              WHERE r.formulario_id = f.id) < f.max_respostas)));

-- ── Storage: imagens dos formulários (capa e perguntas) ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('cs-formularios', 'cs-formularios', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS cs_forms_storage_read ON storage.objects;
CREATE POLICY cs_forms_storage_read ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'cs-formularios');
DROP POLICY IF EXISTS cs_forms_storage_insert ON storage.objects;
CREATE POLICY cs_forms_storage_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cs-formularios');
DROP POLICY IF EXISTS cs_forms_storage_update ON storage.objects;
CREATE POLICY cs_forms_storage_update ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'cs-formularios');
DROP POLICY IF EXISTS cs_forms_storage_delete ON storage.objects;
CREATE POLICY cs_forms_storage_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'cs-formularios');

-- ── Tela no painel Módulos & Menus (guardada por rota) ───────────────────
-- Sem seed de permissão: a liberação é feita no painel
-- /app/administracao?tab=modulos, como todo o resto do ERP. Quem pode
-- criar formulários e quem vê cada formulário é configurado dentro do
-- próprio sistema (ver 20260710000005).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'central_servicos_formularios', 'Nascimento Formulários', '/app/central-servicos/formularios', 30
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.rota = '/app/central-servicos/formularios');

NOTIFY pgrst, 'reload schema';


-- ===== 20260710000005_formularios_permissoes_dashboard =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — permissões por formulário + dashboard
--
-- Configurações DENTRO do sistema (tela ⚙ Configurações):
--   CS_FORM_GESTORES      — quem pode CRIAR formulários (e administrar a
--                           configuração). Lista VAZIA = qualquer autenticado
--                           pode criar (estado inicial, nada trava).
--   CS_FORMULARIOS.visibilidade — 'todos' (padrão) ou 'restrita'
--   CS_FORM_VISIBILIDADE  — quem VÊ o formulário na gestão quando restrito
--                           (o criador e os gestores sempre veem)
--   CS_FORM_DASHBOARDS    — dashboard customizável (widgets em jsonb, por
--                           usuário)
--
-- A autoridade é a RLS: as policies amplas ("qualquer autenticado faz tudo")
-- são substituídas por regras por linha. A URL pública (anon) não muda:
-- formulário publicado continua respondível por qualquer pessoa com o link.
-- =========================================================================

ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS visibilidade text NOT NULL DEFAULT 'todos'; -- todos | restrita

CREATE TABLE IF NOT EXISTS public."CS_FORM_GESTORES" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public."CS_FORM_VISIBILIDADE" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (formulario_id, user_id)
);
CREATE INDEX IF NOT EXISTS cs_form_vis_form_idx ON public."CS_FORM_VISIBILIDADE"(formulario_id);

CREATE TABLE IF NOT EXISTS public."CS_FORM_DASHBOARDS" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  config     jsonb NOT NULL DEFAULT '[]'::jsonb  -- lista de widgets
);

-- Pode criar formulários? (lista de gestores vazia = todos podem)
CREATE OR REPLACE FUNCTION public.cs_form_pode_criar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public."CS_FORM_GESTORES")
      OR EXISTS (SELECT 1 FROM public."CS_FORM_GESTORES" g WHERE g.user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_criar() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_criar() FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode_criar() TO authenticated;

-- ── RLS: CS_FORMULARIOS (substitui a policy ampla) ───────────────────────
DROP POLICY IF EXISTS cs_forms_auth ON public."CS_FORMULARIOS";
DROP POLICY IF EXISTS cs_forms_select ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_select ON public."CS_FORMULARIOS"
  FOR SELECT TO authenticated USING (
    visibilidade = 'todos'
    OR criado_por = auth.uid()
    OR EXISTS (SELECT 1 FROM public."CS_FORM_VISIBILIDADE" v
                WHERE v.formulario_id = "CS_FORMULARIOS".id AND v.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public."CS_FORM_GESTORES" g WHERE g.user_id = auth.uid())
  );
DROP POLICY IF EXISTS cs_forms_insert ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_insert ON public."CS_FORMULARIOS"
  FOR INSERT TO authenticated WITH CHECK (public.cs_form_pode_criar());
-- Editar/excluir: o criador do formulário ou gestor (lista vazia = aberto).
DROP POLICY IF EXISTS cs_forms_update ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_update ON public."CS_FORMULARIOS"
  FOR UPDATE TO authenticated
  USING (criado_por = auth.uid() OR public.cs_form_pode_criar())
  WITH CHECK (criado_por = auth.uid() OR public.cs_form_pode_criar());
DROP POLICY IF EXISTS cs_forms_delete ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_delete ON public."CS_FORMULARIOS"
  FOR DELETE TO authenticated
  USING (criado_por = auth.uid() OR public.cs_form_pode_criar());

-- ── RLS: perguntas e respostas delegam ao formulário ─────────────────────
-- SELECT herda a visibilidade do pai (o EXISTS passa pela RLS do pai);
-- escrita exige poder gerenciar o pai.
DROP POLICY IF EXISTS cs_form_perg_auth ON public."CS_FORM_PERGUNTAS";
DROP POLICY IF EXISTS cs_form_perg_select ON public."CS_FORM_PERGUNTAS";
CREATE POLICY cs_form_perg_select ON public."CS_FORM_PERGUNTAS"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f WHERE f.id = formulario_id));
DROP POLICY IF EXISTS cs_form_perg_write ON public."CS_FORM_PERGUNTAS";
CREATE POLICY cs_form_perg_write ON public."CS_FORM_PERGUNTAS"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                  WHERE f.id = formulario_id
                    AND (f.criado_por = auth.uid() OR public.cs_form_pode_criar())))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                       WHERE f.id = formulario_id
                         AND (f.criado_por = auth.uid() OR public.cs_form_pode_criar())));

DROP POLICY IF EXISTS cs_form_resp_auth ON public."CS_FORM_RESPOSTAS";
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f WHERE f.id = formulario_id));
DROP POLICY IF EXISTS cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f WHERE f.id = formulario_id));
DROP POLICY IF EXISTS cs_form_resp_delete ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_delete ON public."CS_FORM_RESPOSTAS"
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
             WHERE f.id = formulario_id
               AND (f.criado_por = auth.uid() OR public.cs_form_pode_criar())));

-- ── RLS: tabelas de configuração ─────────────────────────────────────────
ALTER TABLE public."CS_FORM_GESTORES"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_FORM_VISIBILIDADE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_FORM_DASHBOARDS"   ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_FORM_GESTORES", public."CS_FORM_VISIBILIDADE", public."CS_FORM_DASHBOARDS" TO authenticated;

DROP POLICY IF EXISTS cs_form_gest_select ON public."CS_FORM_GESTORES";
CREATE POLICY cs_form_gest_select ON public."CS_FORM_GESTORES"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS cs_form_gest_write ON public."CS_FORM_GESTORES";
CREATE POLICY cs_form_gest_write ON public."CS_FORM_GESTORES"
  FOR ALL TO authenticated
  USING (public.cs_form_pode_criar()) WITH CHECK (public.cs_form_pode_criar());

DROP POLICY IF EXISTS cs_form_vis_select ON public."CS_FORM_VISIBILIDADE";
CREATE POLICY cs_form_vis_select ON public."CS_FORM_VISIBILIDADE"
  FOR SELECT TO authenticated USING (true);
-- Escrita só em INSERT/DELETE (NÃO 'FOR ALL'): uma policy FOR ALL também vale
-- para SELECT, e como a policy de CS_FORMULARIOS consulta CS_FORM_VISIBILIDADE,
-- isso reentraria em CS_FORMULARIOS → recursão infinita. O SELECT desta tabela
-- é coberto por cs_form_vis_select (true).
DROP POLICY IF EXISTS cs_form_vis_write   ON public."CS_FORM_VISIBILIDADE";
DROP POLICY IF EXISTS cs_form_vis_insert  ON public."CS_FORM_VISIBILIDADE";
CREATE POLICY cs_form_vis_insert ON public."CS_FORM_VISIBILIDADE"
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                       WHERE f.id = formulario_id
                         AND (f.criado_por = auth.uid() OR public.cs_form_pode_criar())));
DROP POLICY IF EXISTS cs_form_vis_delete  ON public."CS_FORM_VISIBILIDADE";
CREATE POLICY cs_form_vis_delete ON public."CS_FORM_VISIBILIDADE"
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                  WHERE f.id = formulario_id
                    AND (f.criado_por = auth.uid() OR public.cs_form_pode_criar())));

DROP POLICY IF EXISTS cs_form_dash_own ON public."CS_FORM_DASHBOARDS";
CREATE POLICY cs_form_dash_own ON public."CS_FORM_DASHBOARDS"
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Limpa o seed antigo de admins da tela (a liberação da TELA é pelo painel;
-- quem cria/vê formulário é pela configuração acima).
DELETE FROM public.screen_permission_user
 WHERE menu_codigo = 'central_servicos_formularios'
   AND motivo LIKE 'Nascimento Formulários%';

NOTIFY pgrst, 'reload schema';

-- ===== 20260714100000_formularios_permissoes_somente_usuario =====
-- =========================================================================
-- NASCIMENTO FORMULARIOS - permissoes SOMENTE POR USUARIO
--
-- Remove por completo o modelo "por setor" que estava por cima do por-usuario:
--   * cs_form_cap deixa de considerar grants por Setor_ERP (era isso que
--     fazia o usuario continuar podendo tudo mesmo com os toggles zerados -
--     o setor dele, ex.: SISTEMAS, tinha os grants).
--   * some a classificacao Administrativo/Operacional (CS_FORM_SETOR_GRUPO)
--     e as capacidades ver_admin / ver_op que dependiam dela.
--
-- Capacidade efetiva agora = admin, OU 'responder' (default de todo logado),
-- OU grant do proprio usuario em CS_FORM_ACESSOS.
--
-- Idempotente.
-- =========================================================================

-- ── 1) has-capability: admin + responder(default) + grant do USUARIO ─────
CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR _cap = 'responder'
      OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                  WHERE a.papel = _cap AND a.user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap(text) TO authenticated;

-- ── 2) RLS respostas: escopo de visualizacao sem Admin/Operacional ───────
-- (as duas linhas ver_admin/ver_op referenciavam CS_FORM_SETOR_GRUPO, que
-- vai ser removida abaixo - recriar a policy ANTES do DROP TABLE.)
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid()));

-- ── 3) Limpa os grants por setor e as capacidades sem uso ────────────────
DELETE FROM public."CS_FORM_ACESSOS" WHERE setor IS NOT NULL;
DELETE FROM public."CS_FORM_ACESSOS" WHERE papel IN ('ver_admin', 'ver_op');

-- ── 4) Remove a classificacao Administrativo/Operacional ─────────────────
DROP TABLE IF EXISTS public."CS_FORM_SETOR_GRUPO";

-- ── 5) Coluna setor sai (dropa junto a constraint de alvo e o indice de
--        setor que dependem dela) e o check de papel volta ao conjunto atual
ALTER TABLE public."CS_FORM_ACESSOS" DROP COLUMN IF EXISTS setor;

ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_papel_check;
ALTER TABLE public."CS_FORM_ACESSOS" ADD CONSTRAINT cs_form_acessos_papel_check CHECK (papel IN (
  'editar_criar', 'responder', 'encerrar_excluir', 'ver_tudo', 'ver_proprias', 'dashboard'));

NOTIFY pgrst, 'reload schema';

-- ===== 20260714100001_formularios_permissoes_valem_para_admin =====
-- =========================================================================
-- NASCIMENTO FORMULARIOS - as capacidades valem TAMBEM para admin
--
-- O modulo passa a ser governado 100% pelos grants POR USUARIO em
-- CS_FORM_ACESSOS - inclusive para admin. Um admin SEM grant so pode
-- 'responder' (Abrir). As policies de escrita de CS_FORM_ACESSOS continuam
-- abertas a admin, entao ele sempre consegue se conceder as capacidades.
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _cap = 'responder'
      OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                  WHERE a.papel = _cap AND a.user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap(text) TO authenticated;

DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid()));

NOTIFY pgrst, 'reload schema';

-- ===== 20260715000001_formularios_vinculos_pessoa =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — vínculo manual "nome citado" ⇄ EMPREGADOS
--
-- As respostas guardam o nome como TEXTO LIVRE ("João Peretti"), então quem
-- tem o nome completo diferente no cadastro ("João Pedro Peretti") nunca casa
-- e fica sem ficha. Esta tabela guarda o de-para feito à mão na tela de
-- Respostas: nome_norm (normalizado) → registro de EMPREGADOS.
--
-- nome_norm é gerado no client (mesma regra do normNome do front: sem acento,
-- espaços colapsados, MAIÚSCULAS) — por isso não há unaccent aqui.
-- empregado_nome é snapshot só p/ exibir; a verdade é empregado_id.
--
-- Sem FK para EMPREGADOS: a tabela é legado importado e "ID" não tem PK
-- declarada. Vínculo órfão (empregado apagado) simplesmente não resolve.
--
-- RLS no padrão do módulo: gating na UI + policy permissiva p/ authenticated
-- (a própria EMPREGADOS já é update-livre p/ authenticated — ver
-- 20260622000025_empregados_rh_update.sql).
-- Idempotente.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORM_VINCULOS" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome_norm      text        NOT NULL,   -- texto da resposta, normalizado
  nome_texto     text        NOT NULL,   -- como apareceu na resposta
  empregado_id   bigint      NOT NULL,
  empregado_nome text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  criado_por     uuid        DEFAULT auth.uid()
);

-- Um texto só aponta p/ um empregado (upsert por nome_norm na UI).
CREATE UNIQUE INDEX IF NOT EXISTS cs_form_vinculos_nome_norm_uidx
  ON public."CS_FORM_VINCULOS"(nome_norm);
-- Caminho inverso: todos os apelidos de um empregado (usado p/ cruzar
-- participação em formulários).
CREATE INDEX IF NOT EXISTS cs_form_vinculos_emp_idx
  ON public."CS_FORM_VINCULOS"(empregado_id);

DROP TRIGGER IF EXISTS trg_cs_form_vinculos_updated ON public."CS_FORM_VINCULOS";
CREATE TRIGGER trg_cs_form_vinculos_updated BEFORE UPDATE ON public."CS_FORM_VINCULOS"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."CS_FORM_VINCULOS" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_form_vinculos_select ON public."CS_FORM_VINCULOS";
CREATE POLICY cs_form_vinculos_select ON public."CS_FORM_VINCULOS"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cs_form_vinculos_write ON public."CS_FORM_VINCULOS";
CREATE POLICY cs_form_vinculos_write ON public."CS_FORM_VINCULOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ===== 20260715000002_formularios_seguranca =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — segurança POR FORMULÁRIO (quem pode responder)
--
-- Antes: qualquer um com o slug lia QUALQUER formulário publicado (policy
-- cs_forms_public_read = "status publicado") e conseguia responder. O filtro
-- por setor existia só como `if` no React (FormularioPublico) — decorativo.
-- Aqui a regra passa a valer no BANCO.
--
-- Modelo (CS_FORMULARIOS.seguranca):
--   'liberado' — URL pública, sem login. anon lê e responde.
--   'restrito' — exige login. Quem responde é a UNIÃO de:
--                  • setores_acesso (text[], casa com EMPREGADOS.Setor_ERP)
--                  • CS_FORM_ALVO_USUARIOS (usuários do ERP escolhidos a dedo)
--                Restrito sem setor e sem pessoa = qualquer usuário logado.
--   exige_senha  — camada extra dentro de 'restrito': login + senha.
--
-- Senha: o hash (bcrypt) mora em CS_FORM_SENHAS, tabela SEM privilégio p/
-- anon/authenticated — nunca trafega pro client. Conferir/definir só pelas
-- RPCs SECURITY DEFINER abaixo. Acertar a senha grava um passe de 6h em
-- CS_FORM_SENHA_OK, e é ELE que a policy de INSERT exige — então a senha
-- vale no banco também, não só na tela.
--
-- LIMITE CONHECIDO: ler o formulário logado. cs_forms_select (gestão) já
-- libera SELECT p/ todo authenticated quando visibilidade='todos' — então um
-- usuário logado FORA do público-alvo ainda consegue ler as perguntas via
-- API. O que ele NÃO consegue é ENVIAR resposta (policies abaixo). Fechar
-- isso exigiria separar "ler p/ gerir" de "ler p/ responder" no modelo de
-- visibilidade — fora do escopo desta migration.
-- Idempotente.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1) Colunas de segurança no formulário ────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS seguranca      text    NOT NULL DEFAULT 'liberado',
  ADD COLUMN IF NOT EXISTS exige_senha    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS setores_acesso text[];

ALTER TABLE public."CS_FORMULARIOS" DROP CONSTRAINT IF EXISTS cs_forms_seguranca_check;
ALTER TABLE public."CS_FORMULARIOS" ADD  CONSTRAINT cs_forms_seguranca_check
  CHECK (seguranca IN ('liberado', 'restrito'));

-- Quem já tinha restrição por setor (regra antiga, só no React) vira restrito
-- de verdade — senão a migration afrouxaria o que hoje é filtrado na tela.
UPDATE public."CS_FORMULARIOS"
   SET seguranca = 'restrito'
 WHERE seguranca = 'liberado' AND COALESCE(array_length(setores_acesso, 1), 0) > 0;

-- ── 2) Pessoas específicas (usuários do ERP) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public."CS_FORM_ALVO_USUARIOS" (
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid DEFAULT auth.uid(),
  PRIMARY KEY (formulario_id, user_id)
);
ALTER TABLE public."CS_FORM_ALVO_USUARIOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."CS_FORM_ALVO_USUARIOS" TO authenticated;

-- ── 3) Senha: hash isolado + passe temporário ────────────────────────────
CREATE TABLE IF NOT EXISTS public."CS_FORM_SENHAS" (
  formulario_id uuid PRIMARY KEY REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  senha_hash    text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid DEFAULT auth.uid()
);
ALTER TABLE public."CS_FORM_SENHAS" ENABLE ROW LEVEL SECURITY;
-- Sem policy e sem GRANT: nem anon nem authenticated tocam. Só as RPCs.
REVOKE ALL ON public."CS_FORM_SENHAS" FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public."CS_FORM_SENHA_OK" (
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  expira_em     timestamptz NOT NULL DEFAULT now() + interval '6 hours',
  PRIMARY KEY (formulario_id, user_id)
);
ALTER TABLE public."CS_FORM_SENHA_OK" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_SENHA_OK" FROM anon, authenticated;

-- ── 4) Helpers (SECURITY DEFINER: leem tabelas fechadas ao client) ───────

-- Publicado, dentro da janela e abaixo do limite de respostas.
CREATE OR REPLACE FUNCTION public.cs_form_aberto(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = _form_id
       AND f.status = 'publicado'
       AND (f.inicia_em  IS NULL OR now() >= f.inicia_em)
       AND (f.encerra_em IS NULL OR now() <= f.encerra_em)
       AND (f.max_respostas IS NULL OR
            (SELECT count(*) FROM public."CS_FORM_RESPOSTAS" r WHERE r.formulario_id = f.id) < f.max_respostas));
$$;

-- O usuário atual está no público-alvo? (liberado = todo mundo, inclusive anon)
CREATE OR REPLACE FUNCTION public.cs_form_alvo(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = _form_id
       AND (
         f.seguranca = 'liberado'
         OR (auth.uid() IS NOT NULL AND (
           -- restrito sem filtro nenhum = qualquer usuário logado do ERP
           (COALESCE(array_length(f.setores_acesso, 1), 0) = 0
            AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u WHERE u.formulario_id = f.id))
           -- união: do setor liberado OU escolhido a dedo
           OR EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                       WHERE e.auth_user_id = auth.uid()
                         AND e."Setor_ERP" = ANY (f.setores_acesso))
           OR EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u
                       WHERE u.formulario_id = f.id AND u.user_id = auth.uid())
         ))
       ));
$$;

-- Formulário não pede senha, ou o usuário já acertou (passe válido).
CREATE OR REPLACE FUNCTION public.cs_form_senha_ok(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f WHERE f.id = _form_id AND f.exige_senha)
      OR EXISTS (SELECT 1 FROM public."CS_FORM_SENHA_OK" t
                  WHERE t.formulario_id = _form_id AND t.user_id = auth.uid() AND t.expira_em > now());
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_aberto(uuid), public.cs_form_alvo(uuid), public.cs_form_senha_ok(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_aberto(uuid), public.cs_form_alvo(uuid), public.cs_form_senha_ok(uuid) TO anon, authenticated;

-- "Portaria" da URL pública: anon NÃO lê mais um formulário restrito (policy
-- abaixo), então sem isto a página mostraria "não encontrado" em vez de mandar
-- pro login. Devolve só o mínimo p/ decidir a porta — nunca título/perguntas.
CREATE OR REPLACE FUNCTION public.cs_form_porta(_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'existe', true,
              'seguranca', f.seguranca,
              'exige_senha', f.exige_senha,
              'publicado', f.status = 'publicado')
       FROM public."CS_FORMULARIOS" f WHERE f.slug = _slug),
    jsonb_build_object('existe', false));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_porta(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_porta(text) TO anon, authenticated;

-- ── 5) RPCs de senha ─────────────────────────────────────────────────────

-- Define (ou remove, com _senha NULL/vazia) a senha do formulário. O texto
-- puro só existe dentro desta chamada: sai daqui como hash bcrypt.
CREATE OR REPLACE FUNCTION public.cs_form_definir_senha(_form_id uuid, _senha text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                  WHERE f.id = _form_id
                    AND (f.criado_por = auth.uid() OR public.cs_form_cap('editar_criar'))) THEN
    RAISE EXCEPTION 'Sem permissão para alterar a senha deste formulário.';
  END IF;

  IF _senha IS NULL OR btrim(_senha) = '' THEN
    DELETE FROM public."CS_FORM_SENHAS" WHERE formulario_id = _form_id;
    DELETE FROM public."CS_FORM_SENHA_OK" WHERE formulario_id = _form_id;
    UPDATE public."CS_FORMULARIOS" SET exige_senha = false WHERE id = _form_id;
  ELSE
    INSERT INTO public."CS_FORM_SENHAS" (formulario_id, senha_hash)
    VALUES (_form_id, crypt(_senha, gen_salt('bf')))
    ON CONFLICT (formulario_id) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, updated_at = now();
    -- Trocou a senha: derruba os passes antigos.
    DELETE FROM public."CS_FORM_SENHA_OK" WHERE formulario_id = _form_id;
    UPDATE public."CS_FORMULARIOS" SET exige_senha = true WHERE id = _form_id;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.cs_form_definir_senha(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_definir_senha(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_definir_senha(uuid, text) TO authenticated;

-- Confere a senha e, acertando, grava o passe de 6h que libera o INSERT.
-- Só p/ quem está logado E no público-alvo (senha é sempre dentro de restrito).
CREATE OR REPLACE FUNCTION public.cs_form_conferir_senha(_slug text, _senha text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE _id uuid; _hash text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT f.id INTO _id FROM public."CS_FORMULARIOS" f WHERE f.slug = _slug;
  IF _id IS NULL OR NOT public.cs_form_alvo(_id) THEN RETURN false; END IF;

  SELECT s.senha_hash INTO _hash FROM public."CS_FORM_SENHAS" s WHERE s.formulario_id = _id;
  IF _hash IS NULL OR crypt(_senha, _hash) <> _hash THEN RETURN false; END IF;

  INSERT INTO public."CS_FORM_SENHA_OK" (formulario_id, user_id)
  VALUES (_id, auth.uid())
  ON CONFLICT (formulario_id, user_id) DO UPDATE SET expira_em = now() + interval '6 hours';
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.cs_form_conferir_senha(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_conferir_senha(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_conferir_senha(text, text) TO authenticated;

-- ── 6) RLS: leitura do formulário ────────────────────────────────────────
-- anon só enxerga formulário LIBERADO (antes: qualquer um publicado).
DROP POLICY IF EXISTS cs_forms_public_read ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_public_read ON public."CS_FORMULARIOS"
  FOR SELECT TO anon USING (status = 'publicado' AND seguranca = 'liberado');

-- Perguntas legadas (tabela some depois do 3_tabelas; guarda p/ idempotência).
DO $$ BEGIN
  IF to_regclass('public."CS_FORM_PERGUNTAS"') IS NOT NULL THEN
    DROP POLICY IF EXISTS cs_form_perg_public_read ON public."CS_FORM_PERGUNTAS";
    CREATE POLICY cs_form_perg_public_read ON public."CS_FORM_PERGUNTAS"
      FOR SELECT TO anon USING (EXISTS (
        SELECT 1 FROM public."CS_FORMULARIOS" f
         WHERE f.id = formulario_id AND f.status = 'publicado' AND f.seguranca = 'liberado'));
  END IF;
END $$;

-- ── 7) RLS: envio de resposta (a trava que vale) ─────────────────────────
-- Anônimo: só formulário liberado, aberto.
DROP POLICY IF EXISTS cs_form_resp_public_insert ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_public_insert ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO anon WITH CHECK (
    public.cs_form_aberto(formulario_id)
    AND EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                 WHERE f.id = formulario_id AND f.seguranca = 'liberado'));

-- Logado: aberto + no público-alvo + senha conferida.
-- (Não usa mais cs_form_cap('responder'): ela é TRUE p/ todo mundo por
--  definição e anularia o público-alvo. 'editar_criar' fica p/ importar.)
DROP POLICY IF EXISTS cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('editar_criar')
    OR (public.cs_form_aberto(formulario_id)
        AND public.cs_form_alvo(formulario_id)
        AND public.cs_form_senha_ok(formulario_id)));

-- ── 8) RLS: quem edita o formulário mexe no público-alvo ─────────────────
DROP POLICY IF EXISTS cs_form_alvo_select ON public."CS_FORM_ALVO_USUARIOS";
CREATE POLICY cs_form_alvo_select ON public."CS_FORM_ALVO_USUARIOS"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cs_form_alvo_write ON public."CS_FORM_ALVO_USUARIOS";
CREATE POLICY cs_form_alvo_write ON public."CS_FORM_ALVO_USUARIOS"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                  WHERE f.id = formulario_id
                    AND (f.criado_por = auth.uid() OR public.cs_form_cap('editar_criar'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                       WHERE f.id = formulario_id
                         AND (f.criado_por = auth.uid() OR public.cs_form_cap('editar_criar'))));

NOTIFY pgrst, 'reload schema';

-- ===== 20260715000003_formularios_ver_por_setor =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — "ver respostas de setor X" por usuário
--
-- REVERTE (de propósito) parte de 20260714100000_formularios_permissoes_
-- somente_usuario, que dropou a coluna `setor` de CS_FORM_ACESSOS p/ deixar o
-- modelo "só por usuário". O pedido agora é outro formato: continua sendo um
-- grant POR USUÁRIO, mas parametrizado por setor —
--   "o Fulano pode visualizar as respostas de Jurídico e de Compras".
--
-- papel 'ver_setor' + setor = 'JURIDICO'  → uma linha por setor liberado.
-- Combina em UNIÃO com o que já existe:
--   ver_tudo      → todas as respostas
--   ver_proprias  → as que a própria pessoa enviou
--   ver_setor     → as respostas carimbadas com aquele setor
--
-- O setor da resposta é CS_FORM_RESPOSTAS.setor (vem do cadastro do
-- respondente ou da pergunta indicada em pergunta_setor_id).
-- Idempotente.
-- =========================================================================

-- ── 1) Coluna setor volta ────────────────────────────────────────────────
ALTER TABLE public."CS_FORM_ACESSOS"
  ADD COLUMN IF NOT EXISTS setor text;

-- 'ver_setor' entra no conjunto de papéis.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_papel_check;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_papel_check CHECK (papel IN (
  'editar_criar', 'responder', 'encerrar_excluir', 'ver_tudo', 'ver_proprias', 'ver_setor', 'dashboard'));

-- setor só existe (e é obrigatório) no papel 'ver_setor'.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_setor_por_papel;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_setor_por_papel
  CHECK ((setor IS NOT NULL) = (papel = 'ver_setor'));

-- Herança do modelo antigo: exigia formulario_id NÃO nulo p/ papel 'visualiza',
-- que não existe mais no check acima — a constraint só atrapalha.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;

-- ── 2) Unicidade: 1 linha por (usuário, setor) no ver_setor ──────────────
-- O índice global antigo é (papel, user_id) — travaria o 2º setor do mesmo
-- usuário. Recria excluindo ver_setor e cria o específico.
DROP INDEX IF EXISTS cs_form_acessos_unq_global;
CREATE UNIQUE INDEX cs_form_acessos_unq_global
  ON public."CS_FORM_ACESSOS"(papel, user_id)
  WHERE formulario_id IS NULL AND papel <> 'ver_setor';

DROP INDEX IF EXISTS cs_form_acessos_unq_setor;
CREATE UNIQUE INDEX cs_form_acessos_unq_setor
  ON public."CS_FORM_ACESSOS"(user_id, setor)
  WHERE papel = 'ver_setor';

-- ── 3) Helper: o usuário pode ver respostas deste setor? ─────────────────
-- Compara sem caixa/espaço: o setor da resposta vem de texto livre
-- (EMPREGADOS.Setor_ERP ou o valor da pergunta de setor).
CREATE OR REPLACE FUNCTION public.cs_form_cap_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.papel = 'ver_setor'
       AND a.user_id = auth.uid()
       AND upper(btrim(a.setor)) = upper(btrim(_setor)));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_setor(text) TO authenticated;

-- ── 4) RLS: leitura de respostas em UNIÃO ────────────────────────────────
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_cap_setor(setor));

NOTIFY pgrst, 'reload schema';

-- ===== 20260716000001_formularios_criar_por_setor =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — "criar formulários por setor" (setor-dono)
--
-- Novo formato de grant POR USUÁRIO, parametrizado por setor, IRMÃO do
-- 'ver_setor' mas com semântica de DONO do formulário:
--   papel 'criar_setor' + setor = 'COMPRAS'  → o usuário só CRIA formulários
--   carimbados com setor='COMPRAS' (e edita as perguntas deles) e VÊ todas as
--   respostas dos formulários cujo setor='COMPRAS', de qualquer respondente.
--
-- Diferença p/ 'ver_setor': ver_setor classifica pelo SETOR DO RESPONDENTE
-- (CS_FORM_RESPOSTAS.setor); criar_setor pelo SETOR DONO DO FORMULÁRIO
-- (CS_FORMULARIOS.setor). Convivem na UNIÃO da RLS.
-- Idempotente.
-- =========================================================================

-- ── 1) Coluna dona do formulário ─────────────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS" ADD COLUMN IF NOT EXISTS setor text;
CREATE INDEX IF NOT EXISTS cs_forms_setor_idx ON public."CS_FORMULARIOS"(setor);

-- ── 2) papel 'criar_setor' entra no conjunto; setor vale p/ ver_setor OU criar_setor
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_papel_check;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_papel_check CHECK (papel IN (
  'editar_criar', 'responder', 'encerrar_excluir', 'ver_tudo', 'ver_proprias',
  'ver_setor', 'criar_setor', 'dashboard'));

ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_setor_por_papel;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_setor_por_papel
  CHECK ((setor IS NOT NULL) = (papel IN ('ver_setor', 'criar_setor')));

-- ── 3) Unicidade: 1 linha por (usuário, setor) também no criar_setor ─────
DROP INDEX IF EXISTS cs_form_acessos_unq_global;
CREATE UNIQUE INDEX cs_form_acessos_unq_global
  ON public."CS_FORM_ACESSOS"(papel, user_id)
  WHERE formulario_id IS NULL AND papel NOT IN ('ver_setor', 'criar_setor');

DROP INDEX IF EXISTS cs_form_acessos_unq_criar_setor;
CREATE UNIQUE INDEX cs_form_acessos_unq_criar_setor
  ON public."CS_FORM_ACESSOS"(user_id, setor)
  WHERE papel = 'criar_setor';

-- ── 4) Helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_pode_criar_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.papel = 'criar_setor'
       AND a.user_id = auth.uid()
       AND upper(btrim(a.setor)) = upper(btrim(_setor)));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_criar_setor(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_criar_setor(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode_criar_setor(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cs_form_cap_form_setor(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
      JOIN public."CS_FORM_ACESSOS" a
        ON a.papel = 'criar_setor' AND a.user_id = auth.uid()
       AND upper(btrim(a.setor)) = upper(btrim(f.setor))
     WHERE f.id = _form_id AND f.setor IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_form_setor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_form_setor(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_form_setor(uuid) TO authenticated;

-- ── 5) RLS: insert de formulário aceita o criador do setor ───────────────
DROP POLICY IF EXISTS cs_forms_insert ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_insert ON public."CS_FORMULARIOS"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_pode_criar()
    OR (setor IS NOT NULL AND public.cs_form_pode_criar_setor(setor)));

-- ── 6) RLS: leitura de respostas em UNIÃO (+ setor-dono do formulário) ────
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_cap_setor(setor)
    OR public.cs_form_cap_form_setor(formulario_id));

NOTIFY pgrst, 'reload schema';

-- ===== 20260716000002_formularios_anexo_respondente =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — anexo de arquivo pelo respondente
-- Perguntas podem aceitar um arquivo do respondente (config `anexo_resp`; a
-- URL vai em CS_FORM_RESPOSTAS.itens sob `${pergunta_id}__anexo`). Faltava o
-- respondente ANÔNIMO poder subir arquivo no bucket cs-formularios + teto 25MB.
-- Idempotente.
-- =========================================================================
DROP POLICY IF EXISTS cs_form_files_insert_anon ON storage.objects;
CREATE POLICY cs_form_files_insert_anon ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'cs-formularios');

UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'cs-formularios';

-- ===== 20260716000003_admin_vinculo_empregado =====
-- =========================================================================
-- ADMIN — vincular login ↔ cadastro EMPREGADOS (Senior) e puxar o nome oficial
-- admin_vincular_empregado / admin_desvincular_empregado (admin-only) +
-- vincular_meu_empregado agora também grava profiles.display_name = Nome.
-- Bloqueia desligados (DEMITIDO/DEMITIDA/RESCISÃO/DESLIGADO/DESLIGADA). Idempotente.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_vincular_empregado(
  p_user_id     uuid,
  p_empregado_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  public."EMPREGADOS"%ROWTYPE;
  v_bloq text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem vincular.');
  END IF;
  IF p_user_id IS NULL OR p_empregado_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário e colaborador são obrigatórios.');
  END IF;

  SELECT * INTO v_emp FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Colaborador desligado — não pode ser vinculado.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário.');
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = NULL
   WHERE auth_user_id = p_user_id AND "ID" <> p_empregado_id;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = p_user_id,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = p_user_id)
                     ELSE "email"
                   END
   WHERE "ID" = p_empregado_id;

  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'empregado', jsonb_build_object(
    'id', v_emp."ID", 'nome', coalesce(v_emp."Nome",''), 'cargo', coalesce(v_emp."Título do Cargo",''),
    'setor', coalesce(v_emp."Setor_ERP",''), 'situacao', coalesce(v_emp."Situação",'')));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conflito de vínculo — recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_vincular_empregado(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_empregado(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_desvincular_empregado(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem desvincular.');
  END IF;
  UPDATE public."EMPREGADOS" SET auth_user_id = NULL WHERE auth_user_id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_desvincular_empregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desvincular_empregado(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.vincular_meu_empregado(
  p_cpf        text,
  p_nascimento text,
  p_confirmar  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_cpf     text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_nasc    text := regexp_replace(coalesce(p_nascimento, ''), '\D', '', 'g');
  v_cpf_fmt text;
  v_emp     public."EMPREGADOS"%ROWTYPE;
  v_bloq    text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
  v_preview jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;
  IF length(v_cpf) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um CPF válido (11 dígitos).');
  END IF;
  IF length(v_nasc) <> 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe a data de nascimento (DD/MM/AAAA).');
  END IF;

  v_cpf_fmt := substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2);

  SELECT * INTO v_emp
  FROM public."EMPREGADOS" e
  WHERE e."CPF" IN (v_cpf, v_cpf_fmt)
  ORDER BY
    (CASE WHEN upper(coalesce(e."Situação",'')) = ANY (v_bloq) THEN 1 ELSE 0 END) ASC,
    (CASE WHEN e."Admissão" ~ '^\d{2}/\d{2}/\d{4}$'
          THEN (substr(e."Admissão",7,4) || substr(e."Admissão",4,2) || substr(e."Admissão",1,2))::bigint
          ELSE 0 END) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro consta como desligado. Procure o RH.');
  END IF;

  IF regexp_replace(coalesce(v_emp."Nascimento",''), '\D', '', 'g') <> v_nasc THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CPF e data de nascimento não conferem.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário. Procure o RH.');
  END IF;

  v_preview := jsonb_build_object(
    'id',       v_emp."ID",
    'nome',     coalesce(v_emp."Nome", ''),
    'cargo',    coalesce(v_emp."Título do Cargo", ''),
    'setor',    coalesce(v_emp."Setor_ERP", ''),
    'perfil',   coalesce(v_emp."Perfil_ERP", ''),
    'lider',    coalesce(v_emp."LIDER", ''),
    'situacao', coalesce(v_emp."Situação", ''),
    'admissao', coalesce(v_emp."Admissão", ''),
    'empresa',  coalesce(v_emp."Nome da Empresa", ''),
    'filial',   coalesce(v_emp."Nome Filial", '')
  );

  IF NOT p_confirmar THEN
    RETURN jsonb_build_object('ok', true, 'ja_vinculado', (v_emp.auth_user_id = v_uid), 'empregado', v_preview);
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = v_uid,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = v_uid)
                     ELSE "email"
                   END
   WHERE "ID" = v_emp."ID";

  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'vinculado', true, 'empregado', v_preview);

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sua conta já está vinculada a outro cadastro.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.vincular_meu_empregado(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_meu_empregado(text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260716000004_admin_usuarios_acessos =====
-- =========================================================================
-- ADMIN › Usuários — capacidades delegáveis por usuário (vincular_usuario,
-- ver_detalhe_usuario). Espelha CS_FORM_ACESSOS. Admin sempre pode (bypass no
-- helper). As RPCs de vínculo passam a checar pode_acao_usuario. Idempotente.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public."ADMIN_USUARIOS_ACESSOS" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL,
  papel      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."ADMIN_USUARIOS_ACESSOS" DROP CONSTRAINT IF EXISTS admin_usuarios_acessos_papel_check;
ALTER TABLE public."ADMIN_USUARIOS_ACESSOS" ADD  CONSTRAINT admin_usuarios_acessos_papel_check
  CHECK (papel IN ('vincular_usuario', 'ver_detalhe_usuario'));

CREATE UNIQUE INDEX IF NOT EXISTS admin_usuarios_acessos_unq
  ON public."ADMIN_USUARIOS_ACESSOS"(user_id, papel);

ALTER TABLE public."ADMIN_USUARIOS_ACESSOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public."ADMIN_USUARIOS_ACESSOS" TO authenticated;

DROP POLICY IF EXISTS admin_usuarios_acessos_select ON public."ADMIN_USUARIOS_ACESSOS";
CREATE POLICY admin_usuarios_acessos_select ON public."ADMIN_USUARIOS_ACESSOS"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_usuarios_acessos_insert ON public."ADMIN_USUARIOS_ACESSOS";
CREATE POLICY admin_usuarios_acessos_insert ON public."ADMIN_USUARIOS_ACESSOS"
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_usuarios_acessos_delete ON public."ADMIN_USUARIOS_ACESSOS";
CREATE POLICY admin_usuarios_acessos_delete ON public."ADMIN_USUARIOS_ACESSOS"
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.pode_acao_usuario(_papel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public."ADMIN_USUARIOS_ACESSOS" a
                  WHERE a.user_id = auth.uid() AND a.papel = _papel);
$$;
REVOKE ALL ON FUNCTION public.pode_acao_usuario(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_acao_usuario(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_vincular_empregado(
  p_user_id     uuid,
  p_empregado_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  public."EMPREGADOS"%ROWTYPE;
  v_bloq text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.pode_acao_usuario('vincular_usuario') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para vincular usuários.');
  END IF;
  IF p_user_id IS NULL OR p_empregado_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário e colaborador são obrigatórios.');
  END IF;

  SELECT * INTO v_emp FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Colaborador desligado — não pode ser vinculado.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário.');
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = NULL
   WHERE auth_user_id = p_user_id AND "ID" <> p_empregado_id;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = p_user_id,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = p_user_id)
                     ELSE "email"
                   END
   WHERE "ID" = p_empregado_id;

  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'empregado', jsonb_build_object(
    'id', v_emp."ID", 'nome', coalesce(v_emp."Nome",''), 'cargo', coalesce(v_emp."Título do Cargo",''),
    'setor', coalesce(v_emp."Setor_ERP",''), 'situacao', coalesce(v_emp."Situação",'')));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conflito de vínculo — recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_vincular_empregado(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_empregado(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_desvincular_empregado(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.pode_acao_usuario('vincular_usuario') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para desvincular usuários.');
  END IF;
  UPDATE public."EMPREGADOS" SET auth_user_id = NULL WHERE auth_user_id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_desvincular_empregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desvincular_empregado(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260716000005_formularios_pergunta_nome_e_empregados_update =====
-- =========================================================================
-- 1) CS_FORMULARIOS.pergunta_nome_id — qual pergunta identifica o respondente
--    (irmã de pergunta_setor_id). Respostas importadas vêm com
--    respondente_nome nulo ("Anônimo" + filtro de Respondente vazio).
-- 2) EMPREGADOS: a migration 20260622000025 criou a POLICY de UPDATE mas nunca
--    deu o GRANT de tabela (só havia GRANT INSERT) — por isso "Trocar líder"
--    não gravava. GRANT e RLS são checagens separadas no Postgres.
-- Idempotente.
-- =========================================================================
ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS pergunta_nome_id text;

ALTER TABLE public."EMPREGADOS" ENABLE ROW LEVEL SECURITY;
GRANT UPDATE ON public."EMPREGADOS" TO authenticated;

DROP POLICY IF EXISTS empregados_update_rh ON public."EMPREGADOS";
CREATE POLICY empregados_update_rh ON public."EMPREGADOS"
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ===== 20260716000006_remover_admin_usuarios_acessos =====
-- =========================================================================
-- Reverte a delegação: Vincular/Ver detalhes voltam a ser SÓ de admin. As
-- RPCs voltam a checar has_role(admin); helper pode_acao_usuario e tabela
-- ADMIN_USUARIOS_ACESSOS saem. Idempotente.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_vincular_empregado(
  p_user_id     uuid,
  p_empregado_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  public."EMPREGADOS"%ROWTYPE;
  v_bloq text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem vincular.');
  END IF;
  IF p_user_id IS NULL OR p_empregado_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário e colaborador são obrigatórios.');
  END IF;

  SELECT * INTO v_emp FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Colaborador desligado — não pode ser vinculado.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário.');
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = NULL
   WHERE auth_user_id = p_user_id AND "ID" <> p_empregado_id;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = p_user_id,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = p_user_id)
                     ELSE "email"
                   END
   WHERE "ID" = p_empregado_id;

  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'empregado', jsonb_build_object(
    'id', v_emp."ID", 'nome', coalesce(v_emp."Nome",''), 'cargo', coalesce(v_emp."Título do Cargo",''),
    'setor', coalesce(v_emp."Setor_ERP",''), 'situacao', coalesce(v_emp."Situação",'')));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conflito de vínculo — recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_vincular_empregado(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_empregado(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_desvincular_empregado(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem desvincular.');
  END IF;
  UPDATE public."EMPREGADOS" SET auth_user_id = NULL WHERE auth_user_id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_desvincular_empregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desvincular_empregado(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.pode_acao_usuario(text);
DROP TABLE IF EXISTS public."ADMIN_USUARIOS_ACESSOS";

NOTIFY pgrst, 'reload schema';

-- ===== 20260720000001_empregados_cpf_formato_pontuado =====
-- =========================================================================
-- EMPREGADOS — Padronizar CPF no formato pontuado (XXX.XXX.XXX-XX)
--
-- Alguns CPFs estão só com dígitos (05566199003), outros pontuados
-- (055.661.990-03). É o MESMO valor — muda só a formatação. Normaliza tudo
-- para o formato com pontuação. Completa zero à esquerda até 11 dígitos (cobre
-- CPFs que perderam o zero por já terem sido salvos como número). Idempotente:
-- só toca em linhas com 8..11 dígitos e que ainda não estejam no formato certo.
-- =========================================================================

DO $$
DECLARE
  v_norm int;
  v_fora int;
BEGIN
  WITH atualizadas AS (
    UPDATE public."EMPREGADOS" e
       SET "CPF" = regexp_replace(
             lpad(regexp_replace(e."CPF", '\D', '', 'g'), 11, '0'),
             '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4'
           )
     WHERE e."CPF" IS NOT NULL
       AND length(regexp_replace(e."CPF", '\D', '', 'g')) BETWEEN 8 AND 11
       AND e."CPF" IS DISTINCT FROM regexp_replace(
             lpad(regexp_replace(e."CPF", '\D', '', 'g'), 11, '0'),
             '(\d{3})(\d{3})(\d{3})(\d{2})', '\1.\2.\3-\4'
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_norm FROM atualizadas;

  SELECT count(*) INTO v_fora
  FROM public."EMPREGADOS" e
  WHERE coalesce(btrim(e."CPF"), '') <> ''
    AND length(regexp_replace(e."CPF", '\D', '', 'g')) NOT BETWEEN 8 AND 11;

  RAISE NOTICE 'CPFs normalizados: %; fora do padrao (revisar manualmente): %', v_norm, v_fora;
END $$;

NOTIFY pgrst, 'reload schema';

-- ===== 20260720000002_admin_buscar_empregados =====
-- =========================================================================
-- ADMIN — Busca de colaboradores para o "Vincular colaborador"
--
-- A tela fazia SELECT direto na EMPREGADOS com .or(ilike), que dependia de RLS
-- e não ignorava acento / não quebrava em palavras / não casava CPF por dígitos
-- → buscas corretas não achavam ninguém. Esta RPC SECURITY DEFINER (padrão dos
-- outros fluxos de vínculo) faz a busca no servidor: só admin; ignora acento e
-- caixa; por NOME cada palavra precisa aparecer (qualquer ordem); por CPF casa
-- pelos dígitos; exclui desligados. Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_buscar_empregados(p_termo text)
RETURNS TABLE (
  "ID"               bigint,
  "Nome"             text,
  "CPF"              text,
  "Título do Cargo"  text,
  "Setor_ERP"        text,
  "Situação"         text,
  auth_user_id       uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q      text   := btrim(coalesce(p_termo, ''));
  v_digits text   := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
  v_bloq   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
    FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Setor_ERP", e."Situação", e.auth_user_id
  FROM public."EMPREGADOS" e
  WHERE upper(coalesce(e."Situação", '')) <> ALL (v_bloq)
    AND (
      ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tokens) t
          WHERE t <> ''
            AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
                NOT LIKE '%' || t || '%'
        )
      )
      OR
      ( length(v_digits) >= 3
        AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
      )
    )
  ORDER BY e."Nome"
  LIMIT 30;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_buscar_empregados(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_buscar_empregados(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260720000003_formularios_lixeira =====
-- 1) Coluna de soft-delete (o front depende dela — roda isto primeiro)
ALTER TABLE public."CS_FORMULARIOS" ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public."CS_FORMULARIOS" ADD COLUMN IF NOT EXISTS deleted_por_nome text;  -- quem apagou (exibido na lixeira)
CREATE INDEX IF NOT EXISTS cs_forms_deleted_idx ON public."CS_FORMULARIOS"(deleted_at);

-- 2) Novo papel 'ver_lixeira': só remove a checagem de papel (evita qualquer
--    conflito com valores legados no banco). A tela do admin controla os papéis.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_papel_check;

-- 3) anon não vê formulário apagado (só colunas — seguro)
DROP POLICY IF EXISTS cs_forms_public_read ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_public_read ON public."CS_FORMULARIOS"
  FOR SELECT TO anon USING (status = 'publicado' AND seguranca = 'liberado' AND deleted_at IS NULL);

-- 4) Formulário na lixeira não está "aberto" (não recebe resposta)
CREATE OR REPLACE FUNCTION public.cs_form_aberto(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = _form_id
       AND f.deleted_at IS NULL
       AND f.status = 'publicado'
       AND (f.inicia_em  IS NULL OR now() >= f.inicia_em)
       AND (f.encerra_em IS NULL OR now() <= f.encerra_em)
       AND (f.max_respostas IS NULL OR
            (SELECT count(*) FROM public."CS_FORM_RESPOSTAS" r WHERE r.formulario_id = f.id) < f.max_respostas));
$$;

-- 5) Porta pública: formulário apagado responde "não existe"
CREATE OR REPLACE FUNCTION public.cs_form_porta(_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'existe', true,
              'seguranca', f.seguranca,
              'exige_senha', f.exige_senha,
              'publicado', f.status = 'publicado')
       FROM public."CS_FORMULARIOS" f WHERE f.slug = _slug AND f.deleted_at IS NULL),
    jsonb_build_object('existe', false));
$$;

-- 6) Purga: apaga de vez o que passou de 30 dias (checa ver_lixeira direto na
--    tabela, sem depender de cs_form_cap).
CREATE OR REPLACE FUNCTION public.cs_form_purgar_lixeira()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS"
                  WHERE papel = 'ver_lixeira' AND user_id = auth.uid()) THEN
    RETURN 0;
  END IF;
  DELETE FROM public."CS_FORM_RESPOSTAS" r
   USING public."CS_FORMULARIOS" f
   WHERE r.formulario_id = f.id
     AND f.deleted_at IS NOT NULL
     AND f.deleted_at < now() - interval '30 days';
  WITH del AS (
    DELETE FROM public."CS_FORMULARIOS"
     WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.cs_form_purgar_lixeira() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_purgar_lixeira() TO authenticated;

-- 7) Quantas respostas já usam uma pergunta (aviso ao excluir pergunta).
CREATE OR REPLACE FUNCTION public.cs_form_pergunta_respostas(_form_id uuid, _perg text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer
    FROM public."CS_FORM_RESPOSTAS" r
   WHERE r.formulario_id = _form_id
     AND r.itens ? _perg
     AND COALESCE(btrim(r.itens ->> _perg), '') <> '';
$$;
REVOKE ALL ON FUNCTION public.cs_form_pergunta_respostas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_pergunta_respostas(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ==================== migration 20260721000001 ====================
-- =========================================================================
-- RH / Colaboradores — dashboard e lista calculados NO BANCO
--
-- A tela baixava as ~12.5 mil linhas da EMPREGADOS a cada abertura e fazia
-- KPIs, gráficos e paginação no navegador. Aqui o banco devolve os agregados
-- prontos (um JSON de poucos KB) e a lista já paginada — a tela passa a
-- trafegar ~50 linhas em vez de 12.556.
--
-- As regras são as MESMAS da tela (foram portadas do TSX, não reinventadas):
--   • empresa: código 1/2/3/5 → HAGG/SN/CANAÃ/NH, com fallback pelo nome;
--   • contrato: CONTRATOS ativo casado pela Filial, senão a coluna Contrato;
--   • cargo: "Título do Cargo", caindo p/ "Nome do Cargo";
--   • quadro do mês: admitido até o fim do mês e, para quem REALMENTE saiu
--     (Demitido/Desligado/Rescisão/Aposentadoria), afastamento do início do
--     mês em diante — "Data Afastamento" sozinha não vale, a folha também a
--     preenche em férias/atestado. Saída sem data legível fica FORA (a pessoa
--     saiu; sem saber quando, não dá para afirmar que estava presente).
--
-- Funções: STABLE e SECURITY INVOKER (a RLS da EMPREGADOS continua mandando).
-- =========================================================================

-- 1) Auxiliares de parse ---------------------------------------------------
-- A EMPREGADOS veio da folha: data em "DD/MM/AAAA" e salário em texto pt-BR
-- ("2.002,6900"), mas algumas colunas podem já ser date/numeric. Recebem text
-- para funcionar nos dois casos (basta chamar com ::text) e NUNCA levantam
-- erro de cast — valor estranho vira NULL/0 em vez de derrubar a consulta.

-- Expressão ÚNICA de propósito: função SQL com WITH o planejador não inlineia,
-- vira uma chamada por linha (12 mil linhas × 3 colunas) e a consulta estoura
-- o statement_timeout.
CREATE OR REPLACE FUNCTION public.rh_num(_v text)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN _v IS NULL OR btrim(_v) = ''  THEN 0::numeric
    WHEN _v ~ '^\s*-?[\d.]*\d,\d+\s*$' THEN replace(replace(btrim(_v), '.', ''), ',', '.')::numeric  -- 2.002,69
    WHEN _v ~ '^\s*-?\d+(\.\d+)?\s*$'  THEN btrim(_v)::numeric                                       -- 3600.21
    ELSE 0::numeric
  END;
$$;

-- Aceita "DD/MM/AAAA" e ISO, com ou sem zero à esquerda ("1/4/2019"), e trata
-- ano anterior a 1900 como SEM DATA: 30/12/1899 é o "vazio" do sistema legado
-- (serial 0 do Excel), não uma data real.
-- O ano 19xx/20xx dentro do próprio regex já descarta o 30/12/1899, e o
-- \d{1,2} aceita data sem zero à esquerda. Sem CTE, pelo mesmo motivo da rh_num.
CREATE OR REPLACE FUNCTION public.rh_data(_v text)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN _v ~ '^(0?[1-9]|[12]\d|3[01])/(0?[1-9]|1[0-2])/(19|20)\d{2}'
      THEN to_date(regexp_replace(_v, '^(\d{1,2})/(\d{1,2})/(\d{4}).*$', '\3-\2-\1'), 'YYYY-MM-DD')
    WHEN _v ~ '^(19|20)\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])'
      THEN to_date(regexp_replace(_v, '^(\d{4})-(\d{1,2})-(\d{1,2}).*$', '\1-\2-\3'), 'YYYY-MM-DD')
    ELSE NULL
  END;
$$;

-- Mesma regra do EMPRESA_MAP da tela.
CREATE OR REPLACE FUNCTION public.rh_empresa(_cod text, _nome text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE btrim(coalesce(_cod, ''))
    WHEN '1' THEN 'HAGG'
    WHEN '2' THEN 'SN'
    WHEN '3' THEN 'CANAÃ'
    WHEN '5' THEN 'NH'
    ELSE CASE
      WHEN upper(coalesce(_nome, '')) LIKE '%HAGG%' THEN 'HAGG'
      WHEN upper(coalesce(_nome, '')) LIKE '%CANA%' THEN 'CANAÃ'
      WHEN upper(coalesce(_nome, '')) ~ '\mNH\M'    THEN 'NH'
      WHEN upper(coalesce(_nome, '')) ~ '\mSN\M'    THEN 'SN'
      ELSE nullif(btrim(coalesce(_nome, '')), '')
    END
  END;
$$;

-- 2) Recorte comum ---------------------------------------------------------
-- View com as colunas já normalizadas: as duas RPCs partem daqui, então
-- dashboard e lista nunca divergem de critério.
CREATE OR REPLACE VIEW public.v_rh_colaboradores AS
WITH ct AS (
  SELECT DISTINCT ON (btrim(c."Filial"::text))
         btrim(c."Filial"::text) AS filial,
         btrim(coalesce(c."NOME CONTRATO", '')) AS nome
    FROM public."CONTRATOS" c
   WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
)
SELECT
  e."ID"                                                            AS id,
  coalesce(e."Nome", '')                                            AS nome,
  coalesce(e."CPF", '')                                             AS cpf,
  coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
           nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), '—') AS cargo,
  coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa,
  -- A EMPREGADOS não tem coluna "Contrato": o vínculo é só pela Filial. (O
  -- código da tela tinha um fallback para e["Contrato"] que nunca valia nada.)
  coalesce(nullif(ct.nome, ''), '—')                                AS contrato,
  coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
           nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
  btrim(coalesce(e."Situação", ''))                                 AS situacao,
  btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
  public.rh_data(e."Admissão"::text)                                AS admissao,
  public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
  public.rh_num(e."Valor Salário"::text)                            AS salario,
  (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
  (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
   coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
   coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
FROM public."EMPREGADOS" e
LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text);

-- A view herda a RLS da EMPREGADOS (security_invoker), não a contorna.
ALTER VIEW public.v_rh_colaboradores SET (security_invoker = true);
REVOKE ALL ON public.v_rh_colaboradores FROM PUBLIC, anon;
GRANT SELECT ON public.v_rh_colaboradores TO authenticated;

-- 3) Dashboard -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(
  _ano int, _mes int,
  _empresa text DEFAULT '', _contrato text DEFAULT '', _situacao text DEFAULT '', _busca text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  -- coalesce nos filtros: um NULL vindo do cliente faria `NULL = ''` virar
  -- NULL e o WHERE descartaria tudo silenciosamente.
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_ano int  := extract(year from current_date)::int;
  v_out jsonb;
BEGIN
  WITH flags AS (
    SELECT v.*,
      -- No quadro do mês: admitido até o fim do mês e, para quem tem situação
      -- de SAÍDA, com afastamento do início do mês em diante. Saída sem data
      -- legível fica de fora: a pessoa saiu, só não sabemos quando — contá-la
      -- como presente em TODO mês inflava o quadro com demitidos antigos.
      ((v.admissao IS NULL OR v.admissao <= v_fim)
        AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))) AS no_mes,
      (v_emp = '' OR v.empresa  = v_emp) AS f_emp,
      (v_ctr = '' OR v.contrato = v_ctr) AS f_ctr,
      (v_sit = '' OR v.situacao = v_sit) AS f_sit,
      (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%') AS f_bus
    FROM public.v_rh_colaboradores v
  ),
  fil    AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_sit AND f_bus),
  semsit AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_bus),
  tempo  AS (SELECT * FROM flags WHERE f_emp AND f_ctr)
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'ativos_mes', (SELECT count(*) FROM semsit),
      'no_recorte', (SELECT count(*) FROM fil),
      'total',      (SELECT count(*) FROM flags),
      'folha',      (SELECT coalesce(sum(salario), 0) FROM fil),
      'admitidos',  (SELECT count(*) FROM tempo WHERE admissao BETWEEN v_ini AND v_fim),
      'desligados', (SELECT count(*) FROM tempo WHERE eh_saida AND afastamento BETWEEN v_ini AND v_fim)
    ),
    'por_empresa',   (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, count(*) AS v FROM fil GROUP BY 1) t),
    'folha_empresa', (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, coalesce(sum(salario), 0) AS v FROM fil GROUP BY 1) t),
    'por_situacao',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT coalesce(nullif(situacao, ''), '—') AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_cargo',     (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT cargo AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_contrato',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT contrato AS k, count(*) AS v FROM fil GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
    'por_faixa',     (SELECT jsonb_agg(jsonb_build_object('label', f.label, 'n',
                              (SELECT count(*) FROM fil x
                                WHERE x.admissao IS NOT NULL
                                  AND ((current_date - x.admissao) / 365.25) >= f.mn
                                  AND ((current_date - x.admissao) / 365.25) <  f.mx)) ORDER BY f.ord)
                        FROM (VALUES (1, '< 1 ano', 0::numeric, 1::numeric), (2, '1–3 anos', 1, 3),
                                     (3, '3–5 anos', 3, 5), (4, '5–10 anos', 5, 10),
                                     (5, '10+ anos', 10, 9999)) AS f(ord, label, mn, mx)),
    'timeline',      (SELECT coalesce(jsonb_agg(jsonb_build_object('ano', ano, 'adm', adm, 'desl', desl) ORDER BY ano), '[]'::jsonb)
                        FROM (SELECT a.ano,
                                     count(*) FILTER (WHERE a.tipo = 'adm')  AS adm,
                                     count(*) FILTER (WHERE a.tipo = 'desl') AS desl
                                FROM (SELECT extract(year from admissao)::int AS ano, 'adm' AS tipo
                                        FROM tempo WHERE admissao IS NOT NULL
                                       UNION ALL
                                      SELECT extract(year from afastamento)::int, 'desl'
                                        FROM tempo WHERE eh_saida AND afastamento IS NOT NULL) a
                               WHERE a.ano BETWEEN v_ano - 6 AND v_ano
                               GROUP BY a.ano) z),
    'opcoes', jsonb_build_object(
      'empresas',  (SELECT coalesce(jsonb_agg(DISTINCT empresa  ORDER BY empresa),  '[]'::jsonb) FROM flags WHERE empresa  <> '—'),
      'contratos', (SELECT coalesce(jsonb_agg(DISTINCT contrato ORDER BY contrato), '[]'::jsonb) FROM flags WHERE contrato <> '—'),
      'situacoes', (SELECT coalesce(jsonb_agg(DISTINCT situacao ORDER BY situacao), '[]'::jsonb) FROM flags WHERE situacao <> ''),
      'setores',   (SELECT coalesce(jsonb_agg(DISTINCT setor    ORDER BY setor),    '[]'::jsonb) FROM flags WHERE setor    <> '')
    )
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.rh_colaboradores_dashboard(int, int, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_dashboard(int, int, text, text, text, text) TO authenticated;

-- 4) Lista paginada --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rh_colaboradores_lista(
  _ano int, _mes int,
  _empresa text DEFAULT '', _contrato text DEFAULT '', _situacao text DEFAULT '', _busca text DEFAULT '',
  _offset int DEFAULT 0, _limite int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_out jsonb;
BEGIN
  WITH fil AS (
    SELECT v.* FROM public.v_rh_colaboradores v
     WHERE (v.admissao IS NULL OR v.admissao <= v_fim)
       AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))
       AND (v_emp = '' OR v.empresa  = v_emp)
       AND (v_ctr = '' OR v.contrato = v_ctr)
       AND (v_sit = '' OR v.situacao = v_sit)
       AND (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM fil),
    'linhas', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'busca_txt' - 'eh_saida'), '[]'::jsonb)
                 FROM (SELECT * FROM fil ORDER BY nome, id OFFSET greatest(_offset, 0) LIMIT least(greatest(_limite, 1), 500)) p)
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.rh_colaboradores_lista(int, int, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_lista(int, int, text, text, text, text, int, int) TO authenticated;

-- 5) Índices que sustentam os filtros --------------------------------------
CREATE INDEX IF NOT EXISTS empregados_nome_idx     ON public."EMPREGADOS" ("Nome");
CREATE INDEX IF NOT EXISTS empregados_situacao_idx ON public."EMPREGADOS" ("Situação");
CREATE INDEX IF NOT EXISTS empregados_filial_idx   ON public."EMPREGADOS" ("Filial");

NOTIFY pgrst, 'reload schema';


-- ==================== migration 20260721000002 ====================
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — Planos de ação definidos nos feedbacks
--
-- O plano de ação JÁ EXISTE dentro do formulário: são as perguntas
-- "Ação definida (treinamento ou acompanhamento)" e "Prazo para Ação".
-- Cada resposta preenchida nessas duas perguntas É um plano de ação —
-- hoje já são ~80 deles. Nada disso precisa ser redigitado.
--
-- O que a resposta NÃO tem é o acompanhamento: ninguém volta no formulário
-- para dizer "concluí", "cancelei", "isto é prioridade alta". É só isso que
-- esta tabela guarda — uma CAMADA sobre a resposta, ligada por resposta_id.
--
-- Decisões:
--   • `resposta_id` é UNIQUE: uma resposta tem no máximo um acompanhamento.
--   • `acao` e `prazo` são NULL no caso normal — a fonte é a resposta. Só se
--     preenchem quando alguém corrige o texto/prazo pela tela (override) ou
--     quando o plano é avulso, sem resposta de origem.
--   • Um registro precisa OU apontar para uma resposta OU se bastar sozinho
--     (ação + prazo próprios) — é o que o CHECK abaixo garante.
--   • A SITUAÇÃO (no prazo / atrasado / vencido) NÃO é coluna: é derivada de
--     status + prazo + concluido_em. Gravar situação daria dado velho no dia
--     seguinte — um plano "em andamento" vira "vencido" sozinho quando o
--     prazo passa, sem ninguém tocar no registro.
--
-- Permissões: mesma capacidade que já governa as respostas (cs_form_cap).
-- Quem enxerga as respostas enxerga os planos; quem só vê as próprias, idem.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_FORM_PLANOS_ACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id  uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  resposta_id    uuid UNIQUE REFERENCES public."CS_FORM_RESPOSTAS"(id) ON DELETE CASCADE,

  -- Normalmente NULL: a ação e o prazo vêm das perguntas 14 e 15 da resposta.
  -- Preenchidos só em override manual ou plano avulso.
  acao           text,
  prazo          date,
  detalhe        text,                       -- observações do acompanhamento

  -- Idem: colaborador/setor/liderança vêm da resposta; aqui só se sobrescreve.
  colaborador       text,
  colaborador_id    bigint,                  -- EMPREGADOS."ID" quando resolvido
  lideranca         text,
  setor             text,
  empresa           text,

  origem         text NOT NULL DEFAULT 'Outro',
  prioridade     text NOT NULL DEFAULT 'Média',
  status         text NOT NULL DEFAULT 'Em andamento',
  concluido_em   date,                       -- preenchido ao concluir

  criado_por     uuid DEFAULT auth.uid(),
  criado_por_nome text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT cs_plano_origem_chk     CHECK (origem     IN ('Desenvolvimento', 'Liderança', 'Alinhamento e Entrega', 'Outro')),
  CONSTRAINT cs_plano_prioridade_chk CHECK (prioridade IN ('Alta', 'Média', 'Baixa')),
  CONSTRAINT cs_plano_status_chk     CHECK (status     IN ('Em andamento', 'Concluído', 'Cancelado')),
  -- Concluído sem data de conclusão deixaria "no prazo × com atraso" indecidível.
  CONSTRAINT cs_plano_concluido_chk  CHECK (status <> 'Concluído' OR concluido_em IS NOT NULL),
  -- Ou é acompanhamento de uma resposta, ou é um plano que se basta sozinho.
  CONSTRAINT cs_plano_fonte_chk      CHECK (resposta_id IS NOT NULL OR (acao IS NOT NULL AND prazo IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS cs_planos_form_idx     ON public."CS_FORM_PLANOS_ACAO"(formulario_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cs_planos_status_idx   ON public."CS_FORM_PLANOS_ACAO"(status) WHERE deleted_at IS NULL;

-- updated_at sempre que a linha muda
CREATE OR REPLACE FUNCTION public.cs_planos_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cs_planos_touch_trg ON public."CS_FORM_PLANOS_ACAO";
CREATE TRIGGER cs_planos_touch_trg BEFORE UPDATE ON public."CS_FORM_PLANOS_ACAO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_planos_touch();

-- ── Permissões ───────────────────────────────────────────────────────────
ALTER TABLE public."CS_FORM_PLANOS_ACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_PLANOS_ACAO" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_FORM_PLANOS_ACAO" TO authenticated;

DROP POLICY IF EXISTS cs_planos_select ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_select ON public."CS_FORM_PLANOS_ACAO"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid()));

DROP POLICY IF EXISTS cs_planos_insert ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_insert ON public."CS_FORM_PLANOS_ACAO"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias'));

DROP POLICY IF EXISTS cs_planos_update ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_update ON public."CS_FORM_PLANOS_ACAO"
  FOR UPDATE TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid()));

-- Exclusão é soft (UPDATE deleted_at); DELETE fica só para quem vê tudo.
DROP POLICY IF EXISTS cs_planos_delete ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_delete ON public."CS_FORM_PLANOS_ACAO"
  FOR DELETE TO authenticated USING (public.cs_form_cap('ver_tudo'));

NOTIFY pgrst, 'reload schema';


-- ==================== migration 20260721000003 ====================
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — Líderes por setor
--
-- Quem lidera cada setor NÃO é digitado: sai do cadastro. Em EMPREGADOS a
-- coluna LIDER guarda o NÍVEL HIERÁRQUICO da pessoa (CEO, DIREÇÃO, GERENTE,
-- SUPERVISOR…), não o nome do líder dela. Então:
--
--     Setor_ERP = 'COMPRAS' + LIDER = 'GERENTE'  →  gerente do Compras
--
-- O líder de um setor é a pessoa de MAIOR nível dentro dele. CEO está acima
-- de DIREÇÃO, que está acima de GERENTE, e assim por diante.
--
-- Esta tabela guarda só a EXCEÇÃO: quando a regra não resolve (dois gerentes
-- no mesmo setor, setor sem ninguém com nível, ou o cadastro está errado e
-- não dá para corrigir agora), fixa-se o líder à mão. Setor sem linha aqui =
-- resolvido automaticamente pelo cadastro, e continua acompanhando mudanças
-- de EMPREGADOS sozinho.
--
-- Por isso a chave é o setor: é uma exceção POR SETOR, não por formulário —
-- a estrutura da empresa é a mesma em todos eles.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."CS_LIDERES_SETOR" (
  setor              text PRIMARY KEY,
  empregado_id       bigint NOT NULL,          -- EMPREGADOS."ID" escolhido à mão
  empregado_nome     text,                     -- cópia p/ exibir sem novo join
  observacao         text,                     -- por que foi fixado à mão
  definido_por       uuid DEFAULT auth.uid(),
  definido_por_nome  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cs_lideres_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cs_lideres_touch_trg ON public."CS_LIDERES_SETOR";
CREATE TRIGGER cs_lideres_touch_trg BEFORE UPDATE ON public."CS_LIDERES_SETOR"
  FOR EACH ROW EXECUTE FUNCTION public.cs_lideres_touch();

-- ── Permissões ───────────────────────────────────────────────────────────
-- Ler: qualquer um que enxergue o módulo (a tela de feedback precisa resolver
-- o líder). Escrever: só quem vê tudo — é estrutura da empresa, não dado solto.
ALTER TABLE public."CS_LIDERES_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_LIDERES_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_LIDERES_SETOR" TO authenticated;

DROP POLICY IF EXISTS cs_lideres_select ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_select ON public."CS_LIDERES_SETOR"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias'));

DROP POLICY IF EXISTS cs_lideres_ins ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_ins ON public."CS_LIDERES_SETOR"
  FOR INSERT TO authenticated WITH CHECK (public.cs_form_cap('ver_tudo'));

DROP POLICY IF EXISTS cs_lideres_upd ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_upd ON public."CS_LIDERES_SETOR"
  FOR UPDATE TO authenticated USING (public.cs_form_cap('ver_tudo'));

DROP POLICY IF EXISTS cs_lideres_del ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_del ON public."CS_LIDERES_SETOR"
  FOR DELETE TO authenticated USING (public.cs_form_cap('ver_tudo'));

NOTIFY pgrst, 'reload schema';


-- ==================== migration 20260722000001 ====================
-- =========================================================================
-- RH — HIERARQUIA
--
-- A hierarquia da empresa tem DOIS eixos e nenhum deles é digitado à mão:
--
--   1. Administrativo (por setor): dentro de cada Setor_ERP, a ordem sai do
--      nível em EMPREGADOS.LIDER (GERENTE › COORDENADOR › SUPERVISOR …), e o
--      staff sem nível entra por cargo. Isso é 100% derivado do cadastro.
--
--   2. Operacional (por contrato): a coluna EMPREGADOS."Descrição do Local" é
--      o NOME DO CONTRATO a que o colaborador pertence. Cada contrato tem um
--      ENCARREGADO, e todo mundo daquele contrato fica sob ele. Só que "qual
--      encarregado responde por qual contrato" nem sempre está no cadastro de
--      forma confiável — é o que ESTA tabela guarda: a designação, por contrato.
--
-- Ou seja: a árvore é calculada ao vivo do cadastro; esta tabela guarda apenas
-- a CONFIGURAÇÃO que o cadastro não resolve sozinho — o encarregado de cada
-- contrato. Contrato sem linha aqui cai na sugestão automática (o membro com
-- nível ENCARREGADO), e fica sinalizado como "a definir".
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."RH_CONTRATO_ENCARREGADO" (
  contrato          text PRIMARY KEY,        -- = EMPREGADOS."Descrição do Local"
  encarregado_id    bigint NOT NULL,         -- EMPREGADOS."ID" escolhido
  encarregado_nome  text,                    -- cópia p/ exibir sem novo join
  setor             text,                    -- setor predominante do contrato (referência)
  observacao        text,
  definido_por      uuid DEFAULT auth.uid(),
  definido_por_nome text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.rh_contrato_enc_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS rh_contrato_enc_touch_trg ON public."RH_CONTRATO_ENCARREGADO";
CREATE TRIGGER rh_contrato_enc_touch_trg BEFORE UPDATE ON public."RH_CONTRATO_ENCARREGADO"
  FOR EACH ROW EXECUTE FUNCTION public.rh_contrato_enc_touch();

-- ── Permissões ───────────────────────────────────────────────────────────
-- Acesso ao módulo RH é controlado pelo menu (app_menu/profiles); aqui basta
-- exigir usuário autenticado. anon nunca toca.
ALTER TABLE public."RH_CONTRATO_ENCARREGADO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_CONTRATO_ENCARREGADO" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RH_CONTRATO_ENCARREGADO" TO authenticated;

DROP POLICY IF EXISTS rh_contrato_enc_all ON public."RH_CONTRATO_ENCARREGADO";
CREATE POLICY rh_contrato_enc_all ON public."RH_CONTRATO_ENCARREGADO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Leitura da hierarquia (RPC) ────────────────────────────────────────────
-- Ler EMPREGADOS direto do cliente (PostgREST) estoura o statement_timeout num
-- cadastro grande — o mesmo motivo que fez a tela de Colaboradores ler por RPC.
-- Aqui devolvemos só os campos da hierarquia, numa chamada, server-side.
-- SECURITY DEFINER: não paga o custo por-linha da RLS da EMPREGADOS. Expõe a
-- estrutura (nome/setor/nível/cargo/contrato) org-wide, que é a natureza da
-- tela; troque para SECURITY INVOKER se precisar restringir por empresa.
-- plpgsql (não `sql`) de propósito: função SQL valida o corpo na criação e
-- pega lock em EMPREGADOS; plpgsql resolve a tabela só na 1ª execução, então
-- criar a função não disputa lock com o app (evita deadlock com a leitura viva).
CREATE OR REPLACE FUNCTION public.rh_hierarquia_dados()
RETURNS TABLE (id bigint, nome text, setor text, nivel text, cargo text, local_desc text, situacao text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    e."ID"::bigint,
    btrim(coalesce(e."Nome", '')),
    btrim(coalesce(e."Setor_ERP", '')),
    btrim(coalesce(e."LIDER", '')),
    coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
             nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), ''),
    btrim(coalesce(e."Descrição do Local", '')),
    btrim(coalesce(e."Situação", ''))
  FROM public."EMPREGADOS" e;
END $$;
REVOKE ALL ON FUNCTION public.rh_hierarquia_dados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hierarquia_dados() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ==================== migration 20260723000001 ====================
-- =========================================================================
-- RH — DIRETOR RESPONSÁVEL POR SETOR
--
-- Diretores (nível DIREÇÃO/DIRETOR) ficam ACIMA dos setores, e cada um cuida
-- de um conjunto de setores — mas QUAIS setores não está no cadastro; é uma
-- decisão de gestão. Esta tabela guarda isso: para cada setor, qual diretor
-- responde por ele.
--
-- Vira a base da visibilidade:
--   • Diretor vê os setores onde ele é o diretor_id aqui.
--   • Líder vê o próprio Setor_ERP (já resolvido em CS_LIDERES_SETOR / cadastro).
--   • CEO vê tudo.
--
-- Chave = setor (um diretor por setor). Atribuir um setor a outro diretor
-- simplesmente troca a linha.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."RH_SETOR_DIRETOR" (
  setor          text PRIMARY KEY,
  diretor_id     bigint NOT NULL,           -- EMPREGADOS."ID" do diretor
  diretor_nome   text,
  definido_por   uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.rh_setor_diretor_touch() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS rh_setor_diretor_touch_trg ON public."RH_SETOR_DIRETOR";
CREATE TRIGGER rh_setor_diretor_touch_trg BEFORE UPDATE ON public."RH_SETOR_DIRETOR"
  FOR EACH ROW EXECUTE FUNCTION public.rh_setor_diretor_touch();

-- Acesso ao RH é gated pelo menu; aqui basta autenticado. anon nunca toca.
ALTER TABLE public."RH_SETOR_DIRETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_SETOR_DIRETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RH_SETOR_DIRETOR" TO authenticated;

DROP POLICY IF EXISTS rh_setor_diretor_all ON public."RH_SETOR_DIRETOR";
CREATE POLICY rh_setor_diretor_all ON public."RH_SETOR_DIRETOR"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
-- =========================================================================
-- RH — Perfil_ERP na leitura da hierarquia
--
-- A Visão Executiva precisa saber QUEM É ESPERADO responder ao feedback, e a
-- régua é o cadastro: Perfil_ERP = 'ADMINISTRATIVO' e Situação = 'Trabalhando'.
-- A RPC rh_hierarquia_dados devolvia tudo menos o perfil, então a tela não
-- tinha como separar quem entra do quadro esperado de quem não entra.
--
-- DROP + CREATE (e não CREATE OR REPLACE): o Postgres não deixa trocar o
-- RETURNS TABLE de uma função existente. Enquanto a migration roda, as telas
-- que leem a hierarquia falham por alguns milissegundos — recarregar resolve.
-- =========================================================================

DROP FUNCTION IF EXISTS public.rh_hierarquia_dados();

CREATE FUNCTION public.rh_hierarquia_dados()
RETURNS TABLE (id bigint, nome text, setor text, nivel text, cargo text, local_desc text, situacao text, perfil text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    e."ID"::bigint,
    btrim(coalesce(e."Nome", '')),
    btrim(coalesce(e."Setor_ERP", '')),
    btrim(coalesce(e."LIDER", '')),
    coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
             nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), ''),
    btrim(coalesce(e."Descrição do Local", '')),
    btrim(coalesce(e."Situação", '')),
    btrim(coalesce(e."Perfil_ERP", ''))
  FROM public."EMPREGADOS" e;
END $$;

REVOKE ALL ON FUNCTION public.rh_hierarquia_dados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_hierarquia_dados() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260724000002_vw_empregados_basico =====
-- View pública (5 colunas não sensíveis) p/ o formulário público buscar
-- colaboradores sem login. Liberada p/ anon + authenticated. Idempotente.
CREATE OR REPLACE VIEW public."VW_EMPREGADOS_BASICO" AS
SELECT "ID", "Nome", "Setor_ERP", "Título do Cargo", "Situação"
FROM public."EMPREGADOS";

GRANT SELECT ON public."VW_EMPREGADOS_BASICO" TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260731000001_formularios_ver_proprias_por_identidade =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — "só as próprias respostas" casa pela IDENTIDADE
--
-- Bug: com o papel 'ver_proprias' o usuário via ZERO respostas. A régua era só
-- `criado_por = auth.uid()`; só que as respostas chegam pelo LINK PÚBLICO, onde
-- quem responde não está logado — auth.uid() é nulo e criado_por fica nulo. Ou
-- seja, a condição nunca batia e a leitura devolvia vazio.
--
-- Correção: "minha resposta" passa a valer quando EU sou o dono da linha
-- (criado_por, para quem enviou logado) OU quando EU sou o respondente
-- identificado, casando o nome gravado na resposta com o Nome do meu cadastro
-- (EMPREGADOS.auth_user_id = auth.uid()).
--
-- Idempotente. Aplicar no banco do app (traz o NOTIFY do PostgREST no fim).
-- =========================================================================

-- Helper: a resposta (criado_por, respondente_nome) é do usuário logado?
-- SECURITY DEFINER: precisa ler EMPREGADOS por baixo da RLS (a política de
-- respostas roda no contexto de quem está lendo). Não expõe nada — devolve só
-- true/false para a linha que a própria RLS já está avaliando.
--
-- criado_por é UUID (CS_FORM_RESPOSTAS.criado_por uuid DEFAULT auth.uid()), então
-- o 1º parâmetro é uuid: a policy passa a coluna direto e o Postgres precisa
-- casar a assinatura exata (uuid, text). Remove a versão (text, text) que uma
-- tentativa anterior pode ter deixado no banco.
DROP FUNCTION IF EXISTS public.cs_form_minha_resposta(text, text);
CREATE OR REPLACE FUNCTION public.cs_form_minha_resposta(_criado_por uuid, _respondente_nome text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (_criado_por IS NOT NULL AND _criado_por = auth.uid())
      OR (btrim(coalesce(_respondente_nome, '')) <> '' AND EXISTS (
            SELECT 1 FROM public."EMPREGADOS" e
             WHERE e.auth_user_id = auth.uid()
               AND upper(btrim(e."Nome")) = upper(btrim(_respondente_nome))));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_minha_resposta(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_minha_resposta(uuid, text) TO authenticated;

-- Releitura de respostas: mesma UNIÃO de antes, só o ramo ver_proprias muda.
-- ver_setor continua recortando pelo Setor_ERP carimbado na resposta
-- (cs_form_cap_setor) — é ele que faz "ver por setor = RH" mostrar só o RH.
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND public.cs_form_minha_resposta(criado_por, respondente_nome))
    OR public.cs_form_cap_setor(setor)                 -- setor de quem respondeu
    OR public.cs_form_cap_form_setor(formulario_id));  -- setor-dono do formulário

NOTIFY pgrst, 'reload schema';

-- ===== 20260801000001_formularios_ver_por_lideranca_setor =====
-- Recorte por LIDERANÇA de setor: "Gerente de <setor>" (CS_LIDERES_SETOR) e
-- "Diretor de <setor>" (RH_SETOR_DIRETOR) passam a ver, no Painel Gerencial,
-- só as respostas do(s) setor(es) que lidera/dirige. Enforcement no RLS.
-- ADITIVO: quem tem 'ver_tudo' segue vendo tudo — para recortar, remova
-- 'ver_tudo' da conta. Vínculo: EMPREGADOS.auth_user_id = auth.uid();
-- empregado_id/diretor_id = EMPREGADOS."ID". Idempotente.
CREATE OR REPLACE FUNCTION public.cs_form_lidera_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid()
       AND (
         EXISTS (SELECT 1 FROM public."CS_LIDERES_SETOR" l
                  WHERE l.empregado_id = e."ID"
                    AND upper(btrim(l.setor)) = upper(btrim(_setor)))
      OR EXISTS (SELECT 1 FROM public."RH_SETOR_DIRETOR" d
                  WHERE d.diretor_id = e."ID"
                    AND upper(btrim(d.setor)) = upper(btrim(_setor)))
       ));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) TO authenticated;

DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND public.cs_form_minha_resposta(criado_por, respondente_nome))
    OR public.cs_form_cap_setor(setor)                 -- ver_setor (CS_FORM_ACESSOS)
    OR public.cs_form_cap_form_setor(formulario_id)    -- setor-dono do formulário
    OR public.cs_form_lidera_setor(setor));            -- gerente/diretor do setor

NOTIFY pgrst, 'reload schema';

-- ===== 20260801000003_rh_colaboradores_sem_view =====
-- RPCs de RH Colaboradores passam a ler EMPREGADOS direto (CTE inline); a view
-- v_rh_colaboradores e removida. Fonte unica: EMPREGADOS (+ CONTRATOS so p/ nome).
-- 1) Dashboard (mesma logica; so troca "FROM v_rh_colaboradores" por CTE `v`)
CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(
  _ano int, _mes int,
  _empresa text DEFAULT '', _contrato text DEFAULT '', _situacao text DEFAULT '', _busca text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_ano int  := extract(year from current_date)::int;
  v_out jsonb;
BEGIN
  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Filial"::text))
           btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  v AS (
    SELECT
      e."ID"                                                            AS id,
      coalesce(e."Nome", '')                                            AS nome,
      coalesce(e."CPF", '')                                             AS cpf,
      coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
               nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), '—') AS cargo,
      coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa,
      coalesce(nullif(ct.nome, ''), '—')                                AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      public.rh_num(e."Valor Salário"::text)                            AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text)
  ),
  flags AS (
    SELECT v.*,
      ((v.admissao IS NULL OR v.admissao <= v_fim)
        AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))) AS no_mes,
      (v_emp = '' OR v.empresa  = v_emp) AS f_emp,
      (v_ctr = '' OR v.contrato = v_ctr) AS f_ctr,
      (v_sit = '' OR v.situacao = v_sit) AS f_sit,
      (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%') AS f_bus
    FROM v
  ),
  fil    AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_sit AND f_bus),
  semsit AS (SELECT * FROM flags WHERE no_mes AND f_emp AND f_ctr AND f_bus),
  tempo  AS (SELECT * FROM flags WHERE f_emp AND f_ctr)
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'ativos_mes', (SELECT count(*) FROM semsit),
      'no_recorte', (SELECT count(*) FROM fil),
      'total',      (SELECT count(*) FROM flags),
      'folha',      (SELECT coalesce(sum(salario), 0) FROM fil),
      'admitidos',  (SELECT count(*) FROM tempo WHERE admissao BETWEEN v_ini AND v_fim),
      'desligados', (SELECT count(*) FROM tempo WHERE eh_saida AND afastamento BETWEEN v_ini AND v_fim)
    ),
    'por_empresa',   (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, count(*) AS v FROM fil GROUP BY 1) t),
    'folha_empresa', (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT empresa AS k, coalesce(sum(salario), 0) AS v FROM fil GROUP BY 1) t),
    'por_situacao',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT coalesce(nullif(situacao, ''), '—') AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_cargo',     (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT cargo AS k, count(*) AS v FROM semsit GROUP BY 1) t),
    'por_contrato',  (SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', v) ORDER BY v DESC), '[]'::jsonb)
                        FROM (SELECT contrato AS k, count(*) AS v FROM fil GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t),
    'por_faixa',     (SELECT jsonb_agg(jsonb_build_object('label', f.label, 'n',
                              (SELECT count(*) FROM fil x
                                WHERE x.admissao IS NOT NULL
                                  AND ((current_date - x.admissao) / 365.25) >= f.mn
                                  AND ((current_date - x.admissao) / 365.25) <  f.mx)) ORDER BY f.ord)
                        FROM (VALUES (1, '< 1 ano', 0::numeric, 1::numeric), (2, '1–3 anos', 1, 3),
                                     (3, '3–5 anos', 3, 5), (4, '5–10 anos', 5, 10),
                                     (5, '10+ anos', 10, 9999)) AS f(ord, label, mn, mx)),
    'timeline',      (SELECT coalesce(jsonb_agg(jsonb_build_object('ano', ano, 'adm', adm, 'desl', desl) ORDER BY ano), '[]'::jsonb)
                        FROM (SELECT a.ano,
                                     count(*) FILTER (WHERE a.tipo = 'adm')  AS adm,
                                     count(*) FILTER (WHERE a.tipo = 'desl') AS desl
                                FROM (SELECT extract(year from admissao)::int AS ano, 'adm' AS tipo
                                        FROM tempo WHERE admissao IS NOT NULL
                                       UNION ALL
                                      SELECT extract(year from afastamento)::int, 'desl'
                                        FROM tempo WHERE eh_saida AND afastamento IS NOT NULL) a
                               WHERE a.ano BETWEEN v_ano - 6 AND v_ano
                               GROUP BY a.ano) z),
    'opcoes', jsonb_build_object(
      'empresas',  (SELECT coalesce(jsonb_agg(DISTINCT empresa  ORDER BY empresa),  '[]'::jsonb) FROM flags WHERE empresa  <> '—'),
      'contratos', (SELECT coalesce(jsonb_agg(DISTINCT contrato ORDER BY contrato), '[]'::jsonb) FROM flags WHERE contrato <> '—'),
      'situacoes', (SELECT coalesce(jsonb_agg(DISTINCT situacao ORDER BY situacao), '[]'::jsonb) FROM flags WHERE situacao <> ''),
      'setores',   (SELECT coalesce(jsonb_agg(DISTINCT setor    ORDER BY setor),    '[]'::jsonb) FROM flags WHERE setor    <> '')
    )
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_colaboradores_dashboard(int, int, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_dashboard(int, int, text, text, text, text) TO authenticated;

-- 2) Lista paginada (inline + regra de saida completa da 20260801000002)
CREATE OR REPLACE FUNCTION public.rh_colaboradores_lista(
  _ano int, _mes int,
  _empresa text DEFAULT '', _contrato text DEFAULT '', _situacao text DEFAULT '', _busca text DEFAULT '',
  _offset int DEFAULT 0, _limite int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := make_date(_ano, _mes, 1);
  v_fim date := (make_date(_ano, _mes, 1) + interval '1 month' - interval '1 day')::date;
  v_q   text := nullif(btrim(coalesce(_busca, '')), '');
  v_emp text := coalesce(_empresa, '');
  v_ctr text := coalesce(_contrato, '');
  v_sit text := coalesce(_situacao, '');
  v_saida boolean := v_sit ~* '(DEMIT|DESLIG|RESCIS|APOSENT)';
  v_out jsonb;
BEGIN
  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Filial"::text))
           btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  v AS (
    SELECT
      e."ID"                                                            AS id,
      coalesce(e."Nome", '')                                            AS nome,
      coalesce(e."CPF", '')                                             AS cpf,
      coalesce(nullif(btrim(coalesce(e."Título do Cargo", '')), ''),
               nullif(btrim(coalesce(e."Nome do Cargo", '')), ''), '—') AS cargo,
      coalesce(public.rh_empresa(e."Empresa"::text, e."Nome da Empresa"), '—') AS empresa,
      coalesce(nullif(ct.nome, ''), '—')                                AS contrato,
      coalesce(nullif(btrim(coalesce(e."Nome Filial", '')), ''),
               nullif(btrim(coalesce(e."Filial"::text, '')), ''), '—')  AS filial,
      btrim(coalesce(e."Situação", ''))                                 AS situacao,
      btrim(coalesce(e."Setor_ERP", ''))                                AS setor,
      public.rh_data(e."Admissão"::text)                                AS admissao,
      public.rh_data(e."Data Afastamento"::text)                        AS afastamento,
      public.rh_num(e."Valor Salário"::text)                            AS salario,
      (btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,
      (coalesce(e."Nome", '') || ' ' || coalesce(e."CPF", '') || ' ' ||
       coalesce(e."Título do Cargo", '') || ' ' || coalesce(e."Nome do Cargo", '') || ' ' ||
       coalesce(e."Nome Filial", '') || ' ' || coalesce(e."Setor_ERP", ''))  AS busca_txt
    FROM public."EMPREGADOS" e
    LEFT JOIN ct ON ct.filial = btrim(e."Filial"::text)
  ),
  fil AS (
    SELECT v.* FROM v
     WHERE (v_saida
            OR ((v.admissao IS NULL OR v.admissao <= v_fim)
                AND (NOT v.eh_saida OR (v.afastamento IS NOT NULL AND v.afastamento >= v_ini))))
       AND (v_emp = '' OR v.empresa  = v_emp)
       AND (v_ctr = '' OR v.contrato = v_ctr)
       AND (v_sit = '' OR v.situacao = v_sit)
       AND (v_q IS NULL OR v.busca_txt ILIKE '%' || v_q || '%')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM fil),
    'linhas', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'busca_txt' - 'eh_saida'), '[]'::jsonb)
                 FROM (SELECT * FROM fil ORDER BY nome, id OFFSET greatest(_offset, 0) LIMIT least(greatest(_limite, 1), 500)) p)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_colaboradores_lista(int, int, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_lista(int, int, text, text, text, text, int, int) TO authenticated;

-- 3) Agora que ninguem mais referencia, remove a view.
DROP VIEW IF EXISTS public.v_rh_colaboradores;

NOTIFY pgrst, 'reload schema';

-- ===== 20260801000004_cs_form_cap_sem_bypass_admin =====
-- Crava cs_form_cap SEM bypass de admin: capacidades (CS_FORM_ACESSOS) governam
-- tudo, inclusive admin. Sem has_role. (ultima palavra sobre cs_form_cap)
CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _cap = 'responder'
      OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                  WHERE a.papel = _cap AND a.user_id = auth.uid());
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260801000005_cs_form_setores_catalogo =====
-- Catálogo de setores (nomes) p/ a tela de permissões, sem depender de ler
-- CS_FORM_RESPOSTAS via RLS. Devolve EMPREGADOS.Setor_ERP ∪ CS_FORM_RESPOSTAS.setor
-- (só rótulos). SECURITY DEFINER, restrita a admin. Dedup SEM acento/caixa
-- (JURIDICO == JURÍDICO), preferindo a grafia da RESPOSTA (é nela que ver_setor
-- casa); fora o placeholder PADRAO (= "sem setor", não é setor concedível).
CREATE OR REPLACE FUNCTION public.cs_form_setores_catalogo()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fonte AS (
    SELECT setor        AS s, 0 AS ordem FROM public."CS_FORM_RESPOSTAS"
    UNION ALL
    SELECT "Setor_ERP" AS s, 1 AS ordem FROM public."EMPREGADOS"
  ),
  norm AS (
    SELECT btrim(s) AS rotulo, ordem,
           upper(translate(btrim(s),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS chave
      FROM fonte
     WHERE btrim(coalesce(s, '')) <> ''
  )
  SELECT DISTINCT ON (chave) rotulo
    FROM norm
   WHERE chave <> 'PADRAO'
     AND public.has_role(auth.uid(), 'admin')
   ORDER BY chave, ordem, rotulo;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_setores_catalogo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores_catalogo() TO authenticated;

NOTIFY pgrst, 'reload schema';



-- =========================================================================
-- ===== 20260802000001_chamados_sistemas =====
-- =========================================================================
-- =====================================================================
-- CHAMADOS DE SISTEMAS — help desk leve do módulo Sistemas.
-- Qualquer usuário logado abre um chamado (setor/nome puxados de EMPREGADOS
-- via meu_empregado). O Gerente de Sistemas distribui para um Desenvolvedor
-- com fila de tarefas priorizadas; o dev executa e conclui. Histórico + push.
--
-- Tabelas em MAIÚSCULAS/citadas (padrão dos módulos: EMPREGADOS, CS_FORMULARIOS…):
--   "CHAMADO_SISTEMA", "CHAMADO_SISTEMA_TAREFA", "CHAMADO_SISTEMA_ANEXO",
--   "CHAMADO_SISTEMA_EVENTO". Funções/triggers/índices/policies seguem em
--   minúsculo (não são tabelas).
--
-- Permissão por usuário (mesma base de Solicitações ERP): app_menu +
-- screen_permission_user + tem_acesso_menu(). Abrir/ver os PRÓPRIOS chamados
-- é aberto a todos (menu com rota mas sem permissão configurada = visível);
-- a GESTÃO é restrita pelos códigos de rota, que também valem como capacidade:
--   chamados_sistemas_painel → Gerente de Sistemas (coordena/distribui/reprova)
--   chamados_sistemas_dev    → Desenvolvedor (executa tarefas)
-- Esses dois entram em MENUS_SEMPRE_RESTRITOS (front) p/ ficarem ocultos até
-- serem liberados em "Acesso por Usuário".
-- =====================================================================

-- 1) Menus / permissões -------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('chamados_sistemas',        'Chamados de Sistemas',                 '/app/sistemas/chamados',        15),
    ('chamados_sistemas_painel', 'Chamados — Painel de Distribuição',    '/app/sistemas/chamados/painel', 16),
    ('chamados_sistemas_dev',    'Chamados — Painel do Desenvolvedor',   '/app/sistemas/chamados/dev',    17)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Mirror do "abrir/meus chamados" no menu da Central de Serviços (mesma tela).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'central_servicos_chamados', 'Chamados de Sistemas', '/app/central-servicos/chamados', 60
  FROM public.app_modulo m WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Tabelas ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               text,
  assunto              text NOT NULL,
  categorias           text[] NOT NULL DEFAULT '{}',
  tipo_solicitacao     text,      -- ajuste | correcao | melhoria | duvida | outro
  prioridade           text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  descricao            text,
  impacto_trabalho     text,      -- impede | atraso_significativo | atraso_leve | nao_impacta
  urgencia             text,      -- ate_1h | ate_1d | ate_3d | ate_5d | mais_5d
  modulo_sistema       text,      -- código do módulo do ERP ou 'outro'
  modulo_sistema_outro text,
  ambiente             text NOT NULL DEFAULT 'producao',  -- producao | homologacao | teste
  afeta_usuarios       integer,
  solicitante_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  solicitante_nome     text,
  setor                text,
  status               text NOT NULL DEFAULT 'aberto'
                         CHECK (status IN ('aberto','em_andamento','aguardando_retorno','concluido','reprovado')),
  responsavel_id       uuid REFERENCES auth.users(id),
  prazo_previsto       date,
  observacao_gerente   text,
  comentario_gerente   text,
  motivo_reprovacao    text,
  concluido_em         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_solicitante ON public."CHAMADO_SISTEMA"(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_responsavel ON public."CHAMADO_SISTEMA"(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_status      ON public."CHAMADO_SISTEMA"(status);

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_TAREFA" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  ordem          integer NOT NULL DEFAULT 1,
  titulo         text NOT NULL,
  descricao      text,
  prioridade     text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','em_andamento','aguardando_informacoes','concluida')),
  responsavel_id uuid REFERENCES auth.users(id),
  prazo          date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_tarefa_chamado     ON public."CHAMADO_SISTEMA_TAREFA"(chamado_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_tarefa_responsavel ON public."CHAMADO_SISTEMA_TAREFA"(responsavel_id);

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_ANEXO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id    uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  nome_arquivo  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  campo         text NOT NULL DEFAULT 'abertura',  -- abertura | interno
  autor_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_anexo_chamado ON public."CHAMADO_SISTEMA_ANEXO"(chamado_id);

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id  uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  autor_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  tipo        text NOT NULL DEFAULT 'evento',  -- evento | comentario | observacao_interna | solicitar_info
  texto       text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_evento_chamado ON public."CHAMADO_SISTEMA_EVENTO"(chamado_id);

-- 3) Numeração automática (SIS-AAAA-0000) -------------------------------
CREATE SEQUENCE IF NOT EXISTS public.chamado_sistema_numero_seq;

CREATE OR REPLACE FUNCTION public.gerar_numero_chamado_sistema()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'SIS-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.chamado_sistema_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_numero ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_numero
  BEFORE INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.gerar_numero_chamado_sistema();

-- Evento de abertura gravado por trigger (SECURITY DEFINER): a RLS de
-- "CHAMADO_SISTEMA_EVENTO" não deixa o solicitante inserir tipo 'evento',
-- então o registro de "Chamado aberto" é criado aqui, no servidor.
CREATE OR REPLACE FUNCTION public.chamado_sistema_evento_abertura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (NEW.id, NEW.solicitante_id, 'evento', 'Chamado aberto');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_abertura ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_abertura
  AFTER INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_evento_abertura();

-- 4) Guard de UPDATE: quem NÃO é gerente (o dev responsável) só mexe em
--    status/prazo/motivo; nunca em campos de abertura ou de gestão. -------
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_gerente boolean := public.tem_acesso_menu('chamados_sistemas_painel');
BEGIN
  IF NOT v_gerente THEN
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
      RAISE EXCEPTION 'Sem permissão para alterar estes campos do chamado.';
    END IF;
  END IF;

  -- concluido_em coerente com o status.
  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_guard ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_guard
  BEFORE UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_guard();

DROP TRIGGER IF EXISTS trg_chamado_sistema_updated ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_updated
  BEFORE UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tarefa: dev só muda o status da própria; gerente muda tudo.
CREATE OR REPLACE FUNCTION public.chamado_sistema_tarefa_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_gerente boolean := public.tem_acesso_menu('chamados_sistemas_painel');
BEGIN
  IF NOT v_gerente THEN
    IF NEW.titulo      IS DISTINCT FROM OLD.titulo
    OR NEW.descricao   IS DISTINCT FROM OLD.descricao
    OR NEW.prioridade  IS DISTINCT FROM OLD.prioridade
    OR NEW.ordem       IS DISTINCT FROM OLD.ordem
    OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
    OR NEW.prazo       IS DISTINCT FROM OLD.prazo THEN
      RAISE EXCEPTION 'Sem permissão para alterar esta tarefa (apenas o status).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_tarefa_guard ON public."CHAMADO_SISTEMA_TAREFA";
CREATE TRIGGER trg_chamado_sistema_tarefa_guard
  BEFORE UPDATE ON public."CHAMADO_SISTEMA_TAREFA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_tarefa_guard();

DROP TRIGGER IF EXISTS trg_chamado_sistema_tarefa_updated ON public."CHAMADO_SISTEMA_TAREFA";
CREATE TRIGGER trg_chamado_sistema_tarefa_updated
  BEFORE UPDATE ON public."CHAMADO_SISTEMA_TAREFA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) RLS ----------------------------------------------------------------
ALTER TABLE public."CHAMADO_SISTEMA"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_SISTEMA_TAREFA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_SISTEMA_ANEXO"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_SISTEMA_EVENTO" ENABLE ROW LEVEL SECURITY;

-- CHAMADO_SISTEMA
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.tem_acesso_menu('chamados_sistemas_painel')
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_TAREFA" t
               WHERE t.chamado_id = "CHAMADO_SISTEMA".id AND t.responsavel_id = auth.uid())
  );

DROP POLICY IF EXISTS chamado_sistema_insert ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_insert ON public."CHAMADO_SISTEMA"
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND status = 'aberto' AND responsavel_id IS NULL);

DROP POLICY IF EXISTS chamado_sistema_update ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_update ON public."CHAMADO_SISTEMA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

-- CHAMADO_SISTEMA_TAREFA
DROP POLICY IF EXISTS chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel'));

DROP POLICY IF EXISTS chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA"
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel'));

-- CHAMADO_SISTEMA_ANEXO
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.tem_acesso_menu('chamados_sistemas_painel'))));

DROP POLICY IF EXISTS chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
         OR public.tem_acesso_menu('chamados_sistemas_painel'))));

-- CHAMADO_SISTEMA_EVENTO
DROP POLICY IF EXISTS chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO"
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('chamados_sistemas_painel')
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
               AND (c.responsavel_id = auth.uid()
                    OR (c.solicitante_id = auth.uid() AND tipo <> 'observacao_interna')))
  );

DROP POLICY IF EXISTS chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (public.tem_acesso_menu('chamados_sistemas_painel')
         OR c.responsavel_id = auth.uid()
         OR (c.solicitante_id = auth.uid() AND tipo IN ('comentario')))));

-- 6) Storage bucket -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chamados-sistemas', 'chamados-sistemas', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chamados sistemas anexo select" ON storage.objects;
CREATE POLICY "chamados sistemas anexo select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chamados-sistemas');

DROP POLICY IF EXISTS "chamados sistemas anexo insert" ON storage.objects;
CREATE POLICY "chamados sistemas anexo insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chamados-sistemas');

-- 7) RPCs ---------------------------------------------------------------
-- Estatísticas do solicitante (para os cards de "Meus chamados").
CREATE OR REPLACE FUNCTION public.chamados_meus_stats()
RETURNS TABLE(meus int, concluidos int, em_atendimento int, aguardando_acao int, tempo_medio numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'concluido')::int,
    count(*) FILTER (WHERE status IN ('aberto','em_andamento'))::int,
    count(*) FILTER (WHERE status = 'aguardando_retorno')::int,
    round((avg(extract(epoch FROM (concluido_em - created_at)) / 86400.0)
           FILTER (WHERE concluido_em IS NOT NULL))::numeric, 1)
  FROM public."CHAMADO_SISTEMA"
  WHERE solicitante_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_meus_stats() TO authenticated;

-- Estatísticas do painel do gerente (0 se não for gerente).
CREATE OR REPLACE FUNCTION public.chamados_painel_stats()
RETURNS TABLE(total int, abertos int, em_andamento int, concluidos_mes int, atrasados int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'aberto')::int,
    count(*) FILTER (WHERE status = 'em_andamento')::int,
    count(*) FILTER (WHERE status = 'concluido'
                     AND concluido_em >= date_trunc('month', now()))::int,
    count(*) FILTER (WHERE prazo_previsto < current_date
                     AND status NOT IN ('concluido','reprovado'))::int
  FROM public."CHAMADO_SISTEMA"
  WHERE public.tem_acesso_menu('chamados_sistemas_painel');
$$;
REVOKE ALL ON FUNCTION public.chamados_painel_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_painel_stats() TO authenticated;

-- Desenvolvedores (quem tem chamados_sistemas_dev liberado por usuário) +
-- contagem de carga. Só devolve algo para o gerente.
CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.tem_acesso_menu('chamados_sistemas_painel')
    AND EXISTS (SELECT 1 FROM public.screen_permission_user s
                WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_dev'
                  AND s.acao = 'visualizar'::public.app_acao AND s.allow = true
                  AND s.empresa_id IS NULL)
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- ===== 20260802000002_chamados_sistemas_permissoes =====
-- =========================================================================
-- =====================================================================
-- CHAMADOS DE SISTEMAS — matriz de permissões granular por usuário.
-- Registra cada AÇÃO como um código em app_menu (aparece em Administração →
-- Módulos & Menus → "Acesso por Usuário", um switch por ação) e amarra a RLS
-- + os guards a esses códigos. Capacidades:
--   chamados_sistemas_abrir      → solicitar (abrir chamado). ABERTO a todos
--                                  por padrão; vira restrito quando alguém é
--                                  configurado (mesma regra do resto do ERP).
--   chamados_sistemas_painel     → ver TODOS os chamados / Painel de Distribuição
--   chamados_sistemas_coordenar  → distribuir, atribuir responsável, editar o
--                                  chamado e gerenciar as tarefas
--   chamados_sistemas_aprovar    → aprovar / reprovar / encerrar
--   chamados_sistemas_dev        → desenvolvedor: Painel do Dev + executar tarefas
-- "Gestor" (para RLS) = tem painel OU coordenar OU aprovar.
-- Tabelas em MAIÚSCULAS/citadas: "CHAMADO_SISTEMA*".
-- =====================================================================

-- 1) Registrar as novas capacidades (rota NULL = só permissão) ----------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, NULL, x.ordem
  FROM (VALUES
    ('chamados_sistemas_abrir',     'Chamados — Abrir chamado (solicitar)',                 18),
    ('chamados_sistemas_coordenar', 'Chamados — Coordenar / distribuir / editar / tarefas',  19),
    ('chamados_sistemas_aprovar',   'Chamados — Aprovar / reprovar / encerrar',              20)
  ) AS x(codigo, nome, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Rótulos mais claros nas capacidades que já existiam (idempotente).
UPDATE public.app_menu SET nome = 'Chamados — Painel de Distribuição (ver todos)'
  WHERE codigo = 'chamados_sistemas_painel';
UPDATE public.app_menu SET nome = 'Chamados — Painel do Desenvolvedor (executar)'
  WHERE codigo = 'chamados_sistemas_dev';

-- 2) Helpers ------------------------------------------------------------
-- "Gestor" do chamado = qualquer papel de gestão.
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_painel')
      OR public.tem_acesso_menu('chamados_sistemas_coordenar')
      OR public.tem_acesso_menu('chamados_sistemas_aprovar');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor() TO authenticated;

-- "Pode abrir" = liberado explicitamente OU ninguém configurou o código ainda
-- (aberto por padrão, como as demais telas sem regra definida).
CREATE OR REPLACE FUNCTION public.chamado_pode_abrir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_abrir')
      OR NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes()
                     WHERE menu_codigo = 'chamados_sistemas_abrir');
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_abrir() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamado_pode_abrir() TO authenticated;

-- 3) RLS refeita por capacidade -----------------------------------------
-- CHAMADO_SISTEMA
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_gestor()
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_TAREFA" t
               WHERE t.chamado_id = "CHAMADO_SISTEMA".id AND t.responsavel_id = auth.uid())
  );

DROP POLICY IF EXISTS chamado_sistema_insert ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_insert ON public."CHAMADO_SISTEMA"
  FOR INSERT TO authenticated
  WITH CHECK (
    public.chamado_pode_abrir()
    AND solicitante_id = auth.uid() AND status = 'aberto' AND responsavel_id IS NULL
  );

DROP POLICY IF EXISTS chamado_sistema_update ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_update ON public."CHAMADO_SISTEMA"
  FOR UPDATE TO authenticated
  USING (public.chamado_sistema_gestor() OR responsavel_id = auth.uid())
  WITH CHECK (public.chamado_sistema_gestor() OR responsavel_id = auth.uid());

-- CHAMADO_SISTEMA_TAREFA
DROP POLICY IF EXISTS chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_select ON public."CHAMADO_SISTEMA_TAREFA"
  FOR SELECT TO authenticated
  USING (public.chamado_sistema_gestor() OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_insert ON public."CHAMADO_SISTEMA_TAREFA"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_coordenar'));

DROP POLICY IF EXISTS chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_update ON public."CHAMADO_SISTEMA_TAREFA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_coordenar') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_coordenar') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA";
CREATE POLICY chamado_sistema_tarefa_delete ON public."CHAMADO_SISTEMA_TAREFA"
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_coordenar'));

-- CHAMADO_SISTEMA_ANEXO
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

DROP POLICY IF EXISTS chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_insert ON public."CHAMADO_SISTEMA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
         OR public.chamado_sistema_gestor())));

-- CHAMADO_SISTEMA_EVENTO
DROP POLICY IF EXISTS chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_select ON public."CHAMADO_SISTEMA_EVENTO"
  FOR SELECT TO authenticated
  USING (
    public.chamado_sistema_gestor()
    OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
               AND (c.responsavel_id = auth.uid()
                    OR (c.solicitante_id = auth.uid() AND tipo <> 'observacao_interna')))
  );

DROP POLICY IF EXISTS chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO";
CREATE POLICY chamado_sistema_evento_insert ON public."CHAMADO_SISTEMA_EVENTO"
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
    AND (public.chamado_sistema_gestor()
         OR c.responsavel_id = auth.uid()
         OR (c.solicitante_id = auth.uid() AND tipo IN ('comentario')))));

-- 4) Guards refeitos por capacidade -------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_coord boolean := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov boolean := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  boolean := COALESCE(OLD.responsavel_id = auth.uid(), false);
BEGIN
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

  -- Demais mudanças de status: coordenar, aprovar OU o dev responsável.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_coord OR v_aprov OR v_resp) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.chamado_sistema_tarefa_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_coord boolean := public.tem_acesso_menu('chamados_sistemas_coordenar');
BEGIN
  IF NOT v_coord THEN
    IF NEW.titulo         IS DISTINCT FROM OLD.titulo
    OR NEW.descricao      IS DISTINCT FROM OLD.descricao
    OR NEW.prioridade     IS DISTINCT FROM OLD.prioridade
    OR NEW.ordem          IS DISTINCT FROM OLD.ordem
    OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
    OR NEW.prazo          IS DISTINCT FROM OLD.prazo THEN
      RAISE EXCEPTION 'Sem permissão para alterar esta tarefa (apenas o status).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5) RPCs de gestão passam a liberar para qualquer GESTOR (não só painel) ---
CREATE OR REPLACE FUNCTION public.chamados_painel_stats()
RETURNS TABLE(total int, abertos int, em_andamento int, concluidos_mes int, atrasados int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'aberto')::int,
    count(*) FILTER (WHERE status = 'em_andamento')::int,
    count(*) FILTER (WHERE status = 'concluido'
                     AND concluido_em >= date_trunc('month', now()))::int,
    count(*) FILTER (WHERE prazo_previsto < current_date
                     AND status NOT IN ('concluido','reprovado'))::int
  FROM public."CHAMADO_SISTEMA"
  WHERE public.chamado_sistema_gestor();
$$;
REVOKE ALL ON FUNCTION public.chamados_painel_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_painel_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.chamado_sistema_gestor()
    AND EXISTS (SELECT 1 FROM public.screen_permission_user s
                WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_dev'
                  AND s.acao = 'visualizar'::public.app_acao AND s.allow = true
                  AND s.empresa_id IS NULL)
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- migration 20260802000003_chamados_devs_inclui_capacidade_desenvolvedores
-- =====================================================================
-- =====================================================================
-- CHAMADOS DE SISTEMAS â€” a "AtribuiÃ§Ã£o rÃ¡pida" do Painel de DistribuiÃ§Ã£o
-- nÃ£o achava ninguÃ©m pra destinar o chamado.
--
-- listar_desenvolvedores_chamados exigia o cÃ³digo NOVO (chamados_sistemas_dev)
-- e ainda por cima sÃ³ olhava a tabela de exceÃ§Ãµes por usuÃ¡rio, ignorando quem
-- recebe a capacidade por perfil de acesso. Quem estÃ¡ marcado como
-- "Desenvolvedores" (sistemas_desenvolvedores) no Acesso por UsuÃ¡rio â€” que Ã©
-- o cÃ³digo que a equipe usa hoje â€” nunca entrava na lista.
--
-- Agora a prÃ³pria funÃ§Ã£o resolve os dois cÃ³digos do mesmo jeito que
-- has_screen_access resolve qualquer tela: exceÃ§Ã£o individual mais recente
-- vence, senÃ£o vale a uniÃ£o dos perfis de acesso. Perfil "concede tudo" nÃ£o
-- entra â€” senÃ£o todo admin viraria opÃ§Ã£o de responsÃ¡vel na fila.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.chamado_sistema_gestor()
    AND EXISTS (
      SELECT 1
        FROM unnest(ARRAY['chamados_sistemas_dev','sistemas_desenvolvedores']) AS cod
       WHERE COALESCE(
               -- exceÃ§Ã£o individual (Acesso por UsuÃ¡rio), a mais recente vence
               (SELECT s.allow
                  FROM public.screen_permission_user s
                 WHERE s.user_id = p.id
                   AND s.menu_codigo = cod
                   AND s.acao = 'visualizar'::public.app_acao
                 ORDER BY s.updated_at DESC
                 LIMIT 1),
               -- senÃ£o, uniÃ£o dos perfis de acesso do usuÃ¡rio
               EXISTS (SELECT 1
                         FROM public.usuario_perfil_acesso upa
                         JOIN public.perfil_acesso pa
                           ON pa.id = upa.perfil_id AND pa.ativo = true
                         JOIN public.perfil_acesso_permissao pap
                           ON pap.perfil_id = pa.id AND pap.allow = true
                        WHERE upa.user_id = p.id
                          AND pap.menu_codigo = cod
                          AND pap.acao = 'visualizar'::public.app_acao)
             ) IS TRUE
    )
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

-- Limpeza: versÃ£o anterior deste arquivo criava uma funÃ§Ã£o auxiliar separada.
DROP FUNCTION IF EXISTS public.chamado_dev_liberado(uuid);

NOTIFY pgrst, 'reload schema';


-- ===== 20260803000001_chamados_remove_tarefas =====
-- Remove o recurso de Tarefas dos Chamados de Sistemas.
-- Recria a SELECT de CHAMADO_SISTEMA sem depender de TAREFA, dropa a tabela
-- (policies/triggers/índices via CASCADE) e a função guard exclusiva.
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_gestor()
  );

DO $$
DECLARE r regclass;
BEGIN
  SELECT c.oid::regclass INTO r
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND lower(c.relname) = 'chamado_sistema_tarefa'
     AND c.relkind = 'r';
  IF r IS NOT NULL THEN
    EXECUTE 'DROP TABLE ' || r::text || ' CASCADE';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.chamado_sistema_tarefa_guard() CASCADE;

NOTIFY pgrst, 'reload schema';


-- ===== 20260804000001_chamados_adicionar_informacao =====
-- Solicitante responde ao "Solicitar mais informações": grava no histórico e
-- devolve o chamado ao time. RPC SECURITY DEFINER (RLS não deixa o solicitante
-- mexer no status nem inserir evento != 'comentario').
CREATE OR REPLACE FUNCTION public.chamado_adicionar_informacao(
  p_chamado_id uuid,
  p_texto      text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_responsavel uuid;
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'Informe o texto com as informações.';
  END IF;

  SELECT solicitante_id, status, responsavel_id
    INTO v_solicitante, v_status, v_responsavel
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante <> auth.uid() THEN
    RAISE EXCEPTION 'Apenas o solicitante pode adicionar informações a este chamado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível adicionar informações.';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'comentario', btrim(p_texto));

  IF v_status = 'aguardando_retorno' THEN
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_adicionar_informacao(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260805000001_chamados_observacoes_solicitante =====
-- Campo "Observações do solicitante" na abertura do chamado (opcional).
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS observacoes_solicitante text;

NOTIFY pgrst, 'reload schema';


-- ===== 20260806000001_chamados_excluir_permissao =====
-- Excluir chamado: capacidade "chamados_sistemas_excluir" (fechada por padrão)
-- + RLS de DELETE (chamado com cascata p/ eventos e anexos) + DELETE no storage.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_excluir', 'Chamados — Excluir chamado (apagar)', NULL, 21
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

DROP POLICY IF EXISTS chamado_sistema_delete ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_delete ON public."CHAMADO_SISTEMA"
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_excluir'));

DROP POLICY IF EXISTS "chamados sistemas anexo delete" ON storage.objects;
CREATE POLICY "chamados sistemas anexo delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chamados-sistemas' AND public.tem_acesso_menu('chamados_sistemas_excluir'));

NOTIFY pgrst, 'reload schema';


-- ===== 20260807000001_whatsapp_chatbot =====
-- =====================================================================
-- WHATSAPP — CHATBOT (integração Meta WhatsApp Cloud API)
--
-- Recebe e envia mensagens via Cloud API (Edge Functions whatsapp-webhook /
-- whatsapp-enviar) e responde com IA (Claude). Guarda contatos, conversas,
-- mensagens, a configuração do bot e a base de conhecimento.
--
-- Permissão por usuário (mesma base do resto do ERP: app_menu +
-- tem_acesso_menu). Capacidades:
--   whatsapp          → Caixa de Entrada (ver/atender conversas)
--   whatsapp_chatbot  → Chatbot (configurar persona, base de conhecimento)
-- Ambas ficam FECHADAS por padrão (MENUS_SEMPRE_RESTRITOS no front).
--
-- O webhook grava com a service_role (bypass de RLS); o front lê/escreve com a
-- sessão do usuário, limitado pela RLS por capacidade.
-- =====================================================================

-- 1) Módulo + menus / capacidades ---------------------------------------
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'whatsapp', 'WhatsApp', 'Atendimento e chatbot',
       'MessageCircle',
       COALESCE((SELECT max(ordem) FROM public.app_modulo), 200) + 5
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'whatsapp');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('whatsapp',         'WhatsApp — Caixa de Entrada', '/app/whatsapp',         1),
    ('whatsapp_chatbot', 'WhatsApp — Chatbot',          '/app/whatsapp/chatbot', 2)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Tabelas ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_CONTATO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id       text NOT NULL UNIQUE,          -- número no formato Cloud API (ex.: 55119...)
  nome        text,
  telefone    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."WA_CONVERSA" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id               uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','pendente','fechada')),
  bot_ativo                boolean NOT NULL DEFAULT true,   -- bot responde automaticamente?
  atendente_id             uuid REFERENCES auth.users(id), -- humano que assumiu
  ultima_mensagem_em       timestamptz,
  ultima_mensagem_preview  text,
  ultima_direcao           text,                            -- entrada | saida
  nao_lidas                integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contato_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_conversa_ultima ON public."WA_CONVERSA"(ultima_mensagem_em DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public."WA_MENSAGEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id   uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  contato_id    uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  direcao       text NOT NULL CHECK (direcao IN ('entrada','saida')),
  tipo          text NOT NULL DEFAULT 'text',  -- text | image | audio | document | outro
  texto         text,
  wa_message_id text UNIQUE,                    -- id da Meta (dedupe de reentrega)
  status        text NOT NULL DEFAULT 'recebida' CHECK (status IN ('recebida','enviada','entregue','lida','erro')),
  origem        text NOT NULL DEFAULT 'contato' CHECK (origem IN ('contato','bot','atendente')),
  autor_id      uuid REFERENCES auth.users(id), -- atendente que enviou (quando origem=atendente)
  meta          jsonb,
  criada_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_mensagem_conversa ON public."WA_MENSAGEM"(conversa_id, criada_em);

-- Configuração do bot — linha única (id boolean garante singleton).
CREATE TABLE IF NOT EXISTS public."WA_BOT_CONFIG" (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  ativo            boolean NOT NULL DEFAULT false,
  persona          text NOT NULL DEFAULT 'Você é o assistente virtual do Grupo Nascimento no WhatsApp. Seja cordial, direto e útil. Responda em português do Brasil. Se não souber ou o assunto exigir um humano, diga que vai encaminhar para um atendente.',
  saudacao         text,                                  -- opcional: 1ª resposta a um contato novo
  fallback         text NOT NULL DEFAULT 'Não consegui entender agora. Um atendente vai te responder em breve.',
  horario_inicio   time NOT NULL DEFAULT '08:00',
  horario_fim      time NOT NULL DEFAULT '18:00',
  dias_semana      int[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- 0=dom .. 6=sáb
  fora_horario_msg text NOT NULL DEFAULT 'Nosso atendimento é de segunda a sexta, das 8h às 18h. Retornaremos assim que possível.',
  modelo           text NOT NULL DEFAULT 'claude-opus-5',
  max_tokens       integer NOT NULL DEFAULT 1024,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."WA_BOT_CONFIG" (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- Base de conhecimento injetada no prompt do bot.
CREATE TABLE IF NOT EXISTS public."WA_BOT_CONHECIMENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  conteudo    text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  ordem       integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- updated_at automático (função set_updated_at já existe no projeto).
DROP TRIGGER IF EXISTS trg_wa_contato_updated  ON public."WA_CONTATO";
CREATE TRIGGER trg_wa_contato_updated  BEFORE UPDATE ON public."WA_CONTATO"  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_wa_conversa_updated ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_updated BEFORE UPDATE ON public."WA_CONVERSA" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_wa_bot_config_updated ON public."WA_BOT_CONFIG";
CREATE TRIGGER trg_wa_bot_config_updated BEFORE UPDATE ON public."WA_BOT_CONFIG" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) RLS ----------------------------------------------------------------
ALTER TABLE public."WA_CONTATO"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_CONVERSA"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_MENSAGEM"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_BOT_CONFIG"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WA_BOT_CONHECIMENTO" ENABLE ROW LEVEL SECURITY;

-- Caixa de entrada (contatos/conversas/mensagens): quem tem 'whatsapp'.
DROP POLICY IF EXISTS wa_contato_rw ON public."WA_CONTATO";
CREATE POLICY wa_contato_rw ON public."WA_CONTATO" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

DROP POLICY IF EXISTS wa_conversa_rw ON public."WA_CONVERSA";
CREATE POLICY wa_conversa_rw ON public."WA_CONVERSA" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

DROP POLICY IF EXISTS wa_mensagem_rw ON public."WA_MENSAGEM";
CREATE POLICY wa_mensagem_rw ON public."WA_MENSAGEM" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp')) WITH CHECK (public.tem_acesso_menu('whatsapp'));

-- Config + base de conhecimento do bot: ver com 'whatsapp'; editar com 'whatsapp_chatbot'.
DROP POLICY IF EXISTS wa_bot_config_select ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_select ON public."WA_BOT_CONFIG" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));
DROP POLICY IF EXISTS wa_bot_config_update ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_update ON public."WA_BOT_CONFIG" FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('whatsapp_chatbot')) WITH CHECK (public.tem_acesso_menu('whatsapp_chatbot'));

DROP POLICY IF EXISTS wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));
DROP POLICY IF EXISTS wa_bot_conh_cud ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_cud ON public."WA_BOT_CONHECIMENTO" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp_chatbot')) WITH CHECK (public.tem_acesso_menu('whatsapp_chatbot'));

CREATE OR REPLACE FUNCTION public.wa_incrementar_nao_lidas(p_conversa uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ UPDATE public."WA_CONVERSA" SET nao_lidas = nao_lidas + 1 WHERE id = p_conversa; $$;
REVOKE ALL ON FUNCTION public.wa_incrementar_nao_lidas(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_incrementar_nao_lidas(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_incrementar_nao_lidas(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- ===== 20260808000001_whatsapp_modulo_abaixo_cs =====
-- =====================================================================
-- WHATSAPP — módulo próprio, posicionado logo ABAIXO de "Central de Serviços".
-- Corrige instalações onde os menus whatsapp/whatsapp_chatbot ficaram DENTRO do
-- módulo central_servicos. Idempotente: cria o módulo se faltar, reposiciona e
-- move os menus para ele (removendo cópias em outros módulos).
-- =====================================================================

-- 1) Garante o módulo "WhatsApp" (posição = logo abaixo de Central de Serviços)
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'whatsapp', 'WhatsApp', 'Atendimento e chatbot',
       'MessageCircle',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'central_servicos'), 200) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'whatsapp');

-- 2) Reposiciona logo abaixo de Central de Serviços (mesmo se o módulo já existia)
UPDATE public.app_modulo
   SET ordem = COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'central_servicos'), 200) + 1
 WHERE codigo = 'whatsapp';

-- 3) Remove os menus whatsapp de qualquer módulo que NÃO seja o "whatsapp"
--    (tira a versão antiga que ficava dentro de central_servicos e duplicados).
--    As permissões (screen_permission_*) são por menu_codigo (string), então
--    mover o menu entre módulos não perde os acessos já concedidos.
DELETE FROM public.app_menu
 WHERE codigo IN ('whatsapp', 'whatsapp_chatbot')
   AND modulo_id <> (SELECT id FROM public.app_modulo WHERE codigo = 'whatsapp');

-- 4) Garante os menus sob o módulo "whatsapp"
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('whatsapp',         'WhatsApp — Caixa de Entrada', '/app/whatsapp',         1),
    ('whatsapp_chatbot', 'WhatsApp — Chatbot',          '/app/whatsapp/chatbot', 2)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';


-- ===== 20260809000001_chamados_avaliacao =====
-- =====================================================================
-- CHAMADOS DE SISTEMAS — avaliação do solicitante ao concluir.
--
-- Quando o chamado é concluído, o solicitante avalia de 1 a 5 estrelas
-- (descrição opcional). Uma avaliação por chamado. Enquanto houver chamado
-- concluído SEM avaliação, o solicitante NÃO pode abrir novo chamado — regra
-- enforçada por trigger (além do bloqueio na UI).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_AVALIACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL UNIQUE REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  estrelas       smallint NOT NULL CHECK (estrelas BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO" ENABLE ROW LEVEL SECURITY;

-- Ver: solicitante do chamado, responsável ou gestão.
DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

-- Inserir: só o solicitante, e só de chamado próprio já concluído.
DROP POLICY IF EXISTS chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
      AND c.solicitante_id = auth.uid() AND c.status = 'concluido'));

-- Lista de avaliações pendentes do solicitante atual (chamados concluídos sem avaliação).
CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes()
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.concluido_em
    FROM public."CHAMADO_SISTEMA" c
   WHERE c.solicitante_id = auth.uid()
     AND c.status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
   ORDER BY c.concluido_em NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;

-- Bloqueia abertura de novo chamado enquanto o solicitante tiver avaliação pendente.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.solicitante_id = NEW.solicitante_id
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
  ) THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_bloqueia_avaliacao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_bloqueia_avaliacao
  BEFORE INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente();

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- [20260810000001] Avaliacao MULTI-CRITERIO (5 itens) — substitui a nota unica.
-- =====================================================================
-- =====================================================================
-- CHAMADOS DE SISTEMAS — avaliação MULTI-CRITÉRIO (redesenho).
-- Substitui a avaliação de nota única por 5 critérios (1..5) + comentário.
-- Self-contained e idempotente: recria a tabela, RLS, a RPC de pendentes e o
-- trigger que bloqueia abrir novo chamado com avaliação pendente.
-- (Como ainda é fase de teste, recriar a tabela não perde dado relevante.)
-- =====================================================================

DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_AVALIACAO" CASCADE;

CREATE TABLE public."CHAMADO_SISTEMA_AVALIACAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL UNIQUE REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  atendimento    smallint NOT NULL CHECK (atendimento BETWEEN 1 AND 5),
  tempo          smallint NOT NULL CHECK (tempo       BETWEEN 1 AND 5),
  solucao        smallint NOT NULL CHECK (solucao     BETWEEN 1 AND 5),
  clareza        smallint NOT NULL CHECK (clareza     BETWEEN 1 AND 5),
  satisfacao     smallint NOT NULL CHECK (satisfacao  BETWEEN 1 AND 5),
  comentario     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_gestor())));

DROP POLICY IF EXISTS chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_insert ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
      AND c.solicitante_id = auth.uid() AND c.status = 'concluido'));

-- Pendentes do solicitante atual (concluídos sem avaliação).
CREATE OR REPLACE FUNCTION public.chamados_meus_avaliacoes_pendentes()
RETURNS TABLE(id uuid, numero text, assunto text, concluido_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.numero, c.assunto, c.concluido_em
    FROM public."CHAMADO_SISTEMA" c
   WHERE c.solicitante_id = auth.uid()
     AND c.status = 'concluido'
     AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
   ORDER BY c.concluido_em NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_meus_avaliacoes_pendentes() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_avaliacoes_pendentes() TO authenticated;

-- Bloqueia abrir novo chamado com avaliação pendente.
CREATE OR REPLACE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.solicitante_id = NEW.solicitante_id
       AND c.status = 'concluido'
       AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_AVALIACAO" a WHERE a.chamado_id = c.id)
  ) THEN
    RAISE EXCEPTION 'Você tem chamados concluídos aguardando avaliação. Avalie-os antes de abrir um novo.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_bloqueia_avaliacao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_bloqueia_avaliacao
  BEFORE INSERT ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_bloqueia_avaliacao_pendente();

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- [20260811000001] Posicao na fila (FIFO) + Ranking de satisfacao.
-- =====================================================================
-- =====================================================================
-- CHAMADOS DE SISTEMAS — Posição na fila (FIFO) + Ranking de satisfação.
--
-- 1) chamados_posicao_fila(): posição do chamado na fila global de ATIVOS,
--    por ordem de abertura (o mais antigo aberto é o nº 1). Retorna só as
--    posições dos chamados do próprio usuário (como solicitante) ou atribuídos
--    a ele (como responsável) — SECURITY DEFINER para calcular a posição no
--    total sem expor o conteúdo dos chamados dos outros.
--
-- 2) chamados_ranking_satisfacao(): média por responsável dos 5 critérios da
--    avaliação (depende da migração 20260810000001 — avaliação multi-critério).
--    Usada no ranking de satisfação e nas médias por item.
--
-- Idempotente. Aplicar DEPOIS de 20260810000001_chamados_avaliacao_multi.sql.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamados_posicao_fila()
RETURNS TABLE(chamado_id uuid, posicao int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH fila AS (
    SELECT id, solicitante_id, responsavel_id,
           row_number() OVER (ORDER BY created_at ASC, id ASC) AS pos
      FROM public."CHAMADO_SISTEMA"
     WHERE status NOT IN ('concluido', 'reprovado')
  )
  SELECT id, pos::int
    FROM fila
   WHERE solicitante_id = auth.uid() OR responsavel_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.chamados_posicao_fila() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_posicao_fila() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_posicao_fila() TO authenticated;

CREATE OR REPLACE FUNCTION public.chamados_ranking_satisfacao()
RETURNS TABLE(
  responsavel_id uuid,
  avaliacoes     bigint,
  media          numeric,
  atendimento    numeric,
  tempo          numeric,
  solucao        numeric,
  clareza        numeric,
  satisfacao     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.responsavel_id,
         count(*)::bigint,
         avg((a.atendimento + a.tempo + a.solucao + a.clareza + a.satisfacao) / 5.0)::numeric,
         avg(a.atendimento)::numeric,
         avg(a.tempo)::numeric,
         avg(a.solucao)::numeric,
         avg(a.clareza)::numeric,
         avg(a.satisfacao)::numeric
    FROM public."CHAMADO_SISTEMA_AVALIACAO" a
    JOIN public."CHAMADO_SISTEMA" c ON c.id = a.chamado_id
   WHERE c.responsavel_id IS NOT NULL
   GROUP BY c.responsavel_id
   ORDER BY 3 DESC NULLS LAST, 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_ranking_satisfacao() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260813000001_chamados_fila_por_dev =====
-- =====================================================================
-- CHAMADOS DE SISTEMAS — fila POR DESENVOLVEDOR (posição de execução).
--
-- A fila global (ordem de chegada) continua existindo, mas cada dev passa a
-- ter a SUA própria ordem: o chamado que é o nº 3 da fila global pode ser o
-- nº 1 do Pablo, se for a única tarefa pendente dele. Essa ordem fica em
-- "CHAMADO_SISTEMA".posicao_dev e é definida na tela de coordenação
-- ("Definir posição da nova tarefa na fila" + arrastar a fila do responsável).
--
-- Regras garantidas por trigger/RPC:
--   * chamado concluído/reprovado NÃO tem posição (posicao_dev = NULL);
--   * chamado ativo COM responsável sempre tem posição (entra no fim da fila
--     quando ninguém escolheu uma — ex.: atribuição rápida do painel);
--   * a fila de cada dev é normalizada para 1..n a cada direcionamento,
--     reordenação ou troca de responsável.
--
-- Idempotente. Aplicar DEPOIS de 20260811000001_chamados_fila_satisfacao.sql.
-- =====================================================================

-- 1) Coluna + índice ----------------------------------------------------
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS posicao_dev integer;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_posicao_dev
  ON public."CHAMADO_SISTEMA"(responsavel_id, posicao_dev);

-- 2) Normalizador da fila de um dev (1..n, só ativos) -------------------
-- Interno: chamado pelas RPCs abaixo. Não recebe GRANT para authenticated.
CREATE OR REPLACE FUNCTION public.chamado_normalizar_fila_dev(p_responsavel_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = f.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY posicao_dev NULLS LAST, created_at, id) AS rn
        FROM public."CHAMADO_SISTEMA"
       WHERE responsavel_id = p_responsavel_id
         AND status NOT IN ('concluido', 'reprovado')
    ) f
   WHERE c.id = f.id
     AND c.posicao_dev IS DISTINCT FROM f.rn::int;
$$;
REVOKE ALL ON FUNCTION public.chamado_normalizar_fila_dev(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_normalizar_fila_dev(uuid) FROM anon;

-- 3) Coerência da posição (trigger) -------------------------------------
-- Concluiu/reprovou ou ficou sem responsável → some da fila.
-- Ativo com responsável e sem posição (ou trocou de dev sem posição nova)
-- → entra no fim da fila do responsável.
CREATE OR REPLACE FUNCTION public.chamado_sistema_fila_dev()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('concluido', 'reprovado') OR NEW.responsavel_id IS NULL THEN
    NEW.posicao_dev := NULL;
  ELSIF NEW.posicao_dev IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
         AND NEW.posicao_dev IS NOT DISTINCT FROM OLD.posicao_dev) THEN
    SELECT COALESCE(max(posicao_dev), 0) + 1 INTO NEW.posicao_dev
      FROM public."CHAMADO_SISTEMA"
     WHERE responsavel_id = NEW.responsavel_id
       AND status NOT IN ('concluido', 'reprovado')
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_fila_dev ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_fila_dev
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_fila_dev();

-- 4) Backfill dos chamados já atribuídos --------------------------------
UPDATE public."CHAMADO_SISTEMA" c
   SET posicao_dev = f.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY responsavel_id ORDER BY created_at, id) AS rn
      FROM public."CHAMADO_SISTEMA"
     WHERE responsavel_id IS NOT NULL
       AND status NOT IN ('concluido', 'reprovado')
  ) f
 WHERE c.id = f.id AND c.posicao_dev IS NULL;

UPDATE public."CHAMADO_SISTEMA"
   SET posicao_dev = NULL
 WHERE posicao_dev IS NOT NULL
   AND (status IN ('concluido', 'reprovado') OR responsavel_id IS NULL);

-- 5) Direcionar o chamado (tela de coordenação) -------------------------
-- Atribui o responsável, define em que posição da fila DELE a solicitação
-- entra (empurrando as demais para baixo) e registra o evento no histórico.
CREATE OR REPLACE FUNCTION public.chamado_direcionar(
  p_chamado_id     uuid,
  p_responsavel_id uuid,
  p_posicao        int  DEFAULT NULL,
  p_observacao     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_numero    text;
  v_status    text;
  v_anterior  uuid;
  v_total     int;
  v_pos       int;
  v_nome      text;
BEGIN
  IF NOT public.tem_acesso_menu('chamados_sistemas_coordenar') THEN
    RAISE EXCEPTION 'Sem permissão para direcionar chamados.';
  END IF;
  IF p_responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o responsável pela execução.';
  END IF;

  SELECT numero, status, responsavel_id
    INTO v_numero, v_status, v_anterior
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id
     FOR UPDATE;

  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível direcionar.';
  END IF;

  -- Tamanho da fila de destino (sem contar o próprio chamado).
  SELECT count(*)::int INTO v_total
    FROM public."CHAMADO_SISTEMA"
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado')
     AND id <> p_chamado_id;

  v_pos := LEAST(GREATEST(COALESCE(p_posicao, v_total + 1), 1), v_total + 1);

  -- Abre espaço na posição escolhida.
  UPDATE public."CHAMADO_SISTEMA"
     SET posicao_dev = posicao_dev + 1
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado')
     AND id <> p_chamado_id
     AND posicao_dev >= v_pos;

  -- Responsável + status + observação (a posição vem no UPDATE seguinte,
  -- senão o trigger de coerência jogaria o chamado para o fim da fila).
  UPDATE public."CHAMADO_SISTEMA"
     SET responsavel_id     = p_responsavel_id,
         status             = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         observacao_gerente = COALESCE(NULLIF(btrim(COALESCE(p_observacao, '')), ''), observacao_gerente)
   WHERE id = p_chamado_id;

  UPDATE public."CHAMADO_SISTEMA" SET posicao_dev = v_pos WHERE id = p_chamado_id;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
  IF v_anterior IS NOT NULL AND v_anterior <> p_responsavel_id THEN
    PERFORM public.chamado_normalizar_fila_dev(v_anterior);
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = p_responsavel_id;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          format('Chamado direcionado a %s — %sº lugar na fila do responsável',
                 COALESCE(v_nome, 'responsável'), v_pos));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_direcionar(uuid, uuid, int, text) TO authenticated;

-- 6) Reordenar a fila de um dev (arrastar as tarefas) -------------------
-- Quem coordena reordena a fila de qualquer dev; o dev reordena a própria.
CREATE OR REPLACE FUNCTION public.chamado_reordenar_fila_dev(
  p_responsavel_id uuid,
  p_ordem          uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR p_responsavel_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para reordenar a fila deste responsável.';
  END IF;

  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = x.ord
    FROM (SELECT unnest(p_ordem) AS id, generate_subscripts(p_ordem, 1) AS ord) x
   WHERE c.id = x.id
     AND c.responsavel_id = p_responsavel_id
     AND c.status NOT IN ('concluido', 'reprovado')
     AND c.posicao_dev IS DISTINCT FROM x.ord;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_reordenar_fila_dev(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20260814000001_whatsapp_mensagem_interativa
-- WhatsApp: coluna payload em WA_MENSAGEM (botoes enviados / clique recebido)
-- =====================================================================
ALTER TABLE public."WA_MENSAGEM" ADD COLUMN IF NOT EXISTS payload jsonb;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20260814000002_whatsapp_bot_menu
-- WhatsApp: coluna menu (jsonb) em WA_BOT_CONFIG (menu automatico do bot)
-- =====================================================================
ALTER TABLE public."WA_BOT_CONFIG" ADD COLUMN IF NOT EXISTS menu jsonb;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20260814000003_chamados_avaliacao_pesos
-- Chamados: nota final PONDERADA (6 criterios) + ranking ponderado
-- =====================================================================
DROP FUNCTION IF EXISTS public.chamados_ranking_satisfacao();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'CHAMADO_SISTEMA_AVALIACAO'
               AND column_name = 'atendimento') THEN
    TRUNCATE public."CHAMADO_SISTEMA_AVALIACAO";
  END IF;
END $$;

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  DROP COLUMN IF EXISTS atendimento,
  DROP COLUMN IF EXISTS tempo,
  DROP COLUMN IF EXISTS solucao,
  ADD COLUMN IF NOT EXISTS qualidade   smallint NOT NULL CHECK (qualidade   BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS prazo       smallint NOT NULL CHECK (prazo       BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS comunicacao smallint NOT NULL CHECK (comunicacao BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS facilidade  smallint NOT NULL CHECK (facilidade  BETWEEN 1 AND 5);

CREATE FUNCTION public.chamados_ranking_satisfacao()
RETURNS TABLE(
  responsavel_id uuid, avaliacoes bigint, media numeric,
  qualidade numeric, prazo numeric, comunicacao numeric,
  clareza numeric, facilidade numeric, satisfacao numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.responsavel_id,
         count(*)::bigint,
         avg(a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
             + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric,
         avg(a.qualidade)::numeric, avg(a.prazo)::numeric, avg(a.comunicacao)::numeric,
         avg(a.clareza)::numeric, avg(a.facilidade)::numeric, avg(a.satisfacao)::numeric
    FROM public."CHAMADO_SISTEMA_AVALIACAO" a
    JOIN public."CHAMADO_SISTEMA" c ON c.id = a.chamado_id
   WHERE c.responsavel_id IS NOT NULL
   GROUP BY c.responsavel_id
   ORDER BY 3 DESC NULLS LAST, 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_ranking_satisfacao() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_ranking_satisfacao() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20260814000004_whatsapp_midia
-- WhatsApp: bucket privado p/ arquivos recebidos (documento/imagem/audio/video)
--
-- ATENCAO: rode os dois blocos abaixo SEPARADAMENTE (execucoes distintas no
-- SQL Editor). Juntos eles pegam lock em storage.buckets e depois pedem
-- AccessExclusiveLock em storage.objects, na ordem inversa da que o servico de
-- Storage usa => deadlock (40P01). Se o bloco 2 estourar lock_timeout, repita.
-- =====================================================================

-- bloco 1 (sozinho)
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-midia', 'whatsapp-midia', false, 104857600)
on conflict (id) do nothing;

-- bloco 2 (sozinho)
set lock_timeout = '5s';
drop policy if exists "wa midia select" on storage.objects;
create policy "wa midia select" on storage.objects
  for select to authenticated
  using (bucket_id = 'whatsapp-midia' and public.tem_acesso_menu('whatsapp'));
reset lock_timeout;

notify pgrst, 'reload schema';

-- =====================================================================
-- 20260815000001_whatsapp_bot_provedor
-- WhatsApp: provedor de IA configuravel (groq/gemini/openrouter/anthropic)
-- =====================================================================
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'groq';

ALTER TABLE public."WA_BOT_CONFIG" DROP CONSTRAINT IF EXISTS wa_bot_config_provedor_check;
ALTER TABLE public."WA_BOT_CONFIG"
  ADD CONSTRAINT wa_bot_config_provedor_check
  CHECK (provedor IN ('groq', 'gemini', 'openrouter', 'anthropic'));

ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN modelo SET DEFAULT 'llama-3.3-70b-versatile';

UPDATE public."WA_BOT_CONFIG"
   SET modelo = 'llama-3.3-70b-versatile'
 WHERE provedor = 'groq' AND modelo LIKE 'claude%';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- 20260815000002_whatsapp_bot_persona_humana
-- WhatsApp: persona/fallback com cara de atendimento humano.
-- Os UPDATEs so tocam a linha se ela ainda estiver com o texto de fabrica.
-- (As instrucoes de saudacao que existiam aqui foram removidas: a coluna
--  saudacao foi dropada pelo bloco 20260816000001 mais abaixo, e mante-las
--  quebrava a reexecucao do arquivo com "column saudacao does not exist".)
-- =====================================================================
ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN persona SET DEFAULT
  'Você é atendente do Grupo Nascimento no WhatsApp. Fale como um atendente humano de verdade: cordial, próximo e objetivo, sem formalidade excessiva. Entenda o que a pessoa precisa antes de responder e ajude do jeito mais direto possível. Quando o assunto exigir alguém da equipe, avise com naturalidade que vai encaminhar para um atendente.';

ALTER TABLE public."WA_BOT_CONFIG" ALTER COLUMN fallback SET DEFAULT
  'Opa, tive um problema para te responder agora. Já estou chamando um atendente para te ajudar, tudo bem?';

UPDATE public."WA_BOT_CONFIG"
   SET persona = 'Você é atendente do Grupo Nascimento no WhatsApp. Fale como um atendente humano de verdade: cordial, próximo e objetivo, sem formalidade excessiva. Entenda o que a pessoa precisa antes de responder e ajude do jeito mais direto possível. Quando o assunto exigir alguém da equipe, avise com naturalidade que vai encaminhar para um atendente.'
 WHERE persona = 'Você é o assistente virtual do Grupo Nascimento no WhatsApp. Seja cordial, direto e útil. Responda em português do Brasil. Se não souber ou o assunto exigir um humano, diga que vai encaminhar para um atendente.';

UPDATE public."WA_BOT_CONFIG"
   SET fallback = 'Opa, tive um problema para te responder agora. Já estou chamando um atendente para te ajudar, tudo bem?'
 WHERE fallback = 'Não consegui entender agora. Um atendente vai te responder em breve.';

NOTIFY pgrst, 'reload schema';
-- =====================================================================
-- 20260815000003_whatsapp_testes_e_24h
-- =====================================================================
-- WhatsApp — atendimento 24h e submódulo de Testes.
--
-- 1) atende_24h: quando ligado, o bot responde sempre, ignorando dias da semana
--    e faixa de horário. Antes só dava para chegar perto disso marcando os 7
--    dias e 00:00–23:59, o que ainda deixava uma janela morta e era confuso.
--
-- 2) Menu 'whatsapp_testes': simulador que roda a mesma lógica do atendimento
--    real sem enviar nada pelo WhatsApp e sem gravar na Caixa de Entrada.
--    Fechado por padrão, como o resto do módulo.

-- 1) Atendimento 24 horas -------------------------------------------------
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS atende_24h boolean NOT NULL DEFAULT false;

-- 2) Menu do submódulo de Testes ------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_testes', 'WhatsApp — Testes', '/app/whatsapp/testes', 3
  FROM public.app_modulo m
 WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 3) RLS: quem tem 'whatsapp_testes' precisa ler a config e a base de
--    conhecimento para o simulador funcionar (somente leitura).
DROP POLICY IF EXISTS wa_bot_config_select ON public."WA_BOT_CONFIG";
CREATE POLICY wa_bot_config_select ON public."WA_BOT_CONFIG" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    OR public.tem_acesso_menu('whatsapp_chatbot')
    OR public.tem_acesso_menu('whatsapp_testes')
  );

DROP POLICY IF EXISTS wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO";
CREATE POLICY wa_bot_conh_select ON public."WA_BOT_CONHECIMENTO" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    OR public.tem_acesso_menu('whatsapp_chatbot')
    OR public.tem_acesso_menu('whatsapp_testes')
  );

NOTIFY pgrst, 'reload schema';

-- ===== 20260816000001_whatsapp_bot_fluxo_menu =====
-- WhatsApp — fluxo único guiado por menu.
-- Toda conversa começa pelo menu; a IA só entra pela opção de atendimento por
-- IA. Remove dois restos que deixaram de ter efeito:
--   1) saudacao (o bot não a usava mais — quem abre é a mensagem do menu);
--   2) menu.ativo dentro do JSON (o menu não é mais opcional).
-- Idempotente.

ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS saudacao;

UPDATE public."WA_BOT_CONFIG"
   SET menu = menu - 'ativo'
 WHERE menu ? 'ativo';

NOTIFY pgrst, 'reload schema';

-- ===== 20260816000002_formularios_planos_lideranca_concluir =====
-- Líder de setor pode concluir plano de ação do seu setor.
-- Estende a RLS de CS_FORM_PLANOS_ACAO com o ramo cs_form_lidera_setor
-- (setor efetivo = setor da resposta de origem, senão o próprio). DELETE
-- continua só 'ver_tudo'. Autossuficiente: recria a dependência
-- cs_form_lidera_setor + tabelas antes de usá-la. Idempotente.

-- Dependência (idempotente): líder por setor
CREATE TABLE IF NOT EXISTS public."CS_LIDERES_SETOR" (
  setor              text PRIMARY KEY,
  empregado_id       bigint NOT NULL,
  empregado_nome     text,
  observacao         text,
  definido_por       uuid DEFAULT auth.uid(),
  definido_por_nome  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."CS_LIDERES_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_LIDERES_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_LIDERES_SETOR" TO authenticated;
DROP POLICY IF EXISTS cs_lideres_select ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_select ON public."CS_LIDERES_SETOR"
  FOR SELECT TO authenticated USING (public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias'));
DROP POLICY IF EXISTS cs_lideres_ins ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_ins ON public."CS_LIDERES_SETOR"
  FOR INSERT TO authenticated WITH CHECK (public.cs_form_cap('ver_tudo'));
DROP POLICY IF EXISTS cs_lideres_upd ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_upd ON public."CS_LIDERES_SETOR"
  FOR UPDATE TO authenticated USING (public.cs_form_cap('ver_tudo'));
DROP POLICY IF EXISTS cs_lideres_del ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_del ON public."CS_LIDERES_SETOR"
  FOR DELETE TO authenticated USING (public.cs_form_cap('ver_tudo'));

CREATE TABLE IF NOT EXISTS public."RH_SETOR_DIRETOR" (
  setor          text PRIMARY KEY,
  diretor_id     bigint NOT NULL,
  diretor_nome   text,
  definido_por   uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."RH_SETOR_DIRETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_SETOR_DIRETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RH_SETOR_DIRETOR" TO authenticated;
DROP POLICY IF EXISTS rh_setor_diretor_all ON public."RH_SETOR_DIRETOR";
CREATE POLICY rh_setor_diretor_all ON public."RH_SETOR_DIRETOR"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.cs_form_lidera_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid()
       AND (
         EXISTS (SELECT 1 FROM public."CS_LIDERES_SETOR" l
                  WHERE l.empregado_id = e."ID"
                    AND upper(btrim(l.setor)) = upper(btrim(_setor)))
      OR EXISTS (SELECT 1 FROM public."RH_SETOR_DIRETOR" d
                  WHERE d.diretor_id = e."ID"
                    AND upper(btrim(d.setor)) = upper(btrim(_setor)))
       ));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) TO authenticated;

-- Feature: setor efetivo do plano + políticas
CREATE OR REPLACE FUNCTION public.cs_form_plano_setor(_setor text, _resposta_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.setor FROM public."CS_FORM_RESPOSTAS" r WHERE r.id = _resposta_id),
    NULLIF(btrim(_setor), '')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_plano_setor(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_plano_setor(text, uuid) TO authenticated;

DROP POLICY IF EXISTS cs_planos_select ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_select ON public."CS_FORM_PLANOS_ACAO"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

DROP POLICY IF EXISTS cs_planos_insert ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_insert ON public."CS_FORM_PLANOS_ACAO"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias')
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

DROP POLICY IF EXISTS cs_planos_update ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_update ON public."CS_FORM_PLANOS_ACAO"
  FOR UPDATE TO authenticated
  USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)))
  WITH CHECK (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

NOTIFY pgrst, 'reload schema';

-- ===== 20260731000001_whatsapp_pastas =====
-- WhatsApp — pastas (filas) de atendimento.
--
-- A Caixa de Entrada deixa de ser uma lista única: cada conversa pode ficar numa
-- pasta (RH, Recrutamento, SST, Compras, Jurídico) e cada pessoa só enxerga as
-- pastas que lhe foram liberadas. Quem tem "Todas as conversas" vê tudo,
-- inclusive o que ainda não foi direcionado.
--
-- PERMISSÃO: não existe modelo novo. Cada pasta é uma linha em `app_menu` sob o
-- módulo 'whatsapp', com rota NULL (não vira item de menu lateral — a Sidebar é
-- montada a partir de rotas). Com isso ela aparece sozinha na cascata de
-- Administração › Acesso por Usuário, embaixo do WhatsApp, e `tem_acesso_menu`
-- passa a valer para a RLS sem nenhuma tabela de permissão adicional.

-- 1) Pastas --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_PASTA" (
  codigo       text PRIMARY KEY,              -- rh, recrutamento, ... (sem acento/espaço)
  nome         text NOT NULL,                 -- rótulo exibido
  menu_codigo  text NOT NULL UNIQUE,          -- app_menu.codigo que governa quem vê a pasta
  ordem        integer NOT NULL DEFAULT 0,
  ativo        boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem) VALUES
  ('rh',           'RH',           'whatsapp_pasta_rh',           1),
  ('recrutamento', 'Recrutamento', 'whatsapp_pasta_recrutamento', 2),
  ('sst',          'SST',          'whatsapp_pasta_sst',          3),
  ('compras',      'Compras',      'whatsapp_pasta_compras',      4),
  ('juridico',     'Jurídico',     'whatsapp_pasta_juridico',     5)
ON CONFLICT (codigo) DO NOTHING;

-- 2) A conversa mora numa pasta (NULL = ainda não direcionada) -----------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS pasta_codigo text REFERENCES public."WA_PASTA"(codigo) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_conversa_pasta
  ON public."WA_CONVERSA"(pasta_codigo, ultima_mensagem_em DESC NULLS LAST);

-- 3) Menus de permissão (rota NULL de propósito) --------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, v.codigo, v.nome, NULL, v.ordem
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('whatsapp_todas',             'WhatsApp — Todas as conversas', 10),
    ('whatsapp_pasta_rh',          'WhatsApp — Pasta RH',           11),
    ('whatsapp_pasta_recrutamento','WhatsApp — Pasta Recrutamento', 12),
    ('whatsapp_pasta_sst',         'WhatsApp — Pasta SST',          13),
    ('whatsapp_pasta_compras',     'WhatsApp — Pasta Compras',      14),
    ('whatsapp_pasta_juridico',    'WhatsApp — Pasta Jurídico',     15)
  ) AS v(codigo, nome, ordem)
 WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 4) Não tirar acesso de quem já tinha -----------------------------------
-- Antes desta migration, quem enxergava o menu 'whatsapp' via TODAS as conversas.
-- Sem este passo, ligar o recorte por pasta deixaria todo mundo com a caixa
-- vazia até alguém reconfigurar na mão. Então quem já tinha o módulo ganha
-- 'whatsapp_todas' — o recorte por pasta passa a ser opt-in (basta retirar
-- 'Todas as conversas' de quem deve ver só a sua fila).
-- `empresa_id IS NULL` não colide no UNIQUE (NULL <> NULL no Postgres), por isso
-- NOT EXISTS em vez de ON CONFLICT.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'whatsapp_todas', 'visualizar'::public.app_acao, true, NULL,
       'Migração das pastas do WhatsApp: preserva o acesso que já existia'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'whatsapp' AND s.acao = 'visualizar'
   AND s.allow = true AND s.empresa_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user t
      WHERE t.user_id = s.user_id AND t.menu_codigo = 'whatsapp_todas'
        AND t.acao = 'visualizar' AND t.empresa_id IS NULL
   );

-- 5) Quem enxerga qual pasta ---------------------------------------------
-- 'Todas as conversas' cobre tudo, inclusive pasta NULL (a fila de triagem, que
-- precisa de alguém olhando). Sem ela, só as pastas liberadas uma a uma.
CREATE OR REPLACE FUNCTION public.wa_pode_ver_pasta(_pasta text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('whatsapp_todas')
      OR EXISTS (
           SELECT 1 FROM public."WA_PASTA" p
            WHERE p.codigo = _pasta
              AND public.tem_acesso_menu(p.menu_codigo)
         );
$$;
REVOKE ALL ON FUNCTION public.wa_pode_ver_pasta(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pode_ver_pasta(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pode_ver_pasta(text) TO authenticated;

-- 6) RLS: conversa e mensagem passam a respeitar a pasta ------------------
DROP POLICY IF EXISTS wa_conversa_rw ON public."WA_CONVERSA";
CREATE POLICY wa_conversa_rw ON public."WA_CONVERSA" FOR ALL TO authenticated
  USING (public.tem_acesso_menu('whatsapp') AND public.wa_pode_ver_pasta(pasta_codigo))
  WITH CHECK (public.tem_acesso_menu('whatsapp') AND public.wa_pode_ver_pasta(pasta_codigo));

DROP POLICY IF EXISTS wa_mensagem_rw ON public."WA_MENSAGEM";
CREATE POLICY wa_mensagem_rw ON public."WA_MENSAGEM" FOR ALL TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  )
  WITH CHECK (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- O contato é dado de apoio (nome/telefone) e continua valendo o módulo: sem ele
-- a lista de conversas não teria como mostrar de quem é cada conversa.

-- 7) Catálogo de pastas: todo mundo do módulo lê; só admin escreve --------
ALTER TABLE public."WA_PASTA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WA_PASTA" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."WA_PASTA" TO authenticated;

DROP POLICY IF EXISTS wa_pasta_select ON public."WA_PASTA";
CREATE POLICY wa_pasta_select ON public."WA_PASTA" FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('whatsapp') OR public.tem_acesso_menu('whatsapp_chatbot'));

-- Escrita só pela RPC (SECURITY DEFINER), que também cria/remove o app_menu.
DROP POLICY IF EXISTS wa_pasta_admin ON public."WA_PASTA";
CREATE POLICY wa_pasta_admin ON public."WA_PASTA" FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8) Criar/remover pasta -------------------------------------------------
-- Cria a pasta E o app_menu que a governa, numa transação só: pasta sem menu
-- seria invisível para todo mundo (ninguém teria como receber a permissão).
CREATE OR REPLACE FUNCTION public.wa_pasta_criar(_nome text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_codigo text;
  v_menu   text;
  v_modulo uuid;
  v_ordem  integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Somente administradores podem criar pastas.';
  END IF;

  v_codigo := regexp_replace(
                lower(translate(btrim(coalesce(_nome, '')),
                      'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
                      'aaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuucc')),
                '[^a-z0-9]+', '_', 'g');
  v_codigo := btrim(v_codigo, '_');
  IF v_codigo = '' THEN
    RAISE EXCEPTION 'Informe um nome válido para a pasta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."WA_PASTA" WHERE codigo = v_codigo) THEN
    RAISE EXCEPTION 'Já existe uma pasta com esse nome.';
  END IF;

  v_menu := 'whatsapp_pasta_' || v_codigo;
  SELECT id INTO v_modulo FROM public.app_modulo WHERE codigo = 'whatsapp';
  IF v_modulo IS NULL THEN
    RAISE EXCEPTION 'Módulo whatsapp não encontrado.';
  END IF;
  SELECT coalesce(max(ordem), 15) + 1 INTO v_ordem FROM public."WA_PASTA";

  INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem)
  VALUES (v_codigo, btrim(_nome), v_menu, v_ordem);

  INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
  VALUES (v_modulo, v_menu, 'WhatsApp — Pasta ' || btrim(_nome), NULL, v_ordem)
  ON CONFLICT (modulo_id, codigo) DO NOTHING;

  RETURN v_codigo;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_pasta_criar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pasta_criar(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pasta_criar(text) TO authenticated;

-- Remover a pasta solta as conversas dela (voltam para a triagem) e apaga o
-- menu junto — senão sobraria uma permissão órfã na tela de acesso.
CREATE OR REPLACE FUNCTION public.wa_pasta_remover(_codigo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_menu text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Somente administradores podem remover pastas.';
  END IF;
  SELECT menu_codigo INTO v_menu FROM public."WA_PASTA" WHERE codigo = _codigo;
  IF v_menu IS NULL THEN RETURN; END IF;

  UPDATE public."WA_CONVERSA" SET pasta_codigo = NULL WHERE pasta_codigo = _codigo;
  DELETE FROM public."WA_PASTA" WHERE codigo = _codigo;
  DELETE FROM public.screen_permission_user WHERE menu_codigo = v_menu;
  DELETE FROM public.app_menu a
   USING public.app_modulo m
   WHERE a.modulo_id = m.id AND m.codigo = 'whatsapp' AND a.codigo = v_menu;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_pasta_remover(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_pasta_remover(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_pasta_remover(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ===== 20260817000001_chamados_dashboard_menu =====
-- =====================================================================
-- CHAMADOS DE SISTEMAS — menu do "Dashboard de Chamados" (painel de TV).
-- Tela nova (resumo por desenvolvedor: fila, prioridades e estrelas). Só
-- registra a rota em app_menu para ela aparecer em Administração →
-- Módulos & Menus → "Acesso por Usuário"; o conteúdo em si já é protegido
-- pela RLS de CHAMADO_SISTEMA (gestão) e pelo guard da tela.
-- Idempotente.
-- =====================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_dashboard', 'Chamados — Dashboard de Chamados',
       '/app/sistemas/chamados/dashboard-tv', 16
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- A rota mudou depois da primeira versão desta migration: o ON CONFLICT acima
-- não corrige quem já rodou a anterior, então acerta explicitamente.
UPDATE public.app_menu a
   SET rota = '/app/sistemas/chamados/dashboard-tv'
  FROM public.app_modulo m
 WHERE a.modulo_id = m.id AND m.codigo = 'sistemas'
   AND a.codigo = 'chamados_sistemas_dashboard'
   AND a.rota IS DISTINCT FROM '/app/sistemas/chamados/dashboard-tv';

NOTIFY pgrst, 'reload schema';

-- ===== 20260817000002_chamados_dashboard_leitura =====
-- =====================================================================
-- CHAMADOS DE SISTEMAS — quem tem só o Dashboard de Chamados (painel de TV)
-- precisa ENXERGAR os chamados.
--
-- O código novo `chamados_sistemas_dashboard` não fazia parte de
-- chamado_sistema_gestor() (painel OR coordenar OR aprovar), então liberar o
-- menu não bastava: a tela caía no "acesso negado" e, mesmo passando pelo
-- guard, a RLS devolveria lista vazia.
--
-- Não dá para simplesmente somar o código dentro de chamado_sistema_gestor():
-- essa função também governa UPDATE/DELETE, tarefas e coordenação — quem
-- assiste à TV ganharia permissão de ESCRITA junto.
--
-- Por isso entra uma segunda função, só de LEITURA:
--   chamado_sistema_pode_ver_todos() = gestor OR dashboard
-- usada apenas nas policies de SELECT e na RPC que lista os desenvolvedores.
-- Escrita continua exclusivamente com chamado_sistema_gestor().
--
-- Idempotente. Aplicar DEPOIS de 20260817000001.
-- =====================================================================

-- 1) Predicado de leitura ampla -----------------------------------------
CREATE OR REPLACE FUNCTION public.chamado_sistema_pode_ver_todos()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.chamado_sistema_gestor()
      OR public.tem_acesso_menu('chamados_sistemas_dashboard');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_sistema_pode_ver_todos() FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_pode_ver_todos() TO authenticated;

-- 2) SELECT dos chamados (só o SELECT; update/delete seguem com gestor) --
DROP POLICY IF EXISTS chamado_sistema_select ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_select ON public."CHAMADO_SISTEMA"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.chamado_sistema_pode_ver_todos()
  );

-- 3) SELECT das avaliações (o painel mostra a média em estrelas) ---------
DROP POLICY IF EXISTS chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO";
CREATE POLICY chamado_avaliacao_select ON public."CHAMADO_SISTEMA_AVALIACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.chamado_sistema_pode_ver_todos())));

-- 4) Lista de desenvolvedores (um card por dev no painel) ----------------
-- Mesma definição de 20260802000003, trocando só o predicado de acesso.
CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public."CHAMADO_SISTEMA" c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.chamado_sistema_pode_ver_todos()
    AND EXISTS (
      SELECT 1
        FROM unnest(ARRAY['chamados_sistemas_dev','sistemas_desenvolvedores']) AS cod
       WHERE COALESCE(
               -- exceção individual (Acesso por Usuário), a mais recente vence
               (SELECT s.allow
                  FROM public.screen_permission_user s
                 WHERE s.user_id = p.id
                   AND s.menu_codigo = cod
                   AND s.acao = 'visualizar'::public.app_acao
                 ORDER BY s.updated_at DESC
                 LIMIT 1),
               -- senão, união dos perfis de acesso do usuário
               EXISTS (SELECT 1
                         FROM public.usuario_perfil_acesso upa
                         JOIN public.perfil_acesso pa
                           ON pa.id = upa.perfil_id AND pa.ativo = true
                         JOIN public.perfil_acesso_permissao pap
                           ON pap.perfil_id = pa.id AND pap.allow = true
                        WHERE upa.user_id = p.id
                          AND pap.menu_codigo = cod
                          AND pap.acao = 'visualizar'::public.app_acao)
             ) IS TRUE
    )
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM anon;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000001_whatsapp_retomada =====
-- =====================================================================
-- WHATSAPP — retomada (cutucar quem não respondeu) + anti-repetição
--
-- Dois problemas do bot hoje:
--
-- 1) REPETIÇÃO: em modo menu, QUALQUER texto solto reapresenta o menu raiz
--    (whatsapp-bot.ts, rota "menu"). Quem escreve três vezes seguidas recebe
--    a saudação inteira três vezes. Passa a existir uma janela em minutos
--    (WA_BOT_CONFIG.nao_repetir_menu_min): dentro dela o menu não se repete.
--
-- 2) SILÊNCIO: não havia como cutucar quem parou de responder. Cada opção do
--    menu ganha um `retomada` no próprio jsonb ({minutos, mensagem}) e o que
--    for agendado cai nesta fila, processada pelo cron.
--
-- Por que uma tabela em vez de calcular na hora: a cutucada é um evento
-- ÚNICO por resposta, precisa sobreviver a reinício e não pode disparar duas
-- vezes. Estado explícito com status é o que dá idempotência.
--
-- ⚠ Janela de 24h: cutucada é mensagem iniciada pelo negócio. Fora das 24h da
-- última mensagem do contato a Meta recusa (erro 131047), então o tick marca
-- 'expirada' em vez de enfileirar uma falha. Por isso o teto de 1440 min.
--
-- Idempotente.
-- ROLLBACK:
--   SELECT cron.unschedule('whatsapp-retomada-tick');
--   DROP TABLE IF EXISTS public."WA_RETOMADA";
--   ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS nao_repetir_menu_min;
-- =====================================================================

-- 1) Anti-repetição do menu ---------------------------------------------
-- 0 = desligado (repete sempre, comportamento antigo). Padrão 720 = 12h.
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS nao_repetir_menu_min int NOT NULL DEFAULT 720;

COMMENT ON COLUMN public."WA_BOT_CONFIG".nao_repetir_menu_min IS
  'Minutos em que o menu/saudação não se repete para a mesma conversa. 0 desliga.';

-- 2) Fila de retomadas ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public."WA_RETOMADA" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id  uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  contato_id   uuid NOT NULL REFERENCES public."WA_CONTATO"(id) ON DELETE CASCADE,
  opcao_id     text,                      -- opção do menu que agendou (rastro)
  mensagem     text NOT NULL,
  enviar_em    timestamptz NOT NULL,
  -- pendente → enviada | cancelada (a pessoa respondeu / humano assumiu)
  --                    | expirada  (passou das 24h, a Meta recusaria)
  status       text NOT NULL DEFAULT 'pendente',
  detalhe      text,
  criada_em    timestamptz NOT NULL DEFAULT now(),
  processada_em timestamptz
);

-- O tick varre por (status, enviar_em); o cancelamento varre por conversa.
CREATE INDEX IF NOT EXISTS wa_retomada_fila_idx
  ON public."WA_RETOMADA" (status, enviar_em) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS wa_retomada_conversa_idx
  ON public."WA_RETOMADA" (conversa_id) WHERE status = 'pendente';

-- 3) RLS: mesma regra da conversa (quem enxerga a pasta enxerga a fila) ---
ALTER TABLE public."WA_RETOMADA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_retomada_rw ON public."WA_RETOMADA";
CREATE POLICY wa_retomada_rw ON public."WA_RETOMADA" FOR ALL TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  )
  WITH CHECK (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- 4) Cron a cada 5 min ---------------------------------------------------
-- Nada de chave literal aqui. Os outros crons do projeto colam a anon key no
-- comando; ela é publicável (já vai no bundle do front), mas repetida em
-- várias migrations vira dívida: rotacionar exigiria caçar todas, e o valor
-- fica no histórico do git para sempre — num repositório público, ainda por
-- cima. Aqui o comando lê do Vault.
--
-- Além disso o tick exige `x-tick-secret`. A anon key NÃO serve de tranca:
-- qualquer pessoa a tem, então sem esse cabeçalho qualquer um poderia forçar
-- o processamento da fila de cutucadas. O mesmo segredo está nos secrets da
-- edge function (WHATSAPP_TICK_SECRET).
--
-- Pré-requisito (uma vez, fora do versionamento — são segredos):
--   SELECT vault.create_secret('<anon key>', 'anon_key', '...');
--   SELECT vault.create_secret('<aleatorio>', 'whatsapp_tick_secret', '...');
--   supabase secrets set WHATSAPP_TICK_SECRET=<o mesmo aleatorio>
DO $$
BEGIN
  PERFORM cron.unschedule('whatsapp-retomada-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'whatsapp-retomada-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/whatsapp-retomada-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
      'x-tick-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'whatsapp_tick_secret')
    ),
    body := jsonb_build_object('tick_at', now())
  );
  $$
);

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000002_whatsapp_midia_saida =====
-- =====================================================================
-- WHATSAPP — anexos ENVIADOS pelo atendente (print colado, arquivo)
--
-- O bucket whatsapp-midia só tinha policy de SELECT ("wa midia select"):
-- servia pra mostrar a mídia RECEBIDA, que quem grava é o webhook com
-- service_role. Para o atendente enviar, o navegador precisa escrever no
-- bucket — daí a policy de INSERT.
--
-- Por que o navegador sobe direto em vez de mandar o arquivo pra edge
-- function: base64 dentro do JSON incha ~33% e estoura o limite de corpo da
-- requisição num print grande. O front sobe pro storage, manda só o caminho,
-- e a function (service_role) baixa e repassa pra Graph API.
--
-- Mesma regra da leitura: quem tem o menu 'whatsapp' pode escrever. O caminho
-- é sempre 'saida/<conversa_id>/...', separado da mídia recebida.
--
-- Idempotente.
-- ROLLBACK: DROP POLICY IF EXISTS "wa midia insert" ON storage.objects;
-- =====================================================================

DROP POLICY IF EXISTS "wa midia insert" ON storage.objects;
CREATE POLICY "wa midia insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-midia'
    AND public.tem_acesso_menu('whatsapp')
    AND (storage.foldername(name))[1] = 'saida'
  );

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000003_whatsapp_dashboard =====
-- =====================================================================
-- WHATSAPP — pasta "Atendimento Concluído" + Dashboard do chatbot
--
-- 1) A pasta é criada direto (e não por wa_pasta_criar): aquela RPC exige
--    has_role(auth.uid(),'admin') e no SQL Editor auth.uid() é NULL, então
--    ela sempre falharia aqui. O efeito é o mesmo: pasta + menu que a governa.
--
-- 2) WA_CONVERSA.concluida_em: sem um marco de "terminou", não existe tempo
--    de atendimento para medir. Preenchido por trigger quando a conversa cai
--    na pasta de concluídos, e zerado se ela sair de lá (reabertura) — assim
--    o número não depende de ninguém lembrar de marcar nada.
--
-- 3) wa_dashboard_metricas(): tudo agregado no banco numa chamada só. Fazer
--    isso no front exigiria baixar a tabela inteira de mensagens.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.wa_dashboard_metricas(date, date);
--   DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
--   DROP FUNCTION IF EXISTS public.wa_marca_conclusao();
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS concluida_em;
--   (a pasta sai por Chatbot › Pastas de atendimento)
-- =====================================================================

-- 1) Pasta de concluídos + permissão -------------------------------------
INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem)
SELECT 'atendimento_concluido', 'Atendimento Concluído',
       'whatsapp_pasta_atendimento_concluido',
       coalesce((SELECT max(ordem) FROM public."WA_PASTA"), 15) + 1
WHERE NOT EXISTS (SELECT 1 FROM public."WA_PASTA" WHERE codigo = 'atendimento_concluido');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_pasta_atendimento_concluido',
       'WhatsApp — Pasta Atendimento Concluído', NULL,
       coalesce((SELECT max(ordem) FROM public."WA_PASTA"), 16)
  FROM public.app_modulo m WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Menu da tela nova de dashboard.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_dashboard', 'WhatsApp — Dashboard',
       '/app/whatsapp/dashboard', 5
  FROM public.app_modulo m WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET rota = EXCLUDED.rota, nome = EXCLUDED.nome;

-- 2) Marco de conclusão ---------------------------------------------------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS concluida_em timestamptz;

CREATE OR REPLACE FUNCTION public.wa_marca_conclusao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.pasta_codigo IS DISTINCT FROM OLD.pasta_codigo THEN
    IF NEW.pasta_codigo = 'atendimento_concluido' THEN
      NEW.concluida_em := coalesce(NEW.concluida_em, now());
    ELSE
      -- Saiu dos concluídos: voltou a ser atendimento aberto.
      NEW.concluida_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_concluida
  BEFORE UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_marca_conclusao();

-- 3) Métricas -------------------------------------------------------------
-- SECURITY DEFINER porque agrega TODAS as conversas: a RLS por pasta faria o
-- número mudar conforme quem olha, e um indicador que muda por espectador não
-- serve para nada. O acesso é decidido pelo menu do dashboard.
CREATE OR REPLACE FUNCTION public.wa_dashboard_metricas(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_de  timestamptz := coalesce(_de, (now() - interval '30 days')::date);
  v_ate timestamptz := coalesce(_ate::timestamptz + interval '1 day', now() + interval '1 day');
  v_res jsonb;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp_dashboard') AND NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'Sem acesso ao dashboard do WhatsApp.';
  END IF;

  WITH msg AS (
    SELECT * FROM public."WA_MENSAGEM" WHERE criada_em >= v_de AND criada_em < v_ate
  ),
  -- Primeira mensagem do contato e primeira resposta nossa, por conversa.
  ciclo AS (
    SELECT c.id, c.pasta_codigo, c.concluida_em,
           (SELECT min(m.criada_em) FROM msg m WHERE m.conversa_id = c.id AND m.direcao = 'entrada') AS inicio,
           (SELECT min(m.criada_em) FROM msg m WHERE m.conversa_id = c.id AND m.direcao = 'saida'
              AND m.origem = 'atendente') AS primeira_humana
      FROM public."WA_CONVERSA" c
     WHERE EXISTS (SELECT 1 FROM msg m WHERE m.conversa_id = c.id)
  )
  SELECT jsonb_build_object(
    'pessoas',           (SELECT count(DISTINCT contato_id) FROM msg WHERE direcao = 'entrada'),
    'conversas',         (SELECT count(*) FROM ciclo),
    'concluidas',        (SELECT count(*) FROM ciclo WHERE concluida_em IS NOT NULL),
    'recebidas',         (SELECT count(*) FROM msg WHERE direcao = 'entrada'),
    'enviadas_bot',      (SELECT count(*) FROM msg WHERE direcao = 'saida' AND origem = 'bot'),
    'enviadas_humano',   (SELECT count(*) FROM msg WHERE direcao = 'saida' AND origem = 'atendente'),
    'falhas',            (SELECT count(*) FROM msg WHERE status = 'erro'),
    -- Minutos entre a primeira mensagem da pessoa e a conclusão.
    'tempo_medio_min',   (SELECT round(avg(EXTRACT(epoch FROM (concluida_em - inicio)) / 60)::numeric, 1)
                            FROM ciclo WHERE concluida_em IS NOT NULL AND inicio IS NOT NULL
                                         AND concluida_em > inicio),
    -- Quanto a pessoa espera até um humano falar (o bot responde na hora).
    'primeira_resposta_min', (SELECT round(avg(EXTRACT(epoch FROM (primeira_humana - inicio)) / 60)::numeric, 1)
                            FROM ciclo WHERE primeira_humana IS NOT NULL AND inicio IS NOT NULL
                                         AND primeira_humana > inicio),
    'atendidas_por_humano', (SELECT count(*) FROM ciclo WHERE primeira_humana IS NOT NULL),
    'por_pasta', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'nome')
        FROM (
          SELECT jsonb_build_object(
                   'codigo', coalesce(ci.pasta_codigo, '(sem pasta)'),
                   'nome',   coalesce(p.nome, 'Sem pasta — triagem'),
                   'conversas', count(*),
                   'concluidas', count(*) FILTER (WHERE ci.concluida_em IS NOT NULL),
                   'tempo_medio_min', round(avg(EXTRACT(epoch FROM (ci.concluida_em - ci.inicio)) / 60)
                                            FILTER (WHERE ci.concluida_em IS NOT NULL AND ci.inicio IS NOT NULL)::numeric, 1)
                 ) AS x
            FROM ciclo ci
            LEFT JOIN public."WA_PASTA" p ON p.codigo = ci.pasta_codigo
           GROUP BY ci.pasta_codigo, p.nome
        ) t), '[]'::jsonb),
    'por_dia', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'dia')
        FROM (
          SELECT jsonb_build_object(
                   'dia', to_char(date_trunc('day', criada_em), 'YYYY-MM-DD'),
                   'recebidas', count(*) FILTER (WHERE direcao = 'entrada'),
                   'enviadas',  count(*) FILTER (WHERE direcao = 'saida')
                 ) AS x
            FROM msg GROUP BY date_trunc('day', criada_em)
        ) t), '[]'::jsonb),
    'por_hora', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'hora')::int)
        FROM (
          SELECT jsonb_build_object(
                   'hora', EXTRACT(hour FROM criada_em)::int,
                   'mensagens', count(*)
                 ) AS x
            FROM msg WHERE direcao = 'entrada'
           GROUP BY EXTRACT(hour FROM criada_em)
        ) t), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_dashboard_metricas(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_dashboard_metricas(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_dashboard_metricas(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000004_whatsapp_conclusao_historico =====
-- =====================================================================
-- WHATSAPP — quem concluiu o atendimento fica no histórico da conversa
--
-- "Concluído" hoje é só a conversa mudar de pasta: some da fila e ninguém
-- sabe quem encerrou nem quando. Passa a existir um registro no meio da
-- própria thread, que é onde a pergunta aparece ("por que isso foi fechado?").
--
-- Duas origens possíveis, e a distinção importa:
--   - ATENDENTE: alguém moveu a conversa para a pasta pela Caixa de Entrada;
--   - CONTATO: a própria pessoa clicou numa opção "concluir" no menu do bot.
--
-- Como o trigger sabe qual é qual: pela Caixa de Entrada existe auth.uid()
-- (sessão do atendente); pelo webhook não existe (roda com service_role), e
-- por isso o webhook marca `concluida_por_contato` explicitamente em vez de
-- deixar o trigger adivinhar pela ausência de sessão — ausência de sessão
-- também aconteceria num UPDATE manual pelo SQL Editor.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS concluida_por,
--     DROP COLUMN IF EXISTS concluida_por_contato;
--   (recriar wa_marca_conclusao da 20260819000003)
-- =====================================================================

-- 1) Mensagem de sistema no histórico ------------------------------------
-- A thread só aceitava contato/bot/atendente. O registro de conclusão não é
-- nenhum dos três: não foi enviado a ninguém, é um evento da conversa.
ALTER TABLE public."WA_MENSAGEM" DROP CONSTRAINT IF EXISTS "WA_MENSAGEM_origem_check";
ALTER TABLE public."WA_MENSAGEM"
  ADD CONSTRAINT "WA_MENSAGEM_origem_check"
  CHECK (origem IN ('contato','bot','atendente','sistema'));

-- 2) Quem concluiu --------------------------------------------------------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS concluida_por uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS concluida_por_contato boolean NOT NULL DEFAULT false;

-- 3) Trigger: carimba o marco e escreve a linha no histórico ---------------
CREATE OR REPLACE FUNCTION public.wa_marca_conclusao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_texto text;
BEGIN
  IF NEW.pasta_codigo IS NOT DISTINCT FROM OLD.pasta_codigo THEN
    RETURN NEW;
  END IF;

  IF NEW.pasta_codigo = 'atendimento_concluido' THEN
    NEW.concluida_em := coalesce(NEW.concluida_em, now());
    NEW.concluida_por := CASE WHEN NEW.concluida_por_contato THEN NULL ELSE v_uid END;

    IF NEW.concluida_por_contato THEN
      v_texto := 'Atendimento concluído pelo próprio contato.';
    ELSIF v_uid IS NOT NULL THEN
      SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
      v_texto := 'Atendimento concluído por ' || coalesce(nullif(btrim(v_nome), ''), 'um atendente') || '.';
    ELSE
      v_texto := 'Atendimento concluído.';
    END IF;
  ELSE
    -- Saiu dos concluídos: voltou a ser atendimento aberto.
    IF OLD.pasta_codigo = 'atendimento_concluido' THEN
      SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
      v_texto := 'Atendimento reaberto'
                 || coalesce(' por ' || nullif(btrim(v_nome), ''), '') || '.';
    END IF;
    NEW.concluida_em := NULL;
    NEW.concluida_por := NULL;
    NEW.concluida_por_contato := false;
  END IF;

  IF v_texto IS NOT NULL THEN
    -- direcao 'saida' porque a coluna não aceita neutro; o que define o
    -- desenho na tela é origem='sistema', que a Caixa de Entrada centraliza.
    INSERT INTO public."WA_MENSAGEM"
      (conversa_id, contato_id, direcao, tipo, texto, status, origem, autor_id)
    VALUES
      (NEW.id, NEW.contato_id, 'saida', 'sistema', v_texto, 'enviada', 'sistema', v_uid);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_concluida
  BEFORE UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_marca_conclusao();

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000005_whatsapp_historico =====
-- =====================================================================
-- WHATSAPP — histórico de interações da conversa
--
-- Hoje só sobra rastro do que virou mensagem. Mover de pasta, ligar/desligar
-- o bot e reagir não deixam registro nenhum: a conversa muda de fila e não há
-- como saber quem fez, nem quando. Esta migration cria o livro-caixa.
--
-- O que NÃO entra aqui: as mensagens. Elas já estão em WA_MENSAGEM com autor,
-- e duplicá-las como evento criaria duas versões da mesma verdade, que
-- divergem no primeiro apagamento. A tela junta as duas fontes na hora.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_wa_conversa_evento ON public."WA_CONVERSA";
--   DROP FUNCTION IF EXISTS public.wa_registra_evento();
--   DROP TABLE IF EXISTS public."WA_EVENTO";
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."WA_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public."WA_CONVERSA"(id) ON DELETE CASCADE,
  -- pasta | bot | conclusao | reabertura | reacao | atendente
  tipo        text NOT NULL,
  ator_id     uuid REFERENCES auth.users(id),   -- null = bot/contato/automação
  -- Texto já pronto para leitura. Guardar montado evita a tela ter que
  -- reconstruir frase a partir de códigos que podem deixar de existir (uma
  -- pasta apagada continua legível no histórico).
  descricao   text NOT NULL,
  detalhe     jsonb,
  criada_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wa_evento_conversa_idx
  ON public."WA_EVENTO" (conversa_id, criada_em DESC);

ALTER TABLE public."WA_EVENTO" ENABLE ROW LEVEL SECURITY;

-- Mesma regra da conversa: quem enxerga a pasta enxerga o histórico dela.
DROP POLICY IF EXISTS wa_evento_select ON public."WA_EVENTO";
CREATE POLICY wa_evento_select ON public."WA_EVENTO" FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('whatsapp')
    AND EXISTS (SELECT 1 FROM public."WA_CONVERSA" c
                 WHERE c.id = conversa_id AND public.wa_pode_ver_pasta(c.pasta_codigo))
  );

-- Escrita só pelo trigger/service_role: histórico que o usuário pode editar
-- não serve como histórico.
DROP POLICY IF EXISTS wa_evento_insert ON public."WA_EVENTO";
CREATE POLICY wa_evento_insert ON public."WA_EVENTO" FOR INSERT TO authenticated
  WITH CHECK (false);

-- Trigger: registra o que mudou na conversa -------------------------------
CREATE OR REPLACE FUNCTION public.wa_registra_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_de   text;
  v_para text;
BEGIN
  SELECT nullif(btrim(display_name), '') INTO v_nome FROM public.profiles WHERE id = v_uid;
  v_nome := coalesce(v_nome, 'Sistema');

  IF NEW.pasta_codigo IS DISTINCT FROM OLD.pasta_codigo THEN
    SELECT nome INTO v_de   FROM public."WA_PASTA" WHERE codigo = OLD.pasta_codigo;
    SELECT nome INTO v_para FROM public."WA_PASTA" WHERE codigo = NEW.pasta_codigo;
    v_de   := coalesce(v_de, 'Sem pasta');
    v_para := coalesce(v_para, 'Sem pasta');

    -- Conclusão e reabertura NÃO viram evento: a 20260819000004 já grava uma
    -- mensagem de sistema para elas, que aparece dentro da conversa E no
    -- histórico. Duplicar aqui mostraria a mesma coisa duas vezes, com
    -- palavras diferentes e o mesmo horário.
    IF NEW.pasta_codigo IS DISTINCT FROM 'atendimento_concluido'
       AND OLD.pasta_codigo IS DISTINCT FROM 'atendimento_concluido' THEN
      INSERT INTO public."WA_EVENTO" (conversa_id, tipo, ator_id, descricao, detalhe)
      VALUES (NEW.id, 'pasta', v_uid, v_nome || ' moveu de "' || v_de || '" para "' || v_para || '"',
              jsonb_build_object('de', v_de, 'para', v_para));
    END IF;
  END IF;

  IF NEW.bot_ativo IS DISTINCT FROM OLD.bot_ativo THEN
    INSERT INTO public."WA_EVENTO" (conversa_id, tipo, ator_id, descricao)
    VALUES (NEW.id, 'bot', v_uid,
            v_nome || CASE WHEN NEW.bot_ativo THEN ' religou o bot' ELSE ' assumiu o atendimento (bot desligado)' END);
  END IF;

  RETURN NULL; -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_evento ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_evento
  AFTER UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_registra_evento();

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000006_whatsapp_menu_atomico =====
-- =====================================================================
-- WHATSAPP — anti-repetição do menu à prova de mensagens simultâneas
--
-- O anti-repetição olhava o histórico ("já mandei o menu nos últimos X
-- minutos?") e só depois decidia. Isso é seguro com uma mensagem por vez, e
-- errado com várias: quem escreve três frases seguidas dispara três execuções
-- concorrentes do webhook, todas leem o histórico ANTES de qualquer menu ser
-- gravado, todas concluem "ainda não mandei" e todas mandam.
--
-- Caso real: 3 mensagens em 36 ms -> o menu saiu 2x.
--
-- A correção é o banco decidir, não a função. `menu_enviado_em` vira um
-- carimbo disputado por um UPDATE condicional: quem consegue atualizar ganhou
-- o direito de enviar; os concorrentes não atualizam nada e ficam quietos.
-- Um UPDATE é atômico, então não existe janela entre "ler" e "decidir".
--
-- Idempotente.
-- ROLLBACK: ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS menu_enviado_em;
-- =====================================================================

ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS menu_enviado_em timestamptz;

COMMENT ON COLUMN public."WA_CONVERSA".menu_enviado_em IS
  'Quando o menu foi apresentado pela última vez. Usado como trava atômica do anti-repeticao (WA_BOT_CONFIG.nao_repetir_menu_min).';

-- Conversas que já receberam o menu antes desta migration não têm carimbo.
-- Semear com a última saída interativa evita o menu sair de novo logo após o
-- deploy, para todo mundo ao mesmo tempo.
UPDATE public."WA_CONVERSA" c
   SET menu_enviado_em = u.ultima
  FROM (
    SELECT conversa_id, max(criada_em) AS ultima
      FROM public."WA_MENSAGEM"
     WHERE direcao = 'saida' AND tipo = 'interactive'
     GROUP BY conversa_id
  ) u
 WHERE u.conversa_id = c.id AND c.menu_enviado_em IS NULL;

NOTIFY pgrst, 'reload schema';


-- ===== 20260819000007_whatsapp_vagas_ia =====
-- =====================================================================
-- WHATSAPP — a IA responde sobre as vagas REAIS do banco
--
-- Hoje o bot só sabe mandar o link do portal. Para responder "tem vaga de
-- porteiro em Porto Alegre?" ela precisa das vagas na mão — e precisa que
-- venham do banco a cada conversa, não da memória do modelo: vaga fechada
-- ontem não pode ser oferecida hoje.
--
-- A RPC devolve SÓ o que pode ser dito a um candidato. A tabela guarda muita
-- coisa interna (CPF do solicitante, motivo da saída de quem estava na vaga,
-- motivo de reprovação, nome do substituído); nada disso sai daqui, senão a
-- IA poderia repetir ao candidato o que leu no contexto.
--
-- Status: 'Vaga aberta - Seleção de Currículos' é o mesmo que o portal de
-- candidaturas usa (BancoTalentos). Qualquer outro status é etapa interna.
--
-- Idempotente.
-- ROLLBACK: DROP FUNCTION IF EXISTS public.wa_vagas_abertas();
-- =====================================================================

-- O que SAI (o candidato pode/deve saber): cargo, local, quantidade, escala,
-- horário, salário, benefícios, insalubridade, requisitos, experiência e
-- início previsto.
--
-- O que NÃO sai, e por quê:
--   contrato              → nome do cliente, informação comercial
--   alta_rotatividade     → julgamento interno; afastaria candidato
--   grau_urgencia         → interno, e vira pressão de negociação
--   motivos_saida         → fala de quem saiu da vaga
--   nome_substituido      → pessoa identificável
--   observacao_importante → campo livre do RH, sem garantia de ser público
--   solicitante_*         → dados de quem abriu a requisição
CREATE OR REPLACE FUNCTION public.wa_vagas_abertas()
RETURNS TABLE(
  id bigint, cargo text, cidade text, estado text, escala text,
  horario text, salario text, beneficios text, quantidade_vagas integer,
  requisitos text, desejaveis text, experiencia text,
  insalubridade text, local_trabalho text, inicio_previsto text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.cargo, r.cidade, r.estado, r.escala,
         r.horario, r.salario, r.beneficios, r.quantidade_vagas,
         r.req_obrigatorios,
         r.req_desejaveis,
         -- "Sim" sozinho não diz nada ao candidato; junta com o "qual".
         CASE WHEN lower(coalesce(r.exp_minima, '')) LIKE 'sim%'
              THEN coalesce(nullif(btrim(r.exp_minima_qual), ''), 'sim')
              ELSE 'não exige' END,
         CASE WHEN lower(coalesce(r.insalubridade_recebe, '')) LIKE 'sim%'
              THEN coalesce(nullif(btrim(r.insalubridade_quanto), ''), 'sim')
              ELSE NULL END,
         r.local_exato,
         r.data_inicio_prevista
    FROM public."SISTEMA_RECRUTAMENTO" r
   WHERE r.status = 'Vaga aberta - Seleção de Currículos'
   ORDER BY r.created_at DESC
   -- Teto alto de propósito: se a lista fosse cortada, a IA responderia "não
   -- temos vaga na sua cidade" com base numa lista incompleta — e essa é a
   -- pergunta mais comum. Hoje são poucas vagas; 200 dá folga de sobra.
   LIMIT 200;
$$;

-- O bot chama com service_role; authenticated pode ler para conferir na tela.
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_vagas_abertas() FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_vagas_abertas() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 20260804000001_jur_processos_hora_local_pericia
-- (JÁ APLICADO no banco do app em 04/08/2026, junto com a carga
--  de 1058 linhas / 390 processos vinda do SISTEMA_JURIDICORT)
-- ============================================================
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "primeira_audiencia_hora" text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "local_pericia" text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "hora_pericia" text;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 20260804000002_jur_processos_id_sequencial
-- (JÁ APLICADO no banco do app em 04/08/2026)
-- Nº sequencial de chegada por processo: 1 = mais antigo, 390 = mais recente.
-- Ver o arquivo da migration para o backfill cronológico completo.
-- ============================================================
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "id_sequencial" bigint;
CREATE INDEX IF NOT EXISTS jur_processos_id_sequencial_idx
    ON public."JUR_PROCESSOS" (id_sequencial DESC);

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000001_central_servicos_agendamento_veiculos =====
-- =====================================================================
-- CENTRAL DE SERVIÇOS — AGENDAMENTO DE VEÍCULOS
--
-- Reserva da frota pelo colaborador: escolhe o veículo, a data e o turno,
-- diz a quais contratos a viagem atende e confirma. O quadro de quem está
-- com o carro em cada dia passa a existir num lugar só.
--
-- DECISÕES QUE VALEM A LEITURA
--
--   1. A FROTA NÃO É NOSSA. Os veículos já vivem em `sup_patrimonio`
--      (categoria = 'veiculo'), cadastrados pelo módulo de Patrimônio. Este
--      módulo NÃO cria, NÃO altera e NÃO apaga nada lá — só lê. Quem diz se
--      o carro está na oficina continua sendo o Patrimônio, pelas colunas
--      `em_manutencao`, `data_inicio_manutencao` e `data_previsao_fim`.
--
--   2. SEM FK PARA sup_patrimonio. `patrimonio_id` é um uuid solto de
--      propósito. Uma FK daqui criaria uma dependência que passaria a
--      recusar DELETE do outro lado — ou seja, este módulo mudaria o
--      comportamento do Patrimônio sem ter tocado numa linha dele. O nome e
--      a placa ficam desnormalizados na reserva, então o histórico continua
--      legível mesmo se o bem for descadastrado depois.
--
--   3. A LEITURA DA FROTA É RPC, NÃO SELECT DIRETO. A policy de SELECT de
--      sup_patrimonio exige can_access('sup_patrimonio'|'sup_manutencao'),
--      que o colaborador comum não tem — e afrouxá-la seria alterar o módulo
--      de Patrimônio. `cs_veiculos_frota()` é SECURITY DEFINER e devolve
--      apenas os campos da frota que a tela precisa, para quem tem o menu
--      desta tela. Nenhuma policy de lá foi tocada.
--
--   4. INDISPONIBILIDADE É REGRA DE BANCO, NÃO DE TELA. O card cinza é
--      cortesia; quem recusa a reserva é o trigger. Dois caminhos levam ao
--      mesmo "não pode": manutenção e choque com outra reserva.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.cs_veiculo_agendamento_log,
--     public.cs_veiculo_agendamento_contrato, public.cs_veiculo_agendamento CASCADE;
--   DROP FUNCTION IF EXISTS public.cs_veiculos_frota(),
--     public.cs_veiculo_motivo_indisponivel(uuid, date, date),
--     public.cs_veic_checar_agendamento(), public.cs_veic_registrar_log();
--   DELETE FROM public.app_menu WHERE codigo LIKE 'central_servicos_veiculos%';
-- =====================================================================

-- ── 1. Menus ─────────────────────────────────────────────────────────
-- O módulo "central_servicos" já existe (20260625000003_modulo_central_servicos).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('central_servicos_veiculos',          'Agendamento de Veículos',      '/app/central-servicos/veiculos', 40),
    -- Quem cuida da frota: enxerga e cancela reserva de qualquer pessoa.
    ('central_servicos_veiculos_gestor',   'Veículos — Gestão da Frota',   NULL,                             41)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. A reserva ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_veiculo_agendamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Número de protocolo, o que o usuário fala no telefone ("o agendamento 42").
  numero        bigint GENERATED BY DEFAULT AS IDENTITY,
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,

  -- Ver decisão 2: sem FK, e com o nome/placa congelados na reserva.
  patrimonio_id         uuid NOT NULL,
  veiculo_nome          text NOT NULL,
  veiculo_identificador text,

  data_inicio   date NOT NULL,
  data_fim      date NOT NULL,
  -- 'dia_todo' é o padrão porque é como a frota realmente é usada; os meios
  -- turnos existem para o caso de dois destinos próximos no mesmo dia.
  turno         text NOT NULL DEFAULT 'dia_todo'
                CHECK (turno IN ('manha', 'tarde', 'dia_todo')),

  destino       text,
  motivo        text,
  observacoes   text,

  status        text NOT NULL DEFAULT 'confirmado'
                CHECK (status IN ('confirmado', 'cancelado', 'concluido')),
  motivo_cancelamento text,

  solicitante_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  solicitante_nome  text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cs_veic_periodo_coerente CHECK (data_fim >= data_inicio),
  -- Cancelamento sem motivo vira mistério três meses depois.
  CONSTRAINT cs_veic_cancelamento_com_motivo CHECK (
    status <> 'cancelado' OR btrim(coalesce(motivo_cancelamento, '')) <> ''
  )
);

CREATE INDEX IF NOT EXISTS idx_cs_veic_agend_veiculo
  ON public.cs_veiculo_agendamento(patrimonio_id, data_inicio, data_fim);
CREATE INDEX IF NOT EXISTS idx_cs_veic_agend_solicitante
  ON public.cs_veiculo_agendamento(solicitante_id, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_cs_veic_agend_periodo
  ON public.cs_veiculo_agendamento(data_inicio, data_fim) WHERE status = 'confirmado';

DROP TRIGGER IF EXISTS trg_cs_veic_agend_updated ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_agend_updated BEFORE UPDATE ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Contratos atendidos pela viagem ───────────────────────────────
-- Tabela filha e não array: a mesma viagem costuma atender vários contratos
-- (é o caso dos prints — "UFFS PASSO FUNDO, UFFS ERECHIM…"), e assim dá para
-- responder "quanto a frota rodou para o contrato X" com um GROUP BY.
CREATE TABLE IF NOT EXISTS public.cs_veiculo_agendamento_contrato (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid NOT NULL REFERENCES public.cs_veiculo_agendamento(id) ON DELETE CASCADE,
  -- SET NULL, nunca RESTRICT: apagar um contrato é assunto do módulo de
  -- Contratos e não pode esbarrar no histórico de carona da frota.
  contrato_id    uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  contrato_nome  text NOT NULL,
  UNIQUE (agendamento_id, contrato_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_veic_agend_contrato
  ON public.cs_veiculo_agendamento_contrato(agendamento_id);

-- ── 4. Auditoria ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cs_veiculo_agendamento_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id uuid,
  acao           text NOT NULL,
  detalhe        text,
  usuario_id     uuid,
  usuario_nome   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_veic_log
  ON public.cs_veiculo_agendamento_log(agendamento_id, created_at DESC);

-- ── 5. Frota (leitura de sup_patrimonio) ─────────────────────────────
-- Ver decisão 3. Só lê; devolve o recorte que a tela mostra e nada além.
CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.nome, p.identificador, p.lotacao, c.nome,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
     -- SECURITY DEFINER vê tudo; o escopo de empresa precisa vir explícito.
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

-- ── 6. O veículo pode rodar neste período? ───────────────────────────
-- Devolve o motivo do "não" em texto, ou NULL quando está liberado. Uma
-- função só, usada pelo trigger e pela tela — assim a mensagem que o usuário
-- lê é literalmente a mesma que o banco usaria para recusar.
--
-- A leitura das três colunas do Patrimônio:
--   em_manutencao = false ......... livre.
--   true  + previsão de fim ....... bloqueado até a previsão; depois dela,
--                                   agendar é permitido (a oficina já tem
--                                   data para devolver o carro).
--   true  sem previsão de fim ..... bloqueado sem prazo — é o
--                                   "retorno por tempo indeterminado".
CREATE OR REPLACE FUNCTION public.cs_veiculo_motivo_indisponivel(
  p_patrimonio_id uuid,
  p_data_inicio   date,
  p_data_fim      date
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v  record;
  vc record;
BEGIN
  SELECT nome, ativo, em_manutencao, data_inicio_manutencao, data_previsao_fim
    INTO v
    FROM public.sup_patrimonio
   WHERE id = p_patrimonio_id AND categoria = 'veiculo';

  IF NOT FOUND THEN
    RETURN 'Veículo não encontrado no cadastro de Patrimônio.';
  END IF;
  IF NOT v.ativo THEN
    RETURN 'Veículo inativo no cadastro de Patrimônio.';
  END IF;

  IF v.em_manutencao THEN
    IF v.data_previsao_fim IS NULL THEN
      RETURN 'Veículo em manutenção — retorno por tempo indeterminado.';
    ELSIF p_data_inicio <= v.data_previsao_fim THEN
      RETURN 'Veículo em manutenção até ' || to_char(v.data_previsao_fim, 'DD/MM/YYYY')
             || '. Agende a partir de ' || to_char(v.data_previsao_fim + 1, 'DD/MM/YYYY') || '.';
    END IF;
  END IF;

  -- Choque com outra reserva. Períodos se cruzam quando cada um começa antes
  -- de o outro terminar; o turno só livra quando os dois são meio período e
  -- períodos diferentes.
  SELECT a.numero, a.solicitante_nome, a.data_inicio, a.data_fim, a.turno
    INTO vc
    FROM public.cs_veiculo_agendamento a
   WHERE a.patrimonio_id = p_patrimonio_id
     AND a.status = 'confirmado'
     AND a.data_inicio <= p_data_fim
     AND a.data_fim    >= p_data_inicio
   ORDER BY a.data_inicio
   LIMIT 1;

  IF FOUND THEN
    RETURN 'Já existe a reserva nº ' || vc.numero || ' de '
           || coalesce(vc.solicitante_nome, 'outro colaborador') || ' para '
           || to_char(vc.data_inicio, 'DD/MM/YYYY')
           || CASE WHEN vc.data_fim <> vc.data_inicio
                   THEN ' a ' || to_char(vc.data_fim, 'DD/MM/YYYY') ELSE '' END || '.';
  END IF;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cs_veiculo_motivo_indisponivel(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculo_motivo_indisponivel(uuid, date, date) TO authenticated;

-- ── 7. Trigger de validação ──────────────────────────────────────────
-- A checagem de conflito da função acima ignora o turno de propósito (ela
-- serve também para a tela pintar o card). Aqui o turno entra: dois meios
-- turnos diferentes cabem no mesmo dia.
CREATE OR REPLACE FUNCTION public.cs_veic_checar_agendamento()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_manut record;
  v_conf  record;
BEGIN
  IF NEW.status <> 'confirmado' THEN
    RETURN NEW;  -- cancelado/concluído não disputa o carro com ninguém
  END IF;

  -- Só na criação (ou quando a data muda): senão o gestor não conseguiria
  -- corrigir o destino de uma viagem que já começou.
  IF (TG_OP = 'INSERT' OR NEW.data_inicio IS DISTINCT FROM OLD.data_inicio)
     AND NEW.data_inicio < CURRENT_DATE THEN
    RAISE EXCEPTION 'Não dá para agendar um veículo para uma data que já passou.';
  END IF;

  SELECT ativo, em_manutencao, data_previsao_fim INTO v_manut
    FROM public.sup_patrimonio
   WHERE id = NEW.patrimonio_id AND categoria = 'veiculo';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Veículo não encontrado no cadastro de Patrimônio.';
  END IF;
  IF NOT v_manut.ativo THEN
    RAISE EXCEPTION 'Veículo inativo no cadastro de Patrimônio.';
  END IF;
  IF v_manut.em_manutencao
     AND (v_manut.data_previsao_fim IS NULL OR NEW.data_inicio <= v_manut.data_previsao_fim) THEN
    RAISE EXCEPTION 'Veículo em manutenção: %',
      coalesce('previsão de retorno em ' || to_char(v_manut.data_previsao_fim, 'DD/MM/YYYY'),
               'retorno por tempo indeterminado');
  END IF;

  SELECT a.numero, a.data_inicio, a.data_fim INTO v_conf
    FROM public.cs_veiculo_agendamento a
   WHERE a.patrimonio_id = NEW.patrimonio_id
     AND a.id <> NEW.id
     AND a.status = 'confirmado'
     AND a.data_inicio <= NEW.data_fim
     AND a.data_fim    >= NEW.data_inicio
     AND (a.turno = 'dia_todo' OR NEW.turno = 'dia_todo' OR a.turno = NEW.turno)
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Veículo já reservado nesse período (reserva nº %, de % a %).',
      v_conf.numero, to_char(v_conf.data_inicio, 'DD/MM/YYYY'), to_char(v_conf.data_fim, 'DD/MM/YYYY');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cs_veic_checar ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_checar
  BEFORE INSERT OR UPDATE ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_checar_agendamento();

-- Nome do solicitante congelado no ato — o display_name pode mudar depois.
CREATE OR REPLACE FUNCTION public.cs_veic_preencher_solicitante()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF btrim(coalesce(NEW.solicitante_nome, '')) = '' THEN
    NEW.solicitante_nome := (SELECT display_name FROM public.profiles WHERE id = NEW.solicitante_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cs_veic_solicitante ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_solicitante
  BEFORE INSERT ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_preencher_solicitante();

-- Auditoria que nunca derruba a operação (mesmo contrato do trigger de log
-- do Patrimônio: se a auditoria falhar, a reserva ainda vale).
CREATE OR REPLACE FUNCTION public.cs_veic_registrar_log()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome text := coalesce((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'sistema');
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.cs_veiculo_agendamento_log (agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (NEW.id, 'criado',
              NEW.veiculo_nome || ' — ' || to_char(NEW.data_inicio, 'DD/MM/YYYY'),
              auth.uid(), v_nome);
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.cs_veiculo_agendamento_log (agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (NEW.id, NEW.status,
              coalesce(NEW.motivo_cancelamento, OLD.status || ' → ' || NEW.status),
              auth.uid(), v_nome);
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO public.cs_veiculo_agendamento_log (agendamento_id, acao, detalhe, usuario_id, usuario_nome)
      VALUES (OLD.id, 'excluido', OLD.veiculo_nome, auth.uid(), v_nome);
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_cs_veic_log ON public.cs_veiculo_agendamento;
CREATE TRIGGER trg_cs_veic_log
  AFTER INSERT OR UPDATE OR DELETE ON public.cs_veiculo_agendamento
  FOR EACH ROW EXECUTE FUNCTION public.cs_veic_registrar_log();

-- ── 8. RLS ───────────────────────────────────────────────────────────
-- A agenda da frota é pública para quem tem a tela: o "Calendário Geral"
-- existe justamente para todo mundo enxergar quem está com o carro. O que é
-- restrito é MEXER — cada um cuida da própria reserva, e o gestor da frota
-- cuida de todas.
ALTER TABLE public.cs_veiculo_agendamento           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_veiculo_agendamento_contrato  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_veiculo_agendamento_log       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cs_veic_agend_select ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_select ON public.cs_veiculo_agendamento
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('central_servicos_veiculos')
    AND empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cs_veic_agend_insert ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_insert ON public.cs_veiculo_agendamento
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_veiculos', 'incluir')
    AND solicitante_id = auth.uid()   -- ninguém reserva em nome de outro
    AND status = 'confirmado'
    AND empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cs_veic_agend_update ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_update ON public.cs_veiculo_agendamento
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() OR public.tem_acesso_menu('central_servicos_veiculos_gestor'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  )
  WITH CHECK (
    (solicitante_id = auth.uid() OR public.tem_acesso_menu('central_servicos_veiculos_gestor'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  );

-- Excluir de vez é do gestor da frota; o colaborador cancela (com motivo),
-- e o cancelamento fica no histórico.
DROP POLICY IF EXISTS cs_veic_agend_delete ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_delete ON public.cs_veiculo_agendamento
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_veiculos_gestor'));

-- Os contratos herdam a visibilidade e a permissão de escrita da reserva.
DROP POLICY IF EXISTS cs_veic_contrato_select ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_select ON public.cs_veiculo_agendamento_contrato
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a WHERE a.id = agendamento_id
  ));

DROP POLICY IF EXISTS cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid() OR public.tem_acesso_menu('central_servicos_veiculos_gestor'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid() OR public.tem_acesso_menu('central_servicos_veiculos_gestor'))
  ));

DROP POLICY IF EXISTS cs_veic_log_select ON public.cs_veiculo_agendamento_log;
CREATE POLICY cs_veic_log_select ON public.cs_veiculo_agendamento_log
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_veiculos'));
-- Escrita só pelo trigger (SECURITY DEFINER): ninguém forja linha de log.

-- ── 9. Permissão inicial ─────────────────────────────────────────────
-- tem_acesso_menu() nega por padrão: sem nenhuma linha aqui, NINGUÉM
-- conseguiria nem abrir a tela — nem quem administra o sistema. Semear os
-- perfis "concede_tudo" é o que torna o módulo utilizável no minuto seguinte
-- ao deploy; o acesso dos demais continua saindo de Administração › Acesso
-- por Usuário, que segue sendo a única autoridade.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('central_servicos_veiculos'), ('central_servicos_veiculos_gestor')) AS m(codigo)
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                    ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 10. Conferência ──────────────────────────────────────────────────
SELECT am.codigo, am.nome, am.rota
  FROM public.app_menu am
 WHERE am.codigo LIKE 'central_servicos_veiculos%';

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000002_veiculos_frota_empresa_id =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a reserva pertence à empresa DO VEÍCULO
--
-- A 20260828000001 deixou duas escopagens diferentes no mesmo módulo: a
-- frota vinha por `user_empresa` (todas as empresas do usuário) e os
-- contratos vinham pela empresa ATIVA da tela. Na prática a frota do grupo
-- está concentrada num CNPJ só e é dirigida por gente dos outros — então
-- quem está na AGPS via os 15 carros e nenhum contrato.
--
-- Aqui o critério passa a ser um só: `user_empresa` para ler, e a reserva
-- é arquivada na empresa DONA DO VEÍCULO (não na empresa ativa da tela) —
-- senão o carro seria de um CNPJ e a reserva dele de outro.
--
-- Só acrescenta uma coluna ao retorno da RPC; nada em sup_patrimonio muda.
-- =====================================================================

DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000003_veiculos_gestor_e_patrimonio =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — quem manda na frota é o Patrimônio
--
-- A 20260828000001 criou um menu próprio (`central_servicos_veiculos_gestor`)
-- para dizer quem pode mexer na reserva dos outros. Era um segundo lugar
-- respondendo a mesma pergunta que Suprimentos › Patrimônio já responde — e
-- dois lugares para a mesma permissão sempre acabam discordando.
--
-- Agora o gate é o próprio menu do painel de Patrimônio: quem administra a
-- frota lá é quem cancela reserva alheia aqui. O menu extra é removido.
--
-- Continua valendo que NADA em sup_patrimonio é escrito por este módulo —
-- aqui só se LÊ a permissão dele, via can_access().
--
-- ROLLBACK: reaplicar as policies da 20260828000001 e reinserir o menu.
-- =====================================================================

-- ── 1. Policies passam a consultar o Patrimônio ──────────────────────
DROP POLICY IF EXISTS cs_veic_agend_update ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_update ON public.cs_veiculo_agendamento
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid()
     OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  )
  WITH CHECK (
    (solicitante_id = auth.uid()
     OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
    AND public.tem_acesso_menu('central_servicos_veiculos')
  );

DROP POLICY IF EXISTS cs_veic_agend_delete ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_delete ON public.cs_veiculo_agendamento
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'excluir'));

DROP POLICY IF EXISTS cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato;
CREATE POLICY cs_veic_contrato_write ON public.cs_veiculo_agendamento_contrato
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid()
            OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cs_veiculo_agendamento a
     WHERE a.id = agendamento_id
       AND (a.solicitante_id = auth.uid()
            OR public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'))
  ));

-- ── 2. Fora o menu que sobrou ────────────────────────────────────────
DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'central_servicos_veiculos_gestor';
DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'central_servicos_veiculos_gestor';
DELETE FROM public.app_menu                WHERE codigo      = 'central_servicos_veiculos_gestor';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT codigo, nome, rota FROM public.app_menu WHERE codigo LIKE 'central_servicos_veiculos%';

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000004_veiculos_foto =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a foto do carro no card
--
-- `sup_patrimonio.foto_path` já existe e será preenchida pelo módulo de
-- Patrimônio. Aqui só se LÊ: a coluna entra no retorno da RPC da frota.
--
-- POR QUE UM BUCKET NOVO, E NÃO O `sup-patrimonio`
--
--   O bucket `sup-patrimonio` é privado e guarda as NOTAS FISCAIS de
--   manutenção — a 20260824000001 é explícita: "nota fiscal de manutenção
--   não é documento público". A policy de leitura dele exige
--   can_access('sup_patrimonio'|'sup_manutencao'), que o colaborador comum
--   não tem.
--
--   Para a foto aparecer no card do agendamento haveria duas saídas:
--   liberar leitura naquele bucket (o que exporia as notas fiscais junto —
--   regressão de privacidade), ou dar à foto um lugar próprio. É a segunda.
--   Foto de carro não é documento sigiloso; nota fiscal é. Bucket separado
--   mantém as duas coisas com a visibilidade que cada uma merece.
--
--   ESCREVER continua restrito a quem administra o Patrimônio. Só a LEITURA
--   é aberta, e só das fotos.
--
-- ROLLBACK:
--   DELETE FROM storage.buckets WHERE id = 'sup-veiculo-foto';
--   (e reaplicar a RPC da 20260828000002, sem foto_path)
-- =====================================================================

-- ── 1. Bucket público só de fotos de veículo ─────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('sup-veiculo-foto', 'sup-veiculo-foto', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Leitura: o bucket é público, então o <img> do card funciona para qualquer
-- colaborador, sem signed URL e sem depender de permissão de Patrimônio.
-- Escrita: só quem administra o Patrimônio, que é quem cadastra o bem.
DROP POLICY IF EXISTS sup_veic_foto_insert ON storage.objects;
CREATE POLICY sup_veic_foto_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

DROP POLICY IF EXISTS sup_veic_foto_update ON storage.objects;
CREATE POLICY sup_veic_foto_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

DROP POLICY IF EXISTS sup_veic_foto_delete ON storage.objects;
CREATE POLICY sup_veic_foto_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sup-veiculo-foto'
    AND public.can_access(auth.uid(), 'sup_patrimonio', 'alterar'));

-- ── 2. A RPC passa a devolver a foto ─────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  foto_path              text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     AND public.tem_acesso_menu('central_servicos_veiculos')
     AND p.empresa_id IN (
       SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
     )
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000005_veiculos_foto_bucket_correto =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a foto está no bucket do Patrimônio
--
-- A 20260828000004 apostou que a foto do veículo iria para um bucket novo
-- (`sup-veiculo-foto`). Não foi: o módulo de Patrimônio já grava em
-- `sup-patrimonio`, sob o prefixo `fotos/`. Adaptar-se a onde o arquivo
-- realmente está é mais barato do que mover arquivo e reescrever o outro
-- módulo — então o bucket novo, que nasceu vazio, é removido aqui.
--
-- O PROBLEMA E A SOLUÇÃO CIRÚRGICA
--
--   `sup-patrimonio` é privado porque guarda as NOTAS FISCAIS de manutenção,
--   e a policy de leitura exige can_access('sup_patrimonio'|'sup_manutencao').
--   O colaborador que só agenda carro não tem isso.
--
--   Liberar o bucket inteiro exporia as notas junto. Mas os dois tipos de
--   arquivo moram em prefixos diferentes, e isso resolve:
--
--     foto  → fotos/<patrimonio_id>/<uuid>.ext
--     nota  → <patrimonio_id>/<uuid>.ext      (useSupPatrimonio.ts:208)
--
--   Então a policy nova concede leitura APENAS de `fotos/%`, e apenas a quem
--   tem a tela de agendamento. Nota fiscal continua exatamente tão privada
--   quanto era — nenhuma policy existente foi alterada, só somou-se uma.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS sup_patrim_storage_select_foto ON storage.objects;
-- =====================================================================

-- ── 1. Leitura só das fotos, só para quem agenda ─────────────────────
-- Policies de SELECT em storage.objects são somadas (OR): esta não afrouxa
-- nem substitui a `sup_patrim_storage_select` do Patrimônio, que segue
-- valendo para quem tem aquele módulo.
DROP POLICY IF EXISTS sup_patrim_storage_select_foto ON storage.objects;
CREATE POLICY sup_patrim_storage_select_foto ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-patrimonio'
    AND name LIKE 'fotos/%'
    AND public.tem_acesso_menu('central_servicos_veiculos')
  );

-- ── 2. Desarma o bucket que a aposta errada criou ────────────────────
-- As policies de escrita saem, então nada mais consegue gravar nele. O
-- bucket em si NÃO é apagado aqui: o Supabase barra DELETE direto em
-- storage.buckets (storage.protect_delete), só a Storage API remove. Ele
-- nasceu vazio e fica inerte — sem policy de escrita, ninguém usa por
-- engano. Remover a casca vazia é um clique no painel de Storage.
DROP POLICY IF EXISTS sup_veic_foto_insert ON storage.objects;
DROP POLICY IF EXISTS sup_veic_foto_update ON storage.objects;
DROP POLICY IF EXISTS sup_veic_foto_delete ON storage.objects;

-- Deixa de ser público, para não passar a impressão de que ainda serve.
UPDATE storage.buckets SET public = false WHERE id = 'sup-veiculo-foto';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_policy WHERE polname = 'sup_patrim_storage_select_foto') AS policy_foto_deve_ser_1,
  (SELECT count(*) FROM pg_policy WHERE polname LIKE 'sup_veic_foto%')              AS policies_orfas_deve_ser_0;

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000006_veiculos_liberar_perfis =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — liberar o menu para quem usa o ERP
--
-- A 20260828000001 semeou permissão só nos perfis `concede_tudo`, para o
-- módulo não nascer inacessível até para quem administra. Efeito colateral:
-- ficou acessível SÓ para eles. Os perfis que a empresa realmente usa
-- (Legado: comercial, rh, operacional, financeiro, sst…) tinham zero linhas,
-- então has_screen_access devolvia false e a RPC da frota, zero veículos.
--
-- Agendar um carro da frota é tarefa de colaborador, não de administrador,
-- então o menu é liberado para todo perfil ativo que tenha ao menos um
-- usuário.
--
-- POR QUE SÓ visualizar E incluir
--   visualizar → abre a tela, lê a frota e a agenda. É também o que a policy
--                de UPDATE exige para alguém cancelar a PRÓPRIA reserva
--                (o `solicitante_id = auth.uid()` é quem faz o resto).
--   incluir    → cria a reserva.
--   alterar/excluir NÃO entram: mexer em reserva alheia é de quem administra
--                Suprimentos › Patrimônio, decidido na 20260828000003.
--
-- Idempotente e aditivo: ON CONFLICT DO NOTHING não sobrescreve quem já foi
-- configurado à mão, e nenhum `allow = false` existente é tocado.
--
-- ROLLBACK:
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo = 'central_servicos_veiculos'
--      AND acao IN ('visualizar','incluir')
--      AND perfil_id IN (SELECT perfil_id FROM public.usuario_perfil_acesso);
-- =====================================================================

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pa.id, 'central_servicos_veiculos', a.acao, true
  FROM public.perfil_acesso pa
  JOIN public.usuario_perfil_acesso upa ON upa.perfil_id = pa.id
 CROSS JOIN (VALUES ('visualizar'::public.app_acao),
                    ('incluir'::public.app_acao)) AS a(acao)
 WHERE pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── Conferência: quantos usuários passam a enxergar a tela ───────────
SELECT count(DISTINCT upa.user_id) AS usuarios_com_acesso
  FROM public.usuario_perfil_acesso upa
  JOIN public.perfil_acesso pa           ON pa.id = upa.perfil_id AND pa.ativo
  JOIN public.perfil_acesso_permissao p  ON p.perfil_id = pa.id
 WHERE p.menu_codigo = 'central_servicos_veiculos'
   AND p.acao = 'visualizar' AND p.allow;

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000007_veiculos_frota_do_grupo =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — a frota é do grupo, não de um CNPJ
--
-- POR QUE MUDA
--   O módulo nasceu com escopo por empresa (`user_empresa`), por consistência
--   com o resto do ERP. Só que os 15 veículos estão TODOS na HAGG, e as demais
--   empresas do grupo têm zero. Na prática esse filtro dizia "só quem é da
--   HAGG agenda carro" — o que contradiz o módulo viver na Central de
--   Serviços, aberta a todo colaborador. Quem está na SN dirige o mesmo carro.
--
--   Passa a valer: quem tem o menu vê a frota inteira do grupo. O menu é o
--   gate; a empresa deixa de ser.
--
-- OS QUATRO LUGARES, E POR QUE TÊM DE MUDAR JUNTOS
--   1. RPC da frota   → senão o carro nem aparece.
--   2. SELECT da agenda → senão ele veria o carro mas não as reservas em cima
--      dele, e marcaria por cima de alguém achando que estava livre.
--   3. INSERT da agenda → a reserva é arquivada na empresa DONA do veículo
--      (20260828000002). Para quem é da SN reservando um carro da HAGG, o
--      WITH CHECK antigo recusaria a própria reserva que a tela mandou.
--   4. (nada muda em sup_patrimonio — segue somente lido.)
--
-- O que continua trancado: só o dono cancela a própria reserva, e mexer em
-- reserva alheia segue sendo de quem administra Suprimentos › Patrimônio.
--
-- ROLLBACK: reaplicar as policies da 20260828000003 e a RPC da 20260828000004.
-- =====================================================================

-- ── 1. A RPC devolve a frota do grupo ────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();

CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE (
  id                     uuid,
  empresa_id             uuid,
  nome                   text,
  identificador          text,
  lotacao                text,
  contrato_nome          text,
  foto_path              text,
  em_manutencao          boolean,
  data_inicio_manutencao date,
  data_previsao_fim      date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     -- Único gate. `empresa_id` continua vindo no retorno porque a reserva é
     -- arquivada na empresa dona do carro — só não filtra mais por ela.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

-- ── 2. A agenda acompanha a frota ────────────────────────────────────
DROP POLICY IF EXISTS cs_veic_agend_select ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_select ON public.cs_veiculo_agendamento
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_veiculos'));

-- ── 3. Reservar carro de outro CNPJ do grupo é permitido ─────────────
DROP POLICY IF EXISTS cs_veic_agend_insert ON public.cs_veiculo_agendamento;
CREATE POLICY cs_veic_agend_insert ON public.cs_veiculo_agendamento
  FOR INSERT TO authenticated
  WITH CHECK (
    public.tem_acesso_menu('central_servicos_veiculos', 'incluir')
    AND solicitante_id = auth.uid()   -- ninguém reserva em nome de outro
    AND status = 'confirmado'
  );

-- ── 4. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS veiculos_visiveis_sem_filtro_de_empresa
  FROM public.sup_patrimonio
 WHERE categoria = 'veiculo' AND ativo;

NOTIFY pgrst, 'reload schema';
