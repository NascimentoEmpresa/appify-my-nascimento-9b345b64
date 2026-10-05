-- =========================================================================
-- DIRETORIA E PRESIDÊNCIA › RELATÓRIOS (05/10/2026)
--
-- PEDIDO (Pablo): "um submódulo completo pra diretoria e presidência.
-- RELATÓRIO GERAL vai ter relatório de TODOS os sistemas de solicitações —
-- Gestão Recrutamento, Demissões, Materiais, Férias, Medida Disciplinar,
-- Chamados, Orientações Jurídicas, Mudança de Função, Colaboradores e
-- Turn-over —, gráfico pra tudo e I.A integrada pra gerar análises. Cada
-- sistema em particular vai ter seu relatório."
--
-- DESENHO
--   · Um menu por relatório (aparece em Acesso por Usuário › Diretoria),
--     todos nascem FECHADOS. Quem tem o Relatório Geral lê todos os sistemas
--     (o geral é a soma deles). A I.A é uma capacidade à parte
--     (diretoria_relatorios_ia, menu fantasma) — usa tokens de IA.
--   · Uma RPC por sistema, todas devolvendo o MESMO formato (a tela é uma só
--     e desenha qualquer relatório):
--       { titulo, periodo, kpis[{rotulo,valor,formato,tom,dica}],
--         mensal{series[{chave,rotulo}], dados[{mes,...}]},
--         por_status[{nome,n,grupo}], rankings[{titulo,itens[{nome,n}]}],
--         recentes{colunas[], linhas[]} }
--   · Os 8 sistemas de SOLICITAÇÃO passam por dir_rel_montar: cada um só diz
--     de onde vem a data, o status, o "grupo" (aberto/concluído/recusado) e
--     três dimensões de ranking. Colaboradores e Turn-over leem a EMPREGADOS
--     e têm montagem própria.
--   · Tudo SECURITY DEFINER, só leitura. Nenhuma tabela nova.
--
-- Períodos: _de/_ate (date). NULL = últimos 12 meses até hoje. A variação
-- compara com o período anterior de mesmo tamanho.
--
-- Materiais lê sup_pedido (Suprimentos) — só leitura, nada muda no módulo.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM (VALUES
    ('diretoria_relatorio_geral',       'Relatórios — Relatório Geral',        '/app/diretoria/relatorios',                     40),
    ('diretoria_rel_recrutamento',      'Relatórios — Gestão Recrutamento',    '/app/diretoria/relatorios/recrutamento',        41),
    ('diretoria_rel_demissoes',         'Relatórios — Demissões',              '/app/diretoria/relatorios/demissoes',           42),
    ('diretoria_rel_materiais',         'Relatórios — Materiais',              '/app/diretoria/relatorios/materiais',           43),
    ('diretoria_rel_ferias',            'Relatórios — Férias',                 '/app/diretoria/relatorios/ferias',              44),
    ('diretoria_rel_medida_disciplinar','Relatórios — Medida Disciplinar',     '/app/diretoria/relatorios/medida-disciplinar',  45),
    ('diretoria_rel_chamados',          'Relatórios — Chamados',               '/app/diretoria/relatorios/chamados',            46),
    ('diretoria_rel_orientacoes',       'Relatórios — Orientações Jurídicas',  '/app/diretoria/relatorios/orientacoes',         47),
    ('diretoria_rel_mudanca_funcao',    'Relatórios — Mudança de Função',      '/app/diretoria/relatorios/mudanca-funcao',      48),
    ('diretoria_rel_colaboradores',     'Relatórios — Colaboradores',          '/app/diretoria/relatorios/colaboradores',       49),
    ('diretoria_rel_turnover',          'Relatórios — Turn-over',              '/app/diretoria/relatorios/turnover',            50),
    ('diretoria_relatorios_ia',         'Relatórios — Análise com I.A',        NULL,                                            51)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'diretoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2) Acesso ────────────────────────────────────────────────────────────
-- O relatório do sistema OU o Relatório Geral (que mostra todos).
CREATE OR REPLACE FUNCTION public.dir_rel_exige(_menu text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_screen_access(auth.uid(), _menu, 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'diretoria_relatorio_geral', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso a este relatório' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_exige(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_exige(text) TO authenticated;

-- ── 3) Montagem padrão dos sistemas de solicitação ───────────────────────
-- _sql devolve UMA linha por solicitação com as colunas:
--   dt date, titulo text, status text, grupo text ('aberto'|'concluido'|'recusado'),
--   d1 text, d2 text, d3 text, dias numeric (tempo até concluir; NULL se não concluiu)
-- O texto vem SEMPRE das funções dir_rel_* abaixo (nunca do cliente).
CREATE OR REPLACE FUNCTION public.dir_rel_montar(
  _titulo text, _sql text, _de date, _ate date, _dims jsonb, _rotulo_item text DEFAULT 'solicitações')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_dur int;
  v_out jsonb;
BEGIN
  v_dur := (v_ate - v_de) + 1;
  EXECUTE 'CREATE TEMP TABLE IF NOT EXISTS _dir_base (dt date, titulo text, status text, grupo text, d1 text, d2 text, d3 text, dias numeric) ON COMMIT DROP';
  EXECUTE 'TRUNCATE _dir_base';
  EXECUTE 'INSERT INTO _dir_base ' || _sql;

  WITH p AS (SELECT * FROM _dir_base WHERE dt BETWEEN v_de AND v_ate),
  ant AS (SELECT count(*) n FROM _dir_base WHERE dt BETWEEN v_de - v_dur AND v_de - 1),
  meses AS (
    SELECT to_char(g, 'YYYY-MM') mes FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
  ),
  k AS (
    SELECT count(*) total,
           count(*) FILTER (WHERE grupo = 'aberto') abertos,
           count(*) FILTER (WHERE grupo = 'concluido') concluidos,
           count(*) FILTER (WHERE grupo = 'recusado') recusados,
           round(avg(dias) FILTER (WHERE grupo = 'concluido' AND dias >= 0), 1) tempo
      FROM p
  )
  SELECT jsonb_build_object(
    'titulo', _titulo,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Total no período', 'valor', k.total, 'formato', 'n', 'tom', 'primary',
                         'dica', CASE WHEN ant.n > 0 THEN round((k.total - ant.n) * 100.0 / ant.n)::text || '% vs período anterior (' || ant.n || ')' ELSE 'sem período anterior para comparar' END,
                         'variacao', CASE WHEN ant.n > 0 THEN round((k.total - ant.n) * 100.0 / ant.n, 1) END),
      jsonb_build_object('rotulo', 'Em andamento', 'valor', k.abertos, 'formato', 'n', 'tom', 'warning', 'dica', 'ainda não concluídas'),
      jsonb_build_object('rotulo', 'Concluídas', 'valor', k.concluidos, 'formato', 'n', 'tom', 'success',
                         'dica', CASE WHEN k.total > 0 THEN round(k.concluidos * 100.0 / k.total) || '% do total' END),
      jsonb_build_object('rotulo', 'Recusadas / canceladas', 'valor', k.recusados, 'formato', 'n', 'tom', 'destructive',
                         'dica', CASE WHEN k.total > 0 THEN round(k.recusados * 100.0 / k.total) || '% do total' END),
      jsonb_build_object('rotulo', 'Tempo médio até concluir', 'valor', k.tempo, 'formato', 'dias', 'tom', 'info', 'dica', 'da abertura à conclusão')
    ),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(
        jsonb_build_object('chave', 'total', 'rotulo', 'Abertas'),
        jsonb_build_object('chave', 'concluidos', 'rotulo', 'Concluídas'),
        jsonb_build_object('chave', 'recusados', 'rotulo', 'Recusadas')),
      'dados', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'mes', m.mes,
                  'total', (SELECT count(*) FROM p WHERE to_char(p.dt, 'YYYY-MM') = m.mes),
                  'concluidos', (SELECT count(*) FROM p WHERE to_char(p.dt, 'YYYY-MM') = m.mes AND grupo = 'concluido'),
                  'recusados', (SELECT count(*) FROM p WHERE to_char(p.dt, 'YYYY-MM') = m.mes AND grupo = 'recusado'))
                  ORDER BY m.mes), '[]'::jsonb) FROM meses m)),
    'por_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', s.status, 'n', s.n, 'grupo', s.grupo) ORDER BY s.n DESC), '[]'::jsonb)
                     FROM (SELECT COALESCE(NULLIF(btrim(status), ''), '(sem status)') status, max(grupo) grupo, count(*) n FROM p GROUP BY 1) s),
    'rankings', (SELECT COALESCE(jsonb_agg(r.obj ORDER BY r.ordem), '[]'::jsonb) FROM (
       SELECT 1 ordem, jsonb_build_object('titulo', _dims->>0, 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
              FROM (SELECT COALESCE(NULLIF(btrim(d1), ''), '(não informado)') nome, count(*) n FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)) obj
        WHERE _dims->>0 IS NOT NULL
       UNION ALL
       SELECT 2, jsonb_build_object('titulo', _dims->>1, 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
              FROM (SELECT COALESCE(NULLIF(btrim(d2), ''), '(não informado)') nome, count(*) n FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x))
        WHERE _dims->>1 IS NOT NULL
       UNION ALL
       SELECT 3, jsonb_build_object('titulo', _dims->>2, 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
              FROM (SELECT COALESCE(NULLIF(btrim(d3), ''), '(não informado)') nome, count(*) n FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x))
        WHERE _dims->>2 IS NOT NULL) r),
    'recentes', jsonb_build_object(
      'colunas', jsonb_build_array('Data', 'Solicitação', 'Status', COALESCE(_dims->>0, '—')),
      'linhas', (SELECT COALESCE(jsonb_agg(jsonb_build_array(to_char(x.dt, 'DD/MM/YYYY'), x.titulo, x.status, x.d1)), '[]'::jsonb)
                   FROM (SELECT * FROM p ORDER BY dt DESC NULLS LAST LIMIT 15) x)),
    'rotulo_item', _rotulo_item
  ) INTO v_out
  FROM k, ant;

  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_montar(text, text, date, date, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 4) Os 8 sistemas de solicitação ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dir_rel_recrutamento(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_recrutamento');
  RETURN public.dir_rel_montar('Gestão Recrutamento', $q$
    SELECT created_at::date, '#' || id || ' · ' || COALESCE(cargo, 'vaga') || COALESCE(' — ' || contrato, ''), status,
           CASE WHEN status IN ('Concluído', 'Contratado') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, cargo, motivo_vaga,
           CASE WHEN status IN ('Concluído', 'Contratado') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END
      FROM public."SISTEMA_RECRUTAMENTO" $q$,
    _de, _ate, '["Vagas por contrato", "Vagas por cargo", "Motivo da vaga"]'::jsonb, 'vagas');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_demissoes(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_demissoes');
  RETURN public.dir_rel_montar('Demissões', $q$
    SELECT COALESCE(data_solicitacao, criado_em::date), COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || colaborador_cargo, ''), status,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, COALESCE(motivo_solicitacao, motivo_pedido), colaborador_cargo,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído')
                THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" $q$,
    _de, _ate, '["Demissões por contrato", "Motivo da demissão", "Cargo"]'::jsonb, 'demissões');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_materiais(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_materiais');
  RETURN public.dir_rel_montar('Materiais', $q$
    SELECT COALESCE(data_solicitacao, created_at::date), 'Pedido ' || COALESCE(pedido_id::text, id::text) || COALESCE(' — ' || nome_colaborador, ''), status,
           CASE WHEN status IN ('DESPACHADO', 'RETIRADO PARA ENTREGA') THEN 'concluido'
                WHEN status = 'CANCELADO' THEN 'recusado' ELSE 'aberto' END,
           contrato_nome, tipo_pedido, funcao_nome,
           CASE WHEN data_despachado IS NOT NULL
                THEN extract(epoch FROM data_despachado - COALESCE(data_solicitacao::timestamptz, created_at)) / 86400 END
      FROM public.sup_pedido $q$,
    _de, _ate, '["Pedidos por contrato", "Tipo de pedido", "Função"]'::jsonb, 'pedidos');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_ferias(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_ferias');
  RETURN public.dir_rel_montar('Férias', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' · ' || dias_ferias || ' dias', ''), status,
           CASE WHEN status = 'Aprovada' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           colaborador_filial, colaborador_cargo, COALESCE(dias_ferias::text || ' dias', NULL),
           CASE WHEN status = 'Aprovada' AND aprovado_em IS NOT NULL THEN extract(epoch FROM aprovado_em - criado_em) / 86400 END
      FROM public."SISTEMA_SOLICITACOES_FERIAS" $q$,
    _de, _ate, '["Férias por filial/contrato", "Cargo", "Dias de férias"]'::jsonb, 'solicitações');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_medida_disciplinar(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_medida_disciplinar');
  RETURN public.dir_rel_montar('Medida Disciplinar', $q$
    SELECT created_at::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || tipo_advertencia, ''), status,
           CASE WHEN status IN ('Concluída', 'Registrada') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, tipo_advertencia, grau,
           CASE WHEN status IN ('Concluída', 'Registrada') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" $q$,
    _de, _ate, '["Medidas por contrato", "Tipo de medida", "Grau"]'::jsonb, 'medidas');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_chamados(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_chamados');
  RETURN public.dir_rel_montar('Chamados', $q$
    SELECT created_at::date, COALESCE(numero, '#' || id::text) || ' · ' || COALESCE(assunto, ''), status,
           CASE WHEN status = 'concluido' THEN 'concluido'
                WHEN status IN ('reprovado', 'cancelado') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(modulo_sistema, ''), modulo_sistema_outro), prioridade, setor,
           CASE WHEN status = 'concluido' AND concluido_em IS NOT NULL THEN extract(epoch FROM concluido_em - created_at) / 86400 END
      FROM public."CHAMADO_SISTEMA" $q$,
    _de, _ate, '["Chamados por módulo", "Prioridade", "Setor"]'::jsonb, 'chamados');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_orientacoes(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_orientacoes');
  RETURN public.dir_rel_montar('Orientações Jurídicas', $q$
    SELECT created_at::date, COALESCE(titulo, left(pergunta, 80)), status,
           CASE WHEN status = 'Respondida' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Recusada', 'Oculta', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           categoria, origem, autor_nome,
           CASE WHEN respondido_em IS NOT NULL THEN extract(epoch FROM respondido_em - created_at) / 86400 END
      FROM public."JUR_DUVIDAS" $q$,
    _de, _ate, '["Orientações por categoria", "Origem", "Quem perguntou"]'::jsonb, 'orientações');
END $$;

CREATE OR REPLACE FUNCTION public.dir_rel_mudanca_funcao(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_mudanca_funcao');
  RETURN public.dir_rel_montar('Mudança de Função', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || ': ' || COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'), status,
           CASE WHEN status = 'Concluída' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(setor, ''), filial), COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'),
           CASE WHEN e_escritorio THEN 'Escritório' ELSE 'Operação' END,
           CASE WHEN status = 'Concluída' THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END
      FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" $q$,
    _de, _ate, '["Por setor/filial", "De → para", "Escritório × operação"]'::jsonb, 'mudanças');
END $$;

-- ── 5) Colaboradores (retrato da EMPREGADOS) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.dir_rel_colaboradores(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_colaboradores');
  WITH e AS MATERIALIZED (
    SELECT e."Nome" nome, e."Situação" sit, e."Título do Cargo" cargo, e."Nome Filial" filial, e."Empresa"::text empresa,
           e."Sexo" sexo, COALESCE(NULLIF(btrim(e."Setor_ERP"), ''), '(sem setor)') setor,
           public.data_universal(e."Admissão") adm,
           CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento") END dem,
           public.esp_col_esta_ativo(e."Situação") ativo
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Nome"), '') <> ''
  ),
  meses AS (SELECT g::date ini, (g + interval '1 month' - interval '1 day')::date fim, to_char(g, 'YYYY-MM') mes
              FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g),
  a AS (SELECT count(*) FILTER (WHERE ativo) ativos,
               count(*) FILTER (WHERE sit = 'Trabalhando') trabalhando,
               count(*) FILTER (WHERE ativo AND sit <> 'Trabalhando' AND sit NOT ILIKE 'atestado%') afastados,
               count(*) FILTER (WHERE adm BETWEEN v_de AND v_ate) admitidos,
               count(*) FILTER (WHERE dem BETWEEN v_de AND v_ate) desligados
          FROM e)
  SELECT jsonb_build_object(
    'titulo', 'Colaboradores',
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Colaboradores ativos', 'valor', a.ativos, 'formato', 'n', 'tom', 'primary', 'dica', 'hoje, na EMPREGADOS'),
      jsonb_build_object('rotulo', 'Trabalhando', 'valor', a.trabalhando, 'formato', 'n', 'tom', 'success',
                         'dica', CASE WHEN a.ativos > 0 THEN round(a.trabalhando * 100.0 / a.ativos) || '% dos ativos' END),
      jsonb_build_object('rotulo', 'Afastados', 'valor', a.afastados, 'formato', 'n', 'tom', 'warning', 'dica', 'auxílio-doença, licença, férias…'),
      jsonb_build_object('rotulo', 'Admitidos no período', 'valor', a.admitidos, 'formato', 'n', 'tom', 'info'),
      jsonb_build_object('rotulo', 'Desligados no período', 'valor', a.desligados, 'formato', 'n', 'tom', 'destructive')
    ),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(
        jsonb_build_object('chave', 'ativos', 'rotulo', 'Ativos no fim do mês'),
        jsonb_build_object('chave', 'admitidos', 'rotulo', 'Admitidos'),
        jsonb_build_object('chave', 'desligados', 'rotulo', 'Desligados')),
      'dados', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'mes', m.mes,
                  -- Quadro no fim do mês: admitido até lá e não desligado até lá.
                  'ativos', (SELECT count(*) FROM e WHERE e.adm <= m.fim AND (e.dem IS NULL OR e.dem > m.fim) AND (e.ativo OR e.dem IS NOT NULL)),
                  'admitidos', (SELECT count(*) FROM e WHERE e.adm BETWEEN m.ini AND m.fim),
                  'desligados', (SELECT count(*) FROM e WHERE e.dem BETWEEN m.ini AND m.fim))
                  ORDER BY m.mes), '[]'::jsonb) FROM meses m)),
    'por_status', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.sit, 'n', x.n, 'grupo', CASE WHEN x.sit = 'Trabalhando' THEN 'concluido' ELSE 'aberto' END) ORDER BY x.n DESC), '[]'::jsonb)
                     FROM (SELECT sit, count(*) n FROM e WHERE ativo GROUP BY 1) x),
    'rankings', jsonb_build_array(
      jsonb_build_object('titulo', 'Ativos por contrato (filial)', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(filial, '(sem filial)') nome, count(*) n FROM e WHERE ativo GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Ativos por cargo', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(cargo, '(sem cargo)') nome, count(*) n FROM e WHERE ativo GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Ativos por setor', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT setor nome, count(*) n FROM e WHERE ativo GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Ativos por sexo', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT CASE upper(left(COALESCE(sexo, ''), 1)) WHEN 'M' THEN 'Masculino' WHEN 'F' THEN 'Feminino' ELSE '(não informado)' END nome, count(*) n FROM e WHERE ativo GROUP BY 1) x))
    ),
    'recentes', jsonb_build_object(
      'colunas', jsonb_build_array('Admissão', 'Colaborador', 'Situação', 'Contrato (filial)'),
      'linhas', (SELECT COALESCE(jsonb_agg(jsonb_build_array(to_char(x.adm, 'DD/MM/YYYY'), x.nome || COALESCE(' — ' || x.cargo, ''), x.sit, x.filial)), '[]'::jsonb)
                   FROM (SELECT * FROM e WHERE adm BETWEEN v_de AND v_ate ORDER BY adm DESC LIMIT 15) x)),
    'rotulo_item', 'colaboradores'
  ) INTO v_out FROM a;
  RETURN v_out;
