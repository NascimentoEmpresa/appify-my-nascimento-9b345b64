-- SIS-2026-0841: ajuste antes da emissão. O navegador informa percentuais;
-- o banco recalcula sobre os itens salvos, em uma única transação.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.nfse_atualizar_pis_cofins(
  _nf_id uuid, _pis_pct numeric, _cofins_pct numeric,
  _versao timestamptz, _base_itens jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nf public.nf_emissao%ROWTYPE;
  v_base jsonb;
  v_pis numeric; v_cofins numeric; v_liquido numeric;
  v_bruto_itens numeric; v_pis_antigo numeric; v_cofins_antigo numeric; v_liquido_itens numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'financeiro-nfse', 'alterar')
    OR NOT public.has_screen_access(auth.uid(), 'nf_emissao_controle', 'visualizar')
    OR NOT public.can_access(auth.uid(), 'nf-emissao', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para ajustar PIS/COFINS desta preparação';
  END IF;
  IF _pis_pct IS NULL OR _cofins_pct IS NULL OR _pis_pct NOT BETWEEN 0 AND 100 OR _cofins_pct NOT BETWEEN 0 AND 100
    OR _pis_pct <> round(_pis_pct, 2) OR _cofins_pct <> round(_cofins_pct, 2) THEN
    RAISE EXCEPTION 'Informe percentuais entre 0 e 100, com até duas casas decimais';
  END IF;
  -- Mesmo lock da solicitação fiscal: salvar e solicitar não podem intercalar.
  SELECT * INTO v_nf FROM public.nf_emissao WHERE id = _nf_id FOR UPDATE;
  IF NOT FOUND OR v_nf.status::text <> 'enviada' OR v_nf.deleted_at IS NOT NULL
    OR nullif(btrim(v_nf.numero_nf), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Ajuste permitido somente em uma preparação ainda não emitida';
  END IF;
  IF EXISTS (SELECT 1 FROM public."NFSE_SOLICITACAO" WHERE nf_emissao_id = _nf_id AND estado <> 'rejeitada') THEN
    RAISE EXCEPTION 'Há solicitação fiscal ativa. Confira ou descarte a solicitação antes de alterar os valores';
  END IF;
  PERFORM id FROM public.nf_emissao_item WHERE nf_emissao_id = _nf_id ORDER BY id FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('id', id, 'bruto', vlr_bruto, 'pis', pis, 'cofins', cofins, 'liquido', vlr_liquido) ORDER BY id),
    sum(vlr_bruto), sum(pis), sum(cofins), sum(vlr_liquido)
    INTO v_base, v_bruto_itens, v_pis_antigo, v_cofins_antigo, v_liquido_itens
    FROM public.nf_emissao_item WHERE nf_emissao_id = _nf_id;
  IF _versao IS DISTINCT FROM v_nf.updated_at OR _base_itens IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION 'A preparação foi alterada. Reabra a nota e confira os valores atuais';
  END IF;
  IF v_base IS NULL OR abs(v_bruto_itens - v_nf.vlr_bruto_total) > 0.01
    OR abs(v_pis_antigo - v_nf.pis_total) > 0.01 OR abs(v_cofins_antigo - v_nf.cofins_total) > 0.01
    OR abs(v_liquido_itens - v_nf.vlr_liquido_total) > 0.01 THEN
    RAISE EXCEPTION 'Os itens divergem dos valores salvos. Revise e salve a preparação em Emissão de NF';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nf_emissao_item WHERE nf_emissao_id = _nf_id AND
    (vlr_bruto < 0 OR vlr_liquido + pis + cofins - round(vlr_bruto * _pis_pct / 100, 2) - round(vlr_bruto * _cofins_pct / 100, 2) < 0)) THEN
    RAISE EXCEPTION 'Os percentuais informados deixam o líquido de um item negativo';
  END IF;
  SELECT sum(round(vlr_bruto * _pis_pct / 100, 2)), sum(round(vlr_bruto * _cofins_pct / 100, 2))
    INTO v_pis, v_cofins FROM public.nf_emissao_item WHERE nf_emissao_id = _nf_id;
  v_liquido := v_nf.vlr_liquido_total + v_nf.pis_total + v_nf.cofins_total - v_pis - v_cofins;
  IF v_liquido < 0 THEN RAISE EXCEPTION 'Os percentuais informados deixam o líquido negativo'; END IF;
  -- Preservar bruto, base de mão de obra e todas as demais retenções,
  -- inclusive em notas legadas. Percentuais próprios de PIS/COFINS são substituídos.
  UPDATE public.nf_emissao_item SET pis_pct = _pis_pct / 100, cofins_pct = _cofins_pct / 100,
    pis = round(vlr_bruto * _pis_pct / 100, 2), cofins = round(vlr_bruto * _cofins_pct / 100, 2),
    vlr_liquido = vlr_liquido + pis + cofins - round(vlr_bruto * _pis_pct / 100, 2) - round(vlr_bruto * _cofins_pct / 100, 2)
    WHERE nf_emissao_id = _nf_id;
  UPDATE public.nf_emissao SET pis_pct = _pis_pct / 100, cofins_pct = _cofins_pct / 100,
    pis_total = v_pis, cofins_total = v_cofins, vlr_liquido_total = v_liquido, updated_by = auth.uid()
    WHERE id = _nf_id;
  INSERT INTO public.nf_emissao_historico(nf_emissao_id, acao, detalhe, dados) VALUES (_nf_id, 'nf_editada',
    format('PIS/COFINS ajustados antes da emissão: PIS %s%% (R$ %s), COFINS %s%% (R$ %s). Líquido R$ %s.', _pis_pct, v_pis, _cofins_pct, v_cofins, v_liquido),
    jsonb_build_object('pis_pct', _pis_pct, 'cofins_pct', _cofins_pct, 'pis_anterior', v_nf.pis_total,
      'cofins_anterior', v_nf.cofins_total, 'liquido_anterior', v_nf.vlr_liquido_total,
      'pis_total', v_pis, 'cofins_total', v_cofins, 'vlr_liquido_total', v_liquido));
END $$;
REVOKE ALL ON FUNCTION public.nfse_atualizar_pis_cofins(uuid,numeric,numeric,timestamptz,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nfse_atualizar_pis_cofins(uuid,numeric,numeric,timestamptz,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- ROLLBACK: DROP FUNCTION public.nfse_atualizar_pis_cofins(uuid,numeric,numeric,timestamptz,jsonb);
-- Não desfazer valores revisados pelo Financeiro nem o histórico de auditoria.
