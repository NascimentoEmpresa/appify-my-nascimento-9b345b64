-- ============================================================================
-- SIS-2026-0588 (parte 3) — número (ID) próprio do resgate: RG-AAAA-NNNN
-- ============================================================================
-- A aplicação tem número (AF-2026-0001) e aparece com ele no Fluxo; o resgate
-- aparecia sem ID. Mesmo padrão: sequence + trigger. Os resgates que já existem
-- ganham número na ordem da data do resgate (e criação).
--
-- ATENÇÃO — EXECUTAR EM BLOCOS, UM DE CADA VEZ (marcados "BLOCO n" abaixo):
-- o SQL Editor roda tudo numa transação só; o ALTER TABLE segura a tabela de
-- resgates até o fim e uma sessão paralela do próprio painel do Supabase
-- (mesma dupla storage.buckets × APLICACAO_FINANCEIRA_RESGATE_CAIXA) entra em
-- deadlock (40P01). Em blocos separados o bloqueio é solto entre eles. Cada
-- bloco é idempotente: se der deadlock, é só reexecutar aquele bloco.
--
-- ROLLBACK:
--   (recriar v_aplicacao_financeira_resgate_fluxo_caixa com id_malote NULL::text)
--   DROP TRIGGER IF EXISTS aplicacao_financeira_resgate_set_numero ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgate_gerar_numero();
--   ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" DROP COLUMN numero;
--   DROP SEQUENCE IF EXISTS public.aplicacao_financeira_resgate_numero_seq;

-- ── BLOCO 1 ──
SET lock_timeout = '8s';
CREATE SEQUENCE IF NOT EXISTS public.aplicacao_financeira_resgate_numero_seq;

ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" ADD COLUMN IF NOT EXISTS numero text;

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgate_gerar_numero()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'RG-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.aplicacao_financeira_resgate_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- ── BLOCO 2 ──
SET lock_timeout = '8s';
DROP TRIGGER IF EXISTS aplicacao_financeira_resgate_set_numero ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA";
CREATE TRIGGER aplicacao_financeira_resgate_set_numero BEFORE INSERT ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
  FOR EACH ROW EXECUTE FUNCTION public.aplicacao_financeira_resgate_gerar_numero();

-- ── BLOCO 3 ──

-- Números dos que já existem (data do resgate, depois criação).
UPDATE public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
   SET numero = 'RG-' || to_char(now(), 'YYYY') || '-' ||
                lpad(nextval('public.aplicacao_financeira_resgate_numero_seq')::text, 4, '0')
  FROM (
    SELECT id FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"
     WHERE numero IS NULL ORDER BY data_resgate, created_at, id
  ) o
 WHERE r.id = o.id;

SET lock_timeout = '8s';
CREATE UNIQUE INDEX IF NOT EXISTS uq_aplicacao_financeira_resgate_numero ON public."APLICACAO_FINANCEIRA_RESGATE_CAIXA"(numero);

-- ── BLOCO 4 ──
-- O Fluxo passa a mostrar o número na coluna ID (id_malote).
SET lock_timeout = '8s';
CREATE OR REPLACE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  r.numero AS id_malote,
  r.data_resgate AS data_pagamento,
  to_char(r.data_resgate, 'YYYY-MM-01')::date AS competencia,
  r.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  cl.id AS classificacao_id,
  cl.nome AS classificacao_nome,
  'Resgate de Aplicação Financeira' AS descricao,
  NULL::text AS forma_pagamento,
  NULL::uuid AS banco_id,
  NULL::text AS banco_nome,
  NULL::text AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor_principal + r.valor_rendimento AS valor,
  'entrada'::text AS tipo,
  'aplicacao_financeira'::text AS origem,
  false AS ajustado
FROM public."APLICACAO_FINANCEIRA_RESGATE_CAIXA" r
LEFT JOIN public.empresas e ON e.id = r.empresa_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.nome_key = 'aplicação financeira';

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';
