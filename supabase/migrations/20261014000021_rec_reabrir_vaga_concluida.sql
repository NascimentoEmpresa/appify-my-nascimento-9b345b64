-- =========================================================================
-- Recrutamento: reabrir vaga concluída SEM candidato (14/10/2026)
--
-- Pedido do Pablo (print da solicitação #1247, migrada do Discord): "quando
-- uma vaga é migrada do discord e já está concluída, não dá pra cancelar a
-- admissão, porque foi concluída sem ninguém. Adiciona opção: se cancelar a
-- admissão vai abrir a vaga novamente no status inicial da triagem, sem
-- ninguém mesmo."
--
-- O rec_cancelar_admissao (mig 20261014000019) parte de um CANDIDATO em
-- ADMISSÃO — a vaga importada não tem nenhum, e o kanban ficava vazio sem
-- nada para clicar. rec_reabrir_vaga faz a outra metade sozinha: a vaga
-- Contratado/Concluída volta para "Vaga aberta - Seleção de Currículos" (o
-- status da vaga com candidatos em ENTRADA/TRIAGEM — o início do kanban), sem
-- contratado_nome, com o motivo no histórico.
--
-- Mesma capacidade ("PODE CANCELAR ADMISSÃO") e mesma marca de transação que
-- a trava da vaga já aceita (app.rec_cancelar_admissao: só status,
-- status_changed_at e contratado_nome). Se ainda houver alguém em ADMISSÃO,
-- recusa: aí o certo é cancelar a admissão DELE, que já reabre a vaga.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_reabrir_vaga(p_vaga bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  r        record;
  v_quem   text;
  v_email  text;
  v_adm    text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_cancelar_admissao', 'aprovar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem "PODE CANCELAR ADMISSÃO". Peça ao administrador em Acesso por Usuário (Recrutamento e Seleção).'
      USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da reabertura (mínimo 10 caracteres).';
  END IF;

  SELECT * INTO r FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não encontrada.', p_vaga; END IF;
  IF coalesce(r.administrativa, false)
     AND NOT (public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
              OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Solicitação #% não encontrada.', p_vaga;
  END IF;
  IF NOT (r.status IN ('Contratado', 'Concluída') OR r.status LIKE 'Concluído%') THEN
    RAISE EXCEPTION 'A solicitação #% não está concluída (está em "%").', p_vaga, r.status;
  END IF;

  SELECT c.nome INTO v_adm FROM public."WA_CURRICULOS" c
   WHERE c.vaga_id = p_vaga AND c.etapa_processo = 'ADMISSÃO'
   ORDER BY c.id DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% ainda está em Admissão nesta vaga. Use "Cancelar admissão" no card dele — isso já reabre a vaga.',
      coalesce(v_adm, 'Um candidato');
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_quem, v_email
    FROM public.profiles WHERE id = v_uid;

  PERFORM set_config('app.rec_cancelar_admissao', 'on', true);
  UPDATE public."SISTEMA_RECRUTAMENTO"
     SET status = 'Vaga aberta - Seleção de Currículos', contratado_nome = NULL
   WHERE id = p_vaga;
  PERFORM set_config('app.rec_cancelar_admissao', 'off', true);

  INSERT INTO public."RECRUTAMENTO_HISTORICO"
    (solicitacao_id, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe)
  VALUES
    (p_vaga, 'Conclusão cancelada — vaga reaberta (sem candidato na Admissão)', r.status,
     'Vaga aberta - Seleção de Currículos', 'Recrutamento', v_quem, v_email,
     v_motivo || CASE WHEN r.contratado_nome IS NOT NULL THEN ' · Contratado registrado: ' || r.contratado_nome ELSE '' END);
END $fn$;

REVOKE ALL ON FUNCTION public.rec_reabrir_vaga(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_reabrir_vaga(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rec_reabrir_vaga(bigint, text);
-- NOTIFY pgrst, 'reload schema';
