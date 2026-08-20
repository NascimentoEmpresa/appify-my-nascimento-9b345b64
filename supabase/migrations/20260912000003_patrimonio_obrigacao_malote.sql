-- =========================================================================
-- Patrimônio × Malote: a conta sabe que virou despesa, e sabe quando foi paga
--
-- Hoje "Pagar" só navega para o Malote com os campos preenchidos: a conta
-- fica em "Pendente" para sempre, mesmo depois de a despesa ser criada e
-- paga lá. Quem olha o patrimônio não tem como saber em que pé está.
--
-- `malote_despesa_id` é o vínculo. Com ele:
--   • assim que a despesa é criada no Malote, a conta vira "Enviado ao Malote";
--   • o "Pago" NÃO é digitado aqui — é lido do lado do Malote
--     (malote_despesa.status = 'despesa_paga'), que é quem sabe se o dinheiro
--     saiu. Duplicar esse estado nas duas tabelas é garantir divergência.
-- =========================================================================

ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS malote_despesa_id  uuid,
  ADD COLUMN IF NOT EXISTS enviado_malote_em  timestamptz;

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".malote_despesa_id IS
  'Despesa criada no Malote a partir desta conta. Enquanto existir e não estiver paga, a conta aparece como "Enviado ao Malote"; quando a despesa vira despesa_paga, a conta aparece como "Pago".';
COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".enviado_malote_em IS
  'Quando a despesa foi criada no Malote a partir desta conta.';

CREATE INDEX IF NOT EXISTS jur_patr_obr_malote_idx
  ON public."JUR_PATRIMONIO_OBRIGACOES" (malote_despesa_id)
  WHERE malote_despesa_id IS NOT NULL;

-- A tela do Patrimônio precisa LER o status da despesa vinculada. A RLS do
-- malote_despesa é do módulo Malote e não vai ser afrouxada por causa disto:
-- esta função devolve só id/status/pago_em das despesas pedidas, que é o
-- mínimo para desenhar o selo, e nada mais da despesa.
CREATE OR REPLACE FUNCTION public.jur_patrimonio_status_malote(_ids uuid[])
RETURNS TABLE (despesa_id uuid, status text, pago_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.status, d.pago_em
    FROM public.malote_despesa d
   WHERE d.id = ANY(_ids)
$$;

REVOKE ALL ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_patrimonio_status_malote(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION public.jur_patrimonio_status_malote(uuid[]);
--   DROP INDEX public.jur_patr_obr_malote_idx;
--   ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
--     DROP COLUMN malote_despesa_id, DROP COLUMN enviado_malote_em;
-- =========================================================================
