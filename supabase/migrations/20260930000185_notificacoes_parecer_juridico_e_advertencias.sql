-- =========================================================================
-- SIS-2026-0434 — Notificações no Parecer Jurídico (dúvidas) e nas
-- Advertências: sino do ERP quando chega demanda nova
--
-- CHAMADO: "adicionar aos sistemas de pareceres jurídicos e de advertências
-- uma notificação quando tiver uma nova demanda — temos prazos e, com as
-- outras atividades, não verificamos os sistemas com frequência".
--
-- O sino (public.notificacoes / Topbar) já é o canal do ERP (Malote, Atas,
-- Compras). Aqui entram triggers SECURITY DEFINER nas duas tabelas, no
-- mesmo desenho do Malote (mig 083): quem recebe é quem TEM A PERMISSÃO da
-- etapa (malote_usuarios_com_acesso — exceção individual ou perfil, sem o
-- "concede tudo" do admin), e quem fez a ação nunca é notificado dela.
--
-- A BOLINHA da sidebar é outra coisa (front, useJuridicoNotif): fica acesa
-- enquanto houver fila — o sino avisa que chegou, a bolinha lembra que
-- ainda está lá.
--
-- QUEM RECEBE O QUÊ
--   Dúvida nova (Aberta) ............ quem APROVA dúvidas (duvidas/aprovar)
--   Dúvida aprovada ................. quem RESPONDE (duvidas/responder)
--   Pergunta complementar ........... quem RESPONDE
--   Dúvida respondida / complemento . quem PERGUNTOU (autor_id)
--   Dúvida reprovada ................ quem PERGUNTOU
--   Advertência nova ................ quem APROVA (advertencias/aprovar)
--   Advertência aprovada (→ Jurídico) quem conclui: advertencias/aprovar e
--                                     advertencias/alterar
--   Advertência concluída/reprovada . quem SOLICITOU (solicitante_email)
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── Helper: manda pro sino, sem repetir e sem o ator ─────────────────────
CREATE OR REPLACE FUNCTION public.jur_notificar(_user_ids uuid[], _titulo text, _mensagem text, _tipo text, _link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT DISTINCT uid, _titulo, left(_mensagem, 300), coalesce(_tipo, 'info'), _link
    FROM unnest(coalesce(_user_ids, '{}'::uuid[])) AS uid
   WHERE uid IS NOT NULL
     AND uid IS DISTINCT FROM auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.jur_notificar(uuid[], text, text, text, text) FROM PUBLIC, anon;

/** Quem tem uma permissão de tela, como array (pra concatenar). */
CREATE OR REPLACE FUNCTION public.jur_quem_tem(_menu text, _acao public.app_acao)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(u), '{}'::uuid[]) FROM public.malote_usuarios_com_acesso(_menu, _acao) AS u;
$fn$;
REVOKE ALL ON FUNCTION public.jur_quem_tem(text, public.app_acao) FROM PUBLIC, anon;

-- ── Dúvidas (Parecer Jurídico) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvidas_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link_gestao text := '/app/juridico/duvidas';
  v_link_autor  text := '/app/central-servicos/orientacoes-juridicas';
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'aprovar'),
      'Nova dúvida jurídica para aprovar',
      coalesce(NEW.titulo, '') || ' — de ' || coalesce(NEW.autor_nome, '—') || coalesce(' · ' || NEW.categoria, ''),
      'info', v_link_gestao);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Aprovada' THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'responder'),
        'Dúvida aprovada — aguardando resposta do Jurídico',
        coalesce(NEW.titulo, '') || coalesce(' · ' || NEW.categoria, ''),
        'warning', v_link_gestao);
    ELSIF NEW.status = 'Respondida' AND OLD.status <> 'Respondida' THEN
      PERFORM public.jur_notificar(ARRAY[NEW.autor_id],
        'Sua dúvida foi respondida pelo Jurídico',
        coalesce(NEW.titulo, '') || ' — avalie a resposta em Minhas solicitações.',
        'success', v_link_autor);
    ELSIF NEW.status = 'Reprovada' THEN
      PERFORM public.jur_notificar(ARRAY[NEW.autor_id],
        'Sua dúvida não foi aprovada',
        coalesce(NEW.titulo, '') || coalesce(' — ' || NEW.motivo_reprovacao, ''),
        'error', v_link_autor);
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_duvidas_notificar ON public."JUR_DUVIDAS";
CREATE TRIGGER trg_jur_duvidas_notificar
  AFTER INSERT OR UPDATE OF status ON public."JUR_DUVIDAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_duvidas_notificar();

