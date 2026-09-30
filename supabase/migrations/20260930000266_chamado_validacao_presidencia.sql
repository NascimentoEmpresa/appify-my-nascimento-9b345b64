-- =========================================================================
-- CHAMADOS DE SISTEMAS — Validação da Presidência + Treinamento
--
-- PEDIDO (29/09/2026)
--   Ao aprovar/direcionar um chamado, a coordenação pode marcar
--   "Enviar à Presidência". Nesses chamados o fluxo ganha etapas depois
--   que o desenvolvedor conclui:
--
--     Solicitante abre → desenvolvedor conclui → Presidência valida o
--     desenvolvimento → treinamento: o DESENVOLVEDOR que concluiu e o
--     SOLICITANTE confirmam, cada um, que o treinamento foi dado → finalizado.
--
--   A Presidência trabalha num submódulo novo, "Desenvolvimento Chamados"
--   (/app/presidencia/chamados-desenvolvimento), e pode devolver o chamado
--   ao desenvolvimento se não estiver OK.
--
-- POR QUE UMA TABELA À PARTE (e não status novos em CHAMADO_SISTEMA)
--   'concluido' é lido em muitos lugares: fila do dev, avaliação, painel,
--   conclusão automática no merge da PR (service_role), estatísticas. Pôr
--   status novos ali mexeria em tudo isso. A validação é uma camada POR
--   CIMA do chamado concluído: CHAMADO_SISTEMA continua com os mesmos
--   status e "CHAMADO_SISTEMA_VALIDACAO" guarda em que etapa da Presidência
--   ele está. Chamado sem linha nesta tabela segue o fluxo de sempre.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Menus no módulo Presidência (nascem FECHADOS — deny-by-default):
--        presidencia_chamados_dev          — a tela (lista, somente leitura)
--        presidencia_chamados_dev_validar  — menu fantasma: aprovar/devolver
--   2. Tabela "CHAMADO_SISTEMA_VALIDACAO" (1 linha por chamado enviado).
--   3. Trigger em CHAMADO_SISTEMA: concluiu → vai para a Presidência;
--      reabriu → volta para o desenvolvimento.
--   4. chamado_sistema_guard: aceita a devolução pela Presidência
--      (app.chamado_presidencia), só para voltar à fila.
--   5. RPCs: definir envio, decidir (Presidência), confirmar treinamento,
--      listar para a Presidência.
--   6. RLS: leitura para solicitante, responsável, dev que concluiu,
--      gestão de chamados e Presidência. Escrita só pelas RPCs.
--
-- PARA USAR: liberar em Acesso por Usuário, módulo Presidência:
--   · "Desenvolvimento Chamados"                       — ver a tela
--   · "Desenvolvimento Chamados · Pode validar"        — aprovar/devolver
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1. Menus ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'presidencia_chamados_dev', 'Desenvolvimento Chamados',
       '/app/presidencia/chamados-desenvolvimento', 40, true
  FROM public.app_modulo m WHERE m.codigo = 'presidencia'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'presidencia_chamados_dev_validar', 'Desenvolvimento Chamados · Pode validar',
       NULL, 41, true
  FROM public.app_modulo m WHERE m.codigo = 'presidencia'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- ── 2. Tabela ────────────────────────────────────────────────────────────
-- etapa:
--   desenvolvimento        — marcado para a Presidência, dev ainda trabalhando
--   validacao_presidencia  — dev concluiu; aguardando a Presidência
--   treinamento            — Presidência aprovou; aguardando as 2 confirmações
--   finalizado             — dev e solicitante confirmaram o treinamento
-- (espelho: ETAPAS_VALIDACAO em src/pages/chamados/validacaoPresidencia.ts)
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_VALIDACAO" (
  chamado_id                   uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  etapa                        text NOT NULL DEFAULT 'desenvolvimento'
                                 CHECK (etapa IN ('desenvolvimento', 'validacao_presidencia', 'treinamento', 'finalizado')),
  enviado_por                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_em                   timestamptz NOT NULL DEFAULT now(),
  observacao_envio             text,
  -- Quem marcou o chamado como concluído (ou o responsável, quando a
  -- conclusão veio da automação do merge da PR, sem usuário).
  desenvolvedor_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  desenvolvimento_concluido_em timestamptz,
  -- Quantas vezes a Presidência devolveu ao desenvolvimento.
  devolucoes                   integer NOT NULL DEFAULT 0,
  presidencia_por              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  presidencia_em               timestamptz,
  presidencia_aprovado         boolean,
  presidencia_parecer          text,
  treinamento_dev_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  treinamento_dev_em           timestamptz,
  treinamento_dev_obs          text,
  treinamento_solic_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  treinamento_solic_em         timestamptz,
  treinamento_solic_obs        text,
  finalizado_em                timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_validacao_etapa
  ON public."CHAMADO_SISTEMA_VALIDACAO" (etapa);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_validacao_desenvolvedor
  ON public."CHAMADO_SISTEMA_VALIDACAO" (desenvolvedor_id);

