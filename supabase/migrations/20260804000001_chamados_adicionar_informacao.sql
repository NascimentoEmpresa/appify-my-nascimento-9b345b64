-- =====================================================================
-- CHAMADOS DE SISTEMAS — solicitante responde ao "Solicitar mais informações".
--
-- Quando o desenvolvedor clica em "Solicitar mais informações", o chamado vai
-- para 'aguardando_retorno'. O solicitante então precisa poder ADICIONAR novas
-- informações, que:
--   (1) entram no histórico (CHAMADO_SISTEMA_EVENTO, com data/hora automáticas),
--   (2) devolvem o chamado ao time (status volta a 'em_andamento').
--
-- A RLS não deixa o solicitante alterar o status do chamado (só gestor/dev), e
-- só permite inserir eventos do tipo 'comentario'. Por isso as duas ações são
-- feitas juntas nesta RPC SECURITY DEFINER — que valida ser o próprio
-- solicitante antes de gravar.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamado_adicionar_informacao(
  p_chamado_id uuid,
  p_texto      text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_responsavel uuid;
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'Informe o texto com as informações.';
  END IF;

  SELECT solicitante_id, status, responsavel_id
    INTO v_solicitante, v_status, v_responsavel
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante <> auth.uid() THEN
    RAISE EXCEPTION 'Apenas o solicitante pode adicionar informações a este chamado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível adicionar informações.';
  END IF;

  -- (1) histórico: visível ao solicitante, ao responsável e à gestão.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'comentario', btrim(p_texto));

  -- (2) devolve ao time quando estava aguardando o retorno do solicitante.
  IF v_status = 'aguardando_retorno' THEN
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_adicionar_informacao(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
