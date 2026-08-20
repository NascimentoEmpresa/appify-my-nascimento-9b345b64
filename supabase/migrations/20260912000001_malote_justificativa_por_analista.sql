-- SIS-2026-0192 (refinamento): quem justifica uma linha do Rateio que
-- passou do limite_justificativa_pct é o Analista vinculado ao Contrato
-- daquela linha (SIS-2026-0170), não qualquer aprovador. malote_analista_
-- contrato tem SELECT restrito a admin/controladoria/diretor_adm, então um
-- Analista comum não consegue ler a própria linha de vínculo direto — daí
-- as duas funções SECURITY DEFINER abaixo, chamadas pelo client e pela RPC
-- de gravação.
--
-- Mantemos aprovador/supervisor/admin como fallback (não removemos o
-- acesso deles) pra não travar despesas cujo contrato ainda não tem
-- Analista vinculado.
CREATE OR REPLACE FUNCTION public.malote_sou_analista_do_contrato(_contrato_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_analista_contrato ac
    WHERE ac.contrato_id = _contrato_id
      AND ac.analista_user_id = _user_id
      AND ac.ativo
  );
$$;

-- Lista os contrato_id em que o usuário logado é Analista ativo — usada
-- pelo client pra decidir, linha a linha do Rateio, se mostra o lápis de
-- justificar (sem precisar de acesso direto a malote_analista_contrato).
CREATE OR REPLACE FUNCTION public.malote_meus_contratos_analista()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT contrato_id FROM public.malote_analista_contrato
  WHERE analista_user_id = auth.uid() AND ativo;
$$;

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
    public.malote_pode('aprovar')
    AND (
      (v_contrato_id IS NOT NULL AND public.malote_sou_analista_do_contrato(v_contrato_id, auth.uid()))
      OR public.malote_sou_aprovador_configurado(v_despesa_id, auth.uid())
      OR public.malote_supervisor_por_cargo(auth.uid())
      OR public.has_role(auth.uid(), 'admin')
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

REVOKE ALL ON FUNCTION public.malote_sou_analista_do_contrato(uuid, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.malote_meus_contratos_analista() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_meus_contratos_analista() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter malote_justificar_rateio_linha pro CREATE OR REPLACE anterior
--   em 20260911000001_malote_rateio_justificativa.sql, e:
--   DROP FUNCTION IF EXISTS public.malote_sou_analista_do_contrato(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.malote_meus_contratos_analista();
