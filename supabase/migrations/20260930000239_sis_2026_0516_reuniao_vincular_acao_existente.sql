-- SIS-2026-0516: permite usar em uma pauta de reunião uma ação que já existe
-- no Plano de Ações. Até aqui a condução sempre chamava
-- criar_acao_reuniao_plano_acao, mesmo quando a ação já estava cadastrada,
-- induzindo a duplicidade.
--
-- A seleção continua respeitando a visibilidade do Plano de Ações. A RPC é
-- SECURITY DEFINER apenas para conseguir criar o espelho local da reunião;
-- antes disso valida a interação com a reunião, a relação pauta/reunião, a
-- visibilidade da ação e se ela ainda está em aberto.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reuniao_decisao_acao_pauta_plano_unico
  ON public.reuniao_decisao_acao (pauta_id, plano_acao_id)
  WHERE plano_acao_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.vincular_acao_existente_reuniao(
  _reuniao_id   uuid,
  _pauta_id     uuid,
  _plano_acao_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_acao      public.plano_acao%ROWTYPE;
  v_vinculo   uuid;
  v_titulo    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.tem_acesso_menu('central_servicos_reunioes')
     OR NOT public.tem_interacao_reuniao(_reuniao_id) THEN
    RAISE EXCEPTION 'sem_interacao_reuniao' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.reuniao_pauta p
     WHERE p.id = _pauta_id
       AND p.reuniao_id = _reuniao_id
  ) THEN
    RAISE EXCEPTION 'pauta_nao_pertence_a_reuniao' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_acao
    FROM public.plano_acao
   WHERE id = _plano_acao_id
     AND deleted_at IS NULL;

  IF NOT FOUND OR NOT public.plano_acao_visible_by_user(v_uid, _plano_acao_id) THEN
    RAISE EXCEPTION 'acao_nao_encontrada_ou_sem_acesso' USING ERRCODE = '42501';
  END IF;

  IF v_acao.status_normalizado IN (
    'concluida_pendente_evidencia',
    'concluida_validada',
    'cancelada'
  ) THEN
    RAISE EXCEPTION 'acao_nao_esta_em_aberto' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.reuniao_decisao_acao da
      JOIN public.reuniao_pauta p ON p.id = da.pauta_id
     WHERE p.reuniao_id = _reuniao_id
       AND da.plano_acao_id = _plano_acao_id
  ) THEN
    RAISE EXCEPTION 'acao_ja_vinculada_reuniao' USING ERRCODE = '23505';
  END IF;

  v_titulo := COALESCE(
    NULLIF(btrim(v_acao.titulo), ''),
    NULLIF(btrim(v_acao.acao), ''),
    'Ação sem título'
  );

  INSERT INTO public.reuniao_decisao_acao (
    pauta_id,
    tipo,
    texto,
    responsavel_user_id,
    prazo,
    prioridade,
    status,
    setor_impactado,
    plano_acao_id
  ) VALUES (
    _pauta_id,
    'acao',
    v_titulo,
    v_acao.responsavel_profile_id,
    v_acao.data_fim_planejado,
    CASE
      WHEN v_acao.prioridade_normalizada IN ('alta', 'media', 'baixa')
        THEN v_acao.prioridade_normalizada
      WHEN v_acao.prioridade_normalizada = 'emergencial' THEN 'alta'
      ELSE 'media'
    END,
    CASE
      WHEN v_acao.status_normalizado = 'em_andamento' THEN 'em_andamento'
      ELSE 'pendente'
    END,
    NULLIF(v_acao.area, ''),
    v_acao.id
  )
  RETURNING id INTO v_vinculo;

  RETURN v_vinculo;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_acao_existente_reuniao(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_acao_existente_reuniao(uuid, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.vincular_acao_existente_reuniao(uuid, uuid, uuid);
-- DROP INDEX IF EXISTS public.idx_reuniao_decisao_acao_pauta_plano_unico;
