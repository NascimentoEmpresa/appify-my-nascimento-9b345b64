-- SIS-2026-0927 — Fluxo de Caixa: unificar lançamentos de um mesmo pagamento bancário e ratear (Controladoria)
-- ============================================================================
-- Problema: um pagamento bancário (ex.: R$ 21.040,59) foi lançado em duas linhas (FGTS Mensal R$ 14.844,27 + Consignado R$ 6.196,32).
-- A Controladoria precisa juntar as linhas numa só (o Fluxo concilia com o banco por UM valor) SEM perder a composição (classificação,
-- contrato/centro de custo e integrante de cada parte), e poder refazer o rateio depois.
--
-- Modelo (a correção é na ORIGEM: as views do Fluxo; Lucratividade, Fechamento, Auditoria, TVs e Conciliação leem essas views e herdam):
--   FLUXO_UNIFICACAO          cabeçalho: UF-AAAA-NNNN, empresa, data, competência, banco, valor total, ativa (ou desfeita).
--   FLUXO_UNIFICACAO_ORIGEM   os lançamentos ORIGINAIS (Malote ou Débito Automático) com valor e composição de antes. Eles NÃO são apagados nem
--                             editados: só deixam de sair nas views enquanto a unificação estiver ativa. Desfazer devolve todos.
--   FLUXO_UNIFICACAO_COTA     o rateio: uma linha por (classificação, contrato/centro de custo, integrante) — a soma é SEMPRE o valor total.
--   FLUXO_UNIFICACAO_EVENTO   histórico: quem unificou/refez/desfez, quando, valores de antes e de depois.
--
-- As views:
--   v_malote_pagamento_fluxo_caixa      deixa de sair a despesa original (não parcelada) que está numa unificação ativa.
--   v_debito_automatico_fluxo_caixa     idem para o Débito Automático e, no fim (UNION ALL), devolve as linhas UNIFICADAS: uma por cota, com
--                                       origem 'unificado' e o mesmo despesa_id (= id da unificação) — a tela já agrupa e mostra "Rateio".
--   Como todo consumidor já lê as duas views, nenhum relatório precisou mudar e o valor não duplica (original some, unificado entra).
--
-- Regras da unificação (RPC fluxo_caixa_unificar): 2+ lançamentos de SAÍDA pagos, Malote (não parcelado, fora de fatura de cartão) ou Débito
-- Automático, da MESMA empresa, data de pagamento, competência e banco (é um pagamento só). Quem unifica precisa de 'visualizar' no menu fantasma
-- financeiro-fluxo-caixa-unificar (semente: Administrador Geral e Controladoria & Orçamento; a Administração libera/tira por pessoa).
-- Limite conhecido: o contrato é lido só da view; a OSC Canaã (SIS-2026-0922) lê só a view do Malote — despesa do Malote unificada sai de lá.
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_unificar(jsonb);
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_unificacao_ratear(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_unificacao_desfazer(uuid, text);
--   (recriar as duas views como em 20261110000200 e 20261115110000, sem o NOT EXISTS e sem o UNION ALL)
--   DROP TABLE IF EXISTS public."FLUXO_UNIFICACAO_EVENTO", public."FLUXO_UNIFICACAO_COTA", public."FLUXO_UNIFICACAO_ORIGEM", public."FLUXO_UNIFICACAO";
--   DROP SEQUENCE IF EXISTS public.fluxo_unificacao_seq;
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-fluxo-caixa-unificar';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-fluxo-caixa-unificar';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-fluxo-caixa-unificar';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-fluxo-caixa-unificar';
--   DELETE FROM public.financeiro_fluxo_caixa_conta WHERE origem = 'unificado';  (e recriar a CHECK de origem sem 'unificado', como em 20261104004000)
--   NOTIFY pgrst, 'reload schema';
SET lock_timeout = '5s';

-- 1) menu fantasma: quem pode unificar (Controladoria)
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'financeiro-fluxo-caixa-unificar', 'Financeiro — Fluxo de Caixa: Unificar lançamentos', NULL, 37, true
  FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES ('financeiro-fluxo-caixa-unificar', 'visualizar')
