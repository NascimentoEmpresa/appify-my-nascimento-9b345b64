-- =========================================================================
-- SST › AFASTAMENTOS E TELEMEDICINA — a tela passa a listar os afastamentos
-- REAIS (29/10/2026)
--
-- O PROBLEMA (print do Pablo, 29/10): "Nenhum afastamento no período" de
-- agosto a outubro, todos os cartões zerados, "mesmo tendo várias
-- solicitações de demissão, vários de atestado, vários de aux doença, vários
-- de férias".
--
-- POR QUE VINHA VAZIO — três causas somadas:
--   1. A mig 20261029001750 só entrou no banco no merge das 15:00 de 29/10
--      (antes ela tinha sido pulada pelo aplicador — ver o cabeçalho dela).
--      Até ali a captura nunca tinha rodado nenhuma vez.
--   2. Mesmo rodando, a captura (sst_afa_capturar_senior) só olhava quem
--      está HOJE em situação ~ '(ATEST|DOEN|ACIDENT)' com "Data Afastamento"
--      dos últimos 120 dias. Férias, licença-maternidade, demais afastamentos
--      e desligamentos ficavam de fora por construção; o auxílio-doença
--      antigo (a maioria dos 96 medidos em 05/10) caía no corte de 120 dias.
--   3. O espelho da Senior só tem a situação ATUAL. Quem teve atestado em
--      agosto e voltou não deixa rastro ali — o histórico dependia 100% de
--      importar a planilha de telemedicina, que ninguém tinha importado.
--
-- O QUE ESTA MIGRATION FAZ (aditiva; o que já existe continua valendo)
--   1. Tipos novos: férias, licença, afastamento (demais da folha) e
--      desligamento. Origens novas: ferias (Solicitações de Férias do ERP),
--      efetividade (ausências registradas na Efetividade) e senior_hist.
--      Coluna fonte_ref diz de onde a linha veio ("Solicitação de férias
--      #123", "Efetividade: 3 dia(s)"...).
--   2. Captura reescrita (mesmo nome — o cron e o botão "Trazer da Senior"
--      seguem chamando sst_afa_capturar_senior), em quatro fontes:
--        a. Solicitações de Férias APROVADAS (SISTEMA_SOLICITACOES_FERIAS),
--           saída nos últimos 365 dias — período fechado (saída → retorno).
--        b. Ausências da Efetividade (OPE_EFET_OCORRENCIA motivo atestado /
--           afastamento / férias), dias seguidos viram um afastamento.
--        c. Situação ATUAL da Senior: TODA situação diferente de
--           "Trabalhando" (e de aviso prévio, que ainda trabalha), sem corte
--           de data — quem está afastado hoje está afastado no período.
--        d. Desligamentos da Senior ("Demitido"...) dos últimos 180 dias
--           (a "Data Afastamento" do demitido é a data da demissão).
--      Idempotente pela chave_importacao (uma chave por fonte), e não cria
--      linha que se sobrepõe a outra do mesmo colaborador.
--   3. Fim do afastamento encerrado: quem voltou ganha os dias reais
--      (retornou_em − início). Antes um afastamento "em aberto" que já tinha
--      terminado continuava crescendo até hoje. Também a troca de situação
--      (atestado → auxílio-doença) fecha a anterior como "prorrogado".
--   4. Horas extras (Sistemas › Hora Extra) aprovadas de quem é da MESMA
--      filial durante o afastamento aparecem na ficha como possível
--      cobertura, com o valor estimado (salário ÷ 220 × 1,5 × horas).
--   5. sst_afa_faturamento: notas emitidas por contrato e competência
--      (bruto, faltas, glosas, líquido) para o relatório gerencial medir o
--      impacto sobre o faturamento realizado — só com o financeiro.
--   6. Carga inicial: roda a captura uma vez no fim (se falhar, a migration
--      entra assim mesmo e o cron das :25 tenta de novo).
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Tipos, origens e de onde veio ─────────────────────────────────────
ALTER TABLE public."SST_AFASTAMENTO" ADD COLUMN IF NOT EXISTS fonte_ref text;

ALTER TABLE public."SST_AFASTAMENTO" DROP CONSTRAINT IF EXISTS sst_afa_tipo;
ALTER TABLE public."SST_AFASTAMENTO" ADD CONSTRAINT sst_afa_tipo CHECK (tipo IN (
  'atestado', 'atestado_acompanhante', 'acidente_trabalho', 'auxilio_doenca',
  'ferias', 'licenca', 'afastamento', 'desligamento', 'outros'));

ALTER TABLE public."SST_AFASTAMENTO" DROP CONSTRAINT IF EXISTS sst_afa_origem;
ALTER TABLE public."SST_AFASTAMENTO" ADD CONSTRAINT sst_afa_origem CHECK (origem IN (
  'manual', 'senior', 'planilha', 'ferias', 'efetividade'));

-- Situação da Senior → tipo do afastamento. NULL = não é afastamento
-- (Trabalhando, aviso prévio trabalhado, vazio).
CREATE OR REPLACE FUNCTION public.sst_afa_tipo_da_situacao(p_sit text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(btrim(p_sit), '') = '' OR btrim(p_sit) = 'Trabalhando' THEN NULL
    WHEN p_sit ~* 'AVISO' THEN NULL
    WHEN p_sit ~* '^(DEMIT|DESLIG|RESCIS)' THEN 'desligamento'
    WHEN p_sit ~* 'ACIDENT' THEN 'acidente_trabalho'
    WHEN p_sit ~* 'ATEST' AND p_sit ~* '(FILHO|ACOMP)' THEN 'atestado_acompanhante'
    WHEN p_sit ~* 'ATEST' THEN 'atestado'
    WHEN p_sit ~* '(AUX|DOEN|INSS|INVALIDEZ)' THEN 'auxilio_doenca'
    WHEN p_sit ~* 'F[EÉ]RIAS' THEN 'ferias'
    WHEN p_sit ~* '(LICEN|MATERN|PATERN)' THEN 'licenca'
    ELSE 'afastamento'
  END
$$;

-- Último dia do afastamento (inclusive): dias conhecidos → início + dias − 1;
-- encerrado sem dias → véspera do retorno; em aberto → hoje.
CREATE OR REPLACE FUNCTION public.sst_afa_fim(p_ini date, p_dias integer, p_retornou date)
RETURNS date LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_dias IS NOT NULL THEN CASE WHEN p_dias <= 0 THEN p_ini ELSE p_ini + p_dias - 1 END
    WHEN p_retornou IS NOT NULL THEN GREATEST(p_ini, p_retornou - 1)
    ELSE GREATEST(current_date, p_ini)
  END
$$;

-- Os encerrados que ficaram sem dias passam a ter os reais.
UPDATE public."SST_AFASTAMENTO"
   SET dias_atestado = GREATEST(1, retornou_em - data_inicio)
 WHERE dias_atestado IS NULL AND retornou_em IS NOT NULL AND retornou_em > data_inicio;

-- ── 2. Coberturas: mesma conta, com o fim novo ───────────────────────────
CREATE OR REPLACE FUNCTION public.sst_afa_coberturas(p_id bigint)
RETURNS TABLE (dia date, fonte text, substituto text, eh_rt boolean, valor numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH a AS (
    SELECT x.*, x.data_inicio AS ini, public.sst_afa_fim(x.data_inicio, x.dias_considerados, x.retornou_em) AS fim
      FROM public."SST_AFASTAMENTO" x WHERE x.id = p_id
  ),
  rt AS (
    SELECT empresa, cadastro FROM public."RH_POSTO_COLABORADOR"
     WHERE public.sup_norm_nome(planilha_posto) = 'RENDATECNICA'
  )
  SELECT o.data, 'efetividade',
         COALESCE(o.substituto_nome, 'Substituto'),
         EXISTS (SELECT 1 FROM public."EMPREGADOS" s JOIN rt ON rt.empresa = s."Empresa" AND rt.cadastro = s."Cadastro"
                  WHERE s."ID" = o.substituto_empregado_id),
         NULL::numeric
    FROM a JOIN public."OPE_EFET_OCORRENCIA" o
      ON o.empregado_id = a.empregado_id AND o.data BETWEEN a.ini AND a.fim
   WHERE o.status IN ('aceita', 'em_deslocamento', 'aguardando_ponto', 'ponto_confirmado')
     AND (o.substituto_nome IS NOT NULL OR o.substituto_empregado_id IS NOT NULL OR o.substituto_diarista_id IS NOT NULL)
  UNION ALL
  SELECT l.data, 'diaria', d.diarista_nome, false,
         (l.valor_diaria_centavos + l.qt_vt * l.valor_unit_vt_centavos) / 100.0
    FROM a JOIN public."DIARIA_SOLICITACAO" d
      ON (d.faltante_empregado_id = a.empregado_id
          OR (a.cpf IS NOT NULL AND regexp_replace(d.faltante_cpf, '\D', '', 'g') = regexp_replace(a.cpf, '\D', '', 'g')))
    JOIN public."DIARIA_LINHA" l ON l.solicitacao_id = d.id AND l.data BETWEEN a.ini AND a.fim
   WHERE d.status <> 'reprovada'
  UNION ALL
  SELECT g::date, 'registro', ds.substituto_nome, ds.tipo = 'rt',
         CASE WHEN g::date = ds.data THEN ds.valor ELSE 0 END
    FROM public."SST_AFASTAMENTO_DESPESA" ds
    CROSS JOIN LATERAL generate_series(ds.data, ds.data + GREATEST(ds.dias, 1) - 1, interval '1 day') g
   WHERE ds.afastamento_id = p_id;
$fn$;
REVOKE ALL ON FUNCTION public.sst_afa_coberturas(bigint) FROM PUBLIC, anon, authenticated;

-- Horas extras (Sistemas › Hora Extra) de quem é da mesma filial, nos dias do
-- afastamento. É "possível cobertura": a HE não diz quem cobriu — a ficha
-- mostra e quem analisa lança como cobertura com um clique.
CREATE OR REPLACE FUNCTION public.sst_afa_horas_extras(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH a AS (
    SELECT x.id, x.empregado_id, x.filial_nome, x.data_inicio AS ini,
           public.sst_afa_fim(x.data_inicio, x.dias_considerados, x.retornou_em) AS fim
      FROM public."SST_AFASTAMENTO" x WHERE x.id = p_id AND x.filial_nome IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'numero', h.numero, 'data', h.data_he, 'colaborador', h.colaborador_nome, 'status', h.status,
           'minutos', COALESCE(h.total_real_min, h.total_previsto_min),
           'justificativa', h.justificativa,
           'valor_estimado', CASE WHEN public.col_num(e."Valor Salário") > 0
             THEN round(public.col_num(e."Valor Salário") / 220.0 * 1.5 * COALESCE(h.total_real_min, h.total_previsto_min) / 60.0, 2) END)
           ORDER BY h.data_he, h.colaborador_nome), '[]'::jsonb)
    FROM a
    JOIN public."HORA_EXTRA_SOLICITACAO" h ON h.data_he BETWEEN a.ini AND a.fim
    JOIN public."EMPREGADOS" e ON e.auth_user_id = h.colaborador_id
   WHERE h.status IN ('aprovada', 'aguardando_validacao', 'concluida')
     AND e."Nome Filial" = a.filial_nome
     AND e."ID" IS DISTINCT FROM a.empregado_id;
$fn$;
REVOKE ALL ON FUNCTION public.sst_afa_horas_extras(bigint) FROM PUBLIC, anon, authenticated;

-- ── 3. Lista do período (fim novo + fonte_ref) ───────────────────────────
CREATE OR REPLACE FUNCTION public.sst_afa_lista(p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_fin boolean := public.sst_afa_ve_fin(); v_out jsonb;
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  WITH a AS (
    SELECT x.*, public.sst_afa_fim(x.data_inicio, x.dias_considerados, x.retornou_em) AS data_fim
      FROM public."SST_AFASTAMENTO" x
     WHERE x.data_inicio <= p_fim
       AND public.sst_afa_fim(x.data_inicio, x.dias_considerados, x.retornou_em) >= p_ini
  ),
  cob AS (
    SELECT a.id,
           count(DISTINCT c.dia) AS dias_cobertos,
           count(DISTINCT c.dia) FILTER (WHERE c.eh_rt) AS dias_rt,
           COALESCE(sum(c.valor) FILTER (WHERE c.fonte = 'diaria'), 0) AS custo_diarias,
           COALESCE(sum(c.valor) FILTER (WHERE c.fonte = 'registro'), 0) AS custo_registros
      FROM a LEFT JOIN LATERAL public.sst_afa_coberturas(a.id) c ON true
     GROUP BY a.id
  )
  SELECT COALESCE(jsonb_agg(
           to_jsonb(a) - 'chave_importacao' || jsonb_build_object(
             'dias_cobertos', cob.dias_cobertos, 'dias_rt', cob.dias_rt,
             'custo_cobertura', cob.custo_diarias + cob.custo_registros,
             'custo_diarias', cob.custo_diarias)
           || CASE WHEN v_fin THEN jsonb_build_object(
                'valor_mensal_posto', f.valor_mensal_posto, 'salario', f.salario,
                'custo_mensal_posto', f.custo_mensal_posto, 'lucro_mensal', f.lucro_mensal,
                'glosa_valor', f.glosa_valor) ELSE '{}'::jsonb END
           ORDER BY a.data_inicio DESC, a.nome), '[]'::jsonb)
    INTO v_out
    FROM a JOIN cob ON cob.id = a.id
    LEFT JOIN public."SST_AFASTAMENTO_FIN" f ON f.afastamento_id = a.id;
  RETURN jsonb_build_object('ve_financeiro', v_fin, 'itens', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_lista(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_lista(date, date) TO authenticated;

-- ── 4. Ficha (fim novo + horas extras + solicitação de desligamento) ─────
CREATE OR REPLACE FUNCTION public.sst_afa_ficha(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  a      public."SST_AFASTAMENTO"%ROWTYPE;
  v_fin  boolean := public.sst_afa_ve_fin();
  v_fim  date;
  v_out  jsonb;
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  SELECT * INTO a FROM public."SST_AFASTAMENTO" WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_fim := public.sst_afa_fim(a.data_inicio, a.dias_considerados, a.retornou_em);

  v_out := jsonb_build_object(
    'afastamento', to_jsonb(a) - 'chave_importacao',
    'data_fim', v_fim,
    've_financeiro', v_fin,
    'empregado', (SELECT jsonb_build_object('situacao', e."Situação", 'data_afastamento', e."Data Afastamento",
                                            'admissao', e."Admissão", 'telefone', e.telefone)
                    FROM public."EMPREGADOS" e WHERE e."ID" = a.empregado_id),
    'coberturas', COALESCE((SELECT jsonb_agg(jsonb_build_object('dia', c.dia, 'fonte', c.fonte, 'substituto', c.substituto,
                                                                 'eh_rt', c.eh_rt, 'valor', c.valor) ORDER BY c.dia, c.fonte)
                              FROM public.sst_afa_coberturas(p_id) c), '[]'::jsonb),
    'horas_extras', public.sst_afa_horas_extras(p_id),
    'despesas', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.data, d.id) FROM public."SST_AFASTAMENTO_DESPESA" d
                           WHERE d.afastamento_id = p_id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at DESC) FROM public."SST_AFASTAMENTO_EVENTO" ev
                          WHERE ev.afastamento_id = p_id), '[]'::jsonb),
    'desligamento', CASE WHEN a.tipo = 'desligamento' OR a.retorno_status = 'desligado' THEN (
      SELECT jsonb_build_object('id', s.id, 'status', s.status, 'data_solicitacao', s.data_solicitacao,
                                'motivo', COALESCE(s.motivo_solicitacao, s.motivo_pedido), 'solicitante', s.solicitante_nome,
                                'data_aviso', s.data_aviso)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
       WHERE a.empregado_id IS NOT NULL AND s.colaborador_id = a.empregado_id
       ORDER BY s.criado_em DESC LIMIT 1) END,
    'rt', jsonb_build_object(
      'quantidade', COALESCE(a.rt_no_contrato, 0),
      'colaboradores', COALESCE((
        SELECT jsonb_agg(DISTINCT btrim(e."Nome"))
          FROM public."RH_POSTO_COLABORADOR" x
          JOIN public."EMPREGADOS" e ON e."Empresa" = x.empresa AND e."Cadastro" = x.cadastro
         WHERE a.contrato_id IS NOT NULL AND x.contrato_id = a.contrato_id
           AND public.sup_norm_nome(x.planilha_posto) = 'RENDATECNICA'
           AND public.esp_col_esta_ativo(e."Situação")), '[]'::jsonb)),
    'historico_colaborador', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', h.id, 'protocolo', h.protocolo, 'data_inicio', h.data_inicio, 'tipo', h.tipo,
                                          'dias', h.dias_considerados, 'tele_status', h.tele_status) ORDER BY h.data_inicio DESC)
        FROM public."SST_AFASTAMENTO" h
       WHERE h.id <> a.id AND NOT h.cancelado
         AND ((a.empregado_id IS NOT NULL AND h.empregado_id = a.empregado_id)
              OR (a.empregado_id IS NULL AND public.rh_norm_nome(h.nome) = public.rh_norm_nome(a.nome)))), '[]'::jsonb));

  IF v_fin THEN
    v_out := v_out || jsonb_build_object(
      'financeiro', (SELECT to_jsonb(f) FROM public."SST_AFASTAMENTO_FIN" f WHERE f.afastamento_id = p_id),
      'notas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'competencia', n.competencia, 'numero_nf', n.numero_nf, 'status', n.status,
                 'bruto', n.vlr_bruto_total, 'liquido', n.vlr_liquido_total,
                 'faltas', (SELECT COALESCE(sum(i.faltas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id),
                 'glosas', (SELECT COALESCE(sum(i.glosas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id),
                 'outros_descontos', (SELECT COALESCE(sum(i.posto_nao_implementado + i.multas + i.outros_descontos), 0)
                                        FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id))
                 ORDER BY n.competencia)
          FROM public.nf_emissao n
         WHERE a.contrato_id IS NOT NULL AND n.contrato_id = a.contrato_id
           AND n.deleted_at IS NULL AND n.status::text NOT ILIKE 'cancel%'
           AND date_trunc('month', n.competencia) BETWEEN date_trunc('month', a.data_inicio) AND date_trunc('month', v_fim)),
        '[]'::jsonb));
  END IF;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_ficha(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_ficha(bigint) TO authenticated;

-- ── 5. Faturamento realizado por contrato e competência ──────────────────
CREATE OR REPLACE FUNCTION public.sst_afa_faturamento(p_ini date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.sst_afa_exige('visualizar');
  IF NOT public.sst_afa_ve_fin() THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('contrato_id', t.contrato_id, 'competencia', t.comp,
                                        'bruto', t.bruto, 'liquido', t.liquido, 'faltas', t.faltas, 'glosas', t.glosas))
      FROM (
        SELECT n.contrato_id, to_char(date_trunc('month', n.competencia), 'YYYY-MM') AS comp,
               sum(n.vlr_bruto_total) AS bruto, sum(n.vlr_liquido_total) AS liquido,
               sum((SELECT COALESCE(sum(i.faltas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id)) AS faltas,
               sum((SELECT COALESCE(sum(i.glosas), 0) FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id)) AS glosas
          FROM public.nf_emissao n
         WHERE n.contrato_id IS NOT NULL AND n.deleted_at IS NULL AND n.status::text NOT ILIKE 'cancel%'
           AND date_trunc('month', n.competencia) BETWEEN date_trunc('month', p_ini) AND date_trunc('month', p_fim)
         GROUP BY 1, 2) t), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_faturamento(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_faturamento(date, date) TO authenticated;

-- ── 6. Captura: Férias do ERP, Efetividade, situação e desligamentos ─────
-- Insere um afastamento capturado (sem duplicar pela chave) e já resolve a
-- lotação na data. Devolve o id novo ou NULL se já existia.
CREATE OR REPLACE FUNCTION public.sst_afa_inserir_capturado(
  p_chave text, p_emp bigint, p_ini date, p_dias integer, p_tipo text, p_origem text,
  p_situacao text, p_fonte_ref text, p_retornou date, p_evento text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  e    public."EMPREGADOS"%ROWTYPE;
  v_id bigint;
BEGIN
  SELECT * INTO e FROM public."EMPREGADOS" WHERE "ID" = p_emp;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public."SST_AFASTAMENTO" (
    empregado_id, nome, cpf, data_inicio, dias_atestado, origem, situacao_senior, tipo, fonte_ref,
    tele_status, retorno_status, retornou_em, chave_importacao, created_by_nome)
  VALUES (
    p_emp, btrim(e."Nome"), e."CPF", p_ini, p_dias, p_origem, p_situacao, p_tipo, p_fonte_ref,
    -- Telemedicina é para atestado; férias, licença e desligamento não passam por ela.
    CASE WHEN p_tipo IN ('atestado', 'atestado_acompanhante', 'acidente_trabalho') THEN 'nao_avaliado' ELSE 'nao_se_aplica' END,
    CASE WHEN p_tipo = 'desligamento' THEN 'desligado'
         WHEN p_retornou IS NOT NULL AND p_retornou <= current_date THEN 'retornou'
         ELSE 'aguardando' END,
    CASE WHEN p_tipo <> 'desligamento' AND p_retornou <= current_date THEN p_retornou END,
    p_chave, 'Captura automática')
  ON CONFLICT (chave_importacao) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  PERFORM public.sst_afa_aplicar_lotacao(v_id);
  INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
  VALUES (v_id, 'criado', p_evento, 'Captura automática');
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_inserir_capturado(text, bigint, date, integer, text, text, text, text, date, text) FROM PUBLIC, anon, authenticated;

-- Já há afastamento (não cancelado) do colaborador que encosta no período?
CREATE OR REPLACE FUNCTION public.sst_afa_tem_sobreposto(p_emp bigint, p_ini date, p_fim date, p_folga integer DEFAULT 0)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."SST_AFASTAMENTO" x
     WHERE x.empregado_id = p_emp AND NOT x.cancelado
       AND x.data_inicio <= p_fim + p_folga
       AND public.sst_afa_fim(x.data_inicio, x.dias_considerados, x.retornou_em) >= p_ini - p_folga)
$$;
REVOKE ALL ON FUNCTION public.sst_afa_tem_sobreposto(bigint, date, date, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sst_afa_capturar_senior()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ferias int := 0;
  v_efet   int := 0;
  v_sit    int := 0;
  v_desl   int := 0;
  v_ret    int := 0;
  v_pror   int := 0;
  v_saiu   int := 0;
  r        record;
  v_tipo   text;
  v_dias   int;
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.sst_afa_exige('alterar'); END IF;

  -- a. Férias aprovadas no ERP (Central de Serviços / RH › Férias).
  FOR r IN
    SELECT f.id, e."ID" AS emp, f.data_saida AS ini,
           COALESCE(nullif(f.data_retorno - f.data_saida, 0),
                    nullif(COALESCE(f.dias_ferias, 30) - COALESCE(f.dias_vendidos, 0), 0), 30) AS dias,
           f.data_retorno
      FROM public."SISTEMA_SOLICITACOES_FERIAS" f
      JOIN LATERAL (
        SELECT x."ID" FROM public."EMPREGADOS" x
         WHERE x."ID" = f.colaborador_id
            OR (f.colaborador_id IS NULL AND f.colaborador_cpf IS NOT NULL
                AND regexp_replace(COALESCE(x."CPF", ''), '\D', '', 'g') = regexp_replace(f.colaborador_cpf, '\D', '', 'g'))
         ORDER BY (x."ID" = f.colaborador_id) DESC NULLS LAST LIMIT 1) e ON true
     WHERE f.status = 'Aprovada' AND f.data_saida IS NOT NULL
       AND f.data_saida >= current_date - 365
       AND NOT EXISTS (SELECT 1 FROM public."SST_AFASTAMENTO" x WHERE x.chave_importacao = 'ferias|' || f.id)
  LOOP
    v_dias := GREATEST(1, r.dias);
    IF public.sst_afa_tem_sobreposto(r.emp, r.ini, r.ini + v_dias - 1, 2) THEN CONTINUE; END IF;
    IF public.sst_afa_inserir_capturado('ferias|' || r.id, r.emp, r.ini, v_dias, 'ferias', 'ferias', NULL,
         'Solicitação de férias #' || r.id, COALESCE(r.data_retorno, r.ini + v_dias),
         'Férias aprovadas no ERP (solicitação #' || r.id || '): ' || to_char(r.ini, 'DD/MM/YYYY') || ', ' || v_dias || ' dia(s).') IS NOT NULL THEN
      v_ferias := v_ferias + 1;
    END IF;
  END LOOP;

  -- b. Ausências registradas na Efetividade: dias seguidos do mesmo motivo
  --    viram um afastamento (falta solta não é afastamento e fica de fora).
  FOR r IN
    WITH o AS (
      SELECT empregado_id AS emp, motivo, data,
             data - (row_number() OVER (PARTITION BY empregado_id, motivo ORDER BY data))::int AS grupo
        FROM public."OPE_EFET_OCORRENCIA"
       WHERE empregado_id IS NOT NULL AND motivo IN ('atestado', 'afastamento', 'ferias')
         AND status <> 'cancelada' AND data >= current_date - 365
    )
    SELECT emp, motivo, min(data) AS ini, max(data) AS fim, count(*)::int AS dias
      FROM o GROUP BY emp, motivo, grupo
  LOOP
    IF EXISTS (SELECT 1 FROM public."SST_AFASTAMENTO" x WHERE x.chave_importacao = 'efet|' || r.emp || '|' || r.ini) THEN CONTINUE; END IF;
    IF public.sst_afa_tem_sobreposto(r.emp, r.ini, r.fim, 1) THEN CONTINUE; END IF;
    IF public.sst_afa_inserir_capturado('efet|' || r.emp || '|' || r.ini, r.emp, r.ini, r.dias,
         CASE r.motivo WHEN 'ferias' THEN 'ferias' WHEN 'afastamento' THEN 'afastamento' ELSE 'atestado' END,
         'efetividade', NULL, 'Efetividade: ' || r.dias || ' dia(s)',
         CASE WHEN r.fim < current_date THEN r.fim + 1 END,
         'Ausência registrada na Efetividade (' || r.motivo || '): ' || to_char(r.ini, 'DD/MM/YYYY') || ' a ' || to_char(r.fim, 'DD/MM/YYYY') || '.') IS NOT NULL THEN
      v_efet := v_efet + 1;
    END IF;
  END LOOP;

  -- c. Situação ATUAL da Senior (toda situação de afastamento, sem corte de
  --    data: quem está afastado hoje está afastado no período que se olhar).
  -- d. Desligados dos últimos 180 dias (Data Afastamento = data da demissão).
  FOR r IN
    SELECT e."ID" AS emp, e."Situação" AS sit, public.sst_afa_tipo_da_situacao(e."Situação") AS tipo,
           public.rh_data(e."Data Afastamento"::text) AS ini
      FROM public."EMPREGADOS" e
     WHERE public.sst_afa_tipo_da_situacao(e."Situação") IS NOT NULL
       AND public.rh_data(e."Data Afastamento"::text) IS NOT NULL
       AND public.rh_data(e."Data Afastamento"::text) <= current_date
       AND (public.sst_afa_tipo_da_situacao(e."Situação") <> 'desligamento'
            OR public.rh_data(e."Data Afastamento"::text) >= current_date - 180)
  LOOP
    IF EXISTS (SELECT 1 FROM public."SST_AFASTAMENTO" x
                WHERE x.chave_importacao = 'senior|' || r.emp || '|' || r.ini || '|' || r.tipo) THEN CONTINUE; END IF;
    IF r.tipo = 'desligamento' THEN
      -- O desligamento é um evento (0 dia); o que conta é não repetir.
      IF EXISTS (SELECT 1 FROM public."SST_AFASTAMENTO" x
                  WHERE x.empregado_id = r.emp AND x.tipo = 'desligamento' AND NOT x.cancelado
                    AND x.data_inicio BETWEEN r.ini - 3 AND r.ini + 3) THEN CONTINUE; END IF;
      IF public.sst_afa_inserir_capturado('senior|' || r.emp || '|' || r.ini || '|' || r.tipo, r.emp, r.ini, 0,
           'desligamento', 'senior', r.sit, 'Senior: ' || r.sit, NULL,
           'Desligamento na Senior ("' || r.sit || '") em ' || to_char(r.ini, 'DD/MM/YYYY') || '.') IS NOT NULL THEN
        v_desl := v_desl + 1;
      END IF;
    ELSE
      -- Já registrado por outra fonte com início próximo (ex.: as férias do
      -- ERP que a Senior mostra agora) → não duplica.
      IF EXISTS (SELECT 1 FROM public."SST_AFASTAMENTO" x
                  WHERE x.empregado_id = r.emp AND NOT x.cancelado
                    AND x.data_inicio BETWEEN r.ini - 3 AND r.ini + 3) THEN CONTINUE; END IF;
      IF public.sst_afa_inserir_capturado('senior|' || r.emp || '|' || r.ini || '|' || r.tipo, r.emp, r.ini, NULL,
           r.tipo, 'senior', r.sit, 'Senior: ' || r.sit, NULL,
           'Capturado da Senior: situação "' || r.sit || '" desde ' || to_char(r.ini, 'DD/MM/YYYY') || '.') IS NOT NULL THEN
        v_sit := v_sit + 1;
      END IF;
    END IF;
  END LOOP;

  -- Retorno / troca de situação dos que estão aguardando.
  FOR r IN
    SELECT x.id, x.data_inicio, x.dias_considerados, x.tipo, e."Situação" AS sit,
           public.sst_afa_tipo_da_situacao(e."Situação") AS tipo_atual,
           public.rh_data(e."Data Afastamento"::text) AS dafa
      FROM public."SST_AFASTAMENTO" x
      JOIN public."EMPREGADOS" e ON e."ID" = x.empregado_id
     WHERE x.retorno_status = 'aguardando' AND NOT x.cancelado AND x.tipo <> 'desligamento'
       AND x.data_inicio <= current_date - 1
  LOOP
    IF r.tipo_atual IS NULL THEN
      -- Voltou a trabalhar (ou está em aviso trabalhando).
      UPDATE public."SST_AFASTAMENTO" SET retorno_status = 'retornou',
             retornou_em = CASE WHEN r.dias_considerados IS NOT NULL
                                THEN LEAST(r.data_inicio + GREATEST(r.dias_considerados, 1), current_date) ELSE current_date END,
             dias_atestado = COALESCE(dias_atestado, GREATEST(1, current_date - r.data_inicio))
       WHERE id = r.id;
      INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
      VALUES (r.id, 'retorno', 'Situação na Senior voltou a "' || r.sit || '".', 'Captura automática');
      v_ret := v_ret + 1;
    ELSIF r.tipo_atual = 'desligamento' THEN
      IF r.dafa IS NULL OR r.dafa >= r.data_inicio THEN
        UPDATE public."SST_AFASTAMENTO" SET retorno_status = 'desligado', retornou_em = r.dafa,
               dias_atestado = COALESCE(dias_atestado, GREATEST(1, COALESCE(r.dafa, current_date) - r.data_inicio))
         WHERE id = r.id;
        INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
        VALUES (r.id, 'retorno', 'Colaborador desligado na Senior (' || r.sit || ').', 'Captura automática');
        v_saiu := v_saiu + 1;
      END IF;
    ELSIF r.dafa IS NOT NULL AND r.dafa > r.data_inicio + 3 AND r.dias_considerados IS NULL THEN
      -- Emendou outro afastamento (atestado → auxílio-doença): este fecha
      -- na véspera do novo, que a captura acima já abriu.
      UPDATE public."SST_AFASTAMENTO" SET retorno_status = 'prorrogado',
             dias_atestado = GREATEST(1, r.dafa - r.data_inicio)
       WHERE id = r.id;
      INSERT INTO public."SST_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
      VALUES (r.id, 'retorno', 'Emendou outro afastamento na Senior ("' || r.sit || '" desde ' || to_char(r.dafa, 'DD/MM/YYYY') || ').', 'Captura automática');
      v_pror := v_pror + 1;
    END IF;
  END LOOP;

  -- Mantém as chaves do botão antigo (novos/retornos/desligados) e detalha.
  RETURN jsonb_build_object(
    'novos', v_ferias + v_efet + v_sit + v_desl, 'retornos', v_ret, 'desligados', v_saiu + v_desl,
    'ferias', v_ferias, 'efetividade', v_efet, 'situacao_senior', v_sit, 'desligamentos', v_desl, 'prorrogados', v_pror);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_afa_capturar_senior() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_afa_capturar_senior() TO authenticated, service_role;

-- Agenda (a mesma da 001750; refeita aqui para a captura nova valer mesmo se
-- aquela tiver entrado sem pg_cron).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - captura automática não agendada (esperado na réplica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sst-afastamentos-senior') THEN
    PERFORM cron.unschedule('sst-afastamentos-senior');
  END IF;
  PERFORM cron.schedule('sst-afastamentos-senior', '25 * * * *', 'SELECT public.sst_afa_capturar_senior()');
END $$;

-- ── 7. Carga inicial ─────────────────────────────────────────────────────
-- Falha aqui não derruba a migration: as funções ficam, e o cron (ou o botão
-- "Trazer da Senior") roda de novo.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.sst_afa_capturar_senior();
  RAISE NOTICE 'Carga inicial de afastamentos: %', v;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Carga inicial de afastamentos falhou (o cron tenta de novo): %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public."SST_AFASTAMENTO" WHERE origem IN ('ferias', 'efetividade')
--    OR tipo IN ('ferias', 'licenca', 'afastamento', 'desligamento');
-- ALTER TABLE public."SST_AFASTAMENTO" DROP CONSTRAINT IF EXISTS sst_afa_tipo;
-- ALTER TABLE public."SST_AFASTAMENTO" ADD CONSTRAINT sst_afa_tipo CHECK (tipo IN ('atestado', 'atestado_acompanhante', 'acidente_trabalho', 'auxilio_doenca', 'outros'));
-- ALTER TABLE public."SST_AFASTAMENTO" DROP CONSTRAINT IF EXISTS sst_afa_origem;
-- ALTER TABLE public."SST_AFASTAMENTO" ADD CONSTRAINT sst_afa_origem CHECK (origem IN ('manual', 'senior', 'planilha'));
-- ALTER TABLE public."SST_AFASTAMENTO" DROP COLUMN IF EXISTS fonte_ref;
-- DROP FUNCTION IF EXISTS public.sst_afa_faturamento(date, date), public.sst_afa_horas_extras(bigint),
--   public.sst_afa_inserir_capturado(text, bigint, date, integer, text, text, text, text, date, text),
--   public.sst_afa_tem_sobreposto(bigint, date, date, integer), public.sst_afa_tipo_da_situacao(text);
-- (sst_afa_fim é usada pelas versões novas de sst_afa_lista/ficha/coberturas/capturar_senior:
--  reaplicar as da 20261029001750 antes de removê-la.)
