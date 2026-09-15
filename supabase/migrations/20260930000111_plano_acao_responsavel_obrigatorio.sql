-- SIS-2026-0392 — "Verificar a regra de não poder criar [ação] sem responsável
-- e de puxar o responsável automático quando o comitê for selecionado mesmo
-- que o plano seja feito na reunião."
--
-- O que estava errado:
--
-- 1) "Responsável obrigatório" só existia no botão Salvar do formulário do
--    módulo (Detalhe.tsx). A ação criada pela condução da reunião
--    (DecisoesAcoesPainel → criar_acao_reuniao_plano_acao) salvava sem
--    responsável, e nenhuma das duas RPCs recusava. A regra passa a morar no
--    banco também — as duas RPCs recusam _responsavel_profile_id NULL.
--    Importação do Excel e Copiloto IA gravam direto na tabela (não usam
--    estas RPCs) e continuam aceitando linha sem responsável, que vira
--    pendência "resp" — de propósito: importação legada precisa entrar
--    mesmo incompleta.
--
-- 2) REGRESSÃO: 20260731000002 (grava criado_por) recriou
--    criar_acao_reuniao_plano_acao a partir de uma cópia anterior a
--    20260728000001 e perdeu o preenchimento de responsavel_nome_origem.
--    Toda ação criada em reunião desde então aparece com Responsável "—" na
--    Lista (que lê responsavel_nome_origem). Restaurado aqui, mantendo o
--    criado_por/atualizado_por de 0731. Também passa a gravar
--    lider_comite_nome_origem (a Lista mostra "Comitê: <líder>" por ele).
--
-- 3) criar_plano_acao passa a resolver responsavel_nome_origem de profiles
--    quando o caller não mandar — mesma fonte única do fix de 0728.
--
-- Assinaturas idênticas às atuais (CREATE OR REPLACE sem DROP).

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id               uuid;
  v_uid              uuid;
  v_usuarios         uuid[];
  v_responsavel_nome text;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.plano_acao_can_access(v_uid, _empresa_id, 'criar') THEN
    RAISE EXCEPTION 'sem_permissao_criar_plano_acao' USING ERRCODE = '42501';
  END IF;

  IF _responsavel_profile_id IS NULL THEN
    RAISE EXCEPTION 'responsavel_obrigatorio'
      USING ERRCODE = '23502', HINT = 'Selecione um responsável para criar a ação.';
  END IF;

  IF _visibilidade NOT IN ('privado', 'publico', 'especifico') THEN
    _visibilidade := 'privado';
  END IF;

  IF _tipo_acao NOT IN ('acao', 'tarefa') THEN
    _tipo_acao := 'acao';
  END IF;

  v_responsavel_nome := NULLIF(_responsavel_nome_origem, '');
  IF v_responsavel_nome IS NULL THEN
    SELECT display_name INTO v_responsavel_nome
      FROM public.profiles WHERE id = _responsavel_profile_id;
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
    v_responsavel_nome,
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid               uuid;
  v_empresa_id        uuid;
  v_plano_acao_id     uuid;
  v_responsavel_nome  text;
  v_lider_nome        text;
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

  IF _responsavel_profile_id IS NULL THEN
    RAISE EXCEPTION 'responsavel_obrigatorio'
      USING ERRCODE = '23502', HINT = 'Selecione um responsável para criar a ação.';
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

  SELECT display_name INTO v_responsavel_nome
    FROM public.profiles WHERE id = _responsavel_profile_id;

  IF _lider_comite_profile_id IS NOT NULL THEN
    SELECT display_name INTO v_lider_nome
      FROM public.profiles WHERE id = _lider_comite_profile_id;
  END IF;

  INSERT INTO public.plano_acao (
    empresa_id, titulo, problema, acao,
    comite, area,
    prioridade_normalizada, status_normalizado,
    responsavel_profile_id, responsavel_nome_origem,
    lider_comite_profile_id, lider_comite_nome_origem,
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
    v_responsavel_nome,
    _lider_comite_profile_id,
    v_lider_nome,
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


-- Backfill idempotente das ações que a regressão de 0731 deixou com
-- Responsável "—" na Lista (profile_id certo, nome_origem NULL). Mesmo
-- padrão de 20260728000002, restrito a quem está NULL.
UPDATE public.plano_acao pa
   SET responsavel_nome_origem = p.display_name
  FROM public.profiles p
 WHERE pa.responsavel_profile_id = p.id
   AND p.display_name IS NOT NULL
   AND pa.responsavel_nome_origem IS NULL;

UPDATE public.plano_acao pa
   SET lider_comite_nome_origem = p.display_name
  FROM public.profiles p
 WHERE pa.lider_comite_profile_id = p.id
   AND p.display_name IS NOT NULL
   AND pa.lider_comite_nome_origem IS NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar supabase/migrations/20260731000002_plano_acao_grava_criado_por.sql
-- (volta as duas RPCs sem a checagem de responsável — e com a regressão do
-- responsavel_nome_origem na da reunião). O backfill não precisa ser desfeito.
