-- =====================================================================
-- Controle de Diárias — mostrar "Paga" quando a despesa do Malote foi paga.
--
-- Relato do usuário: a despesa DM-2026-0579 (nascida da SD-2026-000026)
-- já estava "Despesa paga" em /app/malote/aprovacoes, mas em
-- /app/encarregados/diarias a solicitação continuava "Aprovada".
--
-- Causa: "DIARIA_SOLICITACAO".status só conhece solicitada/aprovada/
-- reprovada. A aprovação cria a despesa (diaria_aprovar_com_despesa) e daí
-- em diante o pagamento acontece só em malote_despesa — nada volta para a
-- diária.
--
-- Correção: campo computado do PostgREST, NÃO um status novo gravado.
--   - Gravar 'paga' na diária exigiria mexer no diaria_guard() (que proíbe
--     redecidir) e numa trigger em malote_despesa para manter os dois em
--     sincronia — e o estorno/exclusão da despesa teria de desfazer isso.
--   - Derivado na leitura, a diária mostra sempre o estado real da despesa,
--     inclusive se o pagamento for desfeito.
--
-- O front pede `malote_despesa_paga` no mesmo select de DIARIA_SOLICITACAO
-- (src/hooks/useDiarias.ts). SECURITY DEFINER porque quem enxerga as
-- diárias normalmente NÃO tem leitura em malote_despesa (é da
-- Controladoria) — e a função só devolve um booleano, nunca dados da
-- despesa. Quem vê a linha da diária continua decidido pela RLS de
-- DIARIA_SOLICITACAO.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.malote_despesa_paga(s public."DIARIA_SOLICITACAO")
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT d.status = 'despesa_paga'
       FROM public.malote_despesa d
      WHERE d.id = s.malote_despesa_id),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_paga(public."DIARIA_SOLICITACAO") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_despesa_paga(public."DIARIA_SOLICITACAO") TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.malote_despesa_paga(public."DIARIA_SOLICITACAO");
-- NOTIFY pgrst, 'reload schema';
