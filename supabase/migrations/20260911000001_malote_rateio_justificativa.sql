-- SIS-2026-0192: cada linha do Rateio pode precisar de justificativa
-- quando o % dessa linha sobre o Orçado da Classificação/Contrato passa do
-- limite_justificativa_pct (cadastrado desde SIS-2026-0106, ainda sem
-- enforcement — só o cálculo de exibição "Pendente/N/A" entra aqui; quem
-- efetivamente pode escrever a justificativa por enquanto é qualquer
-- aprovador/supervisor/admin da despesa, não só o Analista vinculado ao
-- contrato (SIS-2026-0170) — isso fica pra quando o vínculo virar
-- obrigatório, é só um passo a mais depois).
alter table public.malote_despesa_rateio_linha
  add column if not exists justificativa_texto text,
  add column if not exists justificativa_por uuid references auth.users(id),
  add column if not exists justificativa_em timestamptz;

CREATE OR REPLACE FUNCTION public.malote_justificar_rateio_linha(_linha_id uuid, _texto text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_despesa_id uuid;
BEGIN
  SELECT despesa_id INTO v_despesa_id FROM public.malote_despesa_rateio_linha WHERE id = _linha_id;
  IF v_despesa_id IS NULL THEN RAISE EXCEPTION 'Linha de rateio não encontrada.'; END IF;
  IF _texto IS NULL OR btrim(_texto) = '' THEN RAISE EXCEPTION 'Justificativa não pode ser vazia.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_configurado(v_despesa_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
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

REVOKE ALL ON FUNCTION public.malote_justificar_rateio_linha(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_justificar_rateio_linha(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.malote_justificar_rateio_linha(uuid, text);
--   ALTER TABLE public.malote_despesa_rateio_linha
--     DROP COLUMN IF EXISTS justificativa_texto,
--     DROP COLUMN IF EXISTS justificativa_por,
--     DROP COLUMN IF EXISTS justificativa_em;
