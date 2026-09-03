-- SIS-2026-0307 (Iury): no pagamento do Malote, confirmar/alterar a forma
-- de pagamento (pré-selecionada com a que o solicitante já escolheu) e
-- registrar o Banco usado — vindo do mesmo catálogo já usado no Cartão de
-- Crédito (malote_cartao_banco, 20260930000007_cartao_banco_bandeira_
-- catalogo.sql), sem criar catálogo novo.

-- ── 1. Colunas novas ────────────────────────────────────────────────────
-- Parcela ganha a própria coluna pelo mesmo motivo que já tem
-- comprovante_pagamento_path/data_pagamento_real/observacao_pagamento
-- próprios: cada parcela é paga num momento diferente, então pode (na
-- teoria) ser paga por outro banco.
ALTER TABLE public.malote_despesa
  ADD COLUMN banco_id uuid REFERENCES public.malote_cartao_banco(id);

ALTER TABLE public.malote_despesa_parcela
  ADD COLUMN banco_id uuid REFERENCES public.malote_cartao_banco(id);

-- ── 2. Policy adicional: quem paga despesa do Malote passa a enxergar o
-- catálogo de bancos ────────────────────────────────────────────────────
-- Achado explorando o código antes de implementar: malote_cartao_banco_
-- select (20260930000007) só libera pra quem acessa Financeiro > Cartão de
-- Crédito. Quem paga despesa do Malote (malote_pode_pagar()) é outro
-- público — sem esta policy aditiva, o Select de Banco no dialog de
-- pagamento apareceria vazio pra quase todo mundo que usa a tela. Aditiva
-- (policies permissivas se somam com OR) — não mexe na policy existente.
CREATE POLICY malote_cartao_banco_select_malote ON public.malote_cartao_banco
  FOR SELECT TO authenticated
  USING (public.malote_pode_pagar());

-- ── 3. malote_pagar_despesa ganha forma_pagamento/banco_id opcionais ────
-- DEFAULT NULL nos dois: não quebra nenhuma chamada existente da função
-- (nenhuma outra além do client atual, mas mantém o hábito do projeto de
-- não forçar todo call site a mudar junto).
CREATE OR REPLACE FUNCTION public.malote_pagar_despesa(
  _id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_parcelado boolean;
  v_linha jsonb;
BEGIN
  SELECT status, parcelado INTO v_status, v_parcelado FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_parcelado THEN RAISE EXCEPTION 'Despesa parcelada — pague cada parcela individualmente.'; END IF;
  IF v_status NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;
  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta despesa.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'despesa_paga',
    data_pagamento = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
    banco_id = _banco_id
  WHERE id = _id;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
  LOOP
    UPDATE public.malote_despesa_rateio_linha
    SET orcado_snapshot = (v_linha->>'orcado')::numeric,
        utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
        congelado_em = now()
    WHERE id = (v_linha->>'linha_id')::uuid
      AND despesa_id = _id
      AND congelado_em IS NULL;
  END LOOP;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'despesa_paga', _observacao, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid) TO authenticated;

