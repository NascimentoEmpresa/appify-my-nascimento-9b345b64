-- =========================================================================
-- SISTEMAS › HORA EXTRA — MAIS DE UMA PR POR CHAMADO E PR SEM CHAMADO (08/10/2026)
--
-- PEDIDO (Pablo): "no sistema de H.E tem que aceitar 2x PR do mesmo
-- chamado, às vezes eu lanço mais de uma PR pro mesmo chamado; tem que
-- aceitar PRs sem chamado também".
--
-- O relatório da conclusão é UMA LINHA POR PR. Até aqui também era uma
-- linha por chamado: UNIQUE (solicitacao_id, chamado_id) e a tela
-- recusava "O chamado #… já está listado nesta HE." — a segunda PR do
-- mesmo chamado não tinha onde entrar. E a Edge hora-extra-pr-info exigia o
-- título começando por SIS-AAAA-NNNN: PR [SEM-CHAMADO] não entrava.
--
-- AGORA:
--   · a mesma PR continua não podendo aparecer duas vezes na HE
--     (idx_hora_extra_chamado_solicitacao_pr, intocado);
--   · o mesmo chamado pode ter várias linhas — uma por PR. Só os chamados
--     PLANEJADOS (adicional = false) seguem únicos, como a solicitação os
--     criou (índice parcial no lugar da constraint);
--   · PR sem chamado entra como linha ADICIONAL com chamado_id NULL,
--     chamado_numero 'SEM-CHAMADO' e o título da PR (sem o prefixo) como
--     assunto. Só adicional pode ficar sem chamado (CHECK);
--   · HORA_EXTRA_PR_VALIDACAO.chamado_id aceita NULL (a Edge grava a
--     validação da PR sem chamado);
--   · hora_extra_concluir: corpo vivo + só pula a checagem do chamado
--     quando não há chamado e preenche número/assunto/prioridade;
--   · hora_extra_dashboard: corpo vivo + LEFT JOIN no gráfico de motivos (a
--     linha sem chamado vai para "outro"). As contagens de chamados já usam
--     count(DISTINCT chamado_id), que ignora NULL e não conta repetido.
-- A Edge hora-extra-pr-info muda junto (deploy à parte).
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Tabelas ───────────────────────────────────────────────────────────
ALTER TABLE public."HORA_EXTRA_CHAMADO" DROP CONSTRAINT IF EXISTS "HORA_EXTRA_CHAMADO_solicitacao_id_chamado_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS idx_hora_extra_chamado_planejado_unico
  ON public."HORA_EXTRA_CHAMADO" (solicitacao_id, chamado_id) WHERE NOT adicional;

ALTER TABLE public."HORA_EXTRA_CHAMADO" ALTER COLUMN chamado_id DROP NOT NULL;
ALTER TABLE public."HORA_EXTRA_CHAMADO" DROP CONSTRAINT IF EXISTS hora_extra_chamado_sem_chamado_so_adicional;
ALTER TABLE public."HORA_EXTRA_CHAMADO" ADD CONSTRAINT hora_extra_chamado_sem_chamado_so_adicional
  CHECK (chamado_id IS NOT NULL OR adicional);

ALTER TABLE public."HORA_EXTRA_PR_VALIDACAO" ALTER COLUMN chamado_id DROP NOT NULL;

-- ── 2) Conclusão ────────────────────────────────────────────────────────
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
      AND chamado_id = v_pr.chamado_id;

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

