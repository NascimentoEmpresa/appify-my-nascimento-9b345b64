-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: "Solicitar mais atualizações" também
-- no chamado concluído que espera o Gestor de Sistemas, e o "Concluir
-- tarefa" passa pela trava de status (18/11/2026)
--
-- O PEDIDO (Pablo, olhando o SIS-2026-0934 em produção, já concluído e
-- confirmado pelo solicitante, esperando "Finalizar chamado"): "em produção
-- não aparece o botão de solicitar mais atualizações pro dev".
--
-- A mig 20261118210000 só deixava devolver o chamado ENTREGUE (parte do dev
-- concluída, status ainda não 'concluido'). Agora também o chamado
-- 'concluido' que o Gestor de Sistemas ainda não finalizou — confirmado ou
-- não pelo solicitante: antes de finalizar, o gestor pode mandar de volta ao
-- dev. Nesse caso o status volta para 'em_andamento' (os gatilhos zeram a
-- confirmação do solicitante e a finalização, como numa reabertura).
--
-- TRAVA DE STATUS (chamado_sistema_guard, corpo da mig 20261112190000):
--   · só coordenar, aprovar, o responsável, automação ou RPC marcada mudam o
--     status. Quem tinha SÓ "Pode concluir chamados" (sistemas_gerente_
--     sistemas, mig 20261118220000) ou o Gestor de Sistemas sem coordenar era
--     barrado no "Concluir tarefa". Agora chamado_gestor_sistemas() pode pôr
--     'concluido' — e só isso;
--   · a devolução de um concluído passa pela marca app.chamado_gestao_rpc,
--     a mesma das decisões de reabertura/transferência do gestor.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Trava de status: o gestor pode concluir ───────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- Faxina de exclusão de usuário (admin_excluir_usuario_completo).
  v_faxina boolean := COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false);
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  -- Solicitante devolvendo/reabrindo (mig 255) ou cancelando (mig 260) o
  -- próprio chamado por RPC.
  v_solic boolean := COALESCE(current_setting('app.chamado_solicitante', true) = 'on', false);
  -- Presidência devolvendo ao desenvolvimento (mig 266).
  v_presid boolean := COALESCE(current_setting('app.chamado_presidencia', true) = 'on', false);
  -- Solicitante reabrindo por "não atendeu o solicitado" (mig 20261112002000):
  -- o chamado volta para a triagem, sem responsável.
  v_triagem boolean := COALESCE(current_setting('app.chamado_reabrir_triagem', true) = 'on', false);
  -- Gestor decidindo reabertura/transferência (mig 20261112190000).
  v_gestao boolean := COALESCE(current_setting('app.chamado_gestao_rpc', true) = 'on', false);
  -- "Pode concluir chamados" / Gestor de Sistemas concluindo a tarefa que o
  -- dev entregou (mig 20261118230000) — só para pôr 'concluido'.
  v_gestor_sis boolean := public.chamado_gestor_sistemas();
  v_coord boolean;
  v_aprov boolean;
  v_resp  boolean;
