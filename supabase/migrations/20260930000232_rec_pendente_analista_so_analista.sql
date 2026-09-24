-- =========================================================================
-- Recrutamento: só o ANALISTA decide o "Pendente Analista".
--
-- Pedido do Pablo (24/09/2026): "na tela de gestão recrutamento não pode
-- aprovar o pendente analista". A tela já não mostra o botão (só os escopos
-- analista/diretoria têm `podeAprovarAnalista`), mas o banco aceitava a
-- mudança de status de qualquer "gestor" (sistema_recrutamento_guard), e a
-- produção roda a main, que ainda não tem todas as travas da tela.
--
-- A regra vai no gatilho que já trava a etapa da Diretoria
-- (rec_guard_aprovador_setor): sair de "Pendente Analista" para aprovação
-- ou reprovação exige 'aprovar' ou 'alterar' em
-- licitacoes_analistas_recrutamento (Licitações › Analistas Validações).
-- Continuam livres: ir para "Pendente Diretoria" (a vaga virou
-- administrativa na edição) e "Cancelada". Sem usuário (gatilhos/serviço)
-- não se aplica.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'Pendente Diretoria'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova vagas do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  -- 24/09/2026: a etapa do analista é só do analista.
  IF OLD.status = 'Pendente Analista'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('Pendente Diretoria', 'Cancelada')
     AND NOT (public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar')
              OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')) THEN
    RAISE EXCEPTION 'Quem aprova ou reprova o "Pendente Analista" é o analista (Licitações › Analistas Validações).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.rec_guard_aprovador_setor() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar rec_guard_aprovador_setor sem o bloco "Pendente Analista"
-- (só a checagem de setor da Diretoria).
-- NOTIFY pgrst, 'reload schema';