DROP TRIGGER IF EXISTS trg_chamado_sistema_validacao_updated_at ON public."CHAMADO_SISTEMA_VALIDACAO";
CREATE TRIGGER trg_chamado_sistema_validacao_updated_at
  BEFORE UPDATE ON public."CHAMADO_SISTEMA_VALIDACAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: registra um evento no histórico do chamado. autor_id é NOT NULL;
-- sem sessão (automação) cai no responsável e, por fim, no solicitante.
CREATE OR REPLACE FUNCTION public.chamado_validacao_registrar_evento(p_chamado_id uuid, p_texto text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_autor uuid;
BEGIN
  SELECT COALESCE(auth.uid(), c.responsavel_id, c.solicitante_id)
    INTO v_autor
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;
  IF v_autor IS NULL THEN RETURN; END IF;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, v_autor, 'evento', p_texto, jsonb_build_object('origem', 'validacao_presidencia'));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_validacao_registrar_evento(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 3. Sincronia com o status do chamado ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_validacao_sync_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa text;
BEGIN
  SELECT etapa INTO v_etapa
    FROM public."CHAMADO_SISTEMA_VALIDACAO"
   WHERE chamado_id = NEW.id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Dev concluiu → aguarda a Presidência. Quem concluiu é quem vai
  -- confirmar o treinamento; sem sessão (merge da PR), o responsável.
  IF NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido'
     AND v_etapa = 'desenvolvimento' THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET etapa = 'validacao_presidencia',
           desenvolvedor_id = COALESCE(auth.uid(), NEW.responsavel_id),
           desenvolvimento_concluido_em = now()
     WHERE chamado_id = NEW.id;
    PERFORM public.chamado_validacao_registrar_evento(NEW.id,
      'Desenvolvimento concluído — enviado para validação da Presidência');

  -- Reaberto depois de concluído → volta ao desenvolvimento e a rodada de
  -- validação/treinamento recomeça do zero (a entrega mudou).
  ELSIF OLD.status = 'concluido' AND NEW.status IS DISTINCT FROM 'concluido'
        AND NEW.status NOT IN ('reprovado', 'cancelado')
        AND v_etapa <> 'desenvolvimento' THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET etapa = 'desenvolvimento',
           desenvolvimento_concluido_em = NULL,
           presidencia_por = NULL, presidencia_em = NULL,
           presidencia_aprovado = NULL, presidencia_parecer = NULL,
           treinamento_dev_por = NULL, treinamento_dev_em = NULL, treinamento_dev_obs = NULL,
           treinamento_solic_por = NULL, treinamento_solic_em = NULL, treinamento_solic_obs = NULL,
           finalizado_em = NULL
     WHERE chamado_id = NEW.id;
    PERFORM public.chamado_validacao_registrar_evento(NEW.id,
      'Chamado reaberto — validação da Presidência volta a aguardar o desenvolvimento');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_validacao_sync_status ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_validacao_sync_status
  AFTER UPDATE OF status ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.chamado_validacao_sync_status();

-- ── 4. Guard: a Presidência devolve ao desenvolvimento ───────────────────
-- Cópia da 20260930000260 com UMA mudança: v_presid (app.chamado_presidencia,
-- ligado só por chamado_presidencia_decidir) pode mudar o status para voltar
-- à fila ('aberto' / 'em_andamento'). Nenhum outro campo é liberado.
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

  v_coord := public.tem_acesso_menu('chamados_sistemas_coordenar');
  v_aprov := public.tem_acesso_menu('chamados_sistemas_aprovar');
  v_resp  := COALESCE(OLD.responsavel_id = auth.uid(), false);

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
       OR (v_presid AND NEW.status IN ('aberto', 'em_andamento'))) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  IF NEW.status = 'cancelado' AND NEW.cancelado_em IS NULL THEN NEW.cancelado_em := now(); END IF;
  IF NEW.status <> 'cancelado' THEN NEW.cancelado_em := NULL; END IF;
  RETURN NEW;
