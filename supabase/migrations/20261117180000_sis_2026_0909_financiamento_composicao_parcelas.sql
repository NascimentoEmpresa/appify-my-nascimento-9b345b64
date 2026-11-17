-- =========================================================================
-- SIS-2026-0909 — Adequação da tela de financiamentos de imóveis
-- (Jurídico › Patrimônios › aba "Parcelas")
--
-- PEDIDO (Fernanda Maldaner, Diretoria Administrativa, 13/11/2026): a aba
-- mostrava só parcela, vencimento, valor e situação. Financeiro, Contabilidade
-- e Presidência precisam ver a COMPOSIÇÃO de cada pagamento (amortização,
-- juros, seguros MIP/DFI, taxas, FCVS/FGTS, impontualidade, diferença), quanto
-- foi para o principal, a correção monetária (INCC/TR) e como o saldo devedor
-- evolui — com um resumo no topo. Exemplo visual: CASA DO SENILTON
-- (demonstrativo CAIXA, SAC/TR, 420 meses), mas a estrutura vale para qualquer
-- imóvel com financiamento ou obrigação parcelada.
--
-- O QUE MUDA NO BANCO
--   1) "JUR_PATRIMONIO_FINANCIAMENTOS": as condições do contrato (credor,
--      sistema, indexador, prazo, taxas a.a., CET, data de referência), o
--      bloco FGTS/FGHAB, pagador/conta e a REGRA do INCC (aplicação,
--      modalidade, base, periodicidade/defasagem, vigência). Um imóvel pode ter
--      mais de um (ex.: GAV COTA 22 e 25 no mesmo patrimônio).
--   2) "JUR_PATRIMONIO_PARCELAS" ganha as colunas da composição. Todas
--      NULLABLE de propósito: NULL é "não informado", 0 é "zero" — o chamado
--      pede para distinguir os dois e NUNCA preencher com zero sozinho.
--      `valor` continua sendo o VALOR DEVIDO (prestação) e `valor_pago` o pago
--      quando não há pagamentos detalhados.
--   3) "JUR_PATRIMONIO_PARCELA_PAGAMENTOS": mais de um pagamento por parcela
--      (data + valor + comprovante) — pagamento parcial vira situação PARCIAL.
--   4) "JUR_PATRIMONIO_INCC_APLICACOES": o histórico das aplicações do índice
--      por competência (fonte, taxa, fator, base, valor anterior/posterior,
--      correção). A correção acumulada é a soma, calculada na tela.
--
-- ACESSO: a mesma régua das irmãs (ver 20260909000008_patrimonio_carteira):
-- quem tem a tela (menu 'patrimonios' OU 'juridico_patrimonios'), tem os
-- dados; gravar exige incluir/alterar. Nenhum menu novo — é a mesma tela.
--
-- Histórico de alterações (responsável e data): a tela grava em
-- JUR_PATRIMONIO_ITENS (kind = 'historico'), como já faz com contas; e as
-- tabelas novas carimbam atualizado_por/updated_at.
-- =========================================================================

