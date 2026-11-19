-- SIS-2026-0905 (2ª parte, orientação do Iury em 19/11/2026) — Conta Garantida e entradas do Débito Automático sem centro de custo no Fluxo
-- ============================================================================
-- Depois da 20261120210000 (saídas do Malote e do Débito), o Iury pediu o mesmo para a Conta Garantida e para o Débito Automático. Decidido
-- com o João na sessão: movimento FINANCEIRO vai para "MOVIMENTAÇÃO FINANCEIRA - <empresa>" — o mesmo padrão que a Aplicação Financeira já usa
-- desde o SIS-2026-0813 (centroCusto.ts) —, não para o ADMINISTRATIVO; jogar resgate/transferência de milhões no ADMINISTRATIVO distorceria
-- a análise de custo do administrativo.
--
-- 1) CONTA GARANTIDA: não existe coluna de centro de custo — a view v_conta_garantida_fluxo_caixa devolvia contrato NULL fixo (mig
--    20261104004100). Agora ela devolve o contrato MOVIMENTAÇÃO FINANCEIRA da empresa da conta, para TODO movimento (resgate, amortização e
--    juros; passados e futuros). Sem coluna nova: é sempre o mesmo centro, não há escolha a gravar. Como a view é a fonte do Fluxo, do Fluxo
--    Gerencial (financeiro_fluxo_gerencial*) e da leitura compacta, todos passam a ver o centro de custo sem outra mudança.
--    Se um dia a empresa tiver mais de um MOVIMENTAÇÃO FINANCEIRA, vale o ativo (e, empatando, o primeiro por nome) — a mesma ordem do
--    centroPadraoDaEmpresa do front.
--
-- 2) DÉBITO AUTOMÁTICO — ENTRADAS sem centro de custo (correção pontual, por id, levantadas em 19/11/2026):
--      12 "TRANSFERÊNCIA ENTRE CONTAS" (HAGG 5, SN 5, NH 1, AGPS 1) ..... → MOVIMENTAÇÃO FINANCEIRA - <empresa>
--      CASHBACK MENTORE (HAGG) e AÇÃO TRABALHISTA / SINDICATO (SN) .... → ADMINISTRATIVO - <empresa>
--    FICAM SEM CENTRO DE CUSTO de propósito: as 7 "RECEBIMENTO DE NOTA" (HAGG 6, SN 1; duas da EMBRAPA). É receita de contrato: no
--    ADMINISTRATIVO ela inflaria a receita do ADM e tiraria do contrato na lucratividade. O Financeiro aponta o contrato pela tela.
--    Só grava onde o contrato ainda está vazio e o destino é da mesma empresa; deixa evento no histórico do débito.
--
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   -- 1) a view volta a devolver contrato NULL: recriar v_conta_garantida_fluxo_caixa com "NULL::uuid AS contrato_id, NULL::text AS contrato_nome"
--   --    e sem o LEFT JOIN LATERAL mf (o resto da definição é igual a esta).
--   UPDATE public."DEBITO_AUTOMATICO" SET contrato_id = NULL WHERE id IN (
--     '25db7762-797b-4364-813a-30989c43df45','d7569fc9-c16f-4608-a1ad-78564417e90c','45025104-35fb-4a60-98f4-9cb5ffbf76ac',
--     'ebc508a1-50f9-4a17-93cc-1bee3da35a47','7c012491-1115-40c9-b9c5-ff806b940376','ee02d581-53cd-4dda-9f61-8f7ee8a39e5a',
--     '98688796-e4fc-43fc-8fcb-d9734322f0cc','4e9d4f71-8f76-49cd-9e54-38824f72150c','c2b16cac-72bf-42c1-972b-dce2c388b715',
--     'b7fd74e3-23ea-48a1-bef0-e35dbee7e489','b1dfa698-afb8-4dc7-b3d0-02c323ebb0bd','adc0e479-9fc3-423c-a834-057ea9572ec5',
--     'eb7dd1df-5121-40e0-8fac-7d364014cd84','95fea5b0-bb98-4394-8020-ef638a321d5f');
--   DELETE FROM public."DEBITO_AUTOMATICO_EVENTO" WHERE descricao LIKE 'SIS-2026-0905 (entradas):%';
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

