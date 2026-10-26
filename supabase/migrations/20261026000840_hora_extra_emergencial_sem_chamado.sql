-- =========================================================================
-- SISTEMAS › HORA EXTRA — "EMERGENCIAL, SEM CHAMADO" NA SOLICITAÇÃO
-- (26/10/2026)
--
-- PEDIDO: "quando for criar uma solicitação de hora extra e não tiver nenhum
-- chamado, que no modal dos chamados tenha uma opção: emergencial, sem
-- chamado".
--
-- O ajuste que entra direto em produção não nasce de chamado: quando o
-- sistema cai às 22h, ninguém abre chamado para si mesmo antes de consertar.
-- Até aqui "Adicionar chamado" era o único caminho e hora_extra_salvar
-- recusava a solicitação sem nenhum ("Adicione pelo menos um chamado."), de
-- modo que essa HE simplesmente não tinha como ser lançada.
--
-- AGORA a solicitação aceita UMA linha sem chamado:
--   · chamado_id NULL, chamado_numero 'SEM-CHAMADO' e assunto
--     'Emergencial, sem chamado' — o mesmo vocabulário que a PR sem chamado
--     já usava desde a mig 20261008000009, agora também no PLANEJADO;
--   · é EXCLUSIVA: com ela não entra chamado nenhum na mesma HE, senão o
--     relatório da conclusão teria uma linha sem o que comprovar ao lado das
--     que têm;
--   · o tipo da HE vira 'emergencial' no próprio banco — é por ele que o
--     gestor reconhece a HE na fila de liberação;
--   · hora_extra_concluir casava a PR da linha planejada com
--     "chamado_id = v_pr.chamado_id". Com os dois lados NULL isso nunca é
--     verdade: a linha não recebia a PR e a conclusão morria em "A PR #N não
--     pertence ao chamado original informado nesta HE". Virou
--     IS NOT DISTINCT FROM.
--
-- O CHECK hora_extra_chamado_sem_chamado_so_adicional (mig 20261008000009)
-- amarrava "sem chamado" a "linha adicional" e por isso sai; no lugar entra
-- um CHECK que continua exigindo coerência — sem chamado_id, o número é
-- 'SEM-CHAMADO' — e um índice que garante UMA só linha planejada sem chamado
-- por solicitação (o índice parcial de unicidade por chamado não vale para
-- NULL, que é sempre distinto de NULL).
--
-- Nada muda para quem lança HE com chamado. Idempotente.
-- =========================================================================

-- ── 1) Tabela: sem chamado também no planejado ──────────────────────────
-- Normaliza antes de criar o CHECK: a única origem de linha sem chamado era
-- a conclusão, que já gravava 'SEM-CHAMADO', mas o UPDATE deixa a criação da
-- constraint determinística em vez de depender disso.
UPDATE public."HORA_EXTRA_CHAMADO"
   SET chamado_numero = 'SEM-CHAMADO'
 WHERE chamado_id IS NULL
   AND coalesce(chamado_numero, '') <> 'SEM-CHAMADO';

ALTER TABLE public."HORA_EXTRA_CHAMADO"
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_sem_chamado_so_adicional;
ALTER TABLE public."HORA_EXTRA_CHAMADO"
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_sem_chamado_numerado;
ALTER TABLE public."HORA_EXTRA_CHAMADO"
  ADD CONSTRAINT hora_extra_chamado_sem_chamado_numerado
  CHECK (chamado_id IS NOT NULL OR chamado_numero = 'SEM-CHAMADO');

CREATE UNIQUE INDEX IF NOT EXISTS idx_hora_extra_chamado_planejado_sem_chamado
  ON public."HORA_EXTRA_CHAMADO" (solicitacao_id)
  WHERE NOT adicional AND chamado_id IS NULL;

COMMENT ON COLUMN public."HORA_EXTRA_CHAMADO".chamado_id IS
  'Nulo na PR sem chamado (adicional, mig 20261008000009) e na HE emergencial aberta sem chamado (planejada, mig 20261026000840).';