-- ── 1. Condições do financiamento ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_FINANCIAMENTOS" (
  id                           BIGSERIAL PRIMARY KEY,
  patrimonio_id                BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  nome                         TEXT,                    -- "Contrato CAIXA 8.4444.0000000-0"
  credor                       TEXT,
  sistema_amortizacao          TEXT,                    -- SAC, PRICE, SACRE, Direto com a construtora…
  indexador                    TEXT,                    -- TR, INCC, IPCA, IGP-M, Sem indexador…
  prazo_meses                  INTEGER CHECK (prazo_meses IS NULL OR prazo_meses > 0),
  taxa_juros_nominal_aa        NUMERIC(9,4),            -- % ao ano
  taxa_juros_efetiva_aa        NUMERIC(9,4),            -- % ao ano
  cet_aa                       NUMERIC(9,4),            -- % ao ano
  data_referencia              DATE,                    -- data das informações do contrato
  -- Saldo informado pelo credor fora das parcelas (ex.: extrato). A tela usa
  -- o saldo da última parcela do período e cai para este quando não houver.
  saldo_devedor_informado      NUMERIC(14,2),
  saldo_devedor_data           DATE,
  -- FGTS e FGHAB — dados do contrato
  cotas_fgts_contratadas       INTEGER,
  parcelas_fgts_remanescentes  INTEGER,
  fgts_nao_utilizado           NUMERIC(14,2),
  percentual_fgts_utilizado    NUMERIC(7,4),
  saldo_perda_renda_fghab      NUMERIC(14,2),
  produto_fonte_recursos       TEXT,                    -- "901 — SFH / 15 — SBPE"
  -- Pagador e documentos
  pagador                      TEXT,
  conta_bancaria               TEXT,
  documento_origem             TEXT,                    -- "Demonstrativo CAIXA"
  documento_data               DATE,
  -- Regra do INCC (correção monetária) — vinculada a ESTE contrato
  incc_aplicacao               TEXT NOT NULL DEFAULT 'a_confirmar'
                               CHECK (incc_aplicacao IN ('aplicavel','nao_previsto','a_confirmar')),
  incc_modalidade              TEXT CHECK (incc_modalidade IS NULL OR incc_modalidade IN ('INCC-M','INCC-DI','INCC-10')),
  incc_fase                    TEXT,                    -- fase da operação: obra, pós-chaves…
  incc_base_tipo               TEXT CHECK (incc_base_tipo IS NULL OR incc_base_tipo IN ('saldo','parcela','outra')),
  incc_base_descricao          TEXT,
  incc_periodicidade           TEXT,                    -- Mensal, Anual…
  incc_defasagem_meses         INTEGER,                 -- índice de N meses antes
  incc_vigencia_inicio         DATE,
  incc_vigencia_fim            DATE,
  observacoes                  TEXT,
  criado_por                   TEXT,
  atualizado_por               TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jur_pat_fin_pat_idx ON public."JUR_PATRIMONIO_FINANCIAMENTOS"(patrimonio_id);

DROP TRIGGER IF EXISTS trg_jur_pat_fin_updated_at ON public."JUR_PATRIMONIO_FINANCIAMENTOS";
CREATE TRIGGER trg_jur_pat_fin_updated_at BEFORE UPDATE ON public."JUR_PATRIMONIO_FINANCIAMENTOS"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Composição da parcela ────────────────────────────────────────────
ALTER TABLE public."JUR_PATRIMONIO_PARCELAS"
  ADD COLUMN IF NOT EXISTS financiamento_id      BIGINT REFERENCES public."JUR_PATRIMONIO_FINANCIAMENTOS"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS data_pagamento        DATE,
  ADD COLUMN IF NOT EXISTS amortizacao           NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS juros                 NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS seguro_mip            NUMERIC(14,2),   -- MIP/MPI: morte e invalidez
  ADD COLUMN IF NOT EXISTS seguro_dfi            NUMERIC(14,2),   -- DFI: danos físicos ao imóvel
  ADD COLUMN IF NOT EXISTS seguros_fghab         NUMERIC(14,2),   -- "Seguros / FGHAB" do documento
  -- true = "Seguros / FGHAB" é o SUBTOTAL de MIP+DFI (não somar de novo).
  ADD COLUMN IF NOT EXISTS seguros_fghab_subtotal BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS taxas                 NUMERIC(14,2),   -- taxa de administração e afins
  ADD COLUMN IF NOT EXISTS valor_fcvs            NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS fgts_utilizado        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS encargo_liquido       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_impontualidade  NUMERIC(14,2),
  -- Só quando o documento discrimina; senão fica tudo em valor_impontualidade.
  ADD COLUMN IF NOT EXISTS multa_atraso          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS juros_atraso          NUMERIC(14,2),
  -- Com sinal, sujeita à conciliação.
  ADD COLUMN IF NOT EXISTS diferenca_valor       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS atualizacao_monetaria NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS outros_movimentos     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS saldo_anterior        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS saldo_devedor         NUMERIC(14,2),   -- saldo APÓS a parcela
  ADD COLUMN IF NOT EXISTS indice_correcao       NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS indice_tipo           TEXT,
  -- true = seguros e taxas já estão dentro do valor devido (padrão CAIXA).
  ADD COLUMN IF NOT EXISTS encargos_inclusos     BOOLEAN NOT NULL DEFAULT true,
  -- Valores projetados (simulação/planilha) x confirmados (demonstrativo).
  ADD COLUMN IF NOT EXISTS projetado             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lancamento_financeiro TEXT,
  ADD COLUMN IF NOT EXISTS documento_origem      TEXT,
  ADD COLUMN IF NOT EXISTS documento_data        DATE,
  ADD COLUMN IF NOT EXISTS demonstrativo_path    TEXT,
  ADD COLUMN IF NOT EXISTS demonstrativo_nome    TEXT,
  ADD COLUMN IF NOT EXISTS atualizado_por        TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ;

