-- =====================================================================
-- CHAMADOS — quantas mensagens não lidas em cada chamado
--
-- POR QUE
-- A conversa virou o canal principal do chamado (20260831000001), mas as
-- listas ("Meus chamados", "Painel do Desenvolvedor") não davam sinal de que
-- alguém tinha escrito: era preciso abrir chamado por chamado pra descobrir.
-- Esta função alimenta a bolinha vermelha do botão "Chat" na lista.
--
-- O QUE CONTA como não lida
--   · só MENSAGEM DE GENTE — mudança de status e log de robô (meta->>'canal')
--     não acendem a bolinha, senão ela vive acesa por barulho de sistema;
--   · não conta o que a própria pessoa escreveu;
--   · mensagem interna só conta pra quem enxerga interno (responsável/gestão) —
--     o solicitante não pode nem saber que ela existe;
--   · "não lida" = created_at depois do carimbo em CHAMADO_SISTEMA_LEITURA
--     (sem carimbo = nunca abriu = tudo não lido).
--
-- Idempotente.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chamados_nao_lidos()
RETURNS TABLE(
  chamado_id uuid,
  nao_lidos  integer,
  ultima_em  timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH eu AS (
    SELECT auth.uid() AS uid, public.chamado_sistema_gestor() AS gestor
  ),
  meus AS (
    -- Chamados em que EU participo. Gestão vê os que coordena/acompanha, mas
    -- só os que já têm conversa — a bolinha é sobre mensagem, não sobre fila.
    SELECT c.id, c.responsavel_id
      FROM public."CHAMADO_SISTEMA" c, eu
     WHERE c.solicitante_id = eu.uid
        OR c.responsavel_id = eu.uid
        OR eu.gestor
  )
  SELECT m.id,
         count(e.id)::int,
         max(e.created_at)
    FROM meus m
    CROSS JOIN eu
    JOIN public."CHAMADO_SISTEMA_EVENTO" e ON e.chamado_id = m.id
    LEFT JOIN public."CHAMADO_SISTEMA_LEITURA" l
           ON l.chamado_id = m.id AND l.user_id = eu.uid
   WHERE e.autor_id IS DISTINCT FROM eu.uid
     AND e.tipo IN ('comentario', 'observacao_interna')
     AND (e.meta->>'canal') IS NULL
     AND (e.tipo <> 'observacao_interna' OR m.responsavel_id = eu.uid OR eu.gestor)
     AND (l.lido_em IS NULL OR e.created_at > l.lido_em)
   GROUP BY m.id
  HAVING count(e.id) > 0;
$$;
REVOKE ALL ON FUNCTION public.chamados_nao_lidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamados_nao_lidos() TO authenticated;

COMMENT ON FUNCTION public.chamados_nao_lidos() IS
  'Mensagens não lidas por chamado, para a bolinha vermelha do botão Chat nas listas.';

-- Sem este índice a contagem varre os eventos do chamado inteiro a cada carga
-- da lista, e a tela tem que abrir instantânea.
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_evento_chamado_data
  ON public."CHAMADO_SISTEMA_EVENTO"(chamado_id, created_at DESC);

-- ── Conferência ──────────────────────────────────────────────────────
SELECT count(*) AS eventos FROM public."CHAMADO_SISTEMA_EVENTO";

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.chamados_nao_lidos();
--   DROP INDEX IF EXISTS public.idx_chamado_sistema_evento_chamado_data;
-- =====================================================================
