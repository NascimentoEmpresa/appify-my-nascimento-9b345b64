-- SIS-2026-0489 (Iury): edição de linha no Fluxo de Caixa (Data de
-- Pagamento, Tipo, Classificação, Descrição, Competência, Empresa, Banco,
-- Forma de Pagamento) sem alterar o lançamento original (Pagamento
-- Malote/Débito Automático/Fatura de Cartão) nem os relatórios que leem
-- essas tabelas direto.
--
-- A tela "Gestão" do Fluxo de Caixa não tem tabela própria — só concatena
-- 3 views somente leitura (v_malote_pagamento_fluxo_caixa,
-- v_debito_automatico_fluxo_caixa, v_cartao_fatura_fluxo_caixa, definidas
-- por último em 20260930000163_fluxo_caixa_lixeira.sql). Em vez de escrever
-- na tabela de origem (o que hoje já acontece pros 3 campos editáveis
-- atuais — Forma de Pagamento/Banco/Data — e propaga pra Malote/Cartão),
-- esta migration cria uma tabela de AJUSTE: 1 linha por lançamento com os
-- valores que sobrescrevem a origem só na visão do Fluxo de Caixa. As 3
-- views passam a fazer LEFT JOIN nela e usar COALESCE(ajuste, original)
-- em cada campo editável — a tabela de origem nunca é tocada.
--
-- "Contrato" não entra aqui (pedido do Iury foi RETIRAR a coluna, não
-- editar) — contrato_id/contrato_nome continuam exatamente como estão nas
-- views (CartaoCredito.tsx também lê contrato_nome da mesma
-- v_malote_pagamento_fluxo_caixa — não pode sumir da view, só da tela de
-- Fluxo de Caixa).
--
-- Permissão: ação própria do Fluxo de Caixa (menu_codigo já existente
-- `financeiro-fluxo-caixa-gestao`, criado em 20260907000002) — "alterar"
-- já é uma das 5 ações que o toggle de Acesso por Usuário concede de
-- graça (ACOES_DO_TOGGLE_PADRAO), então quem já tem a tela liberada já
-- ganha a permissão de ajustar, sem seed adicional em
-- perfil_acesso_permissao.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.financeiro_fluxo_caixa_ajuste CASCADE;
--   (recriar as 3 views com o corpo de 20260930000163_fluxo_caixa_lixeira.sql)
--   NOTIFY pgrst, 'reload schema';