ON CONFLICT DO NOTHING;

-- Menu sem nenhuma linha de permissão é lido como aberto para todos (20261020000020): semeia só admin e o perfil da Controladoria.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-fluxo-caixa-unificar', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso pa
  LEFT JOIN public.app_modulo m ON m.nome = pa.nome AND m.codigo = 'controladoria'
 WHERE pa.ativo AND (pa.concede_tudo OR m.id IS NOT NULL)
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) tabelas
CREATE SEQUENCE IF NOT EXISTS public.fluxo_unificacao_seq;

CREATE TABLE IF NOT EXISTS public."FLUXO_UNIFICACAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  data_pagamento date NOT NULL,
  competencia date,
  forma_pagamento text,
  banco_id uuid REFERENCES public.malote_cartao_banco(id),
  descricao text NOT NULL,
  valor_total numeric(14,2) NOT NULL CHECK (valor_total > 0),
  ativa boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  desfeita_by uuid,
  desfeita_at timestamptz,
  motivo_desfeita text
);

-- índices das chaves estrangeiras (guardião de desempenho: JOIN/DELETE nas tabelas referenciadas não varrem a tabela inteira)
CREATE INDEX IF NOT EXISTS fluxo_unificacao_empresa_id_idx ON public."FLUXO_UNIFICACAO" (empresa_id);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_banco_id_idx ON public."FLUXO_UNIFICACAO" (banco_id);

CREATE TABLE IF NOT EXISTS public."FLUXO_UNIFICACAO_ORIGEM" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unificacao_id uuid NOT NULL REFERENCES public."FLUXO_UNIFICACAO"(id) ON DELETE CASCADE,
  origem text NOT NULL CHECK (origem IN ('malote', 'debito_automatico')),
  despesa_id uuid NOT NULL,
  id_malote text,
  descricao text,
  valor numeric(14,2) NOT NULL,
  -- como a linha era antes: [{classificacao, contrato, integrante_empregado_id, valor}]
  detalhe jsonb,
  ativa boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_origem_unif_idx ON public."FLUXO_UNIFICACAO_ORIGEM" (unificacao_id);
-- um lançamento só pode estar em UMA unificação ativa
CREATE UNIQUE INDEX IF NOT EXISTS fluxo_unificacao_origem_ativa_uq ON public."FLUXO_UNIFICACAO_ORIGEM" (origem, despesa_id) WHERE ativa;

CREATE TABLE IF NOT EXISTS public."FLUXO_UNIFICACAO_COTA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unificacao_id uuid NOT NULL REFERENCES public."FLUXO_UNIFICACAO"(id) ON DELETE CASCADE,
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id),
  contrato_id uuid REFERENCES public.contratos(id),   -- nulo = sem contrato (administrativo)
  integrante_empregado_id bigint,
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  ordem integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_cota_unif_idx ON public."FLUXO_UNIFICACAO_COTA" (unificacao_id);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_cota_classificacao_id_idx ON public."FLUXO_UNIFICACAO_COTA" (classificacao_id);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_cota_contrato_id_idx ON public."FLUXO_UNIFICACAO_COTA" (contrato_id);

CREATE TABLE IF NOT EXISTS public."FLUXO_UNIFICACAO_EVENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unificacao_id uuid NOT NULL REFERENCES public."FLUXO_UNIFICACAO"(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('unificada', 'rateio_criado', 'rateio_alterado', 'desfeita')),
  descricao text,
  detalhe jsonb,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fluxo_unificacao_evento_unif_idx ON public."FLUXO_UNIFICACAO_EVENTO" (unificacao_id, created_at DESC);

