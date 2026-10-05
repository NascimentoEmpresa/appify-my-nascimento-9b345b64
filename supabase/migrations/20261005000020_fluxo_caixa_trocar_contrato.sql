-- ============================================================================
-- SIS-2026-0552 — Trocar o contrato (centro de custo) de um lançamento direto
-- no Fluxo de Caixa, repassando o valor ao contrato certo no Orçamento.
-- ============================================================================
-- Hoje a edição do Fluxo grava só na tabela de AJUSTE (financeiro_fluxo_caixa_
-- ajuste) — o lançamento original não muda — e o contrato ficou fora de
-- propósito (SIS-2026-0489). Só que o "Utilizado" do Orçamento lê o rateio
-- REAL da despesa do Malote (v_malote_utilizado_orcamento ← malote_despesa_
-- rateio_linha / malote_despesa.contrato_id). Um ajuste visual no Fluxo não
-- moveria o valor no Orçamento. Por isso a troca grava na ORIGEM:
--
--   malote              → malote_despesa_rateio_linha.contrato_id (1 linha) ou
--                         malote_despesa.contrato_id (sem rateio). Despesa com
--                         rateio em VÁRIOS contratos NÃO é trocada por aqui
--                         (corrige-se na grade de rateio do Malote). Vale para
--                         todas as parcelas da despesa. Evento 'edicao' no
--                         histórico da despesa.
--   debito_automatico   → "DEBITO_AUTOMATICO".contrato_id + evento 'edicao'.
--   importacao_historica→ fluxo_caixa_importado.contrato_id (some o selo
--                         "revisar" de "contrato não mapeado" sozinho).
--   cartao_fatura       → NÃO daqui: o contrato dos itens de cartão é definido
--                         em "Classificar Lançamentos de Cartão" (rateio).
--   aplicacao_financeira→ não tem contrato.
--
-- Regra de empresa (malote e débito automático): o contrato novo precisa ser
-- da mesma empresa do lançamento — senão o valor sairia de uma empresa e iria
-- para o orçamento de outra. Na importação histórica não há essa trava (a
-- planilha tem contrato/empresa soltos e o objetivo é justamente acertar).
--
-- Permissão: a mesma ação 'alterar' do menu do Fluxo de Caixa
-- (financeiro-fluxo-caixa-gestao). SECURITY DEFINER porque as tabelas de
-- origem têm RLS própria (Malote por cargo/menu, etc.) que o Financeiro não
-- necessariamente tem — o gate é feito aqui dentro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fluxo_caixa_trocar_contrato(
  _origem text,
  _despesa_id uuid,
  _contrato_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_novo_nome text;
  v_novo_empresa uuid;
  v_antigo_id uuid;
  v_antigo_nome text;
  v_empresa_lancamento uuid;
  v_n_rateio int;
  v_rateio_id uuid;
  v_descricao text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o Fluxo de Caixa.';
  END IF;

  IF _contrato_id IS NULL THEN
    RAISE EXCEPTION 'Informe o contrato.';
  END IF;

  SELECT c.nome, c.empresa_id INTO v_novo_nome, v_novo_empresa
    FROM public.contratos c WHERE c.id = _contrato_id;
  IF v_novo_nome IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF _origem = 'malote' THEN
    SELECT d.contrato_id, d.empresa_id INTO v_antigo_id, v_empresa_lancamento
      FROM public.malote_despesa d
     WHERE d.id = _despesa_id AND d.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Despesa do Malote não encontrada.';
    END IF;

    SELECT count(*) INTO v_n_rateio
      FROM public.malote_despesa_rateio_linha WHERE despesa_id = _despesa_id;

    IF v_n_rateio > 1 THEN
      RAISE EXCEPTION 'Esta despesa é rateada entre vários contratos — ajuste a grade de rateio direto no Malote.';
    END IF;

    IF v_n_rateio = 1 THEN
      SELECT rl.id, rl.contrato_id, COALESCE(rl.empresa_id, v_empresa_lancamento)
        INTO v_rateio_id, v_antigo_id, v_empresa_lancamento
        FROM public.malote_despesa_rateio_linha rl WHERE rl.despesa_id = _despesa_id;
    END IF;

    IF v_novo_empresa IS DISTINCT FROM v_empresa_lancamento THEN
      RAISE EXCEPTION 'O contrato escolhido pertence a outra empresa. Escolha um contrato da mesma empresa do lançamento.';
    END IF;
    IF v_antigo_id IS NOT DISTINCT FROM _contrato_id THEN
      RAISE EXCEPTION 'O lançamento já está neste contrato.';
    END IF;

    SELECT nome INTO v_antigo_nome FROM public.contratos WHERE id = v_antigo_id;

    IF v_n_rateio = 1 THEN
      UPDATE public.malote_despesa_rateio_linha SET contrato_id = _contrato_id WHERE id = v_rateio_id;
    ELSE
      UPDATE public.malote_despesa SET contrato_id = _contrato_id WHERE id = _despesa_id;
    END IF;

    v_descricao := format('Contrato alterado pelo Fluxo de Caixa: "%s" → "%s". O valor foi repassado ao novo contrato no Orçamento.',
                          COALESCE(v_antigo_nome, '(sem contrato)'), v_novo_nome);
    INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, nivel, ator_user_id)
    VALUES (_despesa_id, 'edicao', v_descricao, NULL, auth.uid());

  ELSIF _origem = 'debito_automatico' THEN
    SELECT d.contrato_id, d.empresa_id INTO v_antigo_id, v_empresa_lancamento
      FROM public."DEBITO_AUTOMATICO" d
     WHERE d.id = _despesa_id AND d.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Débito automático não encontrado.';
    END IF;
    IF v_novo_empresa IS DISTINCT FROM v_empresa_lancamento THEN
      RAISE EXCEPTION 'O contrato escolhido pertence a outra empresa. Escolha um contrato da mesma empresa do lançamento.';
    END IF;
    IF v_antigo_id IS NOT DISTINCT FROM _contrato_id THEN
      RAISE EXCEPTION 'O lançamento já está neste contrato.';
    END IF;

    SELECT nome INTO v_antigo_nome FROM public.contratos WHERE id = v_antigo_id;
    UPDATE public."DEBITO_AUTOMATICO" SET contrato_id = _contrato_id WHERE id = _despesa_id;

    v_descricao := format('Contrato alterado pelo Fluxo de Caixa: "%s" → "%s".', COALESCE(v_antigo_nome, '(sem contrato)'), v_novo_nome);
    INSERT INTO public."DEBITO_AUTOMATICO_EVENTO" (debito_id, tipo_evento, ator_user_id, descricao)
    VALUES (_despesa_id, 'edicao', auth.uid(), v_descricao);

  ELSIF _origem = 'importacao_historica' THEN
    SELECT fi.contrato_id INTO v_antigo_id
      FROM public.fluxo_caixa_importado fi WHERE fi.id = _despesa_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lançamento importado não encontrado.';
    END IF;
    IF v_antigo_id IS NOT DISTINCT FROM _contrato_id THEN
      RAISE EXCEPTION 'O lançamento já está neste contrato.';
    END IF;
    UPDATE public.fluxo_caixa_importado SET contrato_id = _contrato_id WHERE id = _despesa_id;

  ELSE
    RAISE EXCEPTION 'Esta origem não permite trocar o contrato pelo Fluxo de Caixa (cartão: use "Classificar Lançamentos de Cartão").';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_trocar_contrato(text, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_trocar_contrato(text, uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.fluxo_caixa_trocar_contrato(text, uuid, uuid);
--   NOTIFY pgrst, 'reload schema';
