-- SIS-2026-0874 — Auditoria da Controladoria: item 8 "Conciliação do Faturamento de Notas"
-- ============================================================================
-- O item 8 confere o Relatório de Serviços contra o Faturamento da Empresa (a conciliação criada no SIS-2026-0869, calculada ao vivo na tela).
-- Aprovar/rejeitar/reabrir e o histórico usam as mesmas tabelas dos itens 1 a 7; aqui só entra o novo tipo 'conciliacao_faturamento':
--   1) os CHECK de tipo (validação e responsável) passam a aceitar o novo valor;
--   2) auditoria_registrar aceita o tipo e dá o rótulo da notificação ao responsável (o link cai no Relatório de Serviços, como os itens 5 a 7).
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DELETE FROM public.controladoria_auditoria_validacao WHERE tipo = 'conciliacao_faturamento';
--   DELETE FROM public.controladoria_auditoria_responsavel WHERE tipo = 'conciliacao_faturamento';
--   ALTER TABLE public.controladoria_auditoria_validacao DROP CONSTRAINT IF EXISTS controladoria_auditoria_validacao_tipo_check;
--   ALTER TABLE public.controladoria_auditoria_validacao ADD CONSTRAINT controladoria_auditoria_validacao_tipo_check CHECK (tipo IN ('malote_fluxo','fluxo_extrato','centros_malote','orcado_realizado','faturado','recebido','descontos'));
--   ALTER TABLE public.controladoria_auditoria_responsavel DROP CONSTRAINT IF EXISTS controladoria_auditoria_responsavel_tipo_check;
--   ALTER TABLE public.controladoria_auditoria_responsavel ADD CONSTRAINT controladoria_auditoria_responsavel_tipo_check CHECK (tipo IN ('malote_fluxo','fluxo_extrato','centros_malote','orcado_realizado','faturado','recebido','descontos'));
--   (e recriar auditoria_registrar como em 20261006000006)
--   NOTIFY pgrst, 'reload schema';

ALTER TABLE public.controladoria_auditoria_validacao DROP CONSTRAINT IF EXISTS controladoria_auditoria_validacao_tipo_check;
ALTER TABLE public.controladoria_auditoria_validacao ADD CONSTRAINT controladoria_auditoria_validacao_tipo_check CHECK (tipo IN (
  'malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado', 'faturado', 'recebido', 'descontos', 'conciliacao_faturamento'
));
ALTER TABLE public.controladoria_auditoria_responsavel DROP CONSTRAINT IF EXISTS controladoria_auditoria_responsavel_tipo_check;
ALTER TABLE public.controladoria_auditoria_responsavel ADD CONSTRAINT controladoria_auditoria_responsavel_tipo_check CHECK (tipo IN (
  'malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado', 'faturado', 'recebido', 'descontos', 'conciliacao_faturamento'
));

