-- =========================================================================
-- DIRETORIA › TURN-OVER › aba "Turnover em Valores" — por enquanto em
-- QUANTIDADES (07/10/2026)
--
-- PEDIDO (Pablo): "faz a aba turnover em valores" → decidido com ele: a
-- opção 3, quantidades e perfil das rescisões, sem dinheiro.
--
-- POR QUE SEM R$: a exportação da Senior para o MySQL hagg manda as verbas
-- (R046VER) e o holerite (R046HOL) com o VALOR vazio — conferido na origem
-- em 07/10 (cadastro 7037, set/2026: valeve NULL em todas as verbas;
-- totven/totdes/valliq NULL em 18.503 de 19.276 holerites). O espelho só
-- copia. BiAssinalamentos também foi olhado: é atribuição de vale
-- (valor unitário × dias), não verba de folha. Quando a exportação passar a
-- mandar valeve/totven, esta aba ganha os valores.
--
-- O QUE A RPC DEVOLVE (demissões com "Data Afastamento" nos meses
-- escolhidos do ano; contrato opcional):
--   · total, tempo de empresa médio e mediano (dias, admissão → afastamento);
--   · por faixa de tempo de empresa, por mês, por empresa, por tipo de
--     desligamento ("Descrição (Causa)") e por contrato (com quantas saíram
--     com até 3 meses de casa);
--   · avisos pedidos pelo ERP (SISTEMA_SOLICITACOES_DEMISSAO.modelo_aviso),
--     pela data do aviso nos meses escolhidos;
--   · verbas de férias da rescisão na Senior — QUANTAS rescisões tiveram
--     cada uma (650 vencidas, 651 proporcionais, 1400 indenizadas). Só essas
--     três têm nome no catálogo de eventos que vem da Senior (R008EVC tem 25
--     eventos); as demais verbas só chegam como código e ficam de fora.
--     A rescisão é o cálculo mensal (R044CAL.tipcal 11) do mês do afastamento.
--
-- Índice parcial em espelho."R046VER" só das três verbas (poucos milhares de
-- linhas): o espelho recarrega com TRUNCATE + COPY, então o índice fica.
-- Acesso: o do relatório Turn-over (dir_rel_exige).
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE INDEX IF NOT EXISTS r046ver_ferias_rescisao_idx
  ON espelho."R046VER" (numemp, numcad, codcal, codeve)
  WHERE codeve IN (650, 651, 1400);

