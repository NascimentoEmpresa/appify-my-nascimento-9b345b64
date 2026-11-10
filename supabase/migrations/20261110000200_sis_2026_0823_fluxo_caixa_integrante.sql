-- SIS-2026-0823 — Fluxo de Caixa: coluna Integrante (ao lado de Centro de Custo) e alteração em massa do Integrante
-- ============================================================================
-- O integrante (colaborador de EMPREGADOS) só existe nas linhas de RATEIO do Malote (malote_despesa_rateio_linha.integrante_empregado_id).
-- Débito Automático, cartão, aplicação, conta garantida e a planilha importada não têm integrante: a coluna fica em branco para elas.
--
--   1. fluxo_integrante_nome(bigint)  : nome do colaborador, SECURITY DEFINER. EMPREGADOS tem RLS restrita ao RH e as views do Fluxo são
--                                       security_invoker, então um JOIN direto devolveria o nome em branco para o Financeiro. Só devolve o nome.
--   2. v_malote_pagamento_fluxo_caixa e v_malote_pagamento_fluxo_caixa_consolidado ganham, NO FINAL, integrante_empregado_id e integrante_nome.
--      Na fatura consolidada de cartão (várias despesas numa linha) o integrante fica nulo. As outras views do Fluxo não mudam.
--   3. fluxo_caixa_trocar_integrante  : troca o integrante na linha de rateio de ORIGEM, como fluxo_caixa_trocar_contrato faz com o centro de
--                                       custo (permissão de alterar o Fluxo; uma só linha de rateio; evento no histórico da despesa).
--   4. fluxo_caixa_integrantes_listar : lista (id, nome) dos colaboradores para o seletor da alteração em massa, para quem pode alterar o Fluxo.
--
-- Fornecedor e Integrante NÃO são excludentes no rateio (basta um dos dois; 704 linhas têm os dois), então trocar o integrante não mexe no fornecedor.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK (recria as views sem as colunas novas a partir da migration anterior que as definiu, e remove as funções):
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_trocar_integrante(text, uuid, bigint);
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_integrantes_listar();
--   (as views só ganharam colunas no final; o front ignora o excesso. Para remover: recriar as views sem integrante_empregado_id/integrante_nome
--    com DROP VIEW v_malote_pagamento_fluxo_caixa_consolidado, v_malote_pagamento_fluxo_caixa e recriar pelas migrations originais, depois
--    DROP FUNCTION IF EXISTS public.fluxo_integrante_nome(bigint).)

