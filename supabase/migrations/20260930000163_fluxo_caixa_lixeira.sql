-- =====================================================================
-- SIS-2026-0413 — Lixeira (soft-delete) pro Fluxo de Caixa
--
-- Pedido: poder excluir um lançamento errado no Fluxo de Caixa (ex.: um
-- lançamento gravado como "débito em conta" quando o certo era
-- "recebimento de notas"). Mapeamento mostrou que "Fluxo de Caixa" não é
-- uma tabela — é uma união feita no client (useFluxoCaixaCombinado) de 3
-- views somente-leitura, cada uma espelhando uma tabela de origem
-- diferente, cada uma num estado de exclusão diferente:
--   • malote_despesa               — hard-delete existente
--     (malote_excluir_permanentemente) sem trava de status nenhuma.
--   • "DEBITO_AUTOMATICO"          — já bloqueia exclusão de item pago,
--     mas item não-pago ainda era hard-delete sem volta.
--   • malote_cartao_fatura_item    — hard-delete via
--     cartao_fatura_confirmar_importacao, sem trava nenhuma.
--
-- Decisão: `deleted_at`/`deleted_por` em cada uma das 3 tabelas (não um
-- soft-delete genérico — cada uma ganha sua própria coluna e suas
-- próprias RPCs de excluir/restaurar), sem purge automático por tempo
-- (são registros financeiros — retenção é decisão manual do
-- Administrador Geral via malote_excluir_permanentemente, que passa a
-- exigir o item já estar na lixeira). Mesmo espírito da lixeira que já
-- existe em CS_FORMULARIOS (20260720000003), adaptado pra 3 tabelas com
-- RLS/RPC próprios em vez de 1 tabela com permissão bespoke.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Colunas de soft-delete ────────────────────────────────────────────
ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_por uuid REFERENCES auth.users(id);

ALTER TABLE public."DEBITO_AUTOMATICO"
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_por uuid REFERENCES auth.users(id);

ALTER TABLE public.malote_cartao_fatura_item
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_por uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_malote_despesa_deleted_at ON public.malote_despesa(deleted_at);
CREATE INDEX IF NOT EXISTS idx_debito_automatico_deleted_at ON public."DEBITO_AUTOMATICO"(deleted_at);
CREATE INDEX IF NOT EXISTS idx_malote_cartao_fatura_item_deleted_at ON public.malote_cartao_fatura_item(deleted_at);

-- ── 2. malote_despesa — novos tipos de evento (histórico) ───────────────
ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
  'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
  'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
  'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
  'conferido_pagamento', 'ajuste_pagamento_solicitado',
  'despesa_paga', 'despesa_reprovada', 'cancelamento', 'exclusao', 'restauracao'
));

-- ── 3. malote_despesa — excluir/restaurar (soft) ─────────────────────────
-- Mesmo gate/resolução de menu que malote_excluir_permanentemente já usa
-- (origem 'solicitacao' vs 'despesa' aponta pra telas/ações diferentes).
CREATE OR REPLACE FUNCTION public.malote_despesa_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
BEGIN
  SELECT origem INTO v_origem FROM public.malote_despesa WHERE id = _id;
  IF v_origem IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir este item.';
  END IF;

  UPDATE public.malote_despesa SET deleted_at = now(), deleted_por = auth.uid() WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'exclusao', auth.uid(), 'Movido para a lixeira.');
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_despesa_restaurar(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
BEGIN
  SELECT origem INTO v_origem FROM public.malote_despesa WHERE id = _id;
  IF v_origem IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar este item.';
  END IF;

  UPDATE public.malote_despesa SET deleted_at = NULL, deleted_por = NULL WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'restauracao', auth.uid(), 'Restaurado da lixeira.');
