-- =========================================================================
-- RECRUTAMENTO: PARECER DO JURÍDICO TRAVAVA NA VAGA (14/10/2026)
--
-- SINTOMA (Pablo, print da Verificação de Candidatos): ao dar o parecer, o
-- Jurídico via "Erro ao salvar: Depois de criada, você só pode alterar a Data
-- de Início Prevista da vaga" e o candidato não andava.
--
-- CAUSA: mover o candidato (JURÍDICO → ENTREVISTA) dispara
-- sr_sync_status_solicitacao, que muda o status da VAGA ("Em análise
-- jurídica" → "Entrevista e Avaliação"). O sistema_recrutamento_guard só
-- deixa gestor do Recrutamento mudar a vaga — o Jurídico não é — e a exceção
-- desfazia o movimento do candidato junto. O mesmo valia para qualquer área
-- que move candidato sem ser gestora.
--
-- CORREÇÃO: o gatilho de sincronização marca a transação
-- (set_config('app.rec_sync_status', 'on', true)) só durante o UPDATE dele; a
-- trava aceita a mudança quando a marca está ligada E nada além de status /
-- status_changed_at mudou. Edição de vaga por quem não é gestor continua
-- barrada como antes.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sistema_recrutamento_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gestor  boolean;
  v_dias    integer;
  v_livre   jsonb;
  v_ult     jsonb;
  v_msg     text := 'A vaga precisa de no mínimo 7 dias úteis entre hoje e a data de início prevista.';
BEGIN
  IF btrim(coalesce(NEW.motivo_vaga, '')) = 'Expansão' THEN
    NEW.motivo_vaga := 'Expansão (Aumento de Quadro)';
  END IF;

  IF public.rec_cargo_exige_cnh(NEW.cargo) THEN
    NEW.cnh_obrigatoria := true;
    IF upper(translate(coalesce(NEW.req_obrigatorios, ''),
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
         'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       !~ '(CNH|CARTEIRA DE (MOTORISTA|HABILITA))' THEN
      NEW.req_obrigatorios := btrim(concat(
        'CNH obrigatória (categoria compatível com a função).',
        CASE WHEN btrim(coalesce(NEW.req_obrigatorios, '')) = '' THEN '' ELSE E'\n' || NEW.req_obrigatorios END));
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.cnh_obrigatoria := COALESCE(NEW.cnh_obrigatoria, false);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NOT NULL THEN
      v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
      IF v_dias < 7 THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
      END IF;
      NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);
    END IF;
    NEW.data_inicio_alteracoes := COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb);
    RETURN NEW;
  END IF;

  -- 14/10/2026 (mig 20261014000013): o status que o CANDIDATO move.
  -- sr_sync_status_solicitacao acompanha o candidato mais adiantado e muda o
  -- status da vaga — quem moveu pode ser o Jurídico (parecer → Entrevista),
  -- SST, Compras, que não são gestores da vaga. Sem isto a trava abaixo
  -- recusava ("Depois de criada, você só pode alterar a Data de Início") e o
  -- movimento do candidato inteiro voltava atrás. Passa SÓ o status, e só
  -- quando a marca vem do gatilho de sincronização (set_config local).
  IF current_setting('app.rec_sync_status', true) = 'on'
     AND (to_jsonb(OLD) - 'status' - 'status_changed_at') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'status' - 'status_changed_at') THEN
    RETURN NEW;
  END IF;

  -- Quem decide sobre a vaga. São as MESMAS portas que a RLS reconhece
  -- (sistema_recrutamento_gate e sistema_recrutamento_operacional) — manter
  -- as duas listas iguais é o que impede a RLS liberar e o gatilho recusar,
  -- que foi exatamente o defeito corrigido quando esta função nasceu.
  --
  -- 02/09/2026: entrou `licitacoes_analistas_recrutamento` e SAIU
  -- `operacional_recrutamento`. A etapa 1 mudou de dono; o Operacional
  -- acompanha, e acompanhar não escreve.
  v_gestor := has_screen_access(auth.uid(), 'recrutamento_gestao', 'alterar')
           OR has_screen_access(auth.uid(), 'recrutamento_gestao', 'incluir')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'alterar')
           OR has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'aprovar')
           -- Diretoria (16/09/2026): aprova a vaga administrativa / com setor.
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'aprovar')
           OR has_screen_access(auth.uid(), 'diretoria_recrutamento', 'alterar');

  -- 02/10/2026 (mig 287): quem tem "APROVA VAGAS" sem ser gestor (o
  -- Operacional) decide a etapa 1 — e só ela: na vaga em "Pendente
  -- Analista", pode mudar o status e gravar o carimbo de quem aprovou e o
  -- motivo da reprovação. Qualquer outra coluna segue a regra abaixo.
  IF NOT v_gestor AND OLD.status = 'Pendente Analista' AND public.rec_aprova_vagas(auth.uid()) THEN
    v_livre := to_jsonb(OLD) - 'status' - 'aprovado_por_nome' - 'aprovado_por_email' - 'motivo_reprovacao'
                             - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS NOT DISTINCT FROM (to_jsonb(NEW) - 'status' - 'aprovado_por_nome' - 'aprovado_por_email' - 'motivo_reprovacao'
                                     - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes')
       AND NEW.data_inicio_prevista IS NOT DISTINCT FROM OLD.data_inicio_prevista
       AND NEW.data_inicio_alteracoes IS NOT DISTINCT FROM OLD.data_inicio_alteracoes THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 02/10/2026 (mig 289): "PODE CONCLUIR DIRETO" — a RPC rec_concluir_direto
  -- encerra a vaga como Contratado e grava o nome de quem foi contratado. Quem
  -- tem a capacidade sem ser gestor muda SÓ essas duas colunas.
  IF NOT v_gestor AND NEW.status = 'Contratado' AND OLD.status IS DISTINCT FROM 'Contratado'
     AND public.has_screen_access(auth.uid(), 'recrutamento_concluir_direto', 'aprovar'::public.app_acao)
     AND (to_jsonb(OLD) - 'status' - 'contratado_nome') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'status' - 'contratado_nome') THEN
    RETURN NEW;
  END IF;

  IF NOT v_gestor THEN
    v_livre := to_jsonb(OLD) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes';
    IF v_livre IS DISTINCT FROM (to_jsonb(NEW) - 'data_inicio_prevista' - 'grau_urgencia' - 'data_inicio_alteracoes') THEN
      RAISE EXCEPTION 'Depois de criada, você só pode alterar a Data de Início Prevista da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.';
    END IF;
  END IF;

  IF NEW.data_inicio_prevista IS DISTINCT FROM OLD.data_inicio_prevista THEN
    IF public.rec_data_prevista(NEW.data_inicio_prevista) IS NULL THEN
      RAISE EXCEPTION 'Informe a nova data de início prevista.';
    END IF;
    v_dias := public.dias_uteis_entre(current_date, public.rec_data_prevista(NEW.data_inicio_prevista));
    IF v_dias < 7 THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s) útil(eis).', v_msg, v_dias;
    END IF;
    NEW.grau_urgencia := public.rec_grau_por_data(NEW.data_inicio_prevista);

    IF jsonb_array_length(COALESCE(NEW.data_inicio_alteracoes, '[]'::jsonb))
       <> jsonb_array_length(COALESCE(OLD.data_inicio_alteracoes, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Toda troca de data precisa de uma justificativa.';
    END IF;
    v_ult := NEW.data_inicio_alteracoes -> (jsonb_array_length(NEW.data_inicio_alteracoes) - 1);
    IF length(btrim(coalesce(v_ult->>'justificativa', ''))) < 10 THEN
      RAISE EXCEPTION 'Escreva a justificativa da troca de data (mínimo 10 caracteres).';
    END IF;
    IF btrim(coalesce(v_ult->>'para', '')) <> btrim(coalesce(NEW.data_inicio_prevista, '')) THEN
      RAISE EXCEPTION 'O histórico da troca de data não bate com a data enviada.';
    END IF;
    NEW.data_inicio_alteracoes := jsonb_set(
      NEW.data_inicio_alteracoes,
      ARRAY[(jsonb_array_length(NEW.data_inicio_alteracoes) - 1)::text],
      v_ult || jsonb_build_object('por', auth.uid(), 'em', now()));
  ELSIF NEW.data_inicio_alteracoes IS DISTINCT FROM OLD.data_inicio_alteracoes AND NOT v_gestor THEN
    RAISE EXCEPTION 'O histórico de datas não pode ser alterado.';
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.sr_sync_status_solicitacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_vaga bigint; v_atual text; v_rank int; v_envadm timestamptz; v_new text;
BEGIN
  v_vaga := COALESCE(NEW.vaga_id, OLD.vaga_id);
  IF v_vaga IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO v_atual FROM public."SISTEMA_RECRUTAMENTO" WHERE id = v_vaga;
  -- Vaga que nem chegou ao Recrutamento, ou ja encerrada, nao e dirigida
  -- pelo candidato.
  IF v_atual IS NULL OR v_atual IN ('Pendente Operacional','Pendente Recrutamento','Reprovada','Concluída') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- O candidato MAIS ADIANTADO manda no status da vaga. Desistente e
  -- reprovado ficam de fora: eles nao representam o andamento.
  SELECT public.sr_rank_etapa(c.etapa_processo), c.enviado_admissao_em
    INTO v_rank, v_envadm
    FROM public."WA_CURRICULOS" c
   WHERE c.vaga_id = v_vaga
     AND c.etapa_processo IS NOT NULL
     AND c.etapa_processo <> 'Reprovado'
   ORDER BY public.sr_rank_etapa(c.etapa_processo) DESC,
            c.enviado_admissao_em DESC NULLS LAST
   LIMIT 1;

  v_new := CASE
    WHEN v_rank IS NULL OR v_rank <= 2 THEN 'Vaga aberta - Seleção de Currículos'
    WHEN v_rank = 3 THEN 'Em análise jurídica'
    WHEN v_rank = 4 THEN 'Entrevista e Avaliação'
    WHEN v_rank = 5 THEN 'Entrevista com Gestor'
    WHEN v_rank = 6 THEN 'Aprovado - Aguardando SST'
    WHEN v_rank = 7 THEN 'Compras Confirmou - Aguardando Documentação'
    WHEN v_rank = 8 THEN 'Aguardando SST e Compras'
    -- ADMISSAO: so vira 'Contratado' quando alguem foi de fato EFETIVADO.
    -- Estar na coluna nao basta — e o envio a Admissao que fecha a vaga.
    WHEN v_rank = 9 THEN CASE WHEN v_envadm IS NOT NULL THEN 'Contratado' ELSE 'Aguardando SST e Compras' END
    ELSE v_atual END;

  IF v_new IS DISTINCT FROM v_atual THEN
    -- Marca para o sistema_recrutamento_guard: mudança de status vinda do
    -- candidato, não de quem editou a vaga (mig 20261014000013).
    PERFORM set_config('app.rec_sync_status', 'on', true);
    UPDATE public."SISTEMA_RECRUTAMENTO" SET status = v_new WHERE id = v_vaga;
    PERFORM set_config('app.rec_sync_status', 'off', true);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar as duas funções sem o trecho marcado "mig 20261014000013"
-- (sistema_recrutamento_guard e sr_sync_status_solicitacao).