CREATE OR REPLACE FUNCTION public.fluxo_integrante_nome(_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e."Nome" FROM public."EMPREGADOS" e WHERE e."ID" = _id;
$$;
REVOKE ALL ON FUNCTION public.fluxo_integrante_nome(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_integrante_nome(bigint) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa WITH (security_invoker = true) AS
 WITH base AS (
         SELECT d.id AS despesa_id,
            d.numero AS id_malote,
            d.data_pagamento AS data_pagamento_orig,
            d.competencia AS competencia_orig,
            COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
            COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
            COALESCE(rl.classificacao_id, d.classificacao_id) AS classificacao_id_orig,
            (d.nome ||
                CASE
                    WHEN (COALESCE(d.valor_juros, (0)::numeric) > (0)::numeric) THEN ((' (inclui R$ '::text || replace(to_char(d.valor_juros, 'FM999999990D00'::text), '.'::text, ','::text)) || ' de juros)'::text)
                    ELSE ''::text
                END) AS descricao_orig,
            d.forma_pagamento AS forma_pagamento_orig,
            d.banco_id AS banco_id_orig,
            NULL::integer AS numero_parcela,
            NULL::integer AS numero_parcelas,
                CASE
                    WHEN (rl.id IS NULL) THEN (d.valor_aprovado + COALESCE(d.valor_juros, (0)::numeric))
                    ELSE COALESCE(((rl.valor * (COALESCE(d.valor_aprovado, d.valor_total) + COALESCE(d.valor_juros, (0)::numeric))) / NULLIF(sum(rl.valor) OVER (PARTITION BY d.id), (0)::numeric)), (rl.valor + COALESCE(d.valor_juros, (0)::numeric)))
                END AS valor_orig,
            'saida'::text AS tipo_orig,
            'malote'::text AS origem,
            rl.integrante_empregado_id AS integrante_orig
           FROM (malote_despesa d
             LEFT JOIN malote_despesa_rateio_linha rl ON ((rl.despesa_id = d.id)))
          WHERE ((d.status = 'despesa_paga'::text) AND (NOT d.parcelado) AND (d.deleted_at IS NULL))
        UNION ALL
         SELECT d.id AS despesa_id,
            d.numero AS id_malote,
            p.data_pagamento_real AS data_pagamento_orig,
            d.competencia AS competencia_orig,
            COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
            COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
            COALESCE(rl.classificacao_id, d.classificacao_id) AS classificacao_id_orig,
            (d.nome ||
                CASE
                    WHEN (COALESCE(p.valor_juros, (0)::numeric) > (0)::numeric) THEN ((' (inclui R$ '::text || replace(to_char(p.valor_juros, 'FM999999990D00'::text), '.'::text, ','::text)) || ' de juros)'::text)
                    ELSE ''::text
                END) AS descricao_orig,
            d.forma_pagamento AS forma_pagamento_orig,
            p.banco_id AS banco_id_orig,
            p.numero_parcela,
            d.numero_parcelas,
            ((p.valor + COALESCE(p.valor_juros, (0)::numeric)) * COALESCE((rl.valor / NULLIF(d.valor_total, (0)::numeric)), (1)::numeric)) AS valor_orig,
            'saida'::text AS tipo_orig,
            'malote'::text AS origem,
            rl.integrante_empregado_id AS integrante_orig
           FROM ((malote_despesa d
             JOIN malote_despesa_parcela p ON (((p.despesa_id = d.id) AND (p.status = 'paga'::text))))
             LEFT JOIN malote_despesa_rateio_linha rl ON ((rl.despesa_id = d.id)))
          WHERE (d.parcelado AND (d.deleted_at IS NULL))
        )
 SELECT b.despesa_id,
    b.id_malote,
    COALESCE(aj.data_pagamento, b.data_pagamento_orig) AS data_pagamento,
    COALESCE(aj.competencia, b.competencia_orig) AS competencia,
    COALESCE(aj.empresa_id, b.empresa_id_orig) AS empresa_id,
    COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
    b.contrato_id,
    c.nome AS contrato_nome,
    COALESCE(aj.classificacao_id, b.classificacao_id_orig) AS classificacao_id,
    cl.nome AS classificacao_nome,
    COALESCE(aj.descricao, b.descricao_orig) AS descricao,
    COALESCE(aj.forma_pagamento, b.forma_pagamento_orig) AS forma_pagamento,
    COALESCE(aj.banco_id, b.banco_id_orig) AS banco_id,
    cb.nome AS banco_nome,
    cb.logo_path AS banco_logo_path,
    b.numero_parcela,
    b.numero_parcelas,
    COALESCE(((aj.valor * b.valor_orig) / NULLIF(sum(b.valor_orig) OVER (PARTITION BY b.despesa_id, b.numero_parcela), (0)::numeric)), aj.valor, b.valor_orig) AS valor,
    COALESCE(aj.tipo, b.tipo_orig) AS tipo,
    b.origem,
    (aj.id IS NOT NULL) AS ajustado,
    b.integrante_orig AS integrante_empregado_id,
    CASE WHEN b.integrante_orig IS NULL THEN NULL ELSE public.fluxo_integrante_nome(b.integrante_orig) END AS integrante_nome
   FROM (((((base b
     LEFT JOIN financeiro_fluxo_caixa_ajuste aj ON (((aj.origem = b.origem) AND (aj.despesa_id = b.despesa_id) AND (NOT (aj.numero_parcela IS DISTINCT FROM b.numero_parcela)))))
     LEFT JOIN empresas e ON ((e.id = COALESCE(aj.empresa_id, b.empresa_id_orig))))
     LEFT JOIN contratos c ON ((c.id = b.contrato_id)))
     LEFT JOIN planejamento_orcamentario_classificacao cl ON ((cl.id = COALESCE(aj.classificacao_id, b.classificacao_id_orig))))
     LEFT JOIN malote_cartao_banco cb ON ((cb.id = COALESCE(aj.banco_id, b.banco_id_orig))));

CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa_consolidado WITH (security_invoker = true) AS
 WITH x AS (
         SELECT v.despesa_id,
            v.id_malote,
            v.data_pagamento,
            v.competencia,
            v.empresa_id,
            v.empresa_nome,
            v.contrato_id,
            v.contrato_nome,
            v.classificacao_id,
            v.classificacao_nome,
            v.descricao,
            v.forma_pagamento,
            v.banco_id,
            v.banco_nome,
            v.banco_logo_path,
            v.numero_parcela,
            v.numero_parcelas,
            v.valor,
            v.tipo,
            v.origem,
            v.ajustado,
            cc.cartao_id AS cc_cartao_id,
            cc.nome_cartao AS cc_nome,
            cc.dia_vencimento AS cc_venc,
                CASE
                    WHEN ((cc.cartao_id IS NULL) OR (v.data_pagamento IS NULL)) THEN NULL::date
                    WHEN ((v.numero_parcela IS NOT NULL) AND ((EXTRACT(day FROM v.data_pagamento))::integer = cc.dia_vencimento)) THEN (((date_trunc('month'::text, (v.data_pagamento)::timestamp with time zone))::date -
                    CASE
                        WHEN (cc.dia_vencimento <= cc.dia_fechamento) THEN '1 mon'::interval
                        ELSE '00:00:00'::interval
                    END))::date
                    ELSE (((date_trunc('month'::text, (v.data_pagamento)::timestamp with time zone))::date +
                    CASE
                        WHEN (EXTRACT(day FROM v.data_pagamento) > (cc.dia_fechamento)::numeric) THEN '1 mon'::interval
                        ELSE '00:00:00'::interval
                    END))::date
                END AS fat_mes,
            cc.dia_fechamento AS cc_fech,
            v.integrante_empregado_id,
            v.integrante_nome
           FROM (v_malote_pagamento_fluxo_caixa v
             LEFT JOIN fn_cartoes_fatura_consolidada() cc(cartao_id, nome_cartao, tipo_forma_pagamento, dia_fechamento, dia_vencimento, final_cartao) ON (((cc.tipo_forma_pagamento = v.forma_pagamento) OR ((cc.final_cartao IS NOT NULL) AND (v.forma_pagamento ~~* (('%final '::text || cc.final_cartao) || '%'::text))))))
        ), y AS (
         SELECT x.despesa_id,
            x.id_malote,
            x.data_pagamento,
            x.competencia,
            x.empresa_id,
            x.empresa_nome,
            x.contrato_id,
            x.contrato_nome,
            x.classificacao_id,
            x.classificacao_nome,
            x.descricao,
            x.forma_pagamento,
            x.banco_id,
            x.banco_nome,
            x.banco_logo_path,
            x.numero_parcela,
            x.numero_parcelas,
            x.valor,
            x.tipo,
            x.origem,
            x.ajustado,
            x.cc_cartao_id,
            x.cc_nome,
            x.cc_venc,
            x.fat_mes,
            x.cc_fech,
                CASE
                    WHEN (x.fat_mes IS NULL) THEN NULL::date
                    ELSE ((x.fat_mes +
                    CASE
                        WHEN (x.cc_venc <= x.cc_fech) THEN '1 mon'::interval
                        ELSE '00:00:00'::interval
                    END))::date
                END AS venc_mes,
            x.integrante_empregado_id,
            x.integrante_nome
           FROM x
        )
 SELECT
        CASE
            WHEN (fat_mes IS NULL) THEN despesa_id
            ELSE (md5(((('fatura-cartao:'::text || (cc_cartao_id)::text) || ':'::text) || (fat_mes)::text)))::uuid
        END AS despesa_id,
        CASE
            WHEN (fat_mes IS NULL) THEN id_malote
            ELSE ((cc_nome || ' — fatura '::text) || to_char((venc_mes)::timestamp with time zone, 'MM/YYYY'::text))
        END AS id_malote,
        CASE
            WHEN (fat_mes IS NULL) THEN data_pagamento
            ELSE (venc_mes + (LEAST(cc_venc, (EXTRACT(day FROM ((venc_mes + '1 mon'::interval) - '1 day'::interval)))::integer) - 1))
        END AS data_pagamento,
        CASE
            WHEN (fat_mes IS NULL) THEN competencia
            ELSE venc_mes
        END AS competencia,
    empresa_id,
    empresa_nome,
    contrato_id,
    contrato_nome,
    classificacao_id,
    classificacao_nome,
        CASE
            WHEN (fat_mes IS NULL) THEN descricao
            ELSE ((('Fatura '::text || cc_nome) || ' '::text) || to_char((venc_mes)::timestamp with time zone, 'MM/YYYY'::text))
        END AS descricao,
    forma_pagamento,
    banco_id,
    banco_nome,
    banco_logo_path,
        CASE
            WHEN (fat_mes IS NULL) THEN numero_parcela
            ELSE NULL::integer
        END AS numero_parcela,
        CASE
            WHEN (fat_mes IS NULL) THEN numero_parcelas
            ELSE NULL::integer
        END AS numero_parcelas,
    valor,
    tipo,
    origem,
    ajustado,
    cc_cartao_id AS fatura_cartao_id,
    fat_mes AS fatura_mes,
    despesa_id AS despesa_id_origem,
    numero_parcela AS numero_parcela_origem,
    id_malote AS id_malote_origem,
    descricao AS descricao_origem,
    numero_parcelas AS numero_parcelas_origem,
    min(data_pagamento) OVER (PARTITION BY y.despesa_id) AS data_compra_origem,
        CASE WHEN (fat_mes IS NULL) THEN integrante_empregado_id ELSE NULL::bigint END AS integrante_empregado_id,
        CASE WHEN (fat_mes IS NULL) THEN integrante_nome ELSE NULL::text END AS integrante_nome
   FROM y;

-- Troca o integrante da despesa do Malote pelo Fluxo de Caixa (grava na linha de rateio de origem; uma só linha de rateio).
CREATE OR REPLACE FUNCTION public.fluxo_caixa_trocar_integrante(_origem text, _despesa_id uuid, _empregado_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n_rateio int;
  v_rateio_id uuid;
  v_antigo bigint;
  v_antigo_nome text;
  v_novo_nome text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  IF _empregado_id IS NULL THEN
    RAISE EXCEPTION 'Informe o integrante.';
  END IF;
  IF _origem IS DISTINCT FROM 'malote' THEN
    RAISE EXCEPTION 'Só despesas do Malote têm integrante: esta origem não permite trocar o integrante pelo Fluxo de Caixa.';
  END IF;

  SELECT e."Nome" INTO v_novo_nome FROM public."EMPREGADOS" e WHERE e."ID" = _empregado_id;
  IF v_novo_nome IS NULL THEN
    RAISE EXCEPTION 'Integrante não encontrado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = _despesa_id AND d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Despesa do Malote não encontrada.';
  END IF;

  SELECT count(*) INTO v_n_rateio FROM public.malote_despesa_rateio_linha WHERE despesa_id = _despesa_id;
  IF v_n_rateio > 1 THEN
    RAISE EXCEPTION 'Esta despesa é rateada em várias linhas: ajuste o integrante de cada linha direto na grade de rateio do Malote.';
  END IF;
  IF v_n_rateio = 0 THEN
    RAISE EXCEPTION 'Esta despesa não tem linha de rateio para receber o integrante: ajuste direto no Malote.';
  END IF;

  SELECT rl.id, rl.integrante_empregado_id INTO v_rateio_id, v_antigo
    FROM public.malote_despesa_rateio_linha rl WHERE rl.despesa_id = _despesa_id;
  IF v_antigo IS NOT DISTINCT FROM _empregado_id THEN
    RAISE EXCEPTION 'O lançamento já está com este integrante.';
  END IF;

  IF v_antigo IS NOT NULL THEN
    SELECT e."Nome" INTO v_antigo_nome FROM public."EMPREGADOS" e WHERE e."ID" = v_antigo;
  END IF;

  UPDATE public.malote_despesa_rateio_linha SET integrante_empregado_id = _empregado_id WHERE id = v_rateio_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
  VALUES (_despesa_id, 'edicao',
          format('Integrante alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem integrante)'), v_novo_nome),
          NULL, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_trocar_integrante(text, uuid, bigint) TO authenticated, service_role;

-- Lista de colaboradores para o seletor da alteração em massa (EMPREGADOS tem RLS restrita ao RH). Um json só, para não esbarrar no teto de linhas do PostgREST.
CREATE OR REPLACE FUNCTION public.fluxo_caixa_integrantes_listar()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;
  RETURN (SELECT COALESCE(json_agg(json_build_object('id', e."ID", 'nome', e."Nome") ORDER BY e."Nome"), '[]'::json)
            FROM public."EMPREGADOS" e WHERE e."Situação" = 'Trabalhando' AND e."Nome" IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_integrantes_listar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_integrantes_listar() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
