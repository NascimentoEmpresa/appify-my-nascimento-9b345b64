-- =========================================================================
-- Chamados de Sistemas: o SOLICITANTE cancela o próprio chamado (com motivo)
--
-- Pedido do Pablo (29/09/2026): "enquanto não foi concluído, deixa opção de
-- cancelar aqui [Acompanhar chamado] e o motivo do cancelamento da
-- solicitação". Até aqui o solicitante só tinha como desistir pedindo pela
-- conversa pra alguém da equipe reprovar — e "reprovado" diz que o TIME
-- recusou, não que quem pediu desistiu.
--
-- COMO
--   • Status novo 'cancelado' (CHECK ampliado) + colunas
--     motivo_cancelamento / cancelado_em. cancelado_em é carimbado pelo
--     gatilho (como concluido_em); o motivo fica gravado mesmo se o chamado
--     for reaberto depois — é o registro de um cancelamento que aconteceu
--     (mesma ideia do motivo_reprovacao).
--   • RPC chamado_cancelar_pelo_solicitante(chamado, motivo): só quem abriu,
--     só enquanto não encerrado (concluído/reprovado/cancelado), motivo com
--     5+ caracteres. Liga a marca app.chamado_solicitante (mig 255) e o
--     gatilho agora aceita 'cancelado' com a marca. Grava "Chamado
--     cancelado: <motivo>" na conversa e reorganiza a fila do responsável.
--   • 'cancelado' é ENCERRADO em todo lugar que já tratava concluído e
--     reprovado como fim de linha: fila do dev, fila global, direcionar,
--     painel (atrasados), conversa fechada, adicionar informação. As funções
--     abaixo são cópia do banco em 29/09/2026 com a lista trocada — nada
--     mais mudou nelas.
--   • chamado_reabrir_pelo_solicitante passa a reabrir também o cancelado
--     (desistiu e mudou de ideia): volta pro responsável, ou pra coordenação
--     se não tiver.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."CHAMADO_SISTEMA" ADD COLUMN IF NOT EXISTS motivo_cancelamento text;
ALTER TABLE public."CHAMADO_SISTEMA" ADD COLUMN IF NOT EXISTS cancelado_em timestamptz;

ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS "CHAMADO_SISTEMA_status_check";
ALTER TABLE public."CHAMADO_SISTEMA" ADD CONSTRAINT "CHAMADO_SISTEMA_status_check"
  CHECK (status IN ('aberto', 'em_andamento', 'aguardando_retorno', 'concluido', 'reprovado', 'cancelado'));

-- ── Gatilho de proteção: cópia do banco + 'cancelado' pela marca do solicitante
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
  -- automação de servidor (conclusão no merge da PR) OU o solicitante pelas
  -- RPCs que ligam app.chamado_solicitante — e aí só para voltar à fila
  -- ('aberto' / 'em_andamento') ou cancelar ('cancelado', mig 260);
  -- concluir ou reprovar continua da equipe.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (v_auto OR v_coord OR v_aprov OR v_resp
       OR (v_solic AND NEW.status IN ('aberto', 'em_andamento', 'cancelado'))) THEN
    RAISE EXCEPTION 'Sem permissão para alterar o status do chamado.';
  END IF;

  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;
  IF NEW.status = 'cancelado' AND NEW.cancelado_em IS NULL THEN NEW.cancelado_em := now(); END IF;
  IF NEW.status <> 'cancelado' THEN NEW.cancelado_em := NULL; END IF;
  RETURN NEW;
END;
$function$;