-- ── 3) Dashboard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hora_extra_dashboard(p_inicio date, p_fim date, p_empresa text DEFAULT NULL::text, p_setor text DEFAULT NULL::text, p_colaborador uuid DEFAULT NULL::uuid, p_meses integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH parametros AS (
    SELECT
      (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje_sp,
      coalesce((SELECT valor_hora FROM public."HORA_EXTRA_PARAMETRO" WHERE id = 1), 0) AS valor_hora,
      public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar') AS gestor,
      date_trunc('month', p_fim::timestamp)::date AS mes_fim,
      (p_fim - p_inicio + 1) AS dias_janela
  ),
  -- Tudo que este usuário pode enxergar, ainda SEM os filtros da tela:
  -- os selects de Empresa/Setor/Colaborador saem daqui, senão escolher
  -- "Sistemas" apagaria os outros setores da própria lista.
  base AS (
    SELECT s.*
      FROM public."HORA_EXTRA_SOLICITACAO" s
     CROSS JOIN parametros x
     WHERE public.has_screen_access(auth.uid(), 'sistemas_hora_extra_dashboard', 'visualizar')
       AND (s.colaborador_id = auth.uid() OR x.gestor)
  ),
  base_periodo AS (
    SELECT * FROM base WHERE data_he BETWEEN p_inicio AND p_fim
  ),
  filtrada AS (
    SELECT *
      FROM base
     WHERE (p_empresa IS NULL OR empresa = p_empresa)
       AND (p_setor IS NULL OR setor = p_setor)
       AND (p_colaborador IS NULL OR colaborador_id = p_colaborador)
  ),
  periodo AS (
    SELECT * FROM filtrada WHERE data_he BETWEEN p_inicio AND p_fim
  ),
  -- Janela anterior do mesmo tamanho, imediatamente antes: é ela que
  -- gera o "em relação ao mês anterior" dos cards.
  anterior AS (
    SELECT f.*
      FROM filtrada f
     CROSS JOIN parametros x
     WHERE f.data_he BETWEEN (p_inicio - x.dias_janela) AND (p_inicio - 1)
  ),
  totais_periodo AS (
    SELECT
      coalesce(sum(p.total_previsto_min) FILTER (
        WHERE p.status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0)::numeric AS aprovadas_min,
      coalesce(sum(p.total_real_min) FILTER (
        WHERE p.status IN ('aguardando_validacao', 'concluida')
      ), 0)::numeric AS realizadas_min,
      count(*) FILTER (
        WHERE p.status = 'aprovada' AND p.data_he < x.hoje_sp
      )::numeric AS pendentes,
      count(DISTINCT p.colaborador_id)::numeric AS colaboradores
    FROM periodo p
    CROSS JOIN parametros x
  ),
  totais_anterior AS (
    SELECT
      coalesce(sum(total_previsto_min) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0)::numeric AS aprovadas_min,
      coalesce(sum(total_real_min) FILTER (
        WHERE status IN ('aguardando_validacao', 'concluida')
      ), 0)::numeric AS realizadas_min,
      count(*) FILTER (WHERE status = 'aprovada')::numeric AS pendentes,
      count(DISTINCT colaborador_id)::numeric AS colaboradores
    FROM anterior
  ),
  chamados_periodo AS (
    SELECT count(DISTINCT c.chamado_id)::numeric AS chamados
      FROM periodo p
      JOIN public."HORA_EXTRA_CHAMADO" c ON c.solicitacao_id = p.id
  ),
  chamados_anterior AS (
    SELECT count(DISTINCT c.chamado_id)::numeric AS chamados
      FROM anterior a
      JOIN public."HORA_EXTRA_CHAMADO" c ON c.solicitacao_id = a.id
  ),
  -- Os últimos `p_meses` meses terminando no mês de p_fim, inclusive os
  -- vazios: um mês sem hora extra tem que aparecer como zero na linha, não
  -- sumir do eixo e fingir que a série inteira é crescente.
  meses AS (
    SELECT (x.mes_fim - (n || ' months')::interval)::date AS mes
      FROM parametros x,
           generate_series(greatest(coalesce(p_meses, 4), 1) - 1, 0, -1) AS n
  ),
  serie AS (
    SELECT
      m.mes,
      coalesce(sum(f.total_previsto_min) FILTER (
        WHERE f.status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0) AS previsto_min,
      coalesce(sum(f.total_real_min) FILTER (
        WHERE f.status IN ('aguardando_validacao', 'concluida')
      ), 0) AS realizado_min
    FROM meses m
    LEFT JOIN filtrada f ON date_trunc('month', f.data_he::timestamp)::date = m.mes
    GROUP BY m.mes
  ),
  -- ── A partir daqui, "quanto de HE esta solicitação tem" é
  -- coalesce(total_real_min, total_previsto_min) — ver o cabeçalho da
  -- mig 226. Os cards/série/tabela acima que comparam PREVISTO x
  -- REALIZADO continuam lendo cada coluna pelo nome, de propósito.
  por_colaborador AS (
    SELECT
      colaborador_id,
      colaborador_nome AS nome,
      coalesce(sum(coalesce(total_real_min, total_previsto_min)) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0) AS minutos
    FROM periodo
    GROUP BY colaborador_id, colaborador_nome
  ),
  -- "HE por motivo" usa o tipo de solicitação do chamado trabalhado. Uma
  -- HE pode cobrir vários chamados e os minutos são da HE, não de cada
  -- chamado: o total é dividido em partes iguais entre os chamados dela,
  -- senão uma HE de 2h com três chamados viraria 6h no gráfico.
  motivos AS (
    SELECT
      coalesce(nullif(ch.tipo_solicitacao, ''), 'outro') AS motivo,
      sum(coalesce(p.total_real_min, p.total_previsto_min)::numeric / q.qtd) AS minutos
    FROM periodo p
    JOIN (
      SELECT solicitacao_id, count(*)::numeric AS qtd
        FROM public."HORA_EXTRA_CHAMADO"
       GROUP BY solicitacao_id
    ) q ON q.solicitacao_id = p.id
    JOIN public."HORA_EXTRA_CHAMADO" c ON c.solicitacao_id = p.id
    -- 08/10/2026: linha de PR sem chamado entra em "outro" (antes o JOIN
    -- a descartava e a fatia dela sumia do gráfico).
    LEFT JOIN public."CHAMADO_SISTEMA" ch ON ch.id = c.chamado_id
    WHERE p.status IN ('aprovada', 'aguardando_validacao', 'concluida')
    GROUP BY 1
  ),
  dias_semana AS (
    SELECT
      extract(isodow FROM data_he)::int AS dia, -- 1 = segunda ... 7 = domingo
      coalesce(sum(coalesce(total_real_min, total_previsto_min)) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0) AS minutos
    FROM periodo
    GROUP BY 1
  ),
  -- Rosca "Status das HEs": as três fatias particionam as HEs liberadas
  -- do período, cada uma pelo quanto vale hoje (real se houver, senão o
  -- previsto). Desde a mig 226 o total NÃO é mais o número do primeiro
  -- card: a fatia "Concluídas" mostra a hora validada, não a pedida.
  status_he AS (
    SELECT
      coalesce(sum(coalesce(p.total_real_min, p.total_previsto_min)) FILTER (
        WHERE p.status = 'aguardando_validacao'
           OR (p.status = 'aprovada' AND p.data_he >= x.hoje_sp)
      ), 0) AS aprovadas_min,
      coalesce(sum(coalesce(p.total_real_min, p.total_previsto_min)) FILTER (WHERE p.status = 'concluida'), 0) AS concluidas_min,
      coalesce(sum(coalesce(p.total_real_min, p.total_previsto_min)) FILTER (
        WHERE p.status = 'aprovada' AND p.data_he < x.hoje_sp
      ), 0) AS pendentes_min
    FROM periodo p
    CROSS JOIN parametros x
  ),
  chamados_colaborador AS (
    SELECT
      p.colaborador_id,
      count(DISTINCT c.chamado_id) AS chamados,
      coalesce(round(avg(c.percentual_concluido) FILTER (
        WHERE c.percentual_concluido IS NOT NULL
      )), 0) AS conclusao_media
    FROM periodo p
    JOIN public."HORA_EXTRA_CHAMADO" c ON c.solicitacao_id = p.id
    GROUP BY p.colaborador_id
  ),
  efetividade AS (
    SELECT
      p.colaborador_id,
      p.colaborador_nome AS nome,
      count(*) AS qtd,
      coalesce(sum(p.total_previsto_min) FILTER (
        WHERE p.status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0) AS aprovadas_min,
      coalesce(sum(p.total_real_min) FILTER (
        WHERE p.status IN ('aguardando_validacao', 'concluida')
      ), 0) AS realizadas_min,
      coalesce(max(cc.chamados), 0) AS chamados,
      coalesce(max(cc.conclusao_media), 0) AS conclusao_media
    FROM periodo p
    LEFT JOIN chamados_colaborador cc ON cc.colaborador_id = p.colaborador_id
    GROUP BY p.colaborador_id, p.colaborador_nome
  )
  SELECT jsonb_build_object(
    'valor_hora', (SELECT valor_hora FROM parametros),
    'indicadores', jsonb_build_object(
      'aprovadas_min', (SELECT aprovadas_min FROM totais_periodo),
      'aprovadas_variacao', public.hora_extra_variacao(
        (SELECT aprovadas_min FROM totais_periodo), (SELECT aprovadas_min FROM totais_anterior)),
      'realizadas_min', (SELECT realizadas_min FROM totais_periodo),
      'realizadas_variacao', public.hora_extra_variacao(
        (SELECT realizadas_min FROM totais_periodo), (SELECT realizadas_min FROM totais_anterior)),
      'pendentes_conclusao', (SELECT pendentes FROM totais_periodo),
      'pendentes_variacao', public.hora_extra_variacao(
        (SELECT pendentes FROM totais_periodo), (SELECT pendentes FROM totais_anterior)),
      'custo_estimado', round(
        (SELECT realizadas_min FROM totais_periodo) / 60.0 * (SELECT valor_hora FROM parametros), 2),
      'custo_variacao', public.hora_extra_variacao(
        (SELECT realizadas_min FROM totais_periodo), (SELECT realizadas_min FROM totais_anterior)),
      'colaboradores', (SELECT colaboradores FROM totais_periodo),
      'colaboradores_variacao', public.hora_extra_variacao(
        (SELECT colaboradores FROM totais_periodo), (SELECT colaboradores FROM totais_anterior)),
      'chamados', (SELECT chamados FROM chamados_periodo),
      'chamados_variacao', public.hora_extra_variacao(
        (SELECT chamados FROM chamados_periodo), (SELECT chamados FROM chamados_anterior))
    ),
    'por_colaborador', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', colaborador_id, 'nome', nome, 'minutos', minutos)
             ORDER BY minutos DESC, nome)
        FROM por_colaborador WHERE minutos > 0
    ), '[]'::jsonb),
    'evolucao', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'mes', to_char(mes, 'YYYY-MM'),
               'previsto_min', previsto_min,
               'realizado_min', realizado_min
             ) ORDER BY mes)
        FROM serie
    ), '[]'::jsonb),
    'por_motivo', coalesce((
      SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'minutos', round(minutos))
             ORDER BY minutos DESC, motivo)
        FROM motivos WHERE minutos > 0
    ), '[]'::jsonb),
    'por_dia_semana', coalesce((
      SELECT jsonb_agg(jsonb_build_object('dia', dia, 'minutos', minutos) ORDER BY dia)
        FROM dias_semana
    ), '[]'::jsonb),
    'status', (
      SELECT jsonb_build_object(
        'aprovadas_min', aprovadas_min,
        'concluidas_min', concluidas_min,
        'pendentes_min', pendentes_min,
        'total_min', aprovadas_min + concluidas_min + pendentes_min
      ) FROM status_he
    ),
    'efetividade', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', colaborador_id,
               'nome', nome,
               'qtd', qtd,
               'aprovadas_min', aprovadas_min,
               'realizadas_min', realizadas_min,
               'chamados', chamados,
               'conclusao_media', conclusao_media
             ) ORDER BY aprovadas_min DESC, nome)
        FROM efetividade
    ), '[]'::jsonb),
    'opcoes', jsonb_build_object(
      'empresas', coalesce((
        SELECT jsonb_agg(DISTINCT empresa) FROM base_periodo WHERE empresa IS NOT NULL AND empresa <> ''
      ), '[]'::jsonb),
      'setores', coalesce((
        SELECT jsonb_agg(DISTINCT setor) FROM base_periodo WHERE setor IS NOT NULL AND setor <> ''
      ), '[]'::jsonb),
      'colaboradores', coalesce((
        SELECT jsonb_agg(DISTINCT jsonb_build_object('id', colaborador_id, 'nome', colaborador_nome))
          FROM base_periodo
      ), '[]'::jsonb)
    )
  );
$function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (antes, apagar/ajustar as linhas com chamado repetido ou sem chamado)
-- DROP INDEX IF EXISTS public.idx_hora_extra_chamado_planejado_unico;
-- ALTER TABLE public."HORA_EXTRA_CHAMADO" ADD CONSTRAINT "HORA_EXTRA_CHAMADO_solicitacao_id_chamado_id_key" UNIQUE (solicitacao_id, chamado_id);
-- ALTER TABLE public."HORA_EXTRA_CHAMADO" DROP CONSTRAINT IF EXISTS hora_extra_chamado_sem_chamado_so_adicional;
-- ALTER TABLE public."HORA_EXTRA_CHAMADO" ALTER COLUMN chamado_id SET NOT NULL;
-- ALTER TABLE public."HORA_EXTRA_PR_VALIDACAO" ALTER COLUMN chamado_id SET NOT NULL;
-- hora_extra_concluir / hora_extra_dashboard: reaplicar as versões anteriores (mig 220 / 226).
