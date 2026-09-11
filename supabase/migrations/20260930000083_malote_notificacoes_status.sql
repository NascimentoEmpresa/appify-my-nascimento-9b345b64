-- SIS-2026-0332 (Iury): "Fazer com que os usuários recebam notificações
-- quando os seus itens trocam de status, tanto quem cria a despesa
-- recebendo que o item foi aprovado ou pago, quanto o aprovador receber
-- que tem um novo item pra pagar."
--
-- Reaproveita o sininho global (public.notificacoes / Topbar), como o resto
-- do ERP (Atas de Reunião, sup_aprov). Nada de push/WhatsApp/e-mail —
-- só a notificação in-app.
--
-- Decisões confirmadas com o solicitante:
--   * Ao virar aguardando_pagamento, notificar também os 4 pagadores
--     (can_access('malote_pagamento','aprovar')).
--   * Despesa parcelada: uma notificação por parcela paga (trigger
--     dedicado em malote_despesa_parcela) — a despesa-mãe não dispara
--     "despesa paga" quando é parcelada.
--   * A fase de Solicitação/Cotação (antes de virar despesa) também entra.
--
-- Toda a lógica vive em triggers SECURITY DEFINER sobre malote_despesa e
-- malote_despesa_parcela — nenhuma RPC do Malote é tocada. O ator da
-- transição (auth.uid()) nunca é notificado da própria ação.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Helpers
-- ─────────────────────────────────────────────────────────────────────

-- Enumera os user_id que têm um acesso de tela — sem o gate de admin que o
-- list_users_with_menu_access impõe ao CHAMADOR (inútil dentro de um
-- trigger, onde auth.uid() é o aprovador/suprimentos, não um admin).
--
-- NÃO delega em can_access(): aquilo conta o perfil "concede tudo" (admin
-- master), então TODO admin viraria destinatário de "nova despesa pra
-- pagar"/"nova solicitação pra cotar". Aqui é só quem tem a permissão de
-- verdade pra essa tela — exceção individual (screen_permission_user, mais
-- recente vence) ou perfil de acesso comum atribuído.
CREATE OR REPLACE FUNCTION public.malote_usuarios_com_acesso(_menu text, _acao public.app_acao)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH override AS (
    SELECT DISTINCT ON (spu.user_id) spu.user_id, spu.allow
      FROM public.screen_permission_user spu
     WHERE spu.menu_codigo = _menu AND spu.acao = _acao
     ORDER BY spu.user_id, spu.updated_at DESC
  ),
  por_perfil AS (
    SELECT DISTINCT upa.user_id
      FROM public.usuario_perfil_acesso upa
      JOIN public.perfil_acesso pa ON pa.id = upa.perfil_id AND pa.ativo = true
      JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id
     WHERE pap.menu_codigo = _menu AND pap.acao = _acao AND pap.allow = true
  )
  SELECT pr.id
    FROM public.profiles pr
    LEFT JOIN override o ON o.user_id = pr.id
   WHERE pr.ativo = true
     AND COALESCE(o.allow, pr.id IN (SELECT user_id FROM por_perfil));
$$;
REVOKE ALL ON FUNCTION public.malote_usuarios_com_acesso(text, public.app_acao) FROM PUBLIC, anon;

-- Aprovadores de um nível (N1/N2/N3) de uma despesa. Cobre tanto a despesa
-- de classificação única (d.classificacao_id) quanto a de RATEIO
-- (classificacao_id nulo na despesa, uma classificação por linha) —
-- malote_e_aprovador_do_nivel só resolve a primeira. União de todas as
-- linhas.
CREATE OR REPLACE FUNCTION public.malote_aprovadores_nivel(_despesa_id uuid, _nivel smallint)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT u
  FROM (
    SELECT unnest(CASE _nivel
             WHEN 1 THEN c.aprovador1_user_ids
             WHEN 2 THEN c.aprovador2_user_ids
             WHEN 3 THEN c.aprovador3_user_ids
           END) AS u
      FROM public.malote_despesa d
      JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
     WHERE d.id = _despesa_id
    UNION ALL
    SELECT unnest(CASE _nivel
             WHEN 1 THEN c.aprovador1_user_ids
             WHEN 2 THEN c.aprovador2_user_ids
             WHEN 3 THEN c.aprovador3_user_ids
           END) AS u
      FROM public.malote_despesa_rateio_linha rl
      JOIN public.planejamento_orcamentario_classificacao c ON c.id = rl.classificacao_id
     WHERE rl.despesa_id = _despesa_id
  ) x
  WHERE u IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.malote_aprovadores_nivel(uuid, smallint) FROM PUBLIC, anon;

