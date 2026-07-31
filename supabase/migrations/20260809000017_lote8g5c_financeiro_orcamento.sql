-- Lote 8g, bloco 5c: funções de financeiro/orçamento/ETL com has_role direto.
-- Corpo de cada função copiado verbatim da última definição viva (conferido
-- lendo os arquivos-fonte): nf_entrada_validar_manual de 20260430003250,
-- mz_32_diagnosticar_razao de 20260508105818, mz_32_promover_razao de
-- 20260508113417, fn_promover_contratos_mz50/fn_gerar_cronograma_provisorio
-- de 20260508130712, promover_contas_aprovadas de 20260508134724,
-- planejamento_orcamentario_guard_historico de 20260715000004,
-- pcs_apply de 20260429222206, ocl_locked_guard de 20260429194546,
-- programacao_decidir de 20260512203445,
-- fluxo_caixa_diario_consolidado/_orcado_consolidado de 20260518005008.
--
-- Mapeamento de menu/ação:
--   * nf_entrada_validar_manual -> 'nf-entrada'/'incluir' (menu já existe,
--     migrado na Fase 3 — mesma tabela que a trigger valida).
--   * ETL puro sem tela (fn_promover_contratos_mz50, fn_gerar_cronograma_
--     provisorio, mz_32_diagnosticar_razao, mz_32_promover_razao) e telas
--     sem gate de frontend hoje que operam sobre tabelas já em 'administracao'
--     (promover_contas_aprovadas sobre stg_aprovacao_contas, já migrada no
--     8g-1; pcs_apply sobre plano_contas_solicitacao, já migrada no 8g-4;
--     planejamento_orcamentario_guard_historico sobre a tabela irmã já
--     migrada no 8g-4) -> 'administracao'/'alterar', mesma convenção das
--     tabelas que cada uma toca.
--   * ocl_locked_guard -> 'orcamento'/'excluir': orcamento_contrato_linha já
--     usa o menu 'orcamento' (Fase 3, ocl_select/insert/update/delete); o
--     guard restringe a admin+controladoria (sem diretor_adm), um subconjunto
--     do write geral (admin+controladoria+diretor_adm) — 'excluir' é o tier
--     mais alto já usado nesse menu (ocl_delete), preserva o subconjunto.
--   * programacao_decidir -> 'programacao'/'aprovar': malote_pagamento já usa
--     o menu 'programacao' (Fase 3, malote_select/insert/update); 'aprovar'
--     nunca tinha sido usado nesse menu — grant novo pros Legados abaixo.
--   * fluxo_caixa_diario_consolidado/_orcado_consolidado -> menu dedicado
--     'financeiro.fluxo_caixa_diario.consolidado_empresas', que o FRONTEND
--     (FluxoCaixaDiario.tsx) já chama via can() mas que NUNCA foi cadastrado
--     em app_menu — só existia como seed morto em role_permissions (tabela
--     legada, 20260517235853). Sem isso, a função ficaria "Acesso negado"
--     pra todo mundo sem concede_tudo, mesmo quem tinha o cargo antes.
--
-- Achado à parte: a tabela orcamento_contrato_linha tinha uma policy órfã
-- "ocl_write" (FOR ALL, has_role admin/controladoria/diretor_adm), criada em
-- 20260429194546 e nunca removida quando a Fase 3 criou ocl_insert/update/
-- delete (can_access/'orcamento') — as duas conviviam, então cargo ainda
-- dava bypass total de escrita por fora do sistema novo. Como
-- ocl_insert+ocl_update+ocl_delete já cobrem tudo que ocl_write cobria,
-- a policy órfã é só removida (não recriada).
--
-- ROLLBACK: recriar cada função/policy com has_role() nas combinações
-- originais (arquivos-fonte citados acima); recriar "ocl_write" com
-- has_role(admin/controladoria/diretor_adm) se for reverter; remover o menu
-- 'financeiro.fluxo_caixa_diario.consolidado_empresas' de app_menu e os
-- grants de 'programacao'/'aprovar' inseridos abaixo.

