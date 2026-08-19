-- =========================================================================
-- JURÍDICO / PATRIMÔNIO — a carteira, do jeito que a planilha registra
--
-- O cadastro de patrimônio guardava só a identificação (tipo, endereço,
-- proprietário). A gestão de verdade — a que está na planilha ATIVO
-- IMOBILIZADO — é sobre DINHEIRO: quanto foi o contrato, quanto entrou de
-- entrada, quantas parcelas já foram, quanto ainda falta e qual é a próxima.
-- Sem esses campos a tela mostra imóvel; o que o Jurídico precisa ver é a
-- posição de cada financiamento.
--
-- DECISÕES
--   • `localizacao` continua sendo o endereço (a tela passa a rotular
--     "Endereço"). Criar uma coluna nova só pelo rótulo deixaria duas colunas
--     dizendo a mesma coisa, e a antiga com dado.
--   • `status` (Ativo/Inativo) é o cadastro; `situacao_pagamento` (PAGO,
--     PAGANDO, VENCIDO, AGUARDANDO) é a posição financeira. São perguntas
--     diferentes e a tela mostra as duas.
--   • As parcelas ganham tabela própria em vez de virarem obrigações: uma
--     obrigação é uma conta do mês (luz, IPTU); parcela de financiamento é
--     outro bicho — tem saldo devedor, seguro, taxa e correção, e vem às
--     centenas (a CASA CADU sozinha tem 420).
--   • Os campos que variam de contrato para contrato (seguro, taxa adm,
--     encargo, INCC, juro, valor corrigido) ficam em `detalhes` jsonb. Cada
--     aba da planilha tem um conjunto diferente; virar coluna faria uma
--     tabela com 12 colunas quase sempre nulas.
--
-- Idempotente.
-- ROLLBACK: ver o fim do arquivo.
-- =========================================================================

-- ── 1. A posição financeira do patrimônio ────────────────────────────
ALTER TABLE public."JUR_PATRIMONIOS"
  ADD COLUMN IF NOT EXISTS classificacao       TEXT,      -- CASA, PRÉDIO, TERRENO, SALA…
  ADD COLUMN IF NOT EXISTS situacao_pagamento  TEXT,      -- PAGO, PAGANDO, VENCIDO, AGUARDANDO
  ADD COLUMN IF NOT EXISTS matricula           TEXT,
  ADD COLUMN IF NOT EXISTS possui_escritura    BOOLEAN,
  ADD COLUMN IF NOT EXISTS especie_escritura   TEXT,      -- ESCRITURA, INSTRUMENTO PART.…
  ADD COLUMN IF NOT EXISTS valor_contrato      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_entrada       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_falta         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_total         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_estimado      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS comissao            NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reforcos_pagos      NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS reforcos_a_pagar    NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS valor_parcela       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS qtd_parcelas        INTEGER,
  ADD COLUMN IF NOT EXISTS parcelas_pagas      INTEGER,
  ADD COLUMN IF NOT EXISTS parcelas_falta      INTEGER,
  ADD COLUMN IF NOT EXISTS proxima_parcela     DATE,
  ADD COLUMN IF NOT EXISTS anotacoes           TEXT,
  ADD COLUMN IF NOT EXISTS aba_origem          TEXT;      -- de qual aba da planilha veio

COMMENT ON COLUMN public."JUR_PATRIMONIOS".localizacao IS
  'Endereço do patrimônio. É o campo "Endereço" da tela — o nome antigo ficou.';
COMMENT ON COLUMN public."JUR_PATRIMONIOS".situacao_pagamento IS
  'Posição financeira (PAGO/PAGANDO/VENCIDO/AGUARDANDO). Não confundir com status, que é o cadastro.';

CREATE INDEX IF NOT EXISTS jur_pat_situacao_idx  ON public."JUR_PATRIMONIOS"(situacao_pagamento);
CREATE INDEX IF NOT EXISTS jur_pat_classif_idx   ON public."JUR_PATRIMONIOS"(classificacao);
CREATE INDEX IF NOT EXISTS jur_pat_cidade_idx    ON public."JUR_PATRIMONIOS"(cidade);