CREATE OR REPLACE FUNCTION public.dir_turnover_rescisoes(_ano int DEFAULT NULL, _meses int[] DEFAULT NULL, _contrato text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_meses int[];
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  IF EXISTS (SELECT 1 FROM unnest(_meses) m WHERE m IS NULL OR m < 1 OR m > 12) THEN RAISE EXCEPTION 'Mês inválido'; END IF;
  v_meses := COALESCE(NULLIF(_meses, '{}'), ARRAY(SELECT generate_series(1, 12)));

  WITH r AS MATERIALIZED (   -- uma linha por rescisão
    SELECT x."Empresa"::int emp, x."Cadastro"::int cad,
           public.data_universal(x."Admissão") adm,
           public.data_universal(x."Data Afastamento") dem,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem contrato)') contrato,
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Descrição (Causa)"), ''), '(não informado)') causa
      FROM public."EMPREGADOS" x
     WHERE x."Situação" = 'Demitido'
       AND COALESCE(btrim(x."Nome"), '') <> ''
       AND (_contrato IS NULL OR x."Nome Filial" = _contrato)
  ),
  d AS MATERIALIZED (
    SELECT r.*, CASE WHEN r.adm IS NOT NULL AND r.adm <= r.dem THEN r.dem - r.adm END dias
      FROM r
     WHERE extract(year FROM r.dem)::int = v_ano AND extract(month FROM r.dem)::int = ANY(v_meses)
  ),
  f AS (
    SELECT d.*,
           CASE WHEN d.dias IS NULL THEN 0 WHEN d.dias <= 90 THEN 1 WHEN d.dias <= 182 THEN 2 WHEN d.dias <= 365 THEN 3
                WHEN d.dias <= 730 THEN 4 WHEN d.dias <= 1826 THEN 5 ELSE 6 END ordem
      FROM d
  ),
  -- Verbas de férias da rescisão (cálculo mensal do mês do afastamento).
  vb AS (
    SELECT v.codeve, count(DISTINCT (d.emp, d.cad)) n
      FROM d
      JOIN espelho."R044CAL" c ON c.numemp = d.emp AND c.tipcal = 11 AND c.perref = date_trunc('month', d.dem)
      JOIN espelho."R046VER" v ON v.numemp = d.emp AND v.numcad = d.cad AND v.codcal = c.codcal
                              AND v.codeve IN (650, 651, 1400)
     GROUP BY 1
  ),
  av AS (
    SELECT s.modelo_aviso modelo, count(*) n
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
     WHERE s.status NOT IN ('Cancelada', 'Reprovada')
       AND COALESCE(btrim(s.modelo_aviso), '') <> ''
       AND extract(year FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = v_ano
       AND extract(month FROM COALESCE(s.data_aviso, s.data_solicitacao, s.criado_em::date))::int = ANY(v_meses)
       AND (_contrato IS NULL OR s.contrato = _contrato)
     GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ano', v_ano, 'meses', to_jsonb(v_meses),
    'total', (SELECT count(*) FROM d),
    'tempo_medio_dias', (SELECT round(avg(dias)) FROM d),
    'tempo_mediano_dias', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias) FROM d WHERE dias IS NOT NULL),
    'por_faixa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('ordem', o.ordem, 'faixa', o.faixa, 'n', COALESCE(x.n, 0)) ORDER BY o.ordem), '[]'::jsonb)
                    FROM (VALUES (1, 'Até 3 meses'), (2, '3 a 6 meses'), (3, '6 meses a 1 ano'), (4, '1 a 2 anos'),
                                 (5, '2 a 5 anos'), (6, 'Mais de 5 anos'), (0, 'Sem data de admissão')) o(ordem, faixa)
                    LEFT JOIN (SELECT ordem, count(*) n FROM f GROUP BY 1) x USING (ordem)
                   WHERE o.ordem > 0 OR x.n > 0),
    'por_mes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', x.mes, 'n', x.n) ORDER BY x.mes), '[]'::jsonb)
                  FROM (SELECT to_char(dem, 'YYYY-MM') mes, count(*) n FROM d GROUP BY 1) x),
    'por_empresa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('empresa', x.empresa, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
                      FROM (SELECT empresa, count(*) n FROM d GROUP BY 1) x),
    'por_causa', (SELECT COALESCE(jsonb_agg(jsonb_build_object('causa', x.causa, 'n', x.n) ORDER BY x.n DESC, x.causa), '[]'::jsonb)
                    FROM (SELECT causa, count(*) n FROM d GROUP BY 1) x),
    'por_contrato', (SELECT COALESCE(jsonb_agg(jsonb_build_object('contrato', x.contrato, 'n', x.n, 'ate_3m', x.ate_3m,
                                                                'tempo_medio_dias', x.medio) ORDER BY x.n DESC, x.contrato), '[]'::jsonb)
                       FROM (SELECT contrato, count(*) n, count(*) FILTER (WHERE ordem = 1) ate_3m, round(avg(dias)) medio
                               FROM f GROUP BY 1) x),
    'avisos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('modelo', modelo, 'n', n) ORDER BY n DESC, modelo), '[]'::jsonb) FROM av),
    'verbas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('codigo', o.codeve, 'verba', o.verba, 'n', COALESCE(vb.n, 0)) ORDER BY o.ordem), '[]'::jsonb)
                 FROM (VALUES (1, 651, 'Férias proporcionais'), (2, 650, 'Férias vencidas'), (3, 1400, 'Férias indenizadas')) o(ordem, codeve, verba)
                 LEFT JOIN vb USING (codeve))
  ) INTO v_out;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.dir_turnover_rescisoes(int, int[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_rescisoes(int, int[], text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_turnover_rescisoes(int, int[], text);
-- DROP INDEX IF EXISTS espelho.r046ver_ferias_rescisao_idx;