END;
$function$;

-- ── 5. RPCs ──────────────────────────────────────────────────────────────

-- 5a. Coordenação marca/desmarca "Enviar à Presidência".
--     Chamado já concluído vai direto para a validação.
CREATE OR REPLACE FUNCTION public.chamado_presidencia_definir(
  p_chamado_id uuid, p_enviar boolean, p_observacao text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_status      text;
  v_responsavel uuid;
  v_etapa       text;
  v_obs         text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
BEGIN
  IF NOT (public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR public.tem_acesso_menu('chamados_sistemas_aprovar')) THEN
    RAISE EXCEPTION 'Sem permissão para enviar chamados à Presidência.';
  END IF;

  SELECT status, responsavel_id INTO v_status, v_responsavel
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;

  SELECT etapa INTO v_etapa
    FROM public."CHAMADO_SISTEMA_VALIDACAO" WHERE chamado_id = p_chamado_id FOR UPDATE;

  IF p_enviar THEN
    IF v_etapa IS NOT NULL THEN
      -- Já marcado: só atualiza a observação.
      IF v_obs IS NOT NULL THEN
        UPDATE public."CHAMADO_SISTEMA_VALIDACAO" SET observacao_envio = v_obs
         WHERE chamado_id = p_chamado_id;
      END IF;
      RETURN;
    END IF;
    IF v_status IN ('reprovado', 'cancelado') THEN
      RAISE EXCEPTION 'Chamado encerrado — não é possível enviar à Presidência.';
    END IF;

    INSERT INTO public."CHAMADO_SISTEMA_VALIDACAO"
      (chamado_id, etapa, enviado_por, observacao_envio,
       desenvolvedor_id, desenvolvimento_concluido_em)
    VALUES
      (p_chamado_id,
       CASE WHEN v_status = 'concluido' THEN 'validacao_presidencia' ELSE 'desenvolvimento' END,
       auth.uid(), v_obs,
       CASE WHEN v_status = 'concluido' THEN v_responsavel END,
       CASE WHEN v_status = 'concluido' THEN now() END);

    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      CASE WHEN v_status = 'concluido'
           THEN 'Chamado enviado à Presidência — aguardando validação do desenvolvimento'
           ELSE 'Chamado marcado para validação da Presidência após a conclusão' END);
  ELSE
    IF v_etapa IS NULL THEN RETURN; END IF;
    IF v_etapa NOT IN ('desenvolvimento', 'validacao_presidencia') THEN
      RAISE EXCEPTION 'A Presidência já validou este chamado — não dá mais para retirar.';
    END IF;
    DELETE FROM public."CHAMADO_SISTEMA_VALIDACAO" WHERE chamado_id = p_chamado_id;
    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      'Chamado retirado da validação da Presidência');
  END IF;
END;
$$;

-- 5b. Presidência aprova (→ treinamento) ou devolve (→ desenvolvimento).
CREATE OR REPLACE FUNCTION public.chamado_presidencia_decidir(
  p_chamado_id uuid, p_aprovado boolean, p_parecer text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa       text;
  v_responsavel uuid;
  v_parecer     text := NULLIF(btrim(COALESCE(p_parecer, '')), '');
BEGIN
  IF NOT public.tem_acesso_menu('presidencia_chamados_dev_validar') THEN
    RAISE EXCEPTION 'Sem permissão para validar o desenvolvimento de chamados.';
  END IF;

  SELECT v.etapa, c.responsavel_id INTO v_etapa, v_responsavel
    FROM public."CHAMADO_SISTEMA_VALIDACAO" v
    JOIN public."CHAMADO_SISTEMA" c ON c.id = v.chamado_id
   WHERE v.chamado_id = p_chamado_id
   FOR UPDATE OF v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este chamado não foi enviado à Presidência.';
  END IF;
  IF v_etapa <> 'validacao_presidencia' THEN
    RAISE EXCEPTION 'Este chamado não está aguardando a validação da Presidência.';
  END IF;

  IF p_aprovado THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET etapa = 'treinamento',
           presidencia_por = auth.uid(), presidencia_em = now(),
           presidencia_aprovado = true, presidencia_parecer = v_parecer
     WHERE chamado_id = p_chamado_id;
    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      'Presidência aprovou o desenvolvimento — pendente de treinamento'
      || COALESCE(': ' || v_parecer, ''));
  ELSE
    IF v_parecer IS NULL OR length(v_parecer) < 5 THEN
      RAISE EXCEPTION 'Explique o que não está OK para o desenvolvedor ajustar.';
    END IF;
    -- A etapa volta ANTES do status: assim o trigger de sincronia não
    -- reprocessa (ele só age quando a etapa não é 'desenvolvimento').
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET etapa = 'desenvolvimento',
           devolucoes = devolucoes + 1,
           desenvolvimento_concluido_em = NULL,
           presidencia_por = auth.uid(), presidencia_em = now(),
           presidencia_aprovado = false, presidencia_parecer = v_parecer
     WHERE chamado_id = p_chamado_id;

    PERFORM set_config('app.chamado_presidencia', 'on', true);
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
    PERFORM set_config('app.chamado_presidencia', 'off', true);

    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      'Presidência devolveu ao desenvolvimento: ' || v_parecer);
  END IF;
