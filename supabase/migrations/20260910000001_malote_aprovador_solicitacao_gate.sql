-- SIS-2026-0189: as 4 RPCs da fase de Solicitação (aprovar/reprovar
-- inicial, aprovar/reprovar cotação) estavam checando
-- malote_sou_aprovador_configurado, que valida aprovador1/2/3 — o
-- aprovador da DESPESA (N1/N2/N3), cadastro diferente do "Aprovador da
-- solicitação" (aprovador_solicitacao_user_id, cadastrado desde
-- SIS-2026-0106 e nunca antes consumido em lugar nenhum). Na prática só
-- funcionava quando a mesma pessoa também estava configurada como
-- aprovador1 da classificação.
CREATE OR REPLACE FUNCTION public.malote_sou_aprovador_solicitacao(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa d
    JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    WHERE d.id = _despesa_id
      AND c.aprovador_solicitacao_user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.malote_aprovar_solicitacao_inicial(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'aguardando_aprovacao_inicial' THEN RAISE EXCEPTION 'Solicitação não está aguardando aprovação inicial.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar esta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'aguardando_cotacao' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id)
  VALUES (_id, 'solicitacao_aprovada', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_solicitacao_inicial(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status NOT IN ('aguardando_aprovacao_inicial', 'aguardando_cotacao') THEN
    RAISE EXCEPTION 'Solicitação não pode ser reprovada neste status.';
  END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para reprovar esta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'solicitacao_reprovada' WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'solicitacao_reprovada', _motivo, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_aprovar_cotacao(_id uuid, _numero smallint, _valor numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'cotacao_realizada' THEN RAISE EXCEPTION 'Cotação não está pronta pra decisão.'; END IF;
  IF _numero NOT IN (1, 2, 3) THEN RAISE EXCEPTION 'Cotação inválida.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET
    status = 'cotacao_aprovada',
    cotacao_vencedor_num = _numero,
    cotacao_decidida_em = now(),
    cotacao_decidida_por = auth.uid(),
    valor_aprovado_cotacao = _valor
  WHERE id = _id;

  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id)
  VALUES (_id, 'cotacao_aprovada', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_reprovar_cotacao(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.malote_despesa WHERE id = _id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_status <> 'cotacao_realizada' THEN RAISE EXCEPTION 'Cotação não está pronta pra decisão.'; END IF;
  IF _motivo IS NULL OR btrim(_motivo) = '' THEN RAISE EXCEPTION 'Motivo é obrigatório.'; END IF;

  IF NOT (
    public.malote_pode('aprovar')
    AND (public.malote_sou_aprovador_solicitacao(_id, auth.uid())
         OR public.malote_supervisor_por_cargo(auth.uid())
         OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para decidir a cotação desta solicitação.';
  END IF;

  UPDATE public.malote_despesa SET status = 'solicitacao_reprovada', cotacao_reprovada_motivo = _motivo WHERE id = _id;
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, descricao, ator_user_id)
  VALUES (_id, 'solicitacao_reprovada', _motivo, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.malote_sou_aprovador_solicitacao(uuid, uuid) FROM public, anon;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reverter as 4 funções pro CREATE OR REPLACE anterior (usando
--   malote_sou_aprovador_configurado) em
--   20260906000002_malote_permissoes_aprovacao.sql, e:
--   DROP FUNCTION IF EXISTS public.malote_sou_aprovador_solicitacao(uuid, uuid);
