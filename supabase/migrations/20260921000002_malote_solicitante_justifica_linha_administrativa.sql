-- SIS-2026-0212 (complemento, pedido do Iury): em despesas administrativas
-- (linha de rateio sem contrato) não existe "Analista vinculado" — esse
-- conceito só se aplica a contrato (malote_sou_analista_do_contrato). Até
-- aqui, só quem tinha a ação "aprovar" no Malote (aprovador configurado/
-- supervisor/admin) conseguia justificar o estouro dessas linhas — o
-- próprio solicitante nunca conseguia, mesmo sendo o único "dono" natural
-- da despesa administrativa.
--
-- Adiciona uma segunda via de permissão: linha sem contrato E o usuário é
-- quem criou a despesa. Não depende de malote_pode('aprovar') — justificar
-- a própria despesa administrativa não é uma ação de aprovação.
CREATE OR REPLACE FUNCTION public.malote_justificar_rateio_linha(_linha_id uuid, _texto text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despesa_id uuid;
  v_contrato_id uuid;
BEGIN
  SELECT despesa_id, contrato_id INTO v_despesa_id, v_contrato_id
  FROM public.malote_despesa_rateio_linha WHERE id = _linha_id;
  IF v_despesa_id IS NULL THEN RAISE EXCEPTION 'Linha de rateio não encontrada.'; END IF;
  IF _texto IS NULL OR btrim(_texto) = '' THEN RAISE EXCEPTION 'Justificativa não pode ser vazia.'; END IF;

  IF NOT (
    (
      public.malote_pode('aprovar')
      AND (
        (v_contrato_id IS NOT NULL AND public.malote_sou_analista_do_contrato(v_contrato_id, auth.uid()))
        OR public.malote_sou_aprovador_configurado(v_despesa_id, auth.uid())
        OR public.malote_supervisor_por_cargo(auth.uid())
        OR public.has_role(auth.uid(), 'admin')
      )
    )
    OR (
      v_contrato_id IS NULL
      AND EXISTS (SELECT 1 FROM public.malote_despesa WHERE id = v_despesa_id AND created_by = auth.uid())
    )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para justificar esta linha.';
  END IF;

  UPDATE public.malote_despesa_rateio_linha SET
    justificativa_texto = btrim(_texto),
    justificativa_por = auth.uid(),
    justificativa_em = now()
  WHERE id = _linha_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter malote_justificar_rateio_linha pro CREATE OR REPLACE anterior,
--   sem a segunda via de permissão (v_contrato_id IS NULL AND created_by).