-- Insere uma notificação pra cada user_id da lista, pulando nulos,
-- duplicados e o ator da transição (auth.uid()).
CREATE OR REPLACE FUNCTION public.malote_notificar_usuarios(
  _user_ids uuid[],
  _empresa_id uuid,
  _titulo text,
  _mensagem text,
  _tipo text,
  _link text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.notificacoes (user_id, empresa_id, titulo, mensagem, tipo, link)
  SELECT DISTINCT uid, _empresa_id, _titulo, _mensagem, _tipo, _link
    FROM unnest(_user_ids) AS uid
   WHERE uid IS NOT NULL
     AND uid IS DISTINCT FROM auth.uid();
END;
$$;
REVOKE ALL ON FUNCTION public.malote_notificar_usuarios(uuid[], uuid, text, text, text, text) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger da despesa/solicitação
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_despesa_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status text    := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
  v_old_nivel  smallint := CASE WHEN TG_OP = 'UPDATE' THEN OLD.nivel_aprovacao_atual ELSE NULL END;
  v_link_sol  text := '/app/malote/solicitacao/' || NEW.id::text;
  v_link_desp text := '/app/malote/despesa/' || NEW.id::text;
  v_num  text := NEW.numero;
  v_aprov_sol uuid;
  v_motivo text := COALESCE(NEW.cotacao_reprovada_motivo, NEW.motivo_ajuste);
BEGIN
  -- UPDATE OF dispara mesmo quando o valor não mudou; ignora esse caso.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM v_old_status
     AND NEW.nivel_aprovacao_atual IS NOT DISTINCT FROM v_old_nivel THEN
    RETURN NULL;
  END IF;

  SELECT c.aprovador_solicitacao_user_id INTO v_aprov_sol
    FROM public.planejamento_orcamentario_classificacao c
   WHERE c.id = NEW.classificacao_id;

  IF NEW.status IS DISTINCT FROM v_old_status THEN
    -- ── Fase de Solicitação ──────────────────────────────────────────
    IF NEW.status = 'aguardando_aprovacao_inicial' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[v_aprov_sol], NEW.empresa_id,
        'Nova solicitação para aprovar',
        format('A solicitação %s aguarda sua aprovação inicial.', v_num),
        'malote_solicitacao_pendente', v_link_sol);

    ELSIF NEW.status = 'aguardando_cotacao' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_usuarios_com_acesso('sup_cotacoes_malote', 'visualizar')),
        NEW.empresa_id,
        CASE WHEN v_old_status = 'cotacao_realizada'
             THEN 'Cotação reprovada — refazer' ELSE 'Nova solicitação para cotar' END,
        CASE WHEN v_old_status = 'cotacao_realizada'
             THEN format('A cotação da solicitação %s foi reprovada%s.', v_num,
                         COALESCE(': ' || v_motivo, ''))
             ELSE format('A solicitação %s está liberada para cotação.', v_num) END,
        'malote_cotacao_suprimentos', v_link_sol);

    ELSIF NEW.status = 'cotacao_realizada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[v_aprov_sol], NEW.empresa_id,
        'Cotação pronta para decisão',
        format('A cotação da solicitação %s aguarda sua aprovação.', v_num),
        'malote_cotacao_decisao', v_link_sol);

    ELSIF NEW.status = 'cotacao_aprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Cotação aprovada',
        format('A cotação da sua solicitação %s foi aprovada.', v_num),
        'malote_status', v_link_sol);

    ELSIF NEW.status = 'solicitacao_reprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Solicitação reprovada',
        format('Sua solicitação %s foi reprovada%s.', v_num, COALESCE(': ' || v_motivo, '')),
        'malote_status', v_link_sol);

    -- ── Fase de Despesa ──────────────────────────────────────────────
    ELSIF NEW.status = 'pendente_aprovacao' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_aprovadores_nivel(NEW.id, COALESCE(NEW.nivel_aprovacao_atual, 1)::smallint)),
        NEW.empresa_id,
        'Nova despesa para aprovar',
        format('A despesa %s aguarda sua aprovação (N%s).', v_num, COALESCE(NEW.nivel_aprovacao_atual, 1)),
        'malote_aprovacao_pendente', v_link_desp);

    ELSIF NEW.status = 'necessidade_de_ajuste' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Despesa precisa de ajuste',
        format('A despesa %s precisa de ajuste%s.', v_num, COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);

    ELSIF NEW.status = 'aguardando_pagamento' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Despesa aprovada',
        format('Sua despesa %s foi aprovada e liberada para pagamento.', v_num),
        'malote_status', v_link_desp);
      PERFORM public.malote_notificar_usuarios(
        ARRAY(SELECT public.malote_usuarios_com_acesso('malote_pagamento', 'aprovar')),
        NEW.empresa_id,
        'Nova despesa para pagar',
        format('A despesa %s está liberada para pagamento.', v_num),
        'malote_status', v_link_desp);

    ELSIF NEW.status = 'ajuste_pagamento' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Pagamento precisa de ajuste',
        format('O pagamento da despesa %s voltou para ajuste%s.', v_num,
               COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);

    ELSIF NEW.status = 'despesa_paga' THEN
      -- Parcelada: quem notifica é o trigger de parcela, uma por parcela.
      IF NOT NEW.parcelado THEN
        PERFORM public.malote_notificar_usuarios(
          ARRAY[NEW.created_by], NEW.empresa_id,
          'Despesa paga',
          format('Sua despesa %s foi paga.', v_num),
          'malote_status', v_link_desp);
      END IF;

    ELSIF NEW.status = 'despesa_reprovada' THEN
      PERFORM public.malote_notificar_usuarios(
        ARRAY[NEW.created_by], NEW.empresa_id,
        'Despesa reprovada',
        format('Sua despesa %s foi reprovada%s.', v_num, COALESCE(': ' || NEW.motivo_ajuste, '')),
        'malote_status', v_link_desp);
    END IF;

  -- ── Só o nível mudou: escalada N -> N+1, status segue pendente_aprovacao
  ELSIF NEW.status = 'pendente_aprovacao'
        AND COALESCE(NEW.nivel_aprovacao_atual, 0) > COALESCE(v_old_nivel, 0) THEN
    PERFORM public.malote_notificar_usuarios(
      ARRAY(SELECT public.malote_aprovadores_nivel(NEW.id, NEW.nivel_aprovacao_atual::smallint)),
      NEW.empresa_id,
      'Despesa escalada para sua aprovação',
      format('A despesa %s subiu para aprovação N%s.', v_num, NEW.nivel_aprovacao_atual),
      'malote_aprovacao_pendente', v_link_desp);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS malote_despesa_notificar_trg ON public.malote_despesa;