END;
$$;

-- 5c. Treinamento: o dev que concluiu e o solicitante confirmam, cada um.
--     Quando os dois confirmam, a validação é finalizada.
CREATE OR REPLACE FUNCTION public.chamado_treinamento_confirmar(
  p_chamado_id uuid, p_observacao text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_obs   text := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  v       public."CHAMADO_SISTEMA_VALIDACAO"%ROWTYPE;
  v_solic uuid;
  v_resp  uuid;
  v_eh_dev   boolean;
  v_eh_solic boolean;
  v_nome  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada — entre de novo.';
  END IF;

  SELECT * INTO v FROM public."CHAMADO_SISTEMA_VALIDACAO"
   WHERE chamado_id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este chamado não passa pela validação da Presidência.';
  END IF;
  IF v.etapa <> 'treinamento' THEN
    RAISE EXCEPTION 'O treinamento só é confirmado depois que a Presidência aprova o desenvolvimento.';
  END IF;

  SELECT solicitante_id, responsavel_id INTO v_solic, v_resp
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id;

  v_eh_dev   := COALESCE(v_uid = COALESCE(v.desenvolvedor_id, v_resp), false);
  v_eh_solic := COALESCE(v_uid = v_solic, false);

  IF NOT (v_eh_dev OR v_eh_solic) THEN
    RAISE EXCEPTION 'Só o desenvolvedor que concluiu e o solicitante confirmam o treinamento.';
  END IF;

  IF v_eh_dev AND v.treinamento_dev_em IS NULL THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET treinamento_dev_por = v_uid, treinamento_dev_em = now(), treinamento_dev_obs = v_obs
     WHERE chamado_id = p_chamado_id;
  END IF;
  IF v_eh_solic AND v.treinamento_solic_em IS NULL THEN
    UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
       SET treinamento_solic_por = v_uid, treinamento_solic_em = now(), treinamento_solic_obs = v_obs
     WHERE chamado_id = p_chamado_id;
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_uid;
  PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
    format('Treinamento confirmado pelo %s (%s)%s',
           CASE WHEN v_eh_dev AND v_eh_solic THEN 'desenvolvedor e solicitante'
                WHEN v_eh_dev THEN 'desenvolvedor' ELSE 'solicitante' END,
           COALESCE(v_nome, 'usuário'),
           COALESCE(': ' || v_obs, '')));

  -- Os dois confirmaram → finaliza.
  UPDATE public."CHAMADO_SISTEMA_VALIDACAO"
     SET etapa = 'finalizado', finalizado_em = now()
   WHERE chamado_id = p_chamado_id
     AND treinamento_dev_em IS NOT NULL
     AND treinamento_solic_em IS NOT NULL
     AND etapa = 'treinamento';
  IF FOUND THEN
    PERFORM public.chamado_validacao_registrar_evento(p_chamado_id,
      'Treinamento confirmado pelo desenvolvedor e pelo solicitante — solicitação finalizada');
    RETURN 'finalizado';
  END IF;
  RETURN 'treinamento';
END;
$$;

