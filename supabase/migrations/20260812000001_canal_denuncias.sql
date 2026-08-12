-- =====================================================================
-- CANAL DE ÉTICA E DENÚNCIAS — recebimento próprio (site em domínio à parte)
--
-- POR QUE
-- Hoje as denúncias moram na Contato Seguro e o ERP só espelha o que ela
-- devolve (CS_DENUNCIAS + sync-denuncias-contato-seguro). Passamos a receber
-- direto: o site publico grava aqui, e a tratativa acontece dentro do ERP.
--
-- COMO A CONFIDENCIALIDADE É GARANTIDA
--   · o site usa a chave `anon`, que NÃO lê nem escreve na tabela. O único
--     caminho de entrada é a RPC denuncia_registrar (SECURITY DEFINER);
--   · quem lê é só quem tem o menu 'central_servicos_canal_denuncias'
--     liberado em Administração › Acesso por Usuário — mesmo modelo do resto
--     do ERP, sem bypass por papel;
--   · o conteúdo do relato é IMUTÁVEL pela API (trigger abaixo): a tratativa
--     escreve status/responsável/parecer, nunca reescreve a denúncia;
--   · NÃO gravamos IP, user-agent nem auth.uid() de quem denuncia. Anonimato
--     que depende de "prometemos não olhar" não é anonimato — aqui o dado
--     simplesmente não existe.
--
-- ACOMPANHAMENTO SEM LOGIN
-- Quem denuncia recebe protocolo + senha. Guardamos só o HASH da senha
-- (bcrypt): nem quem tem acesso ao banco consegue devolver a senha a alguém
-- que se passe pelo denunciante. Sem a senha, ninguém acompanha aquele caso.
--
-- Idempotente.
-- =====================================================================

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