-- ── chamado_direcionar: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (3x)
CREATE OR REPLACE FUNCTION public.chamado_direcionar(p_chamado_id uuid, p_responsavel_id uuid, p_posicao integer DEFAULT NULL::integer, p_observacao text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_numero    text;
  v_status    text;
  v_anterior  uuid;
  v_total     int;
  v_pos       int;
  v_nome      text;
BEGIN
  IF NOT public.tem_acesso_menu('chamados_sistemas_coordenar') THEN
    RAISE EXCEPTION 'Sem permissão para direcionar chamados.';
  END IF;
  IF p_responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o responsável pela execução.';
  END IF;

  SELECT numero, status, responsavel_id
    INTO v_numero, v_status, v_anterior
    FROM public."CHAMADO_SISTEMA"
   WHERE id = p_chamado_id
     FOR UPDATE;

  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado.';
  END IF;
  IF v_status IN ('concluido', 'reprovado', 'cancelado') THEN
    RAISE EXCEPTION 'Chamado encerrado — não é possível direcionar.';
  END IF;

  -- Tamanho da fila de destino (sem contar o próprio chamado).
  SELECT count(*)::int INTO v_total
    FROM public."CHAMADO_SISTEMA"
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado', 'cancelado')
     AND id <> p_chamado_id;

  v_pos := LEAST(GREATEST(COALESCE(p_posicao, v_total + 1), 1), v_total + 1);

  -- Abre espaço na posição escolhida.
  UPDATE public."CHAMADO_SISTEMA"
     SET posicao_dev = posicao_dev + 1
   WHERE responsavel_id = p_responsavel_id
     AND status NOT IN ('concluido', 'reprovado', 'cancelado')
     AND id <> p_chamado_id
     AND posicao_dev >= v_pos;

  -- Responsável + status + observação (a posição vem no UPDATE seguinte,
  -- senão o trigger de coerência jogaria o chamado para o fim da fila).
  UPDATE public."CHAMADO_SISTEMA"
     SET responsavel_id     = p_responsavel_id,
         status             = CASE WHEN status = 'aberto' THEN 'em_andamento' ELSE status END,
         observacao_gerente = COALESCE(NULLIF(btrim(COALESCE(p_observacao, '')), ''), observacao_gerente)
   WHERE id = p_chamado_id;

  UPDATE public."CHAMADO_SISTEMA" SET posicao_dev = v_pos WHERE id = p_chamado_id;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
  IF v_anterior IS NOT NULL AND v_anterior <> p_responsavel_id THEN
    PERFORM public.chamado_normalizar_fila_dev(v_anterior);
  END IF;

  SELECT display_name INTO v_nome FROM public.profiles WHERE id = p_responsavel_id;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          format('Chamado direcionado a %s — %sº lugar na fila do responsável',
                 COALESCE(v_nome, 'responsável'), v_pos));
END;
$function$;

-- ── chamado_normalizar_fila_dev: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamado_normalizar_fila_dev(p_responsavel_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = f.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY posicao_dev NULLS LAST, created_at, id) AS rn
        FROM public."CHAMADO_SISTEMA"
       WHERE responsavel_id = p_responsavel_id
         AND status NOT IN ('concluido', 'reprovado', 'cancelado')
    ) f
   WHERE c.id = f.id
     AND c.posicao_dev IS DISTINCT FROM f.rn::int;
$function$;