-- 5d. Lista para a tela da Presidência (lê o chamado sem abrir a RLS dele).
CREATE OR REPLACE FUNCTION public.chamado_presidencia_listar()
RETURNS TABLE (
  chamado_id uuid, numero text, assunto text, descricao text, prioridade text,
  modulo_sistema text, modulo_sistema_outro text, status text,
  solicitante_id uuid, solicitante_nome text, setor text,
  responsavel_id uuid, responsavel_nome text, chamado_criado_em timestamptz,
  etapa text, enviado_por_nome text, enviado_em timestamptz, observacao_envio text,
  desenvolvedor_id uuid, desenvolvedor_nome text, desenvolvimento_concluido_em timestamptz,
  devolucoes integer, presidencia_por uuid, presidencia_nome text, presidencia_em timestamptz,
  presidencia_aprovado boolean, presidencia_parecer text,
  treinamento_dev_em timestamptz, treinamento_dev_obs text,
  treinamento_solic_em timestamptz, treinamento_solic_obs text,
  finalizado_em timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.tem_acesso_menu('presidencia_chamados_dev')
          OR public.tem_acesso_menu('presidencia_chamados_dev_validar')) THEN
    RAISE EXCEPTION 'Sem acesso a Desenvolvimento Chamados.';
  END IF;

  RETURN QUERY
  SELECT c.id, c.numero, c.assunto, c.descricao, c.prioridade,
         c.modulo_sistema, c.modulo_sistema_outro, c.status,
         c.solicitante_id, c.solicitante_nome, c.setor,
         c.responsavel_id, pr.display_name, c.created_at,
         v.etapa, pe.display_name, v.enviado_em, v.observacao_envio,
         v.desenvolvedor_id, pd.display_name, v.desenvolvimento_concluido_em,
         v.devolucoes, v.presidencia_por, pp.display_name, v.presidencia_em,
         v.presidencia_aprovado, v.presidencia_parecer,
         v.treinamento_dev_em, v.treinamento_dev_obs,
         v.treinamento_solic_em, v.treinamento_solic_obs,
         v.finalizado_em
    FROM public."CHAMADO_SISTEMA_VALIDACAO" v
    JOIN public."CHAMADO_SISTEMA" c ON c.id = v.chamado_id
    LEFT JOIN public.profiles pr ON pr.id = c.responsavel_id
    LEFT JOIN public.profiles pe ON pe.id = v.enviado_por
    LEFT JOIN public.profiles pd ON pd.id = COALESCE(v.desenvolvedor_id, c.responsavel_id)
    LEFT JOIN public.profiles pp ON pp.id = v.presidencia_por
   ORDER BY COALESCE(v.desenvolvimento_concluido_em, v.enviado_em) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.chamado_presidencia_definir(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chamado_presidencia_decidir(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chamado_treinamento_confirmar(uuid, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chamado_presidencia_listar()                    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_presidencia_definir(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chamado_presidencia_decidir(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chamado_treinamento_confirmar(uuid, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.chamado_presidencia_listar()                    TO authenticated;

-- ── 6. RLS ───────────────────────────────────────────────────────────────
-- Leitura: quem já enxerga o chamado (solicitante, responsável, gestão),
-- o dev que concluiu e a Presidência. Escrita: só as RPCs acima (DEFINER).
ALTER TABLE public."CHAMADO_SISTEMA_VALIDACAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."CHAMADO_SISTEMA_VALIDACAO" TO authenticated;

DROP POLICY IF EXISTS chamado_sistema_validacao_select ON public."CHAMADO_SISTEMA_VALIDACAO";
CREATE POLICY chamado_sistema_validacao_select ON public."CHAMADO_SISTEMA_VALIDACAO"
  FOR SELECT TO authenticated
  USING (
    desenvolvedor_id = auth.uid()
    OR public.chamado_sistema_gestor()
    OR public.tem_acesso_menu('presidencia_chamados_dev')
    OR public.tem_acesso_menu('presidencia_chamados_dev_validar')
    OR EXISTS (
      SELECT 1 FROM public."CHAMADO_SISTEMA" c
       WHERE c.id = "CHAMADO_SISTEMA_VALIDACAO".chamado_id
         AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT codigo, nome, rota FROM app_menu WHERE codigo LIKE 'presidencia_chamados_dev%';
-- SELECT * FROM public."CHAMADO_SISTEMA_VALIDACAO" ORDER BY updated_at DESC LIMIT 20;

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_chamado_validacao_sync_status ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_validacao_sync_status();
-- DROP FUNCTION IF EXISTS public.chamado_presidencia_listar();
-- DROP FUNCTION IF EXISTS public.chamado_treinamento_confirmar(uuid, text);
-- DROP FUNCTION IF EXISTS public.chamado_presidencia_decidir(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.chamado_presidencia_definir(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.chamado_validacao_registrar_evento(uuid, text);
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_VALIDACAO";
-- chamado_sistema_guard: reaplicar o corpo da 20260930000260.
-- UPDATE public.app_menu SET ativo = false WHERE codigo IN ('presidencia_chamados_dev', 'presidencia_chamados_dev_validar');
