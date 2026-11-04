-- =========================================================================
-- FÉRIAS — o encarregado cancela a própria solicitação (04/11/2026)
--
-- Print do Pablo: #323 LISIANE DA SILVA, Aprovada, "Refazer indisponível —
-- já passou uma semana". O encarregado ficava sem saída: não refazia e não
-- tinha como cancelar. Pablo: "deixa o prazo de 7 dias, só coloca a
-- informação que já passou o prazo ela precisa cancelar essa solicitação e
-- fazer outra novamente. E adiciona o botão de cancelar solicitação."
--
--   1. ferias_cancelar_pelo_solicitante(id, motivo): quem pediu (o e-mail do
--      login = solicitante_email) cancela a Pendente ou Aprovada enquanto as
--      férias não começaram (saída > hoje; venda sem data: só Pendente).
--      Motivo obrigatório. cancelada_pelo_rh = false → NÃO se refaz (a regra
--      do refazer continua: só a cancelada pelo RH volta); o caminho é pedir
--      outra, e a cancelada deixa de contar para a duplicidade/fracionamento.
--      O RH (rh_ferias › alterar) recebe aviso no sino e o motivo fica na
--      conversa.
--   2. ferias_registrar_historico: no evento "Cancelada", quem cancelou vem de
--      cancelada_por (antes só quando era o RH; do contrário caía em
--      aprovado_por e o histórico diria que o APROVADOR cancelou). Resto igual
--      à versão do banco (pg_get_functiondef em 04/11/2026).
--
-- A mesma regra na tela: src/lib/solicitacoes/feriasRefazer.ts
-- (podeCancelarFerias, com teste).
-- =========================================================================

-- ── 1. Cancelar pelo solicitante ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_cancelar_pelo_solicitante(p_id bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sol    record;
  v_email  text;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre no sistema para cancelar.' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  SELECT * INTO v_sol FROM public."SISTEMA_SOLICITACOES_FERIAS" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação de férias não encontrada.'; END IF;

  SELECT p.email, coalesce(NULLIF(p.display_name, ''), p.email) INTO v_email, v_nome
    FROM public.profiles p WHERE p.id = auth.uid();
  IF lower(btrim(coalesce(v_sol.solicitante_email, ''))) = '' OR lower(btrim(v_sol.solicitante_email)) <> lower(btrim(coalesce(v_email, ''))) THEN
    RAISE EXCEPTION 'Só quem fez a solicitação pode cancelá-la por aqui. Fale com o RH.' USING ERRCODE = '42501';
  END IF;
  IF v_sol.status NOT IN ('Pendente', 'Aprovada') THEN
    RAISE EXCEPTION 'Só dá para cancelar solicitação pendente ou aprovada (esta está "%").', v_sol.status;
  END IF;
  IF v_sol.data_saida IS NULL AND v_sol.status <> 'Pendente' THEN
    RAISE EXCEPTION 'Venda de férias já aprovada não pode ser cancelada por aqui — fale com o RH pela conversa.';
  END IF;
  IF v_sol.data_saida IS NOT NULL AND v_sol.data_saida <= (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'As férias já começaram — não dá mais para cancelar por aqui. Fale com o RH pela conversa.';
  END IF;

  UPDATE public."SISTEMA_SOLICITACOES_FERIAS"
     SET status = 'Cancelada', cancelada_pelo_rh = false, motivo_cancelamento = v_motivo,
         cancelada_por = v_nome, cancelada_em = now(), atualizado_em = now()
   WHERE id = p_id;

  -- Aviso ao RH: uma aprovada cancelada pode já ter ido para a Senior.
  PERFORM public.jur_notificar(public.jur_quem_tem('rh_ferias', 'alterar'),
    'Solicitação de férias cancelada pelo encarregado',
    '#' || p_id || ' · ' || coalesce(v_sol.colaborador_nome, '—')
      || coalesce(' — saída ' || to_char(v_sol.data_saida, 'DD/MM/YYYY'), '')
      || ' (estava ' || v_sol.status || ') · por ' || coalesce(v_nome, '—') || '. Motivo: ' || v_motivo,
    'info', '/app/rh/ferias');

  BEGIN
    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, texto)
    VALUES ('ferias', p_id::text, coalesce(v_nome, 'Encarregado'), 'Solicitação cancelada pelo encarregado. Motivo: ' || v_motivo);
  EXCEPTION WHEN undefined_column OR undefined_table OR invalid_text_representation OR not_null_violation THEN
    NULL;  -- a conversa é complemento: sem ela o cancelamento vale do mesmo jeito
  END;

  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE ALL ON FUNCTION public.ferias_cancelar_pelo_solicitante(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_cancelar_pelo_solicitante(bigint, text) TO authenticated;

-- ── 2. Histórico: quem cancelou vem de cancelada_por ─────────────────────
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
      RAISE EXCEPTION 'Já passou o prazo de 7 dias — não é mais possível refazer esta solicitação. Cancele-a e faça uma nova.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'Cancelada' AND NOT coalesce(OLD.cancelada_pelo_rh, false) THEN
      RAISE EXCEPTION 'Solicitação cancelada não pode ser refeita — faça uma nova solicitação.' USING ERRCODE = 'check_violation';
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
    -- Cancelamento (pelo RH ou, desde 04/11/2026, pelo encarregado) grava
    -- cancelada_por — aprovado_por continua sendo quem APROVOU antes.
    v_nome := NULLIF(btrim(coalesce(CASE WHEN NEW.status = 'Cancelada' THEN NEW.cancelada_por END,
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

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.ferias_cancelar_pelo_solicitante(bigint, text);
-- ferias_registrar_historico: reaplicar a versão da mig 20260930000236 (cancelada_por só quando cancelada_pelo_rh).
-- NOTIFY pgrst, 'reload schema';
