-- =====================================================================
-- [SEM-CHAMADO] Hora Extra — escala não aplicável aos finais de semana
-- =====================================================================
-- A escala pode ser marcada como não aplicável em sábados e domingos. Ao
-- solicitar a HE em uma dessas datas, a pessoa escolhe se deseja seguir a
-- jornada normal; sem essa escolha, todo o período trabalhado é HE.
--
-- A decisão fica na solicitação, não apenas no navegador: assim uma edição,
-- liberação, conclusão ou validação posterior conserva o mesmo cálculo.
-- =====================================================================

ALTER TABLE public."HORA_EXTRA_ESCALA"
  ADD COLUMN IF NOT EXISTS nao_aplicavel_fins_semana boolean NOT NULL DEFAULT false;

ALTER TABLE public."HORA_EXTRA_SOLICITACAO"
  ADD COLUMN IF NOT EXISTS seguir_escala boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sem_intervalo boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- Escala: grava a preferência que habilita a exceção no formulário.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_escala_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_entrada time := (p->>'entrada')::time;
  v_saida_intervalo time := (p->>'saida_intervalo')::time;
  v_retorno_intervalo time := (p->>'retorno_intervalo')::time;
  v_saida time := (p->>'saida')::time;
  v_padrao boolean := coalesce(nullif(p->>'padrao', '')::boolean, false);
  v_nao_aplicavel_fins_semana boolean := coalesce(nullif(p->>'nao_aplicavel_fins_semana', '')::boolean, false);
  v_minutos integer;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para cadastrar escalas de trabalho.';
  END IF;
  IF v_nome = '' THEN RAISE EXCEPTION 'Informe o nome da escala.'; END IF;

  v_minutos := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  IF v_minutos <= 0 THEN RAISE EXCEPTION 'Os horários da escala não formam uma jornada válida.'; END IF;

  IF v_padrao THEN
    UPDATE public."HORA_EXTRA_ESCALA"
    SET padrao = false
    WHERE padrao AND (v_id IS NULL OR id <> v_id);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public."HORA_EXTRA_ESCALA" (
      nome, entrada, saida_intervalo, retorno_intervalo, saida,
      minutos_jornada, padrao, nao_aplicavel_fins_semana, criado_por
    ) VALUES (
      v_nome, v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida,
      v_minutos, v_padrao, v_nao_aplicavel_fins_semana, v_uid
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public."HORA_EXTRA_ESCALA"
    SET
      nome = v_nome,
      entrada = v_entrada,
      saida_intervalo = v_saida_intervalo,
      retorno_intervalo = v_retorno_intervalo,
      saida = v_saida,
      minutos_jornada = v_minutos,
      padrao = v_padrao,
      nao_aplicavel_fins_semana = v_nao_aplicavel_fins_semana,
      ativo = true
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escala de trabalho não encontrada.'; END IF;
  END IF;
  RETURN v_id;
END;
$fn$;

-- ---------------------------------------------------------------------
-- Solicitação: o cálculo usa jornada zero quando a escala não é seguida.
-- Os dois horários de intervalo recebem a entrada em um dia sem pausa,
-- preservando o contrato de quatro horários das RPCs já existentes.
-- ---------------------------------------------------------------------
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
  v_seguir_escala := NOT (v_fim_de_semana AND v_escala.nao_aplicavel_fins_semana)
    OR coalesce(nullif(p->>'seguir_escala', '')::boolean, false);
  v_sem_intervalo := v_fim_de_semana
    AND v_escala.nao_aplicavel_fins_semana
    AND coalesce(nullif(p->>'sem_intervalo', '')::boolean, false);
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
      ponto_saida, escala_id, escala_nome, jornada_minutos, seguir_escala, sem_intervalo,
      trabalhado_previsto_min, he_inicio_previsto, he_fim_previsto, total_previsto_min,
      justificativa, status, liberado_por, liberado_em
    ) VALUES (
      v_colaborador, v_nome, v_cargo, v_setor, v_empresa, v_uid,
      (p->>'data_he')::date, p->>'tipo', v_entrada, v_saida_intervalo, v_retorno_intervalo,
      v_saida, v_escala.id, v_escala.nome, v_jornada_calculo, v_seguir_escala, v_sem_intervalo,
      v_trabalhado, v_inicio, v_fim, v_total, btrim(p->>'justificativa'),
      CASE WHEN v_colaborador <> v_uid THEN 'aprovada' ELSE 'aguardando_liberacao' END,
      CASE WHEN v_colaborador <> v_uid THEN v_uid END,
      CASE WHEN v_colaborador <> v_uid THEN now() END
    ) RETURNING id, numero INTO v_id, v_numero;
    INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta)
    VALUES (
      v_id, v_uid, 'criada',
      CASE WHEN v_colaborador <> v_uid THEN 'HE criada e liberada pelo gestor' ELSE 'Solicitação criada' END,
      jsonb_build_object('numero', v_numero)
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

-- ---------------------------------------------------------------------
-- Ajustes de horário feitos pelo gestor também aceitam jornada zero.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_liberar_com_horarios(p_id uuid, p_horarios jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_entrada time; v_saida_intervalo time; v_retorno_intervalo time; v_saida time;
  v_jornada integer; v_trabalhado integer; v_total integer; v_inicio time;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN RAISE EXCEPTION 'Você não tem permissão para aprovar.'; END IF;
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'alterar') THEN RAISE EXCEPTION 'Você não tem permissão para alterar os horários da solicitação.'; END IF;
  SELECT * INTO v_s FROM public."HORA_EXTRA_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF v_s.id IS NULL OR v_s.status <> 'aguardando_liberacao' THEN RAISE EXCEPTION 'A solicitação não aguarda liberação.'; END IF;
  IF p_horarios IS NULL OR jsonb_typeof(p_horarios) <> 'object' THEN RAISE EXCEPTION 'Informe os quatro horários do ponto.'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ((p_horarios->>'entrada')), ((p_horarios->>'saida_intervalo')), ((p_horarios->>'retorno_intervalo')), ((p_horarios->>'saida'))) AS horarios(valor) WHERE nullif(btrim(valor), '') IS NULL) THEN RAISE EXCEPTION 'Informe os quatro horários do ponto.'; END IF;
  v_entrada := (p_horarios->>'entrada')::time; v_saida_intervalo := (p_horarios->>'saida_intervalo')::time; v_retorno_intervalo := (p_horarios->>'retorno_intervalo')::time; v_saida := (p_horarios->>'saida')::time;
  v_jornada := CASE WHEN coalesce(v_s.seguir_escala, true) THEN coalesce(v_s.jornada_minutos, (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1)) ELSE 0 END;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'A solicitação não possui uma jornada de trabalho válida.'; END IF;
  v_trabalhado := public.hora_extra_minutos_trabalhados(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida);
  v_total := public.hora_extra_excedente(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  v_inicio := public.hora_extra_inicio(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Os horários informados não geram hora extra a liberar.'; END IF;
  UPDATE public."HORA_EXTRA_SOLICITACAO" SET ponto_entrada = v_entrada, ponto_saida_intervalo = v_saida_intervalo, ponto_retorno_intervalo = v_retorno_intervalo, ponto_saida = v_saida, trabalhado_previsto_min = v_trabalhado, he_inicio_previsto = v_inicio, he_fim_previsto = v_saida, total_previsto_min = v_total, status = 'aprovada', liberado_por = v_uid, liberado_em = now(), motivo_reprovacao = NULL WHERE id = p_id;
  INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta) VALUES
    (p_id, v_uid, 'editada', 'Horários do ponto ajustados durante a análise da solicitação', jsonb_build_object('antes', jsonb_build_object('entrada', v_s.ponto_entrada, 'saida_intervalo', v_s.ponto_saida_intervalo, 'retorno_intervalo', v_s.ponto_retorno_intervalo, 'saida', v_s.ponto_saida, 'total_previsto_min', v_s.total_previsto_min), 'depois', jsonb_build_object('entrada', v_entrada, 'saida_intervalo', v_saida_intervalo, 'retorno_intervalo', v_retorno_intervalo, 'saida', v_saida, 'total_previsto_min', v_total))),
    (p_id, v_uid, 'liberada', 'Solicitação liberada com os horários ajustados', jsonb_build_object('horarios_ajustados', true));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.hora_extra_validar_com_horarios(p_id uuid, p_horarios jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_entrada time; v_saida_intervalo time; v_retorno_intervalo time; v_saida time;
  v_jornada integer; v_trabalhado integer; v_total integer; v_inicio time;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN RAISE EXCEPTION 'Você não tem permissão para validar.'; END IF;
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'alterar') THEN RAISE EXCEPTION 'Você não tem permissão para alterar os horários efetivos da solicitação.'; END IF;
  SELECT * INTO v_s FROM public."HORA_EXTRA_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF v_s.id IS NULL OR v_s.status <> 'aguardando_validacao' THEN RAISE EXCEPTION 'A solicitação não aguarda validação.'; END IF;
  IF p_horarios IS NULL OR jsonb_typeof(p_horarios) <> 'object' THEN RAISE EXCEPTION 'Informe os quatro horários efetivos do ponto.'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ((p_horarios->>'entrada')), ((p_horarios->>'saida_intervalo')), ((p_horarios->>'retorno_intervalo')), ((p_horarios->>'saida'))) AS horarios(valor) WHERE nullif(btrim(valor), '') IS NULL) THEN RAISE EXCEPTION 'Informe os quatro horários efetivos do ponto.'; END IF;
  v_entrada := (p_horarios->>'entrada')::time; v_saida_intervalo := (p_horarios->>'saida_intervalo')::time; v_retorno_intervalo := (p_horarios->>'retorno_intervalo')::time; v_saida := (p_horarios->>'saida')::time;
  v_jornada := CASE WHEN coalesce(v_s.seguir_escala, true) THEN coalesce(v_s.jornada_minutos, (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1)) ELSE 0 END;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'A solicitação não possui uma jornada de trabalho válida.'; END IF;
  v_trabalhado := public.hora_extra_minutos_trabalhados(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida);
  v_total := public.hora_extra_excedente(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  v_inicio := public.hora_extra_inicio(v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Os horários efetivos informados não geram hora extra a validar.'; END IF;
  UPDATE public."HORA_EXTRA_SOLICITACAO" SET ponto_entrada_real = v_entrada, ponto_saida_intervalo_real = v_saida_intervalo, ponto_retorno_intervalo_real = v_retorno_intervalo, ponto_saida_real = v_saida, trabalhado_real_min = v_trabalhado, he_inicio_real = v_inicio, he_fim_real = v_saida, total_real_min = v_total WHERE id = p_id;
  INSERT INTO public."HORA_EXTRA_EVENTO" (solicitacao_id, autor_id, acao, texto, meta) VALUES
    (p_id, v_uid, 'editada', 'Horários efetivos do ponto ajustados durante a validação', jsonb_build_object('antes', jsonb_build_object('entrada', v_s.ponto_entrada_real, 'saida_intervalo', v_s.ponto_saida_intervalo_real, 'retorno_intervalo', v_s.ponto_retorno_intervalo_real, 'saida', v_s.ponto_saida_real, 'total_real_min', v_s.total_real_min), 'depois', jsonb_build_object('entrada', v_entrada, 'saida_intervalo', v_saida_intervalo, 'retorno_intervalo', v_retorno_intervalo, 'saida', v_saida, 'total_real_min', v_total)));
  PERFORM public.hora_extra_validar(p_id, true, NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_escala_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_escala_salvar(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_salvar(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_liberar_com_horarios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_liberar_com_horarios(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_validar_com_horarios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_validar_com_horarios(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."HORA_EXTRA_ESCALA" DROP COLUMN IF EXISTS nao_aplicavel_fins_semana;
-- ALTER TABLE public."HORA_EXTRA_SOLICITACAO"
--   DROP COLUMN IF EXISTS seguir_escala,
--   DROP COLUMN IF EXISTS sem_intervalo;
-- Reaplique as versões anteriores das RPCs nas migrations 00166, 00184,
-- 00186 e 00193 caso seja necessário voltar completamente o comportamento.
