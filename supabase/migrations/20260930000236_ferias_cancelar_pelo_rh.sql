-- =========================================================================
-- Férias: o RH cancela mesmo DEPOIS de aprovar, com motivo; o encarregado
-- é avisado e pode refazer.
--
-- Pedido (24/09/2026): "as férias são canceladas após já aprovadas por nós
-- e não conseguimos mais cancelar no sistema. Deixa o RH cancelar as férias
-- do encarregado e informar o motivo. O encarregado vai ser notificado como
-- cancelado com a opção de refazer pra reenviar pra aprovação."
--
--  · Colunas: cancelada_pelo_rh, motivo_cancelamento, cancelada_por,
--    cancelada_em. O status continua 'Cancelada' (libera a trava de
--    duplicidade, filtros e KPIs já conhecem).
--  · ferias_cancelar_pelo_rh(id, motivo): exige alterar em rh_ferias,
--    status Pendente ou Aprovada, motivo com 5+ caracteres. Avisa o
--    solicitante no sino (notificacoes, pelo e-mail do solicitante) e deixa
--    o motivo na conversa da solicitação (SISTEMA_COMENTARIOS 'ferias').
--  · Histórico: o evento 'Cancelada' leva o motivo e o nome de quem cancelou.
--  · Refazer: cancelada pelo RH pode ser refeita, sem o prazo de 7 dias
--    (cancelada pelo próprio encarregado continua sem refazer).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS cancelada_pelo_rh   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS cancelada_por       text,
  ADD COLUMN IF NOT EXISTS cancelada_em        timestamptz;

CREATE OR REPLACE FUNCTION public.ferias_registrar_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id)
    VALUES (NEW.id, 'Criada', NULL, NEW.status, NEW.solicitante_nome, auth.uid());
    RETURN NEW;
  END IF;

  -- Refeita pelo encarregado (16/09/2026): um evento só, mesmo que o status
  -- também tenha mudado (Reprovada → Pendente) — a troca de status faz parte
  -- do refazer, não é uma decisão do RH.
  IF NEW.refeita_em IS DISTINCT FROM OLD.refeita_em AND NEW.refeita_em IS NOT NULL THEN
    -- Cancelada PELO RH (24/09/2026) pode ser refeita a qualquer momento:
    -- o cancelamento costuma vir semanas depois da aprovação.
    IF NOT coalesce(OLD.cancelada_pelo_rh, false)
       AND coalesce(OLD.criado_em, now()) < now() - interval '7 days' THEN
      RAISE EXCEPTION 'Já passou uma semana da solicitação — não é mais possível refazê-la.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'Cancelada' AND NOT coalesce(OLD.cancelada_pelo_rh, false) THEN
      RAISE EXCEPTION 'Solicitação cancelada não pode ser refeita.' USING ERRCODE = 'check_violation';
    END IF;
    v_nome := NULLIF(btrim(coalesce(NEW.solicitante_nome, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, 'Refeita', OLD.status, NEW.status, v_nome, auth.uid(),
            'Saída ' || to_char(NEW.data_saida, 'DD/MM/YYYY') || ' · ' || coalesce(NEW.dias_ferias, 30) || ' dias'
            || CASE WHEN coalesce(NEW.dias_vendidos, 0) > 0 THEN ' · abono ' || NEW.dias_vendidos || ' dias' ELSE '' END);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Quem decidiu: a tela grava aprovado_por junto com o status; sem ele,
    -- cai no nome do usuário logado (profiles) e por fim no e-mail.
    -- Cancelamento pelo RH grava cancelada_por (aprovado_por continua sendo
    -- quem APROVOU antes).
    v_nome := NULLIF(btrim(coalesce(CASE WHEN NEW.status = 'Cancelada' AND NEW.cancelada_pelo_rh THEN NEW.cancelada_por END,
                                    NEW.aprovado_por, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, NEW.status, OLD.status, NEW.status, v_nome, auth.uid(),
            CASE WHEN NEW.status = 'Reprovada' THEN NULLIF(btrim(coalesce(NEW.motivo_reprovacao, '')), '')
                 WHEN NEW.status = 'Cancelada' THEN NULLIF(btrim(coalesce(NEW.motivo_cancelamento, '')), '') END);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.ferias_cancelar_pelo_rh(p_id bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sol    record;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_user   uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar férias (Gestão de Férias › alterar).' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;
  SELECT * INTO v_sol FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação de férias não encontrada.'; END IF;
  IF v_sol.status NOT IN ('Pendente', 'Aprovada') THEN
    RAISE EXCEPTION 'Só dá para cancelar férias pendentes ou aprovadas (esta está "%").', v_sol.status;
  END IF;

  SELECT coalesce(NULLIF(display_name, ''), email) INTO v_nome FROM public.profiles WHERE id = auth.uid();

  UPDATE public."SISTEMA_SOLICITACOES_FERIAS"
     SET status = 'Cancelada', cancelada_pelo_rh = true, motivo_cancelamento = v_motivo,
         cancelada_por = v_nome, cancelada_em = now(), atualizado_em = now()
   WHERE id = p_id;

  -- Aviso no sino de quem pediu (solicitante_id é da tabela antiga; o elo
  -- com o login é o e-mail).
  SELECT p.id INTO v_user FROM public.profiles p
   WHERE lower(p.email) = lower(btrim(coalesce(v_sol.solicitante_email, ''))) LIMIT 1;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_user,
            'Férias canceladas pelo RH',
            coalesce(v_sol.colaborador_nome, 'Colaborador') || ' — saída ' || coalesce(to_char(v_sol.data_saida, 'DD/MM/YYYY'), '—')
              || '. Motivo: ' || v_motivo || '. Você pode refazer e reenviar para aprovação.',
            'ferias_cancelada',
            '/app/encarregados/minhas-solicitacoes?ferias=' || p_id);
  END IF;

  -- O motivo também fica na conversa da solicitação.
  BEGIN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto)
    VALUES ('ferias', p_id::text, coalesce(v_nome, 'RH'), 'Férias canceladas pelo RH. Motivo: ' || v_motivo);
  EXCEPTION WHEN undefined_column OR undefined_table OR invalid_text_representation OR not_null_violation THEN
    NULL;  -- a conversa é complemento: sem ela o cancelamento vale do mesmo jeito
  END;

  RETURN jsonb_build_object('ok', true, 'notificado', v_user IS NOT NULL);
END $fn$;

REVOKE ALL ON FUNCTION public.ferias_cancelar_pelo_rh(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_cancelar_pelo_rh(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ferias_cancelar_pelo_rh(bigint, text);
-- Reaplicar ferias_registrar_historico da 20260930000168.
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP COLUMN IF EXISTS cancelada_pelo_rh,
--   DROP COLUMN IF EXISTS motivo_cancelamento, DROP COLUMN IF EXISTS cancelada_por, DROP COLUMN IF EXISTS cancelada_em;
-- NOTIFY pgrst, 'reload schema';
