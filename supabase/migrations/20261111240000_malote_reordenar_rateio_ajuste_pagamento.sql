-- [SEM-CHAMADO] Malote: quem corrige uma despesa devolvida pela Conferência de Pagamento (ajuste_pagamento) pode REORDENAR as linhas do Rateio
-- ============================================================================
-- Pedido (SD-2026-0211, Calita/Juliana): as listas (Pagamento, Aprovações, Arquivos) mostram empresa/contrato/classificação da 1ª linha do rateio
-- (menor `ordem`). Para a despesa parcelada o Rateio é travado em fase de pagamento (RLS de malote_rateio_linha), então não dava para dizer qual
-- linha deve ser a primeira. Reordenar NÃO muda valor, empresa, contrato nem orçamento: só a coluna `ordem`. Por isso não refaz a aprovação.
--
-- malote_reordenar_rateio_ajuste(p_despesa_id, p_linha_ids): SECURITY DEFINER, grava SOMENTE `ordem` (0..n-1 na ordem recebida).
-- Confere dentro da função (não depende da RLS, que continua travando o resto):
--   · a despesa está em ajuste_pagamento;
--   · quem chama é quem corrige essa despesa: o lançador da Classificação quando ela tem lançador configurado; senão, o criador da despesa;
--   · a lista recebida é exatamente o conjunto de linhas do rateio da despesa (sem faltar, sobrar nem repetir).
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_reordenar_rateio_ajuste(uuid, uuid[]);
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.malote_reordenar_rateio_ajuste(p_despesa_id uuid, p_linha_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_status text;
  v_criador uuid;
  v_lancadores uuid[];
  v_pode boolean;
  v_existentes uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.';
  END IF;

  SELECT d.status, d.created_by, c.lancador_despesa_user_ids
    INTO v_status, v_criador, v_lancadores
    FROM public.malote_despesa d
    LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
   WHERE d.id = p_despesa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Despesa não encontrada.';
  END IF;
  IF v_status IS DISTINCT FROM 'ajuste_pagamento' THEN
    RAISE EXCEPTION 'A ordem do rateio só pode ser alterada enquanto a despesa está em ajuste de pagamento.';
  END IF;

  v_pode := CASE
    WHEN COALESCE(array_length(v_lancadores, 1), 0) > 0 THEN v_uid = ANY (v_lancadores)
    ELSE v_criador = v_uid
  END;
  IF NOT v_pode THEN
    RAISE EXCEPTION 'Sem permissão para alterar a ordem do rateio desta despesa.';
  END IF;

  SELECT COALESCE(array_agg(l.id ORDER BY l.id), '{}') INTO v_existentes
    FROM public.malote_despesa_rateio_linha l WHERE l.despesa_id = p_despesa_id;
  IF v_existentes IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(p_linha_ids) AS x) THEN
    RAISE EXCEPTION 'A lista de linhas não confere com o rateio da despesa.';
  END IF;

  UPDATE public.malote_despesa_rateio_linha l
     SET ordem = o.pos - 1
    FROM unnest(p_linha_ids) WITH ORDINALITY AS o(id, pos)
   WHERE l.id = o.id AND l.despesa_id = p_despesa_id;
END;
$$;
REVOKE ALL ON FUNCTION public.malote_reordenar_rateio_ajuste(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_reordenar_rateio_ajuste(uuid, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