CREATE TRIGGER malote_despesa_notificar_trg
  AFTER INSERT OR UPDATE OF status, nivel_aprovacao_atual ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_notificar();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Trigger da parcela (pagamento por parcela, SIS-2026-0223)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.malote_parcela_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_created_by uuid;
  v_empresa_id uuid;
  v_numero text;
  v_total int;
  v_restantes int;
BEGIN
  IF NEW.status <> 'paga' OR OLD.status = 'paga' THEN
    RETURN NULL;
  END IF;

  SELECT d.created_by, d.empresa_id, d.numero
    INTO v_created_by, v_empresa_id, v_numero
    FROM public.malote_despesa d WHERE d.id = NEW.despesa_id;

  SELECT count(*), count(*) FILTER (WHERE status <> 'paga')
    INTO v_total, v_restantes
    FROM public.malote_despesa_parcela WHERE despesa_id = NEW.despesa_id;

  PERFORM public.malote_notificar_usuarios(
    ARRAY[v_created_by], v_empresa_id,
    CASE WHEN v_restantes = 0 THEN 'Despesa quitada' ELSE 'Parcela paga' END,
    format('A parcela %s/%s da despesa %s foi paga%s.',
           NEW.numero_parcela, v_total, v_numero,
           CASE WHEN v_restantes = 0 THEN ' — despesa quitada' ELSE '' END),
    'malote_status', '/app/malote/despesa/' || NEW.despesa_id::text);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS malote_parcela_notificar_trg ON public.malote_despesa_parcela;
CREATE TRIGGER malote_parcela_notificar_trg
  AFTER UPDATE OF status ON public.malote_despesa_parcela
  FOR EACH ROW EXECUTE FUNCTION public.malote_parcela_notificar();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS malote_parcela_notificar_trg ON public.malote_despesa_parcela;
--   DROP TRIGGER IF EXISTS malote_despesa_notificar_trg ON public.malote_despesa;
--   DROP FUNCTION IF EXISTS public.malote_parcela_notificar();
--   DROP FUNCTION IF EXISTS public.malote_despesa_notificar();
--   DROP FUNCTION IF EXISTS public.malote_notificar_usuarios(uuid[], uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.malote_aprovadores_nivel(uuid, smallint);
--   DROP FUNCTION IF EXISTS public.malote_usuarios_com_acesso(text, public.app_acao);