END $$;

-- ── 6) Turn-over ─────────────────────────────────────────────────────────
-- Taxa mensal = ((admitidos + desligados) / 2) / ativos no início do mês.
-- "Desligado em até 90 dias" = turn-over precoce (contratação que não firmou).
CREATE OR REPLACE FUNCTION public.dir_rel_turnover(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  WITH e AS MATERIALIZED (
    SELECT e."Nome" nome, e."Título do Cargo" cargo, e."Nome Filial" filial,
           public.data_universal(e."Admissão") adm,
           CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento") END dem,
           public.esp_col_esta_ativo(e."Situação") ativo
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Nome"), '') <> ''
  ),
  m AS MATERIALIZED (
    SELECT to_char(g, 'YYYY-MM') mes, g::date ini, (g + interval '1 month' - interval '1 day')::date fim,
           (SELECT count(*) FROM e WHERE e.adm < g::date AND (e.dem IS NULL OR e.dem >= g::date) AND (e.ativo OR e.dem IS NOT NULL)) base,
           (SELECT count(*) FROM e WHERE e.adm BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) adm,
           (SELECT count(*) FROM e WHERE e.dem BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) dem
      FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
  ),
  t AS (SELECT sum(adm) adm, sum(dem) dem,
               round(avg(CASE WHEN base > 0 THEN (adm + dem) / 2.0 / base * 100 END), 2) taxa,
               (SELECT count(*) FROM e WHERE e.dem BETWEEN v_de AND v_ate AND e.adm IS NOT NULL AND e.dem - e.adm <= 90) precoce
          FROM m)
  SELECT jsonb_build_object(
    'titulo', 'Turn-over',
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Turn-over médio mensal', 'valor', t.taxa, 'formato', 'pct', 'tom', 'primary', 'dica', '((admitidos + desligados) ÷ 2) ÷ quadro do início do mês'),
      jsonb_build_object('rotulo', 'Admitidos', 'valor', t.adm, 'formato', 'n', 'tom', 'success'),
      jsonb_build_object('rotulo', 'Desligados', 'valor', t.dem, 'formato', 'n', 'tom', 'destructive'),
      jsonb_build_object('rotulo', 'Saldo (admitidos − desligados)', 'valor', t.adm - t.dem, 'formato', 'n', 'tom', CASE WHEN t.adm >= t.dem THEN 'success' ELSE 'destructive' END),
      jsonb_build_object('rotulo', 'Desligados em até 90 dias', 'valor', t.precoce, 'formato', 'n', 'tom', 'warning',
                         'dica', CASE WHEN t.dem > 0 THEN round(t.precoce * 100.0 / t.dem) || '% dos desligamentos — contratação que não firmou' END)
    ),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(
        jsonb_build_object('chave', 'admitidos', 'rotulo', 'Admitidos'),
        jsonb_build_object('chave', 'desligados', 'rotulo', 'Desligados'),
        jsonb_build_object('chave', 'taxa', 'rotulo', 'Turn-over (%)', 'eixo', 'direita')),
      'dados', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'admitidos', adm, 'desligados', dem,
                  'taxa', CASE WHEN base > 0 THEN round((adm + dem) / 2.0 / base * 100, 2) END) ORDER BY mes), '[]'::jsonb) FROM m)),
    'por_status', jsonb_build_array(
      jsonb_build_object('nome', 'Admitidos', 'n', t.adm, 'grupo', 'concluido'),
      jsonb_build_object('nome', 'Desligados', 'n', t.dem, 'grupo', 'recusado')),
    'rankings', jsonb_build_array(
      jsonb_build_object('titulo', 'Desligamentos por contrato (filial)', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(filial, '(sem filial)') nome, count(*) n FROM e WHERE dem BETWEEN v_de AND v_ate GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Desligamentos por cargo', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(cargo, '(sem cargo)') nome, count(*) n FROM e WHERE dem BETWEEN v_de AND v_ate GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Tempo de casa de quem saiu', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.ord), '[]'::jsonb)
         FROM (SELECT CASE WHEN dem - adm <= 90 THEN 'Até 3 meses' WHEN dem - adm <= 180 THEN '3 a 6 meses' WHEN dem - adm <= 365 THEN '6 meses a 1 ano'
                           WHEN dem - adm <= 730 THEN '1 a 2 anos' ELSE 'Mais de 2 anos' END nome,
                      min(CASE WHEN dem - adm <= 90 THEN 1 WHEN dem - adm <= 180 THEN 2 WHEN dem - adm <= 365 THEN 3 WHEN dem - adm <= 730 THEN 4 ELSE 5 END) ord,
                      count(*) n
                 FROM e WHERE dem BETWEEN v_de AND v_ate AND adm IS NOT NULL GROUP BY 1) x))
    ),
    'recentes', jsonb_build_object(
      'colunas', jsonb_build_array('Desligamento', 'Colaborador', 'Tempo de casa', 'Contrato (filial)'),
      'linhas', (SELECT COALESCE(jsonb_agg(jsonb_build_array(to_char(x.dem, 'DD/MM/YYYY'), x.nome || COALESCE(' — ' || x.cargo, ''),
                          CASE WHEN x.adm IS NULL THEN '—' ELSE (x.dem - x.adm) || ' dias' END, x.filial)), '[]'::jsonb)
                   FROM (SELECT * FROM e WHERE dem BETWEEN v_de AND v_ate ORDER BY dem DESC LIMIT 15) x)),
    'rotulo_item', 'movimentações'
  ) INTO v_out FROM t;
  RETURN v_out;
