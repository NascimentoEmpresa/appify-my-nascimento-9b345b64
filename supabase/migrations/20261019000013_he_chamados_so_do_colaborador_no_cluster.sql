-- =========================================================================
-- HORA EXTRA: "ADICIONAR CHAMADO" SÓ COM OS CHAMADOS DO COLABORADOR,
-- AGORA NO CLUSTER (19/10/2026)
--
-- Pablo (19/10): "tá aparecendo os outros responsáveis em vez de só as
-- minhas ainda, tava ajustado isso mas voltou". Estava ajustado: a mig
-- 20261014000018 resolveu isso em 14/10. Só que ela foi aplicada à mão na
-- Supabase antiga, e a replicação lógica que montou o cluster
-- (api.grpnascimento.com.br) traz LINHAS, não FUNÇÕES. Na virada (16/10) o
-- cluster ficou com a versão de setembro (mig 20260930000162), que mostra a
-- quem tem "aprovar" TODOS os chamados abertos. Conferido no cluster em 19/10:
-- com p_colaborador = Pablo vinham 31 chamados de 4 responsáveis (Pablo, João
-- Victor, Iury, Eduardo). É a mesma causa da TV Licitação (mig 20261019000005).
--
-- Corpo idêntico ao da 20261014000018: só os chamados cujo responsável é o
-- colaborador da HE. Quando o gestor monta a HE de outra pessoa, aparecem os
-- chamados DELA. Quem não aprova continua só podendo montar a própria.
--
-- Idempotente.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.hora_extra_chamados_disponiveis(p_colaborador uuid DEFAULT auth.uid(), p_concluidos_desde date DEFAULT NULL::date)
RETURNS TABLE(id uuid, numero text, assunto text, prioridade text, setor text, responsavel_id uuid, responsavel_nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.numero, c.assunto, c.prioridade, c.setor, c.responsavel_id, p.display_name
    FROM public."CHAMADO_SISTEMA" c
    LEFT JOIN public.profiles p ON p.id = c.responsavel_id
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
-- Reaplicar hora_extra_chamados_disponiveis da 20260930000162 (todos os
-- chamados abertos para quem aprova; os do colaborador primeiro na ordem).