-- 1) nf_entrada_validar_manual
CREATE OR REPLACE FUNCTION public.nf_entrada_validar_manual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $func$
DECLARE v_pc_status text;
BEGIN
  IF NEW.origem = 'manual' THEN
    IF NEW.pedido_compra_id IS NULL THEN
      RAISE EXCEPTION 'NF manual exige vinculo com Pedido de Compra (PC)';
    END IF;
    SELECT status INTO v_pc_status FROM pedido_compra WHERE id = NEW.pedido_compra_id;
    IF v_pc_status IS NULL THEN RAISE EXCEPTION 'PC vinculado nao encontrado'; END IF;
    IF v_pc_status NOT IN ('aprovado','enviado','recebido_parcial','recebido_total') THEN
      RAISE EXCEPTION 'PC % nao esta aprovado (status: %)', NEW.pedido_compra_id, v_pc_status;
    END IF;
    IF TG_OP='INSERT' AND NEW.lancada_manualmente_por IS NULL THEN
      NEW.lancada_manualmente_por := auth.uid();
    END IF;
    IF NOT public.can_access(auth.uid(), 'nf-entrada', 'incluir') THEN
      RAISE EXCEPTION 'Sem permissao para lancar NF manualmente';
    END IF;
  END IF;
  RETURN NEW;
END $func$;