-- 3) RLS: as views do Fluxo são security_invoker. As 4 tabelas usam a MESMA regra de leitura (quem vê o Débito Automático ou o Fluxo), para
--    nunca acontecer de o original sumir sem a linha unificada aparecer (o total é igual nas duas visões). Escrita só pelas RPCs.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['FLUXO_UNIFICACAO', 'FLUXO_UNIFICACAO_ORIGEM', 'FLUXO_UNIFICACAO_COTA', 'FLUXO_UNIFICACAO_EVENTO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING ((SELECT public.has_screen_access((SELECT auth.uid()), 'financeiro-debito-automatico', 'visualizar'::public.app_acao))
          OR (SELECT public.has_screen_access((SELECT auth.uid()), 'financeiro-fluxo-caixa-gestao', 'visualizar'::public.app_acao)))$p$,
      lower(t) || '_select', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- 3b) a conta do banco (SIS-2026-0777) de cada lançamento do Fluxo: a CHECK de origem passa a aceitar 'unificado'
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.financeiro_fluxo_caixa_conta'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%origem%'
  LOOP
    EXECUTE format('ALTER TABLE public.financeiro_fluxo_caixa_conta DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.financeiro_fluxo_caixa_conta
    ADD CONSTRAINT financeiro_fluxo_caixa_conta_origem_chk
    CHECK (origem IN ('malote', 'debito_automatico', 'cartao_fatura', 'aplicacao_financeira', 'importacao_historica', 'conta_garantida', 'unificado'));
END $$;

-- 4) views
-- 4a) Malote: a despesa original (não parcelada) numa unificação ativa não sai mais (mesma definição de 20261110000200 + o NOT EXISTS).
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
          WHERE ((d.status = 'despesa_paga'::text) AND (NOT d.parcelado) AND (d.deleted_at IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM public."FLUXO_UNIFICACAO_ORIGEM" u WHERE u.ativa AND u.origem = 'malote' AND u.despesa_id = d.id))
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
        CASE
            WHEN (b.integrante_orig IS NULL) THEN NULL::text
            ELSE fluxo_integrante_nome(b.integrante_orig)
        END AS integrante_nome
   FROM (((((base b
     LEFT JOIN financeiro_fluxo_caixa_ajuste aj ON (((aj.origem = b.origem) AND (aj.despesa_id = b.despesa_id) AND (NOT (aj.numero_parcela IS DISTINCT FROM b.numero_parcela)))))
     LEFT JOIN empresas e ON ((e.id = COALESCE(aj.empresa_id, b.empresa_id_orig))))
     LEFT JOIN contratos c ON ((c.id = b.contrato_id)))
     LEFT JOIN planejamento_orcamentario_classificacao cl ON ((cl.id = COALESCE(aj.classificacao_id, b.classificacao_id_orig))))
     LEFT JOIN malote_cartao_banco cb ON ((cb.id = COALESCE(aj.banco_id, b.banco_id_orig))));
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