ALTER TABLE public."JUR_PATRIMONIO_PARCELAS" DROP CONSTRAINT IF EXISTS jur_pat_parc_indice_tipo_chk;
ALTER TABLE public."JUR_PATRIMONIO_PARCELAS" ADD CONSTRAINT jur_pat_parc_indice_tipo_chk
  CHECK (indice_tipo IS NULL OR indice_tipo IN ('percentual','fator'));

CREATE INDEX IF NOT EXISTS jur_pat_parc_fin_idx ON public."JUR_PATRIMONIO_PARCELAS"(financiamento_id);

DROP TRIGGER IF EXISTS trg_jur_pat_parc_updated_at ON public."JUR_PATRIMONIO_PARCELAS";
CREATE TRIGGER trg_jur_pat_parc_updated_at BEFORE UPDATE ON public."JUR_PATRIMONIO_PARCELAS"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Pagamentos da parcela (mais de um por parcela) ───────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_PARCELA_PAGAMENTOS" (
  id                BIGSERIAL PRIMARY KEY,
  -- SEM cascata (revisão de 16/11): o importador antigo da planilha faz
  -- DELETE de todas as parcelas do imóvel; com CASCADE isso levava junto os
  -- pagamentos registrados. NO ACTION (e não RESTRICT) para que excluir o
  -- PATRIMÔNIO continue funcionando: a cascata dele apaga pagamentos e
  -- parcelas no mesmo comando e a checagem só roda no fim.
  parcela_id        BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIO_PARCELAS"(id) ON DELETE NO ACTION,
  patrimonio_id     BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  data_pagamento    DATE NOT NULL,
  valor             NUMERIC(14,2) NOT NULL,
  observacao        TEXT,
  comprovante_path  TEXT,
  comprovante_nome  TEXT,
  criado_por        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jur_pat_parc_pag_parc_idx ON public."JUR_PATRIMONIO_PARCELA_PAGAMENTOS"(parcela_id);
CREATE INDEX IF NOT EXISTS jur_pat_parc_pag_pat_idx  ON public."JUR_PATRIMONIO_PARCELA_PAGAMENTOS"(patrimonio_id);

-- ── 4. Histórico das aplicações do INCC ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_INCC_APLICACOES" (
  id                   BIGSERIAL PRIMARY KEY,
  financiamento_id     BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIO_FINANCIAMENTOS"(id) ON DELETE CASCADE,
  patrimonio_id        BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  competencia          DATE NOT NULL,                  -- 1º dia do mês do índice
  modalidade           TEXT CHECK (modalidade IS NULL OR modalidade IN ('INCC-M','INCC-DI','INCC-10')),
  fonte                TEXT,                           -- FGV/IBRE, construtora…
  taxa_indice_pct      NUMERIC(10,6),                  -- variação do índice no mês, em %
  percentual_aplicado  NUMERIC(10,6),                  -- % efetivamente aplicado
  fator_aplicado       NUMERIC(14,8),                  -- ou o fator (1,0058…)
  base_tipo            TEXT CHECK (base_tipo IS NULL OR base_tipo IN ('saldo','parcela','outra')),
  base_calculo         NUMERIC(14,2),
  valor_anterior       NUMERIC(14,2),
  valor_corrigido      NUMERIC(14,2),
  correcao             NUMERIC(14,2),
  observacao           TEXT,
  criado_por           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jur_pat_incc_fin_idx ON public."JUR_PATRIMONIO_INCC_APLICACOES"(financiamento_id, competencia);
CREATE INDEX IF NOT EXISTS jur_pat_incc_pat_idx ON public."JUR_PATRIMONIO_INCC_APLICACOES"(patrimonio_id);