-- ── 1. Tabela de ajuste ──────────────────────────────────────────────
CREATE TABLE public.financeiro_fluxo_caixa_ajuste (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem          text NOT NULL CHECK (origem IN ('malote', 'debito_automatico', 'cartao_fatura')),
  -- id da linha na tabela de origem (malote_despesa / "DEBITO_AUTOMATICO" /
  -- malote_cartao_fatura_item) — não é FK única, cada origem aponta pra
  -- uma tabela diferente (mesma limitação que despesa_id já tem hoje nas
  -- 3 views, ver useFluxoCaixaMalote.ts).
  despesa_id      uuid NOT NULL,
  -- null quando o lançamento não é parcelado (malote não-parcelado,
  -- débito automático); número da parcela paga (malote) ou da parcela do
  -- cartão (fatura) quando for.
  numero_parcela  int,

  -- Campos de override — null = "usa o valor original da view".
  data_pagamento  date,
  tipo            text CHECK (tipo IN ('entrada', 'saida')),
  classificacao_id uuid REFERENCES public.planejamento_orcamentario_classificacao(id),
  descricao       text,
  competencia     date,
  empresa_id      uuid REFERENCES public.empresas(id),
  banco_id        uuid REFERENCES public.malote_cartao_banco(id),
  forma_pagamento text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- Dois índices únicos parciais em vez de 1 UNIQUE simples: numero_parcela
-- nulo é o caso comum (malote não-parcelado, débito automático), e NULL
-- nunca conflita com NULL num UNIQUE normal do Postgres — deixaria
-- inserir várias linhas de ajuste pro mesmo lançamento sem parcela.
CREATE UNIQUE INDEX financeiro_fluxo_caixa_ajuste_uniq_com_parcela
  ON public.financeiro_fluxo_caixa_ajuste (origem, despesa_id, numero_parcela)
  WHERE numero_parcela IS NOT NULL;
CREATE UNIQUE INDEX financeiro_fluxo_caixa_ajuste_uniq_sem_parcela
  ON public.financeiro_fluxo_caixa_ajuste (origem, despesa_id)
  WHERE numero_parcela IS NULL;

CREATE TRIGGER financeiro_fluxo_caixa_ajuste_set_updated
  BEFORE UPDATE ON public.financeiro_fluxo_caixa_ajuste
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.financeiro_fluxo_caixa_ajuste ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_select ON public.financeiro_fluxo_caixa_ajuste;
CREATE POLICY financeiro_fluxo_caixa_ajuste_select ON public.financeiro_fluxo_caixa_ajuste
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'));

DROP POLICY IF EXISTS financeiro_fluxo_caixa_ajuste_write ON public.financeiro_fluxo_caixa_ajuste;
CREATE POLICY financeiro_fluxo_caixa_ajuste_write ON public.financeiro_fluxo_caixa_ajuste
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar'));

-- ── 2. v_malote_pagamento_fluxo_caixa — com ajuste ───────────────────
CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa AS
WITH base AS (
  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    d.data_pagamento AS data_pagamento_orig,
    d.competencia AS competencia_orig,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    d.classificacao_id AS classificacao_id_orig,
    d.nome AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    d.banco_id AS banco_id_orig,
    NULL::int AS numero_parcela,
    NULL::int AS numero_parcelas,
    COALESCE(rl.valor, d.valor_aprovado) AS valor,
    'saida'::text AS tipo_orig,
    'malote'::text AS origem
  FROM public.malote_despesa d
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.status = 'despesa_paga' AND NOT d.parcelado AND d.deleted_at IS NULL

  UNION ALL

  SELECT
    d.id AS despesa_id,
    d.numero AS id_malote,
    p.data_pagamento_real AS data_pagamento_orig,
    d.competencia AS competencia_orig,
    COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id_orig,
    COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
    d.classificacao_id AS classificacao_id_orig,
    d.nome AS descricao_orig,
    d.forma_pagamento AS forma_pagamento_orig,
    p.banco_id AS banco_id_orig,
    p.numero_parcela,
    d.numero_parcelas,
    p.valor * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1) AS valor,
    'saida'::text AS tipo_orig,
    'malote'::text AS origem
  FROM public.malote_despesa d
  JOIN public.malote_despesa_parcela p ON p.despesa_id = d.id AND p.status = 'paga'
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  WHERE d.parcelado AND d.deleted_at IS NULL
)
SELECT
  b.despesa_id,
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
  b.valor,
  COALESCE(aj.tipo, b.tipo_orig) AS tipo,
  b.origem,
  (aj.id IS NOT NULL) AS ajustado
FROM base b
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = b.origem AND aj.despesa_id = b.despesa_id
 AND aj.numero_parcela IS NOT DISTINCT FROM b.numero_parcela
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, b.empresa_id_orig)
LEFT JOIN public.contratos c ON c.id = b.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, b.classificacao_id_orig)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, b.banco_id_orig);

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

-- ── 3. v_debito_automatico_fluxo_caixa — com ajuste ──────────────────
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  COALESCE(aj.data_pagamento, d.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, d.competencia) AS competencia,
  COALESCE(aj.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  COALESCE(aj.classificacao_id, d.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, d.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, d.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, d.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  d.valor,
  COALESCE(aj.tipo, d.tipo) AS tipo,
  'debito_automatico'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'debito_automatico' AND aj.despesa_id = d.id AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, d.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, d.banco_id)
WHERE d.status = 'pago' AND d.deleted_at IS NULL;

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- ── 4. v_cartao_fatura_fluxo_caixa — com ajuste ───────────────────────
-- classificacao_id/nome aqui são hardcoded (cartão não tem Classificação
-- própria) — com ajuste, se alguém classificar o item, resolve o nome de
-- verdade; sem ajuste, mantém o rótulo fixo de sempre.
CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  cc.nome_cartao || ' — ' || to_char(f.competencia, 'MM/YYYY') AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_compra) AS data_pagamento,
  COALESCE(aj.competencia, f.competencia) AS competencia,
  COALESCE(aj.empresa_id, cc.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  aj.classificacao_id AS classificacao_id,
  COALESCE(cl.nome, 'Cartão de Crédito'::text) AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, cc.tipo_forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, cc.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  fi.parcela_atual AS numero_parcela,
  fi.parcela_total AS numero_parcelas,
  fi.valor,
  COALESCE(aj.tipo, 'saida'::text) AS tipo,
  'cartao_fatura'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado
FROM public.malote_cartao_fatura_item fi
JOIN public.malote_cartao_fatura f ON f.id = fi.fatura_id
JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'cartao_fatura' AND aj.despesa_id = fi.id
 AND aj.numero_parcela IS NOT DISTINCT FROM fi.parcela_atual
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, cc.empresa_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, cc.banco_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = aj.classificacao_id
WHERE fi.status = 'confirmado' AND fi.deleted_at IS NULL;

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
