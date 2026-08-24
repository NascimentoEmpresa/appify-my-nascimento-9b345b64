-- =====================================================================
-- CANAL DE ÉTICA — as portas públicas, atualizadas
--
-- Continuação da 20260914000002 (estrutura). Aqui ficam só as funções que
-- o site em domínio à parte usa, todas SECURITY DEFINER e todas conferindo
-- credencial a cada chamada — não há sessão do lado de quem denuncia.
--
-- O QUE MUDA
--   · denuncia_registrar   — recebe empresa, contrato, data/hora do fato,
--                            risco, retaliação, denunciado, e aceita relato
--                            ANÔNIMO (sem e-mail).
--   · denuncia_consultar   — a credencial passa a ser e-mail OU protocolo.
--   · denuncia_mensagens   — idem.
--   · denuncia_responder   — idem.
--   · denuncia_empresas    — lista do select do site.
--   · denuncia_contratos   — contratos da empresa escolhida.
--
-- Idempotente.
-- =====================================================================

-- ── 1. As listas do formulário ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_empresas()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'rotulo', e.rotulo)
                            ORDER BY e.ordem, e.rotulo), '[]'::jsonb)
    FROM public."CANAL_DENUNCIA_EMPRESA" e
   WHERE e.ativo;
$$;
REVOKE ALL ON FUNCTION public.denuncia_empresas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_empresas() TO anon, authenticated;

/**
 * Contratos da empresa escolhida.
 *
 * A fonte é EMPREGADOS."Descrição do Local" — o contrato OPERACIONAL, o posto
 * onde a pessoa trabalha. É diferente de `public.contratos`, que é o contrato
 * comercial do módulo de Licitações; quem denuncia sabe dizer "Hospital X",
 * não o número do edital.
 *
 * Só devolve nome de local. Não expõe empregado, cadastro nem situação —
 * é chamada sem login.
 */
