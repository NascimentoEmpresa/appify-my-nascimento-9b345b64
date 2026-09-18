-- =========================================================================
-- Demissão: o RH também CANCELA (reconsideração) enquanto está "Pendente RH"
-- — com motivo, e podendo anexar arquivo
--
-- PEDIDO (18/09/2026, Pablo)
--   No card do RH, quando a solicitação está Pendente RH, entra a opção
--   CANCELAR | RECONSIDERAÇÃO: tem que explicar, confirmar duas vezes e
--   pode anexar arquivo (o pedido de reconsideração assinado, o e-mail do
--   gestor…). As duas confirmações são do front; aqui entra o que o banco
--   precisa garantir.
--
-- O QUE MUDA
--   demissao_cancelar(p_id, p_motivo, p_anexos jsonb DEFAULT '[]')
--   • Quem pode: o SOLICITANTE (como na mig 182, até o ASO ser agendado) OU
--     quem age na etapa do RH — has_screen_access('rh_demissoes','aprovar'),
--     a mesma ação que o toggle da tela concede — e aí SÓ com a solicitação
--     em 'Pendente RH' (a etapa dele; depois disso é com o SST).
--   • p_anexos: [{nome, storage_path, tamanho, tipo}] já subidos pelo front
--     no bucket demissoes-docs (a policy de INSERT é de qualquer autenticado).
--     A RPC grava as linhas em SISTEMA_SOL_DEMISSAO_ANEXOS com o nome
--     prefixado "Cancelamento —", pra ficarem distinguíveis dos documentos
--     que o encarregado mandou no pedido.
--   • Quem cancelou vai no fio da conversa ("pelo RH" / "pelo solicitante") e,
--     quando NÃO foi o solicitante, ele recebe no sino que a demissão que
--     pediu foi cancelada — e por quê.
--
--   A assinatura antiga (bigint, text) é DERRUBADA antes: com as duas no ar,
--   a chamada com dois argumentos ficaria ambígua ("function is not unique").
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

DROP FUNCTION IF EXISTS public.demissao_cancelar(bigint, text);

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
BEGIN
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da reconsideração (mín. 10 caracteres).';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;

  v_sou_solic := lower(coalesce(d.solicitante_email, '')) = v_email;
  v_sou_rh    := public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'::public.app_acao);

  IF d.status IN ('Concluída', 'Reprovada', 'Cancelada') THEN
    RAISE EXCEPTION 'A solicitação já está %: não há o que cancelar.', lower(d.status);
  END IF;
  IF d.status IN ('Agendamento concluído', 'ASO válido') THEN
    RAISE EXCEPTION 'O ASO demissional já foi agendado — a solicitação não pode mais ser cancelada, porque o exame já tem custo. Fale com o SST.';
  END IF;

  IF v_sou_solic THEN
    v_quem := 'pelo solicitante';
  ELSIF v_sou_rh THEN
    IF d.status <> 'Pendente RH' THEN
      RAISE EXCEPTION 'O RH só cancela a solicitação enquanto ela está Pendente RH (agora está %).', d.status;
    END IF;
    v_quem := 'pelo RH';
  ELSE
    RAISE EXCEPTION 'Só quem solicitou a demissão, ou o RH com a solicitação em Pendente RH, pode cancelá-la.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = 'Cancelada',
         cancelado_por = coalesce(v_nome, v_email) || CASE WHEN v_sou_solic THEN '' ELSE ' (RH)' END,
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

  -- No fio da conversa, pra todo mundo ver sem abrir o card.
  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, coalesce(v_nome, v_email), v_email,
          '🚫 DEMISSÃO CANCELADA ' || v_quem || '. Motivo: ' || btrim(p_motivo)
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

  RETURN jsonb_build_object('id', p_id, 'status', 'Cancelada', 'vaga', v_vaga, 'anexos', v_n_anexos, 'por', v_quem);
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.demissao_cancelar(bigint, text, jsonb);
-- Reaplicar demissao_cancelar(bigint, text) da 20260930000182.
-- NOTIFY pgrst, 'reload schema';