-- 1) Conta Garantida → MOVIMENTAÇÃO FINANCEIRA da empresa da conta
CREATE OR REPLACE VIEW public.v_conta_garantida_fluxo_caixa
WITH (security_invoker = true) AS
 SELECT m.id AS despesa_id,
    m.numero AS id_malote,
    m.data_movimento AS data_pagamento,
    (to_char((m.data_movimento)::timestamp with time zone, 'YYYY-MM-01'::text))::date AS competencia,
    cg.empresa_id,
    COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
    mf.id AS contrato_id,
    mf.nome AS contrato_nome,
    m.classificacao_id,
    cl.nome AS classificacao_nome,
    (((((
        CASE m.tipo
            WHEN 'resgate'::text THEN 'Resgate de Conta Garantida'::text
            WHEN 'amortizacao'::text THEN 'Amortização de Conta Garantida'::text
            ELSE 'Juros de Conta Garantida'::text
        END || ' — '::text) || COALESCE(cb.nome, ''::text)) || ' '::text) || cg.conta) || COALESCE((' · '::text || NULLIF(btrim(m.observacao), ''::text)), ''::text)) AS descricao,
    NULL::text AS forma_pagamento,
    cg.banco_id,
    cb.nome AS banco_nome,
    cb.logo_path AS banco_logo_path,
    NULL::integer AS numero_parcela,
    NULL::integer AS numero_parcelas,
    m.valor,
        CASE m.tipo
            WHEN 'resgate'::text THEN 'entrada'::text
            ELSE 'saida'::text
        END AS tipo,
    'conta_garantida'::text AS origem,
    false AS ajustado
   FROM financeiro_conta_garantida_movimento m
     JOIN financeiro_conta_garantida cg ON cg.id = m.conta_garantida_id
     LEFT JOIN empresas e ON e.id = cg.empresa_id
     LEFT JOIN malote_cartao_banco cb ON cb.id = cg.banco_id
     LEFT JOIN planejamento_orcamentario_classificacao cl ON cl.id = m.classificacao_id
     LEFT JOIN LATERAL (
       SELECT c.id, c.nome
         FROM contratos c
        WHERE c.empresa_id = cg.empresa_id
          AND upper(btrim(c.nome)) = 'MOVIMENTAÇÃO FINANCEIRA - ' || upper(btrim(e.codigo))
        ORDER BY (c.status = 'ativo') DESC, c.nome
        LIMIT 1
     ) mf ON true
  WHERE m.cancelado_em IS NULL AND NOT m.historico;

-- 2) Débito Automático — entradas sem centro de custo
CREATE TEMP TABLE _sis0905_entradas (
  id uuid NOT NULL,
  prefixo text NOT NULL   -- 'MOVIMENTAÇÃO FINANCEIRA - ' | 'ADMINISTRATIVO - ' (+ código da empresa do débito)
) ON COMMIT DROP;

INSERT INTO _sis0905_entradas (id, prefixo) VALUES
  ('25db7762-797b-4364-813a-30989c43df45', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- AGPS  transferência entre contas
  ('d7569fc9-c16f-4608-a1ad-78564417e90c', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- HAGG  transferência entre contas
  ('45025104-35fb-4a60-98f4-9cb5ffbf76ac', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- HAGG
  ('ebc508a1-50f9-4a17-93cc-1bee3da35a47', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- HAGG
  ('7c012491-1115-40c9-b9c5-ff806b940376', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- HAGG
  ('ee02d581-53cd-4dda-9f61-8f7ee8a39e5a', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- HAGG
  ('98688796-e4fc-43fc-8fcb-d9734322f0cc', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- NH
  ('4e9d4f71-8f76-49cd-9e54-38824f72150c', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- SN
  ('c2b16cac-72bf-42c1-972b-dce2c388b715', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- SN
  ('b7fd74e3-23ea-48a1-bef0-e35dbee7e489', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- SN
  ('b1dfa698-afb8-4dc7-b3d0-02c323ebb0bd', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- SN
  ('adc0e479-9fc3-423c-a834-057ea9572ec5', 'MOVIMENTAÇÃO FINANCEIRA - '),  -- SN
  ('eb7dd1df-5121-40e0-8fac-7d364014cd84', 'ADMINISTRATIVO - '),           -- HAGG  cashback Mentore
  ('95fea5b0-bb98-4394-8020-ef638a321d5f', 'ADMINISTRATIVO - ');           -- SN    ação trabalhista (sindicato)

DO $$
DECLARE
  v_n integer;
  v_valor numeric;
  v_cg integer;
BEGIN
  WITH alvo AS (
    SELECT da.id, da.valor, c.id AS contrato_id, c.nome AS contrato_nome
      FROM _sis0905_entradas a
      JOIN public."DEBITO_AUTOMATICO" da ON da.id = a.id AND da.deleted_at IS NULL AND da.tipo = 'entrada'
      JOIN public.empresas e ON e.id = da.empresa_id
      JOIN public.contratos c ON c.empresa_id = da.empresa_id AND upper(btrim(c.nome)) = a.prefixo || upper(btrim(e.codigo))
     WHERE da.contrato_id IS NULL
  ), atualiza AS (
    UPDATE public."DEBITO_AUTOMATICO" da SET contrato_id = alvo.contrato_id
      FROM alvo WHERE da.id = alvo.id
    RETURNING da.id, alvo.valor, alvo.contrato_nome
  ), evento AS (
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    SELECT id, 'edicao', auth.uid(),
           format('SIS-2026-0905 (entradas): centro de custo preenchido: "(sem contrato)" → "%s". Correção em lote das entradas que chegavam ao Fluxo de Caixa sem centro de custo.', contrato_nome)
      FROM atualiza
    RETURNING 1
  )
  SELECT count(*), COALESCE(sum(valor), 0) INTO v_n, v_valor FROM atualiza;

  SELECT count(*) INTO v_cg FROM public.v_conta_garantida_fluxo_caixa WHERE contrato_id IS NULL;

  RAISE NOTICE 'SIS-2026-0905: % entrada(s) do Débito Automático com centro de custo preenchido (R$ %). Esperado na 1ª execução: 14. Conta Garantida sem centro de custo depois da view: % (esperado 0).',
    v_n, round(v_valor, 2), v_cg;
END $$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20261120220000', 'sis_2026_0905_conta_garantida_e_debito_entradas_centro_custo')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
