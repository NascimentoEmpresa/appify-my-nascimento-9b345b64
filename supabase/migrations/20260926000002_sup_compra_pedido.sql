-- =====================================================================
-- SIS-2026-0207 — pedido de compra originado da cotação do Malote
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_compra_cancelar_pedido(uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_compra_enviar_pedido(uuid);
--   DROP FUNCTION IF EXISTS public.sup_compra_atualizar_pedido(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.sup_compra_gerar_pedido(uuid);
--   DROP TRIGGER IF EXISTS sup_compra_pedido_set_numero ON public.sup_compra_pedido;
--   DROP FUNCTION IF EXISTS public.sup_compra_pedido_gerar_numero();
--   DROP TABLE IF EXISTS public.sup_compra_pedido_item;
--   DROP TABLE IF EXISTS public.sup_compra_pedido;
--   DROP SEQUENCE IF EXISTS public.sup_compra_pedido_numero_seq;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_compra_pedido';
--   DELETE FROM public.app_menu WHERE codigo = 'sup_compra_pedido';
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS public.sup_compra_pedido_numero_seq;

CREATE TABLE IF NOT EXISTS public.sup_compra_pedido (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text UNIQUE NOT NULL,
  despesa_id            uuid NOT NULL UNIQUE REFERENCES public.malote_despesa(id) ON DELETE RESTRICT,
  fornecedor_id         uuid REFERENCES public.fornecedor(id) ON DELETE SET NULL,
  fornecedor_nome       text,
  contrato_id           uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  valor_total           numeric(14,2) NOT NULL DEFAULT 0,
  prazo_entrega_dias    integer CHECK (prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0),
  data_limite_entrega   date,
  local_entrega         text,
  forma_pagamento       text,
  condicoes_negociadas  text,
  frete_incluso         boolean NOT NULL DEFAULT false,
  observacoes           text,
  status                text NOT NULL DEFAULT 'rascunho'
                          CHECK (status IN (
                            'rascunho', 'enviado', 'aguardando_entrega',
                            'entrega_parcial', 'recebido', 'cancelado'
                          )),
  enviado_em            timestamptz,
  enviado_por           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_por_nome      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sup_compra_pedido_status
  ON public.sup_compra_pedido(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_compra_pedido_fornecedor
  ON public.sup_compra_pedido(fornecedor_id);

CREATE TABLE IF NOT EXISTS public.sup_compra_pedido_item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES public.sup_compra_pedido(id) ON DELETE CASCADE,
  malote_item_id  uuid REFERENCES public.malote_despesa_item(id) ON DELETE SET NULL,
  sup_item_id     uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  nome_item       text NOT NULL,
  quantidade      numeric(14,3) NOT NULL CHECK (quantidade > 0),
  unidade         text,
  tamanho         text,
  valor_unitario  numeric(14,2),
  observacao      text,
  ordem           integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sup_compra_pedido_item_pedido
  ON public.sup_compra_pedido_item(pedido_id, ordem);
CREATE INDEX IF NOT EXISTS idx_sup_compra_pedido_item_sup_item
  ON public.sup_compra_pedido_item(sup_item_id);

CREATE OR REPLACE FUNCTION public.sup_compra_pedido_gerar_numero()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.numero IS NULL OR btrim(NEW.numero) = '' THEN
    NEW.numero := 'PC-' || to_char(CURRENT_DATE, 'YYYY') || '-'
      || lpad(nextval('public.sup_compra_pedido_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sup_compra_pedido_set_numero ON public.sup_compra_pedido;
CREATE TRIGGER sup_compra_pedido_set_numero
  BEFORE INSERT ON public.sup_compra_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_compra_pedido_gerar_numero();

ALTER TABLE public.sup_compra_pedido ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_compra_pedido_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_compra_pedido_select ON public.sup_compra_pedido;
CREATE POLICY sup_compra_pedido_select ON public.sup_compra_pedido
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
    OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS sup_compra_pedido_item_select ON public.sup_compra_pedido_item;
CREATE POLICY sup_compra_pedido_item_select ON public.sup_compra_pedido_item
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.sup_compra_pedido p
     WHERE p.id = sup_compra_pedido_item.pedido_id
       AND (
         public.can_access(auth.uid(), 'sup_cotacoes_malote', 'visualizar')
         OR public.can_access(auth.uid(), 'malote_pagamento', 'aprovar')
         OR p.created_by = auth.uid()
       )
  ));

CREATE OR REPLACE FUNCTION public.sup_compra_gerar_pedido(p_despesa_id uuid)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_despesa         public.malote_despesa;
  v_pedido          public.sup_compra_pedido;
  v_fornecedor_id   uuid;
  v_fornecedor_nome text;
  v_valor           numeric(14,2);
  v_prazo_data      date;
  v_prazo_dias      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.can_access(v_uid, 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar pedido de compra';
  END IF;

  SELECT d.* INTO v_despesa
    FROM public.malote_despesa d
   WHERE d.id = p_despesa_id
   FOR UPDATE;

  IF v_despesa.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_despesa.status <> 'cotacao_aprovada' THEN
    RAISE EXCEPTION 'A solicitação precisa estar com a cotação aprovada (status atual: %)', v_despesa.status;
  END IF;
  IF v_despesa.cotacao_vencedor_num NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Cotação vencedora não informada';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sup_compra_pedido p WHERE p.despesa_id = p_despesa_id) THEN
    RAISE EXCEPTION 'Já existe pedido de compra para esta solicitação';
  END IF;

  v_fornecedor_id := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_fornecedor_id
    WHEN 2 THEN v_despesa.cot2_fornecedor_id
    WHEN 3 THEN v_despesa.cot3_fornecedor_id
  END;
  v_fornecedor_nome := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_fornecedor
    WHEN 2 THEN v_despesa.cot2_fornecedor
    WHEN 3 THEN v_despesa.cot3_fornecedor
  END;
  v_valor := COALESCE(v_despesa.valor_aprovado_cotacao, CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_valor
    WHEN 2 THEN v_despesa.cot2_valor
    WHEN 3 THEN v_despesa.cot3_valor
  END, 0);
  v_prazo_data := CASE v_despesa.cotacao_vencedor_num
    WHEN 1 THEN v_despesa.cot1_prazo
    WHEN 2 THEN v_despesa.cot2_prazo
    WHEN 3 THEN v_despesa.cot3_prazo
  END;
  v_prazo_dias := CASE WHEN v_prazo_data IS NULL THEN NULL
                       ELSE GREATEST(v_prazo_data - CURRENT_DATE, 0) END;

  INSERT INTO public.sup_compra_pedido (
    numero, despesa_id, fornecedor_id, fornecedor_nome, contrato_id, empresa_id,
    valor_total, prazo_entrega_dias, data_limite_entrega,
    forma_pagamento, condicoes_negociadas, created_by
  ) VALUES (
    NULL, v_despesa.id, v_fornecedor_id, v_fornecedor_nome,
    v_despesa.contrato_id, v_despesa.empresa_id, v_valor,
    v_prazo_dias,
    CASE WHEN v_prazo_dias IS NULL THEN NULL ELSE CURRENT_DATE + v_prazo_dias END,
    v_despesa.forma_pagamento, v_despesa.informacoes_pagamento, v_uid
  ) RETURNING * INTO v_pedido;

  INSERT INTO public.sup_compra_pedido_item (
    pedido_id, malote_item_id, sup_item_id, nome_item, quantidade,
    unidade, tamanho, valor_unitario, observacao, ordem
  )
  SELECT v_pedido.id, i.id, i.sup_item_id, i.nome_item, i.quantidade,
         i.unidade, i.tamanho, i.valor_unitario, i.observacao, i.ordem
    FROM public.malote_despesa_item i
   WHERE i.despesa_id = p_despesa_id
   ORDER BY i.ordem, i.created_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A solicitação não possui itens para gerar o pedido';
  END IF;

  RETURN v_pedido;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe pedido de compra para esta solicitação';
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_atualizar_pedido(p_id uuid, p_dados jsonb)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar pedido de compra';
  END IF;

  SELECT p.* INTO v_pedido FROM public.sup_compra_pedido p WHERE p.id = p_id FOR UPDATE;
  IF v_pedido.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_pedido.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Somente pedidos em rascunho podem ser alterados';
  END IF;

  UPDATE public.sup_compra_pedido p SET
    local_entrega        = CASE WHEN p_dados ? 'local_entrega' THEN nullif(btrim(p_dados->>'local_entrega'), '') ELSE p.local_entrega END,
    forma_pagamento      = CASE WHEN p_dados ? 'forma_pagamento' THEN nullif(btrim(p_dados->>'forma_pagamento'), '') ELSE p.forma_pagamento END,
    condicoes_negociadas = CASE WHEN p_dados ? 'condicoes_negociadas' THEN nullif(btrim(p_dados->>'condicoes_negociadas'), '') ELSE p.condicoes_negociadas END,
    frete_incluso        = CASE WHEN p_dados ? 'frete_incluso' THEN (p_dados->>'frete_incluso')::boolean ELSE p.frete_incluso END,
    observacoes          = CASE WHEN p_dados ? 'observacoes' THEN nullif(btrim(p_dados->>'observacoes'), '') ELSE p.observacoes END
  WHERE p.id = p_id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_enviar_pedido(p_id uuid)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
  v_nome text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para enviar pedido de compra';
  END IF;
  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public.sup_compra_pedido p
     SET status = 'enviado', enviado_em = now(), enviado_por = auth.uid(),
         enviado_por_nome = v_nome
   WHERE p.id = p_id AND p.status = 'rascunho'
  RETURNING * INTO v_pedido;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou não está em rascunho';
  END IF;
  RETURN v_pedido;
END $$;

CREATE OR REPLACE FUNCTION public.sup_compra_cancelar_pedido(p_id uuid, p_motivo text)
RETURNS public.sup_compra_pedido
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pedido public.sup_compra_pedido;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_cotacoes_malote', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para cancelar pedido de compra';
  END IF;
  IF nullif(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;

  UPDATE public.sup_compra_pedido p
     SET status = 'cancelado',
         observacoes = concat_ws(E'\n', nullif(p.observacoes, ''), 'Cancelamento: ' || btrim(p_motivo))
   WHERE p.id = p_id AND p.status NOT IN ('recebido', 'cancelado')
  RETURNING * INTO v_pedido;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou não pode mais ser cancelado';
  END IF;
  RETURN v_pedido;
END $$;

REVOKE ALL ON FUNCTION public.sup_compra_gerar_pedido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_atualizar_pedido(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_enviar_pedido(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_compra_cancelar_pedido(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_compra_gerar_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_atualizar_pedido(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_enviar_pedido(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_compra_cancelar_pedido(uuid, text) TO authenticated;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_compra_pedido', 'Pedidos de Compra',
       '/app/suprimentos/pedidos-compra', 65, true
  FROM public.app_modulo m
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_compra_pedido', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
   ('alterar'::public.app_acao), ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';
