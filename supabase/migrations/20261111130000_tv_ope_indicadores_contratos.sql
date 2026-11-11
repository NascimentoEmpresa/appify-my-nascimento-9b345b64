-- =========================================================================
-- TV › OPERACIONAL — INDICADORES POR CONTRATO (11/11/2026)
--
-- Pablo: "era pra TV isso, era só uma playlist da tv com gráficos. Monta a
-- playlist da TV Operacional INDICADORES POR CONTRATO, aí vai passando de
-- contrato a contrato a cada 10 seg essas informações" — e "já coloca na TV
-- Operacional pra mim a tocar essa playlist". A Helena pediu pelo menos os 5
-- mais impactantes: a TV abre com os 5 piores e depois passa um a um.
--
-- O QUE ENTRA
--   1. Relatório de TV novo, 'ope-contratos': os 7 indicadores da tela
--      Operacional › Indicadores por Contrato (mig 20261111100000), um contrato
--      por tela.
--   2. A parte FINANCEIRA que a tela faz no navegador (lucratividade e custo
--      realizado, pela conta de Controladoria › Faturamento da Empresa) agora
--      também no banco — a TV não tem login para ler as notas e o Fluxo de
--      Caixa. A mesma regra:
--        receita = Valor Líquido das notas (código N) da competência, sem
--                  rascunho/enviada/cancelada/substituída (regras.ts +
--                  nf-emissao/shared: contaNoFaturamento);
--        custo   = SAÍDAS com contrato das 6 fontes do Fluxo de Caixa, pela
--                  competência (sem competência, pelo pagamento) —
--                  useCustosContratoMes.ts. Contratos fora das despesas
--                  (investimento, administrativo…) não aparecem na TV.
--   3. POR QUE A LUCRATIVIDADE VINHA VAZIA na tela: a competência padrão é o
--      mês corrente/anterior, e o faturamento de um mês só fica completo no
--      mês seguinte (em 11/11/2026: out com 121 notas, set com 205, ago com
--      219). A TV usa a ÚLTIMA COMPETÊNCIA FECHADA: a mais recente com pelo
--      menos 80% das notas do mês anterior a ela. Todos os indicadores da TV
--      ficam nessa mesma competência (postos são sempre a posição de hoje).
--   4. Playlist "Operacional — Indicadores por Contrato" com esse item, e a
--      TV OPERACIONAL passa a tocá-la (a playlist antiga, com a TV gerencial,
--      fica guardada — voltar é trocar a playlist na Gestão das TV's).
--
-- PRIVACIDADE: só números por contrato; nenhum nome de pessoa vai para a TV.
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Relatório novo no item ────────────────────────────────────────────
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    (relatorio = ANY (ARRAY['geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                            'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover', 'vagas', 'licitacoes', 'treinamentos',
                            'ger-operacional', 'ger-licitacoes', 'ger-supply', 'ger-frota', 'ger-recrutamento', 'ger-rh', 'ger-sst',
                            'ger-treinamento', 'ger-financeiro', 'ger-juridico', 'ger-controladoria', 'ger-ti', 'ger-presidencia',
                            'ope-contratos'])
     OR relatorio ~ '^ind:[a-z0-9_]+$'
     OR relatorio ~ '^bi:[0-9]+$')
    AND COALESCE(rel_periodo, '12m') = ANY (ARRAY['mes', '3m', '6m', '12m', 'ano'])));

