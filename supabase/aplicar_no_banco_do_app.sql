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


-- ===== 20260828000008_chamados_encarregados_e_abertura_livre =====
-- =====================================================================
-- CHAMADOS DE SISTEMAS — tela para o encarregado, e abertura livre
--
-- DUAS COISAS
--
--   1. O encarregado passa a ter a tela no módulo dele
--      (/app/encarregados/chamados). São as MESMAS telas da Central de
--      Serviços — o prop `base` já existia para isto —, só ancoradas noutro
--      menu, para quem vive em Encarregados não ter de caçar a tela.
--
--   2. Abrir chamado vira livre para qualquer um.
--
-- COMO "LIVRE" É FEITO, E POR QUE ASSIM
--
--   Não foi criado nada novo de permissão. O sistema JÁ tem o conceito:
--   `chamado_pode_abrir()` devolve true quando o menu não aparece em
--   list_configured_menu_codes(), e essa função considera configurado todo
--   menu com QUALQUER linha em perfil_acesso_permissao ou
--   screen_permission_user. O front usa a mesma regra (useChamadoPerms).
--
--   Então "livre" = apagar a configuração. Isso vale para sempre e para quem
--   entrar depois, sem ter de lembrar de conceder a cada novo perfil ou
--   usuário — o oposto de conceder a N perfis, que envelhece mal.
--
--   É SEGURO: as 39 linhas de chamados_sistemas_abrir e as 37 de
--   central_servicos_chamados são TODAS allow = true. Não há um único
--   allow = false, ou seja, ninguém tinha sido explicitamente proibido.
--   Depois disto todos continuam podendo — e os demais passam a poder.
--
--   As linhas apagadas ficam guardadas na tabela de backup abaixo, então o
--   rollback é um INSERT de volta, não um retrabalho manual em 39 usuários.
--
-- ROLLBACK:
--   INSERT INTO public.screen_permission_user
--   SELECT * FROM public.bkp_chamados_permissao_20260828;
--   DELETE FROM public.app_menu WHERE codigo = 'encarregados_chamados';
-- =====================================================================

-- ── 1. Menu do encarregado ───────────────────────────────────────────
-- Nasce SEM linha de permissão de propósito: menu não configurado é aberto,
-- que é exatamente o que se quer aqui.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'encarregados_chamados', 'Chamados de Sistemas',
       '/app/encarregados/chamados', 20, true
  FROM public.app_modulo m
 WHERE m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Backup antes de apagar ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bkp_chamados_permissao_20260828
  AS SELECT * FROM public.screen_permission_user WHERE false;

INSERT INTO public.bkp_chamados_permissao_20260828
SELECT s.* FROM public.screen_permission_user s
 WHERE s.menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados')
   AND NOT EXISTS (SELECT 1 FROM public.bkp_chamados_permissao_20260828 b WHERE b.id = s.id);

-- A tabela de backup não é para consumo do app: fecha para todo mundo.
ALTER TABLE public.bkp_chamados_permissao_20260828 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bkp_chamados_permissao_20260828 FROM anon, authenticated;

-- ── 3. Abre para todos, removendo a configuração ─────────────────────
-- Guarda de segurança: se algum dia existir um allow = false aqui, apagar
-- tudo PROMOVERIA quem estava proibido. Nesse caso a migration falha em vez
-- de conceder acesso silenciosamente.
DO $$
DECLARE v_negados int;
BEGIN
  SELECT count(*) INTO v_negados
    FROM public.screen_permission_user
   WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados')
     AND allow = false;

  IF v_negados > 0 THEN
    RAISE EXCEPTION
      'Existem % negações explícitas nesses menus. Abrir para todos apagaria a proibição de alguém — revise antes.',
      v_negados;
  END IF;
END $$;

DELETE FROM public.screen_permission_user
 WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados');

DELETE FROM public.perfil_acesso_permissao
 WHERE menu_codigo IN ('chamados_sistemas_abrir', 'central_servicos_chamados');

-- ── 4. Conferência ───────────────────────────────────────────────────
-- Os três devem sair como "aberto": nenhum aparece em
-- list_configured_menu_codes(), então chamado_pode_abrir() é true para todos.
SELECT x.codigo,
       NOT EXISTS (SELECT 1 FROM public.list_configured_menu_codes() c
                    WHERE c.menu_codigo = x.codigo) AS aberto_para_todos
  FROM (VALUES ('chamados_sistemas_abrir'),
               ('central_servicos_chamados'),
               ('encarregados_chamados')) AS x(codigo);

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000009_carga_historico_veiculos =====
-- =====================================================================
-- AGENDAMENTO DE VEÍCULOS — carga do histórico do sistema anterior
--
-- 96 das 123 reservas do sistema antigo. O que ficou de fora, e por quê,
-- está na seção "O QUE NÃO VEIO" no fim deste comentário.
--
-- DECISÕES
--
--   1. OS GATILHOS SÃO DESLIGADOS DURANTE A CARGA. O trigger de validação
--      recusa data no passado e choque de reserva — regras corretas para
--      quem agenda hoje, e erradas para histórico: todo o passado é passado,
--      e o legado tem conflitos reais (as linhas 106 e 107 são o mesmo Jeep
--      no mesmo dia). Histórico entra como foi, não como deveria ter sido.
--
--   2. NOME DO VEÍCULO É O DO CADASTRO ATUAL, não o do legado. O legado
--      chamava "JAC J6" o carro que hoje está cadastrado como "JBY-7G73"
--      (placa JBZ-4D93). Gravar o nome antigo faria o histórico divergir da
--      frota na mesma tela. O nome legado fica no campo observacoes.
--
--   3. CONTRATO SEM PAR ENTRA MESMO ASSIM. Só 24 dos 43 nomes de contrato
--      do legado existem em `contratos`. A tabela filha guarda contrato_nome
--      (obrigatório) e contrato_id (opcional) — foi desenhada para isso.
--      Os 19 sem par entram com o nome preservado e id nulo, em vez de
--      sumirem.
--
--   4. legado_id TORNA A CARGA REPETÍVEL. Coluna única: rodar de novo não
--      duplica (ON CONFLICT DO NOTHING) e o rollback é um DELETE por ela.
--
-- O QUE NÃO VEIO (27 linhas, decidido com o Pablo)
--   AFRANIO AMARAL FRANKE (19) e LUIZ ENRIQUE FALEIRO TEIXEIRA (8) não têm
--   login no ERP — procurei variações de grafia, não existem. Como
--   solicitante_id é NOT NULL e referencia auth.users, essas reservas não
--   têm como ser gravadas com dono verdadeiro, e inventar um dono seria
--   gravar mentira. Ficam de fora até os logins existirem; o CSV original
--   segue sendo a fonte se um dia entrarem.
--
-- ROLLBACK:
--   DELETE FROM public.cs_veiculo_agendamento WHERE legado_id IS NOT NULL;
--   ALTER TABLE public.cs_veiculo_agendamento DROP COLUMN legado_id;
-- =====================================================================

-- ── 1. Rastro da origem ──────────────────────────────────────────────
ALTER TABLE public.cs_veiculo_agendamento
  ADD COLUMN IF NOT EXISTS legado_id integer;

COMMENT ON COLUMN public.cs_veiculo_agendamento.legado_id IS
  'Id da reserva no sistema anterior. Nulo = nasceu aqui. Torna a carga repetível.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_veic_legado_id
  ON public.cs_veiculo_agendamento(legado_id) WHERE legado_id IS NOT NULL;

-- ── 2. Área de trabalho com o CSV cru ────────────────────────────────
DROP TABLE IF EXISTS public.tmp_carga_veiculos_legado;
CREATE TABLE public.tmp_carga_veiculos_legado (
  legado_id     integer PRIMARY KEY,
  veiculo_nome  text,
  condutor_nome text,
  data          date,
  turno         text,
  contratos     jsonb,
  criado_em     timestamptz,
  cancelado     boolean
);

INSERT INTO public.tmp_carga_veiculos_legado
  (legado_id, veiculo_nome, condutor_nome, data, turno, contratos, criado_em, cancelado)