CREATE OR REPLACE FUNCTION public.denuncia_contratos(p_empresa_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_padrao text; v_itens jsonb;
BEGIN
  SELECT e.padrao_empregados INTO v_padrao
    FROM public."CANAL_DENUNCIA_EMPRESA" e WHERE e.id = p_empresa_id AND e.ativo;

  SELECT COALESCE(jsonb_agg(x.local ORDER BY x.local), '[]'::jsonb) INTO v_itens
    FROM (
      SELECT DISTINCT btrim(e."Descrição do Local") AS local
        FROM public."EMPREGADOS" e
       WHERE COALESCE(btrim(e."Descrição do Local"), '') <> ''
         -- Empresa sem padrão configurado oferece todos os contratos: melhor
         -- uma lista larga do que uma lista vazia que empurra todo mundo para
         -- o "não localizado".
         AND (v_padrao IS NULL OR e."Nome da Empresa" ILIKE v_padrao)
    ) x;

  RETURN jsonb_build_object('contratos', v_itens);
END $$;
REVOKE ALL ON FUNCTION public.denuncia_contratos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_contratos(uuid) TO anon, authenticated;

-- ── 1.1 As assinaturas antigas saem primeiro ─────────────────────────
-- As três funções do denunciante trocam o nome do primeiro parâmetro
-- (`p_email` → `p_identificador`, porque agora aceita e-mail OU protocolo).
-- CREATE OR REPLACE não renomeia parâmetro — o Postgres recusa com
-- "cannot change name of input parameter". Então elas caem antes de nascer
-- de novo. Como tudo aqui roda numa transação só, não existe instante em
-- que o site fique sem a função.
DROP FUNCTION IF EXISTS public.denuncia_consultar(text, text);
DROP FUNCTION IF EXISTS public.denuncia_mensagens(text, text, text);
DROP FUNCTION IF EXISTS public.denuncia_responder(text, text, text, text);

-- ── 2. Registro ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_registrar(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_protocolo text;
  v_id        uuid;
  v_descricao text    := btrim(COALESCE(payload->>'descricao', ''));
  v_anonimo   boolean := COALESCE((payload->>'anonimo')::boolean, false);
  v_email     text    := lower(btrim(COALESCE(payload->>'email_acesso', payload->>'email', '')));
  v_senha     text    := COALESCE(payload->>'senha', '');
  v_identif   boolean := COALESCE((payload->>'identificado')::boolean, false);
  v_empresa   uuid;
  v_emp_nome  text;
  v_nasc      date;
  v_ocorr     date;
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

  -- Empresa é obrigatória (pedido do Comitê). Precisa existir na lista: um
  -- texto solto aqui devolveria o problema que o campo veio resolver.
  v_empresa := NULLIF(btrim(payload->>'empresa_id'), '')::uuid;
  SELECT e.rotulo INTO v_emp_nome
    FROM public."CANAL_DENUNCIA_EMPRESA" e WHERE e.id = v_empresa AND e.ativo;
  IF v_emp_nome IS NULL THEN
    RAISE EXCEPTION 'Selecione a empresa.' USING ERRCODE = '22023';
  END IF;

  -- A senha é sempre exigida: é ela que dá acompanhamento, com ou sem e-mail.
  IF length(v_senha) < 8 THEN
    RAISE EXCEPTION 'Escolha uma senha de acompanhamento com pelo menos 8 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- As duas portas de acesso. Anônimo entra por protocolo; identificado por
  -- e-mail. Uma denúncia nunca tem as duas — ver canal_denuncia_anonimo_chk.
  IF v_anonimo THEN
    v_email := NULL;
  ELSIF v_email = '' OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Informe um e-mail válido para acompanhar a denúncia, ou marque a opção de denúncia anônima.'
      USING ERRCODE = '22023';
  END IF;

  -- Quem é anônimo não diz o nome: aceitar as duas coisas juntas seria
  -- prometer anonimato e gravar a identidade na linha de baixo.
  IF v_anonimo THEN v_identif := false; END IF;
  IF v_identif AND COALESCE(btrim(payload->>'nome_completo'), '') = '' THEN
    RAISE EXCEPTION 'Quem opta por se identificar precisa informar o nome completo.' USING ERRCODE = '22023';
  END IF;

  v_protocolo := 'DEN-' || to_char(now(), 'YYYY') || '-'
                 || lpad(nextval('public.canal_denuncia_protocolo_seq')::text, 5, '0');

  BEGIN v_nasc := NULLIF(btrim(payload->>'data_nascimento'), '')::date;
  EXCEPTION WHEN others THEN v_nasc := NULL; END;
  BEGIN v_ocorr := NULLIF(btrim(payload->>'ocorrencia_data'), '')::date;
  EXCEPTION WHEN others THEN v_ocorr := NULL; END;

  INSERT INTO public."CANAL_DENUNCIA" (
    protocolo, senha_hash, identificado, anonimo,
    nome_completo, cpf, email, data_nascimento, telefone_fixo, celular,
    empresa_id, empresa_nome, contrato_informado, contrato_situacao,
    relacao, tipo_denuncia, local_ocorrencia, como_soube,
    ocorrencia_data, ocorrencia_hora, ocorrencia_frequencia,
    risco_imediato, risco_imediato_detalhe, retaliacao, retaliacao_detalhe,
    denunciado_informado, denunciado_funcao,
    lideranca_ciente, lideranca_envolvida, lideranca_ocultou,
    lideranca_ciente_quem, lideranca_envolvida_quem, lideranca_ocultou_quem,
    descricao, testemunhas, evidencias, valor_financeiro, sugestao
  ) VALUES (
    v_protocolo, crypt(v_senha, gen_salt('bf')), v_identif, v_anonimo,
    -- Sem identificação, os campos pessoais nem chegam a ser gravados.
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'nome_completo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'cpf'), '') END,
    v_email,
    CASE WHEN v_identif THEN v_nasc END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'telefone_fixo'), '') END,
    CASE WHEN v_identif THEN NULLIF(btrim(payload->>'celular'), '') END,
    v_empresa, v_emp_nome,
    NULLIF(btrim(payload->>'contrato_informado'), ''),
    COALESCE(NULLIF(btrim(payload->>'contrato_situacao'), ''), 'nao_sei'),
    btrim(payload->>'relacao'),
    btrim(payload->>'tipo_denuncia'),
    NULLIF(btrim(payload->>'local_ocorrencia'), ''),
    btrim(payload->>'como_soube'),
    v_ocorr,
    NULLIF(btrim(payload->>'ocorrencia_hora'), ''),
    NULLIF(btrim(payload->>'ocorrencia_frequencia'), ''),
    COALESCE((payload->>'risco_imediato')::boolean, false),
    NULLIF(btrim(payload->>'risco_imediato_detalhe'), ''),
    COALESCE((payload->>'retaliacao')::boolean, false),
    NULLIF(btrim(payload->>'retaliacao_detalhe'), ''),
    NULLIF(btrim(payload->>'denunciado_informado'), ''),
    NULLIF(btrim(payload->>'denunciado_funcao'), ''),
    NULLIF(btrim(payload->>'lideranca_ciente'), ''),
    NULLIF(btrim(payload->>'lideranca_envolvida'), ''),
    NULLIF(btrim(payload->>'lideranca_ocultou'), ''),
    NULLIF(btrim(payload->>'lideranca_ciente_quem'), ''),
    NULLIF(btrim(payload->>'lideranca_envolvida_quem'), ''),
    NULLIF(btrim(payload->>'lideranca_ocultou_quem'), ''),
    v_descricao,
    NULLIF(btrim(payload->>'testemunhas'), ''),
    NULLIF(btrim(payload->>'evidencias'), ''),
    NULLIF(btrim(payload->>'valor_financeiro'), ''),
    NULLIF(btrim(payload->>'sugestao'), '')
  )
  RETURNING id INTO v_id;

  -- `id` volta para a edge function de anexos amarrar os arquivos que a
  -- pessoa já subiu. Ele não é credencial: sem a senha, não abre nada.
  RETURN jsonb_build_object(
    'id', v_id,
    'protocolo', v_protocolo,
    'anonimo', v_anonimo,
    'acesso', CASE WHEN v_anonimo THEN 'protocolo' ELSE 'email' END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_registrar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_registrar(jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.denuncia_registrar(jsonb) IS
  'Registro publico. Aceita relato anonimo (sem e-mail): nesse caso o acompanhamento e por protocolo + senha.';

-- ── 3. Achar a denúncia por e-mail OU protocolo ──────────────────────
-- Uma função só, usada pelas três portas do denunciante. Antes cada uma
-- repetia o mesmo SELECT com crypt; três cópias da regra de credencial é
-- como se acaba com uma delas mais frouxa que as outras.
CREATE OR REPLACE FUNCTION public.denuncia_autenticar(p_identificador text, p_senha text)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
  SELECT d.id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.senha_hash = crypt(COALESCE(p_senha, ''), d.senha_hash)
     AND (
       -- Anônimo: a credencial é o protocolo.
       d.protocolo = btrim(upper(COALESCE(p_identificador, '')))
       -- Identificado: é o e-mail, e ele devolve TODAS as denúncias da pessoa.
       OR (d.email IS NOT NULL
           AND lower(btrim(d.email)) = lower(btrim(COALESCE(p_identificador, ''))))
     );
$$;
REVOKE ALL ON FUNCTION public.denuncia_autenticar(text, text) FROM PUBLIC, anon;
-- Sem GRANT para anon: é auxiliar interna das funções abaixo, que já rodam
-- como definer. Exposta, viraria um oráculo de "esta senha existe?".

-- ── 4. Acompanhamento ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_consultar(p_identificador text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_itens jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'protocolo',     d.protocolo,
           'status',        d.status,
           'resultado',     d.resultado,
           'tipo_denuncia', d.tipo_denuncia,
           'empresa',       d.empresa_nome,
           'registrada_em', d.created_at,
           'atualizada_em', d.updated_at,
           'concluida_em',  d.concluido_em,
           -- A decisão da Presidência é comunicada; a fundamentação interna não.
           'decisao',       d.decisao_final,
           'retorno',       d.retorno_denunciante,
           'anexos',        (SELECT count(*) FROM public."CANAL_DENUNCIA_ANEXO" a
                              WHERE a.denuncia_id = d.id AND a.origem = 'denunciante')
         ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_itens
    FROM public."CANAL_DENUNCIA" d
   WHERE d.id IN (SELECT public.denuncia_autenticar(p_identificador, p_senha));

  -- Mesma resposta para credencial inexistente e senha errada: distinguir os
  -- dois casos entregaria de graça quais protocolos e e-mails existem.
  IF v_itens = '[]'::jsonb THEN
    RAISE EXCEPTION 'Dados de acesso inválidos.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('denuncias', v_itens);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_consultar(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_consultar(text, text) TO anon, authenticated;

-- ── 5. Conversa ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.denuncia_mensagens(
  p_identificador text, p_senha text, p_protocolo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_id uuid; v_itens jsonb; v_anexos jsonb;
BEGIN
  SELECT d.id INTO v_id
    FROM public."CANAL_DENUNCIA" d
   WHERE d.protocolo = btrim(upper(COALESCE(p_protocolo, '')))
     AND d.id IN (SELECT public.denuncia_autenticar(p_identificador, p_senha));

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Dados de acesso inválidos.' USING ERRCODE = '42501';
  END IF;

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

  -- Só os arquivos que a própria pessoa mandou. Documento interno da apuração
  -- não volta para o denunciante.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', a.nome_arquivo, 'enviado_em', a.created_at
         ) ORDER BY a.created_at), '[]'::jsonb)
    INTO v_anexos
    FROM public."CANAL_DENUNCIA_ANEXO" a
   WHERE a.denuncia_id = v_id AND a.origem = 'denunciante';

  RETURN jsonb_build_object('mensagens', v_itens, 'anexos', v_anexos);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_mensagens(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_mensagens(text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.denuncia_responder(
  p_identificador text, p_senha text, p_protocolo text, p_mensagem text)
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
     AND d.id IN (SELECT public.denuncia_autenticar(p_identificador, p_senha));

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Dados de acesso inválidos.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CANAL_DENUNCIA_MENSAGEM"(denuncia_id, autor, mensagem, interna, tipo)
  VALUES (v_id, 'denunciante', v_txt, false, 'mensagem');

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.denuncia_responder(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.denuncia_responder(text, text, text, text) TO anon, authenticated;

-- ── 6. A assinatura antiga sai de circulação ─────────────────────────
-- A 20260901000005 deixou denuncia_consultar(p_protocolo, p_senha) com os
-- mesmos tipos da nova. Como os nomes dos parâmetros mudaram, o PostgREST
-- resolveria as duas — e a antiga não conhece `anonimo` nem `decisao`.
-- Ela é substituída acima (mesma aridade e tipos), então não há o que dropar;
-- este bloco existe para deixar o fato registrado e falhar alto se um dia
-- alguém recriar a versão velha com outro tipo de parâmetro.
DO $$
DECLARE v_qtd integer;
BEGIN
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'denuncia_consultar';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'Existem % versões de denuncia_consultar; deve haver exatamente uma.', v_qtd;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Restaurar denuncia_registrar/denuncia_consultar da 20260901000005 e
--   denuncia_mensagens/denuncia_responder da 20260901000006;
--   DROP FUNCTION IF EXISTS public.denuncia_autenticar(text, text);
--   DROP FUNCTION IF EXISTS public.denuncia_contratos(uuid);
--   DROP FUNCTION IF EXISTS public.denuncia_empresas();
-- =====================================================================
