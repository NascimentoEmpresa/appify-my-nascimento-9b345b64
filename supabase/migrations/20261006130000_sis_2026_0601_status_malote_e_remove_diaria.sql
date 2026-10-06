-- ============================================================================
-- SIS-2026-0601 — refletir o status do Malote nas solicitações de diárias e
-- liberar o relançamento da SD-2026-000078 cancelada.
--
-- A diária armazenava apenas o próprio status "aprovada" e consultava um
-- booleano específico para pagamento. Assim, cancelamento e todas as etapas
-- intermediárias do Malote continuavam aparecendo como "Aprovada".
--
-- `diaria_malote_status()` é uma computed relationship do PostgREST: devolve
-- o status atual sem duplicá-lo em DIARIA_SOLICITACAO. SECURITY DEFINER é
-- necessário porque usuários do Operacional não têm, em geral, SELECT direto
-- em malote_despesa; a função expõe somente o status do vínculo já visível.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.diaria_malote_status(s public."DIARIA_SOLICITACAO")
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.status
    FROM public.malote_despesa d
   WHERE d.id = s.malote_despesa_id
$$;

REVOKE ALL ON FUNCTION public.diaria_malote_status(public."DIARIA_SOLICITACAO")
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_malote_status(public."DIARIA_SOLICITACAO")
  TO authenticated;

-- Correção pontual solicitada no chamado. A exclusão física libera as linhas
-- de escala porque DIARIA_LINHA/ANEXO/EVENTO/VISUALIZACAO têm ON DELETE
-- CASCADE. A despesa cancelada fica preservada no Malote como trilha da ação
-- que já aconteceu lá.
DO $$
DECLARE
  v_solicitacao_id uuid;
  v_malote_id uuid;
  v_malote_status text;
BEGIN
  SELECT s.id, s.malote_despesa_id
    INTO v_solicitacao_id, v_malote_id
    FROM public."DIARIA_SOLICITACAO" s
   WHERE s.numero = 'SD-2026-000078'
   FOR UPDATE;

  IF v_solicitacao_id IS NULL THEN
    RAISE NOTICE 'SIS-2026-0601: SD-2026-000078 já não existe; nenhuma exclusão necessária.';
    RETURN;
  END IF;

  IF v_malote_id IS NULL THEN
    RAISE EXCEPTION
      'SIS-2026-0601: SD-2026-000078 não possui despesa do Malote vinculada; exclusão abortada.';
  END IF;

  SELECT d.status
    INTO v_malote_status
    FROM public.malote_despesa d
   WHERE d.id = v_malote_id;

  IF v_malote_status IS DISTINCT FROM 'cancelada' THEN
    RAISE EXCEPTION
      'SIS-2026-0601: despesa % vinculada à SD-2026-000078 está com status %, não cancelada; exclusão abortada.',
      v_malote_id,
      COALESCE(v_malote_status, '<não encontrada>');
  END IF;

  DELETE FROM public."DIARIA_SOLICITACAO"
   WHERE id = v_solicitacao_id;

  RAISE NOTICE
    'SIS-2026-0601: SD-2026-000078 removida; despesa cancelada % preservada no Malote.',
    v_malote_id;
END
$$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- A exclusão pontual da SD-2026-000078 não é reversível por SQL: restaurá-la
-- exigiria os dados completos do backup. Para remover apenas a computed field:
-- DROP FUNCTION IF EXISTS public.diaria_malote_status(public."DIARIA_SOLICITACAO");
-- NOTIFY pgrst, 'reload schema';
