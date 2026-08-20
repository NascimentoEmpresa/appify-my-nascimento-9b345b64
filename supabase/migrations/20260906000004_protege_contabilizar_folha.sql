-- FALHA DE SEGURANÇA REAL: contabilizar_folha() é SECURITY DEFINER e não
-- checava absolutamente nada — nem auth.uid(), nem can_access. Qualquer
-- usuário autenticado que alcançasse a tela de Folha (ou chamasse a RPC
-- direto) conseguia gerar lançamento contábil de provisão, pagamento ou
-- encargos da folha inteira.
--
-- Achada auditando as 12 RPCs mais sensíveis do ERP: 11 já se protegem por
-- dentro; só esta não. (sup_malote_aprovar_cotacao, que a princípio parecia
-- desprotegida também, na verdade delega pra sup_malote_carregar ->
-- sup_malote_pode -> can_access('sup_cotacoes_malote', _acao) — está ok.)
--
-- Corpo idêntico ao que está em produção; a ÚNICA mudança é o bloco de
-- permissão no início, no mesmo padrão que as outras RPCs já usam. Gate
-- escolhido: 'folha' + 'alterar' — é o menu da própria tela e a ação já
-- concedida ao perfil RH na 20260906000003.
--
-- ROLLBACK: recriar a função sem o bloco "Permissão" abaixo.

CREATE OR REPLACE FUNCTION public.contabilizar_folha(_periodo_id uuid, _evento text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_per folha_periodo%ROWTYPE;
  v_codigo_evento text; v_data date; v_total numeric := 0;
  v_lanc uuid; v_tipo_filtro text; v_conta_banco uuid;
BEGIN
  -- Permissão (novo)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access(auth.uid(), 'folha', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para contabilizar a folha' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_per FROM folha_periodo WHERE id = _periodo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período de folha não encontrado'; END IF;
  IF _evento = 'provisao' THEN
    v_codigo_evento := 'EVT-008'; v_tipo_filtro := 'provisao';
    v_data := COALESCE(v_per.data_provisao, v_per.competencia);
  ELSIF _evento = 'pagamento' THEN
    v_codigo_evento := 'EVT-009'; v_tipo_filtro := 'pagamento';
    v_data := COALESCE(v_per.data_pagamento, CURRENT_DATE);
    v_conta_banco := v_per.conta_banco_id;
    IF v_conta_banco IS NULL THEN RAISE EXCEPTION 'Conta bancária obrigatória para pagamento'; END IF;
  ELSIF _evento = 'encargos' THEN
    v_codigo_evento := 'EVT-010'; v_tipo_filtro := 'encargos';
    v_data := COALESCE(v_per.data_encargos, CURRENT_DATE);
    v_conta_banco := v_per.conta_banco_id;
    IF v_conta_banco IS NULL THEN RAISE EXCEPTION 'Conta bancária obrigatória para encargos'; END IF;
  ELSE
    RAISE EXCEPTION 'Evento inválido: %', _evento;
  END IF;
  SELECT COALESCE(SUM(valor),0) INTO v_total
    FROM folha_evento WHERE folha_periodo_id = _periodo_id AND tipo = v_tipo_filtro;
  IF v_total <= 0 THEN RAISE EXCEPTION 'Sem eventos % no período', v_tipo_filtro; END IF;
  v_lanc := public.gerar_lancamento_contabil(
    v_per.empresa_id, v_codigo_evento, v_data, v_total,
    'Folha ' || _evento || ' ' || to_char(v_per.competencia,'MM/YYYY'),
    'folha_periodo', _periodo_id, NULL, v_conta_banco
  );
  RETURN v_lanc;
END $function$;
