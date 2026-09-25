-- SIS-2026-0533, correção 2: o Cassio testou num item ainda em
-- "cotacao_realizada" (decisão pendente — SD-2026-0158) e não achou o
-- "Solicitar ajuste", porque as duas RPCs de 20260930000246/249 só aceitavam
-- 'cotacao_aprovada' como origem. O pedido original do Cassio (chamado
-- original, situação 2: "essa etapa tem só a opção de reprovação") sempre
-- foi sobre a etapa de DECISÃO também, não só o pós-aprovação — confirmado
-- agora: "ambos status precisam dessas ações".
--
-- As duas RPCs passam a aceitar as duas origens:
--   'cotacao_aprovada' → volta pra 'cotacao_realizada' (reabre a escolha do
--     vencedor entre as 3 cotações já recebidas, sem precisar recotar).
--   'cotacao_realizada' → volta pra 'aguardando_cotacao' (as cotações em si
--     precisam ser refeitas pelo Suprimentos — é o "arquivo precisa ser
--     ajustado" do chamado original).

CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_cotacao(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_pedido uuid;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status NOT IN ('cotacao_realizada', 'cotacao_aprovada') THEN
    RAISE EXCEPTION 'Só é possível solicitar ajuste durante a decisão ou depois da cotação aprovada (atual: %)', v_status;
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
  END IF;

  SELECT id INTO v_pedido FROM public.sup_compra_pedido
    WHERE despesa_id = _id AND status <> 'cancelado' LIMIT 1;
  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe um pedido de compra ativo para esta cotação — cancele-o antes de solicitar ajuste';
  END IF;

  UPDATE public.malote_despesa SET
    status = CASE WHEN v_status = 'cotacao_aprovada' THEN 'cotacao_realizada' ELSE 'aguardando_cotacao' END,
    cotacao_vencedor_num = NULL,
    valor_aprovado_cotacao = NULL,
    cotacao_observacoes = btrim(_motivo),
    cotacao_decidida_em = now(),
    cotacao_decidida_por = auth.uid()
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'ajuste_cotacao_solicitado', btrim(_motivo), auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_malote_solicitar_ajuste_cotacao(p_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v         public.malote_despesa;
  v_nome    text := public.sup_malote_nome_ator();
  v_pedido  uuid;
BEGIN
  v := public.sup_malote_carregar(p_id, 'aprovar');

  IF v.status NOT IN ('cotacao_realizada', 'cotacao_aprovada') THEN
    RAISE EXCEPTION 'Só é possível solicitar ajuste durante a decisão ou depois da cotação aprovada (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'O motivo do ajuste é obrigatório' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_pedido FROM public.sup_compra_pedido
    WHERE despesa_id = p_id AND status <> 'cancelado' LIMIT 1;
  IF v_pedido IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe um pedido de compra ativo para esta cotação — cancele-o antes de solicitar ajuste'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.malote_despesa SET
    status = CASE WHEN v.status = 'cotacao_aprovada' THEN 'cotacao_realizada' ELSE 'aguardando_cotacao' END,
    cotacao_vencedor_num = NULL,
    valor_aprovado_cotacao = NULL,
    cotacao_observacoes = btrim(p_motivo),
    cotacao_decidida_em = now(), cotacao_decidida_por = auth.uid(),
    cotacao_decidida_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'ajuste_cotacao_solicitado', auth.uid(),
          format('Ajuste solicitado por %s: %s', v_nome, btrim(p_motivo)));
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (as duas funções voltam pro CREATE OR REPLACE de 20260930000246/249,
-- que só aceitavam 'cotacao_aprovada' como origem)
-- NOTIFY pgrst, 'reload schema';
