-- =====================================================================
-- SIS-2026-0474 — DASHBOARD DE HORA EXTRA
--
-- Tela nova em /app/sistemas/hora-extra/liberacao/dashboards, aberta pelo
-- botão "Dashboard" da Liberação de HE. Menu próprio
-- (`sistemas_hora_extra_dashboard`): liberar a Liberação NÃO abre o
-- dashboard, e o contrário também não — quem só enxerga as próprias HEs
-- continua vendo só as próprias aqui dentro, porque a visibilidade de
-- linha repete a regra do módulo (dono OU `aprovar` em
-- `sistemas_hora_extra`).
--
-- Tudo o que a tela mostra sai de UMA RPC (`hora_extra_dashboard`): são
-- oito recortes do mesmo conjunto de solicitações e fazer oito consultas
-- do navegador significaria oito vezes a mesma varredura com a mesma RLS.
-- =====================================================================

-- 1) Menu e ações ------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    (
      'sistemas_hora_extra_dashboard',
      'Hora Extra — Dashboard',
      '/app/sistemas/hora-extra/liberacao/dashboards',
      32
    )
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sistemas_hora_extra_dashboard', 'exportar')
ON CONFLICT DO NOTHING;

-- Menu novo nasce aberto quando ninguém semeia regra. Semeando aqui os
-- perfis `concede_tudo`, o deny-by-default do ERP passa a valer para o
-- resto — quem precisar do dashboard é liberado a dedo em
-- /app/administracao?tab=modulos.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu_codigo, x.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('sistemas_hora_extra_dashboard', 'visualizar'::public.app_acao),
    ('sistemas_hora_extra_dashboard', 'exportar'::public.app_acao)
 ) AS x(menu_codigo, acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) Parâmetro do custo estimado --------------------------------------
-- O KPI "Custo estimado" precisa de um valor-hora, e não existe salário
-- nem tabela de remuneração no ERP. Linha única (id = 1) para o RH ajustar
-- sem migration nova:
--
--   UPDATE public."HORA_EXTRA_PARAMETRO" SET valor_hora = 85.00 WHERE id = 1;
--
-- Nasce em 0 de propósito: a tela mostra "—" enquanto ninguém definiu o
-- valor, em vez de inventar um número que viraria decisão de gestão.
CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_PARAMETRO" (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  valor_hora numeric(10, 2) NOT NULL DEFAULT 0 CHECK (valor_hora >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."HORA_EXTRA_PARAMETRO" (id, valor_hora)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_hora_extra_parametro_updated_at ON public."HORA_EXTRA_PARAMETRO";
CREATE TRIGGER trg_hora_extra_parametro_updated_at
  BEFORE UPDATE ON public."HORA_EXTRA_PARAMETRO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."HORA_EXTRA_PARAMETRO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hora_extra_parametro_select ON public."HORA_EXTRA_PARAMETRO";
CREATE POLICY hora_extra_parametro_select ON public."HORA_EXTRA_PARAMETRO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar'));

-- Sem policy de UPDATE/INSERT: o valor-hora é decisão de gestão e muda
-- pelo SQL Editor, não por tela.

-- 3) Variação percentual contra a janela anterior ----------------------
CREATE OR REPLACE FUNCTION public.hora_extra_variacao(
  p_atual numeric,
  p_anterior numeric
)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
  -- Sem base de comparação não existe "+100%": o card mostra
  -- "Sem alteração" quando a variação é 0, e é isso que queremos ver no
  -- primeiro mês de uso do módulo.
  SELECT CASE
    WHEN coalesce(p_anterior, 0) = 0 THEN 0
    ELSE round((coalesce(p_atual, 0) - p_anterior) * 100.0 / p_anterior)
  END;
$$;

-- 4) A consulta da tela ------------------------------------------------
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
  por_colaborador AS (
    SELECT
      colaborador_id,
      colaborador_nome AS nome,
      coalesce(sum(total_previsto_min) FILTER (
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
      sum(p.total_previsto_min::numeric / q.qtd) AS minutos
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
      coalesce(sum(total_previsto_min) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ), 0) AS minutos
    FROM periodo
    GROUP BY 1
  ),
  -- Rosca "Status das HEs": as três fatias particionam exatamente o total
  -- de HE aprovada do período — o mesmo número do primeiro card.
  status_he AS (
    SELECT
      coalesce(sum(p.total_previsto_min) FILTER (
        WHERE p.status = 'aguardando_validacao'
           OR (p.status = 'aprovada' AND p.data_he >= x.hoje_sp)
      ), 0) AS aprovadas_min,
      coalesce(sum(p.total_previsto_min) FILTER (WHERE p.status = 'concluida'), 0) AS concluidas_min,
      coalesce(sum(p.total_previsto_min) FILTER (
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

REVOKE ALL ON FUNCTION public.hora_extra_dashboard(date, date, text, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_dashboard(date, date, text, text, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_variacao(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_variacao(numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente, se necessário)
--   DROP FUNCTION IF EXISTS public.hora_extra_dashboard(date, date, text, text, uuid, integer);
--   DROP FUNCTION IF EXISTS public.hora_extra_variacao(numeric, numeric);
--   DROP POLICY IF EXISTS hora_extra_parametro_select ON public."HORA_EXTRA_PARAMETRO";
--   DROP TRIGGER IF EXISTS trg_hora_extra_parametro_updated_at ON public."HORA_EXTRA_PARAMETRO";
--   DROP TABLE IF EXISTS public."HORA_EXTRA_PARAMETRO";
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sistemas_hora_extra_dashboard';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sistemas_hora_extra_dashboard';
--   DELETE FROM public.app_menu WHERE codigo = 'sistemas_hora_extra_dashboard';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
