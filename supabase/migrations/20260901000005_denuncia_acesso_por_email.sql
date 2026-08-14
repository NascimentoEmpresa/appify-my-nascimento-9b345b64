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