-- 2) mz_32_diagnosticar_razao
CREATE OR REPLACE FUNCTION public.mz_32_diagnosticar_razao(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Acesso negado: requer role admin ou controladoria';
  END IF;

  WITH src AS (
    SELECT m.mz_id, m.id_lct_mestre,
      UPPER(TRIM(m.empresa)) AS sigla, e.id AS empresa_id,
      cc.id AS conta_contabil_id, ccu.id AS centro_custo_id,
      to_date(NULLIF(m.data_lancamento,''),'DD/MM/YYYY') AS data_lcto,
      to_date(NULLIF(m.periodo,''),'DD/MM/YYYY') AS competencia,
      COALESCE(NULLIF(REPLACE(REPLACE(m.valor_debito_razao,'.',''),',','.'),'')::numeric,0) AS deb,
      COALESCE(NULLIF(REPLACE(REPLACE(m.valor_credito_razao,'.',''),',','.'),'')::numeric,0) AS cre
    FROM public.mz_32_fato_razao_contabil m
    LEFT JOIN public.empresas e ON UPPER(e.nome_fantasia)=UPPER(TRIM(m.empresa))
    LEFT JOIN public.conta_contabil cc ON cc.empresa_id=e.id AND cc.classificacao=m.codigo_conta
    LEFT JOIN public.centros_custo ccu ON ccu.empresa_id=e.id AND ccu.codigo=m.centro_custo
    WHERE m.migration_batch_id = p_batch_id
  ),
  partida_status AS (
    SELECT *, CASE
      WHEN empresa_id IS NULL THEN 'PENDENTE_EMPRESA'
      WHEN conta_contabil_id IS NULL THEN 'PENDENTE_CONTA'
      WHEN deb=0 AND cre=0 THEN 'INVALIDO_VALOR_ZERO'
      WHEN data_lcto IS NULL THEN 'INVALIDO_DATA'
      ELSE 'OK' END AS s_partida
    FROM src
  ),
  lct_status AS (
    SELECT id_lct_mestre,
      MIN(empresa_id::text) AS empresa_ref,
      CASE
        WHEN bool_or(empresa_id IS NULL) THEN 'PENDENTE_EMPRESA'
        WHEN bool_or(conta_contabil_id IS NULL) THEN 'PENDENTE_CONTA'
        WHEN bool_or(data_lcto IS NULL) THEN 'INVALIDO_DATA'
        WHEN bool_and(deb=0 AND cre=0) THEN 'INVALIDO_VALOR_ZERO'
        WHEN ABS(sum(deb)-sum(cre)) >= 0.01 THEN 'DESBALANCEADO'
        ELSE 'OK'
      END AS s_lct,
      sum(deb) AS deb_lct, sum(cre) AS cre_lct, count(*) AS partidas
    FROM partida_status
    GROUP BY id_lct_mestre
  ),
  por_status_lct AS (
    SELECT s_lct AS status_lct, count(*) AS qt_lcts, sum(partidas) AS qt_partidas,
           round(sum(deb_lct)::numeric,2) AS deb, round(sum(cre_lct)::numeric,2) AS cre
    FROM lct_status GROUP BY s_lct
  ),
  por_empresa AS (
    SELECT COALESCE(sigla,'(vazio)') AS sigla, count(*) AS partidas,
           count(*) FILTER (WHERE s_partida='OK') AS partidas_ok,
           round(sum(deb)::numeric,2) AS deb, round(sum(cre)::numeric,2) AS cre
    FROM partida_status GROUP BY sigla
  )
  SELECT jsonb_build_object(
    'batch_id', p_batch_id,
    'gerado_em', now(),
    'totais_por_status_lct_mestre', (SELECT jsonb_agg(to_jsonb(p)) FROM por_status_lct p),
    'por_empresa_partidas', (SELECT jsonb_agg(to_jsonb(pe)) FROM por_empresa pe)
  ) INTO v_result;

  RETURN v_result;
END; $$;

-- 3) mz_32_promover_razao
CREATE OR REPLACE FUNCTION public.mz_32_promover_razao(
  p_batch_id uuid, p_sigla text DEFAULT NULL, p_limit_mestres int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_inserted_lct int := 0;
  v_inserted_part int := 0;
  v_started_at timestamptz := now();
  v_promotion_id uuid := gen_random_uuid();
  v_uid uuid := NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid;
BEGIN
  IF v_uid IS NOT NULL
     AND NOT public.can_access(v_uid, 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'permissao_negada';
  END IF;

  DROP TABLE IF EXISTS tmp_mestres_ok;
  CREATE TEMP TABLE tmp_mestres_ok AS
  WITH base AS (
    SELECT m.id_lct_mestre, e.id AS empresa_id, UPPER(e.nome_fantasia) AS sigla,
           cc.id AS conta_contabil_id,
           to_date(NULLIF(m.data_lancamento,''),'DD/MM/YYYY') AS data_lcto,
           to_date(NULLIF(m.periodo,'')||'-01','YYYY-MM-DD') AS competencia,
           COALESCE(public.mz_parse_num(m.valor_debito_razao),0) AS vdeb,
           COALESCE(public.mz_parse_num(m.valor_credito_razao),0) AS vcre
    FROM public.mz_32_fato_razao_contabil m
    LEFT JOIN public.empresas e ON UPPER(e.nome_fantasia)=UPPER(m.empresa)
    LEFT JOIN public.conta_contabil cc ON cc.empresa_id=e.id AND cc.classificacao=m.codigo_conta
    WHERE m.migration_batch_id = p_batch_id
      AND (p_sigla IS NULL OR UPPER(m.empresa) = UPPER(p_sigla))
  ),
  agg AS (
    SELECT id_lct_mestre,
           bool_and(empresa_id IS NOT NULL AND conta_contabil_id IS NOT NULL
                    AND data_lcto IS NOT NULL AND (vdeb+vcre)>0) AS all_ok,
           ABS(SUM(vdeb)-SUM(vcre)) AS dif,
           (array_agg(empresa_id))[1] AS empresa_id,
           (array_agg(sigla))[1] AS sigla,
           (array_agg(data_lcto ORDER BY data_lcto NULLS LAST))[1] AS data_lcto,
           (array_agg(competencia ORDER BY competencia NULLS LAST))[1] AS competencia
    FROM base GROUP BY id_lct_mestre
  )
  SELECT id_lct_mestre, empresa_id, sigla, data_lcto, competencia
  FROM agg
  WHERE all_ok AND dif < 0.01
    AND NOT EXISTS (SELECT 1 FROM public.lancamento_contabil lc
                    WHERE lc.hash_dedup = 'mz32:'||agg.id_lct_mestre)
  ORDER BY data_lcto, id_lct_mestre
  LIMIT COALESCE(p_limit_mestres, 2147483647);

  WITH ins AS (
    INSERT INTO public.lancamento_contabil
      (empresa_id, numero, data_lancamento, competencia, historico,
       valor_total, origem, origem_tipo, status, hash_dedup, created_by)
    SELECT t.empresa_id, 'MZ32-'||t.id_lct_mestre, t.data_lcto, t.competencia,
           'Promoção razão MZ32 lct_mestre='||t.id_lct_mestre,
           (SELECT COALESCE(SUM(public.mz_parse_num(b.valor_debito_razao)),0)
              FROM public.mz_32_fato_razao_contabil b
             WHERE b.migration_batch_id=p_batch_id AND b.id_lct_mestre=t.id_lct_mestre),
           'mz_32_razao','mz_32_fato_razao_contabil','efetivado'::lanc_status,
           'mz32:'||t.id_lct_mestre, v_uid
    FROM tmp_mestres_ok t
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_lct FROM ins;

  WITH src AS (
    SELECT lc.id AS lancamento_id, cc.id AS conta_contabil_id, cct.id AS centro_custo_id,
           public.mz_parse_num(m.valor_debito_razao) AS vdeb,
           public.mz_parse_num(m.valor_credito_razao) AS vcre,
           m.historico
    FROM public.mz_32_fato_razao_contabil m
    JOIN tmp_mestres_ok t ON t.id_lct_mestre=m.id_lct_mestre
    JOIN public.lancamento_contabil lc ON lc.hash_dedup='mz32:'||m.id_lct_mestre
    JOIN public.empresas e ON UPPER(e.nome_fantasia)=UPPER(m.empresa)
    JOIN public.conta_contabil cc ON cc.empresa_id=e.id AND cc.classificacao=m.codigo_conta
    LEFT JOIN public.centros_custo cct ON cct.empresa_id=e.id AND cct.codigo=m.centro_custo
    WHERE m.migration_batch_id=p_batch_id
      AND NOT EXISTS (SELECT 1 FROM public.lancamento_partida lp WHERE lp.lancamento_id=lc.id)
  ), ins_part AS (
    INSERT INTO public.lancamento_partida
      (lancamento_id, conta_contabil_id, centro_custo_id, dc, valor, historico)
    SELECT s.lancamento_id, s.conta_contabil_id, s.centro_custo_id,
      CASE WHEN COALESCE(s.vdeb,0)>0 THEN 'D' ELSE 'C' END::partida_dc,
      CASE WHEN COALESCE(s.vdeb,0)>0 THEN s.vdeb ELSE s.vcre END,
      s.historico
    FROM src s
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_part FROM ins_part;

  DROP TABLE IF EXISTS tmp_mestres_ok;

  RETURN jsonb_build_object(
    'promotion_id', v_promotion_id, 'batch_id', p_batch_id,
    'sigla_filtro', p_sigla, 'limit_mestres', p_limit_mestres,
    'inserted_lancamentos', v_inserted_lct,
    'inserted_partidas', v_inserted_part,
    'started_at', v_started_at, 'finished_at', now()
  );
END;$f$;

-- 4) fn_promover_contratos_mz50 + fn_gerar_cronograma_provisorio
CREATE OR REPLACE FUNCTION public.fn_promover_contratos_mz50(meses_default int DEFAULT 12)
RETURNS TABLE(contratos_inseridos int, contratos_existentes int, sem_empresa int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridos int := 0;
  v_existentes int := 0;
  v_sem_empresa int := 0;
  r record;
  v_empresa_id uuid;
  v_numero text;
  v_vig_ini date;
  v_valor numeric;
  v_cliente text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Acesso negado: requer admin ou controladoria';
  END IF;

  FOR r IN
    WITH base AS (
      SELECT
        empresa,
        contrato,
        cliente,
        status_contrato,
        NULLIF(vigencia_inicio,'')::date AS vig_ini,
        NULLIF(regexp_replace(coalesce(valor_orcado_executado,'0'),'[^0-9.,-]','','g'),'')::numeric AS valor
      FROM public.mz_50_fato_orcamento_contratos_competencia
    ),
    ranked AS (
      SELECT
        empresa, contrato,
        MAX(vig_ini) AS vig_ini_max
      FROM base
      WHERE vig_ini IS NOT NULL
      GROUP BY empresa, contrato
    ),
    agg AS (
      SELECT
        b.empresa,
        b.contrato,
        MAX(b.cliente) AS cliente,
        r.vig_ini_max AS vig_ini,
        SUM(b.valor) AS valor_total
      FROM base b
      JOIN ranked r ON r.empresa=b.empresa AND r.contrato=b.contrato AND b.vig_ini=r.vig_ini_max
      GROUP BY b.empresa, b.contrato, r.vig_ini_max
    )
    SELECT * FROM agg
  LOOP
    SELECT id INTO v_empresa_id FROM public.empresas WHERE codigo = r.empresa LIMIT 1;
    IF v_empresa_id IS NULL THEN
      v_sem_empresa := v_sem_empresa + 1;
      CONTINUE;
    END IF;

    v_numero := left(r.contrato, 100);
    v_vig_ini := COALESCE(r.vig_ini, CURRENT_DATE);
    v_valor := COALESCE(r.valor_total, 0);
    v_cliente := COALESCE(r.cliente, 'NÃO INFORMADO');

    INSERT INTO public.contrato(
      empresa_id, numero, objeto, orgao,
      vigencia_inicio, vigencia_fim,
      valor_total, faturamento_mensal,
      status, observacoes
    ) VALUES (
      v_empresa_id, v_numero, left(r.contrato,200), left(v_cliente,200),
      v_vig_ini, (v_vig_ini + (meses_default || ' months')::interval)::date,
      v_valor, CASE WHEN meses_default > 0 THEN v_valor/meses_default ELSE 0 END,
      'ativo'::contrato_status,
      '[PROVISÓRIO mz_50] Aguardando planilha oficial de receita.'
    )
    ON CONFLICT (empresa_id, numero) DO NOTHING;

    IF FOUND THEN
      v_inseridos := v_inseridos + 1;
    ELSE
      v_existentes := v_existentes + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inseridos, v_existentes, v_sem_empresa;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_gerar_cronograma_provisorio(p_contrato_id uuid, p_meses int DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_contrato record;
  v_meses int;
  i int;
  v_comp date;
  v_valor_mensal numeric;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Acesso negado: requer admin ou controladoria';
  END IF;

  SELECT * INTO v_contrato FROM public.contrato WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  v_meses := COALESCE(p_meses,
    GREATEST(1, ((EXTRACT(YEAR FROM age(v_contrato.vigencia_fim, v_contrato.vigencia_inicio))*12
                 + EXTRACT(MONTH FROM age(v_contrato.vigencia_fim, v_contrato.vigencia_inicio))))::int));
  v_valor_mensal := COALESCE(v_contrato.faturamento_mensal,
                              CASE WHEN v_meses>0 THEN v_contrato.valor_total/v_meses ELSE 0 END);

  FOR i IN 0..v_meses-1 LOOP
    v_comp := date_trunc('month', v_contrato.vigencia_inicio + (i || ' months')::interval)::date;
    INSERT INTO public.cronograma_faturamento(
      empresa_id, contrato_id, competencia,
      data_emissao_prevista, data_recebimento_previsto,
      valor_previsto, status, observacoes
    ) VALUES (
      v_contrato.empresa_id, v_contrato.id, v_comp,
      (v_comp + interval '1 month - 1 day')::date,
      (v_comp + interval '1 month + 9 days')::date,
      v_valor_mensal, 'previsto'::cronograma_status,
      '[PROVISÓRIO mz_50]'
    )
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 5) promover_contas_aprovadas
CREATE OR REPLACE FUNCTION public.promover_contas_aprovadas(_empresa_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _promovidas int := 0;
  _ja_existentes int := 0;
  _sem_pai int := 0;
  _proxima_reduzida int;
  r record;
  _parent_id uuid;
  _dre_id uuid;
  _tipo conta_tipo;
  _nat conta_natureza;
  _grupo conta_grupo_dre;
BEGIN
  IF _user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.can_access(_user, 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para promover contas';
  END IF;

  SELECT COALESCE(MAX(conta_reduzida), 0) + 1 INTO _proxima_reduzida
  FROM public.conta_contabil WHERE empresa_id = _empresa_id;

  FOR r IN
    SELECT a.id_sugestao_conta,
           a.codigo_conta_sugerido,
           a.nome_conta_sugerido,
           a.codigo_conta_pai_sugerido,
           a.linha_dre_padrao,
           s.natureza_sugerida,
           s.tipo_conta_sugerido,
           s.entra_orcamento,
           s.impacta_caixa
    FROM public.stg_aprovacao_contas a
    LEFT JOIN public.stg_sugestoes_novas_contas s USING (id_sugestao_conta)
    WHERE a.status_aprovacao = 'APROVADA'
      AND a.codigo_conta_sugerido IS NOT NULL
      AND a.nome_conta_sugerido IS NOT NULL
    ORDER BY length(a.codigo_conta_sugerido), a.codigo_conta_sugerido
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.conta_contabil
      WHERE empresa_id = _empresa_id AND classificacao = r.codigo_conta_sugerido
    ) THEN
      UPDATE public.stg_aprovacao_contas
        SET status_aprovacao = 'PROMOVIDA',
            observacao_usuario = COALESCE(observacao_usuario,'') || ' [já existia]',
            updated_at = now()
      WHERE id_sugestao_conta = r.id_sugestao_conta;
      _ja_existentes := _ja_existentes + 1;
      CONTINUE;
    END IF;

    _parent_id := NULL;
    IF r.codigo_conta_pai_sugerido IS NOT NULL THEN
      SELECT id INTO _parent_id FROM public.conta_contabil
      WHERE empresa_id = _empresa_id AND classificacao = r.codigo_conta_pai_sugerido
      LIMIT 1;
      IF _parent_id IS NULL THEN
        _sem_pai := _sem_pai + 1;
        CONTINUE;
      END IF;
    END IF;

    _dre_id := NULL;
    IF r.linha_dre_padrao IS NOT NULL THEN
      SELECT id INTO _dre_id FROM public.dre_linhas
      WHERE empresa_id = _empresa_id AND codigo = r.linha_dre_padrao
      LIMIT 1;
    END IF;

    _tipo := CASE WHEN COALESCE(lower(r.tipo_conta_sugerido),'') = 'sintetica' THEN 'sintetica'::conta_tipo
                  ELSE 'analitica'::conta_tipo END;
    _nat  := CASE WHEN upper(COALESCE(r.natureza_sugerida,'D')) = 'C' THEN 'C'::conta_natureza
                  ELSE 'D'::conta_natureza END;
    _grupo := CASE WHEN _dre_id IS NOT NULL THEN 'dre'::conta_grupo_dre ELSE 'balanco'::conta_grupo_dre END;

    INSERT INTO public.conta_contabil (
      empresa_id, conta_reduzida, classificacao, descricao,
      tipo, natureza, grupo_dre, parent_id, dre_linha_id,
      entra_fluxo, entra_orcamento
    ) VALUES (
      _empresa_id, _proxima_reduzida, r.codigo_conta_sugerido, r.nome_conta_sugerido,
      _tipo, _nat, _grupo, _parent_id, _dre_id,
      COALESCE(lower(r.impacta_caixa) IN ('sim','s','true','t'), false),
      COALESCE(lower(r.entra_orcamento) IN ('sim','s','true','t'), false)
    );
    _proxima_reduzida := _proxima_reduzida + 1;
    _promovidas := _promovidas + 1;

    UPDATE public.stg_aprovacao_contas
      SET status_aprovacao = 'PROMOVIDA',
          aprovado_por = _user,
          aprovado_em = now(),
          updated_at = now()
    WHERE id_sugestao_conta = r.id_sugestao_conta;
  END LOOP;

  RETURN jsonb_build_object(
    'promovidas', _promovidas,
    'ja_existentes', _ja_existentes,
    'sem_pai', _sem_pai
  );
END;
$$;

-- 6) planejamento_orcamentario_guard_historico
CREATE OR REPLACE FUNCTION public.planejamento_orcamentario_guard_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.fim_vigencia <= CURRENT_DATE
     AND NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Orçamento em Histórico não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

-- 7) pcs_apply
CREATE OR REPLACE FUNCTION public.pcs_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_new_id uuid;
  v_max_red integer;
BEGIN
  IF NEW.status <> 'aprovada' OR OLD.status = 'aprovada' THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Apenas admin, controladoria ou diretor administrativo podem aprovar';
  END IF;

  NEW.decidido_por := auth.uid();
  NEW.decidido_em := now();

  IF NEW.tipo = 'criar' THEN
    IF NEW.classificacao IS NULL OR NEW.descricao IS NULL OR NEW.tipo_conta IS NULL OR NEW.natureza IS NULL THEN
      RAISE EXCEPTION 'Solicitação de criação incompleta';
    END IF;
    IF EXISTS (SELECT 1 FROM conta_contabil
               WHERE empresa_id = NEW.empresa_id AND classificacao = NEW.classificacao) THEN
      RAISE EXCEPTION 'Classificação % já existe nesta empresa', NEW.classificacao;
    END IF;
    IF NEW.parent_classificacao IS NOT NULL THEN
      SELECT id INTO v_parent_id FROM conta_contabil
       WHERE empresa_id = NEW.empresa_id AND classificacao = NEW.parent_classificacao;
      IF v_parent_id IS NULL THEN
        RAISE EXCEPTION 'Conta pai % não encontrada na empresa', NEW.parent_classificacao;
      END IF;
    END IF;

    SELECT COALESCE(MAX(conta_reduzida),0)+1 INTO v_max_red
      FROM conta_contabil WHERE empresa_id = NEW.empresa_id;

    INSERT INTO conta_contabil
      (empresa_id, conta_reduzida, classificacao, descricao, tipo, natureza,
       exige_contrato, centro_custo_padrao, entra_fluxo, entra_orcamento,
       parent_id, dre_linha_id, grupo_dre, ativo)
    VALUES
      (NEW.empresa_id, v_max_red, NEW.classificacao, NEW.descricao, NEW.tipo_conta, NEW.natureza,
       COALESCE(NEW.exige_contrato,'nao'), NEW.centro_custo_padrao,
       COALESCE(NEW.entra_fluxo,false), COALESCE(NEW.entra_orcamento,false),
       v_parent_id, NEW.dre_linha_id, COALESCE(NEW.grupo_dre,'balanco'),
       COALESCE(NEW.ativo,true))
    RETURNING id INTO v_new_id;

    NEW.conta_contabil_id := v_new_id;

  ELSIF NEW.tipo = 'alterar' THEN
    IF NEW.conta_contabil_id IS NULL THEN
      RAISE EXCEPTION 'Solicitação de alteração sem conta alvo';
    END IF;
    IF NEW.parent_classificacao IS NOT NULL THEN
      SELECT id INTO v_parent_id FROM conta_contabil
       WHERE empresa_id = NEW.empresa_id AND classificacao = NEW.parent_classificacao;
    END IF;
    UPDATE conta_contabil SET
      descricao            = COALESCE(NEW.descricao, descricao),
      tipo                 = COALESCE(NEW.tipo_conta, tipo),
      natureza             = COALESCE(NEW.natureza, natureza),
      exige_contrato       = COALESCE(NEW.exige_contrato, exige_contrato),
      centro_custo_padrao  = COALESCE(NEW.centro_custo_padrao, centro_custo_padrao),
      entra_fluxo          = COALESCE(NEW.entra_fluxo, entra_fluxo),
      entra_orcamento      = COALESCE(NEW.entra_orcamento, entra_orcamento),
      parent_id            = COALESCE(v_parent_id, parent_id),
      dre_linha_id         = COALESCE(NEW.dre_linha_id, dre_linha_id),
      grupo_dre            = COALESCE(NEW.grupo_dre, grupo_dre),
      ativo                = COALESCE(NEW.ativo, ativo)
    WHERE id = NEW.conta_contabil_id AND empresa_id = NEW.empresa_id;

  ELSIF NEW.tipo = 'inativar' THEN
    IF NEW.conta_contabil_id IS NULL THEN
      RAISE EXCEPTION 'Solicitação de inativação sem conta alvo';
    END IF;
    UPDATE conta_contabil SET ativo = false
     WHERE id = NEW.conta_contabil_id AND empresa_id = NEW.empresa_id;
  END IF;

  NEW.status := 'aplicada';
  RETURN NEW;
END;
$$;

-- 8) ocl_locked_guard
CREATE OR REPLACE FUNCTION public.ocl_locked_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.locked = true AND NEW.valor_previsto IS DISTINCT FROM OLD.valor_previsto THEN
    IF NOT public.can_access(auth.uid(), 'orcamento', 'excluir') THEN
      RAISE EXCEPTION 'Linha trancada — solicite desbloqueio';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 9) Policy órfã ocl_write — já coberta por ocl_insert/update/delete (Fase 3).
DROP POLICY IF EXISTS "ocl_write" ON public.orcamento_contrato_linha;

-- 10) programacao_decidir + grant novo de 'aprovar' no menu 'programacao'
CREATE OR REPLACE FUNCTION public.programacao_decidir(
  p_programacao_id uuid, p_decisao public.aprov_decisao, p_justificativa text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_emp uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'programacao', 'aprovar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar';
  END IF;
  IF p_decisao='rejeitado' AND (p_justificativa IS NULL OR length(trim(p_justificativa))=0) THEN
    RAISE EXCEPTION 'Justificativa obrigatória para reprovação';
  END IF;
  SELECT empresa_id INTO v_emp FROM malote_pagamento WHERE id=p_programacao_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Programação não encontrada'; END IF;
  UPDATE financeiro_pagamento_aprovacao
  SET decisao=p_decisao, aprovador_id=auth.uid(), justificativa=p_justificativa, decidido_em=now()
  WHERE programacao_id=p_programacao_id AND decisao='pendente';
  UPDATE malote_pagamento SET aprovacao_status = CASE
    WHEN p_decisao='aprovado' THEN 'aprovada'::programacao_aprovacao_status
    WHEN p_decisao='rejeitado' THEN 'reprovada'::programacao_aprovacao_status
    WHEN p_decisao='devolvido' THEN 'devolvida'::programacao_aprovacao_status
    ELSE aprovacao_status END,
  status = CASE WHEN p_decisao='devolvido' THEN 'rascunho'::malote_status ELSE status END
  WHERE id=p_programacao_id;
  INSERT INTO financeiro_pagamento_log (empresa_id, programacao_id, acao, detalhes, usuario_id)
  VALUES (v_emp, p_programacao_id, 'decisao_aprovacao', jsonb_build_object('decisao',p_decisao,'justificativa',p_justificativa), auth.uid());
END $$;

-- Grant novo: 'aprovar' nunca existiu no menu 'programacao' até agora.
-- Legado: admin não precisa (concede_tudo). Legado: controladoria não estava
-- no critério original de programacao_decidir, então não recebe aqui.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'programacao', 'aprovar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: diretor_adm', 'Legado: financeiro')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'programacao' AND pap.acao = 'aprovar'::public.app_acao
  );