-- ── chamado_reordenar_fila_dev: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamado_reordenar_fila_dev(p_responsavel_id uuid, p_ordem uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (public.tem_acesso_menu('chamados_sistemas_coordenar')
          OR p_responsavel_id = auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para reordenar a fila deste responsável.';
  END IF;

  UPDATE public."CHAMADO_SISTEMA" c
     SET posicao_dev = x.ord
    FROM (SELECT unnest(p_ordem) AS id, generate_subscripts(p_ordem, 1) AS ord) x
   WHERE c.id = x.id
     AND c.responsavel_id = p_responsavel_id
     AND c.status NOT IN ('concluido', 'reprovado', 'cancelado')
     AND c.posicao_dev IS DISTINCT FROM x.ord;

  PERFORM public.chamado_normalizar_fila_dev(p_responsavel_id);
END;
$function$;

-- ── chamado_sistema_fila_dev: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (2x)
CREATE OR REPLACE FUNCTION public.chamado_sistema_fila_dev()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status IN ('concluido', 'reprovado', 'cancelado') OR NEW.responsavel_id IS NULL THEN
    NEW.posicao_dev := NULL;
  ELSIF NEW.posicao_dev IS NULL
     OR (TG_OP = 'UPDATE'
         AND NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
         AND NEW.posicao_dev IS NOT DISTINCT FROM OLD.posicao_dev) THEN
    SELECT COALESCE(max(posicao_dev), 0) + 1 INTO NEW.posicao_dev
      FROM public."CHAMADO_SISTEMA"
     WHERE responsavel_id = NEW.responsavel_id
       AND status NOT IN ('concluido', 'reprovado', 'cancelado')
       AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── chamados_painel_stats: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamados_painel_stats()
 RETURNS TABLE(total integer, abertos integer, em_andamento integer, concluidos_mes integer, atrasados integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'aberto')::int,
    count(*) FILTER (WHERE status = 'em_andamento')::int,
    count(*) FILTER (WHERE status = 'concluido'
                     AND concluido_em >= date_trunc('month', now()))::int,
    count(*) FILTER (WHERE prazo_previsto < current_date
                     AND status NOT IN ('concluido', 'reprovado', 'cancelado'))::int
  FROM public."CHAMADO_SISTEMA"
  WHERE public.chamado_sistema_gestor();
$function$;

-- ── chamados_posicao_fila: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamados_posicao_fila()
 RETURNS TABLE(chamado_id uuid, posicao integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH fila AS (
    SELECT id, solicitante_id, responsavel_id,
           row_number() OVER (ORDER BY created_at ASC, id ASC) AS pos
      FROM public."CHAMADO_SISTEMA"
     WHERE status NOT IN ('concluido', 'reprovado', 'cancelado')
  )
  SELECT id, pos::int
    FROM fila
   WHERE solicitante_id = auth.uid() OR responsavel_id = auth.uid();
$function$;

-- ── chamado_adicionar_informacao: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamado_adicionar_informacao(p_chamado_id uuid, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_status IN ('concluido', 'reprovado', 'cancelado') THEN
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
$function$;

-- ── chamado_enviar_mensagem: cópia do banco (29/09/2026), só a lista de encerrados ganhou 'cancelado' (1x)
CREATE OR REPLACE FUNCTION public.chamado_enviar_mensagem(p_chamado_id uuid, p_texto text, p_interno boolean DEFAULT false, p_tem_anexo boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  IF v_status IN ('concluido', 'reprovado', 'cancelado') AND NOT p_interno THEN
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
$function$;

-- ── Cancelar pelo solicitante ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_cancelar_pelo_solicitante(p_chamado_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_solicitante uuid;
  v_status      text;
  v_responsavel uuid;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Conte por que está cancelando o chamado.';
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
    RAISE EXCEPTION 'Apenas quem abriu o chamado pode cancelá-lo.';
  END IF;
  IF v_status IN ('concluido', 'reprovado', 'cancelado') THEN
    RAISE EXCEPTION 'Este chamado já foi encerrado.';
  END IF;

  PERFORM set_config('app.chamado_solicitante', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET status = 'cancelado', motivo_cancelamento = btrim(p_motivo)
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_solicitante', 'off', true);

  -- Saiu da fila do dev: os de trás sobem uma posição.
  IF v_responsavel IS NOT NULL THEN
    PERFORM public.chamado_normalizar_fila_dev(v_responsavel);
  END IF;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto)
  VALUES (p_chamado_id, auth.uid(), 'evento', 'Chamado cancelado: ' || btrim(p_motivo));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_cancelar_pelo_solicitante(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_cancelar_pelo_solicitante(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_cancelar_pelo_solicitante(uuid, text) TO authenticated;

-- ── Reabrir pelo solicitante: aceita também o cancelado (cópia da mig 255)
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
  IF v_status NOT IN ('concluido', 'reprovado', 'cancelado') THEN
    RAISE EXCEPTION 'O chamado ainda está em atendimento — use a conversa do chamado.';
  END IF;

  -- Reprovado volta SEMPRE pra coordenação; concluído/cancelado voltam pro
  -- responsável (fim da fila dele) quando há um.
  v_novo := CASE WHEN v_status IN ('concluido', 'cancelado') AND v_responsavel IS NOT NULL THEN 'em_andamento' ELSE 'aberto' END;

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

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (antes, reabrir os chamados 'cancelado', senão o CHECK falha)
-- =========================================================================
-- Reaplicar chamado_sistema_guard() e chamado_reabrir_pelo_solicitante() da
-- 20260930000255 e as demais funções acima com a lista de volta para
-- ('concluido', 'reprovado');
-- DROP FUNCTION IF EXISTS public.chamado_cancelar_pelo_solicitante(uuid, text);
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP CONSTRAINT IF EXISTS "CHAMADO_SISTEMA_status_check";
-- ALTER TABLE public."CHAMADO_SISTEMA" ADD CONSTRAINT "CHAMADO_SISTEMA_status_check"
--   CHECK (status IN ('aberto', 'em_andamento', 'aguardando_retorno', 'concluido', 'reprovado'));
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS cancelado_em, DROP COLUMN IF EXISTS motivo_cancelamento;
-- NOTIFY pgrst, 'reload schema';