-- ── 4. malote_pagar_parcela ganha os mesmos dois parâmetros ─────────────
-- Parcela não tem coluna forma_pagamento própria (não existe hoje e o
-- chamado não pede criar uma) — só banco_id é gravado na parcela; a
-- forma_pagamento confirmada só é usada pra sincronizar malote_despesa
-- (igual já acontece com comprovante_pagamento_path etc. na última
-- parcela paga, bloco "v_restantes = 0" abaixo).
CREATE OR REPLACE FUNCTION public.malote_pagar_parcela(
  _despesa_id uuid,
  _parcela_id uuid,
  _data_pagamento date,
  _comprovante_path text,
  _observacao text,
  _rateio_snapshot jsonb DEFAULT '[]'::jsonb,
  _forma_pagamento text DEFAULT NULL,
  _banco_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status_despesa text;
  v_status_parcela text;
  v_parcela_despesa_id uuid;
  v_numero_parcela int;
  v_total_parcelas int;
  v_linha jsonb;
  v_restantes int;
BEGIN
  SELECT status INTO v_status_despesa FROM public.malote_despesa WHERE id = _despesa_id;
  IF v_status_despesa IS NULL THEN RAISE EXCEPTION 'Despesa não encontrada.'; END IF;
  IF v_status_despesa NOT IN ('aguardando_pagamento', 'pronto_para_pagar') THEN
    RAISE EXCEPTION 'Despesa não está em uma etapa de pagamento válida.';
  END IF;

  SELECT status, despesa_id, numero_parcela INTO v_status_parcela, v_parcela_despesa_id, v_numero_parcela
  FROM public.malote_despesa_parcela WHERE id = _parcela_id FOR UPDATE;
  IF v_status_parcela IS NULL THEN RAISE EXCEPTION 'Parcela não encontrada.'; END IF;
  IF v_parcela_despesa_id <> _despesa_id THEN RAISE EXCEPTION 'Parcela não pertence a esta despesa.'; END IF;
  IF v_status_parcela = 'paga' THEN RAISE EXCEPTION 'Parcela já está paga.'; END IF;

  IF _data_pagamento IS NULL THEN RAISE EXCEPTION 'Data do pagamento é obrigatória.'; END IF;
  IF _comprovante_path IS NULL OR btrim(_comprovante_path) = '' THEN
    RAISE EXCEPTION 'Comprovante de pagamento é obrigatório.';
  END IF;

  IF NOT (
    public.malote_pode_pagar()
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Sem permissão para pagar esta parcela.';
  END IF;

  UPDATE public.malote_despesa_parcela SET
    status = 'paga',
    data_pagamento_real = _data_pagamento,
    comprovante_pagamento_path = _comprovante_path,
    observacao_pagamento = _observacao,
    pago_em = now(),
    pago_por = auth.uid(),
    banco_id = _banco_id
  WHERE id = _parcela_id;

  SELECT count(*) INTO v_restantes
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id AND status <> 'paga';

  SELECT count(*) INTO v_total_parcelas
  FROM public.malote_despesa_parcela WHERE despesa_id = _despesa_id;

  -- Congela o Rateio, mesma rede de segurança de malote_pagar_despesa —
  -- só na ÚLTIMA parcela paga (é quando a despesa some do "utilizado"
  -- pendente e vira gasto realizado de verdade). forma_pagamento/banco_id
  -- também sincronizam pra malote_despesa aqui, mesmo padrão de
  -- comprovante_pagamento_path/observacao_pagamento logo abaixo.
  IF v_restantes = 0 THEN
    UPDATE public.malote_despesa SET
      status = 'despesa_paga',
      data_pagamento = _data_pagamento,
      comprovante_pagamento_path = _comprovante_path,
      observacao_pagamento = _observacao,
      pago_em = now(),
      pago_por = auth.uid(),
      forma_pagamento = COALESCE(_forma_pagamento, forma_pagamento),
      banco_id = _banco_id
    WHERE id = _despesa_id;

    FOR v_linha IN SELECT * FROM jsonb_array_elements(_rateio_snapshot)
    LOOP
      UPDATE public.malote_despesa_rateio_linha
      SET orcado_snapshot = (v_linha->>'orcado')::numeric,
          utilizado_com_lancamento_snapshot = (v_linha->>'utilizado_com_lancamento')::numeric,
          congelado_em = now()
      WHERE id = (v_linha->>'linha_id')::uuid
        AND despesa_id = _despesa_id
        AND congelado_em IS NULL;
    END LOOP;
  END IF;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (
    _despesa_id,
    'despesa_paga',
    coalesce(_observacao || ' — ', '') || format('Parcela %s/%s paga.', v_numero_parcela, v_total_parcelas),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid) TO authenticated;

-- ── 5. View do Fluxo de Caixa passa a expor banco_id/banco_nome ─────────
-- "após o pagamento alimentamos o fluxo de caixa" (usuário) —
-- /app/financeiro/gestao-financeira/fluxo-caixa lê direto desta view. DROP
-- + CREATE (não CREATE OR REPLACE) porque a coluna nova entra no meio da
-- lista, antes de valor/tipo — mesma observação já deixada no comentário
-- da migration original (20260907000002) sobre ordem de colunas.
-- security_invoker = true (mantido) faz a view respeitar a RLS de
-- malote_despesa de quem consulta — não depende da policy do item 2 acima
-- pra funcionar aqui, o join só busca o nome do banco.
DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa;
CREATE VIEW public.v_malote_pagamento_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.data_pagamento,
  d.competencia,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS descricao,
  d.forma_pagamento,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  COALESCE(rl.valor, d.valor_aprovado) AS valor,
  'saida'::text AS tipo
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id
WHERE d.status = 'despesa_paga';

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

-- ── 6. Seed do Banrisul + backfill dos 2 itens já pagos ─────────────────
-- "Já temos 2 itens no fluxo, o DM-2026-0164 e o DM-2026-0163, por favor
-- colocar na nova coluna banco deles o Banrisul" (Iury). Não foi possível
-- consultar nesta sessão se alguma das duas é parcelada — o UPDATE de
-- malote_despesa_parcela abaixo cobre esse caso também (não faz nada se
-- nenhuma parcela existir), então o backfill fica correto nos dois
-- cenários sem precisar checar antes.
INSERT INTO public.malote_cartao_banco (nome) VALUES ('Banrisul')
ON CONFLICT (nome) DO NOTHING;

UPDATE public.malote_despesa
SET banco_id = (SELECT id FROM public.malote_cartao_banco WHERE nome = 'Banrisul')
WHERE numero IN ('DM-2026-0164', 'DM-2026-0163');

UPDATE public.malote_despesa_parcela p
SET banco_id = (SELECT id FROM public.malote_cartao_banco WHERE nome = 'Banrisul')
FROM public.malote_despesa d
WHERE p.despesa_id = d.id
  AND d.numero IN ('DM-2026-0164', 'DM-2026-0163')
  AND p.status = 'paga';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP VIEW IF EXISTS public.v_malote_pagamento_fluxo_caixa;
--   CREATE VIEW public.v_malote_pagamento_fluxo_caixa AS
--   -- (corpo de 20260907000002_financeiro_fluxo_caixa_gestao.sql, sem banco_id/banco_nome)
--   ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
--   GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;
--
--   -- Reverter malote_pagar_despesa/malote_pagar_parcela pros corpos de
--   -- 20260930000001_malote_pagamento_por_parcela.sql (sem forma_pagamento/banco_id).
--   DROP FUNCTION IF EXISTS public.malote_pagar_despesa(uuid, date, text, text, jsonb, text, uuid);
--   DROP FUNCTION IF EXISTS public.malote_pagar_parcela(uuid, uuid, date, text, text, jsonb, text, uuid);
--   -- (recriar as duas com a assinatura antiga, 5 parâmetros)
--
--   DROP POLICY IF EXISTS malote_cartao_banco_select_malote ON public.malote_cartao_banco;
--
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS banco_id;
--   ALTER TABLE public.malote_despesa_parcela DROP COLUMN IF EXISTS banco_id;
--
--   -- Não reverte o seed do Banrisul nem o backfill da DM-2026-0164/0163
--   -- (dado histórico real).
-- =====================================================================
