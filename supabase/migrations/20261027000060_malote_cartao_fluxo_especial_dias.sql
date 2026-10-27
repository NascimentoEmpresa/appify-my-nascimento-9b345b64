-- [SEM-CHAMADO] Malote, cartão com Fluxo Especial: despesa PARCELADA tem a 1ª parcela no vencimento da fatura em que a compra cai, não no dia do
-- lançamento. Para calcular isso a tela precisa do dia de fechamento e do dia de vencimento do cartão, mas quem lança (ex.: Compras) não tem o menu
-- "Cartão de Crédito" e a RLS de malote_cartao_credito esconde os cartões dele — mesmo problema da malote_forma_e_cartao_fluxo_especial (20261020000003).
--
-- Esta função devolve SÓ os dois dias (nada de limite, final do cartão ou banco), dos cartões ativos ligados à forma de pagamento de Fluxo
-- Especial, pela mesma regra do trigger malote_bloqueia_dia_pagamento (o cartão é ligado ao TIPO da forma, ou ao nome). Com _empresa_id, só os
-- cartões daquela empresa; sem ele, todos — a tela só usa o resultado quando todos têm as mesmas datas.
-- SECURITY DEFINER porque lê malote_cartao_credito. Idempotente.

CREATE OR REPLACE FUNCTION public.malote_cartao_fluxo_especial_dias(_forma text, _empresa_id uuid DEFAULT NULL)
RETURNS TABLE (dia_fechamento smallint, dia_vencimento smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cc.dia_fechamento, cc.dia_vencimento
    FROM public.malote_forma_pagamento fp
    JOIN public.malote_cartao_credito cc ON cc.ativo AND cc.tipo_forma_pagamento IN (fp.tipo, fp.nome)
   WHERE fp.nome = _forma
     AND fp.fluxo_aprovacao = 'especial'
     AND (_empresa_id IS NULL OR cc.empresa_id = _empresa_id);
$$;

REVOKE ALL ON FUNCTION public.malote_cartao_fluxo_especial_dias(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_cartao_fluxo_especial_dias(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_cartao_fluxo_especial_dias(text, uuid);
--   NOTIFY pgrst, 'reload schema';
