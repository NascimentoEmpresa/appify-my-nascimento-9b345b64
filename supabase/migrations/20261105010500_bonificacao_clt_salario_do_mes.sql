-- =====================================================================
-- BONIFICAÇÃO COLETIVA — "CLT" do Comparativo individual = salário real.
--
-- Pedido do Pablo (05/11/2026): a coluna "CLT IA" do Comparativo
-- individual deixa de ser a estimativa da I.A e passa a ser o salário do
-- colaborador gasto no mês, proporcional aos dias corridos já passados
-- (salário 3.200 no dia 5 de um mês de 30 dias → 3.200 × 5/30) e
-- atualizando sozinho a cada dia. Meses anteriores ficam R$ 0,00 por
-- enquanto ("ainda são incertos, não foram preenchidos corretamente").
-- A proporção é feita no front (src/lib/sistemas/bonificacaoColetiva.ts,
-- cltDoMes); aqui só sai o salário.
--
-- SALÁRIO É DADO SENSÍVEL. A tela da bonificação é vista por quem tem
-- 'sistemas_bonificacao' visualizar — isso NÃO dá direito a ver salário.
-- Mesmo corte da 20260930000011 (Colaboradores): só devolve linha para quem
-- TAMBÉM tem rh_pode_ver_salario() ('colaboradores_ver_salario'); para os
-- demais a função devolve zero linhas e a tela mostra "—". O corte é no
-- banco de propósito: esconder no React deixaria o número no JSON.
--
-- E só de quem é da equipe: responsável por chamado de sistemas concluído
-- (a mesma régua de bonificacao_dev_entregas), para a função não virar uma
-- consulta genérica de salário por uuid.
--
-- Fonte: EMPREGADOS."Valor Salário" (texto, vem da Senior pelo sync) do
-- registro ligado ao login por EMPREGADOS.auth_user_id; col_num() lê os
-- dois formatos ('1518.00' e '1.518,00').
-- =====================================================================

CREATE OR REPLACE FUNCTION public.bonificacao_dev_salarios(p_ids uuid[])
RETURNS TABLE (responsavel_id uuid, salario numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.bonificacao_dev_acesso('sistemas_bonificacao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem acesso à Bonificação Coletiva.' USING ERRCODE = '42501';
  END IF;
  -- Sem a capacidade de ver salário: nada (a tela mostra "—").
  IF NOT coalesce(public.rh_pode_ver_salario(), false) THEN
    RETURN;
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 50 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT e.auth_user_id, public.col_num(e."Valor Salário")
    FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = ANY (p_ids)
     AND public.col_num(e."Valor Salário") IS NOT NULL
     AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c
                  WHERE c.responsavel_id = e.auth_user_id AND c.concluido_em IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.bonificacao_dev_salarios(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bonificacao_dev_salarios(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.bonificacao_dev_salarios(uuid[]);
-- NOTIFY pgrst, 'reload schema';