BEGIN
  -- A faxina não é alguém editando o chamado: é o sistema tirando o nome de
  -- quem saiu da empresa. Nenhum campo de negócio muda — só as colunas que
  -- apontam pro usuário, e por ação de chave estrangeira. Os automatismos de
  -- status continuam valendo.
  IF v_faxina THEN
    IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
    IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
    RETURN NEW;
  END IF;

  v_coord := v_gestao OR public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  := COALESCE(OLD.responsavel_id = auth.uid(), false);

  -- Campos de abertura + coordenação só mudam com "coordenar".
  -- Exceção única: a triagem tira o responsável (vira NULL) e mais nada.
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
    OR (NEW.responsavel_id      IS DISTINCT FROM OLD.responsavel_id
        AND NOT (v_triagem AND NEW.responsavel_id IS NULL))
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
  -- Motivo do cancelamento: só a RPC do solicitante (ou a coordenação).
  IF NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento AND NOT (v_solic OR v_coord) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar este chamado.';
  END IF;

  -- Demais mudanças de status: coordenar, aprovar, o dev responsável, a
  -- automação de servidor (conclusão no merge da PR), o solicitante pelas
  -- RPCs que ligam app.chamado_solicitante — e aí só para voltar à fila
  -- ('aberto' / 'em_andamento') ou cancelar ('cancelado', mig 260) — OU a
  -- Presidência devolvendo ao desenvolvimento (mig 266), só para voltar à
  -- fila. Concluir ou reprovar continua da equipe.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp
       OR (v_solic AND NEW.status IN ('aberto', 'em_andamento', 'cancelado'))
       OR (v_presid AND NEW.status IN ('aberto', 'em_andamento'))
       OR (v_gestor_sis AND NEW.status = 'concluido')) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  IF NEW.status = 'cancelado' AND NEW.cancelado_em IS NULL THEN NEW.cancelado_em := now(); END IF;
  IF NEW.status <> 'cancelado' THEN NEW.cancelado_em := NULL; END IF;
  RETURN NEW;
END;
$function$;


-- ── 2. Solicitar mais atualizações: entregue OU concluído sem finalizar ──
CREATE OR REPLACE FUNCTION public.chamado_devolver_ao_dev(p_chamado_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_gestor_sistemas() THEN
    RAISE EXCEPTION 'Só quem pode concluir chamados solicita mais atualizações ao desenvolvedor.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Informe o que ainda precisa ser feito.' USING ERRCODE = '22023';
  END IF;

  SELECT numero, assunto, status, responsavel_id, desenvolvimento_entregue_em, gestao_finalizada_em INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IN ('cancelado', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado está encerrado.' USING ERRCODE = '22023';
  END IF;

  IF v.status = 'concluido' THEN
    IF v.gestao_finalizada_em IS NOT NULL THEN
      RAISE EXCEPTION 'O chamado já foi finalizado — use Reabrir chamado.' USING ERRCODE = '22023';
    END IF;
    -- Concluído e não finalizado: volta ao dev. A troca de status zera a
    -- confirmação do solicitante, a finalização e a entrega (gatilhos).
    PERFORM set_config('app.chamado_gestao_rpc', 'on', true);
    UPDATE public."CHAMADO_SISTEMA" SET status = 'em_andamento' WHERE id = p_chamado_id;
    PERFORM set_config('app.chamado_gestao_rpc', 'off', true);
  ELSIF v.desenvolvimento_entregue_em IS NOT NULL THEN
    -- Entregue e não concluído: só limpa a entrega (não é travado).
    UPDATE public."CHAMADO_SISTEMA"
       SET desenvolvimento_entregue_em = NULL, desenvolvimento_entregue_pr = NULL
     WHERE id = p_chamado_id;
  ELSE
    RAISE EXCEPTION 'O chamado não está pendente do Gestor de Sistemas.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          'Mais atualizações solicitadas ao desenvolvedor antes de concluir: ' || v_motivo,
          jsonb_build_object('acao', 'devolvido_ao_dev', 'motivo', v_motivo, 'status_antes', v.status));

  IF v.responsavel_id IS NOT NULL AND v.responsavel_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v.responsavel_id,
              'Chamado #' || v.numero || ': mais atualizações solicitadas',
              left(v_motivo, 200),
              'chamado_devolvido_dev',
              '/app/sistemas/chamados/' || p_chamado_id);
    EXCEPTION WHEN others THEN
      -- Aviso não pode derrubar a devolução.
      RAISE WARNING 'chamado_devolver_ao_dev (%): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Recriar chamado_sistema_guard() como na mig 20261112190000 (sem
-- v_gestor_sis) e chamado_devolver_ao_dev() como na mig 20261118210000.
-- NOTIFY pgrst, 'reload schema';
