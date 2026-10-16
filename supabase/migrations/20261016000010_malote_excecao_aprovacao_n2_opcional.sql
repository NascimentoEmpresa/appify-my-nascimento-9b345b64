-- ============================================================================
-- [SEM-CHAMADO] Exceção do Malote: quem aprova — a pessoa, a pessoa e o N2, ou só o N2 (Malote › Configurações › 2.4)
-- ============================================================================
-- Hoje só o aprovador configurado (20261015000004) decide as Solicitações de Exceção. Pediram de volta os N2: um modo
-- em Configurações escolhe quem aprova:
--   'pessoa' (padrão, como é hoje): somente o aprovador configurado;
--   'pessoa_e_n2': o aprovador configurado E o N2 da classificação da solicitação — qualquer um dos dois aprova ou
--                  reprova (a primeira decisão vale; a solicitação sai da fila do outro);
--   'n2': somente o N2 da classificação (o aprovador configurado deixa de decidir). Classificação sem N2 cadastrado não
--         aceita solicitação nesse modo (ninguém poderia aprovar).
--
--  1. malote_config.excecao_aprovacao_modo text ('pessoa' | 'pessoa_e_n2' | 'n2'; padrão 'pessoa');
--  2. malote_excecao_pode_decidir: aplica o modo. É a única regra de "quem decide": a tela Autorizações
--     (malote_excecao_classificacoes_que_decido), a leitura das solicitações e a RPC malote_excecao_decidir já passam por ela;
--  3. malote_excecao_solicitar: notifica quem o modo manda (pessoa, pessoa + N2 ou só N2);
--  4. malote_excecao_decidir: registra no histórico quando quem decidiu foi o N2 (e não o aprovador configurado).
--
-- Depende da 20261015000004. Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 4).
--
-- ROLLBACK: reaplicar as funções da 20261015000004 (BLOCOS 2 a 4) e
--   ALTER TABLE public.malote_config DROP COLUMN IF EXISTS excecao_aprovacao_modo; NOTIFY pgrst, 'reload schema';

-- ── BLOCO 1 ── chave (default constante: não reescreve a tabela de 1 linha)
SET lock_timeout = '8s';
ALTER TABLE public.malote_config
  ADD COLUMN IF NOT EXISTS excecao_aprovacao_modo text NOT NULL DEFAULT 'pessoa';
ALTER TABLE public.malote_config DROP CONSTRAINT IF EXISTS malote_config_excecao_aprovacao_modo_check;
ALTER TABLE public.malote_config
  ADD CONSTRAINT malote_config_excecao_aprovacao_modo_check CHECK (excecao_aprovacao_modo IN ('pessoa', 'pessoa_e_n2', 'n2'));

COMMENT ON COLUMN public.malote_config.excecao_aprovacao_modo IS
  'Exceção do Malote — quem aprova: pessoa (só o aprovador configurado), pessoa_e_n2 (ele e o N2 da classificação) ou n2 (só o N2).';

-- ── BLOCO 2 ── quem pode decidir
CREATE OR REPLACE FUNCTION public.malote_excecao_pode_decidir(_classificacao_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.malote_config c
             WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa', 'pessoa_e_n2') AND c.excecao_aprovador_user_id = _user_id)
    OR (
      EXISTS (SELECT 1 FROM public.malote_config c WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa_e_n2', 'n2'))
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao k
         WHERE k.id = _classificacao_id AND _user_id = ANY (COALESCE(k.aprovador2_user_ids, '{}'::uuid[]))
      )
    )
  );
$$;

-- ── BLOCO 3 ── solicitar: notifica quem o modo manda (aprovador configurado e/ou N2 da classificação)
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

  -- Quem aprova pelo modo: aprovador configurado (pessoa, pessoa_e_n2) e/ou N2 da classificação (pessoa_e_n2, n2), sem repetir pessoa.
  SELECT ARRAY(
    SELECT DISTINCT u FROM (
      SELECT c.excecao_aprovador_user_id AS u FROM public.malote_config c
       WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa', 'pessoa_e_n2')
      UNION ALL
      SELECT unnest(COALESCE(k.aprovador2_user_ids, '{}'::uuid[]))
        FROM public.malote_config c
        JOIN public.planejamento_orcamentario_classificacao k ON k.id = _classificacao_id
       WHERE c.id = true AND c.excecao_aprovacao_modo IN ('pessoa_e_n2', 'n2')
    ) x WHERE u IS NOT NULL
  ) INTO v_aprovadores;
  IF COALESCE(array_length(v_aprovadores, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Não há aprovador para esta exceção: configure o aprovador (ou o N2 desta classificação) em Malote › Configurações — peça ao Sistemas.';
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

-- ── BLOCO 4 ── decidir: aprovador configurado ou (chave ligada) N2 da classificação; o histórico diz quem decidiu como N2
CREATE OR REPLACE FUNCTION public.malote_excecao_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
  v_senha text;
  v_como_n2 boolean;
  v_sufixo text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.status <> 'em_analise' THEN RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', s.status; END IF;
  IF NOT public.malote_excecao_pode_decidir(s.classificacao_id, auth.uid()) THEN
    RAISE EXCEPTION 'Você não é aprovador desta solicitação de exceção (veja em Malote › Configurações quem aprova).';
  END IF;
  IF NOT _aprovar AND btrim(COALESCE(_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.';
  END IF;

  -- Decidiu como N2 quando não é o aprovador configurado (ou quando o modo é só N2).
  v_como_n2 := NOT EXISTS (SELECT 1 FROM public.malote_config c WHERE c.id = true AND c.excecao_aprovacao_modo <> 'n2' AND c.excecao_aprovador_user_id = auth.uid());
  v_sufixo := CASE WHEN v_como_n2 THEN ' (decidida como N2 da classificação)' ELSE '' END;

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
    VALUES (_id, 'aprovada', auth.uid(), 'Exceção aprovada' || v_sufixo || '. Senha gerada, válida por 24 horas.');
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
  VALUES (_id, 'reprovada', auth.uid(), 'Exceção reprovada' || v_sufixo || ': ' || btrim(_motivo));
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