-- ── 2) Solicitação ──────────────────────────────────────────────────────
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
  v_sem_chamado boolean;
  v_tipo text;
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

  -- "Emergencial, sem chamado": a linha chega com chamado_id nulo/vazio. É
  -- exclusiva de propósito — HE aberta sem chamado não mistura com chamado,
  -- senão o relatório da conclusão teria uma linha sem o que comprovar ao
  -- lado das que têm. E o tipo passa a emergencial aqui no banco, não só na
  -- tela: é por ele que o gestor reconhece a HE na fila de liberação.
  v_sem_chamado := EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p->'chamados') x
    WHERE nullif(btrim(coalesce(x->>'chamado_id', '')), '') IS NULL
  );
  IF v_sem_chamado AND jsonb_array_length(p->'chamados') > 1 THEN
    RAISE EXCEPTION
      'A HE emergencial sem chamado não aceita chamado junto: deixe só a linha "Emergencial, sem chamado".';
  END IF;
  v_tipo := CASE
    WHEN v_sem_chamado THEN 'emergencial'
    ELSE coalesce(nullif(p->>'tipo', ''), 'normal')
  END;
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
    -- Sem chamado não há designação, status nem responsável para conferir.
    IF nullif(btrim(coalesce(v_item->>'chamado_id', '')), '') IS NOT NULL THEN
      PERFORM public.hora_extra_checar_chamado((v_item->>'chamado_id')::uuid, v_colaborador);
    END IF;
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
      tipo = v_tipo,
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
      (p->>'data_he')::date, v_tipo, v_entrada, v_saida_intervalo, v_retorno_intervalo,
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
    -- Sem chamado, o SELECT não acha linha nenhuma e o record vira todo NULL:
    -- os coalesce abaixo é que dão número, assunto e prioridade à linha.
    SELECT c.id, c.numero, c.assunto, c.setor, c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = nullif(btrim(coalesce(v_item->>'chamado_id', '')), '')::uuid;
    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id, chamado_id, chamado_numero, chamado_assunto, chamado_setor,
      prioridade, percentual_previsto
    ) VALUES (
      v_id, v_chamado.id,
      coalesce(v_chamado.numero, 'SEM-CHAMADO'),
      coalesce(v_chamado.assunto, 'Emergencial, sem chamado'),
      coalesce(v_chamado.setor, v_setor),
      coalesce(nullif(v_item->>'prioridade', ''), v_chamado.prioridade, 'alta'),
      (v_item->>'percentual_previsto')::numeric
    );
  END LOOP;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_salvar(jsonb) TO authenticated;

