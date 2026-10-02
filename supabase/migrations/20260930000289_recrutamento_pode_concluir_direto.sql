-- =========================================================================
-- Recrutamento: "PODE CONCLUIR DIRETO" (02/10/2026)
--
-- Pedido do Pablo: "coloca uma opção pra marcar a vaga como concluída, e no
-- gerenciamento de acesso do recrutamento coloca PODE CONCLUIR DIRETO — se
-- estiver flegado pode concluir a vaga e colocar direto pra admissão, mas tem
-- que colocar as informações de quem foi contratado: nome completo e CPF."
--
-- Até aqui a vaga só fechava pelo kanban do candidato: ENTRADA → … →
-- ADMISSÃO → "Contratar (enviar à Admissão)", e o gatilho
-- sr_sync_status_solicitacao virava a vaga para "Contratado". (O concluir()
-- da tela existia, mas nenhum botão o chamava.) A conclusão direta pula o
-- kanban e cai no MESMO fim:
--   • a vaga vira "Contratado" (não "Concluída": o filtro "Concluídas" da
--     Gestão Recrutamento e o Status da vaga só reconhecem Contratado /
--     Concluído…) com contratado_nome;
--   • o contratado entra em WA_CURRICULOS na etapa ADMISSÃO já com
--     enviado_admissao_em — é o que põe a pessoa em RH › Novas Admissões
--     (VW_RECRUTAMENTO_CANDIDATOS). Se ele já era candidato da vaga (mesmo
--     CPF), é esse candidato que avança, sem duplicar.
--
-- Só depois da aprovação: vaga em "Pendente Analista/Operacional/Diretoria"
-- não conclui (a aprovação é de outra pessoa — ver mig 287).
--
-- Capacidade = menu fantasma, nasce vazio (Acesso por Usuário › Recrutamento
-- e Seleção). As travas do banco que a conclusão atravessa ganham exceção
-- estreita para quem tem a capacidade:
--   • sistema_recrutamento_guard: só status → Contratado e contratado_nome;
--   • rec_pular_sst_compras_guard: o candidato em DOCUMENTAÇÃO pode ir direto
--     para ADMISSÃO (concluir direto É pular o resto).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── A capacidade ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_concluir_direto', 'PODE CONCLUIR DIRETO', NULL, 28, true
  FROM public.app_modulo m
 WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('recrutamento_concluir_direto', 'aprovar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── Guarda de colunas (versão da mig 287 + a exceção acima) ─────────────
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

-- ── Pular SST e Compras: quem conclui direto também pula ────────────────
CREATE OR REPLACE FUNCTION public.rec_pular_sst_compras_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.etapa_processo = 'DOCUMENTAÇÃO'
     AND NEW.etapa_processo = 'ADMISSÃO'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_screen_access(auth.uid(), 'recrutamento_pular_sst_compras', 'aprovar'::app_acao)
     AND NOT public.has_screen_access(auth.uid(), 'recrutamento_concluir_direto', 'aprovar'::app_acao)
  THEN
    RAISE EXCEPTION 'Você não tem permissão para pular SST e Compras.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rec_pular_sst_compras_guard() FROM PUBLIC, anon;

-- ── Concluir direto ──────────────────────────────────────────────────────
-- Devolve o id do candidato que foi para a Admissão.
CREATE OR REPLACE FUNCTION public.rec_concluir_direto(p_vaga bigint, p_nome text, p_cpf text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  r       record;
  v_nome  text := upper(btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')));
  v_dig   text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_cpf   text;
  v_cand  bigint;
  v_quem  text;
  v_email text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_concluir_direto', 'aprovar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem "PODE CONCLUIR DIRETO". Peça ao administrador em Acesso por Usuário (Recrutamento e Seleção).'
      USING ERRCODE = '42501';
  END IF;
  IF length(v_nome) < 5 OR v_nome !~ '^\S+( \S+)+$' THEN
    RAISE EXCEPTION 'Informe o nome completo de quem foi contratado (nome e sobrenome).';
  END IF;
  IF length(v_dig) <> 11 OR NOT public.is_cpf_valido(v_dig) THEN
    RAISE EXCEPTION 'CPF inválido. Confira os 11 dígitos.';
  END IF;
  v_cpf := format('%s.%s.%s-%s', substr(v_dig, 1, 3), substr(v_dig, 4, 3), substr(v_dig, 7, 3), substr(v_dig, 10, 2));
  -- O nome oficial (EMPREGADOS) vence o digitado, como em todo candidato
  -- (wa_curriculos_nome_pelo_cpf) — assim a vaga e a Admissão mostram o mesmo.
  v_nome := coalesce(public.rh_nome_oficial_por_cpf(v_cpf), v_nome);

  SELECT * INTO r FROM public."SISTEMA_RECRUTAMENTO" WHERE id = p_vaga FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não encontrada.', p_vaga; END IF;
  IF coalesce(r.administrativa, false)
     AND NOT (public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
              OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Solicitação #% não encontrada.', p_vaga;
  END IF;
  IF r.status IN ('Reprovada', 'Cancelada', 'Contratado', 'Concluída') OR r.status LIKE 'Concluído%' THEN
    RAISE EXCEPTION 'A solicitação #% já está encerrada (%).', p_vaga, r.status;
  END IF;
  IF r.status IN ('Pendente Analista', 'Pendente Operacional', 'Pendente Diretoria') THEN
    RAISE EXCEPTION 'A solicitação #% ainda está aguardando aprovação. Conclua depois de aprovada.', p_vaga;
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_quem, v_email
    FROM public.profiles WHERE id = v_uid;

  -- 1) A vaga fecha primeiro: com ela já em "Contratado", o gatilho
  --    sr_sync_status_solicitacao do candidato não a mexe de novo.
  UPDATE public."SISTEMA_RECRUTAMENTO" SET status = 'Contratado', contratado_nome = v_nome WHERE id = p_vaga;

  -- 2) O contratado vai para a Admissão: o candidato da vaga com o mesmo CPF,
  --    ou um novo.
  SELECT c.id INTO v_cand FROM public."WA_CURRICULOS" c
   WHERE c.vaga_id = p_vaga
     AND regexp_replace(coalesce(c.cpf, c.cpf_cand, ''), '\D', '', 'g') = v_dig
   ORDER BY c.id DESC LIMIT 1;

  IF v_cand IS NOT NULL THEN
    UPDATE public."WA_CURRICULOS"
       SET etapa_processo = 'ADMISSÃO', etapa_changed_at = now(),
           desistiu = false, motivo_reprovacao = NULL,
           cpf = coalesce(cpf, v_cpf), cpf_cand = coalesce(cpf_cand, v_cpf),
           selecionado_por = coalesce(selecionado_por, v_quem), selecionado_em = coalesce(selecionado_em, now()),
           enviado_admissao_por = coalesce(enviado_admissao_por, v_quem),
           enviado_admissao_em = coalesce(enviado_admissao_em, now())
     WHERE id = v_cand;
  ELSE
    INSERT INTO public."WA_CURRICULOS"
      (vaga_id, nome, cpf, cpf_cand, origem, tipo_candidatura, etapa_processo, etapa_changed_at,
       selecionado_por, selecionado_em, enviado_admissao_por, enviado_admissao_em)
    VALUES
      (p_vaga, v_nome, v_cpf, v_cpf, 'Concluída direto', 'vaga', 'ADMISSÃO', now(),
       v_quem, now(), v_quem, now())
    RETURNING id INTO v_cand;
  END IF;

  INSERT INTO public."RECRUTAMENTO_HISTORICO"
    (solicitacao_id, candidato_id, candidato_nome, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe)
  VALUES
    (p_vaga, v_cand, v_nome, 'Concluída direto — contratado enviado à Admissão (RH)', r.status, 'Contratado',
     'Recrutamento', v_quem, v_email, 'Contratado: ' || v_nome);

  RETURN v_cand;
END $fn$;

REVOKE ALL ON FUNCTION public.rec_concluir_direto(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_concluir_direto(bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar sistema_recrutamento_guard da 20260930000287 e rec_pular_sst_compras_guard
-- da 20260930000264. Depois:
-- DROP FUNCTION IF EXISTS public.rec_concluir_direto(bigint, text, text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'recrutamento_concluir_direto';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'recrutamento_concluir_direto';
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo = 'recrutamento_concluir_direto';
-- DELETE FROM public.app_menu                WHERE codigo      = 'recrutamento_concluir_direto';
-- NOTIFY pgrst, 'reload schema';
