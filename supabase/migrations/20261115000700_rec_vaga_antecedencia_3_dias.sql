-- =========================================================================
-- Vaga: antecedência mínima cai de 7 dias ÚTEIS para 3 dias CORRIDOS
-- (13/11/2026)
--
-- Pedido: "no máximo 3 dias de antecedência" — vaga com data de 3 dias ou
-- mais à frente passa sem bloqueio; menos que isso, bloqueia. O pedido não
-- fala em dias úteis, então a conta é em dias CORRIDOS (sábado, domingo e
-- feriado contam).
--
-- O mesmo número mora em src/lib/recrutamento/vagaRegras.ts
-- (MIN_DIAS_ANTECEDENCIA), que é o que as telas usam — aqui é o piso:
--   • sistema_recrutamento_guard  → INSERT e troca de data da vaga
--     (Recrutamento › Nova Vaga, Central de Serviços, Encarregados › Minhas
--     Solicitações). Corpo IGUAL ao da mig 20261014000019, só a conta do
--     prazo mudou.
--   • contrato_quadro_gerar_vagas → vagas geradas pelo Quadro de Postos do
--     contrato. Corpo IGUAL ao da mig 20260930000241, só a conta do prazo.
--   • rec_grau_por_data           → o grau continua pelas faixas de dias
--     ÚTEIS (14-20 Média, 21+ Baixa), mas tudo abaixo de 14 úteis que passou
--     no mínimo é "Alta — Urgente" (antes, abaixo de 7 úteis dava NULL).
--
-- Idempotente.
-- =========================================================================

-- ── O número, num lugar só ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_antecedencia_minima_vaga()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

REVOKE EXECUTE ON FUNCTION public.rec_antecedencia_minima_vaga() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_antecedencia_minima_vaga() TO authenticated;