-- ── 3) Conclusão ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hora_extra_concluir(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid;
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_item jsonb;
  v_chamado record;
  v_jornada int;
  v_entrada time;
  v_saida_intervalo time;
  v_retorno_intervalo time;
  v_saida time;
  v_trabalhado int;
  v_total int;
  v_inicio time;
  v_pr public."HORA_EXTRA_PR_VALIDACAO"%ROWTYPE;
  v_linhas_adicionadas integer;
  v_commits integer;
  v_arquivos_adicionados integer;
  v_removidos jsonb;
  v_linhas jsonb := coalesce(p->'chamados', '[]'::jsonb) || coalesce(p->'adicionais', '[]'::jsonb);
BEGIN
  SELECT *
  INTO v_s
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = v_id
  FOR UPDATE;

  IF v_s.id IS NULL
  OR v_s.colaborador_id <> v_uid
  OR v_s.status <> 'aprovada' THEN
    RAISE EXCEPTION 'Esta HE não pode ser concluída por você.';
  END IF;

  IF v_s.data_he > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A HE só pode ser concluída na data prevista ou depois dela.';
  END IF;

  -- No lugar da antiga igualdade com o total de chamados originais: o
  -- relatório pode ser menor do que o planejado, mas nunca vazio.
  IF jsonb_array_length(v_linhas) = 0 THEN
    RAISE EXCEPTION 'Informe pelo menos um chamado realizado nesta hora extra.';
  END IF;

  IF nullif(btrim(p->>'resumo_conclusao'), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha o resumo e observações.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_linhas) x
    WHERE coalesce(x->>'pr_numero', '') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'Informe e valide uma PR do GitHub para cada chamado realizado na HE.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT x->>'pr_numero' AS pr_numero
      FROM jsonb_array_elements(v_linhas) x
    ) prs
    GROUP BY pr_numero
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A mesma PR não pode ser vinculada a mais de um chamado nesta HE.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_linhas) x
    WHERE nullif(x->>'percentual_concluido', '') IS NULL
       OR (x->>'percentual_concluido')::numeric < 0
       OR (x->>'percentual_concluido')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'O percentual concluído de cada chamado deve ficar entre 0%% e 100%%.';
  END IF;

  v_jornada := coalesce(
    v_s.jornada_minutos,
    (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1)
  );

  v_entrada := (p->>'ponto_entrada_real')::time;
  v_saida_intervalo := (p->>'ponto_saida_intervalo_real')::time;
  v_retorno_intervalo := (p->>'ponto_retorno_intervalo_real')::time;
  v_saida := (p->>'ponto_saida_real')::time;

  v_trabalhado := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  v_total := public.hora_extra_excedente(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );
  v_inicio := public.hora_extra_inicio(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );

  IF v_total <= 0 THEN
    RAISE EXCEPTION
      'Os horários informados somam %, dentro da jornada de %. Não há hora extra a registrar.',
      public.hora_extra_formatar_minutos(v_trabalhado),
      public.hora_extra_formatar_minutos(v_jornada);
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    ponto_entrada_real = v_entrada,
    ponto_saida_intervalo_real = v_saida_intervalo,
    ponto_retorno_intervalo_real = v_retorno_intervalo,
    ponto_saida_real = v_saida,
    trabalhado_real_min = v_trabalhado,
    he_inicio_real = v_inicio,
    he_fim_real = v_saida,
    total_real_min = v_total,
    resumo_conclusao = btrim(p->>'resumo_conclusao'),
    status = 'aguardando_validacao',
    conclusao_enviada_em = now(),
    motivo_devolucao = NULL
  WHERE id = v_id;

  -- Chamados originais que a pessoa tirou da tabela antes de enviar.
  -- A comparação é por texto de propósito: id vazio ou com lixo vindo do
  -- navegador não pode derrubar a transação num cast de uuid — a linha
  -- simplesmente não casa com nenhuma e é tratada como removida.
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'chamado', c.chamado_numero,
               'assunto', c.chamado_assunto
             )
             ORDER BY c.chamado_numero
           ),
           '[]'::jsonb
         )
  INTO v_removidos
  FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.adicional = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb)) x
      WHERE btrim(coalesce(x->>'id', '')) = c.id::text
    );

  DELETE FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.adicional = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb)) x
      WHERE btrim(coalesce(x->>'id', '')) = c.id::text
    );

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb))
  LOOP
    SELECT *
    INTO v_pr
    FROM public."HORA_EXTRA_PR_VALIDACAO"
    WHERE solicitacao_id = v_id
      AND pr_numero = (v_item->>'pr_numero')::integer;

    IF v_pr.id IS NULL THEN
      RAISE EXCEPTION 'A PR #% precisa ser consultada novamente antes do envio.', v_item->>'pr_numero';
    END IF;

    UPDATE public."HORA_EXTRA_CHAMADO"
    SET
      percentual_concluido = 100,
      status_execucao = 'concluido',
      observacao = nullif(btrim(v_item->>'observacao'), ''),
      pr_numero = v_pr.pr_numero,
      pr_url = v_pr.pr_url,
      pr_titulo = v_pr.pr_titulo,
      pr_linhas_adicionadas = v_pr.pr_linhas_adicionadas,
      pr_commits = v_pr.pr_commits,
      pr_arquivos_adicionados = v_pr.pr_arquivos_adicionados
    WHERE id = (v_item->>'id')::uuid
      AND solicitacao_id = v_id
      AND adicional = false
      -- HE emergencial sem chamado (26/10/2026): os dois lados são NULL e
      -- "= NULL" nunca casa, então a linha planejada nunca receberia a PR
      -- dela e a conclusão morria em "não pertence ao chamado original".
      AND chamado_id IS NOT DISTINCT FROM v_pr.chamado_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A PR #% não pertence ao chamado original informado nesta HE.', v_pr.pr_numero;
    END IF;
  END LOOP;

  DELETE FROM public."HORA_EXTRA_CHAMADO"
  WHERE solicitacao_id = v_id
    AND adicional = true;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'adicionais', '[]'::jsonb))
  LOOP
    SELECT *
    INTO v_pr
    FROM public."HORA_EXTRA_PR_VALIDACAO"
    WHERE solicitacao_id = v_id
      AND pr_numero = (v_item->>'pr_numero')::integer;

    IF v_pr.id IS NULL THEN
      RAISE EXCEPTION 'A PR #% precisa ser consultada novamente antes do envio.', v_item->>'pr_numero';
    END IF;

    -- 08/10/2026: PR sem chamado ([SEM-CHAMADO]) entra como linha adicional
    -- sem chamado — não há o que checar. Com chamado, a regra de sempre.
    IF v_pr.chamado_id IS NOT NULL THEN
      PERFORM public.hora_extra_checar_chamado(
        v_pr.chamado_id,
        v_uid,
        v_s.data_he
      );
    END IF;

    SELECT
      c.id,
      c.numero,
      c.assunto,
      c.setor,
      c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = v_pr.chamado_id;

    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id,
      chamado_id,
      chamado_numero,
      chamado_assunto,
      chamado_setor,
      prioridade,
      adicional,
      percentual_previsto,
      percentual_concluido,
      status_execucao,
      observacao,
      pr_numero,
      pr_url,
      pr_titulo,
      pr_linhas_adicionadas,
      pr_commits,
      pr_arquivos_adicionados
    )
    VALUES (
      v_id,
      v_chamado.id,
      coalesce(v_chamado.numero, 'SEM-CHAMADO'),
      coalesce(
        v_chamado.assunto,
        nullif(btrim(regexp_replace(v_pr.pr_titulo, '^\s*\[?\s*SEM[- ]CHAMADO\s*\]?\s*:?\s*', '', 'i')), ''),
        v_pr.pr_titulo
      ),
      v_chamado.setor,
      coalesce(v_chamado.prioridade, 'baixa'),
      true,
      NULL,
      100,
      'concluido',
      nullif(btrim(v_item->>'observacao'), ''),
      v_pr.pr_numero,
      v_pr.pr_url,
      v_pr.pr_titulo,
      v_pr.pr_linhas_adicionadas,
      v_pr.pr_commits,
      v_pr.pr_arquivos_adicionados
    );
  END LOOP;

  SELECT
    coalesce(sum(c.pr_linhas_adicionadas), 0),
    coalesce(sum(c.pr_commits), 0),
    coalesce(sum(c.pr_arquivos_adicionados), 0)
  INTO v_linhas_adicionadas, v_commits, v_arquivos_adicionados
  FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.pr_numero IS NOT NULL;

  INSERT INTO public."HORA_EXTRA_EVENTO" (
    solicitacao_id,
    autor_id,
    acao,
    texto,
    meta
  )
  VALUES (
    v_id,
    v_uid,
    'concluida',
    'Conclusão enviada para validação',
    jsonb_build_object(
      'prs', (SELECT count(*) FROM jsonb_array_elements(v_linhas)),
      'linhas_adicionadas', v_linhas_adicionadas,
      'commits', v_commits,
      'arquivos_adicionados', v_arquivos_adicionados,
      'chamados_removidos', v_removidos
    )
  );

  DELETE FROM public."HORA_EXTRA_PR_VALIDACAO"
  WHERE solicitacao_id = v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.hora_extra_concluir(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_concluir(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP INDEX IF EXISTS public.idx_hora_extra_chamado_planejado_sem_chamado;
-- ALTER TABLE public."HORA_EXTRA_CHAMADO"
--   DROP CONSTRAINT IF EXISTS hora_extra_chamado_sem_chamado_numerado;
-- -- Só volta se não houver HE emergencial sem chamado já lançada:
-- -- ALTER TABLE public."HORA_EXTRA_CHAMADO"
-- --   ADD CONSTRAINT hora_extra_chamado_sem_chamado_so_adicional
-- --   CHECK (chamado_id IS NOT NULL OR adicional);
-- Reaplique public.hora_extra_salvar(jsonb) da migration
-- 20261014000022_hora_extra_feriado.sql e public.hora_extra_concluir(jsonb)
-- da migration 20261008000009_hora_extra_pr_repetida_e_sem_chamado.sql.
