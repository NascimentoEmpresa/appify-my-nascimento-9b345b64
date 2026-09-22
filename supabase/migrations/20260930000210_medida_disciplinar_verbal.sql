-- =========================================================================
-- Solicitar Medida Disciplinar: advertência VERBAL registrada e consultada
--
-- Pedido do Pablo em 22/09/2026: "muda o nome pra Solicitar Medida
-- Disciplinar; ao clicar aparece um card com as opções: REGISTRAR
-- ADVERTÊNCIA VERBAL / Solicitar advertência escrita / Solicitar justa
-- causa... A verbal é só um registro no histórico do colaborador, pro
-- jurídico ver e pra informar nas próximas advertências. Na escrita,
-- verificar se o colaborador já tem verbal".
--
-- A verbal entra na MESMA tabela das outras (SISTEMA_SOLICITACOES_ADVERTENCIA),
-- com tipo_advertencia = 'Verbal' e status = 'Registrada':
--   • já aparece na ficha do colaborador (esp_col_historico lê essa tabela);
--   • o Jurídico vê na tela de Advertências, numa aba própria;
--   • NÃO entra em fila de aprovação nenhuma (as filas são por status) e não
--     bloqueia outra solicitação (solicitacao_em_aberto só olha os dois
--     status de espera).
-- Nada de coluna nova: a tabela não tem CHECK de tipo nem de status.
--
-- adv_verbais_colaborador(): quem solicita a medida quase nunca tem o menu
-- 'advertencias' (a policy de SELECT é dele, do próprio solicitante ou do
-- analista do contrato), então não conseguiria descobrir se existe verbal de
-- outra pessoa. Esta função responde isso com o mínimo: quantas, a data da
-- última e quem registrou. A DESCRIÇÃO do ocorrido só sai para quem já podia
-- ler a advertência (menu 'advertencias' ou quem registrou) — é relato de
-- conduta, não é para circular.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.adv_verbais_colaborador(p_colaborador_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_privilegiado boolean;
  v_email text := auth.email();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema para consultar.'; END IF;
  IF p_colaborador_id IS NULL THEN RETURN jsonb_build_object('total', 0, 'lista', '[]'::jsonb); END IF;
  v_privilegiado := has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao);

  RETURN (
    SELECT jsonb_build_object(
      'total', count(*),
      'lista', coalesce(jsonb_agg(jsonb_build_object(
                 'id', a.id,
                 'data_ocorrido', a.data_ocorrido,
                 'created_at', a.created_at,
                 'solicitante_nome', a.solicitante_nome,
                 'minha', a.solicitante_email IS NOT DISTINCT FROM v_email,
                 'descricao_ocorrido', CASE WHEN v_privilegiado OR a.solicitante_email IS NOT DISTINCT FROM v_email
                                            THEN a.descricao_ocorrido END)
                 ORDER BY coalesce(a.data_ocorrido, a.created_at::date) DESC, a.id DESC), '[]'::jsonb))
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
     WHERE a.colaborador_id = p_colaborador_id
       AND a.tipo_advertencia = 'Verbal');
END $fn$;
REVOKE ALL ON FUNCTION public.adv_verbais_colaborador(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adv_verbais_colaborador(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.adv_verbais_colaborador(bigint);
-- (as verbais gravadas ficam: DELETE FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" WHERE tipo_advertencia = 'Verbal';)
