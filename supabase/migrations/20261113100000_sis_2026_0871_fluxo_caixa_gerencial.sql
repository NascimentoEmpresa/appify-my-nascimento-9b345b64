-- SIS-2026-0871 — Fluxo de Caixa Gerencial (Financeiro, pedido do Ruan): menu + RPC de totais
-- ============================================================================
-- A tela /app/financeiro/fluxo-caixa-gerencial junta indicadores de VÁRIAS fontes. Só o que vem do Fluxo de Caixa precisa de servidor, porque
-- o Fluxo tem ~25 mil linhas (~18 MB de JSON) e somar no navegador é justamente o que derrubou a API em 03/11/2026 (ver useFluxoCaixaMalote.ts).
-- O resto (notas, aplicações, conta garantida) a tela soma no front com os MESMOS hooks/regras do Relatório de Serviços, Aplicações e Conta
-- Garantida, para os números baterem com essas telas.
--
-- 1) MENU "fluxo-caixa-gerencial" em Financeiro (acesso por pessoa em /app/administracao?tab=modulos; deny-by-default; perfis "concede tudo"
--    já alcançam).
-- 2) financeiro_fluxo_gerencial(p_ini, p_fim, p_empresa, p_contrato) → jsonb com:
--      despesas_pagas / qtd_despesas / malote_pago  (no período, já pagas: data <= hoje),
--      por_mes   (despesas dos 12 meses que terminam em p_fim),
--      composicao (despesas do período por classificação),
--      projecao  (d30/d60/d90 a partir de hoje: recebimentos e pagamentos previstos).
--    "Despesa paga" = SAÍDA realizada que NÃO é movimentação financeira. Ficam de fora (não são despesa): origens aplicacao_financeira e
--    conta_garantida, e as classificações TRANSFERÊNCIA ENTRE CONTAS, APLICAÇÃO FINANCEIRA, CHEQUE ESPECIAL, EMPRÉSTIMOS, SALDO ANTERIOR,
--    RECEBIMENTO DE NOTA e TÍTULO DE CAPITALIZAÇÃO*. A lista é conferida com o Ruan; mudar = editar o array v_fora abaixo.
--    A mesma regra vale para o que é "previsto". Fontes: as mesmas views do Fluxo de Caixa (7 realizadas + v_fluxo_caixa_previsto) e
--    fluxo_caixa_projetado (cronograma/orçamento), com a MESMA deduplicação de Débito Automático × fatura de cartão do hook do Fluxo.
-- SECURITY DEFINER porque as views do Fluxo têm RLS própria e o total precisa ser o da empresa/grupo; a trava é a conferência de acesso à tela
-- logo na entrada (sem acesso → erro 42501). Só leitura. Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.financeiro_fluxo_gerencial(date, date, uuid, uuid);
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'fluxo-caixa-gerencial';
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'fluxo-caixa-gerencial';
--   DELETE FROM public.app_menu WHERE codigo = 'fluxo-caixa-gerencial';
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'fluxo-caixa-gerencial', 'Fluxo de Caixa Gerencial', '/app/financeiro/fluxo-caixa-gerencial', 40, true
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'fluxo-caixa-gerencial', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.financeiro_fluxo_gerencial(p_ini date, p_fim date, p_empresa uuid DEFAULT NULL, p_contrato uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_serie_ini date;
  v_fora text[] := ARRAY['TRANSFERENCIA ENTRE CONTAS', 'APLICACAO FINANCEIRA', 'CHEQUE ESPECIAL', 'EMPRESTIMOS', 'SALDO ANTERIOR', 'RECEBIMENTO DE NOTA'];
  r jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'fluxo-caixa-gerencial', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Fluxo de Caixa Gerencial.' USING ERRCODE = '42501';
  END IF;
  IF p_ini IS NULL OR p_fim IS NULL OR p_ini > p_fim THEN
    RAISE EXCEPTION 'Período inválido.' USING ERRCODE = '22023';
  END IF;
  v_serie_ini := (date_trunc('month', p_fim) - interval '11 months')::date;

  WITH debito_na_fatura AS (
    SELECT despesa_id_origem FROM public.v_malote_pagamento_fluxo_caixa_consolidado
     WHERE fatura_cartao_id IS NOT NULL AND despesa_id_origem IS NOT NULL
  ),
  linhas AS (
    SELECT 'real'::text AS fonte, data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text AS tipo, origem::text AS origem
      FROM public.v_malote_pagamento_fluxo_caixa_consolidado
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text
      FROM public.v_debito_automatico_fluxo_caixa d
     WHERE NOT EXISTS (SELECT 1 FROM debito_na_fatura f WHERE f.despesa_id_origem = d.despesa_id)
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_cartao_fatura_fluxo_caixa
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_aplicacao_financeira_fluxo_caixa
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_aplicacao_financeira_resgate_fluxo_caixa
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_fluxo_caixa_importado_fluxo_caixa
    UNION ALL
    SELECT 'real', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text FROM public.v_conta_garantida_fluxo_caixa
    UNION ALL
    SELECT 'prev', data_pagamento, empresa_id, contrato_id, classificacao_nome, valor, tipo::text, origem::text
      FROM public.v_fluxo_caixa_previsto WHERE situacao_base IS DISTINCT FROM 'cancelado'
    UNION ALL
    SELECT 'prev', data_prevista, empresa_id, contrato_id, NULL::text, valor, tipo::text, origem::text
      FROM public.fluxo_caixa_projetado WHERE data_prevista >= v_hoje
  ),
  filtradas AS (
    SELECT l.*,
           (l.origem IN ('aplicacao_financeira', 'conta_garantida')
            OR translate(upper(coalesce(l.classificacao_nome, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = ANY (v_fora)
            OR translate(upper(coalesce(l.classificacao_nome, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') LIKE 'TITULO DE CAPITALIZACAO%') AS movimentacao_financeira
      FROM linhas l
     WHERE l.data_pagamento IS NOT NULL
       AND (p_empresa IS NULL OR l.empresa_id = p_empresa)
       AND (p_contrato IS NULL OR l.contrato_id = p_contrato)
  ),
  despesas AS (
    SELECT * FROM filtradas
     WHERE fonte = 'real' AND tipo = 'saida' AND NOT movimentacao_financeira AND data_pagamento <= v_hoje
  ),
  a_vir AS (
    -- previsto: o que ainda não foi pago (incluindo vencido) + lançamento já feito com data futura; sem movimentação financeira
    SELECT * FROM filtradas
     WHERE NOT movimentacao_financeira
       AND ((fonte = 'prev' AND data_pagamento IS NOT NULL) OR (fonte = 'real' AND data_pagamento > v_hoje))
  )
  SELECT jsonb_build_object(
    'despesas_pagas', coalesce((SELECT sum(valor) FROM despesas WHERE data_pagamento BETWEEN p_ini AND p_fim), 0),
    'qtd_despesas',   (SELECT count(*) FROM despesas WHERE data_pagamento BETWEEN p_ini AND p_fim),
    'malote_pago',    coalesce((SELECT sum(valor) FROM despesas WHERE data_pagamento BETWEEN p_ini AND p_fim AND origem = 'malote'), 0),
    'por_mes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('mes', to_char(m.mes, 'YYYY-MM'), 'despesas', coalesce(x.v, 0)) ORDER BY m.mes)
        FROM generate_series(v_serie_ini, date_trunc('month', p_fim)::date, interval '1 month') AS m(mes)
        LEFT JOIN (SELECT date_trunc('month', data_pagamento)::date AS mes, sum(valor) AS v
                     FROM despesas WHERE data_pagamento BETWEEN v_serie_ini AND p_fim GROUP BY 1) x ON x.mes = m.mes::date
    ), '[]'::jsonb),
    'composicao', coalesce((
      SELECT jsonb_agg(jsonb_build_object('nome', n, 'valor', v) ORDER BY v DESC)
        FROM (SELECT coalesce(classificacao_nome, 'Sem classificação') AS n, sum(valor) AS v
                FROM despesas WHERE data_pagamento BETWEEN p_ini AND p_fim GROUP BY 1) q
    ), '[]'::jsonb),
    'projecao', jsonb_build_object(
      'd30', jsonb_build_object(
        'recebimentos', coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'entrada' AND data_pagamento <= v_hoje + 30), 0),
        'pagamentos',   coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'saida'   AND data_pagamento <= v_hoje + 30), 0)),
      'd60', jsonb_build_object(
        'recebimentos', coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'entrada' AND data_pagamento <= v_hoje + 60), 0),
        'pagamentos',   coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'saida'   AND data_pagamento <= v_hoje + 60), 0)),
      'd90', jsonb_build_object(
        'recebimentos', coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'entrada' AND data_pagamento <= v_hoje + 90), 0),
        'pagamentos',   coalesce((SELECT sum(valor) FROM a_vir WHERE tipo = 'saida'   AND data_pagamento <= v_hoje + 90), 0)))
  ) INTO r;

  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.financeiro_fluxo_gerencial(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_fluxo_gerencial(date, date, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
