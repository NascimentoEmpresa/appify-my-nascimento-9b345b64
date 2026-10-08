-- ============================================================================
-- SIS-2026-0609 — descontos pós-emissão NÃO impactam o bruto da NF
-- ============================================================================
-- Multas / glosas / outros descontos PÓS-emissão são lançados pelo Financeiro
-- depois da NF emitida e só valem no PAGAMENTO (valor a pagar = líquido −
-- descontos pós-emissão). O app os somava em total_descontos, o que reduzia
-- bruto, retenções e líquido da própria nota (e o Relatório de Serviços ainda os
-- abatia de novo no "pendente"). O código foi corrigido (calcularItem não os
-- inclui mais); esta migration:
--   1. cria nf_emissao.descontos_pos_emissao_total (soma dos pós-emissão dos
--      itens) — o painel de Faturamento abate dele no "a receber", já que o
--      líquido deixou de embuti-los;
--   2. corrige as notas que JÁ foram gravadas com pós-emissão dentro do bruto
--      (hoje: NF 1405 e NF 1406, R$ 4.771,81 no total), recalculando item e
--      totais pela regra normal, com registro no Histórico da nota.
--
-- O guard nf_emissao_guard_enviada recusa alterar NF concluída sem a ação
-- 'excluir' (no SQL Editor auth.uid() é nulo): ganha UMA exceção estreita, por
-- variável local da transação (nf.recalculo_pos_emissao), usada só no BLOCO 3.
-- O resto da função é idêntico à versão de 20261007000020.
--
-- EXECUTAR EM BLOCOS, UM DE CADA VEZ (marcados "BLOCO n"): o ALTER TABLE
-- compete com sessões do painel do Supabase (deadlock 40P01, ver
-- 20261008000003); cada bloco é idempotente — se der deadlock, reexecutar aquele.
--
-- ROLLBACK:
--   ALTER TABLE public.nf_emissao DROP COLUMN descontos_pos_emissao_total;
--   (reaplicar nf_emissao_guard_enviada de 20261007000020_nf_emissao_reabrir_cancelada.sql)
--   (os valores corrigidos das 2 notas: reaplicar pelo "Ajustar valores" — não há como
--    voltar ao valor antigo, que estava errado)

-- ── BLOCO 1 ──
SET lock_timeout = '8s';
ALTER TABLE public.nf_emissao
  ADD COLUMN IF NOT EXISTS descontos_pos_emissao_total numeric(14,2) NOT NULL DEFAULT 0;

