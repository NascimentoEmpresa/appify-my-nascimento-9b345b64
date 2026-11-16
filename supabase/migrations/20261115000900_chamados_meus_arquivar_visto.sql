-- =====================================================================
-- CHAMADOS — "Meus chamados" mostra só o que tem pendência (13/11/2026)
--
-- POR QUE
-- Solicitante reclamou: os chamados concluídos e avaliados continuavam na
-- lista principal, poluíam a tela e escondiam o que estava pendente (risco de
-- abrir chamado em duplicidade). Agora a tela padrão esconde os encerrados e
-- o Pablo pediu: "os com mensagem reaparecem; se marcar como visto, arquiva de
-- novo, ou se abrir a mensagem e ver, arquiva de novo, a não ser que envie uma
-- mensagem".
--
-- A regra de quem aparece fica no front (src/pages/chamados/listaSolicitante.ts,
-- com teste). Aqui só o que o front não tem como saber sozinho:
--   1. CHAMADO_SISTEMA_LEITURA.visto_em — "Marcar como visto" do solicitante.
--      Separado de lido_em porque o chat carimba lido_em a cada abertura,
--      inclusive logo depois de a pessoa responder; com um carimbo só, quem
--      respondeu sumiria da lista na mesma hora.
--   2. chamado_marcar_visto() — carimba lido_em E visto_em (zera a bolinha e
--      arquiva de novo).
--   3. chamados_meus_conversa() — por chamado MEU: minha última mensagem, a
--      última dos outros e o visto_em. UMA consulta para a lista inteira.
--
-- Mensagem = mesma definição de chamados_nao_lidos (mig 20260831000002):
-- só 'comentario' de gente (sem meta->>'canal'); o solicitante não enxerga
-- observacao_interna, então ela nem entra na conta.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── 1. Carimbo de "visto" ───────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_LEITURA"
  ADD COLUMN IF NOT EXISTS visto_em timestamptz;

COMMENT ON COLUMN public."CHAMADO_SISTEMA_LEITURA".visto_em IS
  'Quando o solicitante clicou em "Marcar como visto" na lista Meus chamados. Chamado encerrado só volta à lista padrão com mensagem nova, ou se a última mensagem for dele e posterior a este carimbo.';

-- ── 2. Marcar como visto ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_marcar_visto(p_chamado_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_agora timestamptz := now();
BEGIN
  IF NOT public.chamado_pode_conversar(p_chamado_id) THEN
    RAISE EXCEPTION 'Sem acesso a este chamado.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em, visto_em)
  VALUES (p_chamado_id, auth.uid(), v_agora, v_agora)
  ON CONFLICT (chamado_id, user_id)
  -- lido_em só avança (mesma regra de chamado_marcar_lido).
  DO UPDATE SET lido_em  = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em),
                visto_em = EXCLUDED.visto_em;

  RETURN v_agora;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_marcar_visto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_marcar_visto(uuid) TO authenticated;

COMMENT ON FUNCTION public.chamado_marcar_visto(uuid) IS
  'Solicitante tira o chamado encerrado da lista padrão de Meus chamados (carimba lido_em e visto_em).';

-- ── 3. Estado da conversa dos MEUS chamados ─────────────────────────
CREATE OR REPLACE FUNCTION public.chamados_meus_conversa()
RETURNS TABLE(
  chamado_id       uuid,
  ultima_minha_em  timestamptz,
  ultima_outros_em timestamptz,
  visto_em         timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id,
         max(e.created_at) FILTER (WHERE e.autor_id = auth.uid()),
         max(e.created_at) FILTER (WHERE e.autor_id IS DISTINCT FROM auth.uid()),
         l.visto_em
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public."CHAMADO_SISTEMA_EVENTO" e
           ON e.chamado_id = c.id
          AND e.tipo = 'comentario'
          AND (e.meta->>'canal') IS NULL
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = c.id AND l.user_id = auth.uid()
   WHERE c.solicitante_id = auth.uid()
   GROUP BY c.id, l.visto_em
  HAVING count(e.id) > 0 OR l.visto_em IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_conversa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_meus_conversa() TO authenticated;

COMMENT ON FUNCTION public.chamados_meus_conversa() IS
  'Por chamado do solicitante: última mensagem dele, última dos outros e o carimbo de "visto" — decide se o encerrado reaparece em Meus chamados.';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamados_meus_conversa();
--   DROP FUNCTION IF EXISTS public.chamado_marcar_visto(uuid);
--   ALTER TABLE public."CHAMADO_SISTEMA_LEITURA" DROP COLUMN IF EXISTS visto_em;
-- =====================================================================