END;
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_excluir(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.malote_despesa_restaurar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.malote_despesa_excluir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.malote_despesa_restaurar(uuid) TO authenticated;

-- ── 4. malote_excluir_permanentemente vira "esvaziar a lixeira" ─────────
-- Corrige um bug real independente deste chamado: hoje apaga qualquer
-- despesa, inclusive uma "despesa_paga" viva no Fluxo de Caixa/Orçamento
-- Utilizado, sem aviso nenhum. Passa a exigir o item já estar na lixeira
-- (deleted_at IS NOT NULL) — mesmo gate de Administrador Geral, resto do
-- corpo idêntico ao de 20260930000036 (solta diária antes do DELETE).
CREATE OR REPLACE FUNCTION public.malote_excluir_permanentemente(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origem text;
  v_menu text;
  v_deleted_at timestamptz;
BEGIN
  SELECT origem, deleted_at INTO v_origem, v_deleted_at FROM public.malote_despesa WHERE id = _id;
  IF v_origem IS NULL THEN RAISE EXCEPTION 'Item não encontrado.'; END IF;

  v_menu := CASE WHEN v_origem = 'solicitacao' THEN 'malote_solicitacao_visualizar' ELSE 'malote_despesa_visualizar' END;

  IF NOT public.can_access(auth.uid(), v_menu, 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir permanentemente este item.';
  END IF;

  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'Mova o item para a lixeira antes de excluir permanentemente.';
  END IF;

  -- SIS-2026-0287: solta a diária ANTES do DELETE, senão a FK barra tudo. A
  -- solicitação volta a aguardar decisão, sem rastro da aprovação desfeita.
  PERFORM set_config('diaria.desfazendo_aprovacao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO"
     SET status                = 'solicitada',
         malote_despesa_id     = NULL,
         malote_motivo         = NULL,
         malote_data_pagamento = NULL,
         enviado_malote_em     = NULL,
         decidido_por          = NULL,
         decidido_por_nome     = NULL,
         decidido_em           = NULL
   WHERE malote_despesa_id = _id;
  PERFORM set_config('diaria.desfazendo_aprovacao', '0', true);

  -- malote_despesa_rateio_linha, malote_despesa_parcela e
  -- malote_despesa_evento têm FK ON DELETE CASCADE — não precisa deletar
  -- manualmente.
  DELETE FROM public.malote_despesa WHERE id = _id;
END;
$$;

-- ── 5. malote_despesa — leitura ignora lixeira nas listagens ────────────
-- v_malote_pagamento_fluxo_caixa: mesmo corpo de 20260930000047, só com
-- `AND d.deleted_at IS NULL` nas duas metades do UNION ALL e a coluna
-- `origem` (usada pelo Fluxo de Caixa pra saber qual botão/RPC chamar —
-- não precisa ficar na mesma posição das outras 2 views, o client
-- concatena por nome de coluna, não por posição).
CREATE OR REPLACE VIEW public.v_malote_pagamento_fluxo_caixa AS
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
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  COALESCE(rl.valor, d.valor_aprovado) AS valor,
  'saida'::text AS tipo,
  'malote'::text AS origem
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id
WHERE d.status = 'despesa_paga' AND NOT d.parcelado AND d.deleted_at IS NULL

UNION ALL

SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  p.data_pagamento_real AS data_pagamento,
  d.competencia,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.nome AS descricao,
  d.forma_pagamento,
  p.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  p.numero_parcela,
  d.numero_parcelas,
  p.valor * COALESCE(rl.valor / NULLIF(d.valor_total, 0), 1) AS valor,
  'saida'::text AS tipo,
  'malote'::text AS origem
FROM public.malote_despesa d
JOIN public.malote_despesa_parcela p ON p.despesa_id = d.id AND p.status = 'paga'
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = p.banco_id
WHERE d.parcelado AND d.deleted_at IS NULL;

ALTER VIEW public.v_malote_pagamento_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_malote_pagamento_fluxo_caixa TO authenticated;

-- v_malote_utilizado_orcamento (Orçamento Geral/Suprimentos/Detalhe
-- Orçamento) — mesmo corpo de 20260930000002, só com `AND d.deleted_at
-- IS NULL`. Sem isso, excluir uma despesa no Fluxo de Caixa reduziria o
-- "Utilizado" desses painéis sem eles saberem por quê.
CREATE OR REPLACE VIEW public.v_malote_utilizado_orcamento AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.nome AS descricao,
  d.status,
  CASE WHEN d.parcelado THEN date_trunc('month', p.data_vencimento)::date ELSE d.competencia END AS competencia,
  d.data_pagamento,
  d.forma_pagamento,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  COALESCE(rl.empresa_id, d.empresa_id) AS empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  COALESCE(rl.contrato_id, d.contrato_id) AS contrato_id,
  c.nome AS contrato_nome,
  CASE
    WHEN d.parcelado THEN COALESCE(rl.valor, d.valor_aprovado, d.valor_total) * (p.valor / NULLIF(d.valor_total, 0))
    ELSE COALESCE(rl.valor, d.valor_aprovado, d.valor_total)
  END AS valor
FROM public.malote_despesa d
LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
LEFT JOIN public.malote_despesa_parcela p ON d.parcelado AND p.despesa_id = d.id
LEFT JOIN public.empresas e ON e.id = COALESCE(rl.empresa_id, d.empresa_id)
LEFT JOIN public.contratos c ON c.id = COALESCE(rl.contrato_id, d.contrato_id)
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
WHERE d.status IN ('aguardando_pagamento', 'despesa_paga')
  AND (NOT d.parcelado OR p.id IS NOT NULL)
  AND d.deleted_at IS NULL;

-- ── 6. "DEBITO_AUTOMATICO" — novo tipo de evento (histórico) ─────────────
-- Primeira vez que este CHECK é alterado desde a criação da tabela
-- (20260930000056) — diferente de malote_despesa_evento_tipo_evento_check,
-- que já foi re-declarado 3x com esse nome exato, aqui não há precedente
-- confirmado. Acha o nome real do constraint por introspecção em vez de
-- assumir a convenção padrão do Postgres (<tabela>_<coluna>_check), pra
-- não ficar com dois CHECKs simultâneos (o antigo ainda bloqueando
-- 'restauracao') se o nome assumido estiver errado.
DO $$
DECLARE
  v_nome text;
BEGIN
  SELECT con.conname INTO v_nome
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'public'
     AND rel.relname = 'DEBITO_AUTOMATICO_EVENTO'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%tipo_evento%';
  IF v_nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public."DEBITO_AUTOMATICO_EVENTO" DROP CONSTRAINT %I', v_nome);
  END IF;
END $$;

ALTER TABLE public."DEBITO_AUTOMATICO_EVENTO" ADD CONSTRAINT "DEBITO_AUTOMATICO_EVENTO_tipo_evento_check"
  CHECK (tipo_evento IN ('criacao', 'edicao', 'pagamento', 'exclusao', 'restauracao'));

-- ── 7. debito_automatico_excluir vira soft-delete (para todos os status,
-- inclusive 'pago' — a trava que bloqueava totalmente a exclusão de um
-- item pago deixa de fazer sentido: soft-delete é reversível). Par de
-- Movimentação Financeira continua indo junto, só que soft agora — sem
-- precisar zerar movimentacao_par_id (não há mais DELETE pra FK travar).
CREATE OR REPLACE FUNCTION public.debito_automatico_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."DEBITO_AUTOMATICO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir Débito Automático.';
  END IF;

  SELECT * INTO v_row FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  IF v_row.movimentacao_par_id IS NOT NULL THEN
    UPDATE public."DEBITO_AUTOMATICO"
       SET deleted_at = now(), deleted_por = auth.uid()
     WHERE id = v_row.movimentacao_par_id;

    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_row.movimentacao_par_id, 'exclusao', auth.uid(), 'Movido para a lixeira junto com o par da Movimentação Financeira.');
  END IF;

  UPDATE public."DEBITO_AUTOMATICO"
     SET deleted_at = now(), deleted_por = auth.uid()
   WHERE id = _id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'exclusao', auth.uid(), 'Movido para a lixeira.');
END;
$$;

CREATE OR REPLACE FUNCTION public.debito_automatico_restaurar(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."DEBITO_AUTOMATICO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-debito-automatico', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para restaurar Débito Automático.';
  END IF;

  SELECT * INTO v_row FROM public."DEBITO_AUTOMATICO" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  IF v_row.movimentacao_par_id IS NOT NULL THEN
    UPDATE public."DEBITO_AUTOMATICO" SET deleted_at = NULL, deleted_por = NULL WHERE id = v_row.movimentacao_par_id;
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (v_row.movimentacao_par_id, 'restauracao', auth.uid(), 'Restaurado junto com o par da Movimentação Financeira.');
  END IF;

  UPDATE public."DEBITO_AUTOMATICO" SET deleted_at = NULL, deleted_por = NULL WHERE id = _id;

  INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'restauracao', auth.uid(), 'Restaurado da lixeira.');
END;
$$;

REVOKE ALL ON FUNCTION public.debito_automatico_excluir FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debito_automatico_restaurar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debito_automatico_excluir TO authenticated;
GRANT EXECUTE ON FUNCTION public.debito_automatico_restaurar TO authenticated;

-- v_debito_automatico_fluxo_caixa (mesmo corpo de 20260930000058, com
-- banco resolvido) — soma `AND d.deleted_at IS NULL` e a coluna `origem`.
CREATE OR REPLACE VIEW public.v_debito_automatico_fluxo_caixa AS
SELECT
  d.id AS despesa_id,
  d.numero AS id_malote,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  d.valor,
  d.tipo,
  'debito_automatico'::text AS origem
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id
WHERE d.status = 'pago' AND d.deleted_at IS NULL;

ALTER VIEW public.v_debito_automatico_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_debito_automatico_fluxo_caixa TO authenticated;

-- v_debito_automatico_lista (tela própria de Débito Automático + fonte da
-- Lixeira do Fluxo de Caixa) — mesmo corpo de 20260930000058, sem WHERE de
-- deleted_at (a tela normal filtra deleted_at IS NULL no client, a Lixeira
-- filtra IS NOT NULL); coluna nova só pode ir no FINAL da lista.
CREATE OR REPLACE VIEW public.v_debito_automatico_lista AS
SELECT
  d.id,
  d.numero,
  d.tipo_origem,
  d.tipo,
  d.data_pagamento,
  d.competencia,
  d.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  d.contrato_id,
  c.nome AS contrato_nome,
  d.classificacao_id,
  cl.nome AS classificacao_nome,
  d.descricao,
  d.forma_pagamento,
  d.valor,
  d.status,
  d.movimentacao_par_id,
  d.created_by,
  d.created_at,
  d.updated_by,
  d.updated_at,
  d.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  d.deleted_at,
  d.deleted_por
FROM public."DEBITO_AUTOMATICO" d
LEFT JOIN public.empresas e ON e.id = d.empresa_id
LEFT JOIN public.contratos c ON c.id = d.contrato_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = d.banco_id;

-- ── 8. malote_cartao_fatura_item — excluir vira soft-delete ──────────────
-- Mesma assinatura de cartao_fatura_confirmar_importacao; só o tratamento
-- de _itens_excluir_ids muda de DELETE pra soft, e o recálculo de
-- valor_total passa a ignorar itens na lixeira.
CREATE OR REPLACE FUNCTION public.cartao_fatura_confirmar_importacao(
  _cartao_id uuid, _competencia date, _arquivo_path text,
  _itens jsonb, _itens_excluir_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fatura_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_compra_id uuid;
  v_descricao text;
  v_data_compra date;
  v_valor numeric;
  v_parcela_atual int;
  v_parcela_total int;
  v_origem text;
  v_p int;
  v_competencia_futura date;
  v_fatura_futura_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para importar fatura.';
  END IF;

  INSERT INTO public.malote_cartao_fatura (cartao_id, competencia, arquivo_original_path, status, importado_em, importado_por)
  VALUES (_cartao_id, _competencia, _arquivo_path, 'importada', now(), auth.uid())
  ON CONFLICT (cartao_id, competencia) DO UPDATE SET
    arquivo_original_path = EXCLUDED.arquivo_original_path,
    status = 'importada',
    importado_em = now(),
    importado_por = auth.uid()
  RETURNING id INTO v_fatura_id;

  IF array_length(_itens_excluir_ids, 1) > 0 THEN
    UPDATE public.malote_cartao_fatura_item
       SET deleted_at = now(), deleted_por = auth.uid()
     WHERE fatura_id = v_fatura_id AND id = ANY(_itens_excluir_ids);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_itens) LOOP
    v_item_id       := NULLIF(v_item->>'id', '')::uuid;
    v_compra_id     := (v_item->>'compra_id')::uuid;
    v_descricao     := v_item->>'descricao';
    v_data_compra   := NULLIF(v_item->>'data_compra', '')::date;
    v_valor         := (v_item->>'valor')::numeric;
    v_parcela_atual := NULLIF(v_item->>'parcela_atual', '')::int;
    v_parcela_total := NULLIF(v_item->>'parcela_total', '')::int;
    v_origem        := COALESCE(v_item->>'origem', 'importado');

    INSERT INTO public.malote_cartao_fatura_item (
      id, fatura_id, compra_id, descricao, data_compra, valor,
      parcela_atual, parcela_total, origem, status
    ) VALUES (
      COALESCE(v_item_id, gen_random_uuid()), v_fatura_id, v_compra_id, v_descricao, v_data_compra, v_valor,
      v_parcela_atual, v_parcela_total, v_origem, 'confirmado'
    )
    ON CONFLICT (id) DO UPDATE SET
      descricao = EXCLUDED.descricao,
      data_compra = EXCLUDED.data_compra,
      valor = EXCLUDED.valor,
      parcela_atual = EXCLUDED.parcela_atual,
      parcela_total = EXCLUDED.parcela_total,
      origem = EXCLUDED.origem,
      status = 'confirmado';

    IF v_parcela_atual IS NOT NULL AND v_parcela_total IS NOT NULL AND v_parcela_atual < v_parcela_total THEN
      FOR v_p IN (v_parcela_atual + 1)..v_parcela_total LOOP
        v_competencia_futura := (_competencia + make_interval(months => v_p - v_parcela_atual))::date;

        INSERT INTO public.malote_cartao_fatura (cartao_id, competencia)
        VALUES (_cartao_id, v_competencia_futura)
        ON CONFLICT (cartao_id, competencia) DO NOTHING;

        SELECT id INTO v_fatura_futura_id FROM public.malote_cartao_fatura
          WHERE cartao_id = _cartao_id AND competencia = v_competencia_futura;

        INSERT INTO public.malote_cartao_fatura_item (
          fatura_id, compra_id, descricao, data_compra, valor,
          parcela_atual, parcela_total, origem, status
        ) VALUES (
          v_fatura_futura_id, v_compra_id, v_descricao, v_data_compra, v_valor,
          v_p, v_parcela_total, 'projetado', 'pendente_confirmacao'
        )
        ON CONFLICT (fatura_id, compra_id) DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.malote_cartao_fatura SET valor_total = (
    SELECT COALESCE(sum(valor), 0) FROM public.malote_cartao_fatura_item
    WHERE fatura_id = v_fatura_id AND status = 'confirmado' AND deleted_at IS NULL
  ) WHERE id = v_fatura_id;

  RETURN v_fatura_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_confirmar_importacao FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_confirmar_importacao TO authenticated;

-- Excluir (soft) 1 item de fatura direto do Fluxo de Caixa, sem passar
-- pela tela de revisão de importação — mesmo espírito de
-- _itens_excluir_ids acima, só que avulso.
CREATE OR REPLACE FUNCTION public.cartao_fatura_item_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fatura_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-cartao-credito', 'excluir'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para excluir item de fatura.';
  END IF;

  UPDATE public.malote_cartao_fatura_item
     SET deleted_at = now(), deleted_por = auth.uid()
   WHERE id = _id
  RETURNING fatura_id INTO v_fatura_id;

  IF v_fatura_id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.';
  END IF;

  UPDATE public.malote_cartao_fatura SET valor_total = (
    SELECT COALESCE(sum(valor), 0) FROM public.malote_cartao_fatura_item
    WHERE fatura_id = v_fatura_id AND status = 'confirmado' AND deleted_at IS NULL
  ) WHERE id = v_fatura_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_item_excluir FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_item_excluir TO authenticated;

-- Restaurar item da lixeira (Fatura Cartão de Crédito).
CREATE OR REPLACE FUNCTION public.cartao_fatura_item_restaurar(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fatura_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-cartao-credito', 'excluir'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para restaurar item de fatura.';
  END IF;

  UPDATE public.malote_cartao_fatura_item
     SET deleted_at = NULL, deleted_por = NULL
   WHERE id = _id
  RETURNING fatura_id INTO v_fatura_id;

  IF v_fatura_id IS NULL THEN
    RAISE EXCEPTION 'Item não encontrado.';
  END IF;

  UPDATE public.malote_cartao_fatura SET valor_total = (
    SELECT COALESCE(sum(valor), 0) FROM public.malote_cartao_fatura_item
    WHERE fatura_id = v_fatura_id AND status = 'confirmado' AND deleted_at IS NULL
  ) WHERE id = v_fatura_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cartao_fatura_item_restaurar FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_item_restaurar TO authenticated;

-- Ação "excluir" pro menu financeiro-cartao-credito — hoje só existe
-- 'visualizar'/'alterar' nesse menu (tudo sob 'alterar'). Sem esse INSERT
-- em app_menu_acao, a ação nem aparece pra conceder no gerenciamento de
-- acesso, mesmo pra Administrador Geral (mesmo padrão de
-- 20260930000059_debito_automatico_acesso.sql).
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-cartao-credito', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-cartao-credito', 'excluir'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- v_cartao_fatura_fluxo_caixa (mesmo corpo de 20260930000060) — soma
-- `AND fi.deleted_at IS NULL` e a coluna `origem`.
CREATE OR REPLACE VIEW public.v_cartao_fatura_fluxo_caixa AS
SELECT
  fi.id AS despesa_id,
  cc.nome_cartao || ' — ' || to_char(f.competencia, 'MM/YYYY') AS id_malote,
  fi.data_compra AS data_pagamento,
  f.competencia,
  cc.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  NULL::uuid AS classificacao_id,
  'Cartão de Crédito'::text AS classificacao_nome,
  fi.descricao,
  cc.tipo_forma_pagamento AS forma_pagamento,
  cc.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  fi.parcela_atual AS numero_parcela,
  fi.parcela_total AS numero_parcelas,
  fi.valor,
  'saida'::text AS tipo,
  'cartao_fatura'::text AS origem
FROM public.malote_cartao_fatura_item fi
JOIN public.malote_cartao_fatura f ON f.id = fi.fatura_id
JOIN public.malote_cartao_credito cc ON cc.id = f.cartao_id
LEFT JOIN public.empresas e ON e.id = cc.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = cc.banco_id
WHERE fi.status = 'confirmado' AND fi.deleted_at IS NULL;

ALTER VIEW public.v_cartao_fatura_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_cartao_fatura_fluxo_caixa TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.cartao_fatura_item_restaurar(uuid);
--   DROP FUNCTION IF EXISTS public.cartao_fatura_item_excluir(uuid);
--   DROP FUNCTION IF EXISTS public.debito_automatico_restaurar(uuid);
--   DROP FUNCTION IF EXISTS public.malote_despesa_restaurar(uuid);
--   DROP FUNCTION IF EXISTS public.malote_despesa_excluir(uuid);
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-cartao-credito' AND acao = 'excluir';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-cartao-credito' AND acao = 'excluir';
--   -- recriar v_cartao_fatura_fluxo_caixa, v_debito_automatico_lista,
--   -- v_debito_automatico_fluxo_caixa, v_malote_utilizado_orcamento,
--   -- v_malote_pagamento_fluxo_caixa com o corpo das migrations citadas
--   -- nos comentários de cada seção acima (sem deleted_at/origem);
--   -- recriar debito_automatico_excluir com o corpo de 20260930000056
--   -- (bloqueia pago, hard-delete);
--   -- recriar cartao_fatura_confirmar_importacao com o corpo de
--   -- 20260930000060 (DELETE real em vez de soft);
--   -- recriar malote_excluir_permanentemente com o corpo de
--   -- 20260930000036 (sem a checagem de deleted_at);
--   ALTER TABLE public."DEBITO_AUTOMATICO_EVENTO" DROP CONSTRAINT IF EXISTS "DEBITO_AUTOMATICO_EVENTO_tipo_evento_check";
--   ALTER TABLE public."DEBITO_AUTOMATICO_EVENTO" ADD CONSTRAINT "DEBITO_AUTOMATICO_EVENTO_tipo_evento_check"
--     CHECK (tipo_evento IN ('criacao', 'edicao', 'pagamento', 'exclusao'));
--   ALTER TABLE public.malote_despesa_evento DROP CONSTRAINT IF EXISTS malote_despesa_evento_tipo_evento_check;
--   ALTER TABLE public.malote_despesa_evento ADD CONSTRAINT malote_despesa_evento_tipo_evento_check CHECK (tipo_evento IN (
--     'criacao', 'edicao', 'aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada',
--     'solicitacao_aprovada', 'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel',
--     'necessidade_de_ajuste', 'reenvio_aprovacao', 'aguardando_pagamento',
--     'conferido_pagamento', 'ajuste_pagamento_solicitado',
--     'despesa_paga', 'despesa_reprovada', 'cancelamento'
--   ));
--   ALTER TABLE public.malote_cartao_fatura_item DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_por;
--   ALTER TABLE public."DEBITO_AUTOMATICO" DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_por;
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_por;
-- =====================================================================
