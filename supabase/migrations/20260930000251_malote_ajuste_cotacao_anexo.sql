-- SIS-2026-0533: ao solicitar ajuste na cotação, o Suprimentos pode
-- precisar anexar um arquivo novo (controle interno — não é o arquivo da
-- solicitação original, nem o anexo de pagamento que a Juliana sobe no
-- lançamento da despesa; são 3 sentidos diferentes, cada um na sua coluna,
-- de propósito, pra não misturar o que significa cada anexo).
--
-- Coluna dedicada, opcional. Limpa em qualquer reenvio de cotação
-- (sup_malote_enviar_cotacao), mesmo espírito da limpeza que já existe ali
-- desde 20260930000246 pra cotacao_observacoes/cotacao_decidida_*.

ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS cotacao_ajuste_anexo_path text,
  ADD COLUMN IF NOT EXISTS cotacao_ajuste_anexo_nome text;

CREATE OR REPLACE FUNCTION public.malote_solicitar_ajuste_cotacao(
  _id uuid, _motivo text, _anexo_path text DEFAULT NULL, _anexo_nome text DEFAULT NULL)
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
    cotacao_decidida_por = auth.uid(),
    cotacao_ajuste_anexo_path = _anexo_path,
    cotacao_ajuste_anexo_nome = _anexo_nome
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'ajuste_cotacao_solicitado', btrim(_motivo), auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_malote_solicitar_ajuste_cotacao(
  p_id uuid, p_motivo text, p_anexo_path text DEFAULT NULL, p_anexo_nome text DEFAULT NULL)
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
    cotacao_ajuste_anexo_path = p_anexo_path,
    cotacao_ajuste_anexo_nome = p_anexo_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'ajuste_cotacao_solicitado', auth.uid(),
          format('Ajuste solicitado por %s: %s', v_nome, btrim(p_motivo)));
END $$;

-- Reenvio de cotação limpa o ajuste (arquivo e demais campos) do ciclo
-- anterior, mesmo espírito de 20260930000246.
CREATE OR REPLACE FUNCTION public.sup_malote_enviar_cotacao(p_id uuid, p_cotacoes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v      public.malote_despesa;
  v_nome text := public.sup_malote_nome_ator();
  v_min  int;
  v_qtd  int;
  i      int;
  c      jsonb;
BEGIN
  v := public.sup_malote_carregar(p_id, 'alterar');

  IF v.status <> 'aguardando_cotacao' THEN
    RAISE EXCEPTION 'Só é possível enviar cotação a partir de "Cotação Pendente" (atual: %)', v.status
      USING ERRCODE = '22023';
  END IF;

  v_min := CASE WHEN v.tipo = 'dispensa_cotacao' THEN 1 ELSE 3 END;

  v_qtd := 0;
  FOR i IN 0..2 LOOP
    c := coalesce(p_cotacoes, '[]'::jsonb) -> i;
    IF coalesce(btrim(c->>'fornecedor'), '') <> '' THEN
      v_qtd := v_qtd + 1;
      IF coalesce(btrim(c->>'valor'), '') = '' OR (c->>'valor')::numeric <= 0 THEN
        RAISE EXCEPTION 'Informe o valor da cotação %', i + 1 USING ERRCODE = '22023';
      END IF;
      IF coalesce(btrim(c->>'prazo'), '') = '' THEN
        RAISE EXCEPTION 'Informe o prazo da cotação %', i + 1 USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  IF v_qtd < v_min THEN
    RAISE EXCEPTION 'São necessárias % cotação(ões) preenchidas; há %.', v_min, v_qtd
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.sup_malote_aplicar_cotacoes(p_id, p_cotacoes);

  UPDATE public.malote_despesa SET
    status = 'cotacao_realizada',
    cotacao_enviada_em = now(), cotacao_enviada_por = auth.uid(),
    cotacao_enviada_por_nome = v_nome,
    cotacao_reprovada_motivo = NULL,
    cotacao_vencedor_num = NULL,
    valor_aprovado_cotacao = NULL,
    cotacao_observacoes = NULL,
    cotacao_decidida_em = NULL, cotacao_decidida_por = NULL, cotacao_decidida_por_nome = NULL,
    cotacao_ajuste_anexo_path = NULL, cotacao_ajuste_anexo_nome = NULL,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_realizada', auth.uid(),
          format('%s cotação(ões) enviada(s) por %s.', v_qtd, v_nome));
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS cotacao_ajuste_anexo_path;
-- ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS cotacao_ajuste_anexo_nome;
-- (as 3 funções voltam pra versão de 20260930000249/250; a assinatura de
-- malote_solicitar_ajuste_cotacao/sup_malote_solicitar_ajuste_cotacao muda
-- de 2 pra 4 parâmetros — se voltar, os dois DROP FUNCTION com a
-- assinatura de 4 parâmetros primeiro)
-- NOTIFY pgrst, 'reload schema';
