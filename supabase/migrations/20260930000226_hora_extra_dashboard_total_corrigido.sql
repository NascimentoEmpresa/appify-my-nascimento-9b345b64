-- =====================================================================
-- HORA EXTRA — o dashboard passa a contar a HE pelo valor CORRIGIDO.
--
-- Reclamação do gestor (23/09/2026): ele corrige o ponto de uma HE de 4h
-- para 2h e "no resto do sistema continua como se fossem 4h".
--
-- Causa: a solicitação tem dois totais —
--   * total_previsto_min: o pedido (ou o ajuste da liberação, mig 186);
--   * total_real_min:     o ponto efetivo, gravado na conclusão e reescrito
--                         pelo gestor na validação (mig 193) ou depois de
--                         concluída (mig 215).
-- As correções de validação/pós-conclusão só mexem no REAL, e a maior parte
-- das telas somava o PREVISTO. Os modais já mostravam o valor certo; as
-- listas, os cards da liberação e estes gráficos, não.
--
-- Regra única (a mesma de minutosHeEfetivos() em horaExtraUtils.ts, do
-- Portal do Colaborador e do Dashboard do Desenvolvedor):
--     coalesce(total_real_min, total_previsto_min)
--
-- O que muda aqui — gráficos que respondem "quanto de HE":
--   HE por colaborador, HE por motivo, HE por dia da semana, Status das HEs.
-- O que NÃO muda — tudo que existe para comparar pedido x feito:
--   card "HE aprovadas" e "HE realizadas", série "Previsto x Realizado" e as
--   colunas aprovadas/realizadas da efetividade. Trocar o previsto ali pelo
--   corrigido faria "aprovado" e "realizado" virarem o mesmo número.
--
-- Só redefine a função: tabela, policy e permissão ficam como a mig 201
-- deixou. Frontend e esta migration são independentes — qualquer ordem
-- de aplicação funciona.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.hora_extra_dashboard(
  p_inicio date,
  p_fim date,
  p_empresa text DEFAULT NULL,
  p_setor text DEFAULT NULL,
  p_colaborador uuid DEFAULT NULL,
  p_meses integer DEFAULT 4
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
    JOIN public."CHAMADO_SISTEMA" ch ON ch.id = c.chamado_id
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
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente, se necessário)
--   Reaplicar o bloco "4) A consulta da tela" da mig
--   20260930000201_hora_extra_dashboard.sql (CREATE OR REPLACE da mesma
--   assinatura; grants não mudam) e depois:
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
