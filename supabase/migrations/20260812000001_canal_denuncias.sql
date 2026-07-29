-- =====================================================================
-- CANAL DE ÉTICA E DENÚNCIAS — recebimento de denúncias anônimas.
--
-- O site do canal (hospedado em domínio próprio) usa a chave ANON e registra
-- as denúncias por uma RPC SECURITY DEFINER (denuncia_registrar). O anon NÃO
-- lê nem escreve na tabela diretamente — só executa a RPC, que gera protocolo
-- e senha de acompanhamento. O painel interno (futuro) lê a tabela via RLS,
-- liberado pela capacidade de tela 'canal_denuncias'.
--
-- Privacidade: por padrão ninguém enxerga as denúncias pelo client até que a
-- tela 'canal_denuncias' seja liberada a alguém em Acesso por Usuário.
-- Idempotente.
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS public.denuncia_protocolo_seq;

CREATE TABLE IF NOT EXISTS public."DENUNCIA" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo            text NOT NULL UNIQUE,
  senha_acompanhamento text NOT NULL,

  -- Identificação (opcional — denúncia pode ser 100% anônima)
  identificado         boolean NOT NULL DEFAULT false,
  nome_completo        text,
  cpf                  text,
  email                text,
  data_nascimento      date,
  telefone_fixo        text,
  celular              text,

  -- Classificação
  relacao              text,   -- relação com o Grupo Nascimento
  tipo_denuncia        text,   -- tipo/enquadramento do fato
  local_ocorrencia     text,   -- empresa/unidade/setor
  como_soube           text,   -- como tomou conhecimento
  lideranca_ciente     text,   -- sim / nao / nao_sei
  lideranca_envolvida  text,   -- sim / nao / nao_sei
  lideranca_ocultou    text,   -- sim / nao / nao_sei

  -- Relato
  descricao            text NOT NULL,
  testemunhas          text,
  evidencias           text,
  valor_financeiro     text,
  sugestao             text,

  -- Termo e tratativa interna
  concordou_termo      boolean NOT NULL DEFAULT false,
  status               text NOT NULL DEFAULT 'recebida',  -- recebida / em_analise / concluida / arquivada
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_denuncia_created_at ON public."DENUNCIA" (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_denuncia_status     ON public."DENUNCIA" (status);

ALTER TABLE public."DENUNCIA" ENABLE ROW LEVEL SECURITY;

-- Leitura: só quem tem a tela 'canal_denuncias' liberada (painel interno).
-- Enquanto ninguém tiver, ninguém lê — protege o anonimato.
DROP POLICY IF EXISTS denuncia_select ON public."DENUNCIA";
CREATE POLICY denuncia_select ON public."DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'canal_denuncias', 'visualizar'::public.app_acao));

-- Atualizar status: mesma capacidade (para o painel de tratativas).
DROP POLICY IF EXISTS denuncia_update ON public."DENUNCIA";
CREATE POLICY denuncia_update ON public."DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'canal_denuncias', 'visualizar'::public.app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'canal_denuncias', 'visualizar'::public.app_acao));

-- NÃO existe policy de INSERT: o registro só entra pela RPC SECURITY DEFINER.

GRANT SELECT, UPDATE ON public."DENUNCIA" TO authenticated;

-- ---------------------------------------------------------------------
-- RPC pública de registro: recebe um JSON com o formulário, gera protocolo
-- e senha, grava e devolve { protocolo, senha } para o denunciante guardar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.denuncia_registrar(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_protocolo text;
  v_senha     text;
BEGIN
  IF coalesce(btrim(payload->>'descricao'), '') = '' THEN
    RAISE EXCEPTION 'Descreva o que você quer denunciar.';
  END IF;
  IF (payload->>'concordou_termo') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'É necessário aceitar o termo para registrar a denúncia.';
  END IF;

  v_protocolo := 'DEN-' || to_char(now(), 'YYYY') || '-'
                 || lpad(nextval('public.denuncia_protocolo_seq')::text, 5, '0');
  v_senha := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public."DENUNCIA" (
    protocolo, senha_acompanhamento, identificado,
    nome_completo, cpf, email, data_nascimento, telefone_fixo, celular,
    relacao, tipo_denuncia, local_ocorrencia, como_soube,
    lideranca_ciente, lideranca_envolvida, lideranca_ocultou,
    descricao, testemunhas, evidencias, valor_financeiro, sugestao,
    concordou_termo
  ) VALUES (
    v_protocolo, v_senha, coalesce((payload->>'identificado')::boolean, false),
    nullif(btrim(payload->>'nome_completo'), ''), nullif(btrim(payload->>'cpf'), ''),
    nullif(btrim(payload->>'email'), ''), nullif(btrim(payload->>'data_nascimento'), '')::date,
    nullif(btrim(payload->>'telefone_fixo'), ''), nullif(btrim(payload->>'celular'), ''),
    nullif(btrim(payload->>'relacao'), ''), nullif(btrim(payload->>'tipo_denuncia'), ''),
    nullif(btrim(payload->>'local_ocorrencia'), ''), nullif(btrim(payload->>'como_soube'), ''),
    nullif(btrim(payload->>'lideranca_ciente'), ''), nullif(btrim(payload->>'lideranca_envolvida'), ''),
    nullif(btrim(payload->>'lideranca_ocultou'), ''),
    btrim(payload->>'descricao'), nullif(btrim(payload->>'testemunhas'), ''),
    nullif(btrim(payload->>'evidencias'), ''), nullif(btrim(payload->>'valor_financeiro'), ''),
    nullif(btrim(payload->>'sugestao'), ''), true
  );

  RETURN jsonb_build_object('protocolo', v_protocolo, 'senha', v_senha);
END;
$$;

REVOKE ALL ON FUNCTION public.denuncia_registrar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_registrar(jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Acompanhamento anônimo: com protocolo + senha, devolve status e datas
-- (sem reexpor o conteúdo sensível). Usado no futuro "acompanhar denúncia".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_protocolo text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT jsonb_build_object('protocolo', d.protocolo, 'status', d.status, 'aberta_em', d.created_at)
    INTO v
    FROM public."DENUNCIA" d
   WHERE d.protocolo = btrim(p_protocolo)
     AND d.senha_acompanhamento = upper(btrim(p_senha));
  IF v IS NULL THEN
    RAISE EXCEPTION 'Protocolo ou senha inválidos.';
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
