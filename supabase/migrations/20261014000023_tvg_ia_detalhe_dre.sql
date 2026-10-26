-- =========================================================================
-- TVs GERENCIAIS: I.A ENXERGA O DRE POR CONTA (14/10/2026)
--
-- Pablo, no chat da I.A de "Variação do custo direto": perguntou o que
-- provocou a alta de 594,2% em BENTO GONÇALVES 048/2026 e a I.A respondeu
-- "consulte o DRE analítico junto à Controladoria". Ela só recebia o TOTAL
-- por contrato (tvg_dre_mv) e o SQL — a resposta estava na mesa ao lado:
-- em 04/2026 entraram R$ 88 mil de "Salários operacionais" e R$ 18,6 mil de
-- "Vale alimentação", contas que nem existiam em 03/2026 (único mês anterior,
-- contrato novo).
--
-- tvg_ia_detalhe(codigo) devolve, para os indicadores do DRE, o custo de
-- cada contrato do gráfico ABERTO POR CONTA (conta_debito_nome) em cada
-- competência da conta (a atual e as anteriores), mais receita e nº de
-- lançamentos. Só leitura de mz_60_view_dre_gerencial_competencia — a mesma
-- origem que já está na TV, só que sem somar. Portão: o mesmo de tvg_fonte.
-- Indicador que não é do DRE devolve NULL (a Edge segue como antes).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  alvo text; v_comp text; comps text[]; nomes text[]; r jsonb;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT CASE WHEN fonte = 'espelho' THEN espelho_de ELSE codigo END INTO alvo FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF alvo IS NULL OR alvo NOT IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes', 'pre_lucratividade', 'pre_vermelhos') THEN
    RETURN NULL;
  END IF;

  v_comp := public.tvg_dre_competencia();
  IF v_comp IS NULL THEN RETURN NULL; END IF;
  -- A competência da conta e as 3 anteriores — a janela que tvg_calc_extra usa.
  comps := ARRAY(SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4);
  -- Os contratos que o gráfico mostra (detalhe do resultado), na mesma ordem.
  nomes := ARRAY(SELECT x->>'nome' FROM jsonb_array_elements(coalesce(public.tvg_indicador_dados(p_codigo)#>'{indicador,resultado,detalhe}', '[]'::jsonb)) x
                  WHERE x->>'nome' IS NOT NULL LIMIT 12);
  IF cardinality(nomes) = 0 THEN RETURN NULL; END IF;

  WITH l AS (
    SELECT COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') AS contrato, d.periodo_competencia AS comp, d.linha_dre,
           coalesce(NULLIF(btrim(d.conta_debito_nome), ''), '(sem conta)') AS conta, public.tvg_num_ponto(d.valor_dre) AS v
      FROM public.mz_60_view_dre_gerencial_competencia d
     WHERE d.periodo_competencia = ANY (comps)
       AND COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') = ANY (nomes)
       AND d.linha_dre IN ('CUSTO', 'RECEITA')),
  contas AS (  -- custo por conta e competência (positivo = gasto)
    SELECT contrato, conta, comp, round(-sum(v), 2) AS valor, count(*) AS lanc FROM l WHERE linha_dre = 'CUSTO' GROUP BY 1, 2, 3),
  por_conta AS (
    SELECT contrato, conta,
           jsonb_object_agg(comp, jsonb_build_object('valor', valor, 'lancamentos', lanc)) AS por_competencia,
           coalesce(sum(valor) FILTER (WHERE comp = v_comp), 0) AS atual
      FROM contas GROUP BY 1, 2),
  totais AS (
    SELECT contrato, comp,
           round(-sum(v) FILTER (WHERE linha_dre = 'CUSTO'), 2) AS custo,
           round(sum(v) FILTER (WHERE linha_dre = 'RECEITA'), 2) AS receita,
           count(*) FILTER (WHERE linha_dre = 'CUSTO') AS lanc_custo
      FROM l GROUP BY 1, 2)
  SELECT jsonb_build_object(
    'competencia_atual', v_comp,
    'competencias_janela', to_jsonb(comps),
    'observacao', 'Valores em R$ do DRE gerencial (mz_60_view_dre_gerencial_competencia), custo por conta de débito. Competência sem linha = nenhum lançamento naquele mês (contrato novo, encerrado ou carga incompleta).',
    'contratos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'contrato', n.nome,
               'totais_por_competencia', (SELECT jsonb_object_agg(t.comp, jsonb_build_object('custo', t.custo, 'receita', t.receita, 'lancamentos_custo', t.lanc_custo))
                                            FROM totais t WHERE t.contrato = n.nome),
               'custo_por_conta', (SELECT jsonb_agg(jsonb_build_object('conta', p.conta, 'por_competencia', p.por_competencia) ORDER BY abs(p.atual) DESC)
                                     FROM (SELECT * FROM por_conta p WHERE p.contrato = n.nome ORDER BY abs(p.atual) DESC LIMIT 12) p))
             ORDER BY n.ord)
        FROM unnest(nomes) WITH ORDINALITY AS n(nome, ord)), '[]'::jsonb))
    INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_ia_detalhe(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tvg_ia_detalhe(text);
