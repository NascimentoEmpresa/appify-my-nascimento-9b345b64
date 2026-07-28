-- Nenhuma das duas RPCs que criam plano_acao grava "criado_por" — só o
-- Copiloto IA (edge function, insert direto) grava. Isso torna impossível
-- saber quem criou a maioria das ações (pré-requisito da regra "só quem
-- criou valida como Concluída — Validada"). Mesma assinatura das duas
-- funções (CREATE OR REPLACE simples, sem DROP — não muda parâmetro
-- nenhum), só adiciona criado_por/atualizado_por = auth.uid() no INSERT.

CREATE OR REPLACE FUNCTION public.criar_plano_acao(
  _empresa_id                uuid,
  _titulo                    text,
  _problema                  text    DEFAULT NULL,
  _acao                      text    DEFAULT NULL,
  _comite                    text    DEFAULT NULL,
  _area                      text    DEFAULT NULL,
  _setor                     text    DEFAULT NULL,
  _prioridade_normalizada    text    DEFAULT 'media',
  _status_normalizado        text    DEFAULT 'a_definir',
  _responsavel_profile_id    uuid    DEFAULT NULL,
  _responsavel_nome_origem   text    DEFAULT NULL,
  _lider_comite_nome_origem  text    DEFAULT NULL,
  _data_inicio_planejado     date    DEFAULT NULL,
  _data_fim_planejado        date    DEFAULT NULL,
  _comentarios               text    DEFAULT NULL,
  _visibilidade              text    DEFAULT 'privado',
  _usuarios_visibilidade     uuid[]  DEFAULT NULL,
  _tipo_acao                 text    DEFAULT 'acao',
  _lider_comite_profile_id   uuid    DEFAULT NULL,
  _tipo_reuniao              text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       uuid;
  v_uid      uuid;
  v_usuarios uuid[];
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.plano_acao_can_access(v_uid, _empresa_id, 'criar') THEN
    RAISE EXCEPTION 'sem_permissao_criar_plano_acao' USING ERRCODE = '42501';
  END IF;

  IF _visibilidade NOT IN ('privado', 'publico', 'especifico') THEN
    _visibilidade := 'privado';
  END IF;

  IF _tipo_acao NOT IN ('acao', 'tarefa') THEN
    _tipo_acao := 'acao';
  END IF;

  INSERT INTO public.plano_acao (
    empresa_id, titulo, problema, acao,
    comite, area, setor,
    prioridade_normalizada, status_normalizado,
    responsavel_profile_id, responsavel_nome_origem,
    lider_comite_nome_origem, lider_comite_profile_id,
    data_inicio_planejado, data_fim_planejado,
    comentarios, origem, visibilidade, tipo_acao, tipo_reuniao,
    criado_por, atualizado_por
  ) VALUES (
    _empresa_id,
    _titulo,
    NULLIF(_problema, ''),
    NULLIF(_acao, ''),
    NULLIF(_comite, ''),
    NULLIF(_area, ''),
    NULLIF(_setor, ''),
    _prioridade_normalizada,
    _status_normalizado,
    _responsavel_profile_id,
    NULLIF(_responsavel_nome_origem, ''),
    NULLIF(_lider_comite_nome_origem, ''),
    _lider_comite_profile_id,
    _data_inicio_planejado,
    _data_fim_planejado,
    NULLIF(_comentarios, ''),
    'manual',
    _visibilidade,
    _tipo_acao,
    NULLIF(_tipo_reuniao, ''),
    v_uid,
    v_uid
  ) RETURNING id INTO v_id;

  IF _visibilidade = 'especifico' THEN
    v_usuarios := COALESCE(_usuarios_visibilidade, ARRAY[]::uuid[]);
    IF NOT (v_uid = ANY(v_usuarios)) THEN
      v_usuarios := array_append(v_usuarios, v_uid);
    END IF;
    IF array_length(v_usuarios, 1) > 0 THEN
      INSERT INTO public.plano_acao_visibilidade_usuario (plano_acao_id, empresa_id, profile_id)
      SELECT v_id, _empresa_id, unnest(v_usuarios)
      ON CONFLICT (plano_acao_id, profile_id) DO NOTHING;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_plano_acao(
  uuid, text, text, text, text, text, text, text, text, uuid, text, text, date, date, text, text, uuid[], text, uuid, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.criar_plano_acao(
  uuid, text, text, text, text, text, text, text, text, uuid, text, text, date, date, text, text, uuid[], text, uuid, text
) TO authenticated;

-- Mesma correção pra ações criadas a partir de decisão de reunião.
CREATE OR REPLACE FUNCTION public.criar_acao_reuniao_plano_acao(
  _reuniao_id                uuid,
  _pauta_id                  uuid,
  _titulo                    text,
  _problema                  text    DEFAULT NULL,
  _acao                      text    DEFAULT NULL,
  _comite                    text    DEFAULT NULL,
  _area                      text    DEFAULT NULL,
  _prioridade_normalizada    text    DEFAULT 'media',
  _status_normalizado        text    DEFAULT 'a_definir',
  _data_inicio_planejado     date    DEFAULT NULL,
  _data_fim_planejado        date    DEFAULT NULL,
  _responsavel_profile_id    uuid    DEFAULT NULL,
  _lider_comite_profile_id   uuid    DEFAULT NULL,
  _visibilidade              text    DEFAULT 'privado',
  _comentarios               text    DEFAULT NULL,
  _tipo_acao                 text    DEFAULT 'acao',
  _tipo_reuniao              text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid;
  v_empresa_id        uuid;
  v_plano_acao_id     uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.tem_interacao_reuniao(_reuniao_id) THEN
    RAISE EXCEPTION 'sem_interacao_reuniao' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.reuniao_pauta p
    WHERE p.id = _pauta_id AND p.reuniao_id = _reuniao_id
  ) THEN
    RAISE EXCEPTION 'pauta_nao_pertence_a_reuniao' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(empresa_atual_id, empresa_id) INTO v_empresa_id
  FROM public.profiles WHERE id = v_uid;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'empresa_nao_resolvida' USING ERRCODE = '22023';
  END IF;

  IF _visibilidade NOT IN ('privado', 'publico', 'especifico') THEN
    _visibilidade := 'privado';
  END IF;

  IF _tipo_acao NOT IN ('acao', 'tarefa') THEN
    _tipo_acao := 'acao';
  END IF;

  INSERT INTO public.plano_acao (
    empresa_id, titulo, problema, acao,
    comite, area,
    prioridade_normalizada, status_normalizado,
    responsavel_profile_id,
    lider_comite_profile_id,
    data_inicio_planejado, data_fim_planejado,
    comentarios, origem, metadata_origem, visibilidade, tipo_acao, tipo_reuniao,
    criado_por, atualizado_por
  ) VALUES (
    v_empresa_id,
    _titulo,
    NULLIF(_problema, ''),
    NULLIF(_acao, ''),
    NULLIF(_comite, ''),
    NULLIF(_area, ''),
    _prioridade_normalizada,
    _status_normalizado,
    _responsavel_profile_id,
    _lider_comite_profile_id,
    _data_inicio_planejado,
    _data_fim_planejado,
    NULLIF(_comentarios, ''),
    'reuniao',
    jsonb_build_object('reuniao_id', _reuniao_id, 'pauta_id', _pauta_id),
    _visibilidade,
    _tipo_acao,
    NULLIF(_tipo_reuniao, ''),
    v_uid,
    v_uid
  ) RETURNING id INTO v_plano_acao_id;

  INSERT INTO public.reuniao_decisao_acao (
    pauta_id, tipo, texto, responsavel_user_id, prazo, prioridade, status, setor_impactado, plano_acao_id
  ) VALUES (
    _pauta_id,
    'acao',
    _titulo,
    _responsavel_profile_id,
    _data_fim_planejado,
    CASE WHEN _prioridade_normalizada IN ('alta', 'media', 'baixa') THEN _prioridade_normalizada
         WHEN _prioridade_normalizada = 'emergencial' THEN 'alta'
         ELSE 'media' END,
    CASE WHEN _status_normalizado = 'em_andamento' THEN 'em_andamento'
         WHEN _status_normalizado IN ('concluida_pendente_evidencia', 'concluida_validada', 'cancelada') THEN 'concluida'
         ELSE 'pendente' END,
    NULLIF(_area, ''),
    v_plano_acao_id
  );

  RETURN v_plano_acao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_acao_reuniao_plano_acao(
  uuid, uuid, text, text, text, text, text, text, text, date, date, uuid, uuid, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.criar_acao_reuniao_plano_acao(
  uuid, uuid, text, text, text, text, text, text, text, date, date, uuid, uuid, text, text, text, text
) TO authenticated;