-- 11) fluxo_caixa_diario_consolidado + _orcado_consolidado + menu novo
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
FROM public.app_modulo m, (VALUES
  ('financeiro', 'financeiro.fluxo_caixa_diario.consolidado_empresas',
   'Fluxo de Caixa Diário (consolidado entre empresas)',
   '/app/financeiro/fluxo-caixa-diario', 34)
) AS x(modulo_codigo, codigo, nome, rota, ordem)
WHERE m.codigo = x.modulo_codigo
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fluxo_caixa_diario_consolidado(_data_ini date, _data_fim date)
RETURNS TABLE(bloco text, categoria text, dia date, valor numeric, saldo_inicial numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro.fluxo_caixa_diario.consolidado_empresas', 'visualizar') THEN
    RAISE EXCEPTION 'Acesso negado: requer perfil admin, presidencia ou diretor_adm';
  END IF;

  RETURN QUERY
  SELECT f.bloco, f.categoria, f.dia, f.valor, f.saldo_inicial
  FROM public.fluxo_caixa_diario(NULL::uuid, _data_ini, _data_fim) f;
END;
$$;

CREATE OR REPLACE FUNCTION public.fluxo_caixa_diario_orcado_consolidado(_data_ini date, _data_fim date)
RETURNS TABLE(bloco text, categoria text, dia date, valor numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro.fluxo_caixa_diario.consolidado_empresas', 'visualizar') THEN
    RAISE EXCEPTION 'Acesso negado: requer perfil admin, presidencia ou diretor_adm';
  END IF;

  RETURN QUERY
  SELECT f.bloco, f.categoria, f.dia, f.valor
  FROM public.fluxo_caixa_diario_orcado(NULL::uuid, _data_ini, _data_fim) f;
END;
$$;

-- Backfill do menu novo: Legado: admin não precisa (concede_tudo).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro.fluxo_caixa_diario.consolidado_empresas', 'visualizar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: presidencia', 'Legado: diretor_adm')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id
      AND pap.menu_codigo = 'financeiro.fluxo_caixa_diario.consolidado_empresas'
      AND pap.acao = 'visualizar'::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
