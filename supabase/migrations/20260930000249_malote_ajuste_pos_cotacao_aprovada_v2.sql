-- SIS-2026-0533, correção: o Cassio não usa a tela do Suprimentos
-- (CotacaoMaloteDetalhe.tsx, RPCs sup_malote_*) que ganhou "Solicitar
-- ajuste" em 20260930000246 — ele decide a cotação em
-- SolicitacaoVisualizar.tsx (Malote), que chama malote_aprovar_cotacao/
-- malote_reprovar_cotacao. As duas telas nunca foram unificadas (ver
-- histórico do SIS-2026-0112 x SIS-2026-0132: a decisão foi "Suprimentos
-- vence", mas o lado provisório do Malote continua em produção e é o que
-- o comprador real usa) — por isso o botão "aparecia" só na tela errada.
--
-- Mesmo padrão de permissão de malote_aprovar_cotacao/malote_reprovar_cotacao
-- (20260910000001_malote_aprovador_solicitacao_gate.sql): malote_pode('aprovar')
-- + (aprovador da solicitação OU supervisor por cargo OU admin).
--
-- Reaproveita cotacao_observacoes (coluna já existe, usada pelo lado
-- Suprimentos) pra guardar o motivo do ajuste, e o tipo_evento
-- 'ajuste_cotacao_solicitado' já registrado no CHECK em 20260930000246.

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
  IF v_status <> 'cotacao_aprovada' THEN
    RAISE EXCEPTION 'Só é possível solicitar ajuste a partir de "Cotação aprovada" (atual: %)', v_status;
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
    status = 'cotacao_realizada',
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.malote_solicitar_ajuste_cotacao(uuid, text);
-- NOTIFY pgrst, 'reload schema';
