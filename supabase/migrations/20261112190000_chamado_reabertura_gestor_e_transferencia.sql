-- =========================================================================
-- CHAMADOS DE SISTEMAS — o Gestor decide a reabertura; transferência de dev
-- 12/11/2026, pedido do Pablo:
--   "Quando um chamado for reaberto, a página do chamado mostra no meio um
--    card de destaque CHAMADO REABERTO, com quem reabriu, quando e por quê.
--    O gestor de sistemas pode negar a reabertura (motivo obrigatório) ou
--    confirmar, mandando para outro desenvolvedor ou mantendo o mesmo. Tudo
--    continua aparecendo para o desenvolvedor atual; transferido, o chat
--    mostra 'Transferido para <dev>'. O desenvolvedor pode pedir a
--    transferência para outro dev — vai para o gestor aprovar ou recusar."
--
-- O QUE MUDA EM RELAÇÃO À MIG 20261112002000 (mesmo dia):
--   Lá, "não atendeu o solicitado" já devolvia o chamado para 'aberto' SEM
--   responsável. Agora o solicitante só PEDE a reabertura: o chamado fica
--   como estava (concluído/reprovado, com o mesmo dev) até o Gestor decidir.
--   POR QUE o status não muda no pedido: negar precisa voltar exatamente ao
--   que era. Se o pedido já reabrisse, negar teria de restaurar concluido_em
--   (o guard grava now() — o tempo de entrega do dev mudaria), a confirmação
--   do solicitante e a finalização do gestor, que os gatilhos zeram a cada
--   troca de status. Sem mexer no status, negar é só registrar.
--   E o "Chamado reaberto: …" (que a bonificação e o monitoramento contam
--   como reabertura) só entra quando o Gestor CONFIRMA. Reabertura negada
--   não pesa contra o dev.
--
-- QUEM DECIDE: o Gestor de Sistemas (menu fantasma chamados_sistemas_gestor_
-- sistemas, mig 20261110009000) ou quem coordena (chamados_sistemas_coordenar
-- — é a mesma triagem do Painel de Distribuição). Função chamado_pode_decidir.
--
--   1. "CHAMADO_SISTEMA_REABERTURA" — um pedido por reabertura (histórico das
--      rodadas; no máximo um pendente por chamado).
--   2. "CHAMADO_SISTEMA_TRANSFERENCIA" — pedidos do dev para passar o chamado
--      a outro dev (no máximo um pendente por chamado).
--      Ninguém escreve direto nas duas: só as RPCs (SECURITY DEFINER).
--   3. chamado_sistema_guard ganha a marca app.chamado_gestao_rpc: as RPCs de
--      decisão trocam responsável/status mesmo quando o Gestor de Sistemas
--      não tem "coordenar" (o guard pergunta tem_acesso_menu do usuário).
--   4. Gatilho trg_chamado_sistema_transferido: QUALQUER troca de
--      responsável (Coordenar, reabertura confirmada, transferência aprovada)
--      escreve "Transferido para <dev>" no histórico/chat.
--   5. RPCs: chamado_reabrir_nao_atendeu (agora pede), chamado_reabertura_
--      decidir, chamado_transferencia_solicitar / _cancelar / _decidir,
--      chamado_devs_transferencia (lista para o dev escolher) e
--      chamado_pendencias_gestao (aviso no Painel de Distribuição).
--   6. chamado_finalizar_gestao não finaliza com reabertura pendente.
-- =========================================================================