VALUES
  (6, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-05-12', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-05-12 11:02:50.487536+00', false),
  (7, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-13', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-12 19:23:47.241181+00', true),
  (8, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-05-13', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-12 19:26:58.673939+00', false),
  (14, 'ONIX', 'STEFANE DE AZEVEDO SOUZA', '2026-05-15', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025","SEMAE - 3038/2020","SEC. DA CULTURA POA - PORTARIA - 88123","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-05-15 11:23:17.645543+00', false),
  (17, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-19', 'dia_todo', '["GUAPORÉ LIMP SMED EMERGENCIAL - 063.2026"]'::jsonb, '2026-05-15 20:23:12.35948+00', false),
  (18, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-20', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-05-15 20:24:00.025399+00', false),
  (19, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-21', 'dia_todo', '["CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-05-15 20:24:46.849947+00', false),
  (20, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-05-20', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-05-19 16:24:47.664501+00', true),
  (21, 'ONIX', 'JOAO VITOR DA CUNHA CASTRO', '2026-05-20', 'dia_todo', '["UFRGS - CARREGADORES - 095/2024"]'::jsonb, '2026-05-19 16:49:28.855911+00', false),
  (22, 'MONTANA', 'GUSTAVO BARCELOS BRAGA', '2026-05-20', 'dia_todo', '["SEMAE - 3038/2020","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-05-19 20:04:44.031532+00', false),
  (26, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-05-25', 'dia_todo', '["HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-05-22 20:16:10.272919+00', false),
  (27, 'JAC J6', 'PABLO FLORES SANTAREM', '2030-01-26', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 16:02:50.430695+00', false),
  (29, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-28', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 16:53:51.700039+00', true),
  (30, 'JAC J6', 'PABLO FLORES SANTAREM', '2026-05-28', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-25 17:38:04.568429+00', true),
  (31, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-05-27', 'dia_todo', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-05-26 16:23:56.022147+00', false),
  (32, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-05-26', 'tarde', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-05-26 16:39:33.98443+00', false),
  (34, 'Jeep Compass', 'PABLO FLORES SANTAREM', '2026-05-30', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-05-28 17:16:16.93238+00', true),
  (35, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-06-02', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","TJRS - 023/2025"]'::jsonb, '2026-06-01 14:32:48.507306+00', true),
  (36, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-02', 'dia_todo', '["CAMARA DE RIO GRANDE-LIMPEZA - 001/2023"]'::jsonb, '2026-06-01 18:18:13.979264+00', false),
  (37, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-06-03', 'dia_todo', '["TJRS - 023/2025","UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022"]'::jsonb, '2026-06-01 18:27:28.256882+00', false),
  (38, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-02', 'dia_todo', '["CHARQUEADAS - 249/2020"]'::jsonb, '2026-06-02 11:19:59.452712+00', false),
  (39, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-03', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-06-03 15:53:32.519539+00', false),
  (40, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-09', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026"]'::jsonb, '2026-06-08 13:59:40.889018+00', false),
  (41, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-10', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-08 17:24:22.718707+00', false),
  (43, 'ONIX', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-06-18', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-06-08 19:52:00.225654+00', false),
  (45, 'MERCEDES', 'IURY DE JESUS SILVA', '2026-12-18', 'dia_todo', '["ADM E ESTAGIARIOS - NH"]'::jsonb, '2026-06-10 10:52:21.460654+00', false),
  (46, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-11', 'tarde', '["SEMAE - 3038/2020"]'::jsonb, '2026-06-11 15:24:49.246929+00', false),
  (48, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-06-15', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025"]'::jsonb, '2026-06-15 12:02:13.305079+00', false),
  (49, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-06-16', 'tarde', '["TRIUNFO VIGIAS - 33/2024"]'::jsonb, '2026-06-16 16:29:04.685282+00', false),
  (50, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-06-16', 'tarde', '["TRIUNFO VIGIAS - 33/2024"]'::jsonb, '2026-06-16 16:47:29.590438+00', false),
  (51, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-06-18', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-17 18:28:56.720341+00', false),
  (53, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-06-23', 'dia_todo', '["LIMPEZA HUSM"]'::jsonb, '2026-06-22 14:51:47.750557+00', false),
  (54, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-24', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-06-22 17:10:00.256696+00', false),
  (55, 'ONIX', 'GUSTAVO GARCIA RONSANI', '2026-06-25', 'dia_todo', '["TJRS - 023/2025"]'::jsonb, '2026-06-22 17:49:10.906661+00', false),
  (56, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-06-23', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-06-23 12:30:32.605306+00', false),
  (58, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-06-29', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-06-29 12:05:53.933529+00', false),
  (61, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-06-30', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-06-29 19:34:09.39621+00', false),
  (62, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-06-30', 'manha', '["PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-06-30 09:55:56.548999+00', false),
  (65, 'JAC J6', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-02', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-01 17:26:15.937892+00', false),
  (66, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-08', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-01 17:27:42.289218+00', true),
  (67, 'JAC J6', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-09', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-01 17:29:40.949573+00', true),
  (68, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-09', 'dia_todo', '["CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-01 17:31:14.52333+00', false),
  (71, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-02', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-02 16:34:59.915227+00', true),
  (72, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-03', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-02 16:38:21.196535+00', false),
  (73, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-06', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES","TJRS - 023/2025"]'::jsonb, '2026-07-03 16:14:17.646225+00', false),
  (74, 'Jeep Compass', 'CASSIO RAPHAELLI CAMARGO DUARTE', '2026-07-07', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-06 17:28:12.617779+00', false),
  (75, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-07-08', 'dia_todo', '["DMAE - 895/0","UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-07 11:09:19.183094+00', false),
  (76, 'MONTANA', 'ISMAEL KUHL LOPES', '2026-07-07', 'dia_todo', '["UFRGS - MOTORISTAS - 034/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - JARDINAGEM - 062/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - COPA E COZINHA - 025/2025","UFRGS - CARREGADORES - 095/2024","TJRS - 023/2025"]'::jsonb, '2026-07-07 11:16:00.604498+00', false),
  (77, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-13', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025"]'::jsonb, '2026-07-07 12:09:53.029318+00', true),
  (78, 'KWID', 'ISADORA PRISCO SILVEIRA', '2026-07-07', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-07 14:29:32.623521+00', false),
  (79, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-07-09', 'dia_todo', '["CHARQUEADAS - 005.2021","CHARQUEADAS - 168/2021","CHARQUEADAS - 249/2020"]'::jsonb, '2026-07-08 11:59:28.606965+00', false),
  (80, 'KWID', 'DAISON TAVARES RODRIGUES', '2026-07-09', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022"]'::jsonb, '2026-07-08 11:59:42.002504+00', false),
  (81, 'MONTANA', 'DAISON TAVARES RODRIGUES', '2026-07-10', 'dia_todo', '["UFRGS - COPA E COZINHA - 025/2025"]'::jsonb, '2026-07-08 12:01:01.742374+00', false),
  (82, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-07-13', 'dia_todo', '["PREF POA SMS RECEPÇÃO - 98672/2025"]'::jsonb, '2026-07-08 12:25:24.04851+00', false),
  (83, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-10', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-08 12:25:43.028161+00', false),
  (84, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-14', 'dia_todo', '["UFFS CERRO LARGO - 041/2021"]'::jsonb, '2026-07-08 14:02:59.992218+00', false),
  (85, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-07-15', 'dia_todo', '["UFFS CERRO LARGO - 041/2021"]'::jsonb, '2026-07-08 14:04:01.253659+00', false),
  (86, 'KWID', 'ISADORA PRISCO SILVEIRA', '2026-07-10', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-10 13:58:36.16298+00', false),
  (87, 'JAC J6', 'GUSTAVO BARCELOS BRAGA', '2026-07-14', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SAMU TELEFONISTAS - 96397/2025","SEMAE - 3038/2020"]'::jsonb, '2026-07-13 18:53:21.651102+00', false),
  (88, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-07-15', 'dia_todo', '["CAMARA DE RIO GRANDE-LIMPEZA - 001/2023","CAMARA DE RIO GRANDE-PORTARIA - 002/2023","EMBRAPA - 2021/93","FURG HU - 006/2023","FURG JARDINAGEM  - 049/2022","FURG PORTARIA - 055/2023"]'::jsonb, '2026-07-14 13:06:36.446545+00', false),
  (89, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-22', 'dia_todo', '["CAXIAS DO SUL - 95.2026","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-14 13:11:45.284178+00', true),
  (90, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-07-16', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES"]'::jsonb, '2026-07-14 13:13:58.946789+00', false),
  (91, 'KWID', 'GUSTAVO GARCIA RONSANI', '2026-07-14', 'tarde', '["UFRGS - JARDINAGEM - 062/2025"]'::jsonb, '2026-07-14 13:55:08.358904+00', false),
  (94, 'KWID', 'DAIANE MARTINS DE SOUZA', '2026-07-15', 'dia_todo', '["CHARQUEADAS - 249/2020","CHARQUEADAS - 168/2021","CHARQUEADAS - 005.2021"]'::jsonb, '2026-07-14 18:38:05.884351+00', true),
  (95, 'MONTANA', 'DAIANE MARTINS DE SOUZA', '2026-07-16', 'dia_todo', '["CHARQUEADAS - 005.2021","CHARQUEADAS - 168/2021","CHARQUEADAS - 249/2020"]'::jsonb, '2026-07-15 11:15:51.296673+00', false),
  (97, 'Jeep Compass', 'CARLOS JOSE FERGUTZ NETO', '2026-07-16', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - MOTORISTAS - 034/2022","UFRGS ALMOXARIFES","TJRS - 023/2025"]'::jsonb, '2026-07-15 19:00:42.172682+00', false),
  (98, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-23', 'dia_todo', '["VERANOPOLIS - 001/2021","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026"]'::jsonb, '2026-07-16 18:35:34.000967+00', true),
  (99, 'ONIX', 'CARLOS JOSE FERGUTZ NETO', '2026-07-17', 'dia_todo', '["UFRGS - INTERPRETE DE LIBRAS - 009.2026"]'::jsonb, '2026-07-17 11:10:13.858584+00', false),
  (101, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-20', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-20 11:31:14.751051+00', false),
  (102, 'ONIX', 'ISADORA PRISCO SILVEIRA', '2026-07-20', 'manha', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-20 11:31:49.911653+00', false),
  (103, 'Jeep Compass', 'GUSTAVO GARCIA RONSANI', '2026-07-21', 'dia_todo', '["UFRGS - LIMPEZA - 020/2022"]'::jsonb, '2026-07-20 18:10:52.675953+00', false),
  (104, 'ONIX', 'GUSTAVO BARCELOS BRAGA', '2026-07-21', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","PREF POA SMS RECEPÇÃO - 98672/2025","POLICIA CIVIL RS LIMPEZA 066.2026","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-07-20 19:40:38.681075+00', false),
  (105, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-22', 'dia_todo', '["POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","SEMAE - 3038/2020","SEC. DA CULTURA POA - PORTARIA - 88123","SAMU TELEFONISTAS - 96397/2025","HOSPITAL SÃO CAMILO - 50163.2025"]'::jsonb, '2026-07-22 11:32:10.469094+00', false),
  (106, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-27', 'dia_todo', '["BENTO GONÇALVES - LIMPEZA - 048.2026","BENTO GONÇALVES - AUX ADM - 002/2021","CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:48:47.10424+00', true),
  (107, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-27', 'dia_todo', '["VERANOPOLIS - 001/2021","BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026"]'::jsonb, '2026-07-22 11:50:29.496793+00', false),
  (108, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-28', 'dia_todo', '["CAXIAS DO SUL - 95.2026","BENTO GONÇALVES - LIMPEZA - 048.2026","BENTO GONÇALVES - AUX ADM - 002/2021","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:52:15.948284+00', false),
  (109, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-07-29', 'dia_todo', '["BENTO GONÇALVES - AUX ADM - 002/2021","BENTO GONÇALVES - LIMPEZA - 048.2026","CAXIAS DO SUL - 95.2026","VERANOPOLIS - 001/2021"]'::jsonb, '2026-07-22 11:57:20.394895+00', false),
  (110, 'ONIX', 'DAIANE MARTINS DE SOUZA', '2026-07-22', 'manha', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-07-22 12:04:40.40759+00', false),
  (111, 'Jeep Compass', 'DAIANE MARTINS DE SOUZA', '2026-08-05', 'dia_todo', '["SALTO DO JACUI - 722/2021"]'::jsonb, '2026-07-22 17:08:22.723796+00', false),
  (112, 'JAC J6', 'GUSTAVO GARCIA RONSANI', '2026-07-27', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-24 11:57:26.481111+00', false),
  (113, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-25', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-07-24 14:29:07.765308+00', false),
  (114, 'MONTANA', 'CARLOS JOSE FERGUTZ NETO', '2026-07-25', 'dia_todo', '["UFRGS - AUX DE SAÚDE BUCAL - 033/2021","UFRGS - CARREGADORES - 095/2024","UFRGS - COPA E COZINHA - 025/2025","UFRGS - INTERPRETE DE LIBRAS - 009.2026","UFRGS - JARDINAGEM - 062/2025","UFRGS - LIMPEZA - 020/2022","UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-24 14:47:00.188756+00', false),
  (115, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-08-19', 'dia_todo', '["EMBRAPA CANOINHAS - 47/2024","FURG JARDINAGEM  - 049/2022","FURG HU - 006/2023","FURG PORTARIA - 055/2023"]'::jsonb, '2026-07-24 17:42:14.915732+00', false),
  (116, 'Jeep Compass', 'DICKSON SCHUBERT FLORES', '2026-08-20', 'dia_todo', '["FURG HU - 006/2023","FURG JARDINAGEM  - 049/2022","FURG PORTARIA - 055/2023","EMBRAPA - 2021/93"]'::jsonb, '2026-07-24 17:43:36.241991+00', false),
  (117, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-07-27', 'tarde', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-07-27 14:11:58.873337+00', false),
  (118, 'Jeep Compass', 'GUSTAVO BARCELOS BRAGA', '2026-07-30', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","SEC. DA CULTURA POA - PORTARIA - 88123","SEMAE - 3038/2020","PREF POA SMS RECEPÇÃO - 98672/2025","POLICIA CIVIL RS LIMPEZA 066.2026"]'::jsonb, '2026-07-29 19:26:50.708483+00', false),
  (119, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-07-31', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - AUX DE SAÚDE BUCAL - 033/2021"]'::jsonb, '2026-07-31 13:50:10.149926+00', false),
  (120, 'Jeep Compass', 'JOEL DOS SANTOS', '2026-07-31', 'tarde', '["TRIUNFO COLETA DE LIXO 89.2026"]'::jsonb, '2026-07-31 15:02:33.544578+00', true),
  (121, 'KWID', 'CARLOS JOSE FERGUTZ NETO', '2026-08-04', 'dia_todo', '["UFRGS - LIMPEZA GERAL - 047/2022"]'::jsonb, '2026-08-03 19:05:46.435444+00', false),
  (122, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-10', 'dia_todo', '["UFFS PASSO FUNDO - 041/2021","UFFS ERECHIM - 041/2021"]'::jsonb, '2026-08-03 19:20:23.506392+00', false),
  (123, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-11', 'dia_todo', '["UFFS CHAPECO - 041/2021"]'::jsonb, '2026-08-03 19:23:04.573405+00', false),
  (124, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-12', 'dia_todo', '["EMBRAPA CANOINHAS - 47/2024"]'::jsonb, '2026-08-03 19:25:35.935055+00', false),
  (125, 'Jeep Compass', 'ISMAEL KUHL LOPES', '2026-08-13', 'dia_todo', '["PENHA LIMPEZA - 039/2025"]'::jsonb, '2026-08-03 19:39:29.29337+00', false),
  (126, 'ONIX', 'DAISON TAVARES RODRIGUES', '2026-08-13', 'dia_todo', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-08-05 14:13:19.230542+00', false),
  (127, 'MERCEDES', 'GUSTAVO BARCELOS BRAGA', '2026-08-06', 'dia_todo', '["SAMU TELEFONISTAS - 96397/2025","TJRS - 023/2025","POLICIA CIVIL RS LIMPEZA 066.2026","PREF POA SMS RECEPÇÃO - 98672/2025","UFRGS - LIMPEZA GERAL - 047/2022","UFRGS - LIMPEZA - 020/2022","UFRGS - JARDINAGEM - 062/2025"]'::jsonb, '2026-08-05 14:52:46.089195+00', false),
  (128, 'ONIX', 'JOSE CARLOS FERREIRA EBERT', '2026-08-11', 'tarde', '["ADM E ESTAGIARIOS - HAGG"]'::jsonb, '2026-08-10 11:50:32.710445+00', false);

-- ── 3. De/para dos veículos ──────────────────────────────────────────
-- Duas placas casaram sozinhas (MERCEDES→MERCEDES VITO, JAC J6→JBY-7G73);
-- o resto casou por nome. KWID era ambíguo entre "KWID" e "KWID PRETO",
-- nenhum com placa cadastrada — o Pablo confirmou que é o "KWID".
DROP TABLE IF EXISTS public.tmp_carga_veiculos_depara;
CREATE TABLE public.tmp_carga_veiculos_depara (legado text PRIMARY KEY, atual text NOT NULL);
INSERT INTO public.tmp_carga_veiculos_depara VALUES
  ('ONIX',         'ONIX'),
  ('JAC J6',       'JBY-7G73'),
  ('MONTANA',      'MONTANA'),
  ('Jeep Compass', 'JEEP COMPAS'),
  ('MERCEDES',     'MERCEDES VITO'),
  ('KWID',         'KWID');

-- Se algum de/para não achar o veículo, a carga para aqui em vez de
-- importar reserva órfã.
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(d.atual, ', ') INTO v_faltando
    FROM public.tmp_carga_veiculos_depara d
   WHERE NOT EXISTS (SELECT 1 FROM public.sup_patrimonio p
                      WHERE p.categoria = 'veiculo' AND p.ativo AND p.nome = d.atual);
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'Veículo(s) do de/para não encontrados no Patrimônio: %', v_faltando;
  END IF;
END $$;

-- ── 4. A carga ───────────────────────────────────────────────────────
ALTER TABLE public.cs_veiculo_agendamento DISABLE TRIGGER USER;

INSERT INTO public.cs_veiculo_agendamento (
  legado_id, empresa_id, patrimonio_id, veiculo_nome, veiculo_identificador,
  data_inicio, data_fim, turno, observacoes,
  status, motivo_cancelamento, solicitante_id, solicitante_nome, created_at
)
SELECT t.legado_id, p.empresa_id, p.id, p.nome, p.identificador,
       t.data, t.data, t.turno,
       'Importado do sistema anterior (registro nº ' || t.legado_id
         || ', veículo "' || t.veiculo_nome || '").',
       CASE WHEN t.cancelado THEN 'cancelado' ELSE 'confirmado' END,
       CASE WHEN t.cancelado
            THEN 'Cancelado no sistema anterior (importação do histórico).' END,
       pr.id, pr.display_name, t.criado_em
  FROM public.tmp_carga_veiculos_legado t
  JOIN public.tmp_carga_veiculos_depara d ON d.legado = t.veiculo_nome
  JOIN public.sup_patrimonio p ON p.nome = d.atual AND p.categoria = 'veiculo' AND p.ativo
  JOIN public.profiles pr ON upper(btrim(pr.display_name)) = upper(btrim(t.condutor_nome))
-- O predicado tem de ser repetido: o índice é parcial, e sem ele o Postgres
-- não reconhece o árbitro do ON CONFLICT.
ON CONFLICT (legado_id) WHERE legado_id IS NOT NULL DO NOTHING;

-- Contratos: id quando existe, nome sempre.
INSERT INTO public.cs_veiculo_agendamento_contrato (agendamento_id, contrato_id, contrato_nome)
SELECT a.id,
       (SELECT c.id FROM public.contratos c
         WHERE upper(btrim(c.nome)) = upper(btrim(nome_legado)) LIMIT 1),
       nome_legado
  FROM public.tmp_carga_veiculos_legado t
  JOIN public.cs_veiculo_agendamento a ON a.legado_id = t.legado_id
 CROSS JOIN LATERAL jsonb_array_elements_text(t.contratos) AS x(nome_legado)
ON CONFLICT DO NOTHING;

ALTER TABLE public.cs_veiculo_agendamento ENABLE TRIGGER USER;

DROP TABLE public.tmp_carga_veiculos_legado;
DROP TABLE public.tmp_carga_veiculos_depara;

-- ── 5. Conferência ───────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE legado_id IS NOT NULL)                          AS importados,
       count(*) FILTER (WHERE legado_id IS NOT NULL AND status = 'cancelado') AS cancelados,
       count(*) FILTER (WHERE legado_id IS NULL)                              AS nascidos_aqui
  FROM public.cs_veiculo_agendamento;

SELECT count(*)                                AS vinculos_de_contrato,
       count(*) FILTER (WHERE contrato_id IS NULL) AS sem_par_em_contratos
  FROM public.cs_veiculo_agendamento_contrato ct
  JOIN public.cs_veiculo_agendamento a ON a.id = ct.agendamento_id
 WHERE a.legado_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';


-- ===== 20260828000010_vinculo_discord =====
-- =====================================================================
-- VÍNCULO DA CONTA DO DISCORD
--
-- Base para as notificações do ERP chegarem no Discord. O que o robô precisa
-- de verdade é o ID do Discord (o "snowflake"): é ele que faz a menção
-- <@id> funcionar num canal e o DM ser endereçável. O e-mail entra junto
-- porque é o que uma pessoa consegue conferir a olho — ninguém reconhece um
-- snowflake.
--
-- DUAS ORIGENS, E A TELA SABE A DIFERENÇA
--   OAuth (um clique)  → `verificado = true`. O Discord confirmou que aquela
--                        conta é de quem clicou; não há como digitar errado
--                        nem reivindicar a conta de outro.
--   Manual (colado)    → `verificado = false`. Serve para quem não quiser
--                        autorizar o app, mas ninguém provou nada: pode ser
--                        typo, pode ser o ID do colega.
--   Quem for disparar notificação depois deve tratar os dois diferente.
--
-- UMA CONTA DE DISCORD POR PESSOA. O UNIQUE em discord_id é o que impede
-- duas contas do ERP apontarem para o mesmo Discord — sem ele, o caminho
-- manual permitiria alguém receber (ou desviar) a notificação de outro.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.usuario_discord_oauth_state, public.usuario_discord;
-- =====================================================================

-- ── 1. O vínculo ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usuario_discord (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id       text NOT NULL,
  discord_username text,
  discord_email    text,
  discord_avatar   text,
  verificado       boolean NOT NULL DEFAULT false,
  vinculado_em     timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Snowflake é só dígito. Barra o "@fulano" colado por engano no manual.
  CONSTRAINT usuario_discord_id_numerico CHECK (discord_id ~ '^[0-9]{5,25}$'),
  CONSTRAINT usuario_discord_unico UNIQUE (discord_id)
);

DROP TRIGGER IF EXISTS trg_usuario_discord_updated ON public.usuario_discord;
CREATE TRIGGER trg_usuario_discord_updated BEFORE UPDATE ON public.usuario_discord
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Estado do OAuth (anti-CSRF) ───────────────────────────────────
-- O `state` amarra a volta do Discord ao usuário que iniciou. Sem isso,
-- alguém poderia induzir a vítima a concluir um fluxo iniciado por outro e
-- vincular a PRÓPRIA conta de Discord à conta de ERP da vítima.
CREATE TABLE IF NOT EXISTS public.usuario_discord_oauth_state (
  state      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usuario_discord_state_criado
  ON public.usuario_discord_oauth_state(created_at);

-- ── 3. RLS ───────────────────────────────────────────────────────────
-- Cada um enxerga e mexe apenas no próprio vínculo. Quem administra o ERP
-- vê todos, para saber quem falta vincular. Quem dispara notificação roda
-- como service_role e não passa por aqui.
ALTER TABLE public.usuario_discord             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_discord_oauth_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_discord_select ON public.usuario_discord;
CREATE POLICY usuario_discord_select ON public.usuario_discord
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.tem_acesso_menu('administracao'));

DROP POLICY IF EXISTS usuario_discord_insert ON public.usuario_discord;
CREATE POLICY usuario_discord_insert ON public.usuario_discord
  FOR INSERT TO authenticated
  -- Só o caminho manual passa por aqui. O OAuth grava por service_role e é
  -- o único que pode marcar verificado = true.
  WITH CHECK (user_id = auth.uid() AND verificado = false);

DROP POLICY IF EXISTS usuario_discord_update ON public.usuario_discord;
CREATE POLICY usuario_discord_update ON public.usuario_discord
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND verificado = false);

DROP POLICY IF EXISTS usuario_discord_delete ON public.usuario_discord;
CREATE POLICY usuario_discord_delete ON public.usuario_discord
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.tem_acesso_menu('administracao'));

-- O state nunca é lido pelo navegador: quem valida é a Edge Function, por
-- service_role. Sem policy de SELECT, ninguém autenticado enxerga.
DROP POLICY IF EXISTS usuario_discord_state_nada ON public.usuario_discord_oauth_state;

-- ── 4. Faxina dos states vencidos ────────────────────────────────────
-- 10 minutos é folga de sobra para autorizar no Discord e voltar.
CREATE OR REPLACE FUNCTION public.usuario_discord_limpar_states()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.usuario_discord_oauth_state
   WHERE created_at < now() - interval '10 minutes';
$$;
REVOKE ALL ON FUNCTION public.usuario_discord_limpar_states() FROM PUBLIC, anon, authenticated;

-- ── 5. Quem ainda não vinculou ───────────────────────────────────────
-- Serve à tela de administração e, depois, ao disparo de notificação.
CREATE OR REPLACE FUNCTION public.usuarios_sem_discord()
RETURNS TABLE (user_id uuid, display_name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.display_name, p.email
    FROM public.profiles p
   WHERE public.tem_acesso_menu('administracao')
     AND coalesce(p.ativo, true)
     AND NOT EXISTS (SELECT 1 FROM public.usuario_discord d WHERE d.user_id = p.id)
   ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.usuarios_sem_discord() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usuarios_sem_discord() TO authenticated;

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS vinculos FROM public.usuario_discord;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════
-- Descrição do perfil ("sobre mim") — migration 20260829000002
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_bio_tamanho;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_tamanho CHECK (bio IS NULL OR length(bio) <= 500);

COMMENT ON COLUMN public.profiles.bio IS
  'Descrição livre escrita pelo próprio usuário em Meu Perfil. Opcional.';

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════
-- CHAMADOS: a conversa vira CHAT DE GRUPO — migration 20260831000001
-- ═══════════════════════════════════════════════════════════════════════
-- ── 1. Anexo pertence à mensagem ─────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_ANEXO"
  ADD COLUMN IF NOT EXISTS evento_id uuid
    REFERENCES public."CHAMADO_SISTEMA_EVENTO"(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_anexo_evento
  ON public."CHAMADO_SISTEMA_ANEXO"(evento_id);

COMMENT ON COLUMN public."CHAMADO_SISTEMA_ANEXO".evento_id IS
  'Mensagem do chat à qual o anexo pertence. NULL = anexo de abertura ou anexo antigo, anterior ao chat.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA_ANEXO".campo IS
  'abertura | chat (mensagem visível ao solicitante) | interno (mensagem só da equipe) | resposta (legado).';

-- O solicitante NÃO pode ver anexo de mensagem interna — antes a policy só
-- olhava o chamado, e um print colado numa observação interna vazaria pra ele.
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO";
CREATE POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = chamado_id
       AND (public.chamado_sistema_gestor()
            OR c.responsavel_id = auth.uid()
            OR (c.solicitante_id = auth.uid() AND campo <> 'interno'))
  ));

-- O bucket liberava SELECT a qualquer autenticado: quem soubesse o caminho
-- baixava o arquivo. Com print colado em mensagem interna isso passa a doer, então
-- o acesso ao objeto agora segue a linha do anexo — a subconsulta roda com a RLS
-- de CHAMADO_SISTEMA_ANEXO aplicada, e o solicitante não acha o print interno.
DROP POLICY IF EXISTS "chamados sistemas anexo select" ON storage.objects;
CREATE POLICY "chamados sistemas anexo select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chamados-sistemas' AND EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA_ANEXO" a WHERE a.storage_path = name
  ));

-- ── 2. Quem enxerga a conversa ───────────────────────────────────────
-- Versão de chamado_sistema_gestor() para um usuário QUALQUER (a original só
-- responde sobre auth.uid()). Precisa disso para saber, de cada participante,
-- se ele enxerga as mensagens internas.
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor_uid(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.screen_permission_user s
     WHERE s.user_id = _uid
       AND s.menu_codigo IN ('chamados_sistemas_painel',
                             'chamados_sistemas_coordenar',
                             'chamados_sistemas_aprovar')
       AND s.acao = 'visualizar'::public.app_acao
       AND s.allow = true
       AND s.empresa_id IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor_uid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor_uid(uuid) TO authenticated;

-- Está no chat deste chamado? (solicitante, responsável ou gestão)
CREATE OR REPLACE FUNCTION public.chamado_pode_conversar(p_chamado_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND (c.solicitante_id = auth.uid()
            OR c.responsavel_id = auth.uid()
            OR public.chamado_sistema_gestor())
  );
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_conversar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pode_conversar(uuid) TO authenticated;

-- ── 3. Até quando cada um leu ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_LEITURA" (
  chamado_id uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  lido_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chamado_id, user_id)
);
COMMENT ON TABLE public."CHAMADO_SISTEMA_LEITURA" IS
  'Carimbo de leitura do chat por pessoa. Mensagem com created_at <= lido_em já foi vista por ela.';

ALTER TABLE public."CHAMADO_SISTEMA_LEITURA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chamado_sistema_leitura_select ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_select ON public."CHAMADO_SISTEMA_LEITURA"
  FOR SELECT TO authenticated
  USING (public.chamado_pode_conversar(chamado_id));

-- Escrita só pela RPC (SECURITY DEFINER): ninguém carimba leitura alheia.
DROP POLICY IF EXISTS chamado_sistema_leitura_upsert ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_upsert ON public."CHAMADO_SISTEMA_LEITURA"
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.chamado_pode_conversar(chamado_id));

DROP POLICY IF EXISTS chamado_sistema_leitura_update ON public."CHAMADO_SISTEMA_LEITURA";
CREATE POLICY chamado_sistema_leitura_update ON public."CHAMADO_SISTEMA_LEITURA"
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.chamado_marcar_lido(p_chamado_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_agora timestamptz := now();
BEGIN
  IF NOT public.chamado_pode_conversar(p_chamado_id) THEN
    RAISE EXCEPTION 'Sem acesso a este chamado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, auth.uid(), v_agora)
  ON CONFLICT (chamado_id, user_id)
  -- Só avança: reabrir uma tela antiga não pode "desler" o que já foi lido.
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  RETURN v_agora;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_marcar_lido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_marcar_lido(uuid) TO authenticated;

-- ── 4. O grupo do chamado ────────────────────────────────────────────
-- Participante = solicitante + responsável + quem já escreveu ou já abriu a
-- conversa. Gestor que nunca entrou não conta: senão "lido por todos" nunca
-- acenderia, porque dependeria de gente que nem sabe do chamado.
CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
RETURNS TABLE(
  user_id     uuid,
  nome        text,
  papel       text,     -- solicitante | responsavel | equipe
  ve_interno  boolean,
  lido_em     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND public.chamado_pode_conversar(p_chamado_id)
  ),
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT e.autor_id FROM public."CHAMADO_SISTEMA_EVENTO" e, ch
     WHERE e.chamado_id = ch.id AND e.autor_id IS NOT NULL
    UNION
    SELECT l.user_id FROM public."CHAMADO_SISTEMA_LEITURA" l, ch
     WHERE l.chamado_id = ch.id
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              ELSE 'equipe' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   ORDER BY 3, 2;
$$;
REVOKE ALL ON FUNCTION public.chamado_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participantes(uuid) TO authenticated;

-- ── 5. Envio de mensagem (o único caminho do chat) ───────────────────
CREATE OR REPLACE FUNCTION public.chamado_enviar_mensagem(
  p_chamado_id uuid,
  p_texto      text,
  p_interno    boolean DEFAULT false,
  p_tem_anexo  boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_solicitante uuid;
  v_responsavel uuid;
  v_status      text;
  v_equipe      boolean;
  v_texto       text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_id          uuid;
BEGIN
  IF v_texto IS NULL AND NOT p_tem_anexo THEN
    RAISE EXCEPTION 'Escreva uma mensagem ou anexe um arquivo.' USING ERRCODE = '22023';
  END IF;

  SELECT c.solicitante_id, c.responsavel_id, c.status
    INTO v_solicitante, v_responsavel, v_status
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = '42704';
  END IF;

  v_equipe := (v_responsavel = v_uid) OR public.chamado_sistema_gestor();

  IF NOT (v_equipe OR v_solicitante = v_uid) THEN
    RAISE EXCEPTION 'Sem acesso à conversa deste chamado.' USING ERRCODE = '42501';
  END IF;
  IF p_interno AND NOT v_equipe THEN
    RAISE EXCEPTION 'Somente a equipe registra mensagens internas.' USING ERRCODE = '42501';
  END IF;
  -- Chamado encerrado ainda aceita registro interno (a equipe documenta o que
  -- ficou), mas não aceita mais conversa com o solicitante.
  IF v_status IN ('concluido', 'reprovado') AND NOT p_interno THEN
    RAISE EXCEPTION 'Chamado encerrado — a conversa está fechada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, v_uid,
          CASE WHEN p_interno THEN 'observacao_interna' ELSE 'comentario' END,
          v_texto)
  RETURNING id INTO v_id;

  -- Quem escreveu já leu a própria mensagem.
  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, v_uid, now())
  ON CONFLICT (chamado_id, user_id)
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  -- Solicitante respondeu o "aguardando retorno" → volta pro time.
  IF v_solicitante = v_uid AND NOT v_equipe AND v_status = 'aguardando_retorno' THEN
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) TO authenticated;

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS leituras FROM public."CHAMADO_SISTEMA_LEITURA";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamado_enviar_mensagem(uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.chamado_participantes(uuid);
--   DROP FUNCTION IF EXISTS public.chamado_marcar_lido(uuid);
--   DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_LEITURA";
--   DROP FUNCTION IF EXISTS public.chamado_pode_conversar(uuid);
--   DROP FUNCTION IF EXISTS public.chamado_sistema_gestor_uid(uuid);
--   ALTER TABLE public."CHAMADO_SISTEMA_ANEXO" DROP COLUMN evento_id;
--   -- e recriar chamado_sistema_anexo_select da 20260802000002
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- CHAMADOS: mensagens não lidas por chamado — migration 20260831000002
-- ═══════════════════════════════════════════════════════════════════════
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamados_nao_lidos()
RETURNS TABLE(
  chamado_id uuid,
  nao_lidos  integer,
  ultima_em  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH eu AS (
    SELECT auth.uid() AS uid, public.chamado_sistema_gestor() AS gestor
  ),
  meus AS (
    -- Chamados em que EU participo. Gestão vê os que coordena/acompanha, mas
    -- só os que já têm conversa — a bolinha é sobre mensagem, não sobre fila.
    SELECT c.id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c, eu
     WHERE c.solicitante_id = eu.uid
        OR c.responsavel_id = eu.uid
        OR eu.gestor
  )
  SELECT m.id,
         count(e.id)::int,
         max(e.created_at)
    FROM meus m
    CROSS JOIN eu
    JOIN public."CHAMADO_SISTEMA_EVENTO" e ON e.chamado_id = m.id
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = m.id AND l.user_id = eu.uid
   WHERE e.autor_id IS DISTINCT FROM eu.uid
     AND e.tipo IN ('comentario', 'observacao_interna')
     AND (e.meta->>'canal') IS NULL
     AND (e.tipo <> 'observacao_interna' OR m.responsavel_id = eu.uid OR eu.gestor)
     AND (l.lido_em IS NULL OR e.created_at > l.lido_em)
   GROUP BY m.id
  HAVING count(e.id) > 0;
$$;
REVOKE ALL ON FUNCTION public.chamados_nao_lidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_nao_lidos() TO authenticated;

COMMENT ON FUNCTION public.chamados_nao_lidos() IS
  'Mensagens não lidas por chamado, para a bolinha vermelha do botão Chat nas listas.';

-- Sem este índice a contagem varre os eventos do chamado inteiro a cada carga
-- da lista, e a tela tem que abrir instantânea.
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_evento_chamado_data
  ON public."CHAMADO_SISTEMA_EVENTO"(chamado_id, created_at DESC);

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS eventos FROM public."CHAMADO_SISTEMA_EVENTO";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamados_nao_lidos();
--   DROP INDEX IF EXISTS public.idx_chamado_sistema_evento_chamado_data;
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- CHAMADOS: grupo da conversa = quem tem acesso — migration 20260831000003
-- ═══════════════════════════════════════════════════════════════════════
-- =====================================================================

DROP FUNCTION IF EXISTS public.chamado_participantes(uuid);

CREATE OR REPLACE FUNCTION public.chamado_participantes(p_chamado_id uuid)
RETURNS TABLE(
  user_id    uuid,
  nome       text,
  papel      text,     -- solicitante | responsavel | gestao
  ve_interno boolean,
  principal  boolean,  -- de quem se espera resposta (solicitante/responsável)
  lido_em    timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH ch AS (
    SELECT c.id, c.solicitante_id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = p_chamado_id
       AND public.chamado_pode_conversar(p_chamado_id)
  ),
  gestores AS (
    SELECT DISTINCT s.user_id AS uid
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_painel',
                             'chamados_sistemas_coordenar',
                             'chamados_sistemas_aprovar')
       AND s.acao = 'visualizar'::public.app_acao
       AND s.allow = true
       AND s.empresa_id IS NULL
  ),
  gente AS (
    SELECT solicitante_id AS uid FROM ch
    UNION
    SELECT responsavel_id FROM ch WHERE responsavel_id IS NOT NULL
    UNION
    SELECT g.uid FROM gestores g CROSS JOIN ch
  )
  SELECT g.uid,
         COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.email), ''), 'Usuário'),
         CASE WHEN g.uid = ch.solicitante_id THEN 'solicitante'
              WHEN g.uid = ch.responsavel_id THEN 'responsavel'
              ELSE 'gestao' END,
         (g.uid = ch.responsavel_id) OR public.chamado_sistema_gestor_uid(g.uid),
         g.uid IN (ch.solicitante_id, ch.responsavel_id),
         l.lido_em
    FROM gente g
    CROSS JOIN ch
    LEFT JOIN public.profiles p ON p.id = g.uid
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = ch.id AND l.user_id = g.uid
   WHERE COALESCE(p.ativo, true)
   ORDER BY CASE WHEN g.uid = ch.solicitante_id THEN 1
                 WHEN g.uid = ch.responsavel_id THEN 2
                 ELSE 3 END,
            2;
$$;
REVOKE ALL ON FUNCTION public.chamado_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_participantes(uuid) TO authenticated;

COMMENT ON FUNCTION public.chamado_participantes(uuid) IS
  'Grupo do chamado = quem tem acesso (solicitante + responsável + gestão), com o carimbo de leitura de cada um.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS gestores FROM (
  SELECT DISTINCT s.user_id
    FROM public.screen_permission_user s
   WHERE s.menu_codigo IN ('chamados_sistemas_painel','chamados_sistemas_coordenar','chamados_sistemas_aprovar')
     AND s.acao = 'visualizar'::public.app_acao AND s.allow AND s.empresa_id IS NULL
) x;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: recriar chamado_participantes como na 20260831000001.
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- CHAMADOS: comentário obrigatório na avaliação + notas uma a uma
--           — migration 20260831000004
-- ═══════════════════════════════════════════════════════════════════════
-- ── 1. Comentário obrigatório quando não é 5 em tudo ─────────────────
ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  DROP CONSTRAINT IF EXISTS chamado_avaliacao_comentario_obrigatorio;

ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
  ADD CONSTRAINT chamado_avaliacao_comentario_obrigatorio CHECK (
    (qualidade = 5 AND prazo = 5 AND comunicacao = 5
     AND clareza = 5 AND facilidade = 5 AND satisfacao = 5)
    OR (comentario IS NOT NULL AND length(btrim(comentario)) >= 10)
  ) NOT VALID;

COMMENT ON CONSTRAINT chamado_avaliacao_comentario_obrigatorio
  ON public."CHAMADO_SISTEMA_AVALIACAO" IS
  'Nota cheia (5 em tudo) dispensa comentário; qualquer critério abaixo de 5 exige pelo menos 10 caracteres explicando o que melhorar.';

-- ── 2. Avaliações uma a uma (para a coordenação) ─────────────────────
DROP FUNCTION IF EXISTS public.chamados_avaliacoes_detalhe();

CREATE OR REPLACE FUNCTION public.chamados_avaliacoes_detalhe()
RETURNS TABLE(
  avaliacao_id   uuid,
  chamado_id     uuid,
  numero         text,
  assunto        text,
  responsavel_id uuid,
  avaliador_id   uuid,
  avaliador_nome text,
  setor          text,
  qualidade      smallint,
  prazo          smallint,
  comunicacao    smallint,
  clareza        smallint,
  facilidade     smallint,
  satisfacao     smallint,
  comentario     text,
  created_at     timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id, c.id, c.numero, c.assunto, c.responsavel_id,
         a.solicitante_id,
         -- O nome do perfil é a fonte boa; solicitante_nome do chamado é o
         -- retrato de quem abriu e serve de reserva.
         COALESCE(NULLIF(btrim(p.display_name), ''),
                  NULLIF(btrim(p.email), ''),
                  NULLIF(btrim(c.solicitante_nome), ''),
                  'Usuário'),
         c.setor,
         a.qualidade, a.prazo, a.comunicacao, a.clareza, a.facilidade, a.satisfacao,
         a.comentario, a.created_at
    FROM public."CHAMADO_SISTEMA_AVALIACAO" a
    JOIN public."CHAMADO_SISTEMA" c ON c.id = a.chamado_id
    LEFT JOIN public.profiles p ON p.id = a.solicitante_id
   WHERE public.chamado_sistema_gestor()
   ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.chamados_avaliacoes_detalhe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_avaliacoes_detalhe() TO authenticated;

COMMENT ON FUNCTION public.chamados_avaliacoes_detalhe() IS
  'Avaliações individuais (quem deu a nota, critérios e comentário) para o Painel de Distribuição. Só gestão.';

-- ── Conferência ──────────────────────────────────────────────────────
-- Quantas avaliações JÁ EXISTENTES não passariam na nova regra (ficam
-- válidas pelo NOT VALID; é só pra saber o tamanho do buraco de informação).
SELECT count(*) FILTER (
         WHERE NOT (qualidade = 5 AND prazo = 5 AND comunicacao = 5
                    AND clareza = 5 AND facilidade = 5 AND satisfacao = 5)
           AND (comentario IS NULL OR length(btrim(comentario)) < 10)
       ) AS sem_comentario_antigas,
       count(*) AS total
  FROM public."CHAMADO_SISTEMA_AVALIACAO";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public."CHAMADO_SISTEMA_AVALIACAO"
--     DROP CONSTRAINT IF EXISTS chamado_avaliacao_comentario_obrigatorio;
--   DROP FUNCTION IF EXISTS public.chamados_avaliacoes_detalhe();
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- CANAL DE ÉTICA E DENÚNCIAS — recebimento próprio — migration 20260812000001
-- ═══════════════════════════════════════════════════════════════════════
-- pgcrypto vive no schema `extensions` neste projeto (padrão do Supabase), por
-- isso as funções abaixo levam `extensions` no search_path: sem ele,
-- crypt/gen_salt/gen_random_bytes não são encontrados em runtime.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1. Tabela ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.canal_denuncia_protocolo_seq;

CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo               text NOT NULL UNIQUE,
  -- bcrypt da senha de acompanhamento; a senha em claro só o denunciante tem.
  senha_hash              text NOT NULL,

  -- Identificação (opcional — anônimo é o padrão)
  identificado            boolean NOT NULL DEFAULT false,
  nome_completo           text,
  cpf                     text,
  email                   text,
  data_nascimento         date,
  telefone_fixo           text,
  celular                 text,

  -- Classificação
  relacao                 text NOT NULL,
  tipo_denuncia           text NOT NULL,
  local_ocorrencia        text,
  como_soube              text NOT NULL,

  -- Envolvimento da liderança (sim | nao | nao_sei)
  lideranca_ciente        text,
  lideranca_envolvida     text,
  lideranca_ocultou       text,

  -- Relato
  descricao               text NOT NULL,
  testemunhas             text,
  evidencias              text,
  valor_financeiro        text,
  sugestao                text,

  -- Tratativa interna (o painel do ERP escreve só daqui pra baixo)
  status                  text NOT NULL DEFAULT 'nova',
  responsavel_user_id     uuid REFERENCES auth.users(id),
  responsavel_definido_em timestamptz,
  parecer_interno         text,
  -- Texto que o denunciante enxerga ao consultar o protocolo.
  retorno_denunciante     text,
  concluido_em            timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT canal_denuncia_status_valido
    CHECK (status IN ('nova', 'em_analise', 'apuracao', 'procedente', 'improcedente', 'arquivada'))
);

COMMENT ON TABLE public."CANAL_DENUNCIA" IS
  'Denúncias recebidas pelo canal próprio (site em dominio a parte). Entrada só via denuncia_registrar; leitura só com o menu central_servicos_canal_denuncias.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".senha_hash IS
  'bcrypt da senha de acompanhamento. Nao existe caminho de volta para a senha em claro — de proposito.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".retorno_denunciante IS
  'Único campo da tratativa que o denunciante enxerga ao consultar protocolo + senha.';

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_status  ON public."CANAL_DENUNCIA"(status);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_criacao ON public."CANAL_DENUNCIA"(created_at DESC);

-- ── 2. Trava: o relato não se reescreve ──────────────────────────────
-- A tratativa muda status/responsável/parecer. Se o conteúdo pudesse ser
-- editado, o registro deixaria de servir como prova do que foi relatado.
CREATE OR REPLACE FUNCTION public.canal_denuncia_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.protocolo           IS DISTINCT FROM OLD.protocolo
  OR NEW.senha_hash          IS DISTINCT FROM OLD.senha_hash
  OR NEW.identificado        IS DISTINCT FROM OLD.identificado
  OR NEW.nome_completo       IS DISTINCT FROM OLD.nome_completo
  OR NEW.cpf                 IS DISTINCT FROM OLD.cpf
  OR NEW.email               IS DISTINCT FROM OLD.email
  OR NEW.data_nascimento     IS DISTINCT FROM OLD.data_nascimento
  OR NEW.telefone_fixo       IS DISTINCT FROM OLD.telefone_fixo
  OR NEW.celular             IS DISTINCT FROM OLD.celular
  OR NEW.relacao             IS DISTINCT FROM OLD.relacao
  OR NEW.tipo_denuncia       IS DISTINCT FROM OLD.tipo_denuncia
  OR NEW.local_ocorrencia    IS DISTINCT FROM OLD.local_ocorrencia
  OR NEW.como_soube          IS DISTINCT FROM OLD.como_soube
  OR NEW.lideranca_ciente    IS DISTINCT FROM OLD.lideranca_ciente
  OR NEW.lideranca_envolvida IS DISTINCT FROM OLD.lideranca_envolvida
  OR NEW.lideranca_ocultou   IS DISTINCT FROM OLD.lideranca_ocultou
  OR NEW.descricao           IS DISTINCT FROM OLD.descricao
  OR NEW.testemunhas         IS DISTINCT FROM OLD.testemunhas
  OR NEW.evidencias          IS DISTINCT FROM OLD.evidencias
  OR NEW.valor_financeiro    IS DISTINCT FROM OLD.valor_financeiro
  OR NEW.sugestao            IS DISTINCT FROM OLD.sugestao
  OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'O conteúdo da denúncia é imutável. A tratativa altera apenas status, responsável, parecer e retorno.'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_guard ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_guard
  BEFORE UPDATE ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_guard();

-- ── 3. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public."CANAL_DENUNCIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CANAL_DENUNCIA" FORCE ROW LEVEL SECURITY;

-- O site é público: garante que a chave anon não alcança a tabela de forma
-- nenhuma. A entrada dele é só a RPC.
REVOKE ALL ON TABLE public."CANAL_DENUNCIA" FROM anon;
GRANT SELECT, UPDATE ON TABLE public."CANAL_DENUNCIA" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_select ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_select ON public."CANAL_DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));

DROP POLICY IF EXISTS canal_denuncia_update ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_update ON public."CANAL_DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- Sem policy de INSERT/DELETE: ninguém cria nem apaga denúncia pela API.

-- ── 4. Registro público (o único caminho de entrada) ─────────────────
CREATE OR REPLACE FUNCTION public.denuncia_registrar(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_protocolo text;
  v_senha     text;
  v_descricao text := btrim(COALESCE(payload->>'descricao', ''));
  v_identif   boolean := COALESCE((payload->>'identificado')::boolean, false);
  v_nasc      date;
  -- Alfabeto sem 0/O/1/I/L: a senha vai ser copiada à mão de um papel.
  v_alfabeto  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i           int;
BEGIN
  IF COALESCE((payload->>'concordou_termo')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'É necessário aceitar o termo para registrar a denúncia.' USING ERRCODE = '22023';
  END IF;
  IF length(v_descricao) < 30 THEN
    RAISE EXCEPTION 'Descreva o fato com mais detalhes (mínimo de 30 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(payload->>'relacao'), '') = ''
     OR COALESCE(btrim(payload->>'tipo_denuncia'), '') = ''
     OR COALESCE(btrim(payload->>'como_soube'), '') = '' THEN
    RAISE EXCEPTION 'Preencha relação, tipo de denúncia e como tomou conhecimento.' USING ERRCODE = '22023';
  END IF;
  IF v_identif AND COALESCE(btrim(payload->>'nome_completo'), '') = '' THEN
    RAISE EXCEPTION 'Quem opta por se identificar precisa informar o nome completo.' USING ERRCODE = '22023';
  END IF;

  v_protocolo := 'DEN-' || to_char(now(), 'YYYY') || '-'
                 || lpad(nextval('public.canal_denuncia_protocolo_seq')::text, 5, '0');

  -- 10 caracteres de gen_random_bytes: ~1,5 milhão de vezes mais combinações
  -- do que um PIN de 6 dígitos, e ainda transcrevível.
  v_senha := '';
  FOR i IN 1..10 LOOP
    v_senha := v_senha || substr(v_alfabeto, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alfabeto)), 1);
  END LOOP;

  BEGIN
    v_nasc := NULLIF(btrim(payload->>'data_nascimento'), '')::date;
  EXCEPTION WHEN others THEN
    v_nasc := NULL;  -- data digitada torta não pode derrubar a denúncia
  END;

  INSERT INTO public."CANAL_DENUNCIA" (
    protocolo, senha_hash, identificado,
    nome_completo, cpf, email, data_nascimento, telefone_fixo, celular,
    relacao, tipo_denuncia, local_ocorrencia, como_soube,
    lideranca_ciente, lideranca_envolvida, lideranca_ocultou,
    descricao, testemunhas, evidencias, valor_financeiro, sugestao
  ) VALUES (
    v_protocolo, crypt(v_senha, gen_salt('bf')), v_identif,
    -- Sem identificação, os campos pessoais nem chegam a ser gravados.
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'nome_completo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'cpf'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'email'), '') END,
    CASE WHEN v_identif THEN v_nasc END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'telefone_fixo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'celular'), '') END,
    btrim(payload->>'relacao'),
    btrim(payload->>'tipo_denuncia'),
    NULLIF(btrim(payload->>'local_ocorrencia'), ''),
    btrim(payload->>'como_soube'),
    NULLIF(btrim(payload->>'lideranca_ciente'), ''),
    NULLIF(btrim(payload->>'lideranca_envolvida'), ''),
    NULLIF(btrim(payload->>'lideranca_ocultou'), ''),
    v_descricao,
    NULLIF(btrim(payload->>'testemunhas'), ''),
    NULLIF(btrim(payload->>'evidencias'), ''),
    NULLIF(btrim(payload->>'valor_financeiro'), ''),
    NULLIF(btrim(payload->>'sugestao'), '')
  );

  -- Única vez em que a senha em claro existe. Some daqui.
  RETURN jsonb_build_object('protocolo', v_protocolo, 'senha', v_senha);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_registrar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_registrar(jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.denuncia_registrar(jsonb) IS
  'Registro público de denúncia (site em dominio a parte, chave anon). Devolve protocolo + senha de acompanhamento — a senha nao e recuperavel depois.';

-- ── 5. Acompanhamento por protocolo + senha ──────────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_protocolo text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE r record;
BEGIN
  SELECT d.protocolo, d.status, d.created_at, d.updated_at,
         d.tipo_denuncia, d.retorno_denunciante, d.concluido_em, d.senha_hash
    INTO r
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')));

  -- Mesma resposta para protocolo inexistente e senha errada: distinguir os
  -- dois casos entregaria de graça quais protocolos existem.
  IF r.protocolo IS NULL OR r.senha_hash <> crypt(COALESCE(p_senha, ''), r.senha_hash) THEN
    RAISE EXCEPTION 'Protocolo ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'protocolo',     r.protocolo,
    'status',        r.status,
    'tipo_denuncia', r.tipo_denuncia,
    'registrada_em', r.created_at,
    'atualizada_em', r.updated_at,
    'concluida_em',  r.concluido_em,
    'retorno',       r.retorno_denunciante
  );
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.denuncia_consultar(text, text) IS
  'Acompanhamento sem login: devolve status e retorno da denuncia para quem tem protocolo + senha. Nao devolve o relato.';

-- ── 6. Tela do painel na matriz de menus ─────────────────────────────
-- Mesmo padrão do resto do ERP (app_modulo/app_menu + Acesso por Usuário).
-- Ninguém ganha acesso aqui: a liberação é por usuário, em
-- Administração › Acesso por Usuário. Enquanto o painel não existir,
-- deixe o menu sem ninguém liberado.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'central_servicos_canal_denuncias', 'Canal de Denúncias', '/app/central-servicos/canal-denuncias', 55
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 7. Conferência ───────────────────────────────────────────────────
SELECT (SELECT count(*) FROM public."CANAL_DENUNCIA")                                    AS denuncias,
       (SELECT count(*) FROM public.app_menu
         WHERE codigo = 'central_servicos_canal_denuncias')                              AS menu_criado,
       has_function_privilege('anon', 'public.denuncia_registrar(jsonb)', 'EXECUTE')     AS anon_registra,
       has_table_privilege('anon', 'public."CANAL_DENUNCIA"', 'SELECT')                  AS anon_le_tabela;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.denuncia_consultar(text, text);
--   DROP FUNCTION IF EXISTS public.denuncia_registrar(jsonb);
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA";
--   DROP FUNCTION IF EXISTS public.canal_denuncia_guard();
--   DROP SEQUENCE IF EXISTS public.canal_denuncia_protocolo_seq;
--   DELETE FROM public.app_menu WHERE codigo = 'central_servicos_canal_denuncias';
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- VEÍCULOS: contratos do grupo no passo 3 — migration 20260812000002
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos()
RETURNS TABLE (
  id             uuid,
  nome           text,
  cliente        text,
  empresa_codigo text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente, e.codigo
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.status = 'ativo'
     -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY c.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos() TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos() IS
  'Contratos ativos do grupo inteiro para o passo 3 do agendamento de veiculos. Gate = menu central_servicos_veiculos; nao afrouxa a RLS de contratos.';

-- ── Conferência ──────────────────────────────────────────────────────
-- Quantos contratos ativos existem por CNPJ (o passo 3 passa a ver todos).
SELECT COALESCE(e.codigo, '(sem empresa)') AS empresa,
       count(*)                            AS contratos_ativos
  FROM public.contratos c
  LEFT JOIN public.empresas e ON e.id = c.empresa_id
 WHERE c.status = 'ativo'
 GROUP BY 1
 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();
--   -- e reverter useContratosParaAgendamento para o .from("contratos")
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════════════
-- VEÍCULOS: contrato encerrado continua agendável — migration 20260812000003
-- ═══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos()
RETURNS TABLE (
  id             uuid,
  nome           text,
  cliente        text,
  empresa_codigo text,
  status         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente, e.codigo, c.status
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
   WHERE public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY (c.status = 'ativo') DESC, c.nome;
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos() TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos() IS
  'Contratos do grupo (ativos e encerrados) para o passo 3 do agendamento de veiculos. Gate = menu central_servicos_veiculos; nao afrouxa a RLS de contratos.';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT COALESCE(status, '(sem status)') AS status, count(*) AS contratos
  FROM public.contratos
 GROUP BY 1
 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK: reaplicar a função da 20260812000002 (só contratos ativos).
-- =====================================================================


-- ═══════════════════════════════════════════════════════════════════════
-- COMITÊ DE ÉTICA: módulo próprio para as denúncias — migration 20260812000004
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'comite_etica', 'Comitê de Ética', 'Denúncias e apuração de conduta',
       'ShieldAlert',
       COALESCE((SELECT max(ordem) FROM public.app_modulo), 200) + 5
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'comite_etica');

-- Painel do canal próprio (o que recebe as denúncias do formulário público).
UPDATE public.app_menu am
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica'),
       nome      = 'Denúncias',
       rota      = '/app/comite-etica/denuncias',
       ordem     = 10
 WHERE am.codigo = 'central_servicos_canal_denuncias';

-- Espelho legado da Contato Seguro: fica no mesmo módulo, mas identificado
-- pela origem, senão as duas telas viram "Denúncias" e ninguém sabe qual é.
UPDATE public.app_menu am
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica'),
       nome      = 'Denúncias (Contato Seguro)',
       rota      = '/app/comite-etica/denuncias-contato-seguro',
       ordem     = 20
 WHERE am.codigo = 'central_servicos_denuncias';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT m.codigo AS modulo, am.codigo AS menu, am.nome, am.rota
  FROM public.app_menu am
  JOIN public.app_modulo m ON m.id = am.modulo_id
 WHERE am.codigo IN ('central_servicos_canal_denuncias', 'central_servicos_denuncias')
 ORDER BY am.ordem;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo='central_servicos'),
--          nome='Denúncias (Canal de Ética)', rota='/app/central-servicos/denuncias', ordem=50
--    WHERE codigo='central_servicos_denuncias';
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo='central_servicos'),
--          nome='Canal de Denúncias', rota='/app/central-servicos/canal-denuncias', ordem=55
--    WHERE codigo='central_servicos_canal_denuncias';
--   DELETE FROM public.app_modulo WHERE codigo='comite_etica';
-- =====================================================================


-- ═══════════════════════════════════════════════════════════════════════
-- VEÍCULOS: passo 3 lê a tabela "CONTRATOS" — migration 20260812000005
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. O vínculo guarda o código da "CONTRATOS" ──────────────────────
ALTER TABLE public.cs_veiculo_agendamento_contrato
  ADD COLUMN IF NOT EXISTS contrato_codigo bigint;

COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.contrato_codigo IS
  'id da tabela "CONTRATOS" (maiuscula). NULL = vinculo antigo (ver contrato_id) ou viagem ADMINISTRATIVA.';
COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.contrato_id IS
  'LEGADO: uuid de public.contratos, usado ate 08/2026. Vinculos novos gravam contrato_codigo.';

-- Marca a viagem que não atende contrato nenhum (tarefa administrativa).
-- Sem esta coluna, "administrativo" e "vínculo antigo" seriam os dois um
-- código nulo, e não daria para separar um do outro no relatório.
ALTER TABLE public.cs_veiculo_agendamento_contrato
  ADD COLUMN IF NOT EXISTS administrativo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cs_veiculo_agendamento_contrato.administrativo IS
  'true = viagem administrativa, sem contrato especifico. contrato_codigo fica NULL.';

-- Mesmo contrato duas vezes na mesma reserva não faz sentido.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_veic_agend_contrato_codigo
  ON public.cs_veiculo_agendamento_contrato(agendamento_id, contrato_codigo)
  WHERE contrato_codigo IS NOT NULL;

-- ── 2. A RPC lê "CONTRATOS" ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cs_veiculos_contratos();
DROP FUNCTION IF EXISTS public.cs_veiculos_contratos(boolean);

CREATE OR REPLACE FUNCTION public.cs_veiculos_contratos(p_incluir_inativos boolean DEFAULT false)
RETURNS TABLE (
  codigo  bigint,
  nome    text,
  empresa text,
  ativo   boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id,
         btrim(c."NOME CONTRATO"),
         NULLIF(btrim(c."NOME EMPRESA"), ''),
         (upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM')
    FROM public."CONTRATOS" c
   -- O menu é o gate, igual à cs_veiculos_frota(). Sem ele, nada volta.
   WHERE public.tem_acesso_menu('central_servicos_veiculos')
     AND COALESCE(btrim(c."NOME CONTRATO"), '') <> ''
     AND (p_incluir_inativos OR upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM')
   ORDER BY (upper(btrim(COALESCE(c."ATIVO", ''))) = 'SIM') DESC, btrim(c."NOME CONTRATO");
$$;
REVOKE ALL ON FUNCTION public.cs_veiculos_contratos(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_contratos(boolean) TO authenticated;

COMMENT ON FUNCTION public.cs_veiculos_contratos(boolean) IS
  'Contratos da tabela "CONTRATOS" para o passo 3 do agendamento. Padrao = so ATIVO=SIM; p_incluir_inativos traz os demais. Gate = menu central_servicos_veiculos.';

-- ── 3. Conferência ───────────────────────────────────────────────────
SELECT upper(btrim(COALESCE("ATIVO", '(nulo)'))) AS ativo, count(*) AS contratos
  FROM public."CONTRATOS"
 WHERE COALESCE(btrim("NOME CONTRATO"), '') <> ''
 GROUP BY 1 ORDER BY 2 DESC;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cs_veiculos_contratos(boolean);
--   DROP INDEX IF EXISTS public.uq_cs_veic_agend_contrato_codigo;
--   ALTER TABLE public.cs_veiculo_agendamento_contrato
--     DROP COLUMN IF EXISTS contrato_codigo, DROP COLUMN IF EXISTS administrativo;
--   -- e recriar a cs_veiculos_contratos() da 20260812000003
-- =====================================================================

-- ===== 20260901000002_canal_denuncia_lideranca_quem =====
-- =====================================================================
-- CANAL DE DENÚNCIAS — quem é a liderança citada
--
-- As três perguntas de "Envolvimento da liderança" respondiam só sim/não/
-- não sei. Quando a resposta é SIM, o comitê precisa saber DE QUEM se trata
-- para decidir quem pode conduzir a apuração — e hoje esse nome acabava
-- diluído no meio do relato, ou nem vinha.
--
-- Três colunas novas, opcionais: quem responde "sim" pode nomear as pessoas
-- (ou testemunhas do ocorrido), mas não é obrigado. Segue a mesma regra de
-- todo o resto do relato: entra pela RPC pública e depois é imutável.
--
-- Ver 20260812000001_canal_denuncias.sql (tabela, trava e RPC originais).
-- =====================================================================

ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS lideranca_ciente_quem    text,
  ADD COLUMN IF NOT EXISTS lideranca_envolvida_quem text,
  ADD COLUMN IF NOT EXISTS lideranca_ocultou_quem   text;

COMMENT ON COLUMN public."CANAL_DENUNCIA".lideranca_ciente_quem IS
  'Quem está ciente do fato — texto livre e opcional, preenchido quando lideranca_ciente = sim.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".lideranca_envolvida_quem IS
  'Quem está envolvido no fato — texto livre e opcional, preenchido quando lideranca_envolvida = sim.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".lideranca_ocultou_quem IS
  'Quem tentou esconder o fato — texto livre e opcional, preenchido quando lideranca_ocultou = sim.';

-- ── Trava: as colunas novas também são parte do relato ───────────────
-- Sem entrar aqui, o painel da tratativa conseguiria reescrever os nomes
-- depois — exatamente o que a trava original existe para impedir.
CREATE OR REPLACE FUNCTION public.canal_denuncia_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.protocolo                IS DISTINCT FROM OLD.protocolo
  OR NEW.senha_hash               IS DISTINCT FROM OLD.senha_hash
  OR NEW.identificado             IS DISTINCT FROM OLD.identificado
  OR NEW.nome_completo            IS DISTINCT FROM OLD.nome_completo
  OR NEW.cpf                      IS DISTINCT FROM OLD.cpf
  OR NEW.email                    IS DISTINCT FROM OLD.email
  OR NEW.data_nascimento          IS DISTINCT FROM OLD.data_nascimento
  OR NEW.telefone_fixo            IS DISTINCT FROM OLD.telefone_fixo
  OR NEW.celular                  IS DISTINCT FROM OLD.celular
  OR NEW.relacao                  IS DISTINCT FROM OLD.relacao
  OR NEW.tipo_denuncia            IS DISTINCT FROM OLD.tipo_denuncia
  OR NEW.local_ocorrencia         IS DISTINCT FROM OLD.local_ocorrencia
  OR NEW.como_soube               IS DISTINCT FROM OLD.como_soube
  OR NEW.lideranca_ciente         IS DISTINCT FROM OLD.lideranca_ciente
  OR NEW.lideranca_envolvida      IS DISTINCT FROM OLD.lideranca_envolvida
  OR NEW.lideranca_ocultou        IS DISTINCT FROM OLD.lideranca_ocultou
  OR NEW.lideranca_ciente_quem    IS DISTINCT FROM OLD.lideranca_ciente_quem
  OR NEW.lideranca_envolvida_quem IS DISTINCT FROM OLD.lideranca_envolvida_quem
  OR NEW.lideranca_ocultou_quem   IS DISTINCT FROM OLD.lideranca_ocultou_quem
  OR NEW.descricao                IS DISTINCT FROM OLD.descricao
  OR NEW.testemunhas              IS DISTINCT FROM OLD.testemunhas
  OR NEW.evidencias               IS DISTINCT FROM OLD.evidencias
  OR NEW.valor_financeiro         IS DISTINCT FROM OLD.valor_financeiro
  OR NEW.sugestao                 IS DISTINCT FROM OLD.sugestao
  OR NEW.created_at               IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'O conteúdo da denúncia é imutável. A tratativa altera apenas status, responsável, parecer e retorno.'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── Registro público: grava o "quem" só quando a resposta foi "sim" ──
CREATE OR REPLACE FUNCTION public.denuncia_registrar(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_protocolo text;
  v_senha     text;
  v_descricao text := btrim(COALESCE(payload->>'descricao', ''));
  v_identif   boolean := COALESCE((payload->>'identificado')::boolean, false);
  v_nasc      date;
  -- Alfabeto sem 0/O/1/I/L: a senha vai ser copiada à mão de um papel.
  v_alfabeto  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i           int;
BEGIN
  IF COALESCE((payload->>'concordou_termo')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'É necessário aceitar o termo para registrar a denúncia.' USING ERRCODE = '22023';
  END IF;
  IF length(v_descricao) < 30 THEN
    RAISE EXCEPTION 'Descreva o fato com mais detalhes (mínimo de 30 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(payload->>'relacao'), '') = ''
     OR COALESCE(btrim(payload->>'tipo_denuncia'), '') = ''
     OR COALESCE(btrim(payload->>'como_soube'), '') = '' THEN
    RAISE EXCEPTION 'Preencha relação, tipo de denúncia e como tomou conhecimento.' USING ERRCODE = '22023';
  END IF;
  IF v_identif AND COALESCE(btrim(payload->>'nome_completo'), '') = '' THEN
    RAISE EXCEPTION 'Quem opta por se identificar precisa informar o nome completo.' USING ERRCODE = '22023';
  END IF;

  v_protocolo := 'DEN-' || to_char(now(), 'YYYY') || '-'
                 || lpad(nextval('public.canal_denuncia_protocolo_seq')::text, 5, '0');

  -- 10 caracteres de gen_random_bytes: ~1,5 milhão de vezes mais combinações
  -- do que um PIN de 6 dígitos, e ainda transcrevível.
  v_senha := '';
  FOR i IN 1..10 LOOP
    v_senha := v_senha || substr(v_alfabeto, 1 + (get_byte(gen_random_bytes(1), 0) % length(v_alfabeto)), 1);
  END LOOP;

  BEGIN
    v_nasc := NULLIF(btrim(payload->>'data_nascimento'), '')::date;
  EXCEPTION WHEN others THEN
    v_nasc := NULL;  -- data digitada torta não pode derrubar a denúncia
  END;

  INSERT INTO public."CANAL_DENUNCIA" (
    protocolo, senha_hash, identificado,
    nome_completo, cpf, email, data_nascimento, telefone_fixo, celular,
    relacao, tipo_denuncia, local_ocorrencia, como_soube,
    lideranca_ciente, lideranca_envolvida, lideranca_ocultou,
    lideranca_ciente_quem, lideranca_envolvida_quem, lideranca_ocultou_quem,
    descricao, testemunhas, evidencias, valor_financeiro, sugestao
  ) VALUES (
    v_protocolo, crypt(v_senha, gen_salt('bf')), v_identif,
    -- Sem identificação, os campos pessoais nem chegam a ser gravados.
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'nome_completo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'cpf'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'email'), '') END,
    CASE WHEN v_identif THEN v_nasc END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'telefone_fixo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'celular'), '') END,
    btrim(payload->>'relacao'),
    btrim(payload->>'tipo_denuncia'),
    NULLIF(btrim(payload->>'local_ocorrencia'), ''),
    btrim(payload->>'como_soube'),
    NULLIF(btrim(payload->>'lideranca_ciente'), ''),
    NULLIF(btrim(payload->>'lideranca_envolvida'), ''),
    NULLIF(btrim(payload->>'lideranca_ocultou'), ''),
    -- O nome só faz sentido junto de um "sim"; se a resposta mudou para não,
    -- o texto que tenha sobrado na tela do denunciante é descartado aqui.
    CASE WHEN btrim(COALESCE(payload->>'lideranca_ciente', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_ciente_quem'), '') END,
    CASE WHEN btrim(COALESCE(payload->>'lideranca_envolvida', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_envolvida_quem'), '') END,
    CASE WHEN btrim(COALESCE(payload->>'lideranca_ocultou', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_ocultou_quem'), '') END,
    v_descricao,
    NULLIF(btrim(payload->>'testemunhas'), ''),
    NULLIF(btrim(payload->>'evidencias'), ''),
    NULLIF(btrim(payload->>'valor_financeiro'), ''),
    NULLIF(btrim(payload->>'sugestao'), '')
  );

  -- Única vez em que a senha em claro existe. Some daqui.
  RETURN jsonb_build_object('protocolo', v_protocolo, 'senha', v_senha);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_registrar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_registrar(jsonb) TO anon, authenticated;

-- Sem isso o PostgREST continua servindo o schema antigo e as colunas novas
-- somem da tela do comitê, mesmo já existindo no banco.
NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   ALTER TABLE public."CANAL_DENUNCIA"
--     DROP COLUMN IF EXISTS lideranca_ciente_quem,
--     DROP COLUMN IF EXISTS lideranca_envolvida_quem,
--     DROP COLUMN IF EXISTS lideranca_ocultou_quem;
--   -- e recriar canal_denuncia_guard() + denuncia_registrar() da 20260812000001

-- ===== 20260901000003_comite_etica_indicadores =====
-- =====================================================================
-- COMITÊ DE ÉTICA — ficha de apuração e base dos indicadores
--
-- POR QUE
-- Até aqui a tratativa de uma denúncia guardava três coisas: status, parecer
-- e retorno. Dá para responder "o que aconteceu com o protocolo X", mas não
-- dá para responder "quais contratos concentram risco", "as medidas estão
-- sendo eficazes" ou "isso é falha de processo ou de comportamento" — que é
-- justamente o que transforma o comitê em ferramenta de gestão de risco.
--
-- O QUE MUDA
--   1. SITUAÇÃO separada de RESULTADO. Antes 'procedente' era status, então
--      um caso julgado procedente que ainda aguardava o cumprimento da medida
--      não tinha como ser representado. Agora `status` diz onde o processo
--      está e `resultado` diz no que deu.
--   2. Campos de ficha: origem, reclassificação pelo comitê, pessoas
--      envolvidas, gravidade, sigilo, investigação, medidas, recurso,
--      causa raiz e encaminhamentos.
--   3. SLA por gravidade em tabela própria — crítica não pode ter o mesmo
--      prazo de baixa, e o prazo é decisão de gestão, não constante de código.
--   4. Menu do dashboard + RLS aceitando os dois menus do módulo.
--
-- O QUE **NÃO** MUDA
-- O relato continua imutável: a trava `canal_denuncia_guard` segue protegendo
-- tudo que veio do denunciante. Todas as colunas criadas aqui são da
-- tratativa, ficam FORA da trava de propósito — é o comitê que as preenche.
--
-- Reincidência, tempo médio, % dentro do SLA e afins não viram coluna: são
-- derivados na leitura. Indicador gravado em coluna congela na hora do
-- cadastro e passa a mentir assim que um caso novo entra.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Ficha de apuração ─────────────────────────────────────────────
ALTER TABLE public."CANAL_DENUNCIA"
  -- Identificação
  ADD COLUMN IF NOT EXISTS origem                   text,
  -- Classificação do comitê (o denunciante já escolheu um tipo; o comitê
  -- pode discordar, e é a leitura dele que vale no indicador).
  ADD COLUMN IF NOT EXISTS tipo_classificado        text,
  ADD COLUMN IF NOT EXISTS gravidade                text,
  ADD COLUMN IF NOT EXISTS sigilo                   text,
  -- Pessoas e recorte organizacional. O id do empregado permite contar
  -- reincidência mesmo quando o nome vier escrito diferente; o nome é
  -- guardado junto como retrato do momento, porque EMPREGADOS é reimportado
  -- da folha e a linha pode mudar de conteúdo depois.
  ADD COLUMN IF NOT EXISTS denunciado_nome          text,
  ADD COLUMN IF NOT EXISTS denunciado_empregado_id  bigint,
  ADD COLUMN IF NOT EXISTS lider_nome               text,
  ADD COLUMN IF NOT EXISTS lider_empregado_id       bigint,
  ADD COLUMN IF NOT EXISTS diretoria                text,
  ADD COLUMN IF NOT EXISTS contrato                 text,
  ADD COLUMN IF NOT EXISTS setor                    text,
  ADD COLUMN IF NOT EXISTS unidade                  text,
  ADD COLUMN IF NOT EXISTS cidade                   text,
  -- Investigação
  ADD COLUMN IF NOT EXISTS apuracao_responsavel     text,
  ADD COLUMN IF NOT EXISTS apuracao_inicio          date,
  ADD COLUMN IF NOT EXISTS apuracao_fim             date,
  -- Marca o fim do "tempo até a primeira providência" — indicador de
  -- responsividade, diferente do tempo total de conclusão.
  ADD COLUMN IF NOT EXISTS primeira_providencia_em  timestamptz,
  -- Desfecho
  ADD COLUMN IF NOT EXISTS resultado                text,
  ADD COLUMN IF NOT EXISTS medidas                  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS houve_recurso            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurso_resultado        text,
  ADD COLUMN IF NOT EXISTS recurso_data             date,
  ADD COLUMN IF NOT EXISTS causa_raiz               text,
  ADD COLUMN IF NOT EXISTS causa_raiz_detalhe       text,
  ADD COLUMN IF NOT EXISTS acoes_preventivas        text,
  ADD COLUMN IF NOT EXISTS acoes_corretivas         text,
  -- Prazo pactuado para ESTE caso. Fica nulo no caso comum e o painel usa o
  -- SLA da gravidade; preenchido, vence a régua geral (caso excepcional).
  ADD COLUMN IF NOT EXISTS sla_dias_override        integer;

COMMENT ON COLUMN public."CANAL_DENUNCIA".tipo_classificado IS
  'Tipo segundo o comitê. Indicadores usam COALESCE(tipo_classificado, tipo_denuncia).';
COMMENT ON COLUMN public."CANAL_DENUNCIA".medidas IS
  'Medidas aplicadas (multiplas). Valores em src/pages/comite-etica/vocabulario.ts.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".sla_dias_override IS
  'Prazo especifico deste caso. Nulo = usa COMITE_ETICA_SLA pela gravidade.';

-- ── 2. Situação x resultado: traduz o modelo antigo ──────────────────
-- Antes o desfecho morava em `status`. Quem já estava assim vira encerrada
-- com o resultado preenchido, senão o caso sumiria dos dois indicadores.
UPDATE public."CANAL_DENUNCIA"
   SET resultado = COALESCE(resultado, status),
       status    = 'encerrada'
 WHERE status IN ('procedente', 'improcedente', 'arquivada');

UPDATE public."CANAL_DENUNCIA"
   SET status = 'investigacao'
 WHERE status = 'apuracao';

-- ── 3. Domínios ──────────────────────────────────────────────────────
-- NOT VALID em nada: a tabela é pequena e vale falhar aqui se algum valor
-- legado não couber, em vez de descobrir pelo indicador torto meses depois.
DO $$
BEGIN
  -- A 20260812000001 criou `canal_denuncia_status_valido` com os valores
  -- antigos. CHECKs são cumulativos: deixá-lo de pé faria a interseção com o
  -- novo domínio ser só 'nova' e 'em_analise', e gravar "Em investigação"
  -- passaria a estourar. Some antes de o novo entrar.
  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_status_valido;

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_status_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_status_chk
    CHECK (status IN ('nova','em_analise','aguardando_documentos','investigacao','julgada','encerrada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_resultado_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_resultado_chk
    CHECK (resultado IS NULL OR resultado IN ('procedente','parcialmente_procedente','improcedente','arquivada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_gravidade_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_gravidade_chk
    CHECK (gravidade IS NULL OR gravidade IN ('baixa','media','alta','critica'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_sigilo_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_sigilo_chk
    CHECK (sigilo IS NULL OR sigilo IN ('sigilosa','identificada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_recurso_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_recurso_chk
    CHECK (recurso_resultado IS NULL OR recurso_resultado IN ('mantida','parcialmente_reformada','reformada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_causa_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_causa_chk
    CHECK (causa_raiz IS NULL OR causa_raiz IN ('falha_lideranca','comunicacao','treinamento','processo',
                                                'comportamento_individual','descumprimento_norma',
                                                'clima_organizacional','outro'));
END $$;

-- Índices dos recortes que o painel agrupa com mais frequência.
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_contrato  ON public."CANAL_DENUNCIA"(contrato);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_setor     ON public."CANAL_DENUNCIA"(setor);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_lider     ON public."CANAL_DENUNCIA"(lider_empregado_id);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_denunciado ON public."CANAL_DENUNCIA"(denunciado_empregado_id);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_resultado ON public."CANAL_DENUNCIA"(resultado);

-- ── 4. SLA por gravidade ─────────────────────────────────────────────
-- Prazo é decisão de gestão: fica em tabela para a dona ajustar sem deploy.
CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_SLA" (
  gravidade   text PRIMARY KEY
              CHECK (gravidade IN ('baixa','media','alta','critica')),
  dias        integer NOT NULL CHECK (dias > 0),
  -- Prazo para a PRIMEIRA providência (acusar recebimento, abrir apuração).
  dias_primeira_providencia integer NOT NULL DEFAULT 2 CHECK (dias_primeira_providencia > 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."COMITE_ETICA_SLA" (gravidade, dias, dias_primeira_providencia) VALUES
  ('critica', 10, 1),
  ('alta',    20, 2),
  ('media',   30, 3),
  ('baixa',   45, 5)
ON CONFLICT (gravidade) DO NOTHING;

ALTER TABLE public."COMITE_ETICA_SLA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."COMITE_ETICA_SLA" FROM anon;
GRANT SELECT, UPDATE ON TABLE public."COMITE_ETICA_SLA" TO authenticated;

DROP POLICY IF EXISTS comite_etica_sla_select ON public."COMITE_ETICA_SLA";
CREATE POLICY comite_etica_sla_select ON public."COMITE_ETICA_SLA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

DROP POLICY IF EXISTS comite_etica_sla_update ON public."COMITE_ETICA_SLA";
CREATE POLICY comite_etica_sla_update ON public."COMITE_ETICA_SLA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 5. RLS da denúncia: quem vê o painel também lê a base ────────────
-- Sem isto, liberar só o dashboard entrega uma tela de zeros: a policy
-- barra o SELECT e o painel não tem como saber que foi a RLS.
DROP POLICY IF EXISTS canal_denuncia_select ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_select ON public."CANAL_DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

-- Escrita continua exclusiva de quem trata a denúncia.
DROP POLICY IF EXISTS canal_denuncia_update ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_update ON public."CANAL_DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 6. Menu do painel ────────────────────────────────────────────────
INSERT INTO public.app_menu (codigo, nome, rota, ordem, modulo_id)
SELECT 'comite_etica_indicadores', 'Indicadores', '/app/comite-etica/indicadores', 5,
       (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica')
WHERE NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'comite_etica_indicadores')
  AND EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'comite_etica');

-- ── Conferência ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='CANAL_DENUNCIA'
      AND column_name IN ('origem','tipo_classificado','gravidade','sigilo','denunciado_nome',
                          'denunciado_empregado_id','lider_nome','lider_empregado_id','diretoria',
                          'contrato','setor','unidade','cidade','apuracao_responsavel','apuracao_inicio',
                          'apuracao_fim','primeira_providencia_em','resultado','medidas','houve_recurso',
                          'recurso_resultado','recurso_data','causa_raiz','causa_raiz_detalhe',
                          'acoes_preventivas','acoes_corretivas','sla_dias_override')) AS colunas_ficha,
  (SELECT count(*) FROM public."COMITE_ETICA_SLA")                                     AS linhas_sla,
  (SELECT count(*) FROM public.app_menu WHERE codigo='comite_etica_indicadores')       AS menu_painel;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo='comite_etica_indicadores';
--   DROP TABLE IF EXISTS public."COMITE_ETICA_SLA";
--   ALTER TABLE public."CANAL_DENUNCIA"
--     DROP CONSTRAINT IF EXISTS canal_denuncia_status_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_resultado_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_gravidade_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_sigilo_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_recurso_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_causa_chk,
--     DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS tipo_classificado,
--     DROP COLUMN IF EXISTS gravidade, DROP COLUMN IF EXISTS sigilo,
--     DROP COLUMN IF EXISTS denunciado_nome, DROP COLUMN IF EXISTS denunciado_empregado_id,
--     DROP COLUMN IF EXISTS lider_nome, DROP COLUMN IF EXISTS lider_empregado_id,
--     DROP COLUMN IF EXISTS diretoria, DROP COLUMN IF EXISTS contrato,
--     DROP COLUMN IF EXISTS setor, DROP COLUMN IF EXISTS unidade, DROP COLUMN IF EXISTS cidade,
--     DROP COLUMN IF EXISTS apuracao_responsavel, DROP COLUMN IF EXISTS apuracao_inicio,
--     DROP COLUMN IF EXISTS apuracao_fim, DROP COLUMN IF EXISTS primeira_providencia_em,
--     DROP COLUMN IF EXISTS resultado, DROP COLUMN IF EXISTS medidas,
--     DROP COLUMN IF EXISTS houve_recurso, DROP COLUMN IF EXISTS recurso_resultado,
--     DROP COLUMN IF EXISTS recurso_data, DROP COLUMN IF EXISTS causa_raiz,
--     DROP COLUMN IF EXISTS causa_raiz_detalhe, DROP COLUMN IF EXISTS acoes_preventivas,
--     DROP COLUMN IF EXISTS acoes_corretivas, DROP COLUMN IF EXISTS sla_dias_override;
--   -- e recriar as policies canal_denuncia_select/update da 20260812000001
-- =====================================================================

-- ===== 20260901000004_denuncia_consultar_resultado =====
-- =====================================================================
-- CANAL DE DENÚNCIAS — a consulta pública passa a devolver o resultado
--
-- POR QUE
-- A 20260901000003 separou SITUAÇÃO de RESULTADO. Antes, "procedente" era o
-- próprio status, então quem consultava o protocolo via o desfecho de graça.
-- Depois da separação, o status de um caso terminado é só "encerrada" — sem
-- esta função devolver `resultado`, o denunciante PERDERIA a informação que
-- já recebia hoje. Isso não é campo novo para ele: é manter o que existia.
--
-- Continua não devolvendo o relato, nem parecer interno, nem nome de
-- ninguém — só protocolo, andamento, desfecho e o retorno escrito para ele.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_protocolo text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE r record;
BEGIN
  SELECT d.protocolo, d.status, d.resultado, d.created_at, d.updated_at,
         d.tipo_denuncia, d.retorno_denunciante, d.concluido_em, d.senha_hash
    INTO r
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')));

  -- Mesma resposta para protocolo inexistente e senha errada: distinguir os
  -- dois casos entregaria de graça quais protocolos existem.
  IF r.protocolo IS NULL OR r.senha_hash <> crypt(COALESCE(p_senha, ''), r.senha_hash) THEN
    RAISE EXCEPTION 'Protocolo ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'protocolo',     r.protocolo,
    'status',        r.status,
    'resultado',     r.resultado,
    'tipo_denuncia', r.tipo_denuncia,
    'registrada_em', r.created_at,
    'atualizada_em', r.updated_at,
    'concluida_em',  r.concluido_em,
    'retorno',       r.retorno_denunciante
  );
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: recriar a versão da 20260812000001 (sem 'resultado' no retorno).

-- ===== 20260901000005_denuncia_acesso_por_email =====
-- =====================================================================
-- CANAL DE DENÚNCIAS — acesso por e-mail e senha escolhida
--
-- POR QUE
-- O acompanhamento dependia de decorar um protocolo (`DEN-2026-00001`) e uma
-- senha sorteada de 10 caracteres. Na prática ninguém guarda isso, e quem
-- perdia não tinha recuperação — o caso simplesmente sumia para o denunciante.
--
-- O QUE MUDA
--   1. O e-mail passa a ser a chave de acesso, e é OBRIGATÓRIO.
--   2. A senha é escolhida pela pessoa (mínimo de 8 caracteres), não sorteada.
--   3. A consulta deixa de ser por protocolo: informa e-mail + senha e recebe
--      TODAS as denúncias daquele e-mail cuja senha confere.
--   4. O protocolo continua existindo como número do processo — é o que o
--      comitê usa e o que aparece no relatório —, só deixa de ser credencial.
--
-- ⚠️ CONSEQUÊNCIA ACEITA PELA GESTÃO: acaba a denúncia anônima. Sem e-mail
-- não há registro. Quem apura passa a ter sempre um contato do denunciante.
-- A RPC continua NÃO gravando IP, user-agent nem auth.uid() — o que se perde
-- é o anonimato por escolha, não o resto da proteção.
--
-- A senha continua guardada só como hash bcrypt: nem o comitê a lê.
-- =====================================================================

-- Busca por e-mail sem depender de caixa: 'Joao@X.com' e 'joao@x.com' são o
-- mesmo acesso, e sem o índice funcional o LOWER() faria varredura completa.
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_email_lower
  ON public."CANAL_DENUNCIA" (lower(btrim(email)));

COMMENT ON COLUMN public."CANAL_DENUNCIA".email IS
  'Chave de acesso do denunciante (obrigatoria desde 20260901000005). Imutavel pela trava canal_denuncia_guard.';

-- ── Registro: e-mail obrigatório, senha escolhida ────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_registrar(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_protocolo text;
  v_descricao text := btrim(COALESCE(payload->>'descricao', ''));
  v_email     text := lower(btrim(COALESCE(payload->>'email', '')));
  v_senha     text := COALESCE(payload->>'senha', '');
  v_identif   boolean := COALESCE((payload->>'identificado')::boolean, false);
  v_nasc      date;
BEGIN
  IF COALESCE((payload->>'concordou_termo')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'É necessário aceitar o termo para registrar a denúncia.' USING ERRCODE = '22023';
  END IF;

  -- Validação de formato mínima e proposital: barra digitação errada sem
  -- tentar adivinhar se a caixa existe (isso o envio de confirmação dirá).
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Informe um e-mail válido — é por ele que você acompanha a denúncia.' USING ERRCODE = '22023';
  END IF;
  IF length(v_senha) < 8 THEN
    RAISE EXCEPTION 'A senha precisa ter pelo menos 8 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF length(v_descricao) < 30 THEN
    RAISE EXCEPTION 'Descreva o fato com mais detalhes (mínimo de 30 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(payload->>'relacao'), '') = ''
     OR COALESCE(btrim(payload->>'tipo_denuncia'), '') = ''
     OR COALESCE(btrim(payload->>'como_soube'), '') = '' THEN
    RAISE EXCEPTION 'Preencha relação, tipo de denúncia e como tomou conhecimento.' USING ERRCODE = '22023';
  END IF;
  IF v_identif AND COALESCE(btrim(payload->>'nome_completo'), '') = '' THEN
    RAISE EXCEPTION 'Quem opta por informar o nome precisa preenchê-lo.' USING ERRCODE = '22023';
  END IF;

  v_protocolo := 'DEN-' || to_char(now(), 'YYYY') || '-'
                 || lpad(nextval('public.canal_denuncia_protocolo_seq')::text, 5, '0');

  BEGIN
    v_nasc := NULLIF(btrim(payload->>'data_nascimento'), '')::date;
  EXCEPTION WHEN others THEN
    v_nasc := NULL;  -- data digitada torta não pode derrubar a denúncia
  END;

  INSERT INTO public."CANAL_DENUNCIA" (
    protocolo, senha_hash, identificado,
    nome_completo, cpf, email, data_nascimento, telefone_fixo, celular,
    relacao, tipo_denuncia, local_ocorrencia, como_soube,
    lideranca_ciente, lideranca_envolvida, lideranca_ocultou,
    lideranca_ciente_quem, lideranca_envolvida_quem, lideranca_ocultou_quem,
    descricao, testemunhas, evidencias, valor_financeiro, sugestao
  ) VALUES (
    v_protocolo, crypt(v_senha, gen_salt('bf')), v_identif,
    -- Nome e documento continuam opcionais: o e-mail identifica o acesso, mas
    -- a pessoa ainda escolhe se diz quem é.
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'nome_completo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'cpf'), '') END,
    v_email,
    CASE WHEN v_identif THEN v_nasc END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'telefone_fixo'), '') END,
    NULLIF(btrim(payload->>'celular'), ''),   -- usado para a confirmação no WhatsApp
    btrim(payload->>'relacao'),
    btrim(payload->>'tipo_denuncia'),
    NULLIF(btrim(payload->>'local_ocorrencia'), ''),
    btrim(payload->>'como_soube'),
    NULLIF(btrim(payload->>'lideranca_ciente'), ''),
    NULLIF(btrim(payload->>'lideranca_envolvida'), ''),
    NULLIF(btrim(payload->>'lideranca_ocultou'), ''),
    CASE WHEN btrim(COALESCE(payload->>'lideranca_ciente', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_ciente_quem'), '') END,
    CASE WHEN btrim(COALESCE(payload->>'lideranca_envolvida', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_envolvida_quem'), '') END,
    CASE WHEN btrim(COALESCE(payload->>'lideranca_ocultou', '')) = 'sim'
         THEN NULLIF(btrim(payload->>'lideranca_ocultou_quem'), '') END,
    v_descricao,
    NULLIF(btrim(payload->>'testemunhas'), ''),
    NULLIF(btrim(payload->>'evidencias'), ''),
    NULLIF(btrim(payload->>'valor_financeiro'), ''),
    NULLIF(btrim(payload->>'sugestao'), '')
  );

  -- Não devolve mais senha: quem a escolheu já a conhece. O protocolo volta
  -- como número do processo, para a pessoa citar se precisar falar com o RH.
  RETURN jsonb_build_object('protocolo', v_protocolo, 'email', v_email);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_registrar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_registrar(jsonb) TO anon, authenticated;

-- ── Consulta: e-mail + senha devolvem TODAS as denúncias da pessoa ───
-- A assinatura é (text, text) nos dois casos, mas o PRIMEIRO parâmetro muda de
-- nome (p_protocolo → p_email). O Postgres recusa renomear parâmetro em
-- CREATE OR REPLACE, então a versão antiga precisa cair antes.
DROP FUNCTION IF EXISTS public.denuncia_consultar(text, text);

CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_email text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_itens jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrada_em' DESC), '[]'::jsonb)
    INTO v_itens
    FROM (
      SELECT jsonb_build_object(
               'protocolo',     d.protocolo,
               'status',        d.status,
               'resultado',     d.resultado,
               'tipo_denuncia', d.tipo_denuncia,
               'registrada_em', d.created_at,
               'atualizada_em', d.updated_at,
               'concluida_em',  d.concluido_em,
               'retorno',       d.retorno_denunciante
             ) AS x
        FROM public."CANAL_DENUNCIA" d
       WHERE lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
         -- crypt() com o hash da própria linha: senha errada simplesmente não
         -- casa, sem revelar que o e-mail existe.
         AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash)
    ) s;

  -- Mesma resposta para e-mail inexistente e senha errada: distinguir os dois
  -- casos entregaria de graça quem já denunciou.
  IF v_itens = '[]'::jsonb THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('denuncias', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.denuncia_consultar(text, text) IS
  'Acompanhamento sem login: e-mail + senha devolvem todas as denuncias daquele e-mail. Nao devolve o relato.';

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS denuncias_sem_email
  FROM public."CANAL_DENUNCIA" WHERE COALESCE(btrim(email), '') = '';

-- =====================================================================
-- ROLLBACK: recriar denuncia_registrar/denuncia_consultar da
-- 20260901000002 + 20260901000004 (protocolo + senha sorteada).
-- =====================================================================

-- ===== 20260901000006_denuncia_interacao =====
-- =====================================================================
-- CANAL DE DENÚNCIAS — conversa, histórico e título do relato
--
-- POR QUE
-- A tratativa era de mão única: o comitê escrevia um `retorno_denunciante`
-- e pronto. Não havia como pedir um detalhe ("em que dia foi?", "quem mais
-- viu?") e receber a resposta, que é justamente o que destrava a maioria das
-- apurações — sobretudo quando o relato veio sem nome.
--
-- O QUE ENTRA
--   1. CANAL_DENUNCIA_MENSAGEM — conversa dos dois lados, com nota interna
--      (visível só para o comitê) no mesmo fio, para o contexto não se perder.
--   2. CANAL_DENUNCIA_EVENTO — trilha automática de mudança de situação,
--      resultado e responsável. Ninguém escreve nela: é gatilho.
--   3. `titulo` no relato — a lista precisa de um assunto legível; protocolo
--      não diz o que é o caso.
--
-- COMO CADA LADO ENTRA
--   · Comitê: RLS pelo menu, como no resto do módulo.
--   · Denunciante: NÃO toca a tabela. Passa por RPC SECURITY DEFINER que
--     confere e-mail + senha a cada chamada — mesma porta do acompanhamento.
--     Sem sessão, sem token, sem cookie.
-- =====================================================================

-- Assunto do caso. Fica FORA da trava de imutabilidade de propósito: é
-- redação do comitê sobre o relato, não é o relato.
ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS titulo text;

COMMENT ON COLUMN public."CANAL_DENUNCIA".titulo IS
  'Assunto dado pelo comite. O relato em si continua imutavel (canal_denuncia_guard).';

-- ── 1. Conversa ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_MENSAGEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id   uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  autor         text NOT NULL CHECK (autor IN ('comite', 'denunciante')),
  -- Só preenchido quando quem escreve é do comitê. Do lado do denunciante
  -- fica NULL: ele não tem usuário, e criar um destruiria o desenho.
  autor_user_id uuid REFERENCES auth.users(id),
  mensagem      text NOT NULL CHECK (length(btrim(mensagem)) > 0),
  -- Nota de trabalho: fica no mesmo fio para o comitê, e a RPC pública nunca
  -- a devolve. É o que permite comentar o caso sem abrir uma segunda tela.
  interna       boolean NOT NULL DEFAULT false,
  lida_em       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Nota interna é conceito do comitê; do denunciante seria contradição.
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM"
  DROP CONSTRAINT IF EXISTS canal_denuncia_msg_interna_chk;
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM"
  ADD CONSTRAINT canal_denuncia_msg_interna_chk
  CHECK (NOT (interna AND autor = 'denunciante'));

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_msg_denuncia
  ON public."CANAL_DENUNCIA_MENSAGEM"(denuncia_id, created_at);

ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_MENSAGEM" FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_MENSAGEM" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- O comitê só escreve como comitê: sem isto, a tela poderia forjar uma
-- resposta "do denunciante" e o fio deixaria de ser prova de nada.
DROP POLICY IF EXISTS canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias')
              AND autor = 'comite'
              AND autor_user_id = auth.uid());

-- Update existe só para marcar leitura.
DROP POLICY IF EXISTS canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 2. Histórico ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_EVENTO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  campo       text NOT NULL,
  de          text,
  para        text,
  por_user_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_evento_denuncia
  ON public."CANAL_DENUNCIA_EVENTO"(denuncia_id, created_at DESC);

ALTER TABLE public."CANAL_DENUNCIA_EVENTO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_EVENTO" FROM anon;
-- Só leitura pela API: quem escreve é o gatilho. Histórico que a aplicação
-- pode editar não serve como histórico.
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_EVENTO" TO authenticated;

DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

CREATE OR REPLACE FUNCTION public.canal_denuncia_registrar_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'status', OLD.status, NEW.status, auth.uid());
  END IF;
  IF NEW.resultado IS DISTINCT FROM OLD.resultado THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'resultado', OLD.resultado, NEW.resultado, auth.uid());
  END IF;
  IF NEW.gravidade IS DISTINCT FROM OLD.gravidade THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'gravidade', OLD.gravidade, NEW.gravidade, auth.uid());
  END IF;
  IF NEW.apuracao_responsavel IS DISTINCT FROM OLD.apuracao_responsavel THEN
    INSERT INTO public."CANAL_DENUNCIA_EVENTO"(denuncia_id, campo, de, para, por_user_id)
    VALUES (NEW.id, 'responsavel', OLD.apuracao_responsavel, NEW.apuracao_responsavel, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_evento ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_evento
  AFTER UPDATE ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_registrar_evento();

-- ── 3. Porta pública do denunciante ──────────────────────────────────
-- Confere e-mail + senha a CADA chamada. Sem sessão: é o mesmo modelo do
-- acompanhamento, e é o que permite conversar sem criar login para quem
-- denuncia.
CREATE OR REPLACE FUNCTION public.denuncia_mensagens(
  p_email text, p_senha text, p_protocolo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_id uuid; v_itens jsonb;
BEGIN
  SELECT d.id INTO v_id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')))
     AND lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
     AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  -- Marca como lidas as do comitê. Feito aqui e não na tela porque é o
  -- servidor que sabe que a pessoa realmente abriu a conversa.
  UPDATE public."CANAL_DENUNCIA_MENSAGEM"
     SET lida_em = now()
   WHERE denuncia_id = v_id AND autor = 'comite' AND interna = false AND lida_em IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'autor', m.autor, 'mensagem', m.mensagem, 'criada_em', m.created_at
         ) ORDER BY m.created_at), '[]'::jsonb)
    INTO v_itens
    FROM public."CANAL_DENUNCIA_MENSAGEM" m
   WHERE m.denuncia_id = v_id
     AND m.interna = false;   -- nota de trabalho do comitê nunca sai daqui

  RETURN jsonb_build_object('mensagens', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_mensagens(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_mensagens(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.denuncia_responder(
  p_email text, p_senha text, p_protocolo text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_id uuid; v_txt text := btrim(COALESCE(p_mensagem, ''));
BEGIN
  IF length(v_txt) < 2 THEN
    RAISE EXCEPTION 'Escreva sua mensagem antes de enviar.' USING ERRCODE = '22023';
  END IF;
  IF length(v_txt) > 5000 THEN
    RAISE EXCEPTION 'Mensagem muito longa (máximo de 5000 caracteres).' USING ERRCODE = '22023';
  END IF;

  SELECT d.id INTO v_id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')))
     AND lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
     AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CANAL_DENUNCIA_MENSAGEM"(denuncia_id, autor, mensagem)
  VALUES (v_id, 'denunciante', v_txt);

  -- Toca a denúncia para o comitê ver que houve movimento na fila.
  UPDATE public."CANAL_DENUNCIA" SET updated_at = now() WHERE id = v_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_responder(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_responder(text, text, text, text) TO anon, authenticated;

-- ── 4. A consulta passa a avisar que há mensagem nova ────────────────
CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_email text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_itens jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'registrada_em' DESC), '[]'::jsonb)
    INTO v_itens
    FROM (
      SELECT jsonb_build_object(
               'protocolo',     d.protocolo,
               'titulo',        d.titulo,
               'status',        d.status,
               'resultado',     d.resultado,
               'tipo_denuncia', d.tipo_denuncia,
               'registrada_em', d.created_at,
               'atualizada_em', d.updated_at,
               'concluida_em',  d.concluido_em,
               'retorno',       d.retorno_denunciante,
               'nao_lidas',     (SELECT count(*) FROM public."CANAL_DENUNCIA_MENSAGEM" m
                                  WHERE m.denuncia_id = d.id AND m.autor = 'comite'
                                    AND m.interna = false AND m.lida_em IS NULL)
             ) AS x
        FROM public."CANAL_DENUNCIA" d
       WHERE lower(btrim(d.email)) = lower(btrim(COALESCE(p_email, '')))
         AND d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash)
    ) s;

  IF v_itens = '[]'::jsonb THEN
    RAISE EXCEPTION 'E-mail ou senha inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('denuncias', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT json_build_object(
  'tabela_mensagem', (SELECT count(*) FROM information_schema.tables
                       WHERE table_schema='public' AND table_name='CANAL_DENUNCIA_MENSAGEM'),
  'tabela_evento',   (SELECT count(*) FROM information_schema.tables
                       WHERE table_schema='public' AND table_name='CANAL_DENUNCIA_EVENTO'),
  'rpcs',            (SELECT json_agg(p.proname ORDER BY p.proname) FROM pg_proc p
                       JOIN pg_namespace n ON n.oid=p.pronamespace
                      WHERE n.nspname='public'
                        AND p.proname IN ('denuncia_mensagens','denuncia_responder','denuncia_consultar')),
  'anon_executa',    json_build_object(
                       'mensagens', has_function_privilege('anon','public.denuncia_mensagens(text,text,text)','EXECUTE'),
                       'responder', has_function_privilege('anon','public.denuncia_responder(text,text,text,text)','EXECUTE')),
  'anon_le_tabela',  has_table_privilege('anon','public."CANAL_DENUNCIA_MENSAGEM"','SELECT')
)::text;

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_canal_denuncia_evento ON public."CANAL_DENUNCIA";
--   DROP FUNCTION IF EXISTS public.canal_denuncia_registrar_evento();
--   DROP FUNCTION IF EXISTS public.denuncia_mensagens(text,text,text);
--   DROP FUNCTION IF EXISTS public.denuncia_responder(text,text,text,text);
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_MENSAGEM";
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_EVENTO";
--   ALTER TABLE public."CANAL_DENUNCIA" DROP COLUMN IF EXISTS titulo;
--   -- e recriar denuncia_consultar da 20260901000005 (sem titulo/nao_lidas)
-- =====================================================================

-- ===== 20260901000007_chamados_abrir_para_todos =====
-- =====================================================================
-- ABRIR CHAMADO — capacidade de todo mundo
--
-- POR QUE
-- Solicitar chamado não é privilégio de área: qualquer pessoa do grupo
-- precisa conseguir pedir ajuda ao Sistemas. Hoje só 12 dos 66 usuários
-- têm a capacidade `chamados_sistemas_abrir` liberada, então o resto
-- simplesmente não consegue abrir chamado.
--
-- COMO — e por que NÃO foi linha por usuário
-- `list_accessible_menus` resolve nesta ordem:
--     override do usuário (screen_permission_user)  >  perfil  >  concede_tudo
-- Ou seja, linha por usuário VENCE o perfil. Se eu criasse override para os
-- 66, qualquer ajuste futuro feito no perfil deixaria de valer para eles —
-- 66 exceções congeladas, e ninguém lembraria disso daqui a seis meses.
--
-- Então:
--   1. Libera no PERFIL (todos os perfis ativos). É o caminho que o
--      "Acesso por Usuário" já usa, continua editável por lá, e pega
--      automaticamente quem for criado depois com qualquer perfil.
--   2. Override individual SÓ para quem não tem perfil nenhum (13 pessoas),
--      porque para essas o passo 1 não alcança.
--
-- Idempotente: rodar de novo não duplica nem sobrescreve quem já tem.
-- =====================================================================

-- ── 1. Todos os perfis ativos ────────────────────────────────────────
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'chamados_sistemas_abrir', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.ativo = true
   AND NOT EXISTS (
     SELECT 1 FROM public.perfil_acesso_permissao x
      WHERE x.perfil_id = pa.id
        AND x.menu_codigo = 'chamados_sistemas_abrir'
        AND x.acao = 'visualizar'::public.app_acao
   );

-- Perfil que já tinha a linha marcada como negada passa a permitir: o
-- objetivo é "todo mundo abre chamado", sem exceção herdada do legado.
UPDATE public.perfil_acesso_permissao
   SET allow = true, updated_at = now()
 WHERE menu_codigo = 'chamados_sistemas_abrir'
   AND acao = 'visualizar'::public.app_acao
   AND allow IS DISTINCT FROM true;

-- ── 2. Quem não tem perfil ───────────────────────────────────────────
-- Sem perfil, o passo 1 não alcança: aqui o override é a única via.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT p.id, 'chamados_sistemas_abrir', 'visualizar'::public.app_acao, true
  FROM public.profiles p
 WHERE NOT EXISTS (
         SELECT 1 FROM public.usuario_perfil_acesso u WHERE u.user_id = p.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM public.screen_permission_user s
          WHERE s.user_id = p.id
            AND s.menu_codigo = 'chamados_sistemas_abrir'
            AND s.acao = 'visualizar'::public.app_acao
       );

-- Override individual que estivesse NEGANDO passa a permitir — senão a
-- pessoa continuaria sem conseguir abrir chamado mesmo com o perfil liberado.
UPDATE public.screen_permission_user
   SET allow = true, updated_at = now()
 WHERE menu_codigo = 'chamados_sistemas_abrir'
   AND acao = 'visualizar'::public.app_acao
   AND allow IS DISTINCT FROM true;

NOTIFY pgrst, 'reload schema';

-- ── Conferência: quantos usuários REALMENTE enxergam a capacidade ────
-- Reproduz a mesma resolução da list_accessible_menus, em vez de contar
-- linhas inseridas — o que importa é o resultado, não o insert.
WITH resolvido AS (
  SELECT p.id,
         COALESCE(
           (SELECT s.allow FROM public.screen_permission_user s
             WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_abrir'
               AND s.acao = 'visualizar'::public.app_acao
             ORDER BY s.updated_at DESC LIMIT 1),
           EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                     JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                    WHERE upa.user_id = p.id AND pf.concede_tudo)
           OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso upa
                        JOIN public.perfil_acesso pf ON pf.id = upa.perfil_id AND pf.ativo
                        JOIN public.perfil_acesso_permissao pp
                          ON pp.perfil_id = pf.id AND pp.allow
                         AND pp.menu_codigo = 'chamados_sistemas_abrir'
                         AND pp.acao = 'visualizar'::public.app_acao
                       WHERE upa.user_id = p.id)
         ) AS pode
    FROM public.profiles p
)
SELECT count(*) FILTER (WHERE pode)       AS usuarios_com_acesso,
       count(*) FILTER (WHERE NOT pode)   AS usuarios_sem_acesso,
       count(*)                           AS total
  FROM resolvido;

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo='chamados_sistemas_abrir';
--   DELETE FROM public.screen_permission_user  WHERE menu_codigo='chamados_sistemas_abrir';
--   -- (apaga TAMBÉM as 12 liberações que já existiam antes desta migration)
-- =====================================================================


-- ===== 20260901000006_chamado_guard_service_role =====
-- =========================================================================
-- CONCLUSÃO AUTOMÁTICA DO CHAMADO NO MERGE DA PR
-- Libera a troca de status para automação de servidor (service_role).
--
-- Problema: o trigger chamado_sistema_guard() decide quem pode mexer no
-- chamado a partir de auth.uid(). A edge function chamado-concluir-pr é
-- chamada pelo GitHub Actions no merge da PR — roda com service_role e sem
-- usuário logado, então auth.uid() é NULL, v_coord/v_aprov/v_resp ficam todos
-- falsos e o UPDATE de status morria com:
--   "Sem permissão para alterar o status do chamado."
--
-- service_role ignora RLS, mas NÃO ignora trigger — por isso o bloqueio
-- acontecia mesmo com a chave de serviço.
--
-- Por que liberar é seguro: quem tem a service_role já pode alterar qualquer
-- linha, desabilitar o trigger ou o próprio RLS. A checagem existe para
-- proteger o usuário logado, não para conter o servidor. A liberação vale só
-- para a troca de status, que é o que a automação faz — os guards de campos de
-- abertura, coordenação e reprovação seguem valendo para todo mundo.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
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

-- ROLLBACK
--   Recriar chamado_sistema_guard() sem o v_auto, exatamente como está em
--   20260802000002_chamados_sistemas_permissoes.sql (linhas 145-192).

-- ===== 20260902000001_formularios_anonimo_intervalo_colegas =====
-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — resposta anônima, intervalo entre respostas e
-- pergunta "avaliação de colegas" (com as regras valendo no BANCO).
--
-- Três recursos que valem para QUALQUER formulário novo (nada é hard-coded
-- num formulário específico):
--
-- 1) RESPOSTA ANÔNIMA  (CS_FORMULARIOS.permite_anonimo)
--    Ligado, o respondente escolhe na hora de enviar: identificado ou
--    anônimo. Anônimo é anônimo DE VERDADE — o trigger abaixo apaga
--    criado_por, nome, e-mail e o snapshot de cadastro ANTES de gravar; não
--    existe coluna escondida ligando a resposta à pessoa. O setor continua
--    (é dele que vivem os painéis, e ele não identifica ninguém).
--
-- 2) INTERVALO ENTRE RESPOSTAS  (CS_FORMULARIOS.intervalo_horas)
--    "só pode responder 1x a cada N horas/dias". Como a resposta anônima
--    não guarda quem respondeu, o carimbo de quem enviou vai para uma tabela
--    À PARTE (CS_FORM_ENVIOS): formulário + usuário + data, SEM ponteiro para
--    a resposta. Ela é fechada a anon/authenticated — só as funções
--    SECURITY DEFINER daqui leem —, então serve de relógio sem desanonimizar
--    ninguém. A trava está na policy de INSERT, não só na tela.
--    LIMITE CONHECIDO: formulário 'liberado' (sem login) não tem identidade
--    p/ contar o intervalo — ali a regra não se aplica.
--
-- 3) PERGUNTA "COLEGAS"  (perguntas[].tipo = 'colegas')
--    Uma pergunta com N linhas: colega + setor + nota + comentário. A config
--    da pergunta diz o que é obrigatório:
--      min_colegas       int   — mínimo de colegas indicados
--      max_colegas       int   — teto (0/ausente = sem teto)
--      setores_distintos bool  — no máximo 1 colega por setor
--      excluir_proprio   bool  — não pode indicar a si mesmo (padrão: sim)
--      nota_obrigatoria  bool  — toda linha precisa de nota
--    Valor gravado em itens[pergunta_id] = array de
--      {colaborador, setor, nota, comentario}
--    O trigger valida essas regras no INSERT: a tela ajuda, o banco decide.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS"
  ADD COLUMN IF NOT EXISTS permite_anonimo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intervalo_horas integer;

ALTER TABLE public."CS_FORMULARIOS" DROP CONSTRAINT IF EXISTS cs_forms_intervalo_check;
ALTER TABLE public."CS_FORMULARIOS" ADD  CONSTRAINT cs_forms_intervalo_check
  CHECK (intervalo_horas IS NULL OR intervalo_horas > 0);

ALTER TABLE public."CS_FORM_RESPOSTAS"
  ADD COLUMN IF NOT EXISTS anonimo boolean NOT NULL DEFAULT false;

-- ── 2) Carimbo de envio (relógio do intervalo, sem identificar a resposta) ─
CREATE TABLE IF NOT EXISTS public."CS_FORM_ENVIOS" (
  formulario_id uuid NOT NULL REFERENCES public."CS_FORMULARIOS"(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  enviado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (formulario_id, user_id, enviado_em)
);
CREATE INDEX IF NOT EXISTS cs_form_envios_idx
  ON public."CS_FORM_ENVIOS"(formulario_id, user_id, enviado_em DESC);

ALTER TABLE public."CS_FORM_ENVIOS" ENABLE ROW LEVEL SECURITY;
-- Sem policy e sem GRANT: ninguém lê pelo PostgREST. Só as funções abaixo.
REVOKE ALL ON public."CS_FORM_ENVIOS" FROM anon, authenticated;

-- ── 3) Pode responder agora? (intervalo entre respostas) ─────────────────
-- Sem intervalo configurado, sem login, ou nunca respondeu → true.
CREATE OR REPLACE FUNCTION public.cs_form_pode_responder(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public."CS_FORMULARIOS" f
      JOIN public."CS_FORM_ENVIOS" e
        ON e.formulario_id = f.id AND e.user_id = auth.uid()
     WHERE f.id = _form_id
       AND f.intervalo_horas IS NOT NULL
       AND auth.uid() IS NOT NULL
       AND e.enviado_em > now() - make_interval(hours => f.intervalo_horas));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode_responder(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode_responder(uuid) TO anon, authenticated;

-- Mesma conta, mas contando a história p/ a tela: quando respondeu e quando
-- libera de novo. É o que a página pública mostra em vez de um erro seco.
CREATE OR REPLACE FUNCTION public.cs_form_prazo(_form_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'pode', public.cs_form_pode_responder(_form_id),
           'intervalo_horas', f.intervalo_horas,
           'ultima_em', u.ultima,
           'proxima_em', CASE WHEN f.intervalo_horas IS NULL OR u.ultima IS NULL THEN NULL
                              ELSE u.ultima + make_interval(hours => f.intervalo_horas) END)
    FROM public."CS_FORMULARIOS" f
    LEFT JOIN LATERAL (
      SELECT max(e.enviado_em) AS ultima
        FROM public."CS_FORM_ENVIOS" e
       WHERE e.formulario_id = f.id AND e.user_id = auth.uid()
    ) u ON true
   WHERE f.id = _form_id;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_prazo(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_prazo(uuid) TO anon, authenticated;

-- ── 4) Guarda da resposta: anonimiza, valida "colegas" e carimba o envio ──
-- Roda como trigger da tabela (não é chamável pelo client). BEFORE INSERT
-- porque precisa APAGAR a identidade antes de a linha existir — anonimizar
-- depois deixaria o dado gravado por um instante.
CREATE OR REPLACE FUNCTION public.cs_form_resposta_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_form   record;
  v_perg   jsonb;
  v_cfg    jsonb;
  v_linhas jsonb;
  v_linha  jsonb;
  v_nome   text;      -- nome do próprio respondente (p/ "não pode ser você")
  v_tit    text;
  v_min    int;
  v_max    int;
  v_n      int;
  v_setor  text;
  v_colega text;
  v_setores text[];
  v_colegas text[];
BEGIN
  SELECT * INTO v_form FROM public."CS_FORMULARIOS" WHERE id = NEW.formulario_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- 4.1 Anonimato: só se o formulário permite, e aí some TUDO que identifica.
  IF COALESCE(NEW.anonimo, false) THEN
    IF NOT COALESCE(v_form.permite_anonimo, false) THEN
      RAISE EXCEPTION 'Este formulário não aceita resposta anônima.';
    END IF;
    NEW.criado_por           := NULL;
    NEW.respondente_nome     := NULL;
    NEW.respondente_email    := NULL;
    NEW.respondente_cadastro := NULL;
  END IF;

  -- 4.2 Nome oficial de quem está respondendo (só serve p/ barrar auto-indicação).
  SELECT e."Nome" INTO v_nome
    FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = auth.uid()
   LIMIT 1;

  -- 4.3 Regras das perguntas do tipo "colegas".
  FOR v_perg IN SELECT * FROM jsonb_array_elements(COALESCE(v_form.perguntas, '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE(v_perg->>'tipo', '') <> 'colegas';
    v_cfg  := COALESCE(v_perg->'config', '{}'::jsonb);
    v_tit  := COALESCE(NULLIF(btrim(COALESCE(v_perg->>'titulo', '')), ''), 'Avaliação de colegas');
    v_linhas := COALESCE(NEW.itens -> (v_perg->>'id'), '[]'::jsonb);
    IF jsonb_typeof(v_linhas) <> 'array' THEN v_linhas := '[]'::jsonb; END IF;

    v_n := 0; v_setores := '{}'; v_colegas := '{}';
    FOR v_linha IN SELECT * FROM jsonb_array_elements(v_linhas)
    LOOP
      v_colega := btrim(COALESCE(v_linha->>'colaborador', ''));
      CONTINUE WHEN v_colega = '';                 -- linha em branco não conta
      v_setor  := upper(btrim(COALESCE(v_linha->>'setor', '')));
      v_n := v_n + 1;

      -- Não pode indicar a si mesmo.
      IF COALESCE(v_cfg->>'excluir_proprio', 'true') <> 'false'
         AND v_nome IS NOT NULL
         AND upper(btrim(v_nome)) = upper(v_colega) THEN
        RAISE EXCEPTION 'Em "%": você não pode indicar a si mesmo.', v_tit;
      END IF;

      -- Mesmo colega duas vezes na mesma pergunta nunca faz sentido.
      IF upper(v_colega) = ANY (v_colegas) THEN
        RAISE EXCEPTION 'Em "%": % foi indicado(a) mais de uma vez.', v_tit, v_colega;
      END IF;
      v_colegas := array_append(v_colegas, upper(v_colega));

      -- No máximo 1 colega por setor (quando a pergunta pede).
      IF COALESCE(v_cfg->>'setores_distintos', 'false') = 'true' AND v_setor <> '' THEN
        IF v_setor = ANY (v_setores) THEN
          RAISE EXCEPTION 'Em "%": só é possível indicar 1 colega por setor (% repetido).', v_tit, v_setor;
        END IF;
        v_setores := array_append(v_setores, v_setor);
      END IF;

      -- Nota obrigatória em cada linha indicada.
      IF COALESCE(v_cfg->>'nota_obrigatoria', 'false') = 'true'
         AND COALESCE(btrim(COALESCE(v_linha->>'nota', '')), '') = '' THEN
        RAISE EXCEPTION 'Em "%": dê uma nota para %.', v_tit, v_colega;
      END IF;
    END LOOP;

    v_min := COALESCE(NULLIF(v_cfg->>'min_colegas', '')::int, 0);
    v_max := COALESCE(NULLIF(v_cfg->>'max_colegas', '')::int, 0);
    IF v_n < v_min THEN
      RAISE EXCEPTION 'Em "%": indique pelo menos % colega(s).', v_tit, v_min;
    END IF;
    IF v_max > 0 AND v_n > v_max THEN
      RAISE EXCEPTION 'Em "%": no máximo % colega(s).', v_tit, v_max;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cs_form_resposta_guard ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_resposta_guard
  BEFORE INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_resposta_guard();

-- Carimbo do envio: DEPOIS da linha existir, e sempre pelo auth.uid() da
-- sessão — inclusive na resposta anônima, que já teve criado_por apagado.
-- É este registro (e só ele) que sabe "fulano respondeu tal formulário".
CREATE OR REPLACE FUNCTION public.cs_form_registra_envio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public."CS_FORM_ENVIOS" (formulario_id, user_id)
    VALUES (NEW.formulario_id, auth.uid())
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cs_form_registra_envio ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_registra_envio
  AFTER INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_registra_envio();

-- ── 5) A trava do intervalo entra na policy de INSERT ────────────────────
-- (mesma policy de 20260715000002 + cs_form_pode_responder; 'editar_criar'
--  segue com bypass — é por ela que a importação de respostas passa.)
DROP POLICY IF EXISTS cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_ins_auth ON public."CS_FORM_RESPOSTAS"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('editar_criar')
    OR (public.cs_form_aberto(formulario_id)
        AND public.cs_form_alvo(formulario_id)
        AND public.cs_form_senha_ok(formulario_id)
        AND public.cs_form_pode_responder(formulario_id)));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER trg_cs_form_resposta_guard  ON public."CS_FORM_RESPOSTAS";
--   DROP TRIGGER trg_cs_form_registra_envio  ON public."CS_FORM_RESPOSTAS";
--   DROP FUNCTION public.cs_form_resposta_guard(), public.cs_form_registra_envio();
--   DROP FUNCTION public.cs_form_prazo(uuid), public.cs_form_pode_responder(uuid);
--   DROP TABLE public."CS_FORM_ENVIOS";
--   e recriar cs_form_resp_ins_auth como está em 20260715000002 (sem o
--   cs_form_pode_responder). As colunas novas podem ficar (default = desligado).

-- ===== 20260903000001_recrutamento_regras_vaga =====
-- =========================================================================
-- RECRUTAMENTO E SELEÇÃO — regras da solicitação de vaga no BANCO
--
-- O que passa a valer (as mesmas regras estão em src/lib/recrutamento/
-- vagaRegras.ts, que é o que a tela usa — aqui é o piso, não a decoração):
--
-- 1) PRAZO MÍNIMO: vaga só abre para daqui a 7 DIAS ÚTEIS ou mais.
-- 2) GRAU DE URGÊNCIA sai do prazo, ninguém escolhe na mão:
--       7 a 13 dias úteis → 'Alta — Urgente'
--      14 a 20            → 'Média'
--      21 ou mais         → 'Baixa'
-- 3) ENCARREGADO SÓ EDITA A DATA depois da vaga criada, e com justificativa.
--    Toda troca de data fica registrada em data_inicio_alteracoes (jsonb).
-- 4) CNH OBRIGATÓRIA entra sozinha quando o cargo é motorista, tratorista,
--    operador de retroescavadeira ou supervisor operacional.
-- 5) MOTIVO 'Expansão' passa a se chamar 'Expansão (Aumento de Quadro)' —
--    as vagas antigas são normalizadas.
--
-- Diferença conhecida entre a tela e o banco: a tela desconta FERIADO
-- NACIONAL na conta de dias úteis (src/lib/feriadosNacionais.ts); aqui só
-- sábado e domingo saem. O banco é, portanto, o piso mais frouxo — quem
-- passa pela tela passa aqui. Replicar o calendário de feriados em SQL não
-- se paga: o que importa é não deixar ninguém furar a regra pela API.
--
-- Automação de servidor (service_role, sem sessão) não é barrada — quem tem
-- a service_role já pode tudo, e travá-la só quebraria integração.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Colunas novas ─────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS cnh_obrigatoria boolean NOT NULL DEFAULT false,
  -- histórico de troca da data de início: [{de, para, justificativa, por, por_nome, em}]
  ADD COLUMN IF NOT EXISTS data_inicio_alteracoes jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 'Expansão' → 'Expansão (Aumento de Quadro)' nas vagas que já existem.
UPDATE public."SISTEMA_RECRUTAMENTO"
   SET motivo_vaga = 'Expansão (Aumento de Quadro)'
 WHERE btrim(coalesce(motivo_vaga, '')) = 'Expansão';

-- ── 2) Helpers ───────────────────────────────────────────────────────────

-- Dias úteis de _de (exclusivo) até _ate (inclusive). Só tira sáb/dom.
CREATE OR REPLACE FUNCTION public.dias_uteis_entre(_de date, _ate date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _de IS NULL OR _ate IS NULL OR _ate <= _de THEN 0 ELSE (
    SELECT count(*)::int FROM generate_series(_de + 1, _ate, interval '1 day') d
     WHERE extract(isodow from d) < 6) END;
$$;

-- data_inicio_prevista é TEXT na tabela (vem do <input type=date>). Converte
-- só o que tem cara de ISO; qualquer outra coisa vira NULL em vez de erro.
CREATE OR REPLACE FUNCTION public.rec_data_prevista(_txt text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN btrim(coalesce(_txt, '')) ~ '^\d{4}-\d{2}-\d{2}'
              THEN to_date(substr(btrim(_txt), 1, 10), 'YYYY-MM-DD') END;
$$;

-- Grau pelo prazo. NULL = sem data ou abaixo do mínimo (o guard barra).
CREATE OR REPLACE FUNCTION public.rec_grau_por_data(_data text, _hoje date DEFAULT current_date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.rec_data_prevista(_data) IS NULL THEN NULL
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 21 THEN 'Baixa'
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 14 THEN 'Média'
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 7  THEN 'Alta — Urgente'
    ELSE NULL END;
$$;

-- Cargo que dirige veículo/máquina da empresa. Sem acento e sem caixa —
-- o cargo vem digitado à mão ou do "Título do Cargo" da EMPREGADOS.
CREATE OR REPLACE FUNCTION public.rec_cargo_exige_cnh(_cargo text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(translate(coalesce(_cargo, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
         ~ '(MOTORISTA|TRATORISTA|RETRO ?ESCAVADEIRA|SUPERVISOR(A)? .*OPERACIONAL)';
$$;

REVOKE EXECUTE ON FUNCTION public.dias_uteis_entre(date, date), public.rec_data_prevista(text),
  public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dias_uteis_entre(date, date), public.rec_data_prevista(text),
  public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text) TO authenticated;

-- ── 3) O guard ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  v_rh    boolean;
  v_dias  int;
  v_grau  text;
  v_livre jsonb;   -- colunas que o encarregado PODE mexer
  v_ult   jsonb;
  v_msg   text := 'A vaga precisa de no mínimo 7 dias úteis de antecedência.';
BEGIN
  IF v_auto THEN RETURN NEW; END IF;

  -- Nome novo do motivo, venha de onde vier.
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  -- CNH obrigatória pelo cargo (marca + linha no requisito, sem duplicar).
  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  -- ── INSERT: prazo mínimo + grau automático ─────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- ── UPDATE ─────────────────────────────────────────────────────────────
  v_rh := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
       OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir');

  -- Quem não é do Recrutamento (o encarregado que abriu a vaga) só mexe na
  -- data — e no que deriva dela. Comparar o resto como jsonb pega qualquer
  -- coluna, inclusive as que forem criadas depois desta migration.
  IF NOT v_rh THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    -- Justificativa: a troca precisa entrar no histórico, com texto de gente.
    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    -- Carimbo de quem trocou: quem grava é o banco, não o cliente.
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_rh THEN
    -- Não deixa mexer no histórico sem trocar a data (reescrever justificativa).
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sistema_recrutamento_guard ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_sistema_recrutamento_guard
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_recrutamento_guard();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER trg_sistema_recrutamento_guard ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION public.sistema_recrutamento_guard();
--   DROP FUNCTION public.rec_grau_por_data(text, date), public.rec_cargo_exige_cnh(text),
--                 public.rec_data_prevista(text), public.dias_uteis_entre(date, date);
--   As colunas novas podem ficar (cnh_obrigatoria default false, histórico vazio).
--   O UPDATE do motivo 'Expansão' não se desfaz sozinho — se precisar voltar:
--   UPDATE "SISTEMA_RECRUTAMENTO" SET motivo_vaga='Expansão'
--    WHERE motivo_vaga='Expansão (Aumento de Quadro)';

-- ===== 20260903000002_form_colegas_por_setor =====
-- =========================================================================
-- FORMULÁRIOS — pergunta "colegas": escolher o SETOR e depois a pessoa
--
-- Bug que isto conserta: a tela montava a lista de setores lendo a
-- VW_EMPREGADOS_BASICO inteira e distinguindo no navegador. Só que o
-- PostgREST corta a resposta (max-rows) — e como o setor "PADRAO" sozinho
-- tem centenas de pessoas, o pedaço que chegava continha só 6 dos 14
-- setores. Setor pequeno (SISTEMAS, JURIDICO, SST, TREINAMENTOS…)
-- simplesmente não aparecia.
--
-- Conserto: duas RPCs que fazem o DISTINCT/filtro no banco e devolvem
-- poucas linhas — nada de paginar cadastro no cliente.
--
--   cs_form_setores()          → setores com gente ativa, em ordem
--   cs_form_colegas(_setor)    → quem trabalha naquele setor
--
-- Ambas SECURITY DEFINER porque a EMPREGADOS é fechada por RLS, e liberadas
-- p/ anon: o formulário pode ser respondido sem login. Não expõem nada novo
-- — nome, setor e cargo já saem na VW_EMPREGADOS_BASICO, que anon lê desde
-- a migration 20260724000002. CPF/salário/PIS continuam fora.
--
-- Demitido não entra em nenhuma das duas.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.cs_form_setores()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT btrim(e."Setor_ERP") AS setor
    FROM public."EMPREGADOS" e
   WHERE btrim(coalesce(e."Setor_ERP", '')) <> ''
     AND coalesce(e."Situação", '') !~* 'demitid'
   ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.cs_form_colegas(_setor text)
RETURNS TABLE(id bigint, nome text, setor text, cargo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e."ID"::bigint, btrim(e."Nome"), btrim(e."Setor_ERP"), btrim(coalesce(e."Título do Cargo", ''))
    FROM public."EMPREGADOS" e
   WHERE btrim(coalesce(e."Nome", '')) <> ''
     AND coalesce(e."Situação", '') !~* 'demitid'
     AND upper(btrim(coalesce(e."Setor_ERP", ''))) = upper(btrim(coalesce(_setor, '')))
   ORDER BY 2;
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_setores(), public.cs_form_colegas(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores(), public.cs_form_colegas(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP FUNCTION public.cs_form_colegas(text), public.cs_form_setores();
--   (a tela volta a ler a VW_EMPREGADOS_BASICO — com o bug de truncamento)


-- ===== 20260906000003_wa_nova_conversa =====
-- =====================================================================
-- WHATSAPP — NOVA CONVERSA pela Caixa de Entrada + ficha do contato
--
-- Ate aqui uma conversa so nascia de dois jeitos: a pessoa mandava
-- mensagem (webhook) ou o recrutador clicava no icone do card do
-- candidato. Quem precisava falar com um numero avulso — fornecedor,
-- colaborador, candidato de fora do portal — abria o WhatsApp no
-- celular, e aquela conversa ficava fora do historico do ERP.
--
-- Esta migration entrega:
--   1) wa_consultar_telefone   — quem e este numero? (nao grava nada)
--   2) wa_abrir_conversa_por_telefone — acha/cria contato + conversa
--   3) WA_CONTATO: nome_manual, etiquetas e observacao
--   4) WA_BOT_CONFIG: o texto/botao da mensagem de abertura
--
-- SOBRE O NOME — a regra do modulo continua de pe: `nome` e o
-- profile.name que a Meta manda no webhook, e nada mais escreve nele
-- (ver 20260820000005, o caso do contato que virou "TREINAMENTOS").
-- O nome digitado pelo atendente vai em `nome_manual`, coluna separada,
-- e tem precedencia na tela. Assim o apelido interno ("Maria — RH do
-- HUSM") nao apaga o nome real, e a chegada do nome real nao apaga o
-- apelido.
--
-- E NAO EXISTE, na Cloud API, endpoint que devolva o nome de um numero
-- que nunca falou com a gente: o profile.name so vem junto da mensagem
-- de ENTRADA. Por isso wa_consultar_telefone devolve o nome quando ja
-- temos o contato, e silencio quando nao temos — quem preenche o resto
-- e o webhook, sozinho, quando a pessoa responder.
--
-- A regra do 9o digito (20260820000006) sai de dentro da RPC do
-- recrutamento e vira funcao propria, usada pelas duas pontas. Era o
-- que o comentario daquela migration ja pedia: "uma implementacao so,
-- no banco".
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.wa_abrir_conversa_por_telefone(text, text, text);
--   DROP FUNCTION IF EXISTS public.wa_consultar_telefone(text);
--   DROP FUNCTION IF EXISTS public.wa_contato_do_telefone(text);
--   ALTER TABLE public."WA_CONTATO" DROP COLUMN IF EXISTS nome_manual,
--     DROP COLUMN IF EXISTS etiquetas, DROP COLUMN IF EXISTS observacao;
--   ALTER TABLE public."WA_BOT_CONFIG" DROP COLUMN IF EXISTS abertura_texto,
--     DROP COLUMN IF EXISTS abertura_botao, DROP COLUMN IF EXISTS abertura_template,
--     DROP COLUMN IF EXISTS abertura_template_idioma;
--   (a recrutamento_abrir_conversa volta na 20260820000006)
-- =====================================================================

-- 1) Ficha do contato --------------------------------------------------
ALTER TABLE public."WA_CONTATO"
  ADD COLUMN IF NOT EXISTS nome_manual text,
  ADD COLUMN IF NOT EXISTS etiquetas   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS observacao  text;

COMMENT ON COLUMN public."WA_CONTATO".nome  IS 'Nome do WhatsApp (profile.name). SO o webhook escreve aqui.';
COMMENT ON COLUMN public."WA_CONTATO".nome_manual IS 'Nome/apelido definido pelo atendente. Tem precedencia na tela.';
COMMENT ON COLUMN public."WA_CONTATO".etiquetas  IS 'Marcadores livres do atendimento (ex.: Fornecedor, Candidato, Urgente).';

-- Busca por etiqueta sem varrer a tabela.
CREATE INDEX IF NOT EXISTS idx_wa_contato_etiquetas
  ON public."WA_CONTATO" USING gin (etiquetas);

-- 2) Mensagem de abertura ----------------------------------------------
-- Fica no banco, e nao no codigo, porque tres pontas precisam do MESMO
-- texto: a previa na tela, o envio dentro da janela de 24h e o template
-- submetido a Meta. Duas copias e questao de tempo ate divergirem.
--
-- ATENCAO: mudar `abertura_texto` NAO muda o template ja aprovado na
-- Meta — template aprovado e imutavel. Depois de editar aqui, o template
-- precisa ser recriado (com outro nome) e reaprovado, senao o envio
-- FORA da janela de 24h continua saindo com o texto antigo.
ALTER TABLE public."WA_BOT_CONFIG"
  ADD COLUMN IF NOT EXISTS abertura_texto text NOT NULL DEFAULT
    E'Olá, Somos do Grupo Nascimento!\nPrecisamos entrar em contato com você, por gentileza responda essa mensagem automática para que possamos entrar em contato.',
  ADD COLUMN IF NOT EXISTS abertura_botao text NOT NULL DEFAULT 'Olá, Bom dia!',
  ADD COLUMN IF NOT EXISTS abertura_template text NOT NULL DEFAULT 'abertura_contato',
  ADD COLUMN IF NOT EXISTS abertura_template_idioma text NOT NULL DEFAULT 'pt_BR';

-- 3) Contato a partir de um telefone qualquer --------------------------
-- Centraliza a regra do 9o digito (20260820000006): a Cloud API guarda o
-- wa_id na forma LEGADA (55 + DDD + 8 digitos), entao casar pelo E.164
-- completo nao acha ninguem e cria duplicata. O trecho estavel entre as
-- duas formas e pais + DDD + os 8 ultimos.
--
-- Helper interno: sem GRANT para authenticated de proposito. Ele cria
-- contato sem checar permissao — quem checa sao as RPCs abaixo, que o
-- chamam. Rodando dentro delas (SECURITY DEFINER), o EXECUTE e avaliado
-- contra o dono da funcao, entao nao falta permissao nenhuma.
CREATE OR REPLACE FUNCTION public.wa_contato_do_telefone(p_telefone text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_d       text;   -- so digitos
  v_nac     text;   -- nacional, sem o 55 do pais
  v_ddd     text;
  v_tail    text;   -- 8 ultimos: estaveis entre a forma legada e a nova
  v_wa_id   text;
  v_contato uuid;
BEGIN
  v_d := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF length(v_d) < 10 THEN
    RAISE EXCEPTION 'telefone invalido: informe DDD + numero';
  END IF;

  -- Tira o 55 so quando ele e mesmo o pais: 12 ou 13 digitos. Numero de
  -- 10/11 digitos comecando com 55 e DDD 55 (Santa Maria/RS) — regiao do
  -- contrato HUSM, entao nao e caso hipotetico.
  v_nac  := CASE WHEN left(v_d, 2) = '55' AND length(v_d) IN (12, 13)
                 THEN substr(v_d, 3) ELSE v_d END;
  v_ddd  := left(v_nac, 2);
  v_tail := right(v_nac, 8);

  SELECT id INTO v_contato
    FROM public."WA_CONTATO"
   WHERE wa_id LIKE '55' || v_ddd || '%'
     AND right(wa_id, 8) = v_tail
   -- Havendo duplicata, a que ja conversou vence.
   ORDER BY (SELECT count(*) FROM public."WA_CONVERSA" cv
               JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
              WHERE cv.contato_id = "WA_CONTATO".id) DESC,
            created_at ASC
   LIMIT 1;

  -- Nao existe: cria na forma legada, que e a que o webhook grava — senao
  -- a primeira resposta da pessoa abriria um segundo registro.
  IF v_contato IS NULL THEN
    v_wa_id := '55' || v_ddd || v_tail;
    INSERT INTO public."WA_CONTATO"(wa_id, telefone)
    VALUES (v_wa_id, p_telefone)
    ON CONFLICT (wa_id) DO NOTHING;
    SELECT id INTO v_contato FROM public."WA_CONTATO" WHERE wa_id = v_wa_id;
  END IF;

  RETURN v_contato;
END $$;

REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM anon;
REVOKE ALL ON FUNCTION public.wa_contato_do_telefone(text) FROM authenticated;

-- 4) Consulta (nao grava nada) -----------------------------------------
-- Alimenta o "quem e este numero?" enquanto o atendente digita. NAO cria
-- contato: numero digitado errado, ou desistencia no meio, nao pode
-- deixar lixo na Caixa de Entrada.
CREATE OR REPLACE FUNCTION public.wa_consultar_telefone(p_telefone text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_d text; v_nac text; v_ddd text; v_tail text;
  v_ct record;
  v_conversa uuid;
  v_pasta text;
  v_msgs bigint := 0;
  v_dentro boolean := false;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'sem acesso a Caixa de Entrada do WhatsApp';
  END IF;

  v_d := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  IF length(v_d) < 10 THEN
    RETURN jsonb_build_object('valido', false);
  END IF;

  v_nac  := CASE WHEN left(v_d, 2) = '55' AND length(v_d) IN (12, 13)
                 THEN substr(v_d, 3) ELSE v_d END;
  v_ddd  := left(v_nac, 2);
  v_tail := right(v_nac, 8);

  SELECT id, wa_id, nome, nome_manual, etiquetas, observacao INTO v_ct
    FROM public."WA_CONTATO"
   WHERE wa_id LIKE '55' || v_ddd || '%'
     AND right(wa_id, 8) = v_tail
   ORDER BY (SELECT count(*) FROM public."WA_CONVERSA" cv
               JOIN public."WA_MENSAGEM" m ON m.conversa_id = cv.id
              WHERE cv.contato_id = "WA_CONTATO".id) DESC,
            created_at ASC
   LIMIT 1;

  IF v_ct.id IS NULL THEN
    RETURN jsonb_build_object('valido', true, 'existe', false);
  END IF;

  SELECT id, pasta_codigo INTO v_conversa, v_pasta
    FROM public."WA_CONVERSA" WHERE contato_id = v_ct.id;
  IF v_conversa IS NOT NULL THEN
    SELECT count(*) INTO v_msgs FROM public."WA_MENSAGEM" WHERE conversa_id = v_conversa;
    SELECT EXISTS (
      SELECT 1 FROM public."WA_MENSAGEM"
       WHERE conversa_id = v_conversa AND direcao = 'entrada'
         AND criada_em > now() - interval '24 hours') INTO v_dentro;
  END IF;

  -- `pode_ver`: a conversa pode existir numa pasta fora do acesso de quem
  -- consultou. Avisar aqui evita o atendente preencher tudo, clicar e so
  -- entao descobrir que o numero ja esta com outro setor.
  RETURN jsonb_build_object(
    'valido', true,
    'existe', true,
    'contato_id',    v_ct.id,
    'wa_id',         v_ct.wa_id,
    'nome',          v_ct.nome,
    'nome_manual',   v_ct.nome_manual,
    'etiquetas',     to_jsonb(coalesce(v_ct.etiquetas, '{}'::text[])),
    'observacao',    v_ct.observacao,
    'conversa_id',   v_conversa,
    'pasta_codigo',  v_pasta,
    'pode_ver',      v_conversa IS NULL OR public.wa_pode_ver_pasta(v_pasta),
    'tem_mensagens', v_msgs > 0,
    'dentro_janela', v_dentro
  );
END $$;

REVOKE ALL ON FUNCTION public.wa_consultar_telefone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_consultar_telefone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_consultar_telefone(text) TO authenticated;

-- 5) Abrir a conversa ---------------------------------------------------
-- Idempotente por telefone: chamar duas vezes devolve a MESMA conversa.
-- `dentro_janela` diz se cabe texto livre ou se so passa template — e o
-- que a edge function whatsapp-abertura usa para escolher o caminho.
--
-- p_pasta e a fila onde a conversa NOVA nasce, e nao e detalhe: a RLS so
-- devolve conversa de pasta que a pessoa enxerga, e conversa SEM pasta so
-- aparece para quem tem 'whatsapp_todas' (wa_pode_ver_pasta). Sem escolher
-- a pasta, um atendente de fila criava a conversa e a perdia no mesmo
-- clique — existente no banco, invisivel para ele.
CREATE OR REPLACE FUNCTION public.wa_abrir_conversa_por_telefone(
  p_telefone text,
  p_nome     text DEFAULT NULL,
  p_pasta    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_contato  uuid;
  v_conversa uuid;
  v_nova     boolean;
  v_pasta    text;
  v_ct       record;
  v_msgs     bigint;
  v_dentro   boolean;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'sem acesso a Caixa de Entrada do WhatsApp';
  END IF;

  -- SECURITY DEFINER passa por cima da RLS, entao a checagem da pasta tem
  -- que ser explicita: sem isto daria para jogar conversa numa fila alheia.
  IF p_pasta IS NOT NULL AND NOT public.wa_pode_ver_pasta(p_pasta) THEN
    RAISE EXCEPTION 'sem acesso a pasta %', p_pasta;
  END IF;

  v_contato := public.wa_contato_do_telefone(p_telefone);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  v_nova := v_conversa IS NULL;
  IF v_nova THEN
    INSERT INTO public."WA_CONVERSA"(contato_id, pasta_codigo) VALUES (v_contato, p_pasta)
    ON CONFLICT (contato_id) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  END IF;

  -- Conversa que ja existia fica na pasta dela: mover e ato deliberado, que
  -- avisa o contato (whatsapp-mover-pasta). Mas se for uma pasta fora do
  -- acesso de quem chamou, devolver o id seria entregar uma conversa que a
  -- RLS nao deixa abrir — melhor dizer o que houve.
  SELECT pasta_codigo INTO v_pasta FROM public."WA_CONVERSA" WHERE id = v_conversa;
  IF NOT public.wa_pode_ver_pasta(v_pasta) THEN
    RAISE EXCEPTION 'este numero ja esta em atendimento numa pasta que voce nao acessa';
  END IF;

  -- Nome digitado vai para nome_manual — nunca para `nome`. Vazio nao
  -- apaga o que ja estava: quem quer limpar edita na ficha do contato.
  IF coalesce(btrim(p_nome), '') <> '' THEN
    UPDATE public."WA_CONTATO" SET nome_manual = btrim(p_nome) WHERE id = v_contato;
  END IF;

  SELECT count(*) INTO v_msgs FROM public."WA_MENSAGEM" WHERE conversa_id = v_conversa;
  SELECT EXISTS (
    SELECT 1 FROM public."WA_MENSAGEM"
     WHERE conversa_id = v_conversa AND direcao = 'entrada'
       AND criada_em > now() - interval '24 hours') INTO v_dentro;

  SELECT wa_id, nome, nome_manual INTO v_ct
    FROM public."WA_CONTATO" WHERE id = v_contato;

  RETURN jsonb_build_object(
    'conversa_id',   v_conversa,
    'contato_id',    v_contato,
    'wa_id',         v_ct.wa_id,
    'nome',          v_ct.nome,
    'nome_manual',   v_ct.nome_manual,
    'pasta_codigo',  v_pasta,
    'conversa_nova', v_nova,
    'tem_mensagens', v_msgs > 0,
    'dentro_janela', v_dentro
  );
END $$;

-- A assinatura antiga (2 argumentos) sairia como sobrecarga e deixaria o
-- PostgREST sem saber qual chamar.
DROP FUNCTION IF EXISTS public.wa_abrir_conversa_por_telefone(text, text);
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_abrir_conversa_por_telefone(text, text, text) TO authenticated;

-- 6) Recrutamento passa a usar o mesmo helper ---------------------------
-- Mesmo comportamento de antes (20260820000006), sem a copia da regra do
-- 9o digito: agora ha um lugar so para corrigir quando a Meta mudar.
CREATE OR REPLACE FUNCTION public.recrutamento_abrir_conversa(p_candidato_id bigint)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tel      text;
  v_contato  uuid;
  v_conversa uuid;
BEGIN
  SELECT telefone INTO v_tel FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidato % nao encontrado', p_candidato_id;
  END IF;

  -- Sem nome: quem nomeia contato e o webhook, com o profile.name da Meta.
  v_contato := public.wa_contato_do_telefone(v_tel);

  SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  IF v_conversa IS NULL THEN
    INSERT INTO public."WA_CONVERSA"(contato_id) VALUES (v_contato)
    ON CONFLICT (contato_id) DO NOTHING;
    SELECT id INTO v_conversa FROM public."WA_CONVERSA" WHERE contato_id = v_contato;
  END IF;

  RETURN v_conversa;
END $$;

REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recrutamento_abrir_conversa(bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.recrutamento_abrir_conversa(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000004_formularios_acesso_por_formulario =====
-- =========================================================================
-- FORMULARIOS — ACESSO POR FORMULARIO (botao "Acesso" em cada card)
--
-- Ate aqui as capacidades eram GLOBAIS: quem tinha 'editar_criar' editava
-- TODOS os formularios. Nao havia como dizer "este formulario e so a
-- Fulana que administra". Esta migration cria a lista por formulario.
--
-- ONDE MORA: na propria "CS_FORM_ACESSOS", usando a coluna `formulario_id`
-- que ja existia (sobra do modelo antigo 'visualiza', hoje 100% nula — 0
-- linhas em 17/08/2026). NAO ha tabela nova de permissao: a regra do
-- projeto e nao espalhar estrutura de acesso.
--
-- PAPEIS POR FORMULARIO (formulario_id NOT NULL):
--   form_dono       ver + editar + excluir + gerenciar acesso
--   form_gerenciar  ver + editar +           gerenciar acesso
--   form_editar     ver + editar
--   form_ver        ver
--
-- COMO A LISTA AGE (decisao do Pablo, 17/08/2026):
--   * Formulario SEM lista  -> nada muda, valem as regras globais de hoje.
--   * Formulario COM lista  -> a lista RESTRINGE: quem nao esta nela perde
--     o formulario, mesmo tendo 'editar_criar' global. E o unico jeito de
--     "deixar pra apenas uma pessoa".
--   * Chave-mestra: quem tem 'ver_tudo' global SEMPRE le as respostas e
--     SEMPRE consegue abrir/reatribuir a lista. E a valvula de escape para
--     dono desligado da empresa — sem ela, formulario orfao so voltaria com
--     SQL na mao.
--
-- Repare que 'ver_tudo' NAO da direito de editar: ele reatribui o acesso e
-- le, mas para mexer no formulario tem que se colocar como dono. E de
-- proposito — a chave-mestra e para destravar, nao para trabalhar.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;
--   ALTER TABLE public."CS_FORM_ACESSOS" ADD CONSTRAINT cs_form_acessos_sem_form CHECK (formulario_id IS NULL);
--   DELETE FROM public."CS_FORM_ACESSOS" WHERE formulario_id IS NOT NULL;
--   (e recriar as 4 policies com as expressoes anteriores, anotadas em cada bloco abaixo)
-- =========================================================================

-- ── 1) Liberar a coluna formulario_id ────────────────────────────────────
-- A constraint antiga proibia QUALQUER linha por formulario. A nova mantem
-- a mesma garantia para os papeis globais (eles seguem obrigados a ter
-- formulario_id NULL) e abre a excecao so para os papeis novos.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_sem_form;
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_form_por_papel
  CHECK ((formulario_id IS NOT NULL) = (papel IN ('form_dono','form_gerenciar','form_editar','form_ver')));

-- Uma pessoa tem UM papel por formulario. O indice antigo era
-- (papel, user_id, formulario_id), que deixaria a mesma pessoa ser dono E
-- so-ver no mesmo formulario — dois papeis brigando na mesma pergunta.
DROP INDEX IF EXISTS cs_form_acessos_unq_form;
CREATE UNIQUE INDEX cs_form_acessos_unq_form
  ON public."CS_FORM_ACESSOS"(user_id, formulario_id) WHERE formulario_id IS NOT NULL;

-- ── 2) Helpers ───────────────────────────────────────────────────────────
-- Todos SECURITY DEFINER: alem de padronizar, e o que evita recursao
-- infinita quando a policy de CS_FORM_ACESSOS pergunta a CS_FORM_ACESSOS
-- quem pode escrever nela.

-- Meu papel NESTE formulario (null = nao estou na lista).
CREATE OR REPLACE FUNCTION public.cs_form_papel_no_form(_form uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.papel FROM public."CS_FORM_ACESSOS" a
   WHERE a.formulario_id = _form AND a.user_id = auth.uid()
   LIMIT 1;
$$;

-- O formulario tem lista propria? (define se o modo restrito esta ligado)
CREATE OR REPLACE FUNCTION public.cs_form_tem_lista(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a WHERE a.formulario_id = _form);
$$;

-- A lista deste formulario esta me deixando de fora? Usada para PODAR as
-- regras globais — e por isso que ela responde `false` quando nao ha lista.
CREATE OR REPLACE FUNCTION public.cs_form_lista_exclui(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _form IS NOT NULL
     AND public.cs_form_tem_lista(_form)
     AND public.cs_form_papel_no_form(_form) IS NULL;
$$;

-- Capacidade efetiva neste formulario. _cap: ver | editar | excluir | acesso
CREATE OR REPLACE FUNCTION public.cs_form_pode(_form uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _form IS NULL THEN false
    -- Chave-mestra: le tudo e sempre consegue reatribuir. Nao inclui
    -- 'editar'/'excluir' de proposito.
    WHEN _cap IN ('ver','acesso') AND public.cs_form_cap('ver_tudo') THEN true
    ELSE coalesce(
      CASE _cap
        WHEN 'ver'     THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar','form_ver')
        WHEN 'editar'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar')
        WHEN 'excluir' THEN public.cs_form_papel_no_form(_form) =  'form_dono'
        WHEN 'acesso'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar')
                         -- Sem lista ainda: quem ja administra hoje e quem
                         -- cria a primeira linha. Sem isto o botao "Acesso"
                         -- nasceria util para ninguem.
                         OR (NOT public.cs_form_tem_lista(_form)
                             AND (public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir')))
        ELSE false
      END, false)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_papel_no_form(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_tem_lista(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_lista_exclui(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode(uuid, text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_papel_no_form(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_tem_lista(uuid)     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_lista_exclui(uuid)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode(uuid, text)    TO authenticated;

-- ── 3) Policies ──────────────────────────────────────────────────────────
-- O padrao em todas: a expressao de HOJE fica intacta, so ganha o freio
-- `AND NOT cs_form_lista_exclui(...)`; e a lista entra como um OR novo.
-- Formulario sem lista cai exatamente no comportamento anterior.

-- ANTES: USING/CHECK (cs_form_cap('editar_criar') OR cs_form_cap('encerrar_excluir'))
DROP POLICY IF EXISTS cs_forms_update ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_update ON public."CS_FORMULARIOS" FOR UPDATE TO authenticated
  USING (
    ((public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir'))
      AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'editar')
  )
  WITH CHECK (
    ((public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir'))
      AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'editar')
  );

-- ANTES: USING cs_form_cap('encerrar_excluir')
DROP POLICY IF EXISTS cs_forms_delete ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_delete ON public."CS_FORMULARIOS" FOR DELETE TO authenticated
  USING (
    (public.cs_form_cap('encerrar_excluir') AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'excluir')
  );

-- ANTES: USING (cs_form_cap('ver_tudo') OR (cs_form_cap('ver_proprias') AND
--        cs_form_minha_resposta(criado_por, respondente_nome)) OR
--        cs_form_cap_setor(setor) OR cs_form_cap_form_setor(formulario_id))
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS" FOR SELECT TO authenticated
  USING (
    (NOT public.cs_form_lista_exclui(formulario_id)
      AND (
        public.cs_form_cap('ver_tudo')
        OR (public.cs_form_cap('ver_proprias') AND public.cs_form_minha_resposta(criado_por, respondente_nome))
        OR public.cs_form_cap_setor(setor)
        OR public.cs_form_cap_form_setor(formulario_id)
      ))
    OR public.cs_form_pode(formulario_id, 'ver')
  );

-- CS_FORM_ACESSOS: dono/gerenciar do formulario passam a escrever as linhas
-- DAQUELE formulario. A clausula global antiga fica intacta — quem
-- administra em Acesso por Usuario continua podendo tudo.
-- ANTES (nas 3): ((papel='dashboard' AND user_id=auth.uid()) OR
--        (papel<>'dashboard' AND can_access(auth.uid(),'central_servicos_formularios','alterar')))
DROP POLICY IF EXISTS cs_form_acessos_insert ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_insert ON public."CS_FORM_ACESSOS" FOR INSERT TO authenticated
  WITH CHECK (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

DROP POLICY IF EXISTS cs_form_acessos_update ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_update ON public."CS_FORM_ACESSOS" FOR UPDATE TO authenticated
  USING (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  )
  WITH CHECK (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

DROP POLICY IF EXISTS cs_form_acessos_delete ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_delete ON public."CS_FORM_ACESSOS" FOR DELETE TO authenticated
  USING (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000005_juridico_processos_recurso_pericia_propostas =====
-- =========================================================================
-- JURIDICO / PROCESSOS — recurso, pericia medica e propostas
--
-- Tres pedidos do juridico (17/08/2026):
--   1) Condenacao: a empresa vai recorrer? Se sim, custas recursais,
--      seguro garantia e deposito recursal.
--   2) Houve pericia MEDICA? Se sim, valor do perito judicial e do
--      assistente tecnico/medico.
--   3) Propostas (judicial/extrajudicial) na 1a e na 2a audiencia e no
--      decorrer do processo, dizendo de quem partiu: reclamante,
--      reclamada ou juiz.
--
-- ATENCAO AO MODELO — a JUR_PROCESSOS tem UMA LINHA POR MOTIVO, e os
-- campos do processo ficam repetidos em todas elas. Quem le agrupa: os
-- valores por motivo sao SOMADOS, os do processo sao lidos de uma linha
-- so. As colunas criadas aqui sao TODAS do processo, entao NAO podem
-- entrar na soma por motivo — se entrassem, um processo com 3 motivos
-- mostraria as custas recursais triplicadas. Ver `agrupar()` no
-- Processos.tsx, onde elas sao lidas com maxN/first, nunca com sum.
--
-- `valor_seguro_garantia` e `valor_deposito_recursal` JA EXISTIAM:
--   - seguro garantia estava criada e sem uso nenhum na tela;
--   - deposito recursal continua sendo preenchido POR MOTIVO (decisao do
--     Pablo, 17/08/2026); a aba de recurso so mostra a soma, em leitura.
-- Por isso nenhuma das duas e recriada aqui.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."JUR_PROCESSOS"
--     DROP COLUMN IF EXISTS vai_recorrer,
--     DROP COLUMN IF EXISTS valor_custas_recursais,
--     DROP COLUMN IF EXISTS houve_pericia_medica,
--     DROP COLUMN IF EXISTS valor_perito_judicial,
--     DROP COLUMN IF EXISTS valor_assistente_tecnico,
--     DROP COLUMN IF EXISTS propostas_json;
-- =========================================================================

ALTER TABLE public."JUR_PROCESSOS"
  -- 1) Recurso
  ADD COLUMN IF NOT EXISTS vai_recorrer             text,
  ADD COLUMN IF NOT EXISTS valor_custas_recursais   numeric,
  -- 2) Pericia medica
  ADD COLUMN IF NOT EXISTS houve_pericia_medica     text,
  ADD COLUMN IF NOT EXISTS valor_perito_judicial    numeric,
  ADD COLUMN IF NOT EXISTS valor_assistente_tecnico numeric,
  -- 3) Propostas fora de audiencia ("no decorrer do processo").
  --    As propostas DE audiencia continuam dentro de audiencias_json.
  --    text, e nao jsonb, para acompanhar o audiencias_json que ja existe
  --    — os dois sao serializados/lidos do mesmo jeito na tela.
  ADD COLUMN IF NOT EXISTS propostas_json           text;

COMMENT ON COLUMN public."JUR_PROCESSOS".vai_recorrer IS
  'Sim/Nao — a empresa vai recorrer da condenacao. Campo do PROCESSO (repetido nas linhas de motivo).';
COMMENT ON COLUMN public."JUR_PROCESSOS".houve_pericia_medica IS
  'Sim/Nao — houve pericia medica. Campo do PROCESSO (repetido nas linhas de motivo).';
COMMENT ON COLUMN public."JUR_PROCESSOS".propostas_json IS
  'Propostas fora de audiencia: [{data,tipo,quem,valor,descricao}]. As de audiencia ficam em audiencias_json.';

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000006_patrimonio_motivo_indisponivel =====
-- =========================================================================
-- PATRIMONIO — por que o bem esta indisponivel (manutencao OU em contrato)
--
-- Pedido do Pablo (17/08/2026): alguns veiculos ficam alocados a um
-- contrato e o escritorio nao pode agenda-los. Isso nao e manutencao, mas
-- o efeito e o mesmo — o carro nao esta disponivel.
--
-- ESCOLHA DE MODELO: `em_manutencao` continua sendo a chave que diz
-- "indisponivel", e a coluna nova diz o MOTIVO. Nao inventei um segundo
-- booleano nem troquei o campo por um enum, e a razao e pratica: o
-- Agendamento de Veiculos ja bloqueia por `em_manutencao`
-- (disponibilidadeDoVeiculo + cs_veiculos_frota). Pendurando o motivo
-- nele, "Em contrato" passa a bloquear o agendamento POR CONSTRUCAO —
-- nao depende de alguem lembrar de somar a nova condicao em cada tela.
--
-- O preco disso e o nome do campo ficar mais estreito do que o
-- significado; por isso o COMMENT abaixo, e por isso as telas de
-- Patrimonio/Manutencoes passam a filtrar por `motivo_indisponivel` em
-- vez de por `em_manutencao` (senao o Painel de Manutencoes listaria
-- carro que so esta em contrato).
--
-- As datas continuam valendo para os dois motivos: contrato tambem tem
-- prazo, e a constraint sup_patrimonio_datas_coerentes (data so existe
-- com em_manutencao) segue de pe sem alteracao.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
--   ALTER TABLE public.sup_patrimonio DROP COLUMN IF EXISTS motivo_indisponivel;
--   (e recriar cs_veiculos_frota sem a coluna — versao anterior na 20260819)
-- =========================================================================

ALTER TABLE public.sup_patrimonio
  ADD COLUMN IF NOT EXISTS motivo_indisponivel text;

COMMENT ON COLUMN public.sup_patrimonio.em_manutencao IS
  'Bem INDISPONIVEL (nao apenas manutencao). O motivo esta em motivo_indisponivel.';
COMMENT ON COLUMN public.sup_patrimonio.motivo_indisponivel IS
  'manutencao | contrato. NULL quando disponivel. "contrato" = alocado a um contrato, o escritorio nao agenda.';

-- Backfill: tudo que ja estava indisponivel era, por definicao, manutencao
-- — ate agora nao havia outro motivo possivel.
UPDATE public.sup_patrimonio
   SET motivo_indisponivel = 'manutencao'
 WHERE em_manutencao AND motivo_indisponivel IS NULL;

-- E o inverso, para o caso de reaplicacao depois de alguem desmarcar.
UPDATE public.sup_patrimonio
   SET motivo_indisponivel = NULL
 WHERE NOT em_manutencao AND motivo_indisponivel IS NOT NULL;

ALTER TABLE public.sup_patrimonio DROP CONSTRAINT IF EXISTS sup_patrimonio_motivo_coerente;
ALTER TABLE public.sup_patrimonio ADD  CONSTRAINT sup_patrimonio_motivo_coerente
  CHECK (
    (em_manutencao AND motivo_indisponivel IN ('manutencao', 'contrato'))
    OR ((NOT em_manutencao) AND motivo_indisponivel IS NULL)
  );

-- A frota que o Agendamento de Veiculos le precisa devolver o motivo, para
-- a tela poder dizer "em contrato" em vez de "em manutencao".
--
-- DROP antes do CREATE: acrescentar coluna ao RETURNS TABLE muda o tipo de
-- retorno, e o CREATE OR REPLACE recusa isso ("cannot change return type of
-- existing function"). Nao ha view/policy dependendo dela, entao o DROP e
-- seguro; o CREATE logo abaixo, na mesma transacao, repoe.
DROP FUNCTION IF EXISTS public.cs_veiculos_frota();
CREATE OR REPLACE FUNCTION public.cs_veiculos_frota()
RETURNS TABLE(
  id uuid, empresa_id uuid, nome text, identificador text, lotacao text,
  contrato_nome text, foto_path text, em_manutencao boolean,
  data_inicio_manutencao date, data_previsao_fim date,
  motivo_indisponivel text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p.id, p.empresa_id, p.nome, p.identificador, p.lotacao, c.nome,
         p.foto_path,
         p.em_manutencao, p.data_inicio_manutencao, p.data_previsao_fim,
         p.motivo_indisponivel
    FROM public.sup_patrimonio p
    LEFT JOIN public.contratos c ON c.id = p.contrato_id
   WHERE p.categoria = 'veiculo'
     AND p.ativo
     -- Único gate. `empresa_id` continua vindo no retorno porque a reserva é
     -- arquivada na empresa dona do carro — só não filtra mais por ela.
     AND public.tem_acesso_menu('central_servicos_veiculos')
   ORDER BY p.nome;
$$;

REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cs_veiculos_frota() FROM anon;
GRANT EXECUTE ON FUNCTION public.cs_veiculos_frota() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000007_rh_colaboradores_sem_rls_por_linha =====
-- =========================================================================
-- RH / COLABORADORES — tirar a RLS do caminho quente (timeout na tela)
--
-- Sintoma: a tela de Colaboradores demorava demais, as vezes ficava em
-- branco e as vezes mostrava zeros com o erro do Postgres
-- "canceling statement due to statement timeout".
--
-- CAUSA. A policy de SELECT da EMPREGADOS e:
--
--   (auth_user_id = auth.uid())
--   OR has_screen_access(auth.uid(), 'colaboradores', 'visualizar')
--   OR ... mais 8 menus
--
-- O primeiro operando referencia uma COLUNA. Isso impede o planner de
-- icar a expressao para fora do scan: ela vira filtro POR LINHA. Como
-- `auth_user_id = auth.uid()` e falso em praticamente toda linha, cada
-- uma segue para os has_screen_access — que sao plpgsql e fazem ate tres
-- consultas internas cada.
--
-- Com 12.909 empregados isso da centenas de milhares de consultas por
-- varredura. E as duas RPCs da tela NAO eram SECURITY DEFINER, entao
-- pagavam esse custo inteiro, varias vezes (a CTE `flags` e lida por tres
-- CTEs distintas).
--
-- Medido: rodando como `postgres` (que ignora RLS) o dashboard leva ~1 s;
-- como `authenticated` estoura o statement_timeout.
--
-- CORRECAO. As duas RPCs passam a SECURITY DEFINER e checam o acesso UMA
-- vez, no inicio, via rh_pode_ver_colaboradores(). O corpo das consultas
-- nao muda em nada.
--
-- Por que isso NAO afrouxa a seguranca: a policy e all-or-nothing. Quem
-- casa em qualquer um dos 9 menus ja enxergava TODAS as linhas hoje — ela
-- nao recorta empregado por empregado. A unica clausula que recorta e
-- `auth_user_id = auth.uid()` (ver a si mesmo), e quem so tem isso nao
-- alcanca esta tela: ela exige o menu para ser roteada, e estas RPCs sao
-- usadas somente por ela. A funcao nova replica exatamente a mesma lista
-- de menus da policy — mesma resposta, avaliada uma vez em vez de 12.909.
--
-- A policy da tabela fica INTOCADA: quem le a EMPREGADOS direto continua
-- protegido do mesmo jeito.
--
-- Idempotente.
-- ROLLBACK: recriar as duas funcoes sem SECURITY DEFINER e sem o IF do
--   inicio (definicao anterior em qualquer backup), e
--   DROP FUNCTION IF EXISTS public.rh_pode_ver_colaboradores();
-- =========================================================================

-- Mesma condicao da policy erp_auth_read_empregados, sem a parte por linha.
CREATE OR REPLACE FUNCTION public.rh_pode_ver_colaboradores()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'processos', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar');
$$;

REVOKE ALL ON FUNCTION public.rh_pode_ver_colaboradores() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_pode_ver_colaboradores() FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_pode_ver_colaboradores() TO authenticated;

-- As duas RPCs abaixo sao a definicao ATUAL, sem alteracao de logica:
-- ganharam apenas SECURITY DEFINER e o IF de acesso no inicio.
CREATE OR REPLACE FUNCTION public.rh_colaboradores_dashboard(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

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
END $function$;

CREATE OR REPLACE FUNCTION public.rh_colaboradores_lista(_ano integer, _mes integer, _empresa text DEFAULT ''::text, _contrato text DEFAULT ''::text, _situacao text DEFAULT ''::text, _busca text DEFAULT ''::text, _offset integer DEFAULT 0, _limite integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Uma checagem, no lugar de uma por linha. Ver o cabecalho da migration.
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'sem acesso ao cadastro de colaboradores' USING ERRCODE = '42501';
  END IF;

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
END $function$;

REVOKE ALL ON FUNCTION public.rh_colaboradores_dashboard(integer, integer, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_dashboard(integer, integer, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_colaboradores_lista(integer, integer, text, text, text, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000008_rh_sync_senior_empregados =====
-- =========================================================================
-- RH — sincronizacao do cadastro vindo do Senior (BiEmpregados)
--
-- Recebe um lote em jsonb e resolve INSERT/UPDATE de uma vez. A logica
-- mora aqui, e nao no script, para que o robo nao precise de regra nem de
-- leitura previa da tabela.
--
-- CHAVE: (Empresa, Cadastro). Medido em 17/08/2026 nos 13.214 do Senior:
--   numcad sozinho ....................  9.810 distintos  <- FUNDE PESSOAS
--   numemp + numcad ................... 13.152 distintos
--   numemp + tipcol + numcad .......... 13.214 distintos  <- unico
-- `numcad = 1` sao CINCO pessoas diferentes (uma por empresa). Por isso a
-- chave nunca pode ser so o cadastro.
--
-- O par (Empresa, Cadastro) deixa 62 colisoes, todas de tipcol = 2 (68
-- pessoas no total, contra 13.146 de tipcol = 1). A EMPREGADOS nao tem
-- coluna de tipo de colaborador, entao NAO da para separa-las aqui: o
-- script filtra tipcol = 1 e as 68 ficam de fora, de proposito, ate haver
-- decisao sobre criar a coluna.
--
-- NAO ha unique index em (Empresa, Cadastro) porque a tabela JA tem 347
-- pares repetidos de antes desta integracao. Por isso o casamento e feito
-- por SELECT ... LIMIT 1 (menor ID) em vez de ON CONFLICT.
--
-- O QUE ATUALIZA em quem ja existe: so o que muda com o tempo — situacao,
-- data de afastamento e salario. Nome, CPF, admissao e nascimento NAO sao
-- sobrescritos: a tela de Colaboradores permite edicao, e sobrescrever
-- apagaria correcao feita a mao a cada rodada do robo.
--
-- Idempotente: rodar duas vezes com o mesmo lote nao insere de novo nem
-- conta atualizacao (o UPDATE so acontece se algum valor mudou de fato).
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.rh_sync_senior_empregados(jsonb);
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_sync_senior_empregados(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_ign int := 0;
  v_id  bigint;
  v_ex  bigint;
  r     record;
BEGIN
  -- "ID" nao e identity nem tem default: quem insere precisa gerar.
  SELECT coalesce(max("ID"), 0) INTO v_id FROM public."EMPREGADOS";

  FOR r IN
    SELECT * FROM jsonb_to_recordset(coalesce(_linhas, '[]'::jsonb)) AS x(
      empresa bigint, cadastro bigint, nome text, admissao text,
      situacao text, data_afastamento text, filial bigint, sexo text,
      nascimento text, cpf text, pis text, salario text)
  LOOP
    IF r.empresa IS NULL OR r.cadastro IS NULL OR coalesce(btrim(r.nome), '') = '' THEN
      v_ign := v_ign + 1;
      CONTINUE;
    END IF;

    SELECT "ID" INTO v_ex
      FROM public."EMPREGADOS"
     WHERE "Empresa" = r.empresa AND "Cadastro" = r.cadastro
     ORDER BY "ID"
     LIMIT 1;

    IF v_ex IS NULL THEN
      v_id := v_id + 1;
      INSERT INTO public."EMPREGADOS"
        ("ID", "Empresa", "Cadastro", "Nome", "Admissão", "Situação",
         "Data Afastamento", "Filial", "Sexo", "Nascimento", "CPF", "PIS", "Valor Salário")
      VALUES
        (v_id, r.empresa, r.cadastro, r.nome, r.admissao, r.situacao,
         r.data_afastamento, r.filial, r.sexo, r.nascimento, r.cpf, r.pis, r.salario);
      v_ins := v_ins + 1;
    ELSE
      UPDATE public."EMPREGADOS" e
         SET "Situação"         = coalesce(r.situacao, e."Situação"),
             "Data Afastamento" = r.data_afastamento,
             "Valor Salário"    = coalesce(r.salario, e."Valor Salário")
       WHERE e."ID" = v_ex
         AND (e."Situação"         IS DISTINCT FROM coalesce(r.situacao, e."Situação")
           OR e."Data Afastamento" IS DISTINCT FROM r.data_afastamento
           OR e."Valor Salário"    IS DISTINCT FROM coalesce(r.salario, e."Valor Salário"));
      IF FOUND THEN v_upd := v_upd + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'ignorados', v_ign);
END $$;

-- Só o robô sincroniza. Sem GRANT para authenticated/anon: e o unico
-- controle de acesso desta funcao, que e SECURITY DEFINER e escreve direto.
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_empregados(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000009_empregados_indice_empresa_cadastro =====
-- =========================================================================
-- EMPREGADOS — indice em (Empresa, Cadastro)
--
-- A rh_sync_senior_empregados procura cada pessoa do lote por esse par.
-- Sem indice, cada busca era uma varredura completa da tabela: um lote de
-- 500 fazia 500 x 13.526 leituras, e a sincronizacao comecou a estourar o
-- statement_timeout no segundo lote.
--
-- NAO e UNIQUE de proposito: a tabela tem 264 pares repetidos de antes
-- desta integracao (e 83 linhas sem Cadastro). Um unique falharia na
-- criacao. A RPC ja lida com isso pegando o menor "ID" (ORDER BY ... LIMIT 1).
--
-- Idempotente.
-- ROLLBACK: DROP INDEX IF EXISTS public.empregados_empresa_cadastro_idx;
-- =========================================================================

CREATE INDEX IF NOT EXISTS empregados_empresa_cadastro_idx
  ON public."EMPREGADOS" ("Empresa", "Cadastro");

ANALYZE public."EMPREGADOS";

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000010_situacoes_e_cod_situacao =====
-- =========================================================================
-- RH — tabela SITUACOES e a coluna "Cod Situacao" em EMPREGADOS
--
-- `BiEmpregados.sitafa` e a SITUACAO ATUAL do colaborador (7 = Demitido,
-- 1 = Trabalhando, 3 = Auxilio Doenca...), nao a data de afastamento. Ate
-- aqui a sincronizacao gravava so a DESCRICAO, em "Situação". Passa a
-- gravar tambem o CODIGO, que e o que casa com a tabela de dominio.
--
-- CUIDADO COM O TIPO — no Senior os dois lados nao batem sozinhos:
--   BiEmpregados.sitafa   smallint      -> 7
--   BiSituacoes.situacao  varchar(10)   -> "007"  (com zero a esquerda)
-- O MySQL casa por coercao implicita. Aqui os dois viram INTEGER, o que
-- mata essa armadilha: "007" e 7 passam a ser o mesmo valor sempre.
--
-- SEM foreign key de EMPREGADOS para SITUACOES de proposito: a EMPREGADOS
-- tem 13 mil linhas de carga historica e uma FK faria a sincronizacao
-- inteira falhar por causa de um codigo novo que o Senior criasse antes de
-- a dimensao ser replicada. O indice resolve a consulta; a integridade e
-- garantida pelo robo, que replica SITUACOES antes dos empregados.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."EMPREGADOS" DROP COLUMN IF EXISTS "Cod Situacao";
--   DROP FUNCTION IF EXISTS public.rh_sync_senior_situacoes(jsonb);
--   DROP TABLE IF EXISTS public."SITUACOES";
-- =========================================================================

-- ── 1) Dimensao: replica da BiSituacoes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SITUACOES" (
  codigo          integer PRIMARY KEY,
  descricao       text NOT NULL,
  abreviatura     text,
  tipo            text,
  tipo_descricao  text,
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SITUACOES" IS
  'Situacoes do colaborador, replicadas de hagg.BiSituacoes (Senior). Casa com EMPREGADOS."Cod Situacao".';

ALTER TABLE public."SITUACOES" ENABLE ROW LEVEL SECURITY;

-- Tabela de dominio: quem esta logado le (as telas precisam do rotulo).
-- Escrita so pelo robo — nao ha GRANT de INSERT/UPDATE para authenticated.
DROP POLICY IF EXISTS situacoes_select ON public."SITUACOES";
CREATE POLICY situacoes_select ON public."SITUACOES" FOR SELECT TO authenticated USING (true);

-- ── 2) O codigo no cadastro ─────────────────────────────────────────────
ALTER TABLE public."EMPREGADOS"
  ADD COLUMN IF NOT EXISTS "Cod Situacao" integer;

COMMENT ON COLUMN public."EMPREGADOS"."Cod Situacao" IS
  'Codigo da situacao atual (BiEmpregados.sitafa). Casa com SITUACOES.codigo. "Situação" guarda a descricao.';

CREATE INDEX IF NOT EXISTS empregados_cod_situacao_idx
  ON public."EMPREGADOS" ("Cod Situacao");

-- ── 3) Sincronizacao da dimensao ────────────────────────────────────────
-- Upsert simples: a BiSituacoes tem 110 linhas e o codigo e a chave.
CREATE OR REPLACE FUNCTION public.rh_sync_senior_situacoes(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_qtd int := 0;
BEGIN
  INSERT INTO public."SITUACOES" (codigo, descricao, abreviatura, tipo, tipo_descricao, atualizado_em)
  SELECT x.codigo, x.descricao, x.abreviatura, x.tipo, x.tipo_descricao, now()
    FROM jsonb_to_recordset(coalesce(_linhas, '[]'::jsonb)) AS x(
           codigo integer, descricao text, abreviatura text, tipo text, tipo_descricao text)
   WHERE x.codigo IS NOT NULL AND coalesce(btrim(x.descricao), '') <> ''
      ON CONFLICT (codigo) DO UPDATE
         SET descricao      = EXCLUDED.descricao,
             abreviatura    = EXCLUDED.abreviatura,
             tipo           = EXCLUDED.tipo,
             tipo_descricao = EXCLUDED.tipo_descricao,
             atualizado_em  = now()
       WHERE public."SITUACOES".descricao      IS DISTINCT FROM EXCLUDED.descricao
          OR public."SITUACOES".abreviatura    IS DISTINCT FROM EXCLUDED.abreviatura
          OR public."SITUACOES".tipo           IS DISTINCT FROM EXCLUDED.tipo
          OR public."SITUACOES".tipo_descricao IS DISTINCT FROM EXCLUDED.tipo_descricao;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN jsonb_build_object('gravadas', v_qtd);
END $$;

REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rh_sync_senior_situacoes(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_situacoes(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000011_rh_sync_empregados_com_cod_situacao =====
-- Recria a rh_sync_senior_empregados da 20260906000008 acrescentando
-- "Cod Situacao". Arquivo proprio em vez de editar a migration antiga:
-- reescrever historico ja aplicado esconde o que mudou e quando.

-- =========================================================================
-- RH — sincronizacao do cadastro vindo do Senior (BiEmpregados)
--
-- Recebe um lote em jsonb e resolve INSERT/UPDATE de uma vez. A logica
-- mora aqui, e nao no script, para que o robo nao precise de regra nem de
-- leitura previa da tabela.
--
-- ATUALIZADA em 18/08/2026: passa a gravar tambem "Cod Situacao"
-- (BiEmpregados.sitafa), que casa com a tabela SITUACOES.
--
-- CHAVE: (Empresa, Cadastro). Medido em 17/08/2026 nos 13.214 do Senior:
--   numcad sozinho ....................  9.810 distintos  <- FUNDE PESSOAS
--   numemp + numcad ................... 13.152 distintos
--   numemp + tipcol + numcad .......... 13.214 distintos  <- unico
-- `numcad = 1` sao CINCO pessoas diferentes (uma por empresa). Por isso a
-- chave nunca pode ser so o cadastro.
--
-- O par (Empresa, Cadastro) deixa 62 colisoes, todas de tipcol = 2 (68
-- pessoas no total, contra 13.146 de tipcol = 1). A EMPREGADOS nao tem
-- coluna de tipo de colaborador, entao NAO da para separa-las aqui: o
-- script filtra tipcol = 1 e as 68 ficam de fora, de proposito, ate haver
-- decisao sobre criar a coluna.
--
-- NAO ha unique index em (Empresa, Cadastro) porque a tabela JA tem 347
-- pares repetidos de antes desta integracao. Por isso o casamento e feito
-- por SELECT ... LIMIT 1 (menor ID) em vez de ON CONFLICT.
--
-- O QUE ATUALIZA em quem ja existe: so o que muda com o tempo — situacao,
-- data de afastamento e salario. Nome, CPF, admissao e nascimento NAO sao
-- sobrescritos: a tela de Colaboradores permite edicao, e sobrescrever
-- apagaria correcao feita a mao a cada rodada do robo.
--
-- Idempotente: rodar duas vezes com o mesmo lote nao insere de novo nem
-- conta atualizacao (o UPDATE so acontece se algum valor mudou de fato).
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.rh_sync_senior_empregados(jsonb);
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_sync_senior_empregados(_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_ign int := 0;
  v_id  bigint;
  v_ex  bigint;
  r     record;
BEGIN
  -- "ID" nao e identity nem tem default: quem insere precisa gerar.
  SELECT coalesce(max("ID"), 0) INTO v_id FROM public."EMPREGADOS";

  FOR r IN
    SELECT * FROM jsonb_to_recordset(coalesce(_linhas, '[]'::jsonb)) AS x(
      empresa bigint, cadastro bigint, nome text, admissao text,
      situacao text, data_afastamento text, filial bigint, sexo text,
      nascimento text, cpf text, pis text, salario text, cod_situacao integer)
  LOOP
    IF r.empresa IS NULL OR r.cadastro IS NULL OR coalesce(btrim(r.nome), '') = '' THEN
      v_ign := v_ign + 1;
      CONTINUE;
    END IF;

    SELECT "ID" INTO v_ex
      FROM public."EMPREGADOS"
     WHERE "Empresa" = r.empresa AND "Cadastro" = r.cadastro
     ORDER BY "ID"
     LIMIT 1;

    IF v_ex IS NULL THEN
      v_id := v_id + 1;
      INSERT INTO public."EMPREGADOS"
        ("ID", "Empresa", "Cadastro", "Nome", "Admissão", "Situação", "Cod Situacao",
         "Data Afastamento", "Filial", "Sexo", "Nascimento", "CPF", "PIS", "Valor Salário")
      VALUES
        (v_id, r.empresa, r.cadastro, r.nome, r.admissao, r.situacao, r.cod_situacao,
         r.data_afastamento, r.filial, r.sexo, r.nascimento, r.cpf, r.pis, r.salario);
      v_ins := v_ins + 1;
    ELSE
      UPDATE public."EMPREGADOS" e
         SET "Situação"         = coalesce(r.situacao, e."Situação"),
             "Cod Situacao"     = coalesce(r.cod_situacao, e."Cod Situacao"),
             "Data Afastamento" = r.data_afastamento,
             "Valor Salário"    = coalesce(r.salario, e."Valor Salário")
       WHERE e."ID" = v_ex
         AND (e."Situação"         IS DISTINCT FROM coalesce(r.situacao, e."Situação")
           OR e."Cod Situacao"     IS DISTINCT FROM coalesce(r.cod_situacao, e."Cod Situacao")
           OR e."Data Afastamento" IS DISTINCT FROM r.data_afastamento
           OR e."Valor Salário"    IS DISTINCT FROM coalesce(r.salario, e."Valor Salário"));
      IF FOUND THEN v_upd := v_upd + 1; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd, 'ignorados', v_ign);
END $$;

-- Só o robô sincroniza. Sem GRANT para authenticated/anon: e o unico
-- controle de acesso desta funcao, que e SECURITY DEFINER e escreve direto.
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rh_sync_senior_empregados(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_empregados(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000013_recrutamento_paralelo_trigger =====
-- =========================================================================
-- RECRUTAMENTO — o avanco para ADMISSAO vira regra do BANCO
--
-- SST e Compras aprovam em MODULOS DIFERENTES (SST > ASO/Admissao e
-- Suprimentos > EPIs/Admissoes), cada um com o seu acesso. Nenhuma das duas
-- telas pode ser dona da regra "os dois aprovaram, entao vai para
-- ADMISSAO": qualquer uma que fosse teria de saber do estado da outra, e a
-- primeira a aprovar nao tem como saber se sera a ultima.
--
-- Por isso o avanco e um TRIGGER: quem quer que grave o segundo `ok`
-- dispara a passagem, sem que a tela precise saber disso.
--
-- Tambem registra no historico, porque a movimentacao deixa de ter uma tela
-- por tras para faze-lo.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_rec_paralelo_admissao ON public."WA_CURRICULOS";
--   DROP FUNCTION IF EXISTS public.rec_paralelo_admissao();
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_paralelo_admissao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- So age na etapa paralela e so quando os DOIS estao aprovados. Os nomes
  -- antigos entram porque dado gravado antes da fusao continua valendo.
  IF NEW.etapa_processo IN ('SST + COMPRAS', 'EXAME SST', 'COMPRAS')
     AND NEW.sst_ok IS TRUE AND NEW.compras_ok IS TRUE
  THEN
    NEW.etapa_processo   := 'ADMISSÃO';
    NEW.etapa_changed_at := now();

    INSERT INTO public."RECRUTAMENTO_HISTORICO"
      (solicitacao_id, candidato_id, candidato_nome, evento, de_status, para_status, papel, usuario_nome, detalhe)
    VALUES
      (NEW.vaga_id, NEW.id, NEW.nome, 'SST e Compras aprovaram → Admissão',
       'SST + COMPRAS', 'ADMISSÃO', 'SST + Suprimentos', 'Sistema',
       'Avanço automático: os dois setores aprovaram.');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rec_paralelo_admissao ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_paralelo_admissao
  BEFORE UPDATE OF sst_ok, compras_ok ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_paralelo_admissao();

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000014_vw_candidatos_compras_ok =====
-- =========================================================================
-- VW_RECRUTAMENTO_CANDIDATOS — expor compras_ok e a desistencia
--
-- A tela de Suprimentos (EPIs — Admissoes) precisa saber se o Compras ja
-- aprovou, e as telas de setor precisam distinguir quem desistiu de quem foi
-- reprovado. Colunas criadas em 20260906000012/13, fora da view — que lista
-- coluna a coluna.
--
-- ⚠ ARMADILHA: a primeira versao desta migration fez
--     CREATE OR REPLACE VIEW v AS SELECT v.*, ... FROM v JOIN ...
--   achando que "v.*" seria resolvido contra a versao ANTIGA. Nao e: o
--   Postgres aceita a criacao e a view passa a referenciar a si mesma —
--   "infinite recursion detected in rules". Como as telas do SST e do
--   Juridico leem daqui, elas quebraram na hora. Nunca reescrever uma view
--   a partir dela mesma; e preciso repetir a lista inteira, como abaixo.
--
-- Idempotente.
-- ROLLBACK: recriar sem as 6 colunas finais.
-- =========================================================================

CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" AS
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
    (b.cpf_digits IS NOT NULL) AS possui_restricao, b.motivo AS restricao_motivo,
    -- Novas (vao no fim: CREATE OR REPLACE nao aceita coluna no meio).
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por
  FROM public."WA_CURRICULOS" c
  JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = c.vaga_id
  LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b
    ON b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''), '\D', '', 'g')
  WHERE c.etapa_processo IS NOT NULL;

ALTER VIEW public."VW_RECRUTAMENTO_CANDIDATOS" SET (security_invoker = true);
GRANT SELECT ON public."VW_RECRUTAMENTO_CANDIDATOS" TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000015_menu_epis_admissoes =====
-- =========================================================================
-- SUPRIMENTOS — menu "EPIs — Admissoes"
--
-- Tela onde o COMPRAS aprova os materiais/EPIs do candidato em admissao,
-- espelhando a do SST (sst_aso). Precisa de menu proprio porque o controle
-- de acesso e por menu: quem entra aqui e o Compras, nao o RH.
--
-- O toggle de Acesso por Usuario libera as acoes de trabalho junto com a
-- tela (ver ACOES_POR_MENU no ModulosMenusTab): sem `alterar`, a pessoa
-- abriria a fila e nao conseguiria aprovar nada — o mesmo sintoma que
-- Patrimonio teve em 17/08/2026.
--
-- Idempotente.
-- ROLLBACK: DELETE FROM public.app_menu WHERE codigo = 'sup_epis_admissao';
-- =========================================================================

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_epis_admissao', 'EPIs — Admissões', '/app/suprimentos/epis-admissoes',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

NOTIFY pgrst, 'reload schema';


-- ===== 20260906000016_recrutamento_status_e_portal =====
-- =========================================================================
-- RECRUTAMENTO — status da vaga alinhado ao fluxo novo, e a vaga fica no
-- portal /vagas ate a ADMISSAO
--
-- TRES CORRECOES:
--
-- 1) sr_rank_etapa nao acompanhou o fluxo. Ele ainda ranqueava 'EXAME SST'
--    e 'COMPRAS' separados (que viraram 'SST + COMPRAS'), usava 'APROVADOS'
--    no plural enquanto o kanban usa 'APROVADO' no singular, punha
--    DOCUMENTACAO depois de COMPRAS quando ela vem ANTES, e nao conhecia
--    'ADMISSAO'. Etapa desconhecida cai em 0, e com rank 0 o status da vaga
--    voltava para "Vaga aberta" — a vaga parecia nao ter andado.
--
-- 2) A vaga so aparecia no portal publico com status
--    'Vaga aberta - Seleção de Currículos'. Assim que o primeiro candidato
--    saia da triagem, a vaga sumia de /vagas — mesmo ainda precisando de
--    gente, porque candidato desiste e reprova o tempo todo. Passa a ficar
--    visivel durante TODO o processo e so sair quando alguem e efetivado.
--
-- 3) Status novo para a etapa paralela: 'Aguardando SST e Compras'. Os tres
--    antigos ('Encaminhado para SST (ASO)', 'ASO Aprovado - Aguardando
--    Informe de EPIs', 'Aguardando Confirmação Compras') descreviam uma
--    fila que nao existe mais.
--
-- Idempotente.
-- ROLLBACK: definicoes anteriores em 20260618000001 e nas migrations do
--   portal; o status 'Aguardando SST e Compras' volta a ser um dos tres
--   antigos por UPDATE manual.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sr_rank_etapa(p text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p
    WHEN 'ENTRADA'            THEN 1
    WHEN 'TRIAGEM'            THEN 2
    WHEN 'JURÍDICO'           THEN 3
    WHEN 'ENTREVISTA'         THEN 4
    WHEN 'ENTREVISTA GESTOR'  THEN 5
    WHEN 'APROVADO'           THEN 6
    WHEN 'APROVADOS'          THEN 6   -- nome antigo, ainda gravado em registros
    WHEN 'DOCUMENTAÇÃO'       THEN 7   -- vem ANTES do SST no fluxo real
    WHEN 'SST + COMPRAS'      THEN 8
    WHEN 'EXAME SST'          THEN 8   -- antes da fusao
    WHEN 'COMPRAS'            THEN 8   -- antes da fusao
    WHEN 'ADMISSÃO'           THEN 9
    ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.sr_sync_status_solicitacao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_vaga bigint; v_atual text; v_rank int; v_envadm timestamptz; v_new text;
BEGIN
  v_vaga := COALESCE(NEW.vaga_id, OLD.vaga_id);
  IF v_vaga IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_atual FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
  -- Vaga que nem chegou ao Recrutamento, ou ja encerrada, nao e dirigida
  -- pelo candidato.
  IF v_atual IS NULL OR v_atual IN ('Pendente Operacional','Pendente Recrutamento','Reprovada','Concluída') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- O candidato MAIS ADIANTADO manda no status da vaga. Desistente e
  -- reprovado ficam de fora: eles nao representam o andamento.
  SELECT public.sr_rank_etapa(c.etapa_processo), c.enviado_admissao_em
    INTO v_rank, v_envadm
    FROM public."WA_CURRICULOS" c
   WHERE c.vaga_id = v_vaga
     AND c.etapa_processo IS NOT NULL
     AND c.etapa_processo <> 'Reprovado'
   ORDER BY public.sr_rank_etapa(c.etapa_processo) DESC,
            c.enviado_admissao_em DESC NULLS LAST
   LIMIT 1;

  v_new := CASE
    WHEN v_rank IS NULL OR v_rank <= 2 THEN 'Vaga aberta - Seleção de Currículos'
    WHEN v_rank = 3 THEN 'Em análise jurídica'
    WHEN v_rank = 4 THEN 'Entrevista e Avaliação'
    WHEN v_rank = 5 THEN 'Entrevista com Gestor'
    WHEN v_rank = 6 THEN 'Aprovado - Aguardando SST'
    WHEN v_rank = 7 THEN 'Compras Confirmou - Aguardando Documentação'
    WHEN v_rank = 8 THEN 'Aguardando SST e Compras'
    -- ADMISSAO: so vira 'Contratado' quando alguem foi de fato EFETIVADO.
    -- Estar na coluna nao basta — e o envio a Admissao que fecha a vaga.
    WHEN v_rank = 9 THEN CASE WHEN v_envadm IS NOT NULL THEN 'Contratado' ELSE 'Aguardando SST e Compras' END
    ELSE v_atual END;

  IF v_new IS DISTINCT FROM v_atual THEN
    UPDATE public."SISTEMA_RECRUTAMENTO" SET status = v_new WHERE id = v_vaga;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ── Portal publico ──────────────────────────────────────────────────────
-- Lista de EXCLUSAO em vez de inclusao: status novo que apareca no fluxo
-- continua visivel sozinho, sem precisar lembrar de vir aqui. Sai do ar
-- quem foi contratado, encerrado, reprovado ou ainda nem foi aprovado.
CREATE OR REPLACE FUNCTION public.portal_vagas_por_cidade(p_cidade text)
RETURNS TABLE(id integer, cargo text, contrato text, cidade text, escala text,
              salario text, beneficios text, quantidade_vagas integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s."id", s."cargo", s."contrato", s."cidade", s."escala",
         s."salario", s."beneficios", s."quantidade_vagas"
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" NOT IN ('Pendente Operacional','Pendente Recrutamento',
                            'Reprovada','Concluída','Contratado')
     AND btrim(lower(s."cidade")) = btrim(lower(coalesce(p_cidade, '')))
   ORDER BY s."cargo";
$$;

CREATE OR REPLACE FUNCTION public.portal_cidades_com_vagas()
RETURNS TABLE(cidade text, vagas bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT btrim(s."cidade") AS cidade, count(*) AS vagas
    FROM public."SISTEMA_RECRUTAMENTO" s
   WHERE s."status" NOT IN ('Pendente Operacional','Pendente Recrutamento',
                            'Reprovada','Concluída','Contratado')
     AND btrim(coalesce(s."cidade",'')) <> ''
   GROUP BY 1
   ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.portal_vagas_por_cidade(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_cidades_com_vagas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_vagas_por_cidade(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_cidades_com_vagas() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260909000005_solicitacoes_demissao.sql
-- =========================================================================
-- =========================================================================
-- SOLICITAÇÃO DE DEMISSÃO — encarregado → operacional → RH
--
-- O FLUXO
--   1. O ENCARREGADO abre a solicitação já completa (dados do colaborador,
--      motivos, aviso e documentos anexados).
--   2. O OPERACIONAL aprova ou reprova. Reprovar EXIGE motivo — sem isso o
--      encarregado não sabe o que corrigir.
--   3. O RH recebe só o que o operacional aprovou e conclui.
--
-- O status é a memória desse caminho, e por isso ninguém escreve status
-- direto na tela: cada etapa grava quem decidiu e quando.
--
--   Pendente Operacional → Pendente RH → Concluída
--                        ↘ Reprovada
--
-- Encarregado e operacional enxergam TODAS as solicitações em qualquer
-- status (o pedido era acompanhar o andamento do começo ao fim); quem entra
-- em cada tela é decidido pelo menu, como no resto do sistema.
--
-- Espelha SISTEMA_SOLICITACOES_FERIAS (20260617000004): RLS liberada para
-- authenticated, controle de acesso no menu/RouteGuard.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TABLE public."SISTEMA_SOL_DEMISSAO_ANEXOS";
--   DROP TABLE public."SISTEMA_SOLICITACOES_DEMISSAO";
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('encarregados_solicitar_demissao','operacional_demissoes','rh_demissoes');
--   DELETE FROM public.app_modulo WHERE codigo = 'operacional';
-- =========================================================================

-- ── 1. A solicitação ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_DEMISSAO" (
  id                    BIGSERIAL PRIMARY KEY,

  -- Quem pediu (o encarregado logado).
  solicitante_nome      TEXT,
  solicitante_email     TEXT,
  data_solicitacao      DATE,

  -- Quem vai ser desligado. `colaborador_id` é o ID em EMPREGADOS e serve de
  -- prova de que a pessoa foi ESCOLHIDA na lista, não digitada à mão: os
  -- campos que vêm do cadastro (posto, contrato, escala) chegam travados na
  -- tela justamente porque saem daqui.
  colaborador_id        BIGINT,
  colaborador_nome      TEXT,
  colaborador_cpf       TEXT,
  colaborador_posto     TEXT,
  colaborador_cargo     TEXT,
  colaborador_filial    TEXT,
  colaborador_admissao  DATE,
  colaborador_telefone  TEXT,
  colaborador_email     TEXT,
  contrato              TEXT,
  contrato_id           BIGINT,
  escala                TEXT,

  -- Motivos (passo 2 do formulário).
  motivo_solicitacao    TEXT,
  motivo_pedido         TEXT,
  relato               TEXT,

  -- Aviso e dados adicionais (passo 3).
  termino_experiencia   TEXT,
  data_aviso            DATE,
  modelo_aviso          TEXT,

  -- Andamento.
  status                TEXT NOT NULL DEFAULT 'Pendente Operacional',
  operacional_por       TEXT,
  operacional_em        TIMESTAMPTZ,
  operacional_motivo    TEXT,     -- obrigatório na reprovação
  rh_por                TEXT,
  rh_em                 TIMESTAMPTZ,
  rh_observacao         TEXT,

  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssd_status_idx      ON public."SISTEMA_SOLICITACOES_DEMISSAO"(status);
CREATE INDEX IF NOT EXISTS ssd_solicitante_idx ON public."SISTEMA_SOLICITACOES_DEMISSAO"(solicitante_email);
CREATE INDEX IF NOT EXISTS ssd_colaborador_idx ON public."SISTEMA_SOLICITACOES_DEMISSAO"(colaborador_id);
CREATE INDEX IF NOT EXISTS ssd_criado_idx      ON public."SISTEMA_SOLICITACOES_DEMISSAO"(criado_em DESC);

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOLICITACOES_DEMISSAO" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_SOLICITACOES_DEMISSAO_id_seq" TO authenticated;

DROP POLICY IF EXISTS ssd_all_auth ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE POLICY ssd_all_auth ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2. Os documentos anexados ────────────────────────────────────────
-- Uma linha por arquivo. O arquivo em si vive no bucket privado
-- `demissoes-docs`; aqui fica só o caminho, aberto por URL assinada.
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOL_DEMISSAO_ANEXOS" (
  id              BIGSERIAL PRIMARY KEY,
  solicitacao_id  BIGINT NOT NULL REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  tamanho         BIGINT,
  tipo            TEXT,
  enviado_por     TEXT,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ssda_sol_idx ON public."SISTEMA_SOL_DEMISSAO_ANEXOS"(solicitacao_id);

ALTER TABLE public."SISTEMA_SOL_DEMISSAO_ANEXOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOL_DEMISSAO_ANEXOS" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_SOL_DEMISSAO_ANEXOS_id_seq" TO authenticated;

DROP POLICY IF EXISTS ssda_all_auth ON public."SISTEMA_SOL_DEMISSAO_ANEXOS";
CREATE POLICY ssda_all_auth ON public."SISTEMA_SOL_DEMISSAO_ANEXOS"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 3. Bucket dos documentos ─────────────────────────────────────────
-- Privado e com teto de 10 MB por arquivo — o mesmo limite que a tela
-- valida antes de enviar, para o erro aparecer no formulário e não como um
-- 413 sem explicação.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('demissoes-docs', 'demissoes-docs', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS demissoes_docs_select ON storage.objects;
CREATE POLICY demissoes_docs_select ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'demissoes-docs');

DROP POLICY IF EXISTS demissoes_docs_insert ON storage.objects;
CREATE POLICY demissoes_docs_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'demissoes-docs');

DROP POLICY IF EXISTS demissoes_docs_delete ON storage.objects;
CREATE POLICY demissoes_docs_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'demissoes-docs');

-- ── 4. Navegação e acesso ────────────────────────────────────────────
-- Módulo OPERACIONAL: nasce agora porque a fila de aprovação é dele. Fica
-- logo abaixo de Encarregados, que é de onde as solicitações chegam.
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'operacional', 'Operacional', 'Aprovações e acompanhamento das solicitações',
       'ClipboardCheck',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'encarregados'),
                (SELECT max(ordem) FROM public.app_modulo), 200) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'operacional');

-- Um menu por tela: o acesso é por menu, e aqui são três públicos distintos
-- (encarregado abre, operacional decide, RH conclui).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + x.ordem,
       true
  FROM (VALUES
    ('encarregados', 'encarregados_solicitar_demissao', 'Solicitar Demissão',      '/app/encarregados/solicitar-demissao', 10),
    ('operacional',  'operacional_demissoes',           'Solicitações de Demissão', '/app/operacional/solicitacoes-demissao', 10),
    ('rh',           'rh_demissoes',                    'Solicitações de Demissão', '/app/rh/solicitacoes-demissao',          10)
  ) AS x(modulo, codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = x.modulo
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT codigo, nome, rota FROM public.app_menu
 WHERE codigo IN ('encarregados_solicitar_demissao','operacional_demissoes','rh_demissoes')
 ORDER BY codigo;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260909000006_acesso_toggle_concede_acoes.sql
-- =========================================================================
-- =========================================================================
-- ACESSO POR USUÁRIO — marcar a tela passa a liberar a tela
--
-- O PROBLEMA
-- O toggle de Administração › Acesso por Usuário gravava só a ação
-- 'visualizar'. As ações de trabalho (incluir/alterar/aprovar/exportar) só
-- saíam para 7 menus escritos numa lista fixa dentro do ModulosMenusTab, e
-- todo menu novo nascia fora dela. O admin marcava a tela, o usuário entrava
-- e não conseguia fazer nada: ou o botão não aparecia (a tela pergunta
-- `can("alterar", …)`), ou aparecia e o RLS recusava a gravação.
--
-- Em 09/09/2026, no menu recrutamento_gestao: 45 pessoas com a tela marcada e
-- apenas 1 conseguindo aprovar uma vaga. Foi assim que o problema apareceu.
--
-- O QUE MUDA
-- A tela passou a gravar sempre o conjunto de trabalho, para qualquer menu
-- (ver ACOES_DO_TOGGLE_PADRAO em ModulosMenusTab.tsx). Esta migration alinha
-- o que JÁ ESTÁ gravado: para cada (usuário, menu) com linha de 'visualizar'
-- sem empresa, completa as ações que faltam com o MESMO valor de allow —
-- quem estava liberado passa a poder trabalhar, quem estava explicitamente
-- negado continua negado em todas.
--
-- ESCOPO DESTA RODADA: só os menus do Recrutamento e Seleção, que é onde o
-- problema apareceu e trava gente hoje. O resto do sistema fica como está,
-- para ser conferido com calma — são 91 pessoas em 171 telas no total. Para
-- ampliar depois, troque o filtro `menu_codigo LIKE 'recrutamento%'` pelo
-- conjunto desejado e rode de novo: a migration é idempotente.
--
-- 'excluir', 'executar_ia' e 'alterar_dre' ficam de fora de propósito:
-- liberar a tela não é autorizar apagar registro nem gastar IA. Essas
-- continuam vindo de perfil de acesso, concedidas caso a caso.
--
-- Só mexe em linhas com empresa_id IS NULL, que é o recorte que o toggle
-- escreve. Exceções por empresa, se existirem, continuam mandando.
--
-- Idempotente: roda de novo sem duplicar (NOT EXISTS, e não ON CONFLICT — a
-- UNIQUE da tabela inclui empresa_id, e NULL não conflita com NULL no
-- Postgres, então ON CONFLICT não pegaria nada aqui).
--
-- ROLLBACK:
--   DELETE FROM public.screen_permission_user
--    WHERE motivo = 'backfill 20260909: toggle concede as acoes de trabalho';
-- =========================================================================

-- ── 1. Foto de antes, para conferência e para desfazer com segurança ──
CREATE TABLE IF NOT EXISTS public.bkp_screen_permission_20260909 AS
SELECT * FROM public.screen_permission_user;

-- ── 2. Completa as ações que faltam ──────────────────────────────────
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT base.user_id, base.menu_codigo, a.acao, base.allow, NULL,
       'backfill 20260909: toggle concede as acoes de trabalho'
  FROM (
    SELECT DISTINCT ON (user_id, menu_codigo) user_id, menu_codigo, allow
      FROM public.screen_permission_user
     WHERE acao = 'visualizar'
       AND empresa_id IS NULL
       AND menu_codigo LIKE 'recrutamento%'      -- ← escopo desta rodada
     ORDER BY user_id, menu_codigo, updated_at DESC
  ) base
  CROSS JOIN (VALUES
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('aprovar'::public.app_acao),
    ('exportar'::public.app_acao)
  ) AS a(acao)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.screen_permission_user x
    WHERE x.user_id     = base.user_id
      AND x.menu_codigo = base.menu_codigo
      AND x.acao        = a.acao
      AND x.empresa_id IS NULL
 );

-- ── 3. Conferência ───────────────────────────────────────────────────
-- Antes: 45 pessoas viam o Recrutamento e 1 conseguia agir. Depois, as duas
-- colunas têm que bater.
SELECT
  count(*) FILTER (WHERE acao = 'visualizar' AND allow) AS veem_a_tela,
  count(*) FILTER (WHERE acao = 'alterar'    AND allow) AS podem_trabalhar
  FROM public.screen_permission_user
 WHERE menu_codigo = 'recrutamento_gestao' AND empresa_id IS NULL;

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260909000007_operacional_gestao_recrutamento.sql
-- =========================================================================
-- =========================================================================
-- OPERACIONAL — menu "Gestão Recrutamento"
--
-- A mesma tela do Recrutamento e Seleção, recortada na etapa 1: o Operacional
-- vê só o que está "Pendente Operacional" e decide se vira vaga. O React
-- reaproveita o componente (Recrutamento.tsx, escopo="operacional") em vez de
-- clonar a tela — o que muda aqui é QUEM entra e o que o banco deixa fazer.
--
-- POR QUE UM MENU PRÓPRIO
-- O acesso é por menu. Sem um código só dele, liberar o Operacional
-- obrigaria a conceder 'recrutamento_gestao', que é a tela inteira do
-- Recrutamento — currículos, candidatos, kanban, mover etapa. O operacional
-- não precisa de nada disso e não deveria receber junto.
--
-- AS POLICIES
-- As tabelas do Recrutamento só aceitam quem tem 'recrutamento_gestao' (ou o
-- menu do encarregado). Em vez de reescrever aquelas policies, esta migration
-- ACRESCENTA uma permissiva por tabela: no Postgres, políticas permissivas se
-- combinam por OR, então nada do que já valia deixa de valer — só passa a
-- valer também para quem tem o menu novo. Desfazer é dropar as quatro.
--
-- Só as tabelas que a etapa 1 usa de verdade: a lista/decisão, o log de
-- status, o histórico e o chat da solicitação. Currículos, entrevista e
-- arquivos do candidato ficam de fora — são das etapas seguintes, e o
-- operacional não abre nenhuma delas.
--
-- Idempotente.
-- ROLLBACK:
--   DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
--   DROP POLICY IF EXISTS sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
--   DROP POLICY IF EXISTS recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO";
--   DROP POLICY IF EXISTS recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS";
--   DELETE FROM public.app_menu WHERE codigo = 'operacional_recrutamento';
-- =========================================================================

-- ── 1. O menu ────────────────────────────────────────────────────────
-- O módulo 'operacional' nasce em 20260909000005; o COALESCE evita depender
-- da ordem em que as duas migrations forem aplicadas.
INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'operacional', 'Operacional', 'Diárias, escala e aprovações',
       'CalendarCheck2',
       COALESCE((SELECT ordem FROM public.app_modulo WHERE codigo = 'encarregados'),
                (SELECT max(ordem) FROM public.app_modulo), 200) + 1
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'operacional');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'operacional_recrutamento', 'Gestão Recrutamento',
       '/app/operacional/recrutamento',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 10,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── 2. As policies do menu novo ──────────────────────────────────────
-- A fila e a decisão (aprovar/reprovar é UPDATE de status).
DROP POLICY IF EXISTS sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_operacional ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar')
  );

-- O tempo em cada etapa, que a tela lê junto da lista e grava ao decidir.
DROP POLICY IF EXISTS sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG";
CREATE POLICY sistema_recrutamento_status_log_operacional ON public."SISTEMA_RECRUTAMENTO_STATUS_LOG"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'aprovar')
  );

-- A timeline do drawer: sem isto a decisão do operacional não fica registrada.
DROP POLICY IF EXISTS recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO";
CREATE POLICY recrutamento_historico_operacional ON public."RECRUTAMENTO_HISTORICO"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'incluir')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
  );

-- O chat da solicitação, que é como o operacional pergunta algo ao solicitante
-- antes de reprovar.
DROP POLICY IF EXISTS recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS";
CREATE POLICY recrutamento_mensagens_operacional ON public."RECRUTAMENTO_MENSAGENS"
  FOR ALL TO authenticated
  USING (has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'))
  WITH CHECK (
    has_screen_access(auth.uid(), 'operacional_recrutamento', 'incluir')
    OR has_screen_access(auth.uid(), 'operacional_recrutamento', 'alterar')
  );

-- ── Conferência ──────────────────────────────────────────────────────
SELECT codigo, nome, rota, ativo FROM public.app_menu WHERE codigo = 'operacional_recrutamento';

NOTIFY pgrst, 'reload schema';


-- =========================================================================
-- 20260909000008_patrimonio_carteira.sql
-- =========================================================================
-- =========================================================================
-- JURÍDICO / PATRIMÔNIO — a carteira, do jeito que a planilha registra
--
-- O cadastro de patrimônio guardava só a identificação (tipo, endereço,
-- proprietário). A gestão de verdade — a que está na planilha ATIVO
-- IMOBILIZADO — é sobre DINHEIRO: quanto foi o contrato, quanto entrou de
-- entrada, quantas parcelas já foram, quanto ainda falta e qual é a próxima.
-- Sem esses campos a tela mostra imóvel; o que o Jurídico precisa ver é a
-- posição de cada financiamento.
--
-- DECISÕES
--   • `localizacao` continua sendo o endereço (a tela passa a rotular
--     "Endereço"). Criar uma coluna nova só pelo rótulo deixaria duas colunas
--     dizendo a mesma coisa, e a antiga com dado.
--   • `status` (Ativo/Inativo) é o cadastro; `situacao_pagamento` (PAGO,
--     PAGANDO, VENCIDO, AGUARDANDO) é a posição financeira. São perguntas
--     diferentes e a tela mostra as duas.
--   • As parcelas ganham tabela própria em vez de virarem obrigações: uma
--     obrigação é uma conta do mês (luz, IPTU); parcela de financiamento é
--     outro bicho — tem saldo devedor, seguro, taxa e correção, e vem às
--     centenas (a CASA CADU sozinha tem 420).
--   • Os campos que variam de contrato para contrato (seguro, taxa adm,
--     encargo, INCC, juro, valor corrigido) ficam em `detalhes` jsonb. Cada
--     aba da planilha tem um conjunto diferente; virar coluna faria uma
--     tabela com 12 colunas quase sempre nulas.
--
-- Idempotente.
-- ROLLBACK: ver o fim do arquivo.
-- =========================================================================

-- ── 1. A posição financeira do patrimônio ────────────────────────────
ALTER TABLE public."JUR_PATRIMONIOS"
  ADD COLUMN IF NOT EXISTS classificacao       TEXT,      -- CASA, PRÉDIO, TERRENO, SALA…
  ADD COLUMN IF NOT EXISTS situacao_pagamento  TEXT,      -- PAGO, PAGANDO, VENCIDO, AGUARDANDO
  ADD COLUMN IF NOT EXISTS matricula           TEXT,
  ADD COLUMN IF NOT EXISTS possui_escritura    BOOLEAN,
  ADD COLUMN IF NOT EXISTS especie_escritura   TEXT,      -- ESCRITURA, INSTRUMENTO PART.…
  ADD COLUMN IF NOT EXISTS valor_contrato      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_entrada       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_falta         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_total         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_estimado      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS comissao            NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reforcos_pagos      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reforcos_a_pagar    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_parcela       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS qtd_parcelas        INTEGER,
  ADD COLUMN IF NOT EXISTS parcelas_pagas      INTEGER,
  ADD COLUMN IF NOT EXISTS parcelas_falta      INTEGER,
  ADD COLUMN IF NOT EXISTS proxima_parcela     DATE,
  ADD COLUMN IF NOT EXISTS anotacoes           TEXT,
  ADD COLUMN IF NOT EXISTS aba_origem          TEXT;      -- de qual aba da planilha veio

COMMENT ON COLUMN public."JUR_PATRIMONIOS".localizacao IS
  'Endereço do patrimônio. É o campo "Endereço" da tela — o nome antigo ficou.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".situacao_pagamento IS
  'Posição financeira (PAGO/PAGANDO/VENCIDO/AGUARDANDO). Não confundir com status, que é o cadastro.';

CREATE INDEX IF NOT EXISTS jur_pat_situacao_idx  ON public."JUR_PATRIMONIOS"(situacao_pagamento);
CREATE INDEX IF NOT EXISTS jur_pat_classif_idx   ON public."JUR_PATRIMONIOS"(classificacao);
CREATE INDEX IF NOT EXISTS jur_pat_cidade_idx    ON public."JUR_PATRIMONIOS"(cidade);

-- ── 2. Entrada na obrigação ──────────────────────────────────────────
-- Só faz sentido em Financiamento e Consórcio; a tela libera o campo apenas
-- nessas duas categorias, e nas outras ele nem aparece.
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS valor_entrada NUMERIC(14,2);

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".valor_entrada IS
  'Entrada do financiamento/consórcio. Nulo nas demais categorias.';

-- ── 3. As parcelas do financiamento ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_PARCELAS" (
  id             BIGSERIAL PRIMARY KEY,
  patrimonio_id  BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  ordem          INTEGER,                 -- posição na planilha, para manter a leitura
  numero         INTEGER,                 -- nº da parcela, quando é numerada
  rotulo         TEXT,                    -- "A) REFORÇO", "Ato", "Parcela Avulsa"…
  vencimento     DATE,
  valor          NUMERIC(14,2),           -- prestação / valor a ser pago
  valor_pago     NUMERIC(14,2),
  situacao       TEXT,                    -- PAGA, EM ABERTO…
  detalhes       JSONB DEFAULT '{}'::jsonb,  -- seguro, tx adm, encargo, juro, INCC, saldo devedor…
  origem         TEXT,                    -- aba da planilha
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jur_pat_parc_pat_idx  ON public."JUR_PATRIMONIO_PARCELAS"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_pat_parc_venc_idx ON public."JUR_PATRIMONIO_PARCELAS"(vencimento);

ALTER TABLE public."JUR_PATRIMONIO_PARCELAS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_PATRIMONIO_PARCELAS" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."JUR_PATRIMONIO_PARCELAS_id_seq" TO authenticated;

-- Mesma régua das irmãs (JUR_PATRIMONIO_OBRIGACOES/ITENS): quem tem a tela, tem
-- a parcela. Os DOIS códigos de menu apontam para /app/juridico/patrimonios e
-- ambos estão em uso, então a policy aceita os dois — cobrar só um deixaria de
-- fora quem recebeu o acesso pelo outro.
DROP POLICY IF EXISTS jur_pat_parcelas_gate ON public."JUR_PATRIMONIO_PARCELAS";
CREATE POLICY jur_pat_parcelas_gate ON public."JUR_PATRIMONIO_PARCELAS"
  FOR ALL TO authenticated
  USING (
    public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'visualizar'::app_acao)
  )
  WITH CHECK (
    public.has_screen_access(auth.uid(), 'patrimonios', 'incluir'::app_acao)
    OR public.has_screen_access(auth.uid(), 'patrimonios', 'alterar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'incluir'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'alterar'::app_acao)
  );

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS colunas_novas
  FROM information_schema.columns
 WHERE table_name = 'JUR_PATRIMONIOS'
   AND column_name IN ('classificacao','situacao_pagamento','matricula','possui_escritura',
                       'especie_escritura','valor_contrato','valor_entrada','valor_falta',
                       'valor_total','valor_estimado','comissao','reforcos_pagos',
                       'reforcos_a_pagar','valor_parcela','qtd_parcelas','parcelas_pagas',
                       'parcelas_falta','proxima_parcela','anotacoes','aba_origem');

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TABLE public."JUR_PATRIMONIO_PARCELAS";
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" DROP COLUMN valor_entrada;
--   ALTER TABLE public."JUR_PATRIMONIOS"
--     DROP COLUMN classificacao, DROP COLUMN situacao_pagamento, DROP COLUMN matricula,
--     DROP COLUMN possui_escritura, DROP COLUMN especie_escritura, DROP COLUMN valor_contrato,
--     DROP COLUMN valor_entrada, DROP COLUMN valor_falta, DROP COLUMN valor_total,
--     DROP COLUMN valor_estimado, DROP COLUMN comissao, DROP COLUMN reforcos_pagos,
--     DROP COLUMN reforcos_a_pagar, DROP COLUMN valor_parcela, DROP COLUMN qtd_parcelas,
--     DROP COLUMN parcelas_pagas, DROP COLUMN parcelas_falta, DROP COLUMN proxima_parcela,
--     DROP COLUMN anotacoes, DROP COLUMN aba_origem;
-- =========================================================================


-- =========================================================================
-- Recrutamento: um colaborador só pode ter UMA vaga de substituição por vez
--
-- Pedido do Pablo (20/08/2026): "o colaborador selecionado pra SUBSTITUIÇÃO
-- não pode ser selecionado mais de uma vez se ele já estiver sido selecionado
-- em alguma solicitação".
--
-- O `nome_substituido` é texto e não serve de chave (homônimo abre duas vagas
-- para pessoas diferentes, e um acento a mais deixa a mesma pessoa passar
-- duas vezes). Por isso entra `substituido_id` — o ID da EMPREGADOS, que a
-- tela já tem em mãos porque a pessoa é ESCOLHIDA na lista, não digitada.
--
-- Vaga Reprovada ou Cancelada não segura ninguém: ela não repõe o posto, e
-- travar o colaborador para sempre por causa de uma vaga recusada só obrigaria
-- o RH a mexer no banco. Nesses dois status a pessoa volta a ficar livre.
-- =========================================================================

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS substituido_id bigint;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".substituido_id IS
  'ID em EMPREGADOS de quem a vaga repõe. Preenchido SÓ em Substituição: nos outros motivos o colaborador escolhido é apenas o molde de onde vieram cargo/contrato/escala/salário, e gravar o id dele aqui prenderia a pessoa no índice único sem motivo.';

-- Piso de verdade: o banco recusa a segunda vaga viva do mesmo substituído,
-- venha ela de onde vier. NULL não entra em índice único, então as vagas dos
-- outros motivos (e as antigas) não são afetadas.
CREATE UNIQUE INDEX IF NOT EXISTS sistema_recrutamento_substituido_vivo_idx
  ON public."SISTEMA_RECRUTAMENTO" (substituido_id)
  WHERE substituido_id IS NOT NULL
    AND status NOT IN ('Reprovada', 'Cancelada');

-- O índice sozinho estoura um 23505 ilegível na tela. O trigger chega antes e
-- diz QUAL vaga já existe, que é o que a pessoa precisa saber para resolver.
CREATE OR REPLACE FUNCTION public.rec_substituido_unico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_outra bigint;
BEGIN
  IF NEW.substituido_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status, '') IN ('Reprovada', 'Cancelada') THEN RETURN NEW; END IF;

  SELECT id INTO v_outra
    FROM public."SISTEMA_RECRUTAMENTO"
   WHERE substituido_id = NEW.substituido_id
     AND id IS DISTINCT FROM NEW.id
     AND COALESCE(status, '') NOT IN ('Reprovada', 'Cancelada')
   ORDER BY id
   LIMIT 1;

  IF v_outra IS NOT NULL THEN
    RAISE EXCEPTION
      'Esse colaborador já está na vaga de substituição #%. Só dá para abrir outra depois que aquela for concluída, cancelada ou reprovada.', v_outra;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rec_substituido_unico ON public."SISTEMA_RECRUTAMENTO";
CREATE TRIGGER trg_rec_substituido_unico
  BEFORE INSERT OR UPDATE ON public."SISTEMA_RECRUTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.rec_substituido_unico();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER trg_rec_substituido_unico ON public."SISTEMA_RECRUTAMENTO";
--   DROP FUNCTION public.rec_substituido_unico();
--   DROP INDEX public.sistema_recrutamento_substituido_vivo_idx;
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO" DROP COLUMN substituido_id;
-- =========================================================================


-- =========================================================================
-- EMPREGADOS: remover cadastros duplicados (pedido do Pablo, 20/08/2026)
--
-- CHAVE DA DUPLICIDADE: Nome + CPF + Admissão + **Empresa**.
--
-- O pedido dizia "Nome, CPF e data de admissão", mas o próprio exemplo (TALIS
-- CASTRO DE SOUZA) mostra que Empresa entra na chave: das 6 linhas dele, as
-- duas que devem SOBRAR — 11343 e 12920 — têm Nome, CPF e Admissão iguais e
-- só se diferenciam pela Empresa (2 e 5), porque são dois vínculos de
-- verdade, em duas empresas do grupo. Sem Empresa na chave, um dos dois
-- vínculos seria apagado. São 10 pessoas nessa situação (a diferença entre
-- 276 e 266 linhas removidas).
--
-- QUEM FICA: quem está 'Trabalhando'; havendo empate, o ID maior. Ficar só
-- com o ID maior apagaria 15 pessoas ATIVAS cujo registro ativo não é o mais
-- recente — elas sumiriam de todas as telas, que filtram por 'Trabalhando'.
--
-- O QUE É PRESERVADO: as colunas do lado ERP (login, permissões, perfil,
-- setor) NÃO seguem o registro que fica — no TALIS, por exemplo, o e-mail e o
-- auth_user_id estavam na linha 12775, que sai. São 22 pessoas que perderiam
-- o vínculo do login. Por isso as duplicatas são consolidadas no sobrevivente
-- ANTES de sumirem, e só onde o sobrevivente está vazio (não sobrescreve
-- Perfil/Setor já definidos).
--
-- REVERSÍVEL: as linhas removidas vão inteiras para EMPREGADOS_DUPLICADOS_BKP,
-- com o ID de quem ficou no lugar. A tabela guarda CPF, PIS, Senha e
-- chave_secreta — por isso nasce com RLS ligada e SEM policy: nem anon nem
-- authenticated leem, só service_role/SQL direto.
--
-- MEI: nenhuma das 12 linhas com TIPO DE CONTRATO = 'MEI' cai em grupo
-- duplicado, então elas não são tocadas de qualquer forma.
-- =========================================================================

-- ── 1. Quem sai e para quem cada um aponta ───────────────────────────────
CREATE TEMP TABLE _dup AS
WITH g AS (
  SELECT "ID",
         first_value("ID") OVER w AS fica,
         row_number()      OVER w AS rn
  FROM public."EMPREGADOS"
  WINDOW w AS (PARTITION BY "Nome", "CPF", "Admissão", "Empresa"
               ORDER BY ("Situação" = 'Trabalhando') DESC, "ID" DESC)
)
SELECT "ID" AS removido, fica FROM g WHERE rn > 1;

-- ── 2. Backup completo, antes de qualquer escrita ────────────────────────
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_DUPLICADOS_BKP"
  (LIKE public."EMPREGADOS");
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP"
  ADD COLUMN IF NOT EXISTS ficou_com_id bigint,
  ADD COLUMN IF NOT EXISTS removido_em  timestamptz DEFAULT now();

ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_DUPLICADOS_BKP" FROM PUBLIC, anon, authenticated;

INSERT INTO public."EMPREGADOS_DUPLICADOS_BKP"
SELECT e.*, d.fica, now()
  FROM public."EMPREGADOS" e
  JOIN _dup d ON d.removido = e."ID";

-- ── 3. Referências de outras tabelas passam para quem ficou ──────────────
-- A varredura das colunas *_id que apontam para EMPREGADOS achou só esta com
-- linhas presas a um ID que sai (5 linhas). Sem unique em empregado_id, o
-- repontamento não colide.
UPDATE public."CS_FORM_VINCULOS" v
   SET empregado_id = d.fica
  FROM _dup d
 WHERE v.empregado_id = d.removido;

-- ── 4. Apagar as duplicatas ──────────────────────────────────────────────
-- Antes da consolidação: auth_user_id tem índice único, e copiar o valor com
-- a linha de origem ainda viva seria recusado.
DELETE FROM public."EMPREGADOS" e USING _dup d WHERE e."ID" = d.removido;

-- ── 5. Consolidar o lado ERP no sobrevivente (só onde ele está vazio) ────
CREATE TEMP TABLE _consolidar AS
SELECT b.ficou_com_id AS fica,
       (array_agg(b.auth_user_id               ORDER BY b."ID" DESC) FILTER (WHERE b.auth_user_id IS NOT NULL))[1]                             AS auth_user_id,
       (array_agg(b.email                      ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.email,'')) <> ''))[1]                      AS email,
       (array_agg(b."Senha"                    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Senha",'')) <> ''))[1]                    AS senha,
       (array_agg(b.chave_secreta              ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.chave_secreta,'')) <> ''))[1]              AS chave_secreta,
       (array_agg(b."Perfil_ERP"               ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Perfil_ERP",'')) <> ''))[1]               AS perfil_erp,
       (array_agg(b."Setor_ERP"                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Setor_ERP",'')) <> ''))[1]                AS setor_erp,
       (array_agg(b."Ativo_ERP"                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Ativo_ERP",'')) <> ''))[1]                AS ativo_erp,
       (array_agg(b."LIDER"                    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."LIDER",'')) <> ''))[1]                    AS lider,
       (array_agg(b.permissoes_compras         ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.permissoes_compras,'')) <> ''))[1]         AS permissoes_compras,
       (array_agg(b.permissoes_malote          ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.permissoes_malote,'')) <> ''))[1]          AS permissoes_malote,
       (array_agg(b.classificacoes_responsavel ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.classificacoes_responsavel,'')) <> ''))[1] AS classificacoes_responsavel,
       (array_agg(b.aprovar_cotacao_classif    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.aprovar_cotacao_classif,'')) <> ''))[1]    AS aprovar_cotacao_classif,
       (array_agg(b.tipo_acesso                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.tipo_acesso,'')) <> ''))[1]                AS tipo_acesso,
       (array_agg(b.contrato_responsavel_id    ORDER BY b."ID" DESC) FILTER (WHERE b.contrato_responsavel_id IS NOT NULL))[1]                  AS contrato_responsavel_id,
       (array_agg(b.contrato_responsavel       ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.contrato_responsavel,'')) <> ''))[1]       AS contrato_responsavel
  FROM public."EMPREGADOS_DUPLICADOS_BKP" b
 WHERE b.ficou_com_id IN (SELECT fica FROM _dup)
 GROUP BY b.ficou_com_id;

UPDATE public."EMPREGADOS" e SET
  auth_user_id               = coalesce(e.auth_user_id, c.auth_user_id),
  email                      = coalesce(nullif(btrim(e.email), ''), c.email),
  "Senha"                    = coalesce(nullif(btrim(e."Senha"), ''), c.senha),
  chave_secreta              = coalesce(nullif(btrim(e.chave_secreta), ''), c.chave_secreta),
  "Perfil_ERP"               = coalesce(nullif(btrim(e."Perfil_ERP"), ''), c.perfil_erp),
  "Setor_ERP"                = coalesce(nullif(btrim(e."Setor_ERP"), ''), c.setor_erp),
  "Ativo_ERP"                = coalesce(nullif(btrim(e."Ativo_ERP"), ''), c.ativo_erp),
  "LIDER"                    = coalesce(nullif(btrim(e."LIDER"), ''), c.lider),
  permissoes_compras         = coalesce(nullif(btrim(e.permissoes_compras), ''), c.permissoes_compras),
  permissoes_malote          = coalesce(nullif(btrim(e.permissoes_malote), ''), c.permissoes_malote),
  classificacoes_responsavel = coalesce(nullif(btrim(e.classificacoes_responsavel), ''), c.classificacoes_responsavel),
  aprovar_cotacao_classif    = coalesce(nullif(btrim(e.aprovar_cotacao_classif), ''), c.aprovar_cotacao_classif),
  tipo_acesso                = coalesce(nullif(btrim(e.tipo_acesso), ''), c.tipo_acesso),
  contrato_responsavel_id    = coalesce(e.contrato_responsavel_id, c.contrato_responsavel_id),
  contrato_responsavel       = coalesce(nullif(btrim(e.contrato_responsavel), ''), c.contrato_responsavel)
FROM _consolidar c
WHERE e."ID" = c.fica;

-- ── 6. Login órfão não vale mais que login de verdade ────────────────────
-- CARLOS JOSE FERGUTZ NETO e ISADORA VELHO RAMOS têm DOIS auth_user_id: o da
-- linha que fica aponta para um usuário que não existe em profiles, e o login
-- que funciona (adm5@ / licitacao5@) está na linha que sai. Como auth_user_id
-- é único, só um cabe — então o critério não é "o do sobrevivente", é "o que
-- existe em profiles".
UPDATE public."EMPREGADOS" e
   SET auth_user_id = v.auth_user_id,
       email        = coalesce(nullif(btrim(e.email), ''), v.email)
  FROM (
    SELECT DISTINCT ON (b.ficou_com_id)
           b.ficou_com_id AS fica, b.auth_user_id, b.email
      FROM public."EMPREGADOS_DUPLICADOS_BKP" b
      JOIN public.profiles p ON p.id = b.auth_user_id
     ORDER BY b.ficou_com_id, b."ID" DESC
  ) v
 WHERE e."ID" = v.fica
   AND e.auth_user_id IS DISTINCT FROM v.auth_user_id
   AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.id = e.auth_user_id);

DROP TABLE _consolidar;
DROP TABLE _dup;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK — devolve as linhas removidas (a consolidação feita no
-- sobrevivente NÃO se desfaz sozinha; confira antes de dropar o backup):
--   INSERT INTO public."EMPREGADOS"
--     SELECT b.* FROM public."EMPREGADOS_DUPLICADOS_BKP" b;   -- tirar as 2 colunas extras
--   -- e, quando o histórico não for mais preciso:
--   DROP TABLE public."EMPREGADOS_DUPLICADOS_BKP";
-- =========================================================================


-- =========================================================================
-- Novidades do Sistema — changelog interno do ERP (pedido do Pablo, 20/08/2026)
--
-- Todo mundo LÊ; só quem tem o flag "Pode criar novidades do sistema" em
-- Administração › Acesso por Usuário PUBLICA.
--
-- O flag NÃO é um mecanismo novo: é um menu de capacidade em `app_menu` com
-- `rota = NULL`, exatamente como `recrutamento_etapa_juridico`,
-- `chamados_sistemas_aprovar` e `whatsapp_todas` já fazem. Ele aparece
-- sozinho na aba "Acesso por Usuário" (ela lista app_menu), e o toggle de lá
-- grava visualizar/incluir/alterar/aprovar/exportar em
-- screen_permission_user — por isso a RLS aqui cobra `incluir`, que é o que o
-- toggle concede. Nada de tabela nova de permissão.
--
-- A rota /app/novidades fica FORA de app_menu de propósito: rota sem entrada
-- lá é sempre aberta (ver RouteGuard/Sidebar), e a leitura é para todos.
-- =========================================================================

-- ── Menu de capacidade: "Pode criar novidades do sistema" ────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'novidades_publicar', 'Pode criar novidades do sistema', NULL, 80, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sistemas'
   AND NOT EXISTS (
     SELECT 1 FROM public.app_menu x
      WHERE x.modulo_id = m.id AND x.codigo = 'novidades_publicar');

-- ── A novidade ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOVIDADES" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo          text        NOT NULL,
  descricao       text        NOT NULL,
  -- Os quatro selos que a tela mostra. Texto com CHECK em vez de enum: o
  -- Pablo pode querer um selo novo, e ALTER TYPE em enum usado por RLS é
  -- bem mais chato de reverter do que trocar um CHECK.
  tipo            text        NOT NULL DEFAULT 'NOVO'
                  CHECK (tipo IN ('NOVO', 'MELHORIA', 'AJUSTE', 'AVISO')),
  -- Destino do "Saiba mais →". Rota interna do ERP (/app/...) ou NULL.
  rota            text,
  publicado       boolean     NOT NULL DEFAULT true,
  publicado_em    timestamptz NOT NULL DEFAULT now(),
  criado_por      uuid        DEFAULT auth.uid(),
  criado_por_nome text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."SISTEMA_NOVIDADES" IS
  'Changelog interno mostrado no Início e no sino de novidades. Escrita restrita ao menu de capacidade novidades_publicar (Acesso por Usuário).';

-- A lista é sempre "as mais recentes primeiro, só as publicadas".
CREATE INDEX IF NOT EXISTS sistema_novidades_publicadas_idx
  ON public."SISTEMA_NOVIDADES" (publicado_em DESC) WHERE publicado;

-- ── Quem já leu o quê (a bolinha do topo) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_NOVIDADES_LIDAS" (
  novidade_id bigint      NOT NULL REFERENCES public."SISTEMA_NOVIDADES"(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL DEFAULT auth.uid(),
  lido_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (novidade_id, user_id)
);
CREATE INDEX IF NOT EXISTS sistema_novidades_lidas_user_idx
  ON public."SISTEMA_NOVIDADES_LIDAS" (user_id);

-- ── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sistema_novidades_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sistema_novidades_touch ON public."SISTEMA_NOVIDADES";
CREATE TRIGGER trg_sistema_novidades_touch
  BEFORE UPDATE ON public."SISTEMA_NOVIDADES"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_novidades_touch();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOVIDADES"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SISTEMA_NOVIDADES_LIDAS" ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer pessoa logada vê o que está publicado. Quem publica vê
-- também os rascunhos (publicado = false), senão não teria como voltar neles.
DROP POLICY IF EXISTS sistema_novidades_ler ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_ler ON public."SISTEMA_NOVIDADES"
  FOR SELECT TO authenticated
  USING (publicado OR public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

-- Escrever: só o flag. `incluir` é a ação que o toggle de "Acesso por
-- Usuário" concede — cobrar `excluir` deixaria o admin marcar o flag e o
-- botão de apagar não funcionar.
DROP POLICY IF EXISTS sistema_novidades_criar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_criar ON public."SISTEMA_NOVIDADES"
  FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_novidades_editar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_editar ON public."SISTEMA_NOVIDADES"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

DROP POLICY IF EXISTS sistema_novidades_apagar ON public."SISTEMA_NOVIDADES";
CREATE POLICY sistema_novidades_apagar ON public."SISTEMA_NOVIDADES"
  FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'novidades_publicar', 'incluir'));

-- Lidas: cada um cuida só das próprias marcas.
DROP POLICY IF EXISTS sistema_novidades_lidas_minhas ON public."SISTEMA_NOVIDADES_LIDAS";
CREATE POLICY sistema_novidades_lidas_minhas ON public."SISTEMA_NOVIDADES_LIDAS"
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public."SISTEMA_NOVIDADES", public."SISTEMA_NOVIDADES_LIDAS" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_NOVIDADES"       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_NOVIDADES_LIDAS" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TABLE public."SISTEMA_NOVIDADES_LIDAS";
--   DROP TABLE public."SISTEMA_NOVIDADES";
--   DROP FUNCTION public.sistema_novidades_touch();
--   DELETE FROM public.app_menu WHERE codigo = 'novidades_publicar';
-- =========================================================================


-- =========================================================================
-- Patrimônio: parcelas de contrato nas Contas / Obrigações
--
-- Financiamento e Consórcio não são conta de mês: são um contrato com N
-- parcelas. Cada parcela continua sendo UMA linha em
-- JUR_PATRIMONIO_OBRIGACOES — é assim que ela aparece na lista de contas,
-- vai para o Malote e recebe comprovante. O que faltava era saber que um
-- punhado dessas linhas é o MESMO contrato.
--
-- Não usa a JUR_PATRIMONIO_PARCELAS: aquela tabela guarda o histórico
-- importado do sistema antigo (1.219 linhas, presas ao patrimônio e sem
-- ligação com obrigação), e não tem status/comprovante/Malote.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS contrato_uid   uuid,
  ADD COLUMN IF NOT EXISTS parcela_numero integer,
  ADD COLUMN IF NOT EXISTS parcela_total  integer;

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".contrato_uid IS
  'Amarra as parcelas de um mesmo contrato (Financiamento/Consórcio). NULL nas contas avulsas.';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".parcela_numero IS
  'Posição da parcela dentro do contrato (1..parcela_total).';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".parcela_total IS
  'Quantas parcelas o contrato tem, para a tela mostrar "3/60".';

CREATE INDEX IF NOT EXISTS jur_patr_obr_contrato_idx
  ON public."JUR_PATRIMONIO_OBRIGACOES" (patrimonio_id, contrato_uid)
  WHERE contrato_uid IS NOT NULL;

-- "Valor que falta" do patrimônio passa a ser a soma das parcelas NÃO PAGAS
-- de Financiamento/Consórcio, calculada na hora. A coluna
-- JUR_PATRIMONIOS.valor_falta continua existindo (é o número que veio da
-- importação), mas deixa de ser o que a tela mostra: ninguém a atualizava
-- quando uma parcela era paga.
COMMENT ON COLUMN public."JUR_PATRIMONIOS".valor_falta IS
  'LEGADO da importação. A tela calcula o que falta somando as parcelas em aberto de Financiamento/Consórcio nas obrigações.';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP INDEX public.jur_patr_obr_contrato_idx;
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
--     DROP COLUMN contrato_uid, DROP COLUMN parcela_numero, DROP COLUMN parcela_total;
-- =========================================================================


-- =========================================================================
-- Patrimônio: coordenada por imóvel (o mapa deixa de ser um pino por cidade)
--
-- Hoje o mapa põe UM pino por cidade, de uma tabela de coordenadas fixa: dez
-- imóveis em Triunfo viram um pino só no centro de Triunfo. O Jurídico quer
-- ver cada endereço no lugar dele.
--
-- A coordenada fica GRAVADA aqui, não resolvida a cada abertura de tela:
-- geocodificar é chamada a serviço externo, e repetir isso a cada F5 seria
-- lento, frágil e abusivo com o Nominatim. Grava uma vez, usa sempre.
--
-- `geo_endereco` guarda o texto que gerou a coordenada. É ele que diz se
-- precisa refazer: mudou o endereço no cadastro, a coordenada está velha.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIOS"
  ADD COLUMN IF NOT EXISTS latitude      double precision,
  ADD COLUMN IF NOT EXISTS longitude     double precision,
  ADD COLUMN IF NOT EXISTS geo_endereco  text,
  ADD COLUMN IF NOT EXISTS geo_status    text,
  ADD COLUMN IF NOT EXISTS geo_em        timestamptz;

COMMENT ON COLUMN public."JUR_PATRIMONIOS".latitude IS
  'Latitude do imóvel. Preenchida pelo botão "Localizar endereços" (Nominatim/OpenStreetMap) ou digitada à mão no cadastro.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".longitude IS
  'Longitude do imóvel. Ver latitude.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_endereco IS
  'Endereço exatamente como estava quando a coordenada foi obtida. Se o cadastro mudar, a tela sabe que precisa localizar de novo.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_status IS
  'ok = achou pelo endereço; manual = coordenada digitada por alguém; nao_encontrado = o serviço não achou (fica no pino da cidade e não é tentado de novo sozinho).';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".geo_em IS
  'Quando a coordenada foi definida.';

-- Só quem tem coordenada entra no índice: a maioria das consultas do mapa
-- filtra exatamente por isso.
CREATE INDEX IF NOT EXISTS jur_patrimonios_geo_idx
  ON public."JUR_PATRIMONIOS" (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP INDEX public.jur_patrimonios_geo_idx;
--   ALTER TABLE public."JUR_PATRIMONIOS"
--     DROP COLUMN latitude, DROP COLUMN longitude,
--     DROP COLUMN geo_endereco, DROP COLUMN geo_status, DROP COLUMN geo_em;
-- =========================================================================


-- =========================================================================
-- Patrimônio × Malote: a conta sabe que virou despesa, e sabe quando foi paga
--
-- Hoje "Pagar" só navega para o Malote com os campos preenchidos: a conta
-- fica em "Pendente" para sempre, mesmo depois de a despesa ser criada e
-- paga lá. Quem olha o patrimônio não tem como saber em que pé está.
--
-- `malote_despesa_id` é o vínculo. Com ele:
--   • assim que a despesa é criada no Malote, a conta vira "Enviado ao Malote";
--   • o "Pago" NÃO é digitado aqui — é lido do lado do Malote
--     (malote_despesa.status = 'despesa_paga'), que é quem sabe se o dinheiro
--     saiu. Duplicar esse estado nas duas tabelas é garantir divergência.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS malote_despesa_id  uuid,
  ADD COLUMN IF NOT EXISTS enviado_malote_em  timestamptz;

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".malote_despesa_id IS
  'Despesa criada no Malote a partir desta conta. Enquanto existir e não estiver paga, a conta aparece como "Enviado ao Malote"; quando a despesa vira despesa_paga, a conta aparece como "Pago".';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".enviado_malote_em IS
  'Quando a despesa foi criada no Malote a partir desta conta.';

CREATE INDEX IF NOT EXISTS jur_patr_obr_malote_idx
  ON public."JUR_PATRIMONIO_OBRIGACOES" (malote_despesa_id)
  WHERE malote_despesa_id IS NOT NULL;

-- A tela do Patrimônio precisa LER o status da despesa vinculada. A RLS do
-- malote_despesa é do módulo Malote e não vai ser afrouxada por causa disto:
-- esta função devolve só id/status/pago_em das despesas pedidas, que é o
-- mínimo para desenhar o selo, e nada mais da despesa.
CREATE OR REPLACE FUNCTION public.jur_patrimonio_status_malote(_ids uuid[])
RETURNS TABLE (despesa_id uuid, status text, pago_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.status, d.pago_em
    FROM public.malote_despesa d
   WHERE d.id = ANY(_ids)
$$;

REVOKE ALL ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION public.jur_patrimonio_status_malote(uuid[]);
--   DROP INDEX public.jur_patr_obr_malote_idx;
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
--     DROP COLUMN malote_despesa_id, DROP COLUMN enviado_malote_em;
-- =========================================================================
