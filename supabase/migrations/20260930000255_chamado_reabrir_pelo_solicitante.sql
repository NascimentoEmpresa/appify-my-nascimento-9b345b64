-- =========================================================================
-- Chamados de Sistemas: o SOLICITANTE pode reabrir o próprio chamado
--
-- Pedido do Pablo (28/09/2026): "Permitir que o usuário reabra a solicitação
-- quando necessário." Até aqui só reabria quem coordena, aprova ou é o dev
-- responsável (ReabrirChamadoDialog) — o solicitante, que é quem descobre que
-- a entrega não resolveu, tinha que abrir um chamado novo e recontar tudo.
--
-- COMO
--   RPC chamado_reabrir_pelo_solicitante(chamado, motivo): valida que quem
--   chama é o solicitante e que o chamado está encerrado; motivo obrigatório
--   (vai pro histórico/conversa como "Chamado reaberto: <motivo>", o mesmo
--   texto que ChatChamado já traduz para "Fulano reabriu o chamado — …").
--     concluido → volta pro responsável ('em_andamento', fim da fila dele)
--                 ou pra coordenação ('aberto') se não tiver responsável —
--                 mesma regra de statusAoReabrir / chamado_adicionar_informacao;
--     reprovado → SEMPRE 'aberto': a coordenação/aprovação decide de novo.
--                 O solicitante não "desreprova" nada sozinho.
--
--   O gatilho chamado_sistema_guard barra troca de status de quem não é da
--   equipe — e dentro de SECURITY DEFINER o auth.uid() continua sendo o
--   solicitante. Por isso a RPC liga a marca de transação
--   app.chamado_solicitante (set_config local, some no fim da transação; o
--   PostgREST não expõe set_config ao cliente) e o gatilho, com a marca,
--   deixa passar SÓ a troca de status: os campos de abertura/coordenação e a
--   reprovação continuam travados como antes. Mesmo desenho da marca
--   app.exclusao_usuario (mig 20260930000093).
--
--   chamado_adicionar_informacao (mig 20260804000001) e
--   chamado_enviar_mensagem (mig 20260831000001) tinham o mesmo problema: o
--   UPDATE de 'aguardando_retorno' → 'em_andamento' feito em nome do
--   solicitante batia no gatilho e derrubava a transação inteira (a mensagem
--   dele não era gravada). As duas passam a ligar a marca também.
--
-- O gatilho abaixo é a cópia da versão da mig 093 (conferida contra o banco
-- em 28/09/2026) + o bloco v_solic.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  -- Faxina de exclusão de usuário (admin_excluir_usuario_completo).
  v_faxina boolean := COALESCE(current_setting('app.exclusao_usuario', true) = 'on', false);
  -- Automação de servidor: edge function com service_role, sem sessão.
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
  -- Solicitante devolvendo/reabrindo o próprio chamado por RPC (mig 255).
  v_solic boolean := COALESCE(current_setting('app.chamado_solicitante', true) = 'on', false);
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

  -- Demais mudanças de status: coordenar, aprovar, o dev responsável, a
  -- automação de servidor (conclusão no merge da PR) OU o solicitante pelas
  -- RPCs que ligam app.chamado_solicitante — e aí só para voltar à fila
  -- ('aberto' / 'em_andamento'); concluir ou reprovar continua da equipe.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp
       OR (v_solic AND NEW.status IN ('aberto', 'em_andamento'))) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  RETURN NEW;
END;
$$;

