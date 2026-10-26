-- =========================================================================
-- RELATÓRIOS › TURN-OVER › VARIAÇÃO DE EFETIVO — trabalhando sem afastados
-- e previsto igual ao Ativos/Contratos (26/10/2026)
--
-- PEDIDO (Pablo, sobre a mig 20261025000010): "não precisa puxar os
-- afastados, só os que estão de fato trabalhando; os de atestado pode puxar,
-- mas férias, auxílio-doença etc. não" e "os valores têm que bater com
-- Ativos/Contratos — não dá pra ter 50 previsto aqui e 55 lá".
--
-- O que muda em dir_turnover_variacao_efetivo (resto igual à mig 010):
--
--   1. EFETIVO TRABALHANDO = quem está trabalhando no fim do mês:
--      Situação "Trabalhando", "Atestado…" ou "Aviso Prévio Trabalhado" (a
--      mesma régua do login, mig 20261007000007). Férias, auxílio-doença,
--      licença e os demais afastamentos saem a partir da Data Afastamento da
--      Senior (sem data: só no mês corrente). Afastamento que já acabou não
--      tem histórico — a pessoa conta como trabalhando nos meses de antes.
--      Também saem, como no "Tem" do Ativos/Contratos, quem o RH marcou fora
--      da conta do contrato e quem é RENDA TÉCNICA (não ocupa vaga).
--   2. EFETIVO PREVISTO = o do Ativos/Contratos: sem os postos de RENDA
--      TÉCNICA, e contrato encerrado sem ninguém ativo não tem previsto no
--      mês corrente (o Ativos/Contratos nem lista).
--   3. TURNOVER continua no efetivo de antes (todos os ativos no fim do mês,
--      afastados inclusive), que vai no campo novo `efetivo` — a taxa segue
--      igual à do Turn-over; só a coluna "Efetivo trabalhando" mudou.
--
-- Diferença que fica: o Ativos/Contratos conta só "Trabalhando" (atestado é
-- afastado lá desde a mig 20261006000011); aqui o atestado conta, a pedido.
--
-- Mesmo acesso (diretoria_rel_turnover). Só leitura. Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.dir_turnover_variacao_efetivo(_ano integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ano int := COALESCE(_ano, extract(year FROM current_date)::int);
  v_out jsonb;
BEGIN
  PERFORM public.dir_rel_exige('diretoria_rel_turnover');
  IF v_ano < 2000 OR v_ano > 2100 THEN RAISE EXCEPTION 'Ano inválido.'; END IF;

  WITH
  mm AS MATERIALIZED (   -- só os meses que já começaram
    SELECT make_date(v_ano, m, 1) ini,
           LEAST((make_date(v_ano, m, 1) + interval '1 month' - interval '1 day')::date, current_date) fim
      FROM generate_series(1, 12) m
     WHERE make_date(v_ano, m, 1) <= current_date
  ),
  -- Contrato do ERP de cada filial/local (mesma ligação de rh_ac_ativos).
  ct AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(c.nome)) public.rh_norm_contrato(c.nome) AS nn, c.id
      FROM public.contratos c
     WHERE public.rh_norm_contrato(c.nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(c.nome), (COALESCE(c.status, 'ativo') = 'encerrado'), c.created_at DESC
  ),
  dp_nome AS MATERIALIZED (
    SELECT DISTINCT ON (d.filial_nome) d.filial_nome, d.contrato_id
      FROM public.sup_empregado_contrato_depara d ORDER BY d.filial_nome, d.contrato_id
  ),
  dp_nn AS MATERIALIZED (
    SELECT DISTINCT ON (public.rh_norm_contrato(d.filial_nome)) public.rh_norm_contrato(d.filial_nome) AS nn, d.contrato_id
      FROM public.sup_empregado_contrato_depara d
     WHERE public.rh_norm_contrato(d.filial_nome) IS NOT NULL
     ORDER BY public.rh_norm_contrato(d.filial_nome), d.contrato_id
  ),
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão") adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento") END dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') conta,
           public.esp_col_esta_ativo(x."Situação") ativo,
           -- Afastado hoje (férias, auxílio-doença, licença…): fora do
           -- "trabalhando" desde a Data Afastamento. Atestado e aviso
           -- trabalhado contam (régua do login, mig 20261007000007).
           CASE WHEN public.esp_col_esta_ativo(x."Situação")
                 AND btrim(COALESCE(x."Situação", '')) !~* '^(Trabalhando|Atestado|Aviso Pr.vio Trab)'
                THEN COALESCE(public.data_universal(x."Data Afastamento"), current_date) END afast_desde,
           x."Empresa"::bigint emp_num,
           x."Cadastro"::text cadastro,
           btrim(COALESCE(x."Nome do Posto", '')) posto_senior,
           CASE x."Empresa" WHEN 1 THEN 'HAGG' WHEN 2 THEN 'SN' WHEN 3 THEN 'CANAÃ' WHEN 4 THEN 'LF' WHEN 5 THEN 'NH' ELSE '(sem empresa)' END empresa,
           COALESCE(NULLIF(btrim(x."Nome Filial"), ''), '(sem filial)') filial,
           public.rh_norm_contrato(x."Nome Filial") nn_filial,
           public.rh_norm_contrato(x."Descrição do Local") nn_local
      FROM public."EMPREGADOS" x
     WHERE COALESCE(btrim(x."Nome"), '') <> ''
  ),
  ec AS MATERIALIZED (
    SELECT e.*, COALESCE(d1.contrato_id, c1.id, d2.contrato_id, c2.id) contrato_id
      FROM e
      LEFT JOIN dp_nome d1 ON d1.filial_nome = e.filial
      LEFT JOIN ct c1      ON c1.nn = e.nn_filial
      LEFT JOIN dp_nn d2   ON d2.nn = e.nn_filial
      LEFT JOIN ct c2      ON c2.nn = e.nn_local
     WHERE (e.adm IS NULL OR e.adm <= (SELECT max(fim) FROM mm))
       AND (e.dem IS NULL OR e.dem >= make_date(v_ano, 1, 1))
  ),
  -- Postos vigentes hoje (o pv do rh_ac_painel) e posto da Senior → posto
  -- da planilha (o lig do rh_ac_painel): para tirar do "trabalhando" quem o
  -- Ativos/Contratos tira do "Tem" — fora da conta e RENDA TÉCNICA.
  pv_hoje AS MATERIALIZED (
    SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto))
           pc.contrato_id, btrim(pc.posto) AS posto, public.sup_norm_nome(pc.posto) AS pn
      FROM public.planilha_custo pc
     WHERE pc.contrato_id IS NOT NULL
       AND pc.orexec = 'EXECUTADO'
       AND NOT COALESCE(pc.encerrado, false)
       AND pc.data_vigencia IS NOT NULL
       AND pc.data_vigencia <= current_date
       AND COALESCE(btrim(pc.posto), '') <> ''
     ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), pc.data_vigencia DESC
  ),
  lig AS MATERIALIZED (
    SELECT DISTINCT ON (d.contrato_id, d.posto_senior)
           d.contrato_id, d.posto_senior, d.ignorar, pv.posto AS planilha_posto
      FROM public."RH_POSTO_DEPARA" d
      LEFT JOIN pv_hoje pv ON pv.contrato_id = d.contrato_id
                          AND pv.pn = public.sup_norm_nome(d.planilha_posto)
     WHERE d.ignorar OR pv.posto IS NOT NULL
     ORDER BY d.contrato_id, d.posto_senior, d.ignorar DESC, pv.posto
  ),
  -- Chave do contrato: o do ERP, ou a filial da Senior quando não liga.
  pessoa AS MATERIALIZED (
    SELECT ec.*, COALESCE(ec.contrato_id::text, 'filial:' || ec.filial) chave,
           (ec.ativo AND ec.contrato_id IS NOT NULL AND (
              oc.planilha_posto = ''
              OR (NOT COALESCE(oc.rt, false) AND pvo.posto IS NULL AND COALESCE(l.ignorar, false))
              OR COALESCE(oc.rt, false)
              OR (pvo.posto IS NULL AND NOT COALESCE(l.ignorar, false)
                  AND public.sup_norm_nome(l.planilha_posto) = 'RENDATECNICA')
           )) IS TRUE fora_do_tem
      FROM ec
      LEFT JOIN LATERAL (
        SELECT x.planilha_posto, public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA' AS rt
          FROM public."RH_POSTO_COLABORADOR" x
         WHERE ec.ativo AND x.empresa = ec.emp_num AND x.cadastro::text = ec.cadastro
           AND x.contrato_id = ec.contrato_id
      ) oc ON true
      LEFT JOIN pv_hoje pvo
             ON pvo.contrato_id = ec.contrato_id AND oc.planilha_posto <> '' AND NOT oc.rt
            AND pvo.pn = public.sup_norm_nome(oc.planilha_posto)
      LEFT JOIN lig l
             ON ec.ativo AND l.contrato_id = ec.contrato_id AND l.posto_senior = ec.posto_senior
  ),
  mov AS MATERIALIZED (
    SELECT p.chave, mm.ini,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)
                              AND NOT p.fora_do_tem
                              AND (p.afast_desde IS NULL OR p.afast_desde > mm.fim)) trabalhando,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)) efetivo,
           count(*) FILTER (WHERE p.adm BETWEEN mm.ini AND mm.fim) admissoes,
           count(*) FILTER (WHERE p.dem BETWEEN mm.ini AND mm.fim) demissoes
      FROM pessoa p CROSS JOIN mm
     GROUP BY 1, 2
  ),
  -- Contrato encerrado sem ninguém ativo: o Ativos/Contratos não lista.
  encerrado_vazio AS MATERIALIZED (
    SELECT c.id::text chave
      FROM public.contratos c
     WHERE COALESCE(c.status, 'ativo') = 'encerrado'
       AND NOT EXISTS (SELECT 1 FROM ec WHERE ec.ativo AND ec.contrato_id = c.id)
  ),
  -- Previsto: a planilha vigente no fim de cada mês, um posto por nome,
  -- sem RENDA TÉCNICA (a conta do Ativos/Contratos).
  pv AS MATERIALIZED (
    SELECT x.contrato_id::text chave, x.ini, sum(x.vagas) previsto
      FROM (
        SELECT DISTINCT ON (pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini)
               pc.contrato_id, mm.ini, COALESCE(pc.qt_postos, 0) vagas
          FROM public.planilha_custo pc
          JOIN mm ON pc.data_vigencia <= mm.fim
         WHERE pc.contrato_id IS NOT NULL
           AND pc.orexec = 'EXECUTADO'
           AND NOT COALESCE(pc.encerrado, false)
           AND pc.data_vigencia IS NOT NULL
           AND COALESCE(btrim(pc.posto), '') <> ''
           AND public.sup_norm_nome(pc.posto) <> 'RENDATECNICA'
         ORDER BY pc.contrato_id, public.sup_norm_nome(pc.posto), mm.ini, pc.data_vigencia DESC
      ) x
     WHERE NOT (x.ini = date_trunc('month', current_date)::date
                AND x.contrato_id::text IN (SELECT chave FROM encerrado_vazio))
     GROUP BY 1, 2
  ),
  chaves AS MATERIALIZED (
    SELECT chave FROM mov WHERE efetivo > 0 OR admissoes > 0 OR demissoes > 0
    UNION
    SELECT chave FROM pv WHERE previsto > 0
  ),
  info AS MATERIALIZED (   -- nome e empresa (a empresa de quem mais trabalha no contrato)
    SELECT k.chave,
           COALESCE(c.nome, substr(k.chave, 8)) nome,
           c.id IS NOT NULL no_erp,
           COALESCE((SELECT p.empresa FROM pessoa p WHERE p.chave = k.chave GROUP BY p.empresa ORDER BY count(*) DESC LIMIT 1), '(sem empresa)') empresa
      FROM chaves k
      LEFT JOIN public.contratos c ON k.chave !~ '^filial:' AND c.id::text = k.chave
  ),
  linhas AS (
    SELECT i.empresa, jsonb_build_object(
             'chave', i.chave, 'nome', i.nome, 'no_erp', i.no_erp,
             'meses', (SELECT jsonb_agg(jsonb_build_object(
                         'mes', to_char(mm.ini, 'YYYY-MM'),
                         'previsto', COALESCE(pv.previsto, 0), 'trabalhando', COALESCE(mv.trabalhando, 0),
                         'efetivo', COALESCE(mv.efetivo, 0),
                         'admissoes', COALESCE(mv.admissoes, 0), 'demissoes', COALESCE(mv.demissoes, 0)) ORDER BY mm.ini)
                         FROM mm
                         LEFT JOIN pv  ON pv.chave = i.chave AND pv.ini = mm.ini
                         LEFT JOIN mov mv ON mv.chave = i.chave AND mv.ini = mm.ini)) c
      FROM info i
  )
  SELECT jsonb_build_object(
    'ano', v_ano,
    'meses', (SELECT COALESCE(jsonb_agg(to_char(ini, 'YYYY-MM') ORDER BY ini), '[]'::jsonb) FROM mm),
    'gerado_em', now(),
    'empresas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('empresa', x.empresa, 'contratos', x.cs) ORDER BY (x.empresa LIKE '(%'), x.empresa)
        FROM (SELECT empresa, jsonb_agg(c ORDER BY (c->>'no_erp')::boolean DESC, c->>'nome') cs FROM linhas GROUP BY empresa) x), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.dir_turnover_variacao_efetivo(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_turnover_variacao_efetivo(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a função da mig 20261025000010_turnover_variacao_efetivo.sql
-- (trabalhando = todos os ativos no fim do mês; previsto com RENDA TÉCNICA).
