-- SIS-2026-0569: importação do Fluxo de Caixa (planilha "BD Fluxo de caixa
-- 2026", 01/01 a 08/09/2026) pro ERP. A direção optou por corrigir os
-- lançamentos errados DENTRO do ERP — então a carga entra "como está" e o que
-- não casou com o cadastro (contrato/classificação) sobe sinalizado, pra ser
-- acertado depois.
--
-- Mesmo padrão das 3 origens que já alimentam a tela Gestão do Fluxo de Caixa
-- (Malote, Débito Automático, Fatura de Cartão — ver 20260930000212/222):
--   1. tabela própria com os lançamentos de origem (esta, só leitura pro app);
--   2. view no mesmo formato de colunas, com LEFT JOIN em
--      financeiro_fluxo_caixa_ajuste (COALESCE(ajuste, original)) — é assim
--      que a edição "só no Fluxo de Caixa" (data, tipo, classificação,
--      descrição, competência, empresa, banco, forma de pagamento, valor)
--      passa a funcionar também pras linhas importadas, sem tela nova;
--   3. a CHECK de `origem` do ajuste ganha 'importacao_historica'.
--
-- A tabela é carregada por script (service role), não existe tela/botão de
-- importação. `planilha_linha` UNIQUE torna a carga idempotente (reexecutar
-- não duplica).
--
-- `conferencia`: nos meses em que planilha e ERP rodaram juntos (ago/set), a
-- carga tenta casar a linha com um lançamento que já existe no ERP —
-- 'ja_existe_no_erp' (não aparece no Fluxo, só fica registrado pra
-- auditoria, com a referência em conferencia_ref), 'possivel_duplicidade'
-- (aparece sinalizada) ou 'importada' (normal).
--
-- Sinalização ("subiu errada"): a view calcula `inconsistencia` na hora —
-- contrato sem vínculo e/ou classificação sem vínculo — então o aviso some
-- sozinho quando alguém classifica a linha pela edição do Fluxo.
-- Contrato ainda não é editável no Fluxo (fica pro SIS-2026-0552).
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_fluxo_caixa_importado_fluxo_caixa;
--   DELETE FROM public.financeiro_fluxo_caixa_ajuste WHERE origem = 'importacao_historica';
--   DROP TABLE IF EXISTS public.fluxo_caixa_importado;
--   (recriar a CHECK de origem do ajuste só com 'malote','debito_automatico','cartao_fatura')
--   NOTIFY pgrst, 'reload schema';

-- ── 1. Tabela dos lançamentos importados ─────────────────────────────────
CREATE TABLE public.fluxo_caixa_importado (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- rastreio da planilha de origem
  planilha_linha      int  NOT NULL UNIQUE,
  -- coluna "ID" da planilha ("119 - 2026"...): só existe de ago/set em
  -- diante, sem equivalente no ERP — fica só pra identificar o lançamento.
  planilha_id_original text,

  tipo                text NOT NULL CHECK (tipo IN ('entrada', 'saida')),
  data_pagamento      date NOT NULL,
  competencia         date NOT NULL,
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id),

  -- "Centro de custo" da planilha = contrato. Nulo quando não existe no ERP
  -- (contrato encerrado/não cadastrado, ou balde genérico).
  contrato_id         uuid REFERENCES public.contratos(id),
  contrato_texto      text,

  classificacao_id    uuid REFERENCES public.planejamento_orcamentario_classificacao(id),
  classificacao_texto text,

  descricao           text,
  forma_pagamento     text,
  banco_id            uuid REFERENCES public.malote_cartao_banco(id),
  banco_texto         text,

  -- Pode ser negativo (estorno/desbloqueio), igual na planilha.
  valor               numeric(14,2) NOT NULL,

  conferencia         text NOT NULL DEFAULT 'importada'
                        CHECK (conferencia IN ('importada', 'possivel_duplicidade', 'ja_existe_no_erp')),
  conferencia_ref     text,
  observacao_importacao text,

  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_fluxo_caixa_importado_data ON public.fluxo_caixa_importado (data_pagamento);
CREATE INDEX idx_fluxo_caixa_importado_conferencia ON public.fluxo_caixa_importado (conferencia);

ALTER TABLE public.fluxo_caixa_importado ENABLE ROW LEVEL SECURITY;

-- Só leitura pro app (a carga usa service role; edição é via ajuste).
DROP POLICY IF EXISTS fluxo_caixa_importado_select ON public.fluxo_caixa_importado;
CREATE POLICY fluxo_caixa_importado_select ON public.fluxo_caixa_importado
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar'));

-- ── 2. Ajuste passa a aceitar a nova origem ─────────────────────────────
-- Nome da CHECK não é garantido (criada inline em 20260930000212) — descobre
-- pelo catálogo em vez de assumir.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.financeiro_fluxo_caixa_ajuste'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%origem%'
  LOOP
    EXECUTE format('ALTER TABLE public.financeiro_fluxo_caixa_ajuste DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.financeiro_fluxo_caixa_ajuste
  ADD CONSTRAINT financeiro_fluxo_caixa_ajuste_origem_check
  CHECK (origem IN ('malote', 'debito_automatico', 'cartao_fatura', 'importacao_historica'));

-- ── 3. View no formato das outras origens ───────────────────────────────
CREATE OR REPLACE VIEW public.v_fluxo_caixa_importado_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  COALESCE(fi.planilha_id_original, 'IMP-' || lpad(fi.planilha_linha::text, 5, '0')) AS id_malote,
  COALESCE(aj.data_pagamento, fi.data_pagamento) AS data_pagamento,
  COALESCE(aj.competencia, fi.competencia) AS competencia,
  COALESCE(aj.empresa_id, fi.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  fi.contrato_id,
  c.nome AS contrato_nome,
  COALESCE(aj.classificacao_id, fi.classificacao_id) AS classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(aj.descricao, fi.descricao) AS descricao,
  COALESCE(aj.forma_pagamento, fi.forma_pagamento) AS forma_pagamento,
  COALESCE(aj.banco_id, fi.banco_id) AS banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  COALESCE(aj.valor, fi.valor) AS valor,
  COALESCE(aj.tipo, fi.tipo) AS tipo,
  'importacao_historica'::text AS origem,
  (aj.id IS NOT NULL) AS ajustado,
  NULLIF(concat_ws(' · ',
    CASE WHEN fi.contrato_id IS NULL
      THEN 'Contrato não mapeado (planilha: ' || COALESCE(NULLIF(fi.contrato_texto, ''), '—') || ')' END,
    CASE WHEN COALESCE(aj.classificacao_id, fi.classificacao_id) IS NULL
      THEN 'Classificação não mapeada (planilha: ' || COALESCE(NULLIF(fi.classificacao_texto, ''), '—') || ')' END,
    fi.observacao_importacao
  ), '') AS inconsistencia
FROM public.fluxo_caixa_importado fi
LEFT JOIN public.financeiro_fluxo_caixa_ajuste aj
  ON aj.origem = 'importacao_historica' AND aj.despesa_id = fi.id AND aj.numero_parcela IS NULL
LEFT JOIN public.empresas e ON e.id = COALESCE(aj.empresa_id, fi.empresa_id)
LEFT JOIN public.contratos c ON c.id = fi.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = COALESCE(aj.classificacao_id, fi.classificacao_id)
LEFT JOIN public.malote_cartao_banco cb ON cb.id = COALESCE(aj.banco_id, fi.banco_id)
WHERE fi.deleted_at IS NULL AND fi.conferencia <> 'ja_existe_no_erp';

ALTER VIEW public.v_fluxo_caixa_importado_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_fluxo_caixa_importado_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
