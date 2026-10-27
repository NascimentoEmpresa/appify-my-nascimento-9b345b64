-- =========================================================================
-- TREINAMENTOS — SOLICITAR TREINAMENTO: 4 ETAPAS, VÁRIAS DATAS E A DATA
-- APROVADA PELO ENCARREGADO (27/10/2026)
--
-- PEDIDO (Pablo, sobre a mig 20261026000910):
--   1. A etapa 4 "Estrutura" entra na 2 "Necessidade" (o wizard fica com 4).
--   2. Modalidade só Presencial ou Online — Híbrido sai.
--   3. Treinamentos valida: aceita ou reprova (reprovar exige motivo). Vale
--      para presencial E online (confirmado com o Pablo: online não pula).
--   4. Saem: transporte dos participantes, materiais impressos, projetor e
--      computador, instrutor especializado (o bloco "Recursos necessários"
--      inteiro, já que só sobraria "Sala", que o checklist já pergunta; e a
--      pergunta de transporte do checklist).
--   5. Saem hora de início e de término.
--   6. Data prevista: mais de uma data (datas_previstas date[]).
--   7. Depois que Treinamentos informa a data, o ENCARREGADO (quem pediu)
--      aprova — ou pede outra, com motivo, e volta para Treinamentos.
--
-- FLUXO / STATUS (novo: data_informada)
--   pendente       → enviada; Treinamentos aceita, reprova (motivo) ou
--                    devolve para ajuste. O encarregado pode cancelar.
--   aprovada       → aceita, aguardando Treinamentos informar a data.
--   data_informada → Treinamentos informou; aguardando o encarregado aprovar.
--                    Pedir outra data (motivo) volta para aprovada.
--   agendada       → o encarregado aprovou a data. Remarcar volta para
--                    data_informada (o encarregado aprova de novo).
--   concluida · reprovada · cancelada — como antes.
--
-- As colunas antigas (horario_inicio/fim, recursos, precisa_transporte)
-- ficam na tabela com o que já foi gravado; a tela e as RPCs param de usá-las.
-- data_preferencial passa a ser a PRIMEIRA das datas_previstas (a fila de
-- Treinamentos ordena por ela). Híbrida gravada vira presencial (tem local e
-- checklist, que é o que a presencial exige).
-- Idempotente.
-- =========================================================================

-- ── 1) Colunas e checks ──────────────────────────────────────────────────
ALTER TABLE public."TRN_SOLICITACAO" ADD COLUMN IF NOT EXISTS datas_previstas date[] NOT NULL DEFAULT '{}';
ALTER TABLE public."TRN_SOLICITACAO" ADD COLUMN IF NOT EXISTS data_recusa_motivo text;
ALTER TABLE public."TRN_SOLICITACAO" ADD COLUMN IF NOT EXISTS data_aprovada_em timestamptz;

UPDATE public."TRN_SOLICITACAO" SET datas_previstas = ARRAY[data_preferencial]
 WHERE data_preferencial IS NOT NULL AND cardinality(datas_previstas) = 0;
UPDATE public."TRN_SOLICITACAO" SET modalidade = 'presencial' WHERE modalidade = 'hibrida';

