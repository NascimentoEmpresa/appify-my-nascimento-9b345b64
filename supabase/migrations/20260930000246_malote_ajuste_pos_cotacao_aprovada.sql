-- SIS-2026-0533: Cassio aprovou a cotação errado e não havia como voltar —
-- uma vez em cotacao_aprovada, a única saída pra frente era a Juliana
-- lançar a despesa; não existia reprovar nem ajustar nesse ponto. Eduardo
-- (dono do módulo Suprimentos, ver conflito registrado no SIS-2026-0112)
-- alinhou que o Cassio pode solicitar ajuste depois da cotação aprovada,
-- antes da Juliana lançar.
--
-- Mesmo padrão de sup_malote_reprovar_cotacao: motivo obrigatório, só a
-- partir de cotacao_aprovada. Diferente da reprovação (que é terminal),
-- volta pra 'cotacao_realizada' — reabre a decisão de vencedor sem exigir
-- recotar do zero, já que cot1/2/3 continuam preenchidas.
--
-- Bloqueada quando já existe pedido de compra ativo gerado a partir dessa
-- cotação: o pedido referencia o fornecedor/valor aprovado, e ajustar por
-- baixo dele deixaria o pedido órfão. Quem quiser ajustar nesse caso
-- cancela o pedido primeiro.

ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
  'ajuste_administrativo', 'aprovacao_automatica_cotacao', 'ajuste_cotacao_solicitado'
));

CREATE OR REPLACE FUNCTION public.sup_malote_solicitar_ajuste_cotacao(p_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v         public.malote_despesa;
  v_nome    text := public.sup_malote_nome_ator();
  v_pedido  uuid;
BEGIN
  v := public.sup_malote_carregar(p_id, 'aprovar');

  IF v.status <> 'cotacao_aprovada' THEN
    RAISE EXCEPTION 'Só é possível solicitar ajuste a partir de "Cotação aprovada" (atual: %)', v.status
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
    status = 'cotacao_realizada',
    cotacao_vencedor_num = NULL,
    valor_aprovado_cotacao = NULL,
    cotacao_observacoes = btrim(p_motivo),
    cotacao_decidida_em = now(), cotacao_decidida_por = auth.uid(),
    cotacao_decidida_por_nome = v_nome,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'ajuste_cotacao_solicitado', auth.uid(),
          format('Ajuste solicitado por %s após cotação aprovada: %s', v_nome, btrim(p_motivo)));
END $$;

-- A tela de decisão (cotacao_realizada) passa a exibir cotacao_observacoes/
-- cotacao_decidida_* quando vêm de um ajuste (ver acima), então um reenvio
-- de cotações precisa limpar esses campos — senão um ciclo antigo de
-- ajuste/aprovação ficaria parecendo válido pro ciclo novo. Mesmo espírito
-- do reprovada_motivo que essa função já limpava.
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
    -- Reenvio limpa decisão/reprovação/ajuste de um ciclo anterior.
    cotacao_reprovada_motivo = NULL,
    cotacao_vencedor_num = NULL,
    valor_aprovado_cotacao = NULL,
    cotacao_observacoes = NULL,
    cotacao_decidida_em = NULL, cotacao_decidida_por = NULL, cotacao_decidida_por_nome = NULL,
    updated_at = now(), updated_by = auth.uid()
  WHERE id = p_id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (p_id, 'cotacao_realizada', auth.uid(),
          format('%s cotação(ões) enviada(s) por %s.', v_qtd, v_nome));
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
-- ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
--   'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
--   'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
--   'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
--   'conferido_pagamento', 'ajuste_pagamento_solicitado',
--   'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao',
--   'ajuste_administrativo', 'aprovacao_automatica_cotacao'
-- ));
-- DROP FUNCTION IF EXISTS public.sup_malote_solicitar_ajuste_cotacao(uuid, text);
-- (sup_malote_enviar_cotacao volta pra versão de 20260831000001_malote_cotacao_suprimentos.sql,
-- sem o clear de cotacao_vencedor_num/valor_aprovado_cotacao/cotacao_observacoes/cotacao_decidida_*)
-- NOTIFY pgrst, 'reload schema';
