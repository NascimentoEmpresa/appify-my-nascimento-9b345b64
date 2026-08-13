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