-- ── BLOCO 2 ──
SET lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
  v_campos_livres text[] := ARRAY[
    'data_pagamento', 'valor_pago',
    'situacao_site_pmt', 'situacao_dominio',
    'desconto_conta_vinculada', 'recebimento_extra', 'falta_receber', 'pago_a_mais',
    'numero_nf',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  -- Reabertura de NF cancelada para correção (nf_emissao_reabrir_cancelada): só a
  -- transição cancelada -> rascunho e só dentro dessa função.
  IF TG_OP = 'UPDATE'
     AND v_old_status = 'cancelada'
     AND NEW.status = 'rascunho'
     AND current_setting('nf.reabrindo_cancelada', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- SIS-2026-0609: recálculo único das NFs com desconto pós-emissão dentro do
  -- bruto (migration 20261008000004). Só dentro da transação que liga a variável.
  IF TG_OP = 'UPDATE'
     AND current_setting('nf.recalculo_pos_emissao', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - v_campos_livres) = (to_jsonb(NEW) - v_campos_livres);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT public.can_access(auth.uid(), 'nf-emissao', 'excluir') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── BLOCO 3 ──
-- Recalcula os itens com pós-emissão dentro do bruto (só itens do ERP, com mão de
-- obra gravada; item legado da planilha não tem esse problema) e refaz os totais
-- das notas. A conta é a de calcularItem: bruto = exec − (faltas + posto + multas
-- + glosas + outros); mão de obra = bruto − VA − VT − materiais; ISSQN/IR/COFINS/
-- PIS/CSLL sobre o bruto (percentual do item, senão o da nota); INSS sobre a mão
-- de obra pela categoria; líquido = bruto − retenções.
SELECT set_config('nf.recalculo_pos_emissao', 'on', true);

WITH alvo AS (
  SELECT i.id, i.nf_emissao_id,
         i.valor_contrato_exec - (i.faltas + i.posto_nao_implementado + i.multas + i.glosas + i.outros_descontos) AS bruto,
         i.faltas + i.posto_nao_implementado + i.multas + i.glosas + i.outros_descontos AS total_desc,
         i.vlr_va, i.vlr_vt, i.vlr_materiais, i.inss_categoria,
         COALESCE(i.issqn_pct,  n.issqn_pct)  AS p_issqn,
         COALESCE(i.ir_pct,     n.ir_pct)     AS p_ir,
         COALESCE(i.cofins_pct, n.cofins_pct) AS p_cofins,
         COALESCE(i.pis_pct,    n.pis_pct)    AS p_pis,
         COALESCE(i.csll_pct,   n.csll_pct)   AS p_csll
    FROM public.nf_emissao_item i
    JOIN public.nf_emissao n ON n.id = i.nf_emissao_id
   WHERE (i.multas_pos_emissao + i.glosas_pos_emissao + i.outros_descontos_pos_emissao) > 0
     AND i.vlr_mao_obra > 0
), calc AS (
  SELECT a.*,
         a.bruto - a.vlr_va - a.vlr_vt - a.vlr_materiais AS mao,
         CASE a.inss_categoria::text
           WHEN 'normais' THEN 0.11 WHEN 'insalubridade_20' THEN 0.13
           WHEN 'periculosidade_30' THEN 0.14 WHEN 'insalubridade_40' THEN 0.15
           ELSE 0 END AS p_inss
    FROM alvo a
), final AS (
  SELECT c.id, c.nf_emissao_id, c.total_desc,
         round(c.bruto, 2) AS vlr_bruto,
         round(c.mao, 2) AS vlr_mao_obra,
         round(c.bruto * c.p_issqn, 2)  AS issqn,
         round(c.bruto * c.p_ir, 2)     AS ir,
         round(c.bruto * c.p_cofins, 2) AS cofins,
         round(c.bruto * c.p_pis, 2)    AS pis,
         round(c.bruto * c.p_csll, 2)   AS csll,
         round(c.mao * c.p_inss, 2)     AS inss,
         round(c.bruto - c.bruto * (c.p_issqn + c.p_ir + c.p_cofins + c.p_pis + c.p_csll) - c.mao * c.p_inss, 2) AS vlr_liquido
    FROM calc c
)
UPDATE public.nf_emissao_item i
   SET total_descontos = f.total_desc, vlr_bruto = f.vlr_bruto, vlr_mao_obra = f.vlr_mao_obra,
       issqn = f.issqn, ir = f.ir, cofins = f.cofins, pis = f.pis, csll = f.csll,
       inss = f.inss, vlr_liquido = f.vlr_liquido
  FROM final f
 WHERE i.id = f.id;

-- Totais das notas afetadas = soma dos itens; e o total de pós-emissão (todas as
-- notas que têm algum pós-emissão, inclusive as que já estavam certas).
UPDATE public.nf_emissao n
   SET vlr_bruto_total = s.bruto, vlr_mao_obra_total = s.mao, vlr_liquido_total = s.liq,
       issqn_total = s.issqn, inss_total = s.inss, ir_total = s.ir,
       cofins_total = s.cofins, pis_total = s.pis, csll_total = s.csll,
       descontos_pos_emissao_total = s.pos
  FROM (
    SELECT i.nf_emissao_id,
           sum(i.vlr_bruto) AS bruto, sum(i.vlr_mao_obra) AS mao, sum(i.vlr_liquido) AS liq,
           sum(i.issqn) AS issqn, sum(i.inss) AS inss, sum(i.ir) AS ir,
           sum(i.cofins) AS cofins, sum(i.pis) AS pis, sum(i.csll) AS csll,
           sum(i.multas_pos_emissao + i.glosas_pos_emissao + i.outros_descontos_pos_emissao) AS pos
      FROM public.nf_emissao_item i
     WHERE i.nf_emissao_id IN (
       SELECT nf_emissao_id FROM public.nf_emissao_item
        WHERE (multas_pos_emissao + glosas_pos_emissao + outros_descontos_pos_emissao) > 0)
     GROUP BY i.nf_emissao_id
  ) s
 WHERE n.id = s.nf_emissao_id;

INSERT INTO public.nf_emissao_historico (nf_emissao_id, user_id, acao, detalhe)
SELECT n.id, COALESCE(n.updated_by, n.created_by), 'valores_nf_concluida_ajustados',
       'Valores recalculados automaticamente (SIS-2026-0609): os descontos pós-emissão (R$ '
       || to_char(n.descontos_pos_emissao_total, 'FM999G999G990D00')
       || ') deixaram de reduzir bruto, retenções e líquido da nota — passam a valer só no pagamento.'
  FROM public.nf_emissao n
 WHERE n.descontos_pos_emissao_total > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.nf_emissao_historico h
      WHERE h.nf_emissao_id = n.id AND h.detalhe LIKE 'Valores recalculados automaticamente (SIS-2026-0609)%');

SELECT set_config('nf.recalculo_pos_emissao', 'off', true);

NOTIFY pgrst, 'reload schema';
