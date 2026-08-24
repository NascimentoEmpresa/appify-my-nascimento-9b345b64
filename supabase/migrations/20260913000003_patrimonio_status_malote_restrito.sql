-- =========================================================================
-- Aperta a jur_patrimonio_status_malote (criada em 20260912000003)
--
-- Como nasceu, ela respondia sobre QUALQUER despesa cujo id fosse informado:
-- é SECURITY DEFINER e está concedida a `authenticated`, então quem tivesse
-- um uuid de despesa na mão descobria se ela foi paga, mesmo sem acesso ao
-- Malote. Uuid não se adivinha, mas o contrato da função ficava mais largo
-- que o uso — e função de contorno de RLS tem que responder exatamente o que
-- a tela precisa, nada além.
--
-- Agora ela só fala de despesa que ESTÁ VINCULADA a uma conta de patrimônio,
-- que é o único caso para o qual existe. Migration nova em vez de editar a
-- anterior, que já está aplicada no banco (regra R4).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.jur_patrimonio_status_malote(_ids uuid[])
RETURNS TABLE (despesa_id uuid, status text, pago_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.status, d.pago_em
    FROM public.malote_despesa d
   WHERE d.id = ANY(_ids)
     AND EXISTS (
       SELECT 1 FROM public."JUR_PATRIMONIO_OBRIGACOES" o
        WHERE o.malote_despesa_id = d.id
     )
$$;

COMMENT ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) IS
  'Status de pagamento das despesas do Malote que estão vinculadas a contas de patrimônio. Devolve só id/status/pago_em: é o mínimo para a tela do Patrimônio desenhar o selo "Enviado ao Malote" / "Pago" sem afrouxar a RLS do Malote.';

REVOKE ALL ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK: voltar ao corpo da 20260912000003 (sem o EXISTS).
-- =========================================================================
