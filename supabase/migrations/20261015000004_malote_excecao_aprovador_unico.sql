-- SIS-2026-0668 (errata): a exceção é aprovada ÚNICA e EXCLUSIVAMENTE pela diretora responsável pelo financeiro
-- (Fernanda), que é quem sabe se há dinheiro em caixa — e não mais pelo N2 de cada classificação.
--
--   1. malote_config.excecao_aprovador_user_id: quem aprova as exceções (hoje: FERNANDA MALDANER). Fica em Malote ›
--      Configurações, para trocar sem mexer em código (férias, mudança de diretoria);
--   2. malote_excecao_pode_decidir: só o aprovador configurado. Saem o N2 da classificação, o GERENTE FINANCEIRO e o admin
--      (o reforço do gerente financeiro nas DESPESAS de exceção, do N2 em diante, é outra coisa e não muda);
--   3. malote_excecao_solicitar: notifica só o aprovador; recusa o pedido se ele não estiver configurado;
--   4. malote_excecao_decidir: ela pode decidir até um pedido feito por ela mesma (é a única autoridade; bloquear
--      travaria o fluxo).
--
-- Depende da 20261015000003. Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 4).

-- BLOCO 1 ─ coluna e aprovador atual
ALTER TABLE public.malote_config
  ADD COLUMN IF NOT EXISTS excecao_aprovador_user_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.malote_config.excecao_aprovador_user_id IS
  'Único usuário que aprova/reprova Solicitações de Exceção do Malote (SIS-2026-0668).';

-- FERNANDA MALDANER (DIRETORA ADMINISTRATIVA, adm@haggltda.com.br). Só preenche se ainda estiver vazio.
UPDATE public.malote_config
   SET excecao_aprovador_user_id = '24441177-a9e2-4f0e-b2ae-7d4fabe37044'
 WHERE id = true AND excecao_aprovador_user_id IS NULL;

-- BLOCO 2 ─ quem pode decidir (a assinatura continua com a classificação para não mexer na RLS; ela é ignorada)
CREATE OR REPLACE FUNCTION public.malote_excecao_pode_decidir(_classificacao_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.malote_config c
     WHERE c.id = true AND c.excecao_aprovador_user_id = _user_id
  );
$$;

-- BLOCO 3 ─ solicitar notifica só o aprovador configurado
CREATE OR REPLACE FUNCTION public.malote_excecao_solicitar(
  _tipo text,
  _classificacao_id uuid,
  _contrato_id uuid,
  _empresa_id uuid,
  _valor numeric,
  _data_pagamento date,
  _descricao text,
  _justificativa text,
  _arquivos text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_numero text;
  v_aprovadores uuid[];
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  IF NOT public.can_access(auth.uid(), 'malote_excecao_solicitar', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar exceção.';
  END IF;
  IF _classificacao_id IS NULL OR _empresa_id IS NULL OR _data_pagamento IS NULL OR COALESCE(_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Preencha classificação, empresa, valor e data prevista do pagamento.';
  END IF;
  IF btrim(COALESCE(_descricao, '')) = '' OR btrim(COALESCE(_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'Informe a descrição da despesa e a justificativa da exceção.';
  END IF;
  -- Mesma regra do piso absoluto da despesa: data no passado nunca, nem como exceção (SIS-2026-0361).
  IF _data_pagamento < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data prevista do pagamento é anterior a hoje — não é permitido, nem como exceção.';
  END IF;

  SELECT ARRAY[c.excecao_aprovador_user_id] INTO v_aprovadores
    FROM public.malote_config c WHERE c.id = true AND c.excecao_aprovador_user_id IS NOT NULL;
  IF COALESCE(array_length(v_aprovadores, 1), 0) = 0 THEN
    RAISE EXCEPTION 'O aprovador das exceções ainda não foi definido — peça ao Sistemas para configurar em Malote › Configurações.';
  END IF;

  v_numero := 'EXC-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.malote_excecao_solicitacao_seq')::text, 4, '0');

  INSERT INTO public.malote_excecao_solicitacao
    (numero, solicitante_id, tipo, classificacao_id, contrato_id, empresa_id, valor, data_pagamento, descricao, justificativa, arquivos)
  VALUES
    (v_numero, auth.uid(), _tipo, _classificacao_id, _contrato_id, _empresa_id, round(_valor, 2), _data_pagamento, btrim(_descricao), btrim(_justificativa), COALESCE(_arquivos, '{}'))
  RETURNING id INTO v_id;

  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'solicitada', auth.uid(),
          CASE WHEN COALESCE(array_length(_arquivos, 1), 0) > 0
               THEN format('Exceção solicitada, com %s anexo(s).', array_length(_arquivos, 1))
               ELSE 'Exceção solicitada.' END);

  SELECT COALESCE(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  PERFORM public.malote_notificar_usuarios(
    v_aprovadores, _empresa_id,
    'Nova solicitação de exceção no Malote',
    format('%s pediu a exceção %s (R$ %s, pagamento em %s). Analise em Malote › Autorizações de Exceção.',
           COALESCE(v_nome, 'Um usuário'), v_numero, to_char(round(_valor, 2), 'FM999G999G990D00'), to_char(_data_pagamento, 'DD/MM/YYYY')),
    'malote_excecao', '/app/malote/excecao/autorizacoes'
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text, text[]) TO authenticated;

-- BLOCO 4 ─ decidir: só o aprovador configurado
CREATE OR REPLACE FUNCTION public.malote_excecao_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
  v_senha text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.status <> 'em_analise' THEN RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', s.status; END IF;
  IF NOT public.malote_excecao_pode_decidir(s.classificacao_id, auth.uid()) THEN
    RAISE EXCEPTION 'Só o aprovador das exceções (diretoria financeira) pode decidir esta solicitação.';
  END IF;
  IF NOT _aprovar AND btrim(COALESCE(_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.';
  END IF;

  IF _aprovar THEN
    LOOP
      v_senha := 'EXC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.malote_excecao_solicitacao WHERE senha = v_senha);
    END LOOP;
    UPDATE public.malote_excecao_solicitacao
       SET status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = NULLIF(btrim(COALESCE(_motivo, '')), ''),
           senha = v_senha, senha_expira_em = now() + interval '24 hours', updated_at = now()
     WHERE id = _id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'aprovada', auth.uid(), 'Exceção aprovada. Senha gerada, válida por 24 horas.');
    PERFORM public.malote_notificar_usuarios(
      ARRAY[s.solicitante_id], s.empresa_id,
      'Exceção aprovada — senha liberada',
      format('A exceção %s foi aprovada. Use a senha na criação da despesa em até 24 horas. Veja em Malote › Solicitar Exceção.', s.numero),
      'malote_excecao', '/app/malote/excecao/solicitar'
    );
    RETURN v_senha;
  END IF;

  UPDATE public.malote_excecao_solicitacao
     SET status = 'reprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = btrim(_motivo), updated_at = now()
   WHERE id = _id;
  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'reprovada', auth.uid(), 'Exceção reprovada: ' || btrim(_motivo));
  PERFORM public.malote_notificar_usuarios(
    ARRAY[s.solicitante_id], s.empresa_id,
    'Exceção reprovada',
    format('A exceção %s foi reprovada. Motivo: %s', s.numero, btrim(_motivo)),
    'malote_excecao', '/app/malote/excecao/solicitar'
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   (recriar malote_excecao_pode_decidir, malote_excecao_solicitar e malote_excecao_decidir como na 20261015000001/…03)
--   ALTER TABLE public.malote_config DROP COLUMN IF EXISTS excecao_aprovador_user_id;
--   NOTIFY pgrst, 'reload schema';