END $$;

-- ── 7) Relatório Geral: os 10 de uma vez ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.dir_rel_geral(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_relatorio_geral');
  v := v || jsonb_build_object('recrutamento',       public.dir_rel_recrutamento(_de, _ate));
  v := v || jsonb_build_object('demissoes',          public.dir_rel_demissoes(_de, _ate));
  v := v || jsonb_build_object('materiais',          public.dir_rel_materiais(_de, _ate));
  v := v || jsonb_build_object('ferias',             public.dir_rel_ferias(_de, _ate));
  v := v || jsonb_build_object('medida-disciplinar', public.dir_rel_medida_disciplinar(_de, _ate));
  v := v || jsonb_build_object('chamados',           public.dir_rel_chamados(_de, _ate));
  v := v || jsonb_build_object('orientacoes',        public.dir_rel_orientacoes(_de, _ate));
  v := v || jsonb_build_object('mudanca-funcao',     public.dir_rel_mudanca_funcao(_de, _ate));
  v := v || jsonb_build_object('colaboradores',      public.dir_rel_colaboradores(_de, _ate));
  v := v || jsonb_build_object('turnover',           public.dir_rel_turnover(_de, _ate));
  RETURN v;
END $$;

-- A I.A só para quem tem a capacidade (cobrada também na Edge diretoria-ia).
CREATE OR REPLACE FUNCTION public.dir_rel_pode_ia()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.has_screen_access(auth.uid(), 'diretoria_relatorios_ia', 'visualizar'::public.app_acao);
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['dir_rel_recrutamento','dir_rel_demissoes','dir_rel_materiais','dir_rel_ferias',
                           'dir_rel_medida_disciplinar','dir_rel_chamados','dir_rel_orientacoes','dir_rel_mudanca_funcao',
                           'dir_rel_colaboradores','dir_rel_turnover','dir_rel_geral'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(date, date) FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(date, date) TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_pode_ia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_pode_ia() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (logado como quem tem o Relatório Geral):
-- SELECT jsonb_object_keys(public.dir_rel_geral());

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_rel_geral(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_turnover(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_colaboradores(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_mudanca_funcao(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_orientacoes(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_chamados(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_medida_disciplinar(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_ferias(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_materiais(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_demissoes(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_recrutamento(date, date);
-- DROP FUNCTION IF EXISTS public.dir_rel_montar(text, text, date, date, jsonb, text);
-- DROP FUNCTION IF EXISTS public.dir_rel_pode_ia();
-- DROP FUNCTION IF EXISTS public.dir_rel_exige(text);
-- DELETE FROM public.app_menu WHERE codigo LIKE 'diretoria_rel%' OR codigo = 'diretoria_relatorio_geral';
