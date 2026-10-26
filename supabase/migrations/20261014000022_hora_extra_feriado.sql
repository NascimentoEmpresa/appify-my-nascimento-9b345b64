-- =====================================================================
-- [SEM-CHAMADO] Hora Extra — todo o período trabalhado em feriado
-- =====================================================================
-- O marcador de feriado é explícito e fica gravado na solicitação. Em feriado a
-- jornada usada no cálculo é zero, portanto cada minuto efetivamente
-- trabalhado vira HE. `seguir_escala = false` mantém compatibilidade com
-- conclusão, validação e correções posteriores, que já respeitam essa
-- decisão persistida desde a migração de fim de semana.
-- =====================================================================

ALTER TABLE public."HORA_EXTRA_SOLICITACAO"
  ADD COLUMN IF NOT EXISTS feriado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."HORA_EXTRA_SOLICITACAO".feriado IS
  'Quando true, todo o período efetivamente trabalhado no dia é considerado hora extra.';

CREATE OR REPLACE FUNCTION public.hora_extra_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_colaborador uuid;
  v_edicao boolean;
  v_aprovar boolean;
  v_incluir boolean;
  v_alterar boolean;
  v_item jsonb;
  v_chamado record;
  v_nome text;
  v_cargo text;
  v_setor text;
  v_empresa text;
  v_escala record;
  v_entrada time;
  v_saida_intervalo time;
  v_retorno_intervalo time;
  v_saida time;
  v_inicio time;
  v_fim time;
  v_inicio_min int;
  v_fim_min int;
  v_trabalhado int;
  v_total int;
  v_jornada_calculo int;
  v_fim_de_semana boolean;
  v_feriado boolean;
  v_seguir_escala boolean;
  v_sem_intervalo boolean;
  v_numero text;
  v_status_atual text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sessão expirada.'; END IF;

  v_edicao := nullif(p->>'id', '') IS NOT NULL;
  v_id := nullif(p->>'id', '')::uuid;
  v_colaborador := coalesce(nullif(p->>'colaborador_id', '')::uuid, v_uid);
  v_aprovar := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar');
  v_incluir := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'incluir');
  v_alterar := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'alterar');

  IF jsonb_array_length(coalesce(p->'chamados', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos um chamado.';
  END IF;
  IF nullif(btrim(p->>'justificativa'), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da solicitação.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p->'chamados') x
    WHERE nullif(x->>'percentual_previsto', '') IS NULL
       OR (x->>'percentual_previsto')::numeric < 0
       OR (x->>'percentual_previsto')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'A expectativa de conclusão de cada chamado deve ficar entre 0%% e 100%%.';
  END IF;

  SELECT e.id, e.nome, e.minutos_jornada, e.nao_aplicavel_fins_semana
  INTO v_escala
  FROM public."HORA_EXTRA_ESCALA" e
  WHERE e.id = nullif(p->>'escala_id', '')::uuid
  LIMIT 1;
  IF v_escala.id IS NULL THEN
    SELECT e.id, e.nome, e.minutos_jornada, e.nao_aplicavel_fins_semana
    INTO v_escala
    FROM public."HORA_EXTRA_ESCALA" e
    WHERE e.padrao
    LIMIT 1;
  END IF;
  IF v_escala.id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma escala de trabalho cadastrada. Cadastre a escala antes de solicitar HE.';
  END IF;

  v_fim_de_semana := extract(isodow FROM (p->>'data_he')::date) IN (6, 7);
  v_feriado := coalesce(nullif(p->>'feriado', '')::boolean, false);
  v_seguir_escala := NOT v_feriado AND (
    NOT (v_fim_de_semana AND v_escala.nao_aplicavel_fins_semana)
    OR coalesce(nullif(p->>'seguir_escala', '')::boolean, false)
  );
  v_sem_intervalo := (
    v_feriado OR (v_fim_de_semana AND v_escala.nao_aplicavel_fins_semana)
  ) AND coalesce(nullif(p->>'sem_intervalo', '')::boolean, false);
  v_jornada_calculo := CASE WHEN v_seguir_escala THEN v_escala.minutos_jornada ELSE 0 END;

  v_entrada := (p->>'ponto_entrada')::time;
  v_saida := (p->>'ponto_saida')::time;
  IF v_sem_intervalo THEN
    v_saida_intervalo := v_entrada;
    v_retorno_intervalo := v_entrada;
  ELSE
    v_saida_intervalo := (p->>'ponto_saida_intervalo')::time;
    v_retorno_intervalo := (p->>'ponto_retorno_intervalo')::time;
  END IF;

  v_trabalhado := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  v_total := public.hora_extra_excedente(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada_calculo
  );
  v_inicio := public.hora_extra_inicio(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada_calculo
  );
  v_fim := v_saida;
  IF v_total <= 0 THEN
    IF v_seguir_escala THEN
      RAISE EXCEPTION
        'Os horários informados somam %, dentro da jornada de % da escala %. Não há hora extra a solicitar.',
        public.hora_extra_formatar_minutos(v_trabalhado),
        public.hora_extra_formatar_minutos(v_escala.minutos_jornada),
        v_escala.nome;
    END IF;
    RAISE EXCEPTION 'Informe um período trabalhado válido para a hora extra.';
  END IF;

  v_inicio_min := extract(epoch FROM v_inicio)::int / 60;
  v_fim_min := extract(epoch FROM v_fim)::int / 60;
  IF v_fim_min <= v_inicio_min THEN v_fim_min := v_fim_min + 1440; END IF;

  IF v_edicao THEN
    SELECT s.status INTO v_status_atual
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.id = v_id
      AND s.colaborador_id = v_uid
      AND s.status IN ('aguardando_liberacao', 'reprovada');
    IF v_status_atual IS NULL OR NOT v_alterar THEN
      RAISE EXCEPTION 'Você não pode editar esta solicitação.';
    END IF;
    v_colaborador := v_uid;
  ELSE
    IF v_colaborador = v_uid AND NOT v_incluir THEN
      RAISE EXCEPTION 'Você não tem permissão para incluir solicitações.';
    END IF;
    IF v_colaborador <> v_uid AND NOT v_aprovar THEN
      RAISE EXCEPTION 'Você não tem permissão para criar HE para outro colaborador.';
    END IF;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p->'chamados') LOOP
    PERFORM public.hora_extra_checar_chamado((v_item->>'chamado_id')::uuid, v_colaborador);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.colaborador_id = v_colaborador
      AND s.data_he = (p->>'data_he')::date
      AND s.status <> 'reprovada'
      AND (NOT v_edicao OR s.id <> v_id)
      AND int4range(
        extract(epoch FROM s.he_inicio_previsto)::int / 60,
        CASE WHEN s.he_fim_previsto <= s.he_inicio_previsto
          THEN extract(epoch FROM s.he_fim_previsto)::int / 60 + 1440
          ELSE extract(epoch FROM s.he_fim_previsto)::int / 60 END,
        '[)'
      ) && int4range(v_inicio_min, v_fim_min, '[)')
  ) THEN
    RAISE EXCEPTION 'Já existe uma solicitação de HE sobreposta para este colaborador e data.';
  END IF;

  SELECT
    coalesce(e."Nome", pr.display_name, 'Colaborador'),
    e."Título do Cargo", e."Setor_ERP", e."Nome da Empresa"
  INTO v_nome, v_cargo, v_setor, v_empresa
  FROM public.profiles pr
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = pr.id
  WHERE pr.id = v_colaborador
  LIMIT 1;
  v_setor := coalesce(nullif(btrim(p->>'setor'), ''), v_setor);

  IF v_edicao THEN
    UPDATE public."HORA_EXTRA_SOLICITACAO"
    SET
      data_he = (p->>'data_he')::date,
      tipo = p->>'tipo',
      ponto_entrada = v_entrada,
      ponto_saida_intervalo = v_saida_intervalo,
      ponto_retorno_intervalo = v_retorno_intervalo,
      ponto_saida = v_saida,
      escala_id = v_escala.id,
      escala_nome = v_escala.nome,
      jornada_minutos = v_jornada_calculo,
      feriado = v_feriado,
      seguir_escala = v_seguir_escala,
      sem_intervalo = v_sem_intervalo,
      trabalhado_previsto_min = v_trabalhado,
      he_inicio_previsto = v_inicio,
      he_fim_previsto = v_fim,
      total_previsto_min = v_total,
      justificativa = btrim(p->>'justificativa'),
      setor = v_setor,
      colaborador_nome = v_nome,
      colaborador_cargo = v_cargo,
      empresa = v_empresa,
      status = 'aguardando_liberacao',
      motivo_reprovacao = NULL,
      liberado_por = NULL,
      liberado_em = NULL
    WHERE id = v_id;
    DELETE FROM public."HORA_EXTRA_CHAMADO" WHERE solicitacao_id = v_id;
    INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto)
    VALUES (
      v_id, v_uid, 'editada',
      CASE WHEN v_status_atual = 'reprovada'
        THEN 'Solicitação reprovada corrigida e reenviada para liberação'
        ELSE 'Solicitação editada' END
    );
  ELSE
    INSERT INTO public."HORA_EXTRA_SOLICITACAO" (
      colaborador_id, colaborador_nome, colaborador_cargo, setor, empresa, criado_por,
      data_he, tipo, ponto_entrada, ponto_saida_intervalo, ponto_retorno_intervalo,
      ponto_saida, escala_id, escala_nome, jornada_minutos, feriado, seguir_escala, sem_intervalo,
      trabalhado_previsto_min, he_inicio_previsto, he_fim_previsto, total_previsto_min,
      justificativa, status, liberado_por, liberado_em
    ) VALUES (
      v_colaborador, v_nome, v_cargo, v_setor, v_empresa, v_uid,
      (p->>'data_he')::date, p->>'tipo', v_entrada, v_saida_intervalo, v_retorno_intervalo,
      v_saida, v_escala.id, v_escala.nome, v_jornada_calculo, v_feriado, v_seguir_escala, v_sem_intervalo,
      v_trabalhado, v_inicio, v_fim, v_total, btrim(p->>'justificativa'),
      CASE WHEN v_colaborador <> v_uid THEN 'aprovada' ELSE 'aguardando_liberacao' END,
      CASE WHEN v_colaborador <> v_uid THEN v_uid END,
      CASE WHEN v_colaborador <> v_uid THEN now() END
    ) RETURNING id, numero INTO v_id, v_numero;
    INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta)
    VALUES (
      v_id, v_uid, 'criada',
      CASE WHEN v_colaborador <> v_uid THEN 'HE criada e liberada pelo gestor' ELSE 'Solicitação criada' END,
      jsonb_build_object('numero', v_numero, 'feriado', v_feriado)
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p->'chamados') LOOP
    SELECT c.id, c.numero, c.assunto, c.setor, c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = (v_item->>'chamado_id')::uuid;
    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id, chamado_id, chamado_numero, chamado_assunto, chamado_setor,
      prioridade, percentual_previsto
    ) VALUES (
      v_id, v_chamado.id, v_chamado.numero, v_chamado.assunto, v_chamado.setor,
      coalesce(nullif(v_item->>'prioridade', ''), v_chamado.prioridade),
      (v_item->>'percentual_previsto')::numeric
    );
  END LOOP;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_salvar(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."HORA_EXTRA_SOLICITACAO" DROP COLUMN IF EXISTS feriado;
-- Reaplique public.hora_extra_salvar(jsonb) da migration
-- 20260930000196_hora_extra_fim_de_semana.sql.
