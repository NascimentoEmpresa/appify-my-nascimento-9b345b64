-- SIS-2026-0775: depois que o Nível 1 aprova a cotação ("Cotação aprovada"), a solicitação fica com quem vai lançar a despesa no Malote (o lançador da
-- Classificação, ex.: Juliana; sem lançador configurado, o próprio solicitante). Às vezes o assunto se resolve depois da aprovação e a compra deixa de ser
-- necessária, mas o lançador só podia criar a despesa: a reprovação e o ajuste eram só do aprovador/supervisor/admin.
-- Agora, NESSE status, o lançador também pode reprovar a solicitação e solicitar ajuste da cotação. Nos demais status (em decisão) nada muda: continua só
-- o aprovador. Quem pode lançar = mesma regra da tela Criar Despesa (SIS-2026-0340): com lançador configurado só ele; sem lançador, o solicitante.
-- Os dois caminhos continuam bloqueados se já existe pedido de compra ativo (o Suprimentos cancela o pedido antes).

CREATE OR REPLACE FUNCTION public.malote_sou_lancador_solicitacao(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.malote_despesa d
      LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
     WHERE d.id = _despesa_id
       AND d.origem = 'solicitacao'
       AND (
         (COALESCE(array_length(c.lancador_despesa_user_ids, 1), 0) > 0 AND _user_id = ANY (c.lancador_despesa_user_ids))
         OR (COALESCE(array_length(c.lancador_despesa_user_ids, 1), 0) = 0 AND d.created_by = _user_id)
       )
  );
$$;
REVOKE ALL ON FUNCTION public.malote_sou_lancador_solicitacao(uuid, uuid) FROM PUBLIC, anon;

-- Reprovar: além de 'cotacao_realizada' (decisão, só aprovador), vale em 'cotacao_aprovada' (aprovador OU lançador).
CREATE OR REPLACE FUNCTION public.malote_reprovar_cotacao(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_decide boolean;
  v_pedido uuid;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status NOT IN ('cotacao_realizada', 'cotacao_aprovada') THEN
    RAISE EXCEPTION 'Cotação não está pronta pra decisão.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  v_decide := public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'));

  IF v_status = 'cotacao_realizada' THEN
    IF NOT v_decide THEN
      RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
    END IF;
  ELSE
    IF NOT (v_decide OR public.malote_sou_lancador_solicitacao(_id, auth.uid())) THEN
      RAISE EXCEPTION 'Sem permissão para reprovar esta solicitação.';
    END IF;
    SELECT id INTO v_pedido FROM public.sup_compra_pedido WHERE despesa_id = _id AND status <> 'cancelado' LIMIT 1;
    IF v_pedido IS NOT NULL THEN
      RAISE EXCEPTION 'Já existe um pedido de compra ativo para esta cotação — cancele-o antes de reprovar';
    END IF;
  END IF;

  UPDATE public.malote_despesa SET status = 'solicitacao_reprovada', cotacao_reprovada_motivo = btrim(_motivo) WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'solicitacao_reprovada',
          CASE WHEN v_status = 'cotacao_aprovada' THEN 'Reprovada depois da cotação aprovada: ' || btrim(_motivo) ELSE btrim(_motivo) END,
          auth.uid());
END;
$$;

-- Ajuste: o corpo é o de 20260930000251; muda só a permissão em 'cotacao_aprovada' (aprovador OU lançador).
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
  v_decide boolean;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status NOT IN ('cotacao_realizada', 'cotacao_aprovada') THEN
    RAISE EXCEPTION 'Só é possível solicitar ajuste durante a decisão ou depois da cotação aprovada (atual: %)', v_status;
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  v_decide := public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'));

  IF NOT (v_decide OR (v_status = 'cotacao_aprovada' AND public.malote_sou_lancador_solicitacao(_id, auth.uid()))) THEN
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

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar malote_reprovar_cotacao de 20260910000001_malote_aprovador_solicitacao_gate.sql e malote_solicitar_ajuste_cotacao de
--   20260930000251_malote_ajuste_cotacao_anexo.sql, e:
--     DROP FUNCTION IF EXISTS public.malote_sou_lancador_solicitacao(uuid, uuid);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
