-- [SEM-CHAMADO] Malote: a tela precisa saber se a forma de pagamento é cartão com Fluxo Especial, mas quem lança a despesa
-- (ex.: Compras) não tem o menu "Cartão de Crédito" e a RLS de malote_cartao_credito esconde os cartões dele. Resultado: a
-- regra "cartão com Fluxo Especial paga no dia do lançamento e não pede exceção" não aparecia para ele.
--
-- Esta função responde só um booleano (a forma é de um cartão ativo com Fluxo Especial?), sem devolver nenhum dado do cartão
-- (limite, vencimento, final...). Mesma regra do trigger malote_bloqueia_dia_pagamento (20261019000012): o cartão é ligado ao
-- TIPO da forma de pagamento (e, por segurança, também ao nome). SECURITY DEFINER porque lê malote_cartao_credito.
--
-- Idempotente. ROLLBACK: DROP FUNCTION IF EXISTS public.malote_forma_e_cartao_fluxo_especial(text);

CREATE OR REPLACE FUNCTION public.malote_forma_e_cartao_fluxo_especial(_forma text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.malote_forma_pagamento fp
      JOIN public.malote_cartao_credito cc ON cc.ativo AND cc.tipo_forma_pagamento IN (fp.tipo, fp.nome)
     WHERE fp.nome = _forma AND fp.fluxo_aprovacao = 'especial'
  );
$$;

REVOKE ALL ON FUNCTION public.malote_forma_e_cartao_fluxo_especial(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_forma_e_cartao_fluxo_especial(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
