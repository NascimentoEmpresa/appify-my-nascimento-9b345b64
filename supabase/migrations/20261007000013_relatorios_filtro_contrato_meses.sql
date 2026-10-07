-- =========================================================================
-- RELATÓRIOS — filtro por CONTRATO e por MÊS/ANO em todos (07/10/2026)
--
-- PEDIDO (Pablo): "em todos esses relatórios preciso conseguir filtrar por
-- contrato e mês/ano". E, para as TVs, cada TV poder passar um relatório —
-- a TV não tem login, então a conta precisa existir separada da checagem de
-- acesso de quem está logado.
--
-- O QUE MUDA (em cima da mig 20261005000006)
--   · dir_rel_montar ganha _contrato (uuid de contratos) e _meses (1–12).
--     Cada sistema devolve, além das 8 colunas de antes, cid (contrato_id
--     quando a tabela tem) e ct (texto do contrato). Casamento: cid = id OU,
--     sem cid, rh_norm_contrato(ct) = rh_norm_contrato(contratos.nome) — a
--     mesma régua do Ativos/Contratos (tira "1050 - " e zeros à esquerda).
--     Demissões e Medida Disciplinar têm contrato_id BIGINT (outro cadastro,
--     não contratos.id): nelas vale só o nome. Medido em 07/10: casa 94–98%; o Recrutamento ANTIGO usa
--     apelidos ("BENTO HIG/AUX ADM", "SAMU") e só entra no filtro quando a
--     vaga tem contrato_id ou o nome oficial. Chamados e Orientações não têm
--     contrato: com contrato escolhido, voltam vazios (a tela avisa).
--   · Colaboradores e Turn-over: contrato pelo "Nome Filial" da EMPREGADOS.
--   · _meses: só os meses escolhidos dentro do período (a tela manda o ano
--     inteiro como período e os meses marcados).
--   · dir_rel_dados(slug, de, ate, contrato, meses): a CONTA, sem checagem
--     de acesso, INTERNA (sem grant para ninguém). As dir_rel_<sistema> da
--     tela = dir_rel_exige(menu) + dir_rel_dados. A TV (mig seguinte) chama
--     dir_rel_dados depois de validar o token dela.
--   · Assinaturas novas: (date, date, uuid, int[]) com defaults — a chamada
--     antiga com {_de, _ate} (tela publicada, Edge diretoria-ia) continua
--     funcionando. As de (date, date) saem: com as duas, o PostgREST ficaria
--     em dúvida entre elas.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 0) Saem as assinaturas antigas ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.dir_rel_geral(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_recrutamento(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_demissoes(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_materiais(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_ferias(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_medida_disciplinar(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_chamados(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_orientacoes(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_mudanca_funcao(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_colaboradores(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_turnover(date, date);
DROP FUNCTION IF EXISTS public.dir_rel_montar(text, text, date, date, jsonb, text);

-- ── 1) Ajudantes ─────────────────────────────────────────────────────────
-- Contrato escolhido, normalizado (NULL = sem filtro).
CREATE OR REPLACE FUNCTION public.dir_rel_contrato_nn(_contrato uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.rh_norm_contrato(c.nome) FROM public.contratos c WHERE c.id = _contrato
$$;

-- A linha entra no contrato escolhido?
CREATE OR REPLACE FUNCTION public.dir_rel_no_contrato(_cid uuid, _ct text, _contrato uuid, _nn text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  -- COALESCE: contrato vazio na linha dá NULL na comparação, e NOT NULL não
  -- exclui a linha (a 1ª versão deixava tudo passar em Demissões/Chamados…).
  SELECT _contrato IS NULL
      OR COALESCE(_cid = _contrato, false)
      OR (_cid IS NULL AND _nn IS NOT NULL AND COALESCE(public.rh_norm_contrato(_ct) = _nn, false))
$$;

-- A data cai num dos meses escolhidos? (sem meses = todos)
CREATE OR REPLACE FUNCTION public.dir_rel_no_mes(_d date, _meses int[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT _meses IS NULL OR cardinality(_meses) = 0 OR extract(month FROM _d)::int = ANY (_meses)
$$;

-- ── 2) Montagem padrão (8 sistemas de solicitação) ───────────────────────
-- _sql devolve UMA linha por solicitação: dt, titulo, status, grupo, d1, d2,
-- d3, dias, cid (uuid do contrato ou NULL), ct (texto do contrato).
CREATE OR REPLACE FUNCTION public.dir_rel_montar(
  _titulo text, _sql text, _de date, _ate date, _dims jsonb, _rotulo_item text DEFAULT 'solicitações',
  _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_dur int;
  v_out jsonb;
BEGIN
  v_dur := (v_ate - v_de) + 1;
  EXECUTE 'CREATE TEMP TABLE IF NOT EXISTS _dir_base2 (dt date, titulo text, status text, grupo text, d1 text, d2 text, d3 text, dias numeric, cid uuid, ct text) ON COMMIT DROP';
  EXECUTE 'TRUNCATE _dir_base2';
  EXECUTE 'INSERT INTO _dir_base2 ' || _sql;
  IF _contrato IS NOT NULL THEN
    DELETE FROM _dir_base2 WHERE NOT public.dir_rel_no_contrato(cid, ct, _contrato, v_nn);
  END IF;

  WITH p AS (SELECT * FROM _dir_base2 WHERE dt BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(dt, _meses)),
  ant AS (SELECT count(*) n FROM _dir_base2 WHERE dt BETWEEN v_de - v_dur AND v_de - 1 AND public.dir_rel_no_mes(dt, _meses)),
  meses AS (
    SELECT to_char(g, 'YYYY-MM') mes FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
     WHERE public.dir_rel_no_mes(g::date, _meses)
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
    'filtro', jsonb_build_object('contrato', _contrato, 'meses', to_jsonb(_meses)),
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
REVOKE ALL ON FUNCTION public.dir_rel_montar(text, text, date, date, jsonb, text, uuid, int[]) FROM PUBLIC, anon, authenticated;

-- ── 3) Colaboradores (filtro: Nome Filial) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.dir_rel_colaboradores_dados(_de date, _ate date, _contrato uuid, _meses int[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN
  WITH e AS MATERIALIZED (
    SELECT e."Nome" nome, e."Situação" sit, e."Título do Cargo" cargo, e."Nome Filial" filial, e."Empresa"::text empresa,
           e."Sexo" sexo, COALESCE(NULLIF(btrim(e."Setor_ERP"), ''), '(sem setor)') setor,
           public.data_universal(e."Admissão") adm,
           CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento") END dem,
           public.esp_col_esta_ativo(e."Situação") ativo
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Nome"), '') <> ''
       AND public.dir_rel_no_contrato(NULL, e."Nome Filial", _contrato, v_nn)
  ),
  meses AS (SELECT g::date ini, (g + interval '1 month' - interval '1 day')::date fim, to_char(g, 'YYYY-MM') mes
              FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
             WHERE public.dir_rel_no_mes(g::date, _meses)),
  a AS (SELECT count(*) FILTER (WHERE ativo) ativos,
               count(*) FILTER (WHERE sit = 'Trabalhando') trabalhando,
               count(*) FILTER (WHERE ativo AND sit <> 'Trabalhando' AND sit NOT ILIKE 'atestado%') afastados,
               count(*) FILTER (WHERE adm BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(adm, _meses)) admitidos,
               count(*) FILTER (WHERE dem BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(dem, _meses)) desligados
          FROM e)
  SELECT jsonb_build_object(
    'titulo', 'Colaboradores',
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'filtro', jsonb_build_object('contrato', _contrato, 'meses', to_jsonb(_meses)),
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
                   FROM (SELECT * FROM e WHERE adm BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(adm, _meses) ORDER BY adm DESC LIMIT 15) x)),
    'rotulo_item', 'colaboradores'
  ) INTO v_out FROM a;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_colaboradores_dados(date, date, uuid, int[]) FROM PUBLIC, anon, authenticated;

-- ── 4) Turn-over (período; filtro: Nome Filial) ──────────────────────────
CREATE OR REPLACE FUNCTION public.dir_rel_turnover_dados(_de date, _ate date, _contrato uuid, _meses int[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ate date := COALESCE(_ate, current_date);
  v_de  date := COALESCE(_de, (date_trunc('month', COALESCE(_ate, current_date)) - interval '11 months')::date);
  v_nn  text := public.dir_rel_contrato_nn(_contrato);
  v_out jsonb;
BEGIN
  WITH e AS MATERIALIZED (
    SELECT e."Nome" nome, e."Título do Cargo" cargo, e."Nome Filial" filial,
           public.data_universal(e."Admissão") adm,
           CASE WHEN e."Situação" = 'Demitido' THEN public.data_universal(e."Data Afastamento") END dem,
           public.esp_col_esta_ativo(e."Situação") ativo
      FROM public."EMPREGADOS" e
     WHERE COALESCE(btrim(e."Nome"), '') <> ''
       AND public.dir_rel_no_contrato(NULL, e."Nome Filial", _contrato, v_nn)
  ),
  m AS MATERIALIZED (
    SELECT to_char(g, 'YYYY-MM') mes, g::date ini, (g + interval '1 month' - interval '1 day')::date fim,
           (SELECT count(*) FROM e WHERE e.adm < g::date AND (e.dem IS NULL OR e.dem >= g::date) AND (e.ativo OR e.dem IS NOT NULL)) base,
           (SELECT count(*) FROM e WHERE e.adm BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) adm,
           (SELECT count(*) FROM e WHERE e.dem BETWEEN g::date AND (g + interval '1 month' - interval '1 day')::date) dem
      FROM generate_series(date_trunc('month', v_de), date_trunc('month', v_ate), interval '1 month') g
     WHERE public.dir_rel_no_mes(g::date, _meses)
  ),
  sai AS MATERIALIZED (SELECT * FROM e WHERE e.dem BETWEEN v_de AND v_ate AND public.dir_rel_no_mes(e.dem, _meses)),
  t AS (SELECT sum(adm) adm, sum(dem) dem,
               round(avg(CASE WHEN base > 0 THEN (adm + dem) / 2.0 / base * 100 END), 2) taxa,
               (SELECT count(*) FROM sai WHERE sai.adm IS NOT NULL AND sai.dem - sai.adm <= 90) precoce
          FROM m)
  SELECT jsonb_build_object(
    'titulo', 'Turn-over',
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'filtro', jsonb_build_object('contrato', _contrato, 'meses', to_jsonb(_meses)),
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
         FROM (SELECT COALESCE(filial, '(sem filial)') nome, count(*) n FROM sai GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Desligamentos por cargo', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
         FROM (SELECT COALESCE(cargo, '(sem cargo)') nome, count(*) n FROM sai GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x)),
      jsonb_build_object('titulo', 'Tempo de casa de quem saiu', 'itens', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', x.nome, 'n', x.n) ORDER BY x.ord), '[]'::jsonb)
         FROM (SELECT CASE WHEN dem - adm <= 90 THEN 'Até 3 meses' WHEN dem - adm <= 180 THEN '3 a 6 meses' WHEN dem - adm <= 365 THEN '6 meses a 1 ano'
                           WHEN dem - adm <= 730 THEN '1 a 2 anos' ELSE 'Mais de 2 anos' END nome,
                      min(CASE WHEN dem - adm <= 90 THEN 1 WHEN dem - adm <= 180 THEN 2 WHEN dem - adm <= 365 THEN 3 WHEN dem - adm <= 730 THEN 4 ELSE 5 END) ord,
                      count(*) n
                 FROM sai WHERE adm IS NOT NULL GROUP BY 1) x))
    ),
    'recentes', jsonb_build_object(
      'colunas', jsonb_build_array('Desligamento', 'Colaborador', 'Tempo de casa', 'Contrato (filial)'),
      'linhas', (SELECT COALESCE(jsonb_agg(jsonb_build_array(to_char(x.dem, 'DD/MM/YYYY'), x.nome || COALESCE(' — ' || x.cargo, ''),
                          CASE WHEN x.adm IS NULL THEN '—' ELSE (x.dem - x.adm) || ' dias' END, x.filial)), '[]'::jsonb)
                   FROM (SELECT * FROM sai ORDER BY dem DESC LIMIT 15) x)),
    'rotulo_item', 'movimentações'
  ) INTO v_out FROM t;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_turnover_dados(date, date, uuid, int[]) FROM PUBLIC, anon, authenticated;

-- ── 5) A conta de cada relatório, sem checagem de acesso (INTERNA) ───────
CREATE OR REPLACE FUNCTION public.dir_rel_dados(_slug text, _de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  CASE _slug
  WHEN 'recrutamento' THEN RETURN public.dir_rel_montar('Gestão Recrutamento', $q$
    SELECT created_at::date, '#' || id || ' · ' || COALESCE(cargo, 'vaga') || COALESCE(' — ' || contrato, ''), status,
           CASE WHEN status IN ('Concluído', 'Contratado') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, cargo, motivo_vaga,
           CASE WHEN status IN ('Concluído', 'Contratado') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END,
           contrato_id, contrato
      FROM public."SISTEMA_RECRUTAMENTO" $q$,
    _de, _ate, '["Vagas por contrato", "Vagas por cargo", "Motivo da vaga"]'::jsonb, 'vagas', _contrato, _meses);

  WHEN 'demissoes' THEN RETURN public.dir_rel_montar('Demissões', $q$
    SELECT COALESCE(data_solicitacao, criado_em::date), COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || colaborador_cargo, ''), status,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, COALESCE(motivo_solicitacao, motivo_pedido), colaborador_cargo,
           CASE WHEN status IN ('Concluída', 'ASO válido', 'Agendamento concluído')
                THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END,
           NULL::uuid, COALESCE(contrato, colaborador_filial)   -- contrato_id aqui é bigint (outro cadastro): casa pelo nome
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" $q$,
    _de, _ate, '["Demissões por contrato", "Motivo da demissão", "Cargo"]'::jsonb, 'demissões', _contrato, _meses);

  WHEN 'materiais' THEN RETURN public.dir_rel_montar('Materiais', $q$
    SELECT COALESCE(data_solicitacao, created_at::date), 'Pedido ' || COALESCE(pedido_id::text, id::text) || COALESCE(' — ' || nome_colaborador, ''), status,
           CASE WHEN status IN ('DESPACHADO', 'RETIRADO PARA ENTREGA') THEN 'concluido'
                WHEN status = 'CANCELADO' THEN 'recusado' ELSE 'aberto' END,
           contrato_nome, tipo_pedido, funcao_nome,
           CASE WHEN data_despachado IS NOT NULL
                THEN extract(epoch FROM data_despachado - COALESCE(data_solicitacao::timestamptz, created_at)) / 86400 END,
           contrato_id, contrato_nome
      FROM public.sup_pedido $q$,
    _de, _ate, '["Pedidos por contrato", "Tipo de pedido", "Função"]'::jsonb, 'pedidos', _contrato, _meses);

  WHEN 'ferias' THEN RETURN public.dir_rel_montar('Férias', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' · ' || dias_ferias || ' dias', ''), status,
           CASE WHEN status = 'Aprovada' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           colaborador_filial, colaborador_cargo, COALESCE(dias_ferias::text || ' dias', NULL),
           CASE WHEN status = 'Aprovada' AND aprovado_em IS NOT NULL THEN extract(epoch FROM aprovado_em - criado_em) / 86400 END,
           NULL::uuid, colaborador_filial
      FROM public."SISTEMA_SOLICITACOES_FERIAS" $q$,
    _de, _ate, '["Férias por filial/contrato", "Cargo", "Dias de férias"]'::jsonb, 'solicitações', _contrato, _meses);

  WHEN 'medida-disciplinar' THEN RETURN public.dir_rel_montar('Medida Disciplinar', $q$
    SELECT created_at::date, COALESCE(colaborador_nome, 'colaborador') || COALESCE(' — ' || tipo_advertencia, ''), status,
           CASE WHEN status IN ('Concluída', 'Registrada') THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           contrato, tipo_advertencia, grau,
           CASE WHEN status IN ('Concluída', 'Registrada') AND status_changed_at IS NOT NULL
                THEN extract(epoch FROM status_changed_at - created_at) / 86400 END,
           NULL::uuid, COALESCE(contrato, colaborador_filial)   -- contrato_id aqui é bigint (outro cadastro): casa pelo nome
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" $q$,
    _de, _ate, '["Medidas por contrato", "Tipo de medida", "Grau"]'::jsonb, 'medidas', _contrato, _meses);

  WHEN 'chamados' THEN RETURN public.dir_rel_montar('Chamados', $q$
    SELECT created_at::date, COALESCE(numero, '#' || id::text) || ' · ' || COALESCE(assunto, ''), status,
           CASE WHEN status = 'concluido' THEN 'concluido'
                WHEN status IN ('reprovado', 'cancelado') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(modulo_sistema, ''), modulo_sistema_outro), prioridade, setor,
           CASE WHEN status = 'concluido' AND concluido_em IS NOT NULL THEN extract(epoch FROM concluido_em - created_at) / 86400 END,
           NULL::uuid, NULL::text
      FROM public."CHAMADO_SISTEMA" $q$,
    _de, _ate, '["Chamados por módulo", "Prioridade", "Setor"]'::jsonb, 'chamados', _contrato, _meses);

  WHEN 'orientacoes' THEN RETURN public.dir_rel_montar('Orientações Jurídicas', $q$
    SELECT created_at::date, COALESCE(titulo, left(pergunta, 80)), status,
           CASE WHEN status = 'Respondida' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Recusada', 'Oculta', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           categoria, origem, autor_nome,
           CASE WHEN respondido_em IS NOT NULL THEN extract(epoch FROM respondido_em - created_at) / 86400 END,
           NULL::uuid, NULL::text
      FROM public."JUR_DUVIDAS" $q$,
    _de, _ate, '["Orientações por categoria", "Origem", "Quem perguntou"]'::jsonb, 'orientações', _contrato, _meses);

  WHEN 'mudanca-funcao' THEN RETURN public.dir_rel_montar('Mudança de Função', $q$
    SELECT criado_em::date, COALESCE(colaborador_nome, 'colaborador') || ': ' || COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'), status,
           CASE WHEN status = 'Concluída' THEN 'concluido'
                WHEN status IN ('Reprovada', 'Cancelada') THEN 'recusado' ELSE 'aberto' END,
           COALESCE(NULLIF(setor, ''), filial), COALESCE(cargo_atual, '?') || ' → ' || COALESCE(cargo_novo, '?'),
           CASE WHEN e_escritorio THEN 'Escritório' ELSE 'Operação' END,
           CASE WHEN status = 'Concluída' THEN extract(epoch FROM atualizado_em - criado_em) / 86400 END,
           NULL::uuid, filial
      FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" $q$,
    _de, _ate, '["Por setor/filial", "De → para", "Escritório × operação"]'::jsonb, 'mudanças', _contrato, _meses);

  WHEN 'colaboradores' THEN RETURN public.dir_rel_colaboradores_dados(_de, _ate, _contrato, _meses);
  WHEN 'turnover' THEN RETURN public.dir_rel_turnover_dados(_de, _ate, _contrato, _meses);
  ELSE RAISE EXCEPTION 'Relatório desconhecido: %', _slug;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_dados(text, date, date, uuid, int[]) FROM PUBLIC, anon, authenticated;

-- ── 6) As funções da tela: acesso de quem está logado + a conta ─────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('dir_rel_recrutamento', 'recrutamento', 'diretoria_rel_recrutamento'),
      ('dir_rel_demissoes', 'demissoes', 'diretoria_rel_demissoes'),
      ('dir_rel_materiais', 'materiais', 'diretoria_rel_materiais'),
      ('dir_rel_ferias', 'ferias', 'diretoria_rel_ferias'),
      ('dir_rel_medida_disciplinar', 'medida-disciplinar', 'diretoria_rel_medida_disciplinar'),
      ('dir_rel_chamados', 'chamados', 'diretoria_rel_chamados'),
      ('dir_rel_orientacoes', 'orientacoes', 'diretoria_rel_orientacoes'),
      ('dir_rel_mudanca_funcao', 'mudanca-funcao', 'diretoria_rel_mudanca_funcao'),
      ('dir_rel_colaboradores', 'colaboradores', 'diretoria_rel_colaboradores'),
      ('dir_rel_turnover', 'turnover', 'diretoria_rel_turnover')) v(fn, slug, menu)
  LOOP
    EXECUTE format($f$
      CREATE OR REPLACE FUNCTION public.%I(_de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $b$
      BEGIN
        PERFORM public.dir_rel_exige(%L);
        RETURN public.dir_rel_dados(%L, _de, _ate, _contrato, _meses);
      END $b$;$f$, r.fn, r.menu, r.slug);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(date, date, uuid, int[]) FROM PUBLIC, anon', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(date, date, uuid, int[]) TO authenticated', r.fn);
  END LOOP;
END $$;

-- Relatório Geral: os 10 com o mesmo filtro.
CREATE OR REPLACE FUNCTION public.dir_rel_geral(_de date DEFAULT NULL, _ate date DEFAULT NULL, _contrato uuid DEFAULT NULL, _meses int[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb := '{}'::jsonb; s text;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_relatorio_geral');
  FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                           'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover'] LOOP
    v := v || jsonb_build_object(s, public.dir_rel_dados(s, _de, _ate, _contrato, _meses));
  END LOOP;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_geral(date, date, uuid, int[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_geral(date, date, uuid, int[]) TO authenticated;

-- Lista de contratos para o filtro (só nome/id; quem tem algum relatório).
CREATE OR REPLACE FUNCTION public.dir_rel_contratos()
RETURNS TABLE(id uuid, nome text, encerrado boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT c.id, c.nome::text, COALESCE(c.status, 'ativo') = 'encerrado'
                 FROM public.contratos c WHERE COALESCE(btrim(c.nome), '') <> ''
                ORDER BY (COALESCE(c.status, 'ativo') = 'encerrado'), c.nome;
END $$;
REVOKE ALL ON FUNCTION public.dir_rel_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_contratos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a mig 20261005000006 inteira (assinaturas (date, date)) depois de:
-- DROP FUNCTION public.dir_rel_geral(date, date, uuid, int[]) e as 10 dir_rel_<sistema>(date, date, uuid, int[]);
-- DROP FUNCTION public.dir_rel_dados(text, date, date, uuid, int[]), public.dir_rel_colaboradores_dados(date, date, uuid, int[]),
--   public.dir_rel_turnover_dados(date, date, uuid, int[]), public.dir_rel_montar(text, text, date, date, jsonb, text, uuid, int[]),
--   public.dir_rel_contratos(), public.dir_rel_contrato_nn(uuid), public.dir_rel_no_contrato(uuid, text, uuid, text), public.dir_rel_no_mes(date, int[]);