-- 4b) Débito Automático: o original unificado não sai + as linhas unificadas (uma por cota) entram no fim.
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT d.id AS despesa_id,
    d.numero AS id_malote,
    COALESCE(aj.data_pagamento, d.data_pagamento) AS data_pagamento,
    COALESCE(aj.competencia, d.competencia) AS competencia,
    COALESCE(aj.empresa_id, d.empresa_id) AS empresa_id,
    COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
    CASE WHEN r.id IS NULL THEN d.contrato_id ELSE r.contrato_id END AS contrato_id,
    CASE WHEN r.id IS NOT NULL AND r.contrato_id IS NULL THEN 'Sem contrato (administrativo)' ELSE c.nome END AS contrato_nome,
    CASE WHEN r.id IS NULL THEN COALESCE(aj.classificacao_id, d.classificacao_id)
         ELSE COALESCE(r.classificacao_id, aj.classificacao_id, d.classificacao_id) END AS classificacao_id,
    cl.nome AS classificacao_nome,
    COALESCE(aj.descricao, d.descricao) AS descricao,
    COALESCE(aj.forma_pagamento, d.forma_pagamento) AS forma_pagamento,
    COALESCE(aj.banco_id, d.banco_id) AS banco_id,
    cb.nome AS banco_nome,
    cb.logo_path AS banco_logo_path,
    NULL::integer AS numero_parcela,
    NULL::integer AS numero_parcelas,
    CASE WHEN r.id IS NULL THEN COALESCE(aj.valor, d.valor) ELSE r.valor END AS valor,
    COALESCE(aj.tipo, d.tipo) AS tipo,
    'debito_automatico'::text AS origem,
    aj.id IS NOT NULL AS ajustado,
    d.integrante_empregado_id,
    CASE
      WHEN d.integrante_empregado_id IS NULL THEN NULL::text
      ELSE fluxo_integrante_nome(d.integrante_empregado_id)
    END AS integrante_nome,
    (r.id IS NOT NULL) AS rateio_erp
   FROM "DEBITO_AUTOMATICO" d
     LEFT JOIN "DEBITO_AUTOMATICO_RATEIO" r ON r.debito_id = d.id
     LEFT JOIN financeiro_fluxo_caixa_ajuste aj ON aj.origem = 'debito_automatico'::text AND aj.despesa_id = d.id AND aj.numero_parcela IS NULL
     LEFT JOIN empresas e ON e.id = COALESCE(aj.empresa_id, d.empresa_id)
     LEFT JOIN contratos c ON c.id = CASE WHEN r.id IS NULL THEN d.contrato_id ELSE r.contrato_id END
     LEFT JOIN planejamento_orcamentario_classificacao cl ON cl.id = CASE WHEN r.id IS NULL THEN COALESCE(aj.classificacao_id, d.classificacao_id)
                                                                          ELSE COALESCE(r.classificacao_id, aj.classificacao_id, d.classificacao_id) END
     LEFT JOIN malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, d.banco_id)
  WHERE d.status = 'pago'::text AND d.deleted_at IS NULL AND NOT (COALESCE(aj.tipo, d.tipo) = 'saida'::text AND fn_debito_coberto_por_fatura_importada(COALESCE(aj.forma_pagamento, d.forma_pagamento), COALESCE(aj.competencia, d.competencia), COALESCE(aj.data_pagamento, d.data_pagamento)))
    AND NOT EXISTS (SELECT 1 FROM public."FLUXO_UNIFICACAO_ORIGEM" u WHERE u.ativa AND u.origem = 'debito_automatico' AND u.despesa_id = d.id)
