-- =========================================================================
-- Demissão: o RH também CANCELA (reconsideração) com a solicitação no SST
-- — e o SST é avisado para desmarcar o ASO
--
-- PEDIDO (21/09/2026, Pablo)
--   Hoje (mig 186) o RH só cancela em "Pendente RH". Depois de liberar, a
--   solicitação vai pro SST e o RH perdia o botão — e a reconsideração
--   costuma chegar justamente nesse meio tempo. Agora o RH cancela também
--   nos status do SST; o cancelamento avisa o SST no sino para cancelar o
--   agendamento do ASO demissional.
--
-- O QUE MUDA em demissao_cancelar(p_id, p_motivo, p_anexos)
--   • RH (has_screen_access('rh_demissoes','aprovar')) cancela em:
--       Pendente RH                                        (como antes)
--       Pendente SST                                       (novo)
--       Solicitação de agendamento de DEMISSIONAL recebida (novo)
--       Agendamento concluído                              (novo)
--     "ASO válido" continua fora: ali o SST já CONCLUIU sem exame — não há
--     agendamento a desfazer, a demissão seguiu.
--   • O bloqueio "o ASO já foi agendado, não pode cancelar" (custo do exame)
--     passa a valer só pro SOLICITANTE. O RH pode, porque é ele que decide a
--     reconsideração — e o SST fica sabendo na hora pra desmarcar.
--   • Cancelou com a solicitação no SST → notificação pra quem tem a tela
--     ASO Demissional (sst_aso_demissional, visualizar) — a MESMA regra de
--     destinatário do Malote (malote_usuarios_com_acesso, mig 83: só quem
--     tem a permissão de verdade, sem o "concede tudo" do admin). Se já
--     estava agendado, a notificação traz data, hora e local do exame.
--   • O fio da conversa diz em que etapa foi cancelada.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.demissao_cancelar(p_id bigint, p_motivo text, p_anexos jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d           record;
  v_email     text := lower(coalesce(auth.email(), ''));
  v_nome      text;
  v_vaga      text := NULL;
  v_sou_solic boolean;
  v_sou_rh    boolean;
  v_quem      text;
  v_n_anexos  int := 0;
  a           jsonb;
  v_solic_id  uuid;
  -- Status do SST em que o RH ainda pode cancelar (ver cabeçalho).
  v_status_sst text[] := ARRAY['Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído'];
  v_no_sst    boolean;
  v_exame     text := '';
  v_n_sst     int := 0;
BEGIN
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da reconsideração (mín. 10 caracteres).';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;

  v_sou_solic := lower(coalesce(d.solicitante_email, '')) = v_email;
  v_sou_rh    := public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'::public.app_acao);
  v_no_sst    := d.status = ANY (v_status_sst);

  IF d.status IN ('Concluída', 'Reprovada', 'Cancelada') THEN
    RAISE EXCEPTION 'A solicitação já está %: não há o que cancelar.', lower(d.status);
  END IF;
  IF d.status = 'ASO válido' THEN
    RAISE EXCEPTION 'O SST já concluiu esta solicitação (ASO válido, sem exame demissional) — não há mais o que cancelar.';
  END IF;

  -- O RH decide a reconsideração: vale mesmo quem também é o solicitante,
  -- porque a regra do RH é a mais larga.
  IF v_sou_rh AND (d.status = 'Pendente RH' OR v_no_sst) THEN
    v_quem := 'pelo RH';
  ELSIF v_sou_solic THEN
    IF d.status = 'Agendamento concluído' THEN
      RAISE EXCEPTION 'O ASO demissional já foi agendado — a solicitação não pode mais ser cancelada, porque o exame já tem custo. Fale com o RH.';
    END IF;
    v_quem := 'pelo solicitante';
  ELSIF v_sou_rh THEN
    RAISE EXCEPTION 'O RH cancela a solicitação em Pendente RH ou nas etapas do SST (agora está %).', d.status;
  ELSE
    RAISE EXCEPTION 'Só quem solicitou a demissão, ou o RH (em Pendente RH ou no SST), pode cancelá-la.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = 'Cancelada',
         cancelado_por = coalesce(v_nome, v_email) || CASE WHEN v_quem = 'pelo RH' THEN ' (RH)' ELSE '' END,
         cancelado_em = now(),
         cancelado_motivo = btrim(p_motivo),
         atualizado_em = now()
   WHERE id = p_id;

  -- Os arquivos da reconsideração (já no bucket): viram documentos da solicitação.
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) LOOP
    IF coalesce(a->>'storage_path', '') <> '' THEN
      INSERT INTO public."SISTEMA_SOL_DEMISSAO_ANEXOS" (solicitacao_id, nome, storage_path, tamanho, tipo, enviado_por)
      VALUES (p_id, 'Cancelamento — ' || coalesce(a->>'nome', 'arquivo'), a->>'storage_path',
              nullif(a->>'tamanho', '')::bigint, nullif(a->>'tipo', ''), v_email);
      v_n_anexos := v_n_anexos + 1;
    END IF;
  END LOOP;

  -- A vaga de Substituição que nem abriu ainda cai junto.
  IF d.vaga_id IS NOT NULL THEN
    UPDATE public."SISTEMA_RECRUTAMENTO"
       SET status = 'Cancelada'
     WHERE id = d.vaga_id AND status LIKE 'Pendente%';
    IF FOUND THEN v_vaga := 'cancelada'; ELSE v_vaga := 'mantida'; END IF;
  END IF;

  -- Já estava agendado: a notificação e o fio dizem QUAL exame desmarcar.
  IF d.status = 'Agendamento concluído' THEN
    v_exame := ' Exame agendado: ' || coalesce(to_char(d.sst_data_exame::date, 'DD/MM/YYYY'), 'data não informada')
            || coalesce(' às ' || left(d.sst_hora_exame::text, 5), '')
            || coalesce(' — ' || nullif(rtrim(btrim(d.sst_local_exame::text), '.'), ''), '') || '.';
  END IF;

  -- No fio da conversa, pra todo mundo ver sem abrir o card.
  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, coalesce(v_nome, v_email), v_email,
          '🚫 DEMISSÃO CANCELADA ' || v_quem
          || CASE WHEN v_no_sst THEN ' com a solicitação no SST (' || d.status || ') — SST avisado para cancelar o agendamento do ASO.' ELSE '.' END
          || ' Motivo: ' || btrim(p_motivo)
          || CASE WHEN v_n_anexos > 0 THEN ' (' || v_n_anexos || ' arquivo(s) em Documentos)' ELSE '' END);

  -- Quem pediu fica sabendo — quando não foi ele mesmo que cancelou.
  IF NOT v_sou_solic THEN
    SELECT id INTO v_solic_id FROM public.profiles WHERE lower(email) = lower(coalesce(d.solicitante_email, '')) LIMIT 1;
    IF v_solic_id IS NOT NULL AND v_solic_id IS DISTINCT FROM auth.uid() THEN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_solic_id, 'Demissão cancelada pelo RH (reconsideração)',
              left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—') || ' — ' || btrim(p_motivo), 300),
              'warning', '/app/encarregados/minhas-solicitacoes');
    END IF;
  END IF;

  -- Estava no SST: quem cuida do ASO Demissional desmarca o agendamento.
  IF v_no_sst THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT u, 'Cancelar agendamento do ASO demissional',
           left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—')
                || ' — demissão cancelada pelo RH (reconsideração).' || v_exame
                || ' Motivo: ' || btrim(p_motivo), 300),
           'warning', '/app/sst/aso-demissional'
      FROM public.malote_usuarios_com_acesso('sst_aso_demissional', 'visualizar'::public.app_acao) AS u
     WHERE u IS DISTINCT FROM auth.uid();
    GET DIAGNOSTICS v_n_sst = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'Cancelada', 'vaga', v_vaga, 'anexos', v_n_anexos,
                            'por', v_quem, 'sst_avisados', v_n_sst);
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar demissao_cancelar(bigint, text, jsonb) da 20260930000186.
-- NOTIFY pgrst, 'reload schema';
