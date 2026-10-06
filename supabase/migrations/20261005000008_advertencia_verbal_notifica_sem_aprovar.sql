-- =========================================================================
-- Jurídico › ADVERTÊNCIAS — verbal não notifica "para aprovar" (05/10/2026)
--
-- BUG (Gustavo/Jurídico, 05/10/2026): chegou "Nova solicitação de
-- advertência para aprovar" (Carlos Roberto Nunes da Silva · Verbal · grau
-- Alto · UFRGS Jardinagem), mas em "Aguardando Aprovação" não havia nada.
--
-- CAUSA: a advertência VERBAL não passa por aprovação — nasce "Registrada"
-- (22/09/2026) e fica na aba "Verbais registradas". O gatilho adv_notificar
-- mandava a mesma notificação "para aprovar" em TODO insert, sem olhar o
-- status (id 29, 05/10/2026 18:12, já nasceu Registrada).
--
-- AGORA: insert "Registrada" → "Advertência verbal registrada" (só aviso),
-- com link direto para a aba das verbais (/app/juridico/advertencias?aba=
-- Registrada). O resto do gatilho é o mesmo.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.adv_notificar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link      text := '/app/juridico/advertencias';
  v_resumo    text := coalesce(NEW.colaborador_nome, '—') || ' · ' || coalesce(NEW.tipo_advertencia, '') || coalesce(' · grau ' || NEW.grau, '') || coalesce(' · ' || NEW.contrato, '');
  v_solic     uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Registrada' THEN
      -- Verbal: já registrada pelo encarregado, ninguém aprova.
      PERFORM public.jur_notificar(public.jur_quem_tem('advertencias', 'aprovar'),
        'Advertência verbal registrada',
        v_resumo || ' — registrada por ' || coalesce(NEW.solicitante_nome, '—') || ' (não precisa de aprovação)',
        'info', v_link || '?aba=Registrada');
    ELSE
      PERFORM public.jur_notificar(public.jur_quem_tem('advertencias', 'aprovar'),
        'Nova solicitação de advertência para aprovar',
        v_resumo || ' — pedida por ' || coalesce(NEW.solicitante_nome, '—'),
        'info', v_link);
    END IF;
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
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar adv_notificar sem o ramo IF NEW.status = 'Registrada'.