-- ── 1. Tabelas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_REABERTURA" (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id           uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo               text NOT NULL,
  status               text NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente', 'confirmada', 'negada')),
  status_chamado       text,   -- status do chamado quando pediram (concluido/reprovado)
  responsavel_anterior uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responsavel_novo     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_em          timestamptz,
  motivo_decisao       text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_reabertura_chamado
  ON public."CHAMADO_SISTEMA_REABERTURA"(chamado_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chamado_reabertura_pendente
  ON public."CHAMADO_SISTEMA_REABERTURA"(chamado_id) WHERE status = 'pendente';

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_TRANSFERENCIA" (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chamado_id       uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  solicitado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  de_responsavel   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  para_responsavel uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo           text NOT NULL,
  status           text NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'aprovada', 'recusada', 'cancelada')),
  decidido_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decidido_em      timestamptz,
  motivo_decisao   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_transferencia_chamado
  ON public."CHAMADO_SISTEMA_TRANSFERENCIA"(chamado_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chamado_transferencia_pendente
  ON public."CHAMADO_SISTEMA_TRANSFERENCIA"(chamado_id) WHERE status = 'pendente';

-- ── 2. Quem decide / quem é dev ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_pode_decidir()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.chamado_gestor_sistemas()
      OR public.tem_acesso_menu('chamados_sistemas_coordenar');
$$;
REVOKE ALL ON FUNCTION public.chamado_pode_decidir() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pode_decidir() TO authenticated;

-- Os desenvolvedores ativos — mesma regra de listar_desenvolvedores_chamados
-- (mig 20260817000002), sem a trava de "ver todos": é usada por dentro das
-- RPCs e pela lista do dev que pede transferência. Sem GRANT a authenticated.
CREATE OR REPLACE FUNCTION public.chamado_desenvolvedores_ativos()
RETURNS TABLE(id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name
    FROM public.profiles p
   WHERE p.ativo = true
     AND EXISTS (
       SELECT 1
         FROM unnest(ARRAY['chamados_sistemas_dev','sistemas_desenvolvedores']) AS cod
        WHERE COALESCE(
                (SELECT s.allow
                   FROM public.screen_permission_user s
                  WHERE s.user_id = p.id
                    AND s.menu_codigo = cod
                    AND s.acao = 'visualizar'::public.app_acao
                  ORDER BY s.updated_at DESC
                  LIMIT 1),
                EXISTS (SELECT 1
                          FROM public.usuario_perfil_acesso upa
                          JOIN public.perfil_acesso pa
                            ON pa.id = upa.perfil_id AND pa.ativo = true
                          JOIN public.perfil_acesso_permissao pap
                            ON pap.perfil_id = pa.id AND pap.allow = true
                         WHERE upa.user_id = p.id
                           AND pap.menu_codigo = cod
                           AND pap.acao = 'visualizar'::public.app_acao)
              ) IS TRUE)
   ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.chamado_desenvolvedores_ativos() FROM PUBLIC, anon, authenticated;

-- Lista para o dialog "Pedir transferência" (o dev não tem "ver todos").
CREATE OR REPLACE FUNCTION public.chamado_devs_transferencia()
RETURNS TABLE(id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.display_name
    FROM public.chamado_desenvolvedores_ativos() d
   WHERE public.chamado_sistema_gestor()
      OR public.tem_acesso_menu('chamados_sistemas_dev')
      OR public.tem_acesso_menu('sistemas_desenvolvedores');
$$;
REVOKE ALL ON FUNCTION public.chamado_devs_transferencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_devs_transferencia() TO authenticated;

-- Sino para quem decide (Gestor de Sistemas + Coordenar). Lê
-- screen_permission_user (poucas linhas) e confere com has_screen_access,
-- igual a chamado_confirmado_avisa_gestao. Aviso nunca derruba a ação.
CREATE OR REPLACE FUNCTION public.chamado_avisar_decisores(p_titulo text, p_mensagem text, p_tipo text, p_link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT DISTINCT s.user_id, p_titulo, p_mensagem, p_tipo, p_link
      FROM public.screen_permission_user s
     WHERE s.menu_codigo IN ('chamados_sistemas_gestor_sistemas', 'chamados_sistemas_coordenar')
       AND s.acao = 'visualizar' AND s.allow
       AND s.user_id IS DISTINCT FROM auth.uid()
       AND public.has_screen_access(s.user_id, s.menu_codigo, 'visualizar'::public.app_acao, NULL);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'chamado_avisar_decisores: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_avisar_decisores(text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chamado_avisar_usuario(p_user uuid, p_titulo text, p_mensagem text, p_tipo text, p_link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user IS NULL OR p_user = auth.uid() THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (p_user, p_titulo, p_mensagem, p_tipo, p_link);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'chamado_avisar_usuario: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_avisar_usuario(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── 3. RLS: leitura só; escrita só pelas RPCs ────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA_REABERTURA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CHAMADO_SISTEMA_TRANSFERENCIA" ENABLE ROW LEVEL SECURITY;

-- Reabertura: quem enxerga o chamado (solicitante, dev, gestão, participante).
DROP POLICY IF EXISTS chamado_reabertura_select ON public."CHAMADO_SISTEMA_REABERTURA";
CREATE POLICY chamado_reabertura_select ON public."CHAMADO_SISTEMA_REABERTURA" FOR SELECT TO authenticated
  USING (public.chamado_sistema_visivel(chamado_id));

-- Transferência: assunto da equipe — gestão, o dev atual e os dois do pedido.
DROP POLICY IF EXISTS chamado_transferencia_select ON public."CHAMADO_SISTEMA_TRANSFERENCIA";
CREATE POLICY chamado_transferencia_select ON public."CHAMADO_SISTEMA_TRANSFERENCIA" FOR SELECT TO authenticated
  USING (public.chamado_sistema_gestor()
         OR solicitado_por = auth.uid() OR de_responsavel = auth.uid() OR para_responsavel = auth.uid()
         OR EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c
                     WHERE c.id = "CHAMADO_SISTEMA_TRANSFERENCIA".chamado_id AND c.responsavel_id = auth.uid()));

REVOKE ALL ON public."CHAMADO_SISTEMA_REABERTURA" FROM PUBLIC, anon;
REVOKE ALL ON public."CHAMADO_SISTEMA_TRANSFERENCIA" FROM PUBLIC, anon;
GRANT SELECT ON public."CHAMADO_SISTEMA_REABERTURA" TO authenticated;
GRANT SELECT ON public."CHAMADO_SISTEMA_TRANSFERENCIA" TO authenticated;

-- ── 4. Guard: a marca das RPCs de decisão ────────────────────────────────
-- Mesmo corpo da mig 20261112002000 + app.chamado_gestao_rpc, que conta como
-- "coordenar" dentro do UPDATE feito pelas RPCs desta migration (elas já
-- conferiram chamado_pode_decidir e controlam o que o UPDATE muda).
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

-- ── 5. "Transferido para <dev>" em toda troca de responsável ─────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_transferido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome  text;
  v_autor uuid := COALESCE(auth.uid(), NEW.responsavel_id);
BEGIN
  -- Faxina de exclusão de usuário não é transferência.
  IF COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false) THEN
    RETURN NULL;
  END IF;
  BEGIN
    SELECT display_name INTO v_nome FROM public.profiles WHERE id = NEW.responsavel_id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (NEW.id, v_autor, 'evento',
            'Transferido para ' || COALESCE(v_nome, 'outro desenvolvedor'),
            jsonb_build_object('acao', 'transferido', 'de', OLD.responsavel_id, 'para', NEW.responsavel_id));
  EXCEPTION WHEN others THEN
    -- O histórico não pode desfazer a troca de responsável.
    RAISE WARNING 'chamado_sistema_transferido (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_transferido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_transferido ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_transferido
  AFTER UPDATE OF responsavel_id ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (OLD.responsavel_id IS NOT NULL AND NEW.responsavel_id IS NOT NULL
        AND NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id)
  EXECUTE FUNCTION public.chamado_sistema_transferido();

-- ── 6. Solicitante PEDE a reabertura ("não atendeu o solicitado") ────────
CREATE OR REPLACE FUNCTION public.chamado_reabrir_nao_atendeu(p_chamado_id uuid, p_motivo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Conte o que não ficou como você pediu.';
  END IF;

  SELECT id, numero, assunto, solicitante_id, status, responsavel_id INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v.solicitante_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Apenas quem abriu o chamado pode reabri-lo por aqui.';
  END IF;
  IF v.status NOT IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado ainda está em atendimento — use a conversa do chamado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_REABERTURA"
              WHERE chamado_id = p_chamado_id AND status = 'pendente') THEN
    RAISE EXCEPTION 'A reabertura deste chamado já está com o Gestor de Sistemas.';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_REABERTURA"
    (chamado_id, solicitado_por, motivo, status_chamado, responsavel_anterior)
  VALUES (p_chamado_id, auth.uid(), btrim(p_motivo), v.status, v.responsavel_id);

  -- NÃO é "Chamado reaberto: …" de propósito: esse texto conta como
  -- reabertura na bonificação e no monitoramento; só entra na confirmação.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          'Reabertura solicitada: não atendeu o solicitado — ' || btrim(p_motivo)
          || ' (aguardando o Gestor de Sistemas)',
          jsonb_build_object('acao', 'reabertura_solicitada'));

  PERFORM public.chamado_avisar_decisores(
    'Reabertura do chamado #' || v.numero,
    left(v.assunto, 120) || ' — o solicitante pediu para reabrir. Confirme ou negue.',
    'chamado_reabertura', '/app/sistemas/chamados/' || p_chamado_id || '/coordenar');

  RETURN v.status;  -- o status não muda até o Gestor decidir
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reabrir_nao_atendeu(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_reabrir_nao_atendeu(uuid, text) TO authenticated;

-- ── 7. Gestor decide a reabertura ────────────────────────────────────────
-- p_confirmar = false → nega (motivo obrigatório); o chamado fica como estava.
-- p_confirmar = true  → reabre para p_responsavel_id (NULL = mantém o dev atual).
CREATE OR REPLACE FUNCTION public.chamado_reabertura_decidir(
  p_reabertura_id bigint, p_confirmar boolean,
  p_responsavel_id uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r       record;
  c       record;
  v_novo  uuid;
  v_status text;
  v_nome  text;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_pode_decidir() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas decide a reabertura.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public."CHAMADO_SISTEMA_REABERTURA" WHERE id = p_reabertura_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de reabertura não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF r.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta reabertura já foi decidida.' USING ERRCODE = '22023';
  END IF;
  SELECT id, numero, assunto, status, responsavel_id, solicitante_id INTO c
    FROM public."CHAMADO_SISTEMA" WHERE id = r.chamado_id FOR UPDATE;

  IF NOT p_confirmar THEN
    IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
      RAISE EXCEPTION 'Informe o motivo para negar a reabertura.' USING ERRCODE = '22023';
    END IF;
    UPDATE public."CHAMADO_SISTEMA_REABERTURA"
       SET status = 'negada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = v_motivo
     WHERE id = r.id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (c.id, auth.uid(), 'evento', 'Reabertura negada: ' || v_motivo,
            jsonb_build_object('acao', 'reabertura_negada', 'reabertura_id', r.id));
    PERFORM public.chamado_avisar_usuario(r.solicitado_por,
      'Reabertura negada — chamado #' || c.numero, v_motivo,
      'chamado_reabertura', '/app/central-servicos/chamados/' || c.id || '/acompanhar');
    RETURN c.status;
  END IF;

  v_novo := COALESCE(p_responsavel_id, c.responsavel_id, r.responsavel_anterior);
  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Escolha o desenvolvedor que vai atender a reabertura.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chamado_desenvolvedores_ativos() d WHERE d.id = v_novo) THEN
    RAISE EXCEPTION 'O escolhido não é um desenvolvedor ativo de chamados.' USING ERRCODE = '22023';
  END IF;

  -- Encerrado volta para o desenvolvimento; se a equipe já tinha reaberto
  -- por outro caminho, só ajusta o responsável.
  v_status := CASE WHEN c.status IN ('concluido', 'reprovado') THEN 'em_andamento' ELSE c.status END;

  PERFORM set_config('app.chamado_gestao_rpc', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET status = v_status, responsavel_id = v_novo
   WHERE id = c.id;
  PERFORM set_config('app.chamado_gestao_rpc', 'off', true);

  PERFORM public.chamado_normalizar_fila_dev(v_novo);
  IF c.responsavel_id IS NOT NULL AND c.responsavel_id <> v_novo THEN
    PERFORM public.chamado_normalizar_fila_dev(c.responsavel_id);
  END IF;

  UPDATE public."CHAMADO_SISTEMA_REABERTURA"
     SET status = 'confirmada', decidido_por = auth.uid(), decidido_em = now(),
         motivo_decisao = v_motivo, responsavel_novo = v_novo
   WHERE id = r.id;

  -- "Chamado reaberto: …" é o que o chat traduz e a bonificação conta.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (c.id, auth.uid(), 'evento',
          'Chamado reaberto: não atendeu o solicitado — ' || r.motivo || ' (confirmado pelo Gestor de Sistemas)',
          jsonb_build_object('acao', 'reabertura_confirmada', 'reabertura_id', r.id));
  -- Sem dev antes (ex.: reprovado na triagem): o gatilho de transferência
  -- não escreve nada, então registra o direcionamento aqui.
  SELECT display_name INTO v_nome FROM public.profiles WHERE id = v_novo;
  IF c.responsavel_id IS NULL THEN
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
    VALUES (c.id, auth.uid(), 'evento', 'Chamado direcionado a ' || COALESCE(v_nome, 'desenvolvedor'));
  END IF;

  PERFORM public.chamado_avisar_usuario(v_novo,
    'Chamado #' || c.numero || ' reaberto', left(c.assunto, 120) || ' — ' || r.motivo,
    'chamado_reabertura', '/app/sistemas/chamados/' || c.id);
  PERFORM public.chamado_avisar_usuario(r.solicitado_por,
    'Reabertura confirmada — chamado #' || c.numero,
    'Voltou para o desenvolvimento com ' || COALESCE(v_nome, 'o desenvolvedor') || '.',
    'chamado_reabertura', '/app/central-servicos/chamados/' || c.id || '/acompanhar');
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reabertura_decidir(bigint, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_reabertura_decidir(bigint, boolean, uuid, text) TO authenticated;

-- ── 8. Dev pede transferência ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_transferencia_solicitar(p_chamado_id uuid, p_para uuid, p_motivo text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  c      record;
  v_id   bigint;
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Conte por que o chamado deve ir para outro desenvolvedor.' USING ERRCODE = '22023';
  END IF;
  SELECT id, numero, assunto, status, responsavel_id INTO c
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF c.responsavel_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só o desenvolvedor responsável pede a transferência.' USING ERRCODE = '42501';
  END IF;
  IF c.status IN ('concluido', 'reprovado', 'cancelado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não há o que transferir.' USING ERRCODE = '22023';
  END IF;
  IF p_para IS NULL OR p_para = auth.uid() THEN
    RAISE EXCEPTION 'Escolha outro desenvolvedor.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chamado_desenvolvedores_ativos() d WHERE d.id = p_para) THEN
    RAISE EXCEPTION 'O escolhido não é um desenvolvedor ativo de chamados.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_TRANSFERENCIA"
              WHERE chamado_id = p_chamado_id AND status = 'pendente') THEN
    RAISE EXCEPTION 'Já existe um pedido de transferência aguardando o Gestor de Sistemas.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_TRANSFERENCIA"
    (chamado_id, solicitado_por, de_responsavel, para_responsavel, motivo)
  VALUES (p_chamado_id, auth.uid(), auth.uid(), p_para, btrim(p_motivo))
  RETURNING id INTO v_id;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = p_para;
  -- Interno: assunto da equipe, o solicitante não precisa ver o pedido.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'observacao_interna',
          'Pedido de transferência para ' || COALESCE(v_nome, 'outro desenvolvedor') || ': ' || btrim(p_motivo)
          || ' (aguardando o Gestor de Sistemas)',
          jsonb_build_object('acao', 'transferencia_solicitada', 'transferencia_id', v_id));

  PERFORM public.chamado_avisar_decisores(
    'Transferência do chamado #' || c.numero,
    left(c.assunto, 120) || ' — o desenvolvedor pediu para passar a ' || COALESCE(v_nome, 'outro dev') || '.',
    'chamado_transferencia', '/app/sistemas/chamados/' || p_chamado_id || '/coordenar');
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_transferencia_solicitar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_transferencia_solicitar(uuid, uuid, text) TO authenticated;

-- O próprio dev desiste do pedido.
CREATE OR REPLACE FUNCTION public.chamado_transferencia_cancelar(p_transferencia_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM public."CHAMADO_SISTEMA_TRANSFERENCIA" WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND OR t.status <> 'pendente' THEN
    RAISE EXCEPTION 'Não há pedido de transferência pendente.' USING ERRCODE = '22023';
  END IF;
  IF t.solicitado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem pediu desiste da transferência.' USING ERRCODE = '42501';
  END IF;
  UPDATE public."CHAMADO_SISTEMA_TRANSFERENCIA"
     SET status = 'cancelada', decidido_por = auth.uid(), decidido_em = now()
   WHERE id = t.id;
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (t.chamado_id, auth.uid(), 'observacao_interna', 'Pedido de transferência cancelado',
          jsonb_build_object('acao', 'transferencia_cancelada', 'transferencia_id', t.id));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_transferencia_cancelar(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_transferencia_cancelar(bigint) TO authenticated;

-- ── 9. Gestor decide a transferência ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_transferencia_decidir(
  p_transferencia_id bigint, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t        record;
  c        record;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_nome   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_pode_decidir() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas decide a transferência.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public."CHAMADO_SISTEMA_TRANSFERENCIA" WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de transferência não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'pendente' THEN
    RAISE EXCEPTION 'Este pedido de transferência já foi decidido.' USING ERRCODE = '22023';
  END IF;
  SELECT id, numero, assunto, status, responsavel_id INTO c
    FROM public."CHAMADO_SISTEMA" WHERE id = t.chamado_id FOR UPDATE;
  SELECT display_name INTO v_nome FROM public.profiles WHERE id = t.para_responsavel;

  IF NOT p_aprovar THEN
    IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
      RAISE EXCEPTION 'Informe o motivo para recusar a transferência.' USING ERRCODE = '22023';
    END IF;
    UPDATE public."CHAMADO_SISTEMA_TRANSFERENCIA"
       SET status = 'recusada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = v_motivo
     WHERE id = t.id;
    INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
    VALUES (c.id, auth.uid(), 'observacao_interna',
            'Transferência para ' || COALESCE(v_nome, 'outro desenvolvedor') || ' recusada: ' || v_motivo,
            jsonb_build_object('acao', 'transferencia_recusada', 'transferencia_id', t.id));
    PERFORM public.chamado_avisar_usuario(t.solicitado_por,
      'Transferência recusada — chamado #' || c.numero, v_motivo,
      'chamado_transferencia', '/app/sistemas/chamados/' || c.id);
    RETURN;
  END IF;

  IF c.status IN ('concluido', 'reprovado', 'cancelado') THEN
    RAISE EXCEPTION 'Chamado encerrado — recuse o pedido.' USING ERRCODE = '22023';
  END IF;
  IF c.responsavel_id IS DISTINCT FROM t.de_responsavel THEN
    RAISE EXCEPTION 'O responsável mudou depois do pedido — recuse e, se for o caso, direcione pela coordenação.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chamado_desenvolvedores_ativos() d WHERE d.id = t.para_responsavel) THEN
    RAISE EXCEPTION 'O desenvolvedor do pedido não está mais ativo em chamados.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.chamado_gestao_rpc', 'on', true);
  UPDATE public."CHAMADO_SISTEMA" SET responsavel_id = t.para_responsavel WHERE id = c.id;
  PERFORM set_config('app.chamado_gestao_rpc', 'off', true);

  PERFORM public.chamado_normalizar_fila_dev(t.para_responsavel);
  IF t.de_responsavel IS NOT NULL THEN
    PERFORM public.chamado_normalizar_fila_dev(t.de_responsavel);
  END IF;

  UPDATE public."CHAMADO_SISTEMA_TRANSFERENCIA"
     SET status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = v_motivo
   WHERE id = t.id;
  -- "Transferido para <dev>" sai do gatilho trg_chamado_sistema_transferido.

  PERFORM public.chamado_avisar_usuario(t.para_responsavel,
    'Chamado #' || c.numero || ' transferido para você', left(c.assunto, 120),
    'chamado_transferencia', '/app/sistemas/chamados/' || c.id);
  PERFORM public.chamado_avisar_usuario(t.solicitado_por,
    'Transferência aprovada — chamado #' || c.numero,
    'Agora com ' || COALESCE(v_nome, 'o outro desenvolvedor') || '.',
    'chamado_transferencia', '/app/sistemas/chamados/dev');
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_transferencia_decidir(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_transferencia_decidir(bigint, boolean, text) TO authenticated;

-- ── 10. Pendências para o Painel de Distribuição ─────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_pendencias_gestao()
RETURNS TABLE(tipo text, pedido_id bigint, chamado_id uuid, numero text, assunto text,
              solicitado_por uuid, motivo text, para_responsavel uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT x.* FROM (
    SELECT 'reabertura'::text, r.id, c.id, c.numero::text, c.assunto::text,
           r.solicitado_por, r.motivo, NULL::uuid, r.created_at
      FROM public."CHAMADO_SISTEMA_REABERTURA" r
      JOIN public."CHAMADO_SISTEMA" c ON c.id = r.chamado_id
     WHERE r.status = 'pendente'
    UNION ALL
    SELECT 'transferencia'::text, t.id, c.id, c.numero::text, c.assunto::text,
           t.solicitado_por, t.motivo, t.para_responsavel, t.created_at
      FROM public."CHAMADO_SISTEMA_TRANSFERENCIA" t
      JOIN public."CHAMADO_SISTEMA" c ON c.id = t.chamado_id
     WHERE t.status = 'pendente'
  ) x
  WHERE public.chamado_pode_decidir()
  ORDER BY 9;
$$;
REVOKE ALL ON FUNCTION public.chamado_pendencias_gestao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_pendencias_gestao() TO authenticated;

-- ── 11. Não finaliza com reabertura pendente ─────────────────────────────
-- Corpo da mig 20261110009000 + a checagem da reabertura.
CREATE OR REPLACE FUNCTION public.chamado_finalizar_gestao(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_gestor_sistemas() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas finaliza o chamado.' USING ERRCODE = '42501';
  END IF;

  SELECT status, conclusao_confirmada_em, gestao_finalizada_em INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'O desenvolvedor ainda não concluiu este chamado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_REABERTURA"
              WHERE chamado_id = p_chamado_id AND status = 'pendente') THEN
    RAISE EXCEPTION 'O solicitante pediu a reabertura — confirme ou negue antes de finalizar.' USING ERRCODE = '22023';
  END IF;
  IF v.conclusao_confirmada_em IS NULL THEN
    RAISE EXCEPTION 'O solicitante ainda não confirmou a conclusão.' USING ERRCODE = '22023';
  END IF;
  IF v.gestao_finalizada_em IS NOT NULL THEN
    RETURN;  -- duplo clique / duas abas
  END IF;

  PERFORM set_config('app.chamado_finalizacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET gestao_finalizada_em = now(), gestao_finalizada_por = auth.uid()
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_finalizacao', 'off', true);

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento', 'Chamado finalizado pelo Gestor de Sistemas',
          jsonb_build_object('acao', 'gestao_finalizada'));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_finalizar_gestao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_finalizar_gestao(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (manual)
-- =========================================================================
-- Reaplicar chamado_finalizar_gestao da mig 20261110009000 e
-- chamado_sistema_guard + chamado_reabrir_nao_atendeu da mig 20261112002000.
-- DROP FUNCTION IF EXISTS public.chamado_pendencias_gestao();
-- DROP FUNCTION IF EXISTS public.chamado_transferencia_decidir(bigint, boolean, text);
-- DROP FUNCTION IF EXISTS public.chamado_transferencia_cancelar(bigint);
-- DROP FUNCTION IF EXISTS public.chamado_transferencia_solicitar(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.chamado_reabertura_decidir(bigint, boolean, uuid, text);
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_transferido ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_transferido();
-- DROP FUNCTION IF EXISTS public.chamado_avisar_usuario(uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.chamado_avisar_decisores(text, text, text, text);
-- DROP FUNCTION IF EXISTS public.chamado_devs_transferencia();
-- DROP FUNCTION IF EXISTS public.chamado_desenvolvedores_ativos();
-- DROP FUNCTION IF EXISTS public.chamado_pode_decidir();
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_TRANSFERENCIA";
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_REABERTURA";
-- NOTIFY pgrst, 'reload schema';
