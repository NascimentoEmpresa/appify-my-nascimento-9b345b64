-- SIS-2026-0443 (Iury): "caso a classificação seja marcada com Requer
-- Solicitação, ela abre a possibilidade de por um %, caso no momento de
-- lançar a despesa com o item com status cotação aprovada, caso o valor
-- não ultrapasse o % da cotação que foi aprovada o item sobe direto para
-- aguardando pagamento sem necessidade de N1 e N2 já que já foi feito isso
-- na cotação." Dor real: hoje o mesmo aprovador (N1) acaba aprovando o
-- MESMO valor duas vezes — uma na cotação (sup_malote_aprovar_cotacao) e
-- outra de novo na despesa (malote_aprovar_despesa nível 1) — quando nada
-- relevante mudou entre as duas.
--
-- Diferente do "Fluxo Especial" por forma de pagamento (20260930000189),
-- que decide pular nível DENTRO do RPC de aprovar (a cada clique), aqui a
-- decisão precisa ser tomada na CONVERSÃO da solicitação em despesa — a
-- despesa nem chega a nascer em pendente_aprovacao quando está dentro da
-- tolerância.
--
-- "Alterar o contrato" (segunda condição que força fluxo normal, confirmada
-- com o usuário) usa malote_despesa.contrato_id como referência: esse campo
-- é gravado na CRIAÇÃO da solicitação (PainelSolicitacao, antes da cotação
-- existir) e nunca é sobrescrito pela conversão (PainelDespesaMalote não
-- manda contrato_id no payload) — ou seja, é exatamente "o contrato que
-- estava na cotação". Comparamos contra o contrato de cada linha do Rateio
-- (malote_despesa_rateio_linha.contrato_id, escolhido agora na conversão):
-- se alguma linha aponta pra um contrato diferente do original, o contrato
-- foi alterado.
--
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.malote_finalizar_conversao_solicitacao(uuid) FROM authenticated;
--   DROP FUNCTION IF EXISTS public.malote_finalizar_conversao_solicitacao(uuid);
--   ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
--   ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
--     'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
--     'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
--     'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
--     'conferido_pagamento', 'ajuste_pagamento_solicitado',
--     'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
--     'ajuste_administrativo'
--   ));
--   ALTER TABLE public.planejamento_orcamentario_classificacao DROP COLUMN IF EXISTS tolerancia_variacao_cotacao_pct;
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN IF NOT EXISTS tolerancia_variacao_cotacao_pct numeric(5,2)
    CHECK (tolerancia_variacao_cotacao_pct IS NULL OR (tolerancia_variacao_cotacao_pct >= 0 AND tolerancia_variacao_cotacao_pct <= 100));

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
  'ajuste_administrativo', 'aprovacao_automatica_cotacao'
));

-- Chamada pelo client IMEDIATAMENTE depois dos dois updates de
-- useConverterSolicitacaoEmDespesa (despesa gravada com status=
-- 'pendente_aprovacao' e nivel_aprovacao_atual=1) — se a despesa se
-- qualificar, promove pra 'aguardando_pagamento' na hora, sem passar por
-- N1/N2. SECURITY DEFINER porque a checagem de tolerância/contrato não pode
-- ficar exposta a manipulação pelo client (ele já não controla os valores
-- comparados, mas a decisão de pular aprovação é sensível o bastante pra
-- não confiar só no client não chamar isso "errado").
DROP FUNCTION IF EXISTS public.malote_finalizar_conversao_solicitacao(uuid);

CREATE FUNCTION public.malote_finalizar_conversao_solicitacao(_despesa_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classificacao_id uuid;
  v_contrato_id uuid;
  v_valor_total numeric;
  v_valor_aprovado_cotacao numeric;
  v_status text;
  v_origem text;
  v_requer_solicitacao boolean;
  v_tolerancia_pct numeric;
  v_contrato_mudou boolean;
  v_variacao_pct numeric;
BEGIN
  SELECT classificacao_id, contrato_id, valor_total, valor_aprovado_cotacao, status, origem
    INTO v_classificacao_id, v_contrato_id, v_valor_total, v_valor_aprovado_cotacao, v_status, v_origem
    FROM public.malote_despesa WHERE id = _despesa_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = _despesa_id AND d.created_by = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      v_origem = 'solicitacao'
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = v_classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para converter esta solicitação.';
  END IF;

  -- Só se aplica a despesa recém-convertida, ainda não tocada por nenhuma
  -- aprovação real — chamar de novo depois não deve reabrir nada.
  IF v_status <> 'pendente_aprovacao' THEN RETURN false; END IF;

  SELECT requer_solicitacao, tolerancia_variacao_cotacao_pct
    INTO v_requer_solicitacao, v_tolerancia_pct
    FROM public.planejamento_orcamentario_classificacao WHERE id = v_classificacao_id;

  IF NOT COALESCE(v_requer_solicitacao, false) OR v_tolerancia_pct IS NULL
     OR v_valor_aprovado_cotacao IS NULL OR v_valor_aprovado_cotacao <= 0 THEN
    RETURN false;
  END IF;

  -- "Alterar o contrato": qualquer linha do rateio apontando pra um
  -- contrato diferente do que a solicitação já tinha antes da cotação.
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa_rateio_linha rl
    WHERE rl.despesa_id = _despesa_id AND rl.contrato_id IS DISTINCT FROM v_contrato_id
  ) INTO v_contrato_mudou;
  IF v_contrato_mudou THEN RETURN false; END IF;

  -- Só aumento de valor conta como "variação" pra esse limite — o exemplo
  -- do chamado é sempre preço subindo na hora da compra; valor que caiu não
  -- é risco de orçamento e não precisa de escala extra.
  v_variacao_pct := GREATEST(0, (v_valor_total - v_valor_aprovado_cotacao) / v_valor_aprovado_cotacao * 100);
  IF v_variacao_pct > v_tolerancia_pct THEN RETURN false; END IF;

  UPDATE public.malote_despesa SET status = 'aguardando_pagamento' WHERE id = _despesa_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (
    _despesa_id,
    'aprovacao_automatica_cotacao',
    format(
      'Aprovação automática: variação de %s%% sobre o valor aprovado na cotação (dentro da tolerância de %s%% da classificação), sem troca de contrato.',
      round(v_variacao_pct, 2), v_tolerancia_pct
    ),
    auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_finalizar_conversao_solicitacao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.malote_finalizar_conversao_solicitacao(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