-- ── Grau pelo prazo ──────────────────────────────────────────────────────
-- NULL = sem data ou abaixo do mínimo (o guard barra antes).
CREATE OR REPLACE FUNCTION public.rec_grau_por_data(_data text, _hoje date DEFAULT current_date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.rec_data_prevista(_data) IS NULL THEN NULL
    WHEN public.rec_data_prevista(_data) - _hoje < public.rec_antecedencia_minima_vaga() THEN NULL
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 21 THEN 'Baixa'
    WHEN public.dias_uteis_entre(_hoje, public.rec_data_prevista(_data)) >= 14 THEN 'Média'
    ELSE 'Alta — Urgente' END;
$$;

-- ── Guarda da vaga (versão da mig 20261014000019, prazo novo) ───────────
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
  v_msg     text := 'A vaga precisa de no mínimo ' || public.rec_antecedencia_minima_vaga() || ' dias de antecedência.';
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
      v_dias := public.rec_data_prevista(NEW.data_inicio_prevista) - current_date;
      IF v_dias < public.rec_antecedencia_minima_vaga() THEN
        RAISE EXCEPTION '% A data escolhida tem % dia(s). A primeira data possível é %.', v_msg, GREATEST(v_dias, 0),
          to_char(current_date + public.rec_antecedencia_minima_vaga(), 'DD/MM/YYYY');
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

  -- 14/10/2026 (mig 20261014000019): "PODE CANCELAR ADMISSÃO" — a RPC
  -- rec_cancelar_admissao reabre a vaga. Passa SÓ status, status_changed_at
  -- e contratado_nome, e só com a marca que a RPC liga (set_config local).
  IF current_setting('app.rec_cancelar_admissao', true) = 'on'
     AND (to_jsonb(OLD) - 'status' - 'status_changed_at' - 'contratado_nome')
         IS NOT DISTINCT FROM (to_jsonb(NEW) - 'status' - 'status_changed_at' - 'contratado_nome') THEN
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
    v_dias := public.rec_data_prevista(NEW.data_inicio_prevista) - current_date;
    IF v_dias < public.rec_antecedencia_minima_vaga() THEN
      RAISE EXCEPTION '% A data escolhida tem % dia(s). A primeira data possível é %.', v_msg, GREATEST(v_dias, 0),
          to_char(current_date + public.rec_antecedencia_minima_vaga(), 'DD/MM/YYYY');
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

-- ── Gerar as vagas do quadro (versão da mig 20260930000241, prazo novo) ──
CREATE OR REPLACE FUNCTION public.contrato_quadro_gerar_vagas(
  p_contrato_id uuid,
  p_simular     boolean DEFAULT false
)
RETURNS TABLE (posto_nome text, funcao_nome text, criadas int, ja_existiam int, primeira_vaga bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_q          record;
  v_contrato   text;
  v_nome_user  text;
  v_email      text;
  v_i          int;
  v_ja         int;
  v_criadas    int;
  v_primeira   bigint;
  v_id         bigint;
  v_dias       int;
  v_insal_txt  text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para abrir as vagas do quadro de postos.';
  END IF;

  SELECT c.nome INTO v_contrato FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  SELECT coalesce(u.raw_user_meta_data->>'nome', u.email), u.email
    INTO v_nome_user, v_email
    FROM auth.users u WHERE u.id = auth.uid();

  -- Confere o prazo de TODOS os postos antes de gravar qualquer um. O guard
  -- da vaga (sistema_recrutamento_guard) recusaria a inserção do mesmo jeito,
  -- mas no meio do laço: sairiam 12 vagas criadas e um erro que não diz de
  -- qual posto é. Aqui o erro sai antes, com o nome do posto e a data.
  FOR v_q IN
    SELECT q.posto_nome, q.funcao_nome, q.data_inicio_prevista
      FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
  LOOP
    v_dias := v_q.data_inicio_prevista - current_date;
    IF v_dias IS NULL OR v_dias < public.rec_antecedencia_minima_vaga() THEN
      RAISE EXCEPTION 'Posto "%" · função "%": a data prevista de início (%) tem % dia(s) de antecedência. A vaga precisa de no mínimo % dias. A primeira data possível é %.',
        v_q.posto_nome, v_q.funcao_nome, coalesce(to_char(v_q.data_inicio_prevista, 'DD/MM/YYYY'), '—'), GREATEST(coalesce(v_dias, 0), 0),
        public.rec_antecedencia_minima_vaga(), to_char(current_date + public.rec_antecedencia_minima_vaga(), 'DD/MM/YYYY');
    END IF;
  END LOOP;

  FOR v_q IN
    SELECT q.* FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
     ORDER BY q.ordem, q.posto_nome, q.funcao_nome
  LOOP
    SELECT count(*)::int INTO v_ja
      FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.quadro_posto_id = v_q.id;

    v_criadas := 0;
    v_primeira := NULL;

    -- Insalubridade no formato que a vaga já usa ("40%"), o mesmo que
    -- insalubridadeDoCusto() produz com origem 'cadastro'.
    v_insal_txt := public.rec_pct_txt(v_q.insalubridade_pct);

    IF NOT p_simular THEN
      FOR v_i IN 1..v_q.quantidade LOOP
        -- Índice já gerado (geração anterior) — pula. É o que torna repetir
        -- a geração seguro depois de aumentar a quantidade do posto.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = v_q.id AND v.quadro_indice = v_i);

        INSERT INTO public."SISTEMA_RECRUTAMENTO" (
          motivo_vaga, contrato, cargo, estado, cidade,
          quantidade_vagas, data_inicio_prevista, escala, horario, salario,
          insalubridade_recebe, insalubridade_quanto, beneficios, local_exato,
          alta_rotatividade, req_obrigatorios, req_desejaveis,
          exp_minima, exp_minima_qual, observacao_importante,
          status, solicitante_nome, solicitante_cpf,
          contrato_id, posto_id, funcao_id, quadro_posto_id, quadro_indice, administrativa)
        VALUES (
          v_q.motivo_vaga, v_contrato, v_q.cargo, v_q.estado, v_q.cidade,
          1, to_char(v_q.data_inicio_prevista, 'YYYY-MM-DD'),
          v_q.escala, v_q.horario, public.rec_brl_txt(v_q.salario),
          CASE WHEN v_q.insalubridade_pct > 0 THEN 'Sim' ELSE 'Não' END,
          v_insal_txt, v_q.beneficios, v_q.local_exato,
          'Não', v_q.req_obrigatorios, v_q.req_desejaveis,
          v_q.exp_minima, v_q.exp_minima_qual,
          btrim(concat_ws(E'\n',
            format('Vaga %s de %s — posto "%s", função "%s" — quadro do contrato %s.',
                   v_i, v_q.quantidade, v_q.posto_nome, v_q.funcao_nome, v_contrato),
            v_q.observacao)),
          'Pendente Analista', v_nome_user, v_email,
          p_contrato_id, v_q.sup_posto_id, v_q.sup_funcao_id, v_q.id, v_i, false)
        RETURNING id INTO v_id;

        v_criadas := v_criadas + 1;
        IF v_primeira IS NULL THEN v_primeira := v_id; END IF;
      END LOOP;
    ELSE
      v_criadas := GREATEST(v_q.quantidade - v_ja, 0);
    END IF;

    posto_nome    := v_q.posto_nome;
    funcao_nome   := v_q.funcao_nome;
    criadas       := v_criadas;
    ja_existiam   := v_ja;
    primeira_vaga := v_primeira;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Reaplicar sistema_recrutamento_guard da 20261014000019,
--   contrato_quadro_gerar_vagas da 20260930000241 e rec_grau_por_data da
--   20260903000001 (volta aos 7 dias úteis). Depois:
--   DROP FUNCTION IF EXISTS public.rec_antecedencia_minima_vaga();
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