-- Os CHECKs de status e modalidade nasceram inline (nome automático): acha
-- pelo texto e recria com nome fixo.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public."TRN_SOLICITACAO"'::regclass AND contype = 'c'
              AND (pg_get_constraintdef(oid) ILIKE '%status%' OR pg_get_constraintdef(oid) ILIKE '%modalidade%')
  LOOP
    EXECUTE format('ALTER TABLE public."TRN_SOLICITACAO" DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public."TRN_SOLICITACAO" ADD CONSTRAINT trn_sol_status
  CHECK (status IN ('pendente', 'aprovada', 'data_informada', 'agendada', 'concluida', 'reprovada', 'cancelada'));
ALTER TABLE public."TRN_SOLICITACAO" ADD CONSTRAINT trn_sol_modalidade
  CHECK (modalidade IN ('presencial', 'online'));

-- ── 2) Validação e campos do formulário ──────────────────────────────────
-- As mesmas regras de src/lib/treinamentos/solicitacaoTreinamento.ts.
CREATE OR REPLACE FUNCTION public.trn_sol_validar(p jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_qtd   int := NULLIF(p->>'qtd_participantes', '')::int;
  v_datas int;
BEGIN
  IF NULLIF(btrim(p->>'contrato_nome'), '') IS NULL THEN RAISE EXCEPTION 'Escolha o contrato / unidade.'; END IF;
  IF NULLIF(btrim(p->>'treinamento'), '') IS NULL THEN RAISE EXCEPTION 'Informe qual treinamento está solicitando.'; END IF;
  IF NULLIF(btrim(p->>'motivo'), '') IS NULL THEN RAISE EXCEPTION 'Informe por que o treinamento é necessário.'; END IF;
  IF NULLIF(btrim(p->>'assuntos'), '') IS NULL THEN RAISE EXCEPTION 'Informe os assuntos que precisam ser abordados.'; END IF;
  IF COALESCE(p->>'modalidade', '') NOT IN ('presencial', 'online') THEN RAISE EXCEPTION 'Escolha a modalidade: presencial ou online.'; END IF;
  IF p->>'modalidade' = 'presencial' THEN
    IF NULLIF(btrim(p->>'local_treinamento'), '') IS NULL THEN RAISE EXCEPTION 'Informe o local e o endereço completo do treinamento.'; END IF;
    IF COALESCE(jsonb_typeof(p->'tem_sala'), '') <> 'boolean' THEN RAISE EXCEPTION 'Responda se o local tem sala disponível.'; END IF;
    IF COALESCE(p->>'voltagem', '') NOT IN ('110', '220', 'ambas') THEN RAISE EXCEPTION 'Informe a voltagem das tomadas.'; END IF;
    IF COALESCE(jsonb_typeof(p->'tem_projetor'), '') <> 'boolean' OR COALESCE(jsonb_typeof(p->'precisa_projetor'), '') <> 'boolean'
       OR COALESCE(jsonb_typeof(p->'tem_internet'), '') <> 'boolean' OR COALESCE(jsonb_typeof(p->'tem_som'), '') <> 'boolean'
       OR COALESCE(jsonb_typeof(p->'tem_espaco_cafe'), '') <> 'boolean' THEN
      RAISE EXCEPTION 'Responda todas as perguntas do checklist do local.';
    END IF;
  END IF;
  v_datas := CASE WHEN jsonb_typeof(p->'datas_previstas') = 'array' THEN jsonb_array_length(p->'datas_previstas') ELSE 0 END;
  IF v_datas = 0 THEN RAISE EXCEPTION 'Informe ao menos uma data prevista.'; END IF;
  IF v_datas > 10 THEN RAISE EXCEPTION 'Informe no máximo 10 datas previstas.'; END IF;
  IF COALESCE(p->>'urgencia', '') = 'prioritario' AND NULLIF(btrim(p->>'observacoes'), '') IS NULL THEN
    RAISE EXCEPTION 'Prioritário: justifique a urgência nas observações.';
  END IF;
  IF v_qtd IS NULL OR v_qtd < 1 THEN RAISE EXCEPTION 'Informe a quantidade de colaboradores.'; END IF;
  IF NOT COALESCE((p->>'confirmado')::boolean, false) THEN
    RAISE EXCEPTION 'Confirme a veracidade das informações para enviar.';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.trn_sol_campos(p jsonb)
RETURNS public."TRN_SOLICITACAO" LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  r       public."TRN_SOLICITACAO";
  v_local boolean := p->>'modalidade' = 'presencial';
BEGIN
  r.contrato_empresa := NULLIF(p->>'contrato_empresa', '')::bigint;
  r.contrato_filial := NULLIF(p->>'contrato_filial', '')::bigint;
  r.contrato_nome := btrim(p->>'contrato_nome');
  r.treinamento := btrim(p->>'treinamento');
  r.motivo := btrim(p->>'motivo');
  r.objetivo := NULLIF(btrim(p->>'objetivo'), '');
  r.assuntos := btrim(p->>'assuntos');
  r.qtd_participantes := (p->>'qtd_participantes')::int;
  r.equipe := NULLIF(btrim(p->>'equipe'), '');
  r.turnos := NULLIF(btrim(p->>'turnos'), '');
  r.modalidade := p->>'modalidade';
  r.local_treinamento := CASE WHEN v_local THEN NULLIF(btrim(p->>'local_treinamento'), '') END;
  -- Sem repetição e em ordem; a primeira é a data_preferencial.
  r.datas_previstas := ARRAY(SELECT DISTINCT d::date FROM jsonb_array_elements_text(p->'datas_previstas') d WHERE NULLIF(d, '') IS NOT NULL ORDER BY 1);
  r.data_preferencial := r.datas_previstas[1];
  r.horario_inicio := NULL;
  r.horario_fim := NULL;
  r.urgencia := COALESCE(NULLIF(p->>'urgencia', ''), 'programavel');
  r.recursos := '{}';
  r.tem_sala := CASE WHEN v_local THEN (p->>'tem_sala')::boolean END;
  r.voltagem := CASE WHEN v_local THEN NULLIF(p->>'voltagem', '') END;
  r.tem_projetor := CASE WHEN v_local THEN (p->>'tem_projetor')::boolean END;
  r.precisa_projetor := CASE WHEN v_local THEN (p->>'precisa_projetor')::boolean END;
  r.tem_internet := CASE WHEN v_local THEN (p->>'tem_internet')::boolean END;
  r.tem_som := CASE WHEN v_local THEN (p->>'tem_som')::boolean END;
  r.tem_espaco_cafe := CASE WHEN v_local THEN (p->>'tem_espaco_cafe')::boolean END;
  r.precisa_transporte := NULL;
  r.observacoes := NULLIF(btrim(p->>'observacoes'), '');
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_validar(jsonb), public.trn_sol_campos(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3) Enviar e reenviar (o encarregado) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.trn_sol_criar(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  c    public."TRN_SOLICITACAO";
  v_eu text;
  v_em text;
  v_id bigint;
  v_pr text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre no sistema.' USING ERRCODE = '42501'; END IF;
  PERFORM public.trn_sol_validar(p);
  c := public.trn_sol_campos(p);
  SELECT x->>'nome', x->>'email' INTO v_eu, v_em FROM (SELECT public.trn_sol_eu() x) y;

  INSERT INTO public."TRN_SOLICITACAO" (
    solicitante_nome, solicitante_email, contrato_empresa, contrato_filial, contrato_nome, treinamento, motivo, objetivo, assuntos,
    qtd_participantes, equipe, turnos, modalidade, local_treinamento, datas_previstas, data_preferencial, urgencia,
    tem_sala, voltagem, tem_projetor, precisa_projetor, tem_internet, tem_som, tem_espaco_cafe,
    observacoes, declaracao, confirmado_em)
  VALUES (
    v_eu, v_em, c.contrato_empresa, c.contrato_filial, c.contrato_nome, c.treinamento, c.motivo, c.objetivo, c.assuntos,
    c.qtd_participantes, c.equipe, c.turnos, c.modalidade, c.local_treinamento, c.datas_previstas, c.data_preferencial, c.urgencia,
    c.tem_sala, c.voltagem, c.tem_projetor, c.precisa_projetor, c.tem_internet, c.tem_som, c.tem_espaco_cafe,
    c.observacoes,
    'Declaro que todas as informações fornecidas foram verificadas e confirmadas, correspondendo às condições reais do local e às '
      || 'necessidades do treinamento. Estou ciente de que serão utilizadas para elaboração do ofício e organização das atividades.',
    now())
  RETURNING id, protocolo INTO v_id, v_pr;

  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, para_status, texto, autor_nome)
  VALUES (v_id, 'enviada', 'pendente', 'Solicitação enviada com a declaração de veracidade.', v_eu);
  PERFORM public.trn_sol_avisar_treinamentos(v_id,
    CASE WHEN c.urgencia = 'prioritario' THEN 'Solicitação de treinamento PRIORITÁRIA' ELSE 'Nova solicitação de treinamento' END,
    v_pr || ' — ' || c.treinamento || ' · ' || c.contrato_nome || ' · ' || c.qtd_participantes || ' participante(s) · ' || coalesce(v_eu, ''));
  RETURN jsonb_build_object('id', v_id, 'protocolo', v_pr);
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_criar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_sol_reenviar(p_id bigint, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s public."TRN_SOLICITACAO";
  c public."TRN_SOLICITACAO";
  v_eu text;
BEGIN
  SELECT * INTO s FROM public."TRN_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.solicitante_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem pediu corrige a solicitação.' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'pendente' OR s.devolucao_motivo IS NULL THEN
    RAISE EXCEPTION 'A solicitação não foi devolvida para ajuste.';
  END IF;
  PERFORM public.trn_sol_validar(p);
  c := public.trn_sol_campos(p);
  v_eu := public.trn_sol_eu()->>'nome';
  UPDATE public."TRN_SOLICITACAO" SET
    contrato_empresa = c.contrato_empresa, contrato_filial = c.contrato_filial, contrato_nome = c.contrato_nome,
    treinamento = c.treinamento, motivo = c.motivo, objetivo = c.objetivo, assuntos = c.assuntos,
    qtd_participantes = c.qtd_participantes, equipe = c.equipe, turnos = c.turnos, modalidade = c.modalidade,
    local_treinamento = c.local_treinamento, datas_previstas = c.datas_previstas, data_preferencial = c.data_preferencial,
    horario_inicio = NULL, horario_fim = NULL, urgencia = c.urgencia, recursos = '{}',
    tem_sala = c.tem_sala, voltagem = c.voltagem, tem_projetor = c.tem_projetor, precisa_projetor = c.precisa_projetor,
    tem_internet = c.tem_internet, tem_som = c.tem_som, tem_espaco_cafe = c.tem_espaco_cafe, precisa_transporte = NULL,
    observacoes = c.observacoes, confirmado_em = now(), devolucao_motivo = NULL
  WHERE id = p_id;
  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, de_status, para_status, texto, autor_nome)
  VALUES (p_id, 'reenviada', 'pendente', 'pendente', 'Corrigida e reenviada com a declaração de veracidade.', v_eu);
  PERFORM public.trn_sol_avisar_treinamentos(p_id, 'Solicitação de treinamento corrigida',
    s.protocolo || ' — ' || c.treinamento || ' · ' || c.contrato_nome || ' foi corrigida e reenviada.');
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_reenviar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_reenviar(bigint, jsonb) TO authenticated;

-- ── 4) Treinamentos decide / informa a data; cancelar ────────────────────
-- p_acao: aprovar (aceitar) | informar_data | concluir | reprovar | devolver | cancelar
--   ('agendar' = informar_data, para a tela antiga que ainda esteja aberta)
-- p = {motivo, data_confirmada, horario_confirmado, instrutor, obs}
-- Informar a data NUNCA agenda direto: vai para data_informada e quem
-- aprova é o encarregado (trn_sol_responder_data).
CREATE OR REPLACE FUNCTION public.trn_sol_decidir(p_id bigint, p_acao text, p jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s       public."TRN_SOLICITACAO";
  v_acao  text := CASE WHEN p_acao = 'agendar' THEN 'informar_data' ELSE p_acao END;
  v_eu    text := COALESCE((SELECT coalesce(nullif(btrim(x.display_name), ''), x.email) FROM public.profiles x WHERE x.id = auth.uid()), 'Treinamentos');
  v_mot   text := NULLIF(btrim(p->>'motivo'), '');
  v_data  date := NULLIF(p->>'data_confirmada', '')::date;
  v_hora  text := NULLIF(btrim(p->>'horario_confirmado'), '');
  v_inst  text := NULLIF(btrim(p->>'instrutor'), '');
  v_obs   text := NULLIF(btrim(p->>'obs'), '');
  v_para  text;
  v_titulo text;
  v_msg   text;
  v_cancelar_proprio boolean;
BEGIN
  SELECT * INTO s FROM public."TRN_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  v_cancelar_proprio := v_acao = 'cancelar' AND s.solicitante_id = auth.uid() AND s.status = 'pendente';
  IF NOT v_cancelar_proprio AND NOT public.trn_sol_eh_treinamentos('aprovar') THEN
    RAISE EXCEPTION 'Sem permissão para decidir solicitações de treinamento.' USING ERRCODE = '42501';
  END IF;

  IF v_acao = 'aprovar' THEN
    IF s.status <> 'pendente' THEN RAISE EXCEPTION 'Só solicitação pendente pode ser aceita.'; END IF;
    v_para := CASE WHEN v_data IS NOT NULL THEN 'data_informada' ELSE 'aprovada' END;
  ELSIF v_acao = 'informar_data' THEN
    IF s.status NOT IN ('aprovada', 'data_informada', 'agendada') THEN RAISE EXCEPTION 'Informe a data depois de aceitar a solicitação.'; END IF;
    IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data do treinamento.'; END IF;
    v_para := 'data_informada';
  ELSIF v_acao = 'concluir' THEN
    IF s.status NOT IN ('aprovada', 'data_informada', 'agendada') THEN RAISE EXCEPTION 'Só treinamento aceito ou agendado pode ser concluído.'; END IF;
    v_para := 'concluida';
  ELSIF v_acao = 'reprovar' THEN
    IF s.status <> 'pendente' THEN RAISE EXCEPTION 'Só solicitação pendente pode ser reprovada.'; END IF;
    IF v_mot IS NULL THEN RAISE EXCEPTION 'Informe o motivo da reprovação.'; END IF;
    v_para := 'reprovada';
  ELSIF v_acao = 'devolver' THEN
    IF s.status <> 'pendente' THEN RAISE EXCEPTION 'Só solicitação pendente pode ser devolvida para ajuste.'; END IF;
    IF v_mot IS NULL THEN RAISE EXCEPTION 'Diga o que o encarregado precisa ajustar.'; END IF;
    v_para := 'pendente';
  ELSIF v_acao = 'cancelar' THEN
    IF s.status IN ('concluida', 'reprovada', 'cancelada') THEN RAISE EXCEPTION 'A solicitação já está encerrada.'; END IF;
    IF v_mot IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
    v_para := 'cancelada';
  ELSE
    RAISE EXCEPTION 'Ação inválida.';
  END IF;

  UPDATE public."TRN_SOLICITACAO" SET
    status = v_para,
    decidido_por = CASE WHEN v_acao IN ('aprovar', 'reprovar') THEN v_eu ELSE decidido_por END,
    decidido_em = CASE WHEN v_acao IN ('aprovar', 'reprovar') THEN now() ELSE decidido_em END,
    motivo_reprovacao = CASE WHEN v_acao = 'reprovar' THEN v_mot ELSE motivo_reprovacao END,
    devolucao_motivo = CASE WHEN v_acao = 'devolver' THEN v_mot ELSE devolucao_motivo END,
    data_confirmada = COALESCE(v_data, data_confirmada),
    horario_confirmado = CASE WHEN v_data IS NOT NULL THEN v_hora ELSE horario_confirmado END,
    instrutor = COALESCE(v_inst, instrutor),
    obs_treinamentos = COALESCE(v_obs, obs_treinamentos),
    -- Data nova: a recusa anterior já foi atendida e a aprovação vale de novo.
    data_recusa_motivo = CASE WHEN v_para = 'data_informada' THEN NULL ELSE data_recusa_motivo END,
    data_aprovada_em = CASE WHEN v_para = 'data_informada' THEN NULL ELSE data_aprovada_em END,
    concluida_em = CASE WHEN v_acao = 'concluir' THEN now() ELSE concluida_em END,
    cancelada_em = CASE WHEN v_acao = 'cancelar' THEN now() ELSE cancelada_em END,
    cancelada_por = CASE WHEN v_acao = 'cancelar' THEN v_eu ELSE cancelada_por END,
    cancelamento_motivo = CASE WHEN v_acao = 'cancelar' THEN v_mot ELSE cancelamento_motivo END
  WHERE id = p_id;

  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, de_status, para_status, texto, autor_nome)
  VALUES (p_id,
          CASE v_acao WHEN 'aprovar' THEN 'aprovada' WHEN 'informar_data' THEN 'data_informada' WHEN 'concluir' THEN 'concluida'
                      WHEN 'reprovar' THEN 'reprovada' WHEN 'devolver' THEN 'devolvida' ELSE 'cancelada' END,
          s.status, v_para,
          concat_ws(' · ', v_mot,
                    CASE WHEN v_data IS NOT NULL THEN 'Data: ' || to_char(v_data, 'DD/MM/YYYY') END,
                    CASE WHEN v_hora IS NOT NULL THEN 'Horário: ' || v_hora END,
                    CASE WHEN v_inst IS NOT NULL THEN 'Instrutor: ' || v_inst END, v_obs),
          v_eu);

  -- Avisa o outro lado.
  IF v_cancelar_proprio THEN
    PERFORM public.trn_sol_avisar_treinamentos(p_id, 'Solicitação de treinamento cancelada',
      s.protocolo || ' — ' || s.treinamento || ' foi cancelada pelo encarregado. Motivo: ' || left(v_mot, 200));
  ELSE
    v_titulo := CASE WHEN v_para = 'data_informada' THEN 'Treinamento: aprove a data'
                     ELSE CASE v_acao WHEN 'aprovar' THEN 'Solicitação de treinamento aceita' WHEN 'concluir' THEN 'Treinamento concluído'
                                      WHEN 'reprovar' THEN 'Treinamento reprovado' WHEN 'devolver' THEN 'Treinamento: ajuste necessário'
                                      ELSE 'Treinamento cancelado' END END;
    v_msg := s.protocolo || ' — ' || s.treinamento
      || CASE WHEN v_data IS NOT NULL THEN ' · ' || to_char(v_data, 'DD/MM/YYYY') || coalesce(' ' || v_hora, '') ELSE '' END
      || CASE WHEN v_para = 'data_informada' THEN '. Aprove a data ou peça outra.' ELSE '' END
      || CASE WHEN v_mot IS NOT NULL THEN '. ' || left(v_mot, 200) ELSE '' END;
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (s.solicitante_id, v_titulo, v_msg, 'treinamento_solicitacao', '/app/encarregados/solicitar-treinamento?s=' || p_id);
    EXCEPTION WHEN others THEN RAISE WARNING 'trn_sol_decidir (aviso): %', SQLERRM;
    END;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_decidir(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_decidir(bigint, text, jsonb) TO authenticated;

-- ── 5) O encarregado responde à data ─────────────────────────────────────
-- p_aprovar = true → agendada. false → pede outra (motivo obrigatório) e
-- volta para aprovada, para Treinamentos informar de novo.
CREATE OR REPLACE FUNCTION public.trn_sol_responder_data(p_id bigint, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  s     public."TRN_SOLICITACAO";
  v_eu  text;
  v_mot text := NULLIF(btrim(p_motivo), '');
  v_para text := CASE WHEN p_aprovar THEN 'agendada' ELSE 'aprovada' END;
BEGIN
  SELECT * INTO s FROM public."TRN_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.solicitante_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só quem pediu aprova a data do treinamento.' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'data_informada' THEN RAISE EXCEPTION 'Não há data aguardando a sua aprovação.'; END IF;
  IF p_aprovar IS NULL THEN RAISE EXCEPTION 'Diga se aprova a data ou pede outra.'; END IF;
  IF NOT p_aprovar AND v_mot IS NULL THEN RAISE EXCEPTION 'Diga por que precisa de outra data.'; END IF;
  v_eu := public.trn_sol_eu()->>'nome';

  UPDATE public."TRN_SOLICITACAO" SET
    status = v_para,
    data_aprovada_em = CASE WHEN p_aprovar THEN now() END,
    data_recusa_motivo = CASE WHEN p_aprovar THEN NULL ELSE v_mot END
  WHERE id = p_id;
  INSERT INTO public."TRN_SOLICITACAO_EVENTO" (solicitacao_id, acao, de_status, para_status, texto, autor_nome)
  VALUES (p_id, CASE WHEN p_aprovar THEN 'data_aprovada' ELSE 'data_recusada' END, s.status, v_para,
          concat_ws(' · ', 'Data: ' || to_char(s.data_confirmada, 'DD/MM/YYYY'), v_mot), v_eu);
  PERFORM public.trn_sol_avisar_treinamentos(p_id,
    CASE WHEN p_aprovar THEN 'Data do treinamento aprovada' ELSE 'Encarregado pediu outra data' END,
    s.protocolo || ' — ' || s.treinamento || ' · ' || to_char(s.data_confirmada, 'DD/MM/YYYY')
      || CASE WHEN p_aprovar THEN ' aprovada por ' || coalesce(v_eu, 'o encarregado') || '.' ELSE '. Motivo: ' || left(v_mot, 200) END);
END $fn$;
REVOKE ALL ON FUNCTION public.trn_sol_responder_data(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_sol_responder_data(bigint, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (as RPCs anteriores estão em 20261026000910 — reaplicar as seções
-- 5 e 6 de lá depois disto)
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.trn_sol_responder_data(bigint, boolean, text);
-- UPDATE public."TRN_SOLICITACAO" SET status = 'aprovada' WHERE status = 'data_informada';
-- ALTER TABLE public."TRN_SOLICITACAO" DROP CONSTRAINT IF EXISTS trn_sol_status;
-- ALTER TABLE public."TRN_SOLICITACAO" DROP CONSTRAINT IF EXISTS trn_sol_modalidade;
-- ALTER TABLE public."TRN_SOLICITACAO" ADD CONSTRAINT trn_sol_status
--   CHECK (status IN ('pendente', 'aprovada', 'agendada', 'concluida', 'reprovada', 'cancelada'));
-- ALTER TABLE public."TRN_SOLICITACAO" ADD CONSTRAINT trn_sol_modalidade CHECK (modalidade IN ('presencial', 'online', 'hibrida'));
-- ALTER TABLE public."TRN_SOLICITACAO" DROP COLUMN IF EXISTS datas_previstas, DROP COLUMN IF EXISTS data_recusa_motivo,
--   DROP COLUMN IF EXISTS data_aprovada_em;