-- ── Reabrir pelo solicitante ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_reabrir_pelo_solicitante(p_chamado_id uuid, p_motivo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_responsavel uuid;
  v_novo        text;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Conte por que o chamado precisa ser reaberto.';
  END IF;

  SELECT solicitante_id, status, responsavel_id
    INTO v_solicitante, v_status, v_responsavel
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Apenas quem abriu o chamado pode reabri-lo por aqui.';
  END IF;
  IF v_status NOT IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado ainda está em atendimento — use a conversa do chamado.';
  END IF;

  v_novo := CASE WHEN v_status = 'concluido' AND v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END;

  PERFORM set_config('app.chamado_solicitante', 'on', true);
  UPDATE public."CHAMADO_SISTEMA" SET status = v_novo WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_solicitante', 'off', true);

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento', 'Chamado reaberto: ' || btrim(p_motivo));

  RETURN v_novo;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_reabrir_pelo_solicitante(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_reabrir_pelo_solicitante(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_reabrir_pelo_solicitante(uuid, text) TO authenticated;

-- ── Adicionar informação: mesma marca (cópia da mig 20260804000001) ──────
CREATE OR REPLACE FUNCTION public.chamado_adicionar_informacao(
  p_chamado_id uuid,
  p_texto      text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_responsavel uuid;
BEGIN
  IF p_texto IS NULL OR btrim(p_texto) = '' THEN
    RAISE EXCEPTION 'Informe o texto com as informações.';
  END IF;

  SELECT solicitante_id, status, responsavel_id
    INTO v_solicitante, v_status, v_responsavel
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_solicitante <> auth.uid() THEN
    RAISE EXCEPTION 'Apenas o solicitante pode adicionar informações a este chamado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível adicionar informações.';
  END IF;

  -- (1) histórico: visível ao solicitante, ao responsável e à gestão.
  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'comentario', btrim(p_texto));

  -- (2) devolve ao time quando estava aguardando o retorno do solicitante.
  IF v_status = 'aguardando_retorno' THEN
    PERFORM set_config('app.chamado_solicitante', 'on', true);
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
    PERFORM set_config('app.chamado_solicitante', 'off', true);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_adicionar_informacao(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_adicionar_informacao(uuid, text) TO authenticated;

-- ── Conversa: mesma marca (cópia da mig 20260831000001, conferida contra o
--    banco em 28/09/2026) — o solicitante respondendo o "aguardando retorno"
--    pelo chat devolve o chamado ao time, e esse UPDATE também batia no guard.
CREATE OR REPLACE FUNCTION public.chamado_enviar_mensagem(
  p_chamado_id uuid,
  p_texto      text,
  p_interno    boolean DEFAULT false,
  p_tem_anexo  boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_solicitante uuid;
  v_responsavel uuid;
  v_status      text;
  v_equipe      boolean;
  v_texto       text := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_id          uuid;
BEGIN
  IF v_texto IS NULL AND NOT p_tem_anexo THEN
    RAISE EXCEPTION 'Escreva uma mensagem ou anexe um arquivo.' USING ERRCODE = '22023';
  END IF;

  SELECT c.solicitante_id, c.responsavel_id, c.status
    INTO v_solicitante, v_responsavel, v_status
    FROM public."CHAMADO_SISTEMA" c WHERE c.id = p_chamado_id;

  IF v_solicitante IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = '42704';
  END IF;

  v_equipe := (v_responsavel = v_uid) OR public.chamado_sistema_gestor();

  IF NOT (v_equipe OR v_solicitante = v_uid) THEN
    RAISE EXCEPTION 'Sem acesso à conversa deste chamado.' USING ERRCODE = '42501';
  END IF;
  IF p_interno AND NOT v_equipe THEN
    RAISE EXCEPTION 'Somente a equipe registra mensagens internas.' USING ERRCODE = '42501';
  END IF;
  -- Chamado encerrado ainda aceita registro interno (a equipe documenta o que
  -- ficou), mas não aceita mais conversa com o solicitante.
  IF v_status IN ('concluido', 'reprovado') AND NOT p_interno THEN
    RAISE EXCEPTION 'Chamado encerrado — a conversa está fechada.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, v_uid,
          CASE WHEN p_interno THEN 'observacao_interna' ELSE 'comentario' END,
          v_texto)
  RETURNING id INTO v_id;

  -- Quem escreveu já leu a própria mensagem.
  INSERT INTO public."CHAMADO_SISTEMA_LEITURA" (chamado_id, user_id, lido_em)
  VALUES (p_chamado_id, v_uid, now())
  ON CONFLICT (chamado_id, user_id)
  DO UPDATE SET lido_em = GREATEST(public."CHAMADO_SISTEMA_LEITURA".lido_em, EXCLUDED.lido_em);

  -- Solicitante respondeu o "aguardando retorno" → volta pro time.
  IF v_solicitante = v_uid AND NOT v_equipe AND v_status = 'aguardando_retorno' THEN
    PERFORM set_config('app.chamado_solicitante', 'on', true);
    UPDATE public."CHAMADO_SISTEMA"
       SET status = CASE WHEN v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END
     WHERE id = p_chamado_id;
    PERFORM set_config('app.chamado_solicitante', 'off', true);
  END IF;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_enviar_mensagem(uuid, text, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar chamado_sistema_guard() da 20260930000093,
-- chamado_adicionar_informacao() da 20260804000001 e
-- chamado_enviar_mensagem() da 20260831000001;
-- DROP FUNCTION IF EXISTS public.chamado_reabrir_pelo_solicitante(uuid, text);
-- NOTIFY pgrst, 'reload schema';
