-- =========================================================================
-- SISTEMAS › HORA EXTRA — "Adicionar chamado" com mais informação
-- (26/10/2026)
--
-- PEDIDO (Pablo): "na hora de adicionar o chamado deixa ver mais
-- informações como quem solicitou". A janela só mostrava número, assunto e
-- setor. hora_extra_chamados_disponiveis passa a devolver também quem abriu
-- (solicitante_nome), o status, quando foi aberto, o prazo previsto, o
-- módulo do sistema, o tipo da solicitação e o começo da descrição.
--
-- A REGRA DE QUEM VÊ NÃO MUDA (mig 20261019000013): só os chamados de quem
-- faz a HE, e quem não aprova só monta a própria. Mudar as colunas de
-- retorno exige DROP + CREATE (CREATE OR REPLACE não troca o RETURNS TABLE);
-- os GRANTs voltam iguais.
--
-- Na mesma conversa: "cada um vê as suas solicitações, só quem aprova vê
-- todas" — isso JÁ é a regra do banco desde a mig 20260930000162 (policy
-- hora_extra_solicitacao_select: colaborador_id = auth.uid() OR aprovar;
-- stats, dashboard, chamados e anexos com o mesmo filtro). Nada a mudar aqui.
-- =========================================================================

DROP FUNCTION IF EXISTS public.hora_extra_chamados_disponiveis(uuid, date);

CREATE FUNCTION public.hora_extra_chamados_disponiveis(p_colaborador uuid DEFAULT auth.uid(), p_concluidos_desde date DEFAULT NULL::date)
RETURNS TABLE(
  id uuid, numero text, assunto text, prioridade text, setor text, responsavel_id uuid, responsavel_nome text,
  solicitante_nome text, status text, aberto_em timestamptz, prazo_previsto date,
  modulo_sistema text, tipo_solicitacao text, descricao text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.numero, c.assunto, c.prioridade, c.setor, c.responsavel_id, p.display_name,
         COALESCE(NULLIF(btrim(c.solicitante_nome), ''), ps.display_name, ps.email),
         c.status, c.created_at, c.prazo_previsto::date,
         COALESCE(NULLIF(btrim(c.modulo_sistema_outro), ''), c.modulo_sistema::text),
         c.tipo_solicitacao::text,
         left(regexp_replace(COALESCE(c.descricao, ''), '\s+', ' ', 'g'), 400)
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles p  ON p.id  = c.responsavel_id
    LEFT JOIN public.profiles ps ON ps.id = c.solicitante_id
   WHERE (
       c.status IN ('aberto', 'em_andamento', 'aguardando_retorno')
       OR (p_concluidos_desde IS NOT NULL AND c.status = 'concluido' AND c.concluido_em >= p_concluidos_desde)
     )
     AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
     -- Só os chamados de quem faz a HE. Quem não aprova só monta a própria.
     AND c.responsavel_id = coalesce(p_colaborador, auth.uid())
     AND (public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar') OR c.responsavel_id = auth.uid())
   ORDER BY c.numero DESC
$$;

REVOKE ALL ON FUNCTION public.hora_extra_chamados_disponiveis(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_chamados_disponiveis(uuid, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.hora_extra_chamados_disponiveis(uuid, date);
-- e reaplicar a função da mig 20261019000013_he_chamados_so_do_colaborador_no_cluster.sql.
