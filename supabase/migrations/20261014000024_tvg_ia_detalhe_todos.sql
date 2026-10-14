-- =========================================================================
-- TVs GERENCIAIS: I.A ENXERGA O DETALHE DE TODOS OS INDICADORES (14/10/2026)
--
-- Continuação da 20261014000023 (DRE por conta). Pablo: "faz o mesmo pros
-- outros indicadores que não são do DRE". A I.A recebia só o agregado que a
-- TV mostra (top 12 do gráfico) e, perguntada "por quê?", mandava procurar
-- outro módulo. Agora cada grupo de indicadores entrega à I.A os REGISTROS
-- por trás do número, com o mesmo filtro da tvg_calc / tvg_calc_extra:
--   · quadro/postos/afastamentos/faltas/salários → folha (EMPREGADOS) por
--     contrato, aberta por situação e cargo, + vagas abertas do contrato;
--   · glosas/multas/reclamações/prazos/medidas → as notificações do Jurídico;
--   · processos/audiências/valores → os processos (sem o nome do reclamante);
--   · licitações → as linhas da grade; Supply → pedidos e itens de estoque;
--   · frota/patrimônio → os bens e as viagens; recrutamento → as vagas com os
--     candidatos por etapa, e as desistências; rescisões/ASO → solicitações;
--   · treinamentos → curso × contrato; faturamento/recebimento/fluxo → as NFs
--     (e despesas do Malote); planos de ação, chamados, fila_http, acessos.
-- Nenhum nome de pessoa sai daqui (a TV é área comum): só contrato, cargo,
-- setor, número de documento, datas e valores.
--
-- tvg_ia_detalhe_dados(alvo, param) é interna (sem portão, ninguém executa);
-- tvg_ia_detalhe(codigo) é o portão (o mesmo de tvg_fonte), resolve espelho
-- (usa o original) e soma (junta o detalhe de cada componente).
-- Indicador sem ramo devolve NULL — a Edge tvg-ia segue só com o resultado.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  nomes text[]; v_comp text; comps text[]; v_ano int; v_meses int[]; n int; v_painel jsonb; v_mes date; r jsonb;
BEGIN
  -- Os nomes que o gráfico mostra (detalhe do resultado), na mesma ordem.
  nomes := ARRAY(SELECT x->>'nome' FROM jsonb_array_elements(coalesce(public.tvg_indicador_dados(p_alvo)#>'{indicador,resultado,detalhe}', '[]'::jsonb)) x
                  WHERE x->>'nome' IS NOT NULL LIMIT 15);

  -- ── DRE: custo de cada contrato do gráfico aberto por conta ───────────
  IF p_alvo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL OR cardinality(nomes) = 0 THEN RETURN NULL; END IF;
    comps := ARRAY(SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4);
    nomes := nomes[1:12];
    WITH l AS (
      SELECT COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') AS contrato, d.periodo_competencia AS comp, d.linha_dre,
             coalesce(NULLIF(btrim(d.conta_debito_nome), ''), '(sem conta)') AS conta, public.tvg_num_ponto(d.valor_dre) AS v
        FROM public.mz_60_view_dre_gerencial_competencia d
       WHERE d.periodo_competencia = ANY (comps)
         AND COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') = ANY (nomes)
         AND d.linha_dre IN ('CUSTO', 'RECEITA')),
    contas AS (SELECT contrato, conta, comp, round(-sum(v), 2) AS valor, count(*) AS lanc FROM l WHERE linha_dre = 'CUSTO' GROUP BY 1, 2, 3),
    por_conta AS (
      SELECT contrato, conta, jsonb_object_agg(comp, jsonb_build_object('valor', valor, 'lancamentos', lanc)) AS por_competencia,
             coalesce(sum(valor) FILTER (WHERE comp = v_comp), 0) AS atual
        FROM contas GROUP BY 1, 2),
    totais AS (
      SELECT contrato, comp, round(-sum(v) FILTER (WHERE linha_dre = 'CUSTO'), 2) AS custo,
             round(sum(v) FILTER (WHERE linha_dre = 'RECEITA'), 2) AS receita, count(*) FILTER (WHERE linha_dre = 'CUSTO') AS lanc_custo
        FROM l GROUP BY 1, 2)
    SELECT jsonb_build_object(
      'competencia_atual', v_comp, 'competencias_janela', to_jsonb(comps),
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
  END IF;

  -- ── Quadro / postos / afastamentos: folha do contrato por situação e cargo ──
  IF p_alvo IN ('op_postos', 'rh_quadro', 'sst_afastamentos') THEN
    WITH q AS (SELECT q.*, public.dir_rel_contrato_nn(q.contrato_id) AS nn FROM public.tvg_quadro_contratos() q WHERE q.contrato = ANY (nomes)),
    e AS (SELECT q.contrato, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo
            FROM public."EMPREGADOS" e JOIN q ON q.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', 'Por contrato do gráfico: quadro (necessários = estipulado no cadastro do contrato; ativos/trabalhando/férias/afastados = folha Senior hoje), situações da folha, cargos e vagas abertas na Gestão Recrutamento.',
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', q.contrato, 'cidade', q.cidade, 'necessarios', q.necessarios, 'ativos', q.ativos, 'trabalhando', q.trabalhando,
          'ferias', q.ferias, 'afastados', q.afastados,
          'situacoes', (SELECT jsonb_object_agg(sit, c) FROM (SELECT sit, count(*) c FROM e WHERE e.contrato = q.contrato GROUP BY 1) s),
          'cargos', (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'ativos', c, 'trabalhando', t) ORDER BY c DESC)
                       FROM (SELECT cargo, count(*) c, count(*) FILTER (WHERE sit = 'Trabalhando') t FROM e WHERE e.contrato = q.contrato GROUP BY 1 ORDER BY 2 DESC LIMIT 10) z),
          'vagas_abertas', (SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'cargo', v.cargo, 'qtd', coalesce(v.quantidade_vagas, 1), 'status', v.status,
                                     'aberta_ha_dias', hoje - (v.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'motivo', v.motivo_vaga))
                              FROM (SELECT * FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.contrato_id = q.contrato_id
                                       AND v.status NOT IN ('Concluído', 'Reprovada', 'Contratado') ORDER BY v.created_at LIMIT 10) v))
        ORDER BY array_position(nomes, q.contrato)) FROM q), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faltas / absenteísmo / salários: folha do contrato ────────────────
  IF p_alvo IN ('op_faltas', 'rh_absenteismo', 'rh_salarios') THEN
    WITH c AS (SELECT c.nome, c.cliente, c.valor_mensal_contratado AS fat, c.quant_func_estipulado AS estipulado, public.dir_rel_contrato_nn(c.id) AS nn
                 FROM public.contratos c WHERE c.status = 'ativo' AND c.nome = ANY (nomes)),
    e AS (SELECT c.nome, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo,
                 public.tvg_num_br(e."Valor Salário"::text) AS sal, e."Data Afastamento" AS dt_af,
                 CASE WHEN p_alvo = 'op_faltas' THEN (e."Situação" ILIKE 'Atestado%' OR e."Situação" ILIKE 'Falta%')
                      ELSE e."Situação" NOT IN ('Trabalhando', 'Férias') END AS fora
            FROM public."EMPREGADOS" e JOIN c ON c.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', CASE WHEN p_alvo = 'rh_salarios' THEN 'Por contrato: faturamento = valor mensal contratado (cadastro do contrato); folha = soma do salário-base dos ativos na Senior, aberta por cargo.'
                         ELSE 'Por contrato: situação de cada colaborador ativo na folha Senior hoje; "fora" = os que entram na conta do indicador, abertos por situação e cargo.' END,
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', c.nome, 'cliente', c.cliente, 'faturamento_mensal', c.fat, 'quadro_estipulado', c.estipulado,
          'ativos', (SELECT count(*) FROM e WHERE e.nome = c.nome),
          'situacoes', (SELECT jsonb_object_agg(sit, q) FROM (SELECT sit, count(*) q FROM e WHERE e.nome = c.nome GROUP BY 1) s),
          'fora_por_cargo', CASE WHEN p_alvo <> 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'situacao', sit, 'qtd', q) ORDER BY q DESC)
                              FROM (SELECT cargo, sit, count(*) q FROM e WHERE e.nome = c.nome AND fora GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12) z) END,
          'folha_total', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT round(sum(sal), 2) FROM e WHERE e.nome = c.nome) END,
          'folha_por_cargo', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'qtd', q, 'soma_salarios', s, 'salario_medio', round(s / q, 2)) ORDER BY s DESC)
                               FROM (SELECT cargo, count(*) q, round(sum(sal), 2) s FROM e WHERE e.nome = c.nome AND sal > 0 GROUP BY 1 ORDER BY 3 DESC LIMIT 12) z) END)
        ORDER BY array_position(nomes, c.nome)) FROM c), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Experiência vencendo / acidentes: os colaboradores (sem nome) ─────
  IF p_alvo = 'rh_ob_experiencia' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo") AS cargo, public.rh_data(e."Admissão"::text) AS adm
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido'),
    f AS (SELECT *, hoje - adm AS dias FROM e WHERE hoje - adm BETWEEN 45 - coalesce(p_param, 15)::int AND 45 OR hoje - adm BETWEEN 90 - coalesce(p_param, 15)::int AND 90)
    SELECT jsonb_build_object('observacao', 'Colaboradores ativos chegando ao fim do 1º (45 d) ou 2º (90 d) período de experiência, pela data de admissão na Senior.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'cargo', cargo, 'admissao', adm, 'dias_de_casa', dias,
                                                                'vence_em', CASE WHEN dias <= 45 THEN adm + 45 ELSE adm + 90 END) ORDER BY contrato, dias DESC)
                               FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 50) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'sst_acidentes' THEN
    SELECT jsonb_build_object('observacao', 'Colaboradores com situação ou causa de acidente na folha Senior, hoje.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'situacao', e."Situação",
                     'causa', e."Descrição (Causa)", 'data_afastamento', e."Data Afastamento")), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e
             WHERE e."Situação" ILIKE '%acident%' OR e."Descrição (Causa)" ILIKE '%acident%' AND e."Situação" <> 'Demitido' LIMIT 50) e;
    RETURN r;
  END IF;

  -- ── Turnover: o painel de turnover da Diretoria, recortado ────────────
  IF p_alvo = 'op_turnover' THEN
    v_ano := extract(year FROM hoje)::int;
    n := greatest(1, least(12, coalesce(p_param, 3)::int));
    v_meses := ARRAY(SELECT m FROM generate_series(greatest(1, extract(month FROM hoje)::int - n + 1), extract(month FROM hoje)::int) m);
    v_painel := public.dir_turnover_painel_dados(v_ano, NULL, NULL, NULL, v_meses);
    SELECT jsonb_build_object(
      'observacao', 'Dados do painel de Turnover (Diretoria), meses ' || array_to_string(v_meses, ',') || '/' || v_ano || '. Taxa do contrato = demissões ÷ efetivo médio ÷ nº de meses.',
      'mensal', v_painel->'mensal', 'causas_de_demissao', v_painel->'causas',
      'contratos', (SELECT jsonb_agg(x) FROM jsonb_array_elements(v_painel->'por_contrato') x WHERE x->>'contrato' = ANY (nomes)))
      INTO r;
    RETURN r;
  END IF;

  -- ── Notificações do Jurídico (glosas, multas, reclamações, prazos) ────
  IF p_alvo IN ('op_glosas', 'fin_glosas', 'op_reclamacoes', 'jur_prazos', 'jur_sem_resposta', 'jur_multas_revertidas', 'jur_contratos_analise') THEN
    WITH f AS (
      SELECT n.*, coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato_ou_orgao
        FROM public."JUR_NOTIFICACOES" n
       WHERE CASE p_alvo
               WHEN 'op_glosas' THEN n.tipo = 'Glosa' AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'fin_glosas' THEN n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'op_reclamacoes' THEN coalesce(n.tipo, '') NOT IN ('Glosa', 'Multa') AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'jur_prazos' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.prazo_defesa - hoje <= coalesce(p_param, 5)
               WHEN 'jur_sem_resposta' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.etapa IN ('Recebida', 'Em análise')
               WHEN 'jur_multas_revertidas' THEN n.resultado ILIKE 'Revertida%' AND coalesce(n.data_desfecho, n.updated_at::date) >= hoje - coalesce(p_param, 365)::int
               ELSE nullif(btrim(n.medida_preventiva), '') IS NOT NULL AND NOT coalesce(n.medida_concluida, false) AND n.medida_prazo < hoje END)
    SELECT jsonb_build_object(
      'observacao', 'Notificações de Jurídico › Notificações (JUR_NOTIFICACOES) que entram na conta, com o mesmo filtro do indicador. Valores em R$.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_causa', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_orgao, 'causa', causa, 'qtd', q, 'valor', v) ORDER BY v DESC NULLS LAST, q DESC)
                                 FROM (SELECT contrato_ou_orgao, left(coalesce(nullif(btrim(causa_raiz), ''), nullif(btrim(assunto), ''), tipo, 'Sem causa registrada'), 100) AS causa,
                                              count(*) q, sum(coalesce(valor_final, valor_original)) v FROM f GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('protocolo', protocolo, 'documento', numero_documento, 'tipo', tipo, 'contrato', contrato_ou_orgao,
                       'posto', local_posto, 'ocorrencia', data_ocorrencia, 'recebida', data_recebimento, 'assunto', left(assunto, 150), 'causa_raiz', left(causa_raiz, 150),
                       'valor_original', valor_original, 'valor_final', valor_final, 'valor_descontado', valor_descontado, 'etapa', etapa, 'resultado', resultado,
                       'prazo_defesa', prazo_defesa, 'setor_responsavel', setor_responsavel,
                       'medida_preventiva', left(medida_preventiva, 120), 'medida_prazo', medida_prazo, 'medida_concluida', medida_concluida))
                      FROM (SELECT * FROM f ORDER BY coalesce(valor_final, valor_original) DESC NULLS LAST, coalesce(prazo_defesa, data_recebimento) LIMIT 40) z),
      'descontos_nas_nfs', CASE WHEN p_alvo = 'fin_glosas' THEN (
          SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao,
                                              'descontos_pos_emissao', descontos_pos_emissao_total, 'conta_vinculada_retida', desconto_conta_vinculada) ORDER BY tot DESC)
            FROM (SELECT n.numero_nf, c.nome AS contrato, n.competencia, n.data_emissao, n.descontos_pos_emissao_total, n.desconto_conta_vinculada,
                         coalesce(n.descontos_pos_emissao_total, 0) + coalesce(n.desconto_conta_vinculada, 0) AS tot
                    FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                   WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int
                     AND coalesce(n.descontos_pos_emissao_total, 0) + coalesce(n.desconto_conta_vinculada, 0) > 0
                   ORDER BY tot DESC LIMIT 25) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Processos do Jurídico (sem o nome do reclamante) ──────────────────
  IF p_alvo IN ('jur_audiencias', 'jur_reincidentes', 'jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (
      SELECT p.*, coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato') AS contrato_ou_comarca,
             coalesce(p.valor_pedidos, p.valor_causa, 0)::numeric AS pedidos,
             (SELECT min(left(d, 10)::date) FROM unnest(ARRAY[p.data_audiencia_designada, p.data_primeira_audiencia, p.data_audiencia_instrucao, p.data_pericia]) d
               WHERE d ~ '^\d{4}-\d{2}-\d{2}' AND left(d, 10)::date BETWEEN hoje AND hoje + coalesce(p_param, 15)::int) AS proxima
        FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO'),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'jur_audiencias' THEN proxima IS NOT NULL
            WHEN 'jur_risco' THEN pedidos >= coalesce(p_param, 100000)
            WHEN 'jur_valor_condenacao' THEN coalesce(valor_sentenca, 0) > 0
            WHEN 'jur_valor_acordo' THEN coalesce(valor_acordo, 0) > 0
            ELSE EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes)) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos em andamento de Jurídico › Processos (JUR_PROCESSOS) que entram na conta. Valores em R$; pedidos = valor dos pedidos (ou da causa).',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_comarca, 'processos', q, 'pedidos', s1, 'sentencas', s2, 'acordos', s3) ORDER BY s1 DESC)
                         FROM (SELECT contrato_ou_comarca, count(*) q, sum(pedidos) s1, sum(valor_sentenca) s2, sum(valor_acordo) s3 FROM f GROUP BY 1 ORDER BY 3 DESC LIMIT 15) z),
      'por_motivo_e_contrato', CASE WHEN p_alvo = 'jur_reincidentes' THEN (
          SELECT jsonb_agg(jsonb_build_object('motivo', m, 'contrato', contrato_ou_comarca, 'processos', q) ORDER BY array_position(nomes, m), q DESC)
            FROM (SELECT btrim(x) m, contrato_ou_comarca, count(DISTINCT numero_processo) q
                    FROM f, regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40) z) END,
      'registros', (SELECT jsonb_agg(jsonb_build_object('processo', numero_processo, 'contrato', contrato_ou_comarca, 'comarca', comarca, 'tipo', tipo_processo,
                       'motivos', left(motivos, 200), 'entrada', data_entrada_reclamatoria, 'pedidos', pedidos, 'valor_sentenca', valor_sentenca,
                       'status_sentenca', status_sentenca, 'houve_acordo', houve_acordo, 'valor_acordo', valor_acordo, 'recursos', status_recursos,
                       'proxima_data', proxima, 'audiencia_designada', data_audiencia_designada, 'instrucao', data_audiencia_instrucao, 'pericia', data_pericia))
                      FROM (SELECT * FROM f ORDER BY proxima NULLS LAST, pedidos DESC LIMIT CASE WHEN p_alvo = 'jur_reincidentes' THEN 12 ELSE 35 END) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações: as linhas da grade ────────────────────────────────────
  IF p_alvo IN ('lic_prazo', 'lic_propostas', 'lic_implantacao', 'lic_perdidas', 'lic_valor', 'lic_documentos', 'lic_risco') THEN
    WITH f AS (
      SELECT g.* FROM public.grade g
       WHERE CASE p_alvo
               WHEN 'lic_prazo' THEN g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int
               WHEN 'lic_propostas' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 7)::int
               WHEN 'lic_implantacao' THEN g.fase::text = 'Finalizada' AND g.posicao = 1 AND g.data >= hoje - coalesce(p_param, 365)::int
                    AND NOT EXISTS (SELECT 1 FROM public.implantacao_contrato i WHERE g.capa_id IS NOT NULL AND i.capa_id = g.capa_id)
                    AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.grade_id = g.id)
               WHEN 'lic_perdidas' THEN g.fase::text = 'Finalizada' AND g.posicao IS DISTINCT FROM 1 AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 90)::int)
               WHEN 'lic_valor' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento')
               WHEN 'lic_documentos' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.capa_id IS NULL AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 15)::int
               ELSE g.fase::text IN ('Suspenso', 'Revogado') AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 180)::int) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos da grade de Licitações que entram na conta. posicao = colocação da empresa (1 = vencedora); status_obs = observação/motivo registrado.',
      'total_registros', (SELECT count(*) FROM f),
      'registros', (SELECT jsonb_agg(jsonb_build_object('edital', edital, 'cidade', cidade, 'uf', uf, 'sessao', data, 'horario', horario, 'fase', fase,
                       'objeto', left(objeto, 150), 'valor_global', public.tvg_num_br(valor_global), 'pessoas', qtd_pessoas, 'posicao', posicao,
                       'status_obs', left(status_obs, 150), 'capa_preenchida', capa_id IS NOT NULL, 'captada_em', data_captacao))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'lic_valor' THEN -public.tvg_num_br(valor_global) END NULLS LAST, data LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: pedidos parados ───────────────────────────────────────────
  IF p_alvo IN ('sup_compras_vencidas', 'sup_contratos_sem_entrega', 'sst_epi', 'sst_imp_epi', 'sup_fornecedor') THEN
    WITH f AS (
      SELECT p.*, hoje - p.data_solicitacao AS dias, coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato
        FROM public.sup_pedido p
       WHERE CASE p_alvo
               WHEN 'sup_compras_vencidas' THEN p.status = 'AGUARDANDO COMPRA' AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               WHEN 'sup_contratos_sem_entrega' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int
               WHEN 'sup_fornecedor' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               ELSE p.tipo_pedido IN ('uniforme', 'ambos') AND p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                    AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Pedidos de material/uniforme do Supply (sup_pedido) parados, com o mesmo filtro do indicador. dias = desde a solicitação.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_status', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'status', status, 'qtd', q, 'mais_antigo_dias', d) ORDER BY q DESC)
                                  FROM (SELECT contrato, status, count(*) q, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('pedido', pedido_id, 'contrato', contrato, 'posto', posto_nome, 'funcao', funcao_nome, 'tipo', tipo_pedido,
                       'status', status, 'solicitado_em', data_solicitacao, 'dias', dias, 'admissao', admissao, 'origem', origem, 'observacao', left(observacao, 120)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: itens de estoque ──────────────────────────────────────────
  IF p_alvo IN ('sup_abaixo_minimo', 'sup_valor_estoque', 'sup_sem_mov') THEN
    WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
    i AS (SELECT ei.id, it.nome, it.tipo, it.tamanho, ei.estoque_minimo AS minimo, coalesce(ei.valor_unitario, 0) AS vu, ei.fornecedor, ei.validade,
                 coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis,
                 (SELECT max(m.created_at)::date FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = ei.id) AS ult_mov,
                 (SELECT max(c.consumido_em)::date FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = ei.id) AS ult_consumo
            FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
            LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL),
    f AS (SELECT * FROM i WHERE CASE p_alvo
            WHEN 'sup_abaixo_minimo' THEN minimo > 0 AND disp < minimo
            WHEN 'sup_valor_estoque' THEN fis > 0
            ELSE fis > 0 AND coalesce(greatest(ult_mov, ult_consumo), '1900-01-01') < hoje - coalesce(p_param, 90)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Itens do estoque do Supply que entram na conta. disp = disponível; fis = físico; vu = valor unitário; ult_mov/ult_consumo = última movimentação/consumo.',
      'total_registros', (SELECT count(*) FROM f), 'valor_total', (SELECT round(sum(fis * vu), 2) FROM f),
      'por_tipo', (SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'itens', q, 'valor', v) ORDER BY v DESC) FROM (SELECT tipo, count(*) q, round(sum(fis * vu), 2) v FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('item', nome, 'tipo', tipo, 'tamanho', tamanho, 'minimo', minimo, 'disp', disp, 'fis', fis, 'vu', vu,
                       'valor', round(fis * vu, 2), 'fornecedor', fornecedor, 'validade', validade, 'ult_mov', ult_mov, 'ult_consumo', ult_consumo))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'sup_abaixo_minimo' THEN disp::numeric / greatest(minimo, 1) ELSE -(fis * vu) END LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Frota e patrimônio ────────────────────────────────────────────────
  IF p_alvo IN ('fro_indisponiveis', 'fro_manutencoes', 'fro_sem_responsavel', 'fro_documentos', 'fro_nao_localizados') THEN
    WITH p AS (
      SELECT p.*, c.nome AS contrato,
             greatest(p.updated_at, (SELECT max(l.created_at) FROM public.sup_patrimonio_log l WHERE l.patrimonio_id = p.id))::date AS ult_atualizacao
        FROM public.sup_patrimonio p LEFT JOIN public.contratos c ON c.id = p.contrato_id WHERE p.ativo),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'fro_indisponiveis' THEN categoria = 'veiculo' AND (em_manutencao OR motivo_indisponivel IS NOT NULL)
            WHEN 'fro_manutencoes' THEN em_manutencao AND data_previsao_fim < hoje
            WHEN 'fro_sem_responsavel' THEN contrato_id IS NULL AND posto_id IS NULL AND nullif(btrim(lotacao), '') IS NULL
            WHEN 'fro_documentos' THEN categoria = 'veiculo' AND NOT EXISTS (SELECT 1 FROM public.sup_patrimonio_arquivo a WHERE a.patrimonio_id = p.id)
            ELSE hoje - ult_atualizacao > coalesce(p_param, 180) END)
    SELECT jsonb_build_object(
      'observacao', 'Bens ativos de Patrimônio/Frota (sup_patrimonio) que entram na conta. ult_atualizacao = última alteração ou movimentação registrada.',
      'total_registros', (SELECT count(*) FROM f),
      'por_categoria_e_lotacao', (SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'lotacao', lot, 'qtd', q) ORDER BY q DESC)
                                    FROM (SELECT categoria, coalesce(nullif(btrim(lotacao), ''), contrato, 'Sem lotação') lot, count(*) q FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('bem', nome, 'identificador', identificador, 'categoria', categoria, 'lotacao', lotacao, 'contrato', contrato,
                       'em_manutencao', em_manutencao, 'motivo_indisponivel', motivo_indisponivel, 'motivo_detalhe', left(motivo_detalhe, 150),
                       'inicio_manutencao', data_inicio_manutencao, 'previsao_retorno', data_previsao_fim, 'ult_atualizacao', ult_atualizacao))
                      FROM (SELECT * FROM f ORDER BY data_previsao_fim NULLS LAST, ult_atualizacao LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'fro_combustivel' THEN
    WITH a AS (SELECT * FROM public.cs_veiculo_agendamento a
                WHERE a.controle_km AND coalesce(a.status, '') NOT ILIKE '%cancel%' AND a.data_fim BETWEEN hoje - coalesce(p_param, 60)::int AND hoje - 1)
    SELECT jsonb_build_object(
      'observacao', 'Viagens do agendamento de veículos com controle de km nos últimos ' || coalesce(p_param, 60)::int || ' dias; sem_km = encerrada sem km inicial ou final.',
      'por_veiculo', (SELECT jsonb_agg(jsonb_build_object('veiculo', v, 'viagens', q, 'sem_km', s, 'km_rodado', km) ORDER BY s DESC, km DESC)
                        FROM (SELECT coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, '') v, count(*) q,
                                     count(*) FILTER (WHERE km_inicial IS NULL OR km_final IS NULL) s,
                                     sum(km_final - km_inicial) FILTER (WHERE km_final >= km_inicial) km FROM a GROUP BY 1) z),
      'viagens_sem_km', (SELECT jsonb_agg(jsonb_build_object('agendamento', numero, 'veiculo', coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, ''),
                            'inicio', data_inicio, 'fim', data_fim, 'destino', left(destino, 80), 'status', status, 'km_inicial', km_inicial, 'km_final', km_final))
                           FROM (SELECT * FROM a WHERE km_inicial IS NULL OR km_final IS NULL ORDER BY data_fim DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Recrutamento: as vagas, com os candidatos por etapa ───────────────
  IF p_alvo IN ('rec_risco', 'rec_abertas', 'rec_prazo', 'rec_admissoes') THEN
    WITH f AS (
      SELECT s.*, hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias,
             hoje - (coalesce(s.status_changed_at, s.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dias_no_status
        FROM public."SISTEMA_RECRUTAMENTO" s
       WHERE CASE WHEN p_alvo = 'rec_admissoes'
                  THEN s.status NOT IN ('Reprovada', 'Contratado', 'Concluído') AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
                       AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje
                  ELSE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
                       AND (p_alvo = 'rec_abertas' OR (p_alvo = 'rec_risco' AND s.grau_urgencia ILIKE 'Alta%')
                            OR (p_alvo = 'rec_prazo' AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))) END)
    SELECT jsonb_build_object(
      'observacao', 'Vagas da Gestão Recrutamento (SISTEMA_RECRUTAMENTO) que entram na conta' ||
                    CASE WHEN p_alvo = 'rec_admissoes' THEN ' (só as PENDENTES: início previsto no mês até hoje e ainda não contratadas)' ELSE '' END ||
                    '. candidatos = currículos no kanban da vaga por etapa (sem desistentes).',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(status, q) FROM (SELECT status, sum(greatest(coalesce(quantidade_vagas, 1), 1)) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('vaga', id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo, 'qtd', coalesce(quantidade_vagas, 1),
                       'status', status, 'urgencia', grau_urgencia, 'motivo', motivo_vaga, 'aberta_ha_dias', dias, 'dias_no_status', dias_no_status,
                       'inicio_previsto', data_inicio_prevista, 'alta_rotatividade', alta_rotatividade,
                       'candidatos', (SELECT jsonb_object_agg(coalesce(etapa_processo, '—'), q) FROM (SELECT etapa_processo, count(*) q FROM public."WA_CURRICULOS" c
                                        WHERE c.vaga_id = z.id AND NOT coalesce(c.desistiu, false) GROUP BY 1) w),
                       'desistencias', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE c.vaga_id = z.id AND c.desistiu)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'rec_desistencias' THEN
    WITH d AS (SELECT h.created_at::date AS dia, h.solicitacao_id, s.contrato, s.cidade, s.cargo, h.de_status, h.evento,
                      coalesce(substring(h.evento FROM '\(em ([^)]+)\)'), coalesce(h.de_status, 'etapa não informada')) AS etapa,
                      (SELECT c.desistencia_motivo FROM public."WA_CURRICULOS" c WHERE c.id = h.candidato_id) AS motivo
                 FROM public."RECRUTAMENTO_HISTORICO" h LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int))
    SELECT jsonb_build_object(
      'observacao', 'Desistências registradas no histórico das vagas nos últimos ' || coalesce(p_param, 30)::int || ' dias (sem o nome do candidato).',
      'por_etapa', (SELECT jsonb_object_agg(etapa, q) FROM (SELECT etapa, count(*) q FROM d GROUP BY 1) z),
      'por_motivo', (SELECT jsonb_object_agg(m, q) FROM (SELECT coalesce(nullif(btrim(motivo), ''), 'não informado') m, count(*) q FROM d GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('dia', dia, 'vaga', solicitacao_id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo,
                       'etapa', etapa, 'motivo', left(motivo, 150)) ORDER BY dia DESC) FROM (SELECT * FROM d ORDER BY dia DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Rescisões e ASO (sem nome do colaborador/candidato) ───────────────
  IF p_alvo IN ('rh_ob_rescisoes', 'sst_aso', 'sst_imp_aso') THEN
    SELECT jsonb_build_object(
      'observacao', 'Solicitações de demissão pendentes' || CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN '' ELSE ' no SST e candidatos na etapa SST + COMPRAS (admissional)' END ||
                    '; dias = desde a solicitação / desde que entrou na etapa.',
      'demissionais', (SELECT jsonb_agg(jsonb_build_object('solicitacao', id, 'contrato', contrato, 'cargo', colaborador_cargo, 'posto', colaborador_posto,
                          'motivo', left(coalesce(motivo_solicitacao, motivo_pedido), 120), 'status', status, 'solicitada_em', coalesce(data_solicitacao, criado_em::date),
                          'dias', hoje - coalesce(data_solicitacao, criado_em::date), 'aviso', data_aviso, 'modelo_aviso', modelo_aviso,
                          'exame_agendado', sst_data_exame, 'devolvida', left(devolvido_motivo, 120)) ORDER BY coalesce(data_solicitacao, criado_em::date))
                         FROM (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                                WHERE s.status IN (CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente Operacional' END, CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente RH' END,
                                                   'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')
                                ORDER BY coalesce(s.data_solicitacao, s.criado_em::date) LIMIT 40) z),
      'admissionais', CASE WHEN p_alvo <> 'rh_ob_rescisoes' THEN (
          SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'contrato', v.contrato, 'cidade', v.cidade, 'cargo', v.cargo,
                   'dias_na_etapa', hoje - coalesce(c.etapa_changed_at, c.created_at)::date, 'exame_agendado', c.sst_data_exame,
                   'sst_ok', c.sst_ok, 'compras_ok', c.compras_ok) ORDER BY coalesce(c.etapa_changed_at, c.created_at))
            FROM (SELECT * FROM public."WA_CURRICULOS" c WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
                   ORDER BY coalesce(c.etapa_changed_at, c.created_at) LIMIT 40) c
            LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamentos ──────────────────────────────────────────────────────
  IF p_alvo = 'trn_integracoes' THEN
    WITH a AS (SELECT a.*, coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS ctr FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int)
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object(
      'observacao', 'Alunos ativos criados nos últimos ' || coalesce(p_param, 30)::int || ' dias sem nenhuma aula concluída na plataforma de Treinamentos.',
      'por_contrato_e_cargo', (SELECT jsonb_agg(jsonb_build_object('contrato', ctr, 'cargo', cargo, 'alunos', q, 'nunca_acessaram', na) ORDER BY q DESC)
                                 FROM (SELECT ctr, cargo, count(*) q, count(*) FILTER (WHERE primeiro_acesso_em IS NULL) na FROM a GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25) z),
      'matriculas_desses_alunos', (SELECT jsonb_object_agg(curso, q) FROM (SELECT c.nome curso, count(*) q FROM a JOIN public."TRN_MATRICULA" m ON m.aluno_id = a.id
                                     JOIN public."TRN_CURSO" c ON c.id = m.curso_id GROUP BY 1 ORDER BY 2 DESC LIMIT 15) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo IN ('trn_contratuais', 'trn_vencidos', 'sst_imp_treinamento', 'trn_programados', 'trn_sem_comprovacao') THEN
    v_mes := date_trunc('month', hoje)::date;
    WITH m AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato, c.nome AS curso, m.inscrito_em, hoje - m.inscrito_em AS dias, a.expira_em,
                      EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = m.aluno_id AND ce.curso_id = m.curso_id) AS certificado
                 FROM public."TRN_MATRICULA" m JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id JOIN public."TRN_CURSO" c ON c.id = m.curso_id
                WHERE CASE WHEN p_alvo IN ('trn_programados') THEN m.inscrito_em >= v_mes
                           WHEN p_alvo = 'trn_sem_comprovacao' THEN m.inscrito_em < hoje - coalesce(p_param, 60)::int
                           ELSE a.status = 'ativo' END),
    f AS (SELECT * FROM m WHERE CASE p_alvo
            WHEN 'trn_contratuais' THEN NOT certificado AND dias > coalesce(p_param, 30)
            WHEN 'trn_programados' THEN true
            WHEN 'trn_sem_comprovacao' THEN NOT certificado
            ELSE NOT certificado AND expira_em IS NOT NULL AND expira_em <= hoje + coalesce(p_param, 15)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Matrículas da plataforma de Treinamentos que entram na conta, por curso e contrato do aluno.' ||
                    CASE WHEN p_alvo = 'trn_programados' THEN ' Mês corrente: matrículas e quantas já têm certificado.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_curso', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'matriculas', q, 'com_certificado', ok, 'mais_antiga_dias', d) ORDER BY q DESC)
                      FROM (SELECT curso, count(*) q, count(*) FILTER (WHERE certificado) ok, max(dias) d FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 20) z),
      'por_curso_e_contrato', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'contrato', contrato, 'qtd', q, 'vence_ate', v) ORDER BY q DESC)
                                 FROM (SELECT curso, contrato, count(*) q, min(expira_em) v FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faturamento, recebimento, inadimplência, fluxo ────────────────────
  IF p_alvo IN ('fin_notas_pendentes', 'fin_valor_pendente') THEN
    v_mes := CASE WHEN extract(day FROM hoje) > coalesce(p_param, 20) THEN date_trunc('month', hoje - interval '1 month')
                  ELSE date_trunc('month', hoje - interval '2 months') END::date;
    SELECT jsonb_build_object(
      'observacao', 'Contratos ativos sem NF enviada/concluída da competência ' || to_char(v_mes, 'MM/YYYY') || ' no Faturamento (nf_emissao). nf_da_competencia = NF que existe mas ainda não foi enviada/concluída.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', c.nome, 'cliente', c.cliente, 'valor', coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado),
                     'ultima_competencia_emitida', (SELECT max(n.competencia) FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida')),
                     'nf_da_competencia', (SELECT jsonb_agg(jsonb_build_object('status', n.status, 'numero', n.numero_nf)) FROM public.nf_emissao n
                                             WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.competencia = v_mes))
                     ORDER BY coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado) DESC), '[]'::jsonb))
      INTO r
      FROM public.contratos c
     WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida') AND n.competencia = v_mes);
    RETURN r;
  END IF;

  IF p_alvo IN ('fin_recebimentos', 'fin_inadimplencia', 'fin_fluxo') THEN
    WITH n AS (
      SELECT n.*, c.nome AS contrato, n.data_emissao + CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END AS vencimento
        FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
       WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL),
    f AS (SELECT * FROM n WHERE CASE p_alvo
            WHEN 'fin_recebimentos' THEN vencimento BETWEEN date_trunc('month', hoje)::date AND hoje
            WHEN 'fin_inadimplencia' THEN data_pagamento IS NULL AND hoje - vencimento >= 15
            ELSE data_pagamento IS NULL AND vencimento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int END)
    SELECT jsonb_build_object(
      'observacao', 'NFs concluídas do Faturamento (nf_emissao) que entram na conta; vencimento = emissão + ' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END || ' dias; pago = tem data de pagamento.' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN ' Saídas = despesas do Malote a pagar no período.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', coalesce(contrato, 'Sem contrato'), 'nfs', q, 'valor', v, 'em_aberto', a) ORDER BY a DESC)
                         FROM (SELECT contrato, count(*) q, sum(vlr_liquido_total) v, sum(vlr_liquido_total) FILTER (WHERE data_pagamento IS NULL) a FROM f GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao, 'vencimento', vencimento,
                       'dias_atraso', CASE WHEN data_pagamento IS NULL AND vencimento < hoje THEN hoje - vencimento END, 'valor_liquido', vlr_liquido_total,
                       'pago_em', data_pagamento, 'valor_pago', valor_pago, 'falta_receber', falta_receber, 'obs_financeiro', left(observacoes_financeiro, 120)))
                      FROM (SELECT * FROM f ORDER BY (data_pagamento IS NULL) DESC, vlr_liquido_total DESC NULLS LAST LIMIT 40) z),
      'saidas_malote', CASE WHEN p_alvo = 'fin_fluxo' THEN (
          SELECT jsonb_agg(jsonb_build_object('despesa', numero, 'descricao', left(nome, 80), 'tipo', tipo, 'pagar_em', data_pagamento,
                                              'valor', coalesce(valor_aprovado, valor_total), 'status', status) ORDER BY data_pagamento)
            FROM (SELECT * FROM public.malote_despesa d
                   WHERE d.deleted_at IS NULL AND d.pago_em IS NULL AND coalesce(d.status, '') NOT ILIKE ANY (ARRAY['%cancel%', '%reprov%', '%pag%'])  -- igual à tvg_calc_extra (fin_fluxo)
                     AND d.data_pagamento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int
                   ORDER BY coalesce(d.valor_aprovado, d.valor_total) DESC NULLS LAST LIMIT 40) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Controladoria: planos de ação e indicadores manuais ───────────────
  IF p_alvo = 'ctl_planos' THEN
    WITH f AS (SELECT p.* FROM public.plano_acao p
                WHERE p.deleted_at IS NULL AND coalesce(p.status_normalizado, '') NOT LIKE 'concluida%' AND p.data_fim_planejado < hoje)
    SELECT jsonb_build_object(
      'observacao', 'Planos de ação (Plano de Ações) com prazo final vencido e não concluídos.',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(coalesce(status_normalizado, '—'), q) FROM (SELECT status_normalizado, count(*) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('titulo', left(coalesce(titulo, acao), 120), 'area', coalesce(nullif(btrim(area), ''), nullif(btrim(setor), ''), comite),
                       'comite', comite, 'prioridade', prioridade_normalizada, 'prazo', data_fim_planejado, 'dias_atraso', hoje - data_fim_planejado,
                       'status', status_normalizado, 'custo_previsto', custo_previsto, 'tipo', tipo_acao))
                      FROM (SELECT * FROM f ORDER BY data_fim_planejado LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ctl_nao_atualizados' THEN
    SELECT jsonb_build_object('observacao', 'Indicadores de lançamento manual das TVs sem lançamento dentro da periodicidade.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('indicador', i.nome, 'tv', pa.titulo, 'periodicidade', i.periodicidade, 'responsavel_area', i.responsavel,
                     'ultimo_lancamento', (SELECT max(l.created_at)::date FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo)) ORDER BY pa.titulo), '[]'::jsonb))
      INTO r
      FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" pa ON pa.slug = i.painel
     WHERE i.ativo AND i.fonte = 'manual'
       AND coalesce((SELECT max(l.created_at) FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo), '-infinity')
           < now() - make_interval(days => CASE i.periodicidade WHEN 'diaria' THEN 2 WHEN 'semanal' THEN 8 ELSE 35 END);
    RETURN r;
  END IF;

  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_alvo IN ('ti_erros', 'ti_demandas') THEN
    WITH f AS (SELECT c.* FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND c.prioridade = 'alta'
                  AND ((p_alvo = 'ti_erros' AND c.tipo_solicitacao = 'correcao')
                    OR (p_alvo = 'ti_demandas' AND (c.prazo_previsto < hoje
                         OR (c.prazo_previsto IS NULL AND c.created_at < now() - make_interval(days => coalesce(p_param, 30)::int))))))
    SELECT jsonb_build_object('observacao', 'Chamados de Sistemas (CHAMADO_SISTEMA) de prioridade alta que entram na conta.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('chamado', numero, 'assunto', left(assunto, 120), 'modulo', coalesce(nullif(btrim(modulo_sistema), ''), 'Outro'),
                       'tipo', tipo_solicitacao, 'status', status, 'setor', setor, 'aberto_ha_dias', hoje - (created_at AT TIME ZONE 'America/Sao_Paulo')::date,
                       'prazo', prazo_previsto) ORDER BY created_at) FROM (SELECT * FROM f ORDER BY created_at LIMIT 40) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_integracoes' THEN
    SELECT jsonb_build_object('observacao', 'Itens da fila de integrações (fila_http) com erro e não processados, agrupados por destino e erro.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('destino', destino, 'erro', erro, 'qtd', q, 'primeiro', p1, 'ultimo', p2, 'tentativas_max', t) ORDER BY q DESC), '[]'::jsonb))
      INTO r
      FROM (SELECT f.destino, left(f.erro, 200) erro, count(*) q, min(f.criado_em) p1, max(f.criado_em) p2, max(f.tentativas) t FROM public.fila_http f
             WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int)
             GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_acessos' THEN
    SELECT jsonb_build_object('observacao', 'Logins do ERP ainda ativos de colaboradores demitidos na Senior (sem nome): setor, cargo, data de afastamento e último login.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('setor', coalesce(nullif(btrim(e."Setor_ERP"), ''), nullif(btrim(e."Nome Filial"), ''), 'Sem setor'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'data_afastamento', e."Data Afastamento",
                     'ultimo_login', u.last_sign_in_at::date)), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e WHERE e."Situação" = 'Demitido' AND e.auth_user_id IS NOT NULL) e
      JOIN auth.users u ON u.id = e.auth_user_id
     WHERE u.banned_until IS NULL OR u.banned_until < now();
    RETURN r;
  END IF;

  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe_dados(text, numeric) FROM PUBLIC, anon, authenticated;

-- Portão: o mesmo de tvg_fonte. Espelho usa o original; soma junta os componentes.
CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; alvo text; par numeric;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF i.fonte = 'soma' THEN
    RETURN (SELECT jsonb_object_agg(c.nome, public.tvg_ia_detalhe_dados(c.codigo, c.parametro))
              FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[])));
  END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  par := coalesce((SELECT o.parametro FROM public."TVG_INDICADOR" o WHERE o.codigo = alvo), i.parametro);
  RETURN public.tvg_ia_detalhe_dados(alvo, par);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_ia_detalhe(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta ao detalhe só do DRE: reaplicar 20261014000023)
-- DROP FUNCTION IF EXISTS public.tvg_ia_detalhe_dados(text, numeric);
