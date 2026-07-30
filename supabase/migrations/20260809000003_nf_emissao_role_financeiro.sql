-- O papel 'financeiro' (usado em titulo_pagar/titulo_receber/DRE etc. como
-- escrita legitima do time de Financeiro) nunca foi incluido nas policies de
-- nf_emissao — só admin/controladoria/diretor_adm passavam. Isso bloqueava
-- na pratica o proprio time de Financeiro (ex: Ruan, role 'financeiro') de
-- criar/enviar NF e de validar/registrar pagamento e reconciliação, gerando
-- "new row violates row-level security policy for table nf_emissao".
ALTER POLICY "nfe_insert" ON public.nf_emissao
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

ALTER POLICY "nfe_update" ON public.nf_emissao
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

ALTER POLICY "nfe_delete" ON public.nf_emissao
  USING (
    (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
    AND (has_role(auth.uid(), 'admin') OR empresa_id = get_user_empresa(auth.uid()))
  );

ALTER POLICY "nfei_write" ON public.nf_emissao_item
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

ALTER POLICY "nfea_write" ON public.nf_emissao_anexo
  USING (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.nf_emissao n WHERE n.id = nf_emissao_id
      AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm') OR has_role(auth.uid(), 'financeiro'))
      AND (has_role(auth.uid(), 'admin') OR n.empresa_id = get_user_empresa(auth.uid()))
  ));

ALTER POLICY "nf_emissao_storage_insert" ON storage.objects
  WITH CHECK (bucket_id = 'nf-emissao' AND (has_role(auth.uid(), 'admin') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

ALTER POLICY "nf_emissao_storage_delete" ON storage.objects
  USING (bucket_id = 'nf-emissao' AND (has_role(auth.uid(), 'admin') OR storage_path_empresa(name) = get_user_empresa(auth.uid())));

-- A trava de imutabilidade tinha o mesmo problema: bloqueava 'financeiro' de
-- validar/concluir uma NF 'enviada' — justamente a ação que é o trabalho do
-- Financeiro nessa etapa (useValidarNfEmissao).
CREATE OR REPLACE FUNCTION public.nf_emissao_guard_enviada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_status public.nf_emissao_status;
  v_only_pagamento boolean := false;
  v_campos_livres text[] := ARRAY[
    'data_pagamento', 'valor_pago',
    'situacao_site_pmt', 'situacao_dominio',
    'desconto_conta_vinculada', 'recebimento_extra', 'falta_receber', 'pago_a_mais',
    'updated_at'
  ];
BEGIN
  v_old_status := OLD.status;

  IF TG_OP = 'UPDATE' AND v_old_status = 'concluida' THEN
    v_only_pagamento := (to_jsonb(OLD) - v_campos_livres) = (to_jsonb(NEW) - v_campos_livres);
  END IF;

  IF v_old_status IN ('concluida', 'cancelada') AND NOT v_only_pagamento AND NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Esta NF já foi % pelo Financeiro e não pode mais ser alterada.', v_old_status;
  END IF;

  IF v_old_status = 'enviada' AND NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'financeiro')) THEN
    RAISE EXCEPTION 'Esta NF já foi enviada para o Financeiro e não pode mais ser alterada. Qualquer correção deve ser feita diretamente com o setor.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
