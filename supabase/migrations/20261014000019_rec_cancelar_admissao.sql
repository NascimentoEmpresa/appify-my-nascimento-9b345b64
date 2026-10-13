-- =========================================================================
-- Recrutamento: "PODE CANCELAR ADMISSÃO" (14/10/2026)
--
-- Pedido do Pablo: "preciso que tenha aqui em gerenciamento de acesso, quando
-- o usuário estiver no kanban admitido ou concluído, pra que mesmo quando
-- alguém estiver como admitido/concluído conseguir CANCELAR a admissão da
-- pessoa e informar o porquê; aí a pessoa vai pra reprovado/cancelado e a
-- vaga fica em abertura novamente."
--
-- Até aqui, uma vez em ADMISSÃO (Contratar ou Concluir direto) não havia
-- volta: o card não tinha Reprovar e a vaga "Contratado" nem mostrava mais o
-- kanban. A RPC rec_cancelar_admissao desfaz o fim do processo:
--   • o candidato vai para "Reprovado" com o motivo ("Admissão cancelada: …")
--     e sai de RH › Novas Admissões (enviado_admissao_em/admitido_* limpos);
--     quem cancelou, quando e por quê ficam em admissao_cancelada_*;
--   • o pedido de login do ERP ainda não entregue (SIS_LOGIN_PEDIDO pendente
--     ou criado) é cancelado junto;
--   • a vaga sai de Contratado/Concluída, perde o contratado_nome e volta
--     para "Vaga aberta - Seleção de Currículos" — e daí o
--     sr_sync_status_solicitacao a acompanha pelo candidato mais adiantado
--     que sobrou, como sempre.
--
-- Capacidade = menu fantasma, nasce vazio (Acesso por Usuário › Recrutamento
-- e Seleção). A trava da vaga (sistema_recrutamento_guard) ganha uma exceção
-- estreita, por marca de transação, como a da sincronização (mig
-- 20261014000013): só status, status_changed_at e contratado_nome.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── A capacidade ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'recrutamento_cancelar_admissao', 'PODE CANCELAR ADMISSÃO', NULL, 29, true
  FROM public.app_modulo m
 WHERE m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('recrutamento_cancelar_admissao', 'aprovar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── Rastro do cancelamento no candidato ─────────────────────────────────
ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS admissao_cancelada_em     timestamptz,
  ADD COLUMN IF NOT EXISTS admissao_cancelada_por    text,
  ADD COLUMN IF NOT EXISTS admissao_cancelada_motivo text;

-- ── Guarda de colunas (versão da mig 20261014000013 + a exceção acima) ──
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

-- ── Cancelar admissão ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rec_cancelar_admissao(p_candidato bigint, p_motivo text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_motivo text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  c        record;
  r        record;
  v_quem   text;
  v_email  text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'recrutamento_cancelar_admissao', 'aprovar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem "PODE CANCELAR ADMISSÃO". Peça ao administrador em Acesso por Usuário (Recrutamento e Seleção).'
      USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo 10 caracteres).';
  END IF;

  SELECT * INTO c FROM public."WA_CURRICULOS" WHERE id = p_candidato FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Candidato #% não encontrado.', p_candidato; END IF;
  IF c.etapa_processo IS DISTINCT FROM 'ADMISSÃO' THEN
    RAISE EXCEPTION 'Só dá para cancelar a admissão de quem está na coluna Admissão (este está em %).', coalesce(c.etapa_processo, '—');
  END IF;

  IF c.vaga_id IS NOT NULL THEN
    SELECT * INTO r FROM public."SISTEMA_RECRUTAMENTO" WHERE id = c.vaga_id FOR UPDATE;
    IF r.id IS NOT NULL AND coalesce(r.administrativa, false)
       AND NOT (public.has_screen_access(v_uid, 'recrutamento_vaga_administrativa', 'visualizar'::public.app_acao)
                OR public.has_screen_access(v_uid, 'diretoria_recrutamento', 'visualizar'::public.app_acao)) THEN
      RAISE EXCEPTION 'Candidato #% não encontrado.', p_candidato;
    END IF;
  END IF;

  SELECT coalesce(nullif(btrim(display_name), ''), email), email INTO v_quem, v_email
    FROM public.profiles WHERE id = v_uid;

  -- 1) A vaga reabre ANTES de o candidato sair: o sr_sync_status_solicitacao
  --    ignora vaga "Concluída", então ela precisa estar aberta para ele
  --    recalcular pelo candidato mais adiantado que sobrou.
  IF r.id IS NOT NULL AND (r.status IN ('Contratado', 'Concluída') OR r.status LIKE 'Concluído%') THEN
    PERFORM set_config('app.rec_cancelar_admissao', 'on', true);
    UPDATE public."SISTEMA_RECRUTAMENTO"
       SET status = 'Vaga aberta - Seleção de Currículos', contratado_nome = NULL
     WHERE id = r.id;
    PERFORM set_config('app.rec_cancelar_admissao', 'off', true);
  END IF;

  -- 2) O candidato vai para Reprovado e sai da Admissão (RH).
  UPDATE public."WA_CURRICULOS"
     SET etapa_processo = 'Reprovado', etapa_changed_at = now(),
         motivo_reprovacao = 'Admissão cancelada: ' || v_motivo,
         enviado_admissao_em = NULL, enviado_admissao_por = NULL,
         admitido_em = NULL, admitido_por = NULL,
         admissao_cancelada_em = now(), admissao_cancelada_por = v_quem,
         admissao_cancelada_motivo = v_motivo
   WHERE id = c.id;

  -- 3) Login do ERP pedido pela admissão e ainda não entregue.
  UPDATE public."SIS_LOGIN_PEDIDO"
     SET status = 'cancelado', senha = NULL, obs = 'Admissão cancelada no Recrutamento: ' || v_motivo
   WHERE candidato_id = c.id AND status IN ('pendente', 'criado');

  INSERT INTO public."RECRUTAMENTO_HISTORICO"
    (solicitacao_id, candidato_id, candidato_nome, evento, de_status, para_status, papel, usuario_nome, usuario_email, detalhe)
  VALUES
    (c.vaga_id, c.id, c.nome, 'Admissão cancelada — candidato reprovado, vaga reaberta',
     coalesce(r.status, 'ADMISSÃO'), 'Reprovado', 'Recrutamento', v_quem, v_email, v_motivo);
END $fn$;

REVOKE ALL ON FUNCTION public.rec_cancelar_admissao(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_cancelar_admissao(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar sistema_recrutamento_guard da 20261014000013. Depois:
-- DROP FUNCTION IF EXISTS public.rec_cancelar_admissao(bigint, text);
-- ALTER TABLE public."WA_CURRICULOS" DROP COLUMN IF EXISTS admissao_cancelada_em,
--   DROP COLUMN IF EXISTS admissao_cancelada_por, DROP COLUMN IF EXISTS admissao_cancelada_motivo;
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'recrutamento_cancelar_admissao';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'recrutamento_cancelar_admissao';
-- DELETE FROM public.app_menu_acao           WHERE menu_codigo = 'recrutamento_cancelar_admissao';
-- DELETE FROM public.app_menu                WHERE codigo      = 'recrutamento_cancelar_admissao';
-- NOTIFY pgrst, 'reload schema';
