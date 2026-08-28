-- =========================================================================
-- Enviar o pedido de compra ao fornecedor, com comprovação de leitura
--
-- PEDIDO DO CASSIO (ajuste 4 da revisão de 27/08/2026)
-- "Enviar o pedido de compra pro fornecedor após a compra, pro fornecedor dar
-- o ok, termos a comprovação que ele visualizou. Enviar por e-mail — ele
-- preencherá o e-mail dele no formulário de fornecedor."
--
-- POR QUE LINK CLICÁVEL E NÃO PIXEL DE RASTREAMENTO
-- Decisão do Eduardo, e é a certa. Pixel invisível falha em silêncio: quase
-- todo cliente de e-mail corporativo bloqueia imagem remota por padrão, então
-- "não visualizou" viraria o caso comum e a comprovação não valeria nada.
-- Pior, o inverso também engana — um preview automático do Outlook dispararia
-- o pixel sem ninguém ter lido.
--
-- O clique é um ato deliberado de uma pessoa. Registra ABERTURA (ele clicou e
-- viu o pedido) e, separadamente, CONFIRMAÇÃO (ele apertou "estou ciente").
-- Duas coisas diferentes que um pixel juntaria numa só.
--
-- POR QUE UMA TABELA E NÃO COLUNAS NO PEDIDO
-- Reenvio acontece: e-mail errado, fornecedor que não achou, pedido corrigido.
-- Com colunas no pedido, o segundo envio apagaria a data do primeiro — e é
-- justamente o histórico que serve de comprovação. Cada envio é uma linha.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_compra_registrar_visualizacao(text, text);
--   DROP FUNCTION IF EXISTS public.sup_compra_pedido_por_token(text);
--   DROP FUNCTION IF EXISTS public.sup_compra_enviar_ao_fornecedor(uuid, text);
--   DROP TABLE IF EXISTS public.sup_compra_pedido_envio;
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.sup_compra_pedido_envio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid NOT NULL REFERENCES public.sup_compra_pedido(id) ON DELETE CASCADE,
  email_destino  text NOT NULL,
  -- O token é a credencial do fornecedor: ele não tem login, e o link é a
  -- única coisa que prova que a mensagem chegou a quem devia.
  token          text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  criado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_por_nome text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  -- Preenchido pelo worker quando o e-mail sai de fato. Nulo = na fila.
  enviado_em     timestamptz,
  erro_envio     text,
  -- Abriu o link. Prova de entrega.
  visualizado_em timestamptz,
  -- Apertou "estou ciente". Prova de aceite.
  confirmado_em  timestamptz,
  confirmado_por text,
  observacao_fornecedor text
);

CREATE INDEX IF NOT EXISTS idx_sup_compra_envio_pedido
  ON public.sup_compra_pedido_envio(pedido_id, criado_em DESC);

-- Fila do worker: criado e ainda não enviado.
CREATE INDEX IF NOT EXISTS idx_sup_compra_envio_pendente
  ON public.sup_compra_pedido_envio(criado_em)
  WHERE enviado_em IS NULL AND erro_envio IS NULL;

-- ── 1) Enfileirar o envio ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sup_compra_enviar_ao_fornecedor(
  p_pedido_id uuid,
  p_email     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_ped   record;
  v_email text;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_compra_pedido', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para enviar pedido ao fornecedor';
  END IF;

  SELECT p.*, f.email, f.email_financeiro
    INTO v_ped
    FROM public.sup_compra_pedido p
    LEFT JOIN public.fornecedor f ON f.id = p.fornecedor_id
   WHERE p.id = p_pedido_id;

  IF v_ped.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  IF v_ped.status = 'rascunho' THEN
    RAISE EXCEPTION 'O pedido ainda é rascunho — envie ao fornecedor só depois de emitido';
  END IF;
  IF v_ped.status = 'cancelado' THEN
    RAISE EXCEPTION 'Pedido cancelado não vai ao fornecedor';
  END IF;

  -- Ordem: o que foi digitado na hora, senão o e-mail do cadastro. O
  -- financeiro fica por último porque é para cobrança, não para pedido.
  v_email := btrim(COALESCE(NULLIF(btrim(p_email), ''), v_ped.email, v_ped.email_financeiro, ''));
  IF v_email = '' THEN
    RAISE EXCEPTION 'Fornecedor sem e-mail cadastrado — preencha no cadastro ou informe um agora';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido: %', v_email;
  END IF;

  INSERT INTO public.sup_compra_pedido_envio
    (pedido_id, email_destino, criado_por, criado_por_nome)
  VALUES (p_pedido_id, v_email, v_uid, public.sup_malote_nome_ator())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── 2) O que o fornecedor vê ao abrir o link ─────────────────────────────