-- ── 2) Lucratividade e custo realizado no banco ──────────────────────────
-- Competência fechada: a mais recente (até 6 meses) com notas >= 80% das do mês anterior.
CREATE OR REPLACE FUNCTION public.ope_competencia_fechada()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH n AS (
    SELECT to_char(competencia, 'YYYY-MM') AS m, count(*) AS qtd
      FROM public.nf_emissao
     WHERE deleted_at IS NULL AND tipo_nota = 'N'
       AND status::text NOT IN ('rascunho', 'enviada', 'cancelada')
       AND competencia >= (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '7 months')::date
       AND competencia <  (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 month')::date
     GROUP BY 1)
  SELECT coalesce(
    (SELECT a.m FROM n a
       LEFT JOIN n b ON b.m = to_char(to_date(a.m || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM')
      WHERE b.qtd IS NOT NULL AND a.qtd >= 0.8 * b.qtd
      ORDER BY a.m DESC LIMIT 1),
    to_char((now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month', 'YYYY-MM'))
$$;
REVOKE ALL ON FUNCTION public.ope_competencia_fechada() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ope_contratos_financeiro(p_competencia text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_ini date := to_date(p_competencia || '-01', 'YYYY-MM-DD');
  v_fim date := (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  v_ano date := date_trunc('year', to_date(p_competencia || '-01', 'YYYY-MM-DD'))::date;
  v_sql text := '';
  v text;
  v_receita jsonb; v_custo jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(contrato_id, round(r, 2)), '{}'::jsonb) INTO v_receita
    FROM (SELECT contrato_id::text, sum(coalesce(vlr_liquido_total, 0)) AS r
            FROM public.nf_emissao
           WHERE deleted_at IS NULL AND tipo_nota = 'N' AND contrato_id IS NOT NULL
             AND status::text NOT IN ('rascunho', 'enviada', 'cancelada')
             AND upper(coalesce(situacao_site_pmt, '') || ' ' || coalesce(situacao_dominio, '')) !~ '(CANCEL|SUBSTITU)'
             AND competencia >= v_ini AND competencia < v_fim
           GROUP BY 1) x;

  -- As 6 fontes do Fluxo de Caixa (as que existirem neste banco).
  FOREACH v IN ARRAY ARRAY['v_malote_pagamento_fluxo_caixa', 'v_debito_automatico_fluxo_caixa', 'v_cartao_fatura_fluxo_caixa',
                           'v_aplicacao_financeira_fluxo_caixa', 'v_aplicacao_financeira_resgate_fluxo_caixa',
                           'v_fluxo_caixa_importado_fluxo_caixa'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      v_sql := v_sql || CASE WHEN v_sql = '' THEN '' ELSE ' UNION ALL ' END
        || format('SELECT contrato_id::text AS c, to_char(coalesce(competencia, data_pagamento), ''YYYY-MM'') AS m, valor::numeric AS v FROM public.%I '
                  || 'WHERE tipo = ''saida'' AND contrato_id IS NOT NULL AND coalesce(competencia, data_pagamento) >= %L AND coalesce(competencia, data_pagamento) < %L',
                  v, v_ano, v_fim);
    END IF;
  END LOOP;
  IF v_sql = '' THEN
    v_custo := '{}'::jsonb;
  ELSE
    EXECUTE 'SELECT coalesce(jsonb_object_agg(c || ''|'' || m, round(t, 2)), ''{}''::jsonb) FROM (SELECT c, m, sum(v) AS t FROM ('
            || v_sql || ') u GROUP BY c, m HAVING sum(v) > 0) z' INTO v_custo;
  END IF;

  RETURN jsonb_build_object('competencia', p_competencia, 'receita', v_receita, 'custo_por_mes', v_custo);
END $fn$;
REVOKE ALL ON FUNCTION public.ope_contratos_financeiro(text) FROM PUBLIC, anon, authenticated;

-- O que a TV recebe: os 7 indicadores da competência fechada + o financeiro.
CREATE OR REPLACE FUNCTION public.tv_ope_contratos_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_comp text := public.ope_competencia_fechada();
BEGIN
  RETURN public.ope_contratos_ind_dados(v_comp)
         || jsonb_build_object('financeiro', public.ope_contratos_financeiro(v_comp));
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_dados() FROM PUBLIC, anon, authenticated;

-- Prévia da Gestão das TV's (com login): quem vê a tela de origem.
CREATE OR REPLACE FUNCTION public.tv_ope_contratos_previa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'ope_indicadores_contratos', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores por Contrato.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tv_ope_contratos_dados();
END $fn$;
REVOKE ALL ON FUNCTION public.tv_ope_contratos_previa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tv_ope_contratos_previa() TO authenticated;

-- ── 3) tv_relatorio com o relatório novo ─────────────────────────────────
-- Mesmo corpo da mig 20261020000006, com o ramo 'ope-contratos'.
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
  v_ano int; v_meses int[]; v_filial text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio LIKE 'ger-%' THEN
    v_out := jsonb_build_object('tipo', 'gerencial') || public.tvg_painel_dados(i.relatorio)
             || jsonb_build_object('equipe', public.tvg_equipe_meta(i.relatorio));
  ELSIF i.relatorio LIKE 'ind:%' THEN
    v_out := jsonb_build_object('tipo', 'indicador') || coalesce(public.tvg_indicador_dados(substr(i.relatorio, 5)), '{}'::jsonb);
  ELSIF i.relatorio LIKE 'bi:%' THEN
    v_out := jsonb_build_object('tipo', 'bi') || public.tv_bi_dados(substr(i.relatorio, 4)::bigint);
  ELSIF i.relatorio = 'ope-contratos' THEN
    v_out := jsonb_build_object('tipo', 'ope-contratos') || public.tv_ope_contratos_dados();
  ELSIF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSIF i.relatorio = 'vagas' THEN
    v_out := jsonb_build_object('tipo', 'vagas', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
                                'painel', public.dir_vagas_painel_dados(v_de, v_ate, i.rel_contrato, NULL));
  ELSIF i.relatorio = 'turnover' THEN
    v_ano := extract(year FROM v_ate)::int;
    v_meses := ARRAY(SELECT m FROM generate_series(1, 12) m
                      WHERE make_date(v_ano, m, 1) BETWEEN date_trunc('month', v_de)::date AND v_ate);
    v_filial := public.dir_turnover_filial(i.rel_contrato);
    v_out := jsonb_build_object('tipo', 'turnover', 'filial', v_filial,
                                'painel', public.dir_turnover_painel_dados(v_ano, NULL, v_filial, NULL, v_meses));
  ELSIF i.relatorio = 'licitacoes' THEN
    v_out := jsonb_build_object('tipo', 'licitacoes') || public.tv_licitacao_dados();
  ELSIF i.relatorio = 'treinamentos' THEN
    v_out := jsonb_build_object('tipo', 'treinamentos', 'painel', public.trn_dashboard_dados(NULL, NULL, NULL));
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $function$;
REVOKE ALL ON FUNCTION public.tv_relatorio(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text,uuid) TO anon,authenticated,service_role;

-- ── 4) A playlist e a TV Operacional tocando ela ─────────────────────────
DO $$
DECLARE v_pl uuid;
BEGIN
  SELECT id INTO v_pl FROM public."TV_PLAYLIST" WHERE nome = 'Operacional — Indicadores por Contrato' LIMIT 1;
  IF v_pl IS NULL THEN
    INSERT INTO public."TV_PLAYLIST" (nome, descricao)
    VALUES ('Operacional — Indicadores por Contrato',
            'Os 7 indicadores da Gerência Operacional: os 5 contratos que mais pedem atenção e depois um contrato a cada 10 segundos.')
    RETURNING id INTO v_pl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TV_ITEM" WHERE playlist_id = v_pl AND relatorio = 'ope-contratos') THEN
    -- Um item só: a TV gira os contratos dentro dele, 10 s cada (TvRelatorio.tsx).
    INSERT INTO public."TV_ITEM" (playlist_id, ordem, tipo, titulo, relatorio, duracao_seg, ativo)
    VALUES (v_pl, 10, 'relatorio', 'Indicadores por Contrato', 'ope-contratos', 3600, true);
  END IF;
  -- A TV OPERACIONAL (cadastrada como "TV OPERACIONALL", local Escritório).
  UPDATE public."TV_DISPOSITIVO" SET playlist_id = v_pl
   WHERE ativo AND (id = '6952b0b7-c4e4-4cd8-873f-ffcc6fe1a841'::uuid
                    OR upper(btrim(coalesce(nome, ''))) IN ('TV OPERACIONAL', 'TV OPERACIONALL'));
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."TV_DISPOSITIVO" SET playlist_id = (SELECT id FROM public."TV_PLAYLIST" WHERE nome = 'TV OPERACIONAL' LIMIT 1)
--  WHERE id = '6952b0b7-c4e4-4cd8-873f-ffcc6fe1a841'::uuid;
-- DELETE FROM public."TV_PLAYLIST" WHERE nome = 'Operacional — Indicadores por Contrato';   -- os itens vão junto (CASCADE)
-- (reexecutar o CREATE de tv_relatorio da mig 20261020000006 e o tv_item_relatorio_check da 20261014000012)
-- DROP FUNCTION IF EXISTS public.tv_ope_contratos_previa();
-- DROP FUNCTION IF EXISTS public.tv_ope_contratos_dados();
-- DROP FUNCTION IF EXISTS public.ope_contratos_financeiro(text);
-- DROP FUNCTION IF EXISTS public.ope_competencia_fechada();
-- NOTIFY pgrst, 'reload schema';