UNION ALL
SELECT u.id AS despesa_id,
    u.numero AS id_malote,
    u.data_pagamento,
    u.competencia,
    u.empresa_id,
    COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
    ct.contrato_id,
    CASE WHEN ct.contrato_id IS NULL THEN 'Sem contrato (administrativo)' ELSE c.nome END AS contrato_nome,
    ct.classificacao_id,
    cl.nome AS classificacao_nome,
    u.descricao,
    u.forma_pagamento,
    u.banco_id,
    cb.nome AS banco_nome,
    cb.logo_path AS banco_logo_path,
    NULL::integer AS numero_parcela,
    NULL::integer AS numero_parcelas,
    ct.valor,
    'saida'::text AS tipo,
    'unificado'::text AS origem,
    false AS ajustado,
    ct.integrante_empregado_id,
    CASE WHEN ct.integrante_empregado_id IS NULL THEN NULL::text ELSE fluxo_integrante_nome(ct.integrante_empregado_id) END AS integrante_nome,
    true AS rateio_erp
   FROM public."FLUXO_UNIFICACAO" u
     JOIN public."FLUXO_UNIFICACAO_COTA" ct ON ct.unificacao_id = u.id
     LEFT JOIN empresas e ON e.id = u.empresa_id
     LEFT JOIN contratos c ON c.id = ct.contrato_id
     LEFT JOIN planejamento_orcamentario_classificacao cl ON cl.id = ct.classificacao_id
     LEFT JOIN malote_cartao_banco cb ON cb.id = u.banco_id
  WHERE u.ativa;

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- 5) RPC: unificar
CREATE OR REPLACE FUNCTION public.fluxo_caixa_unificar(_itens jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n_itens integer;
  v_n_achados integer;
  v_total numeric(14,2);
  v_empresa uuid; v_data date; v_comp date; v_banco uuid; v_forma text;
  v_id uuid;
  v_numero text;
  v_desc text;
  v_dif numeric(14,2);
  v_nome text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-unificar', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para unificar lançamentos do Fluxo de Caixa (função restrita à Controladoria).';
  END IF;
  IF _itens IS NULL OR jsonb_typeof(_itens) <> 'array' THEN RAISE EXCEPTION 'Informe os lançamentos a unificar.'; END IF;

  DROP TABLE IF EXISTS pg_temp._un_itens;
  DROP TABLE IF EXISTS pg_temp._un_linhas;
  CREATE TEMP TABLE _un_itens ON COMMIT DROP AS
    SELECT DISTINCT e->>'origem' AS origem, (e->>'despesa_id')::uuid AS despesa_id FROM jsonb_array_elements(_itens) e;
  SELECT count(*) INTO v_n_itens FROM _un_itens;
  IF v_n_itens < 2 THEN RAISE EXCEPTION 'Selecione ao menos 2 lançamentos para unificar.'; END IF;
  IF EXISTS (SELECT 1 FROM _un_itens WHERE origem NOT IN ('malote', 'debito_automatico')) THEN
    RAISE EXCEPTION 'Só dá para unificar lançamentos do Malote e do Débito Automático.';
  END IF;

  -- as linhas como o Fluxo mostra hoje (já com os ajustes), para guardar a composição de antes
  CREATE TEMP TABLE _un_linhas ON COMMIT DROP AS
    SELECT i.origem, m.despesa_id, m.id_malote, m.data_pagamento, m.competencia, m.empresa_id, m.contrato_id, m.contrato_nome,
           m.classificacao_id, m.classificacao_nome, m.descricao, m.forma_pagamento, m.banco_id, m.numero_parcela, m.valor, m.tipo, m.integrante_empregado_id
      FROM _un_itens i JOIN public.v_malote_pagamento_fluxo_caixa m ON i.origem = 'malote' AND m.despesa_id = i.despesa_id
    UNION ALL
    SELECT i.origem, d.despesa_id, d.id_malote, d.data_pagamento, d.competencia, d.empresa_id, d.contrato_id, d.contrato_nome,
           d.classificacao_id, d.classificacao_nome, d.descricao, d.forma_pagamento, d.banco_id, d.numero_parcela, d.valor, d.tipo, d.integrante_empregado_id
      FROM _un_itens i JOIN public.v_debito_automatico_fluxo_caixa d ON i.origem = 'debito_automatico' AND d.despesa_id = i.despesa_id AND d.origem = 'debito_automatico';

  SELECT count(*) INTO v_n_achados FROM (SELECT DISTINCT origem, despesa_id FROM _un_linhas) x;
  IF v_n_achados <> v_n_itens THEN
    RAISE EXCEPTION 'Algum lançamento não está mais no Fluxo de Caixa (já foi unificado, excluído ou ainda não foi pago). Atualize a tela e selecione de novo.';
  END IF;
  IF EXISTS (SELECT 1 FROM _un_linhas WHERE numero_parcela IS NOT NULL) THEN
    RAISE EXCEPTION 'Lançamento parcelado não pode ser unificado.';
  END IF;
  IF EXISTS (SELECT 1 FROM _un_linhas WHERE tipo <> 'saida') THEN
    RAISE EXCEPTION 'Só saídas podem ser unificadas (um pagamento bancário).';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_malote_pagamento_fluxo_caixa_consolidado c
              JOIN _un_itens i ON i.origem = 'malote' AND i.despesa_id = c.despesa_id_origem WHERE c.fatura_cartao_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Despesa que compõe fatura de cartão não pode ser unificada.';
  END IF;
  IF (SELECT count(DISTINCT empresa_id) FROM _un_linhas) <> 1 THEN RAISE EXCEPTION 'Os lançamentos são de empresas diferentes.'; END IF;
  IF (SELECT count(DISTINCT data_pagamento) FROM _un_linhas) <> 1 THEN
    RAISE EXCEPTION 'Os lançamentos têm datas de pagamento diferentes: um pagamento bancário tem uma data só. Ajuste a data antes de unificar.';
  END IF;
  IF (SELECT count(DISTINCT competencia) FROM _un_linhas) <> 1 THEN
    RAISE EXCEPTION 'Os lançamentos têm competências diferentes. Ajuste a competência antes de unificar.';
  END IF;
  IF (SELECT count(DISTINCT COALESCE(banco_id::text, '')) FROM _un_linhas) <> 1 THEN
    RAISE EXCEPTION 'Os lançamentos têm bancos diferentes: não são o mesmo pagamento bancário.';
  END IF;

  SELECT round(sum(valor), 2), min(empresa_id::text)::uuid, min(data_pagamento), min(competencia), min(banco_id::text)::uuid, min(forma_pagamento)
    INTO v_total, v_empresa, v_data, v_comp, v_banco, v_forma FROM _un_linhas;
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'O total dos lançamentos precisa ser maior que zero.'; END IF;

  v_numero := 'UF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.fluxo_unificacao_seq')::text, 4, '0');
  -- descrição = as descrições dos originais juntas (como no mockup do chamado: "FGTS MENSAL + CONSIGNADO 09.2026 - NH"); os IDs dos originais ficam na composição
  SELECT string_agg(DISTINCT descricao, ' + ') INTO v_desc FROM _un_linhas;
  v_desc := COALESCE(NULLIF(left(v_desc, 300), ''), 'Pagamento unificado');

  INSERT INTO public."FLUXO_UNIFICACAO" (numero, empresa_id, data_pagamento, competencia, forma_pagamento, banco_id, descricao, valor_total, created_by)
  VALUES (v_numero, v_empresa, v_data, v_comp, v_forma, v_banco, v_desc, v_total, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public."FLUXO_UNIFICACAO_ORIGEM" (unificacao_id, origem, despesa_id, id_malote, descricao, valor, detalhe)
  SELECT v_id, l.origem, l.despesa_id, min(l.id_malote), min(l.descricao), round(sum(l.valor), 2),
         jsonb_agg(jsonb_build_object('classificacao', l.classificacao_nome, 'contrato', COALESCE(l.contrato_nome, 'Sem contrato (administrativo)'),
                                      'integrante_empregado_id', l.integrante_empregado_id, 'valor', round(l.valor, 2)))
    FROM _un_linhas l GROUP BY l.origem, l.despesa_id;

  -- a composição de antes vira o primeiro rateio: uma cota por (classificação, contrato, integrante)
  INSERT INTO public."FLUXO_UNIFICACAO_COTA" (unificacao_id, classificacao_id, contrato_id, integrante_empregado_id, valor, ordem)
  SELECT v_id, g.classificacao_id, g.contrato_id, g.integrante_empregado_id, g.valor, row_number() OVER (ORDER BY g.valor DESC, g.classificacao_id NULLS LAST)
    FROM (SELECT classificacao_id, contrato_id, integrante_empregado_id, round(sum(valor), 2) AS valor
            FROM _un_linhas GROUP BY classificacao_id, contrato_id, integrante_empregado_id HAVING round(sum(valor), 2) > 0) g;

  -- centavos de arredondamento vão para a maior cota: a soma fecha SEMPRE com o total
  SELECT v_total - COALESCE(sum(valor), 0) INTO v_dif FROM public."FLUXO_UNIFICACAO_COTA" WHERE unificacao_id = v_id;
  IF v_dif <> 0 THEN
    UPDATE public."FLUXO_UNIFICACAO_COTA" SET valor = valor + v_dif
     WHERE id = (SELECT id FROM public."FLUXO_UNIFICACAO_COTA" WHERE unificacao_id = v_id ORDER BY valor DESC, ordem LIMIT 1);
  END IF;

  -- a linha unificada herda a conta do banco dos originais, se todos tinham a MESMA (senão fica sem conta, para a Controladoria definir)
  INSERT INTO public.financeiro_fluxo_caixa_conta (origem, despesa_id, parcela, conta_banco_id, updated_by)
  SELECT 'unificado', v_id, 0, x.conta, auth.uid()
    FROM (SELECT min(cc.conta_banco_id::text)::uuid AS conta
            FROM _un_itens i
            LEFT JOIN public.financeiro_fluxo_caixa_conta cc ON cc.origem = i.origem AND cc.despesa_id = i.despesa_id AND cc.parcela = 0
          HAVING count(DISTINCT cc.conta_banco_id) = 1 AND count(*) FILTER (WHERE cc.conta_banco_id IS NULL) = 0) x
  ON CONFLICT DO NOTHING;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."FLUXO_UNIFICACAO_EVENTO" (unificacao_id, tipo, descricao, detalhe, usuario_id, usuario_nome)
  VALUES (v_id, 'unificada', 'Unificou ' || v_n_itens || ' lançamentos em ' || v_numero || ' (R$ ' || to_char(v_total, 'FM999G999G990D00') || ')',
          jsonb_build_object('valor_total', v_total,
            'originais', (SELECT jsonb_agg(jsonb_build_object('origem', origem, 'id', id_malote, 'descricao', descricao, 'valor', valor)) FROM public."FLUXO_UNIFICACAO_ORIGEM" WHERE unificacao_id = v_id),
            'rateio', (SELECT jsonb_agg(jsonb_build_object('classificacao', cl.nome, 'contrato', COALESCE(c.nome, 'Sem contrato (administrativo)'), 'valor', ct.valor) ORDER BY ct.ordem)
                         FROM public."FLUXO_UNIFICACAO_COTA" ct
                         LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = ct.classificacao_id
                         LEFT JOIN public.contratos c ON c.id = ct.contrato_id WHERE ct.unificacao_id = v_id)),
          auth.uid(), v_nome);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_unificar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_unificar(jsonb) TO authenticated;

-- 6) RPC: refazer o rateio da linha unificada
CREATE OR REPLACE FUNCTION public.fluxo_caixa_unificacao_ratear(_unificacao_id uuid, _cotas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_u public."FLUXO_UNIFICACAO"%ROWTYPE;
  v_cota jsonb;
  v_valor numeric(14,2);
  v_soma numeric(14,2) := 0;
  v_contrato uuid;
  v_classif uuid;
  v_i integer := 0;
  v_antes jsonb;
  v_nome text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-unificar', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ratear lançamentos unificados (função restrita à Controladoria).';
  END IF;
  IF _cotas IS NULL OR jsonb_typeof(_cotas) <> 'array' OR jsonb_array_length(_cotas) = 0 THEN RAISE EXCEPTION 'Informe as cotas do rateio.'; END IF;
  SELECT * INTO v_u FROM public."FLUXO_UNIFICACAO" WHERE id = _unificacao_id FOR UPDATE;
  IF NOT FOUND OR NOT v_u.ativa THEN RAISE EXCEPTION 'Unificação não encontrada ou já desfeita.'; END IF;

  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_valor := round(COALESCE((v_cota->>'valor')::numeric, 0), 2);
    IF v_valor <= 0 THEN RAISE EXCEPTION 'Toda cota precisa ter valor maior que zero.'; END IF;
    v_classif := NULLIF(v_cota->>'classificacao_id', '')::uuid;
    IF v_classif IS NULL OR NOT EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao WHERE id = v_classif) THEN
      RAISE EXCEPTION 'Toda cota precisa de uma classificação válida.';
    END IF;
    v_contrato := NULLIF(v_cota->>'contrato_id', '')::uuid;
    IF v_contrato IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.contratos WHERE id = v_contrato AND empresa_id = v_u.empresa_id) THEN
      RAISE EXCEPTION 'O contrato da cota não existe ou pertence a outra empresa. Escolha centros de custo da mesma empresa do pagamento.';
    END IF;
    v_soma := v_soma + v_valor;
  END LOOP;
  IF abs(v_soma - v_u.valor_total) > 0.005 THEN
    RAISE EXCEPTION 'A soma do rateio (R$ %) precisa ser igual ao valor do pagamento (R$ %).', v_soma, v_u.valor_total;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('classificacao', cl.nome, 'contrato', COALESCE(c.nome, 'Sem contrato (administrativo)'), 'valor', ct.valor) ORDER BY ct.ordem)
    INTO v_antes
    FROM public."FLUXO_UNIFICACAO_COTA" ct
    LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = ct.classificacao_id
    LEFT JOIN public.contratos c ON c.id = ct.contrato_id WHERE ct.unificacao_id = _unificacao_id;

  DELETE FROM public."FLUXO_UNIFICACAO_COTA" WHERE unificacao_id = _unificacao_id;
  FOR v_cota IN SELECT * FROM jsonb_array_elements(_cotas) LOOP
    v_i := v_i + 1;
    INSERT INTO public."FLUXO_UNIFICACAO_COTA" (unificacao_id, classificacao_id, contrato_id, integrante_empregado_id, valor, ordem)
    VALUES (_unificacao_id, NULLIF(v_cota->>'classificacao_id', '')::uuid, NULLIF(v_cota->>'contrato_id', '')::uuid,
            NULLIF(v_cota->>'integrante_empregado_id', '')::bigint, round((v_cota->>'valor')::numeric, 2), v_i);
  END LOOP;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."FLUXO_UNIFICACAO_EVENTO" (unificacao_id, tipo, descricao, detalhe, usuario_id, usuario_nome)
  VALUES (_unificacao_id, 'rateio_alterado', 'Rateio refeito em ' || v_i || ' cotas',
          jsonb_build_object('valor_total', v_u.valor_total, 'antes', v_antes,
            'depois', (SELECT jsonb_agg(jsonb_build_object('classificacao', cl.nome, 'contrato', COALESCE(c.nome, 'Sem contrato (administrativo)'), 'valor', ct.valor) ORDER BY ct.ordem)
                         FROM public."FLUXO_UNIFICACAO_COTA" ct
                         LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = ct.classificacao_id
                         LEFT JOIN public.contratos c ON c.id = ct.contrato_id WHERE ct.unificacao_id = _unificacao_id)),
          auth.uid(), v_nome);
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_unificacao_ratear(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_unificacao_ratear(uuid, jsonb) TO authenticated;

-- 7) RPC: desfazer (os originais voltam ao Fluxo exatamente como eram)
CREATE OR REPLACE FUNCTION public.fluxo_caixa_unificacao_desfazer(_unificacao_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_u public."FLUXO_UNIFICACAO"%ROWTYPE;
  v_nome text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-unificar', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para desfazer unificação (função restrita à Controladoria).';
  END IF;
  IF length(btrim(COALESCE(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo de desfazer a unificação.'; END IF;
  SELECT * INTO v_u FROM public."FLUXO_UNIFICACAO" WHERE id = _unificacao_id FOR UPDATE;
  IF NOT FOUND OR NOT v_u.ativa THEN RAISE EXCEPTION 'Unificação não encontrada ou já desfeita.'; END IF;

  UPDATE public."FLUXO_UNIFICACAO" SET ativa = false, desfeita_by = auth.uid(), desfeita_at = now(), motivo_desfeita = btrim(_motivo) WHERE id = _unificacao_id;
  UPDATE public."FLUXO_UNIFICACAO_ORIGEM" SET ativa = false WHERE unificacao_id = _unificacao_id;
  DELETE FROM public.financeiro_fluxo_caixa_conta WHERE origem = 'unificado' AND despesa_id = _unificacao_id;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."FLUXO_UNIFICACAO_EVENTO" (unificacao_id, tipo, descricao, detalhe, usuario_id, usuario_nome)
  VALUES (_unificacao_id, 'desfeita', 'Unificação desfeita: os lançamentos originais voltaram ao Fluxo', jsonb_build_object('motivo', btrim(_motivo), 'valor_total', v_u.valor_total),
          auth.uid(), v_nome);
END;
$$;
REVOKE ALL ON FUNCTION public.fluxo_caixa_unificacao_desfazer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_unificacao_desfazer(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