-- ── 2. Entrada na obrigação ──────────────────────────────────────────
-- Só faz sentido em Financiamento e Consórcio; a tela libera o campo apenas
-- nessas duas categorias, e nas outras ele nem aparece.
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS valor_entrada NUMERIC(14,2);

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".valor_entrada IS
  'Entrada do financiamento/consórcio. Nulo nas demais categorias.';

-- ── 3. As parcelas do financiamento ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public."JUR_PATRIMONIO_PARCELAS" (
  id             BIGSERIAL PRIMARY KEY,
  patrimonio_id  BIGINT NOT NULL REFERENCES public."JUR_PATRIMONIOS"(id) ON DELETE CASCADE,
  ordem          INTEGER,                 -- posição na planilha, para manter a leitura
  numero         INTEGER,                 -- nº da parcela, quando é numerada
  rotulo         TEXT,                    -- "A) REFORÇO", "Ato", "Parcela Avulsa"…
  vencimento     DATE,
  valor          NUMERIC(14,2),           -- prestação / valor a ser pago
  valor_pago     NUMERIC(14,2),
  situacao       TEXT,                    -- PAGA, EM ABERTO…
  detalhes       JSONB DEFAULT '{}'::jsonb,  -- seguro, tx adm, encargo, juro, INCC, saldo devedor…
  origem         TEXT,                    -- aba da planilha
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jur_pat_parc_pat_idx  ON public."JUR_PATRIMONIO_PARCELAS"(patrimonio_id);
CREATE INDEX IF NOT EXISTS jur_pat_parc_venc_idx ON public."JUR_PATRIMONIO_PARCELAS"(vencimento);

ALTER TABLE public."JUR_PATRIMONIO_PARCELAS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."JUR_PATRIMONIO_PARCELAS" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."JUR_PATRIMONIO_PARCELAS_id_seq" TO authenticated;

-- Mesma régua das irmãs (JUR_PATRIMONIO_OBRIGACOES/ITENS): quem tem a tela, tem
-- a parcela. Os DOIS códigos de menu apontam para /app/juridico/patrimonios e
-- ambos estão em uso, então a policy aceita os dois — cobrar só um deixaria de
-- fora quem recebeu o acesso pelo outro.
DROP POLICY IF EXISTS jur_pat_parcelas_gate ON public."JUR_PATRIMONIO_PARCELAS";
CREATE POLICY jur_pat_parcelas_gate ON public."JUR_PATRIMONIO_PARCELAS"
  FOR ALL TO authenticated
  USING (
    public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'visualizar'::app_acao)
  )
  WITH CHECK (
    public.has_screen_access(auth.uid(), 'patrimonios', 'incluir'::app_acao)
    OR public.has_screen_access(auth.uid(), 'patrimonios', 'alterar'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'incluir'::app_acao)
    OR public.has_screen_access(auth.uid(), 'juridico_patrimonios', 'alterar'::app_acao)
  );

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS colunas_novas
  FROM information_schema.columns
 WHERE table_name = 'JUR_PATRIMONIOS'
   AND column_name IN ('classificacao','situacao_pagamento','matricula','possui_escritura',
                       'especie_escritura','valor_contrato','valor_entrada','valor_falta',
                       'valor_total','valor_estimado','comissao','reforcos_pagos',
                       'reforcos_a_pagar','valor_parcela','qtd_parcelas','parcelas_pagas',
                       'parcelas_falta','proxima_parcela','anotacoes','aba_origem');

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TABLE public."JUR_PATRIMONIO_PARCELAS";
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" DROP COLUMN valor_entrada;
--   ALTER TABLE public."JUR_PATRIMONIOS"
--     DROP COLUMN classificacao, DROP COLUMN situacao_pagamento, DROP COLUMN matricula,
--     DROP COLUMN possui_escritura, DROP COLUMN especie_escritura, DROP COLUMN valor_contrato,
--     DROP COLUMN valor_entrada, DROP COLUMN valor_falta, DROP COLUMN valor_total,
--     DROP COLUMN valor_estimado, DROP COLUMN comissao, DROP COLUMN reforcos_pagos,
--     DROP COLUMN reforcos_a_pagar, DROP COLUMN valor_parcela, DROP COLUMN qtd_parcelas,
--     DROP COLUMN parcelas_pagas, DROP COLUMN parcelas_falta, DROP COLUMN proxima_parcela,
--     DROP COLUMN anotacoes, DROP COLUMN aba_origem;
-- =========================================================================