-- Complementos: pergunta → quem responde; resposta → quem perguntou.
CREATE OR REPLACE FUNCTION public.jur_duvidas_compl_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d record;
BEGIN
  SELECT titulo, autor_id INTO d FROM public."JUR_DUVIDAS" WHERE id = NEW.duvida_id;
  IF NEW.tipo = 'pergunta' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'responder'),
      'Pergunta complementar numa dúvida já respondida',
      coalesce(d.titulo, '') || ': ' || NEW.texto,
      'warning', '/app/juridico/duvidas');
  ELSE
    PERFORM public.jur_notificar(ARRAY[d.autor_id],
      'O Jurídico complementou a resposta da sua dúvida',
      coalesce(d.titulo, '') || ': ' || NEW.texto,
      'success', '/app/central-servicos/orientacoes-juridicas');
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_duvidas_compl_notificar ON public."JUR_DUVIDAS_COMPLEMENTOS";
CREATE TRIGGER trg_jur_duvidas_compl_notificar
  AFTER INSERT ON public."JUR_DUVIDAS_COMPLEMENTOS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_duvidas_compl_notificar();

-- ── Advertências ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adv_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link      text := '/app/juridico/advertencias';
  v_resumo    text := coalesce(NEW.colaborador_nome, '—') || ' · ' || coalesce(NEW.tipo_advertencia, '') || coalesce(' · grau ' || NEW.grau, '') || coalesce(' · ' || NEW.contrato, '');
  v_solic     uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('advertencias', 'aprovar'),
      'Nova solicitação de advertência para aprovar',
      v_resumo || ' — pedida por ' || coalesce(NEW.solicitante_nome, '—'),
      'info', v_link);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Aguardando Jurídico' THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('advertencias', 'aprovar') || public.jur_quem_tem('advertencias', 'alterar'),
        'Advertência aprovada — aguardando parecer do Jurídico',
        v_resumo, 'warning', v_link);
    ELSIF NEW.status IN ('Concluída', 'Reprovada') THEN
      SELECT id INTO v_solic FROM public.profiles WHERE lower(email) = lower(coalesce(NEW.solicitante_email, '')) LIMIT 1;
      PERFORM public.jur_notificar(ARRAY[v_solic],
        CASE WHEN NEW.status = 'Concluída' THEN 'Advertência concluída pelo Jurídico' ELSE 'Solicitação de advertência reprovada' END,
        v_resumo || coalesce(' — ' || NEW.resultado, '') || coalesce(' — ' || NEW.motivo_reprovacao, ''),
        CASE WHEN NEW.status = 'Concluída' THEN 'success' ELSE 'error' END,
        '/app/encarregados/minhas-solicitacoes');
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_adv_notificar ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_notificar
  AFTER INSERT OR UPDATE OF status ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.adv_notificar();

NOTIFY pgrst, 'reload schema';

-- Conferência: quem receberia hoje.
-- SELECT p.email, 'aprova dúvida' FROM public.malote_usuarios_com_acesso('duvidas','aprovar') u JOIN public.profiles p ON p.id=u
-- UNION ALL SELECT p.email, 'responde dúvida' FROM public.malote_usuarios_com_acesso('duvidas','responder') u JOIN public.profiles p ON p.id=u
-- UNION ALL SELECT p.email, 'aprova advertência' FROM public.malote_usuarios_com_acesso('advertencias','aprovar') u JOIN public.profiles p ON p.id=u;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_adv_notificar ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP TRIGGER IF EXISTS trg_jur_duvidas_compl_notificar ON public."JUR_DUVIDAS_COMPLEMENTOS";
-- DROP TRIGGER IF EXISTS trg_jur_duvidas_notificar ON public."JUR_DUVIDAS";
-- DROP FUNCTION IF EXISTS public.adv_notificar(), public.jur_duvidas_compl_notificar(), public.jur_duvidas_notificar();
-- DROP FUNCTION IF EXISTS public.jur_quem_tem(text, public.app_acao), public.jur_notificar(uuid[], text, text, text, text);
-- NOTIFY pgrst, 'reload schema';