-- ── 5. Grants + RLS (mesma régua de JUR_PATRIMONIO_PARCELAS) ────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['JUR_PATRIMONIO_FINANCIAMENTOS','JUR_PATRIMONIO_PARCELA_PAGAMENTOS','JUR_PATRIMONIO_INCC_APLICACOES'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated', t || '_id_seq');
  END LOOP;
END $$;

-- Uma policy por comando (revisão de 16/11). A primeira versão era
-- FOR ALL USING (visualizar): como o USING também vale para UPDATE e DELETE,
-- quem só VISUALIZA a tela conseguia apagar pagamentos e aplicações do INCC.
-- Agora: ver = visualizar; incluir = incluir; alterar = alterar; apagar =
-- excluir (a tela tem a ação, ver SISTEMA_COMENTARIOS 20261016000004).
-- JUR_PATRIMONIO_PARCELAS entra na mesma régua: a aba passou a gravar nela e
-- a policy antiga (jur_pat_parcelas_gate, FOR ALL) tinha o mesmo furo.
-- Os dois códigos de menu valem (os dois apontam para a tela, ver 20260909000008).
-- has_screen_access dentro de (SELECT ...) = calculado uma vez por consulta.
DO $$
DECLARE
  t TEXT;
  pre TEXT;
  ok TEXT := '((SELECT public.has_screen_access(auth.uid(), %L, %L::app_acao)) OR (SELECT public.has_screen_access(auth.uid(), %L, %L::app_acao)))';
  f TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['JUR_PATRIMONIO_FINANCIAMENTOS','JUR_PATRIMONIO_PARCELA_PAGAMENTOS','JUR_PATRIMONIO_INCC_APLICACOES','JUR_PATRIMONIO_PARCELAS'] LOOP
    pre := CASE t
      WHEN 'JUR_PATRIMONIO_FINANCIAMENTOS' THEN 'jur_pat_financiamentos'
      WHEN 'JUR_PATRIMONIO_PARCELA_PAGAMENTOS' THEN 'jur_pat_parcela_pagamentos'
      WHEN 'JUR_PATRIMONIO_INCC_APLICACOES' THEN 'jur_pat_incc_aplicacoes'
      ELSE 'jur_pat_parcelas' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pre || '_gate', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pre || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pre || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pre || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pre || '_delete', t);
    f := format(ok, 'patrimonios', 'visualizar', 'juridico_patrimonios', 'visualizar');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING %s', pre || '_select', t, f);
    f := format(ok, 'patrimonios', 'incluir', 'juridico_patrimonios', 'incluir');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK %s', pre || '_insert', t, f);
    f := format(ok, 'patrimonios', 'alterar', 'juridico_patrimonios', 'alterar');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING %s WITH CHECK %s', pre || '_update', t, f, f);
    f := format(ok, 'patrimonios', 'excluir', 'juridico_patrimonios', 'excluir');
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING %s', pre || '_delete', t, f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   (policies: DROP das 16 jur_pat_*_select/_insert/_update/_delete e recriar
--    jur_pat_parcelas_gate como em 20260909000008)
--   DROP TABLE IF EXISTS public."JUR_PATRIMONIO_INCC_APLICACOES";
--   DROP TABLE IF EXISTS public."JUR_PATRIMONIO_PARCELA_PAGAMENTOS";
--   DROP TRIGGER IF EXISTS trg_jur_pat_parc_updated_at ON public."JUR_PATRIMONIO_PARCELAS";
--   ALTER TABLE public."JUR_PATRIMONIO_PARCELAS" DROP CONSTRAINT IF EXISTS jur_pat_parc_indice_tipo_chk;
--   ALTER TABLE public."JUR_PATRIMONIO_PARCELAS"
--     DROP COLUMN financiamento_id, DROP COLUMN data_pagamento, DROP COLUMN amortizacao,
--     DROP COLUMN juros, DROP COLUMN seguro_mip, DROP COLUMN seguro_dfi, DROP COLUMN seguros_fghab,
--     DROP COLUMN seguros_fghab_subtotal, DROP COLUMN taxas, DROP COLUMN valor_fcvs,
--     DROP COLUMN fgts_utilizado, DROP COLUMN encargo_liquido, DROP COLUMN valor_impontualidade,
--     DROP COLUMN multa_atraso, DROP COLUMN juros_atraso, DROP COLUMN diferenca_valor,
--     DROP COLUMN atualizacao_monetaria, DROP COLUMN outros_movimentos, DROP COLUMN saldo_anterior,
--     DROP COLUMN saldo_devedor, DROP COLUMN indice_correcao, DROP COLUMN indice_tipo,
--     DROP COLUMN encargos_inclusos, DROP COLUMN projetado, DROP COLUMN lancamento_financeiro,
--     DROP COLUMN documento_origem, DROP COLUMN documento_data, DROP COLUMN demonstrativo_path,
--     DROP COLUMN demonstrativo_nome, DROP COLUMN atualizado_por, DROP COLUMN updated_at;
--   DROP TABLE IF EXISTS public."JUR_PATRIMONIO_FINANCIAMENTOS";
-- =========================================================================
