-- =========================================================================
-- HORA EXTRA: "ADICIONAR CHAMADO" SÓ COM OS CHAMADOS DO COLABORADOR (14/10/2026)
--
-- PEDIDO (Pablo, Nova Solicitação de Hora Extra › Adicionar chamado):
-- "ajusta pra aparecer só os meus chamados — eu, Pablo, estou solicitando
-- H.E, então tem que aparecer apenas os chamados que são pra mim".
--
-- ANTES: quem tem "aprovar" na Hora Extra via TODOS os chamados abertos
-- (inclusive "Não designado" e de outros setores); o do colaborador só vinha
-- primeiro na ordem. AGORA: só os chamados cujo responsável é o colaborador
-- da HE (p_colaborador) — inclusive quando o gestor monta a HE de outra
-- pessoa: aparecem os chamados DELA. Quem não aprova continua só podendo
-- montar a própria (p_colaborador = ele mesmo).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar a versão anterior (todos os chamados abertos para quem aprova; os
-- do colaborador primeiro na ordem).
