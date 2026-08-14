-- =========================================================================
-- CONCLUSÃO AUTOMÁTICA DO CHAMADO NO MERGE DA PR
-- Libera a troca de status para automação de servidor (service_role).
--
-- Problema: o trigger chamado_sistema_guard() decide quem pode mexer no
-- chamado a partir de auth.uid(). A edge function chamado-concluir-pr é
-- chamada pelo GitHub Actions no merge da PR — roda com service_role e sem
-- usuário logado, então auth.uid() é NULL, v_coord/v_aprov/v_resp ficam todos
-- falsos e o UPDATE de status morria com:
--   "Sem permissão para alterar o status do chamado."
--
-- service_role ignora RLS, mas NÃO ignora trigger — por isso o bloqueio
-- acontecia mesmo com a chave de serviço.
--
-- Por que liberar é seguro: quem tem a service_role já pode alterar qualquer
-- linha, desabilitar o trigger ou o próprio RLS. A checagem existe para
-- proteger o usuário logado, não para conter o servidor. A liberação vale só
-- para a troca de status, que é o que a automação faz — os guards de campos de
-- abertura, coordenação e reprovação seguem valendo para todo mundo.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  v_coord boolean := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov boolean := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  boolean := COALESCE(OLD.responsavel_id = auth.uid(), false);
BEGIN
  -- Campos de abertura + coordenação só mudam com "coordenar".
  IF NOT v_coord THEN
    IF NEW.assunto              IS DISTINCT FROM OLD.assunto
    OR NEW.categorias           IS DISTINCT FROM OLD.categorias
    OR NEW.tipo_solicitacao     IS DISTINCT FROM OLD.tipo_solicitacao
    OR NEW.prioridade           IS DISTINCT FROM OLD.prioridade
    OR NEW.descricao            IS DISTINCT FROM OLD.descricao
    OR NEW.impacto_trabalho     IS DISTINCT FROM OLD.impacto_trabalho
    OR NEW.urgencia             IS DISTINCT FROM OLD.urgencia
    OR NEW.modulo_sistema       IS DISTINCT FROM OLD.modulo_sistema
    OR NEW.modulo_sistema_outro IS DISTINCT FROM OLD.modulo_sistema_outro
    OR NEW.afeta_usuarios       IS DISTINCT FROM OLD.afeta_usuarios
    OR NEW.solicitante_id       IS DISTINCT FROM OLD.solicitante_id
    OR NEW.solicitante_nome     IS DISTINCT FROM OLD.solicitante_nome
    OR NEW.setor                IS DISTINCT FROM OLD.setor
    OR NEW.responsavel_id       IS DISTINCT FROM OLD.responsavel_id
    OR NEW.observacao_gerente   IS DISTINCT FROM OLD.observacao_gerente
    OR NEW.comentario_gerente   IS DISTINCT FROM OLD.comentario_gerente THEN
      RAISE EXCEPTION 'Sem permissão para coordenar/editar este chamado.';
    END IF;
  END IF;

  -- Reprovar/motivo só com "aprovar".
  IF (NEW.status = 'reprovado' AND OLD.status <> 'reprovado') AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;
  IF NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao AND NOT v_aprov THEN
    RAISE EXCEPTION 'Sem permissão para reprovar chamados.';
  END IF;

  -- Demais mudanças de status: coordenar, aprovar, o dev responsável OU a
  -- automação de servidor (conclusão no merge da PR).
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  RETURN NEW;
END;
$$;

-- ROLLBACK
--   Recriar chamado_sistema_guard() sem o v_auto, exatamente como está em
--   20260802000002_chamados_sistemas_permissoes.sql (linhas 145-192).