DROP FUNCTION IF EXISTS public.auditoria_registrar(date, uuid, text, text, text, text, jsonb);
CREATE FUNCTION public.auditoria_registrar(
  _periodo date,
  _empresa uuid,
  _tipo text,
  _acao text,
  _justificativa text DEFAULT NULL,
  _observacao text DEFAULT NULL,
  _valores jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nome text;
  v_periodo date := date_trunc('month', _periodo)::date;
  v_antes text;
  v_novo text;
  v_id uuid;
  v_hist_acao text;
  v_titulo text;
  v_link text;
  v_destinos uuid[];
  v_rotulo text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _acao NOT IN ('aprovar', 'rejeitar', 'reabrir', 'solicitar_revisao', 'observacao') THEN
    RAISE EXCEPTION 'Ação inválida: %', _acao;
  END IF;
  IF _acao = 'observacao' THEN
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'alterar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para registrar observação';
    END IF;
    IF length(btrim(coalesce(_observacao, ''))) = 0 THEN RAISE EXCEPTION 'Observação vazia'; END IF;
  ELSIF _acao IN ('aprovar', 'rejeitar', 'reabrir') THEN
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'aprovar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para aprovar/rejeitar validações';
    END IF;
  ELSE
    IF NOT public.can_access(v_uid, 'auditoria-controladoria', 'alterar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem permissão para solicitar revisão';
    END IF;
  END IF;
  IF _acao IN ('rejeitar', 'solicitar_revisao') AND length(btrim(coalesce(_justificativa, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe a justificativa (mínimo 5 caracteres)';
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;

  -- Observação geral do período (sem validação específica).
  IF _acao = 'observacao' THEN
    INSERT INTO public.controladoria_auditoria_historico (periodo, empresa_id, tipo, acao, observacao, user_id, user_nome)
    VALUES (v_periodo, _empresa, NULL, 'observacao', btrim(_observacao), v_uid, v_nome)
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF _tipo NOT IN ('malote_fluxo', 'fluxo_extrato', 'centros_malote', 'orcado_realizado', 'faturado', 'recebido', 'descontos', 'conciliacao_faturamento') THEN
    RAISE EXCEPTION 'Validação inválida: %', _tipo;
  END IF;

  -- Garante a linha da validação (nasce pendente) e trava para a decisão.
  INSERT INTO public.controladoria_auditoria_validacao (periodo, empresa_id, tipo)
  VALUES (v_periodo, _empresa, _tipo)
  ON CONFLICT (periodo, (COALESCE(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid)), tipo) DO NOTHING;

  SELECT id, status INTO v_id, v_antes
    FROM public.controladoria_auditoria_validacao
   WHERE periodo = v_periodo
     AND empresa_id IS NOT DISTINCT FROM _empresa
     AND tipo = _tipo
   FOR UPDATE;

  IF _acao = 'aprovar' THEN
    v_novo := 'aprovado'; v_hist_acao := 'aprovado';
  ELSIF _acao = 'rejeitar' THEN
    v_novo := 'rejeitado'; v_hist_acao := 'rejeitado';
  ELSIF _acao = 'reabrir' THEN
    v_novo := 'pendente'; v_hist_acao := 'reaberto';
  ELSE
    v_novo := v_antes; v_hist_acao := 'revisao_solicitada';
  END IF;

  IF _acao <> 'solicitar_revisao' THEN
    UPDATE public.controladoria_auditoria_validacao
       SET status = v_novo,
           justificativa = CASE WHEN _acao = 'rejeitar' THEN btrim(_justificativa) ELSE NULL END,
           observacao = NULLIF(btrim(coalesce(_observacao, '')), ''),
           valores = CASE WHEN _acao = 'reabrir' THEN NULL ELSE _valores END,
           decidido_por = CASE WHEN _acao = 'reabrir' THEN NULL ELSE v_uid END,
           decidido_por_nome = CASE WHEN _acao = 'reabrir' THEN NULL ELSE v_nome END,
           decidido_em = CASE WHEN _acao = 'reabrir' THEN NULL ELSE now() END,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  INSERT INTO public.controladoria_auditoria_historico
    (periodo, empresa_id, tipo, acao, status_anterior, status_novo, justificativa, observacao, valores, user_id, user_nome)
  VALUES
    (v_periodo, _empresa, _tipo, v_hist_acao, v_antes, v_novo, NULLIF(btrim(coalesce(_justificativa, '')), ''),
     NULLIF(btrim(coalesce(_observacao, '')), ''), _valores, v_uid, v_nome);

  -- Sinaliza o(s) responsável(is) da validação quando há rejeição ou pedido de revisão.
  IF _acao IN ('rejeitar', 'solicitar_revisao') THEN
    SELECT user_ids INTO v_destinos FROM public.controladoria_auditoria_responsavel WHERE tipo = _tipo;
    v_rotulo := CASE _tipo
      WHEN 'malote_fluxo' THEN 'Malote x Fluxo de Caixa'
      WHEN 'fluxo_extrato' THEN 'Fluxo de Caixa x Extrato'
      WHEN 'centros_malote' THEN 'Centros de Custo x Malote'
      WHEN 'orcado_realizado' THEN 'Orçado x Realizado'
      WHEN 'faturado' THEN 'Notas Faturadas x Falta Faturar'
      WHEN 'recebido' THEN 'Notas Recebidas x Falta Receber'
      WHEN 'conciliacao_faturamento' THEN 'Relatório de Serviços x Faturamento da Empresa'
      ELSE 'Descontos dos Contratos' END;
    v_link := CASE _tipo
      WHEN 'malote_fluxo' THEN '/app/financeiro/gestao-financeira/fluxo-caixa'
      WHEN 'fluxo_extrato' THEN '/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa'
      WHEN 'centros_malote' THEN '/app/controladoria/centros-custo'
      WHEN 'orcado_realizado' THEN '/app/malote/orcamento-geral'
      ELSE '/app/financeiro/relatorio-servicos' END;
    v_titulo := CASE WHEN _acao = 'rejeitar'
      THEN 'Controladoria rejeitou: ' || v_rotulo
      ELSE 'Controladoria pediu revisão: ' || v_rotulo END;
    IF v_destinos IS NOT NULL AND array_length(v_destinos, 1) > 0 THEN
      INSERT INTO public.notificacoes (user_id, empresa_id, titulo, mensagem, tipo, link)
      -- empresa da notificação = a do destinatário (a validação pode ser do grupo todo).
      SELECT DISTINCT pr.id, COALESCE(_empresa, pr.empresa_id), v_titulo,
             to_char(v_periodo, 'MM/YYYY') || ' — ' || btrim(_justificativa),
             'auditoria_controladoria', v_link
        FROM unnest(v_destinos) AS uid
        JOIN public.profiles pr ON pr.id = uid
       WHERE pr.id IS DISTINCT FROM v_uid;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_registrar(date, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_registrar(date, uuid, text, text, text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