--
-- Sem login: o token É a autenticação. Devolve só o que precisa aparecer no
-- pedido — nada de custo interno, classificação orçamentária ou dados de
-- outros fornecedores.

CREATE OR REPLACE FUNCTION public.sup_compra_pedido_por_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_env  record;
  v_ped  record;
  v_itens jsonb;
BEGIN
  SELECT * INTO v_env FROM public.sup_compra_pedido_envio WHERE token = btrim(p_token);
  IF v_env.id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Link inválido ou expirado.');
  END IF;

  SELECT p.numero, p.valor_total, p.prazo_entrega_dias, p.data_limite_entrega,
         p.local_entrega, p.forma_pagamento, p.condicoes_negociadas,
         p.frete_incluso, p.observacoes, p.fornecedor_nome, p.status,
         COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome
    INTO v_ped
    FROM public.sup_compra_pedido p
    LEFT JOIN public.empresas e ON e.id = p.empresa_id
   WHERE p.id = v_env.pedido_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'nome', i.nome_item, 'quantidade', i.quantidade,
           'unidade', i.unidade, 'tamanho', i.tamanho,
           'valor_unitario', i.valor_unitario
         ) ORDER BY i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_compra_pedido_item i
   WHERE i.pedido_id = v_env.pedido_id;

  RETURN jsonb_build_object(
    'pedido', to_jsonb(v_ped),
    'itens', v_itens,
    'visualizado_em', v_env.visualizado_em,
    'confirmado_em', v_env.confirmado_em,
    'confirmado_por', v_env.confirmado_por
  );
END;
$fn$;

-- ── 3) Registrar abertura e confirmação ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.sup_compra_registrar_visualizacao(
  p_token text,
  p_acao  text DEFAULT 'abriu'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_env record;
BEGIN
  SELECT * INTO v_env FROM public.sup_compra_pedido_envio WHERE token = btrim(p_token);
  IF v_env.id IS NULL THEN
    RETURN jsonb_build_object('erro', 'Link inválido.');
  END IF;

  IF p_acao = 'abriu' THEN
    -- Só a PRIMEIRA abertura conta. Reabrir o link não deve reescrever a data
    -- que serve de comprovação.
    UPDATE public.sup_compra_pedido_envio
       SET visualizado_em = COALESCE(visualizado_em, now())
     WHERE id = v_env.id;
  ELSIF p_acao = 'confirmou' THEN
    UPDATE public.sup_compra_pedido_envio
       SET visualizado_em = COALESCE(visualizado_em, now()),
           confirmado_em  = COALESCE(confirmado_em, now())
     WHERE id = v_env.id;
  ELSE
    RETURN jsonb_build_object('erro', 'Ação desconhecida.');
  END IF;

  SELECT * INTO v_env FROM public.sup_compra_pedido_envio WHERE id = v_env.id;
  RETURN jsonb_build_object(
    'visualizado_em', v_env.visualizado_em,
    'confirmado_em', v_env.confirmado_em
  );
END;
$fn$;

-- ── 4) RLS ───────────────────────────────────────────────────────────────
-- Leitura para quem tem a tela de pedidos. Escrita não tem policy: quem grava
-- é o worker (service role) e as RPCs acima.

ALTER TABLE public.sup_compra_pedido_envio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_compra_envio_select ON public.sup_compra_pedido_envio;
CREATE POLICY sup_compra_envio_select ON public.sup_compra_pedido_envio
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_compra_pedido', 'visualizar'));

-- As duas funções do fornecedor são `anon` de propósito: ele não tem login, e
-- o token é a credencial. Sem isto o link não abriria para ninguém de fora.
REVOKE ALL ON FUNCTION public.sup_compra_enviar_ao_fornecedor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_compra_enviar_ao_fornecedor(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.sup_compra_pedido_por_token(text)            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_compra_pedido_por_token(text)          TO anon, authenticated;

REVOKE ALL ON FUNCTION public.sup_compra_registrar_visualizacao(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_compra_registrar_visualizacao(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
