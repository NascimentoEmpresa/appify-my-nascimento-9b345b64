-- =========================================================================
-- Demissão: o RH pede AJUSTE ao encarregado, que corrige o próprio pedido
--
-- SIS-2026-0805
--   "Quando a analista do RH pedir ajuste para o encarregado pelo sistema, que
--   o processo deixe atualizar as informações, como ajuste de data etc.
--   Atualmente não se pode ajustar, somente excluir o pedido, com isso o
--   encarregado tem que fazer um novo pedido."
--
-- ANTES
--   O RH só tinha "Devolver ao Operacional" (mig 20260930000045), que volta à
--   etapa 1 e desfaz a aprovação. Nenhuma etapa deixava o ENCARREGADO editar:
--   a saída era pedir o cancelamento e abrir outra solicitação.
--
-- AGORA
--   1. demissao_pedir_ajuste(id, motivo): só rh_demissoes/aprovar, só em
--      'Pendente RH'. Vai para o status novo 'Ajuste solicitado' e avisa quem
--      solicitou no sino.
--   2. demissao_reenviar_ajuste(id, dados, anexos_novos, anexos_remover,
--      observacao): só quem solicitou, só em 'Ajuste solicitado'. Grava os
--      campos permitidos e volta para 'Pendente RH' — o RH que pediu confere,
--      sem passar de novo pelo Operacional/Diretoria (a aprovação é mantida).
--      O que mudou fica em ajuste_alteracoes e na conversa da solicitação.
--      Colaborador, contrato, cargo, escala e setor NÃO entram: pessoa errada
--      é outra demissão, e setor/contrato decidem quem aprova.
--   3. demissao_cancelar: o RH também cancela em 'Ajuste solicitado', senão um
--      pedido que o encarregado abandonou ficaria parado sem saída. O
--      encarregado continua podendo PEDIR o cancelamento; recusado, volta para
--      'Ajuste solicitado' (cancel_status_anterior).
--   4. sino_demissao_notificar: ramo próprio para o pedido ajustado.
--
-- Por que os outros gatilhos não mudam: demissao_exige_vaga só olha a saída da
-- etapa 1; demissao_cria_rescisao só age na liberação para o SST; a checagem de
-- duplicidade trata este status como solicitação viva, e é o certo.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS ajuste_por        text,
  ADD COLUMN IF NOT EXISTS ajuste_em         timestamptz,
  ADD COLUMN IF NOT EXISTS ajuste_motivo     text,
  ADD COLUMN IF NOT EXISTS ajuste_feito_por  text,
  ADD COLUMN IF NOT EXISTS ajuste_feito_em   timestamptz,
  ADD COLUMN IF NOT EXISTS ajuste_observacao text,
  ADD COLUMN IF NOT EXISTS ajuste_alteracoes jsonb;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".ajuste_alteracoes IS
  'O que o encarregado mudou no último ajuste: [{campo, antes, depois}] (mig 20261105020000).';

-- ── 1) O RH pede o ajuste ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demissao_pedir_ajuste(p_id bigint, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d          record;
  v_email    text := lower(coalesce(auth.email(), ''));
  v_nome     text;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_solic_id uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só o RH (Solicitações de Demissão › aprovar) pede ajuste ao solicitante.' USING ERRCODE = '42501';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escreva o que precisa ser ajustado (mín. 10 caracteres).';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;
  IF d.status <> 'Pendente RH' THEN
    RAISE EXCEPTION 'O RH pede ajuste enquanto a solicitação está em Pendente RH (agora está %).', d.status;
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  v_nome := coalesce(v_nome, v_email);

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = 'Ajuste solicitado',
         ajuste_por = v_nome, ajuste_em = now(), ajuste_motivo = v_motivo,
         ajuste_feito_por = NULL, ajuste_feito_em = NULL,
         ajuste_observacao = NULL, ajuste_alteracoes = NULL,
         atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, v_nome, v_email, '✏️ AJUSTE SOLICITADO pelo RH: ' || v_motivo);

  SELECT id INTO v_solic_id FROM public.profiles WHERE lower(email) = lower(coalesce(d.solicitante_email, '')) LIMIT 1;
  IF v_solic_id IS NOT NULL AND v_solic_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_solic_id, '✏️ O RH pediu ajuste na solicitação de demissão',
            left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—') || ' — ' || v_motivo, 300),
            'warning', '/app/encarregados/minhas-solicitacoes');
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'Ajuste solicitado', 'solicitante_avisado', v_solic_id IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_pedir_ajuste(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_pedir_ajuste(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_pedir_ajuste(bigint, text) TO authenticated;

-- ── 2) O encarregado corrige e reenvia ─────────────────────────────────────
-- Tudo numa transação: campos, anexos, conversa e status. Devolve os caminhos
-- dos anexos removidos para a tela apagar os arquivos do bucket só depois que
-- deu certo.
CREATE OR REPLACE FUNCTION public.demissao_reenviar_ajuste(
  p_id bigint, p_dados jsonb, p_anexos_novos jsonb DEFAULT '[]'::jsonb,
  p_anexos_remover bigint[] DEFAULT '{}'::bigint[], p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d            record;
  c            record;
  a            jsonb;
  v_email      text := lower(coalesce(auth.email(), ''));
  v_nome       text;
  v_obs        text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_data_sol   date;
  v_data_aviso date;
  v_motivo_sol text := btrim(coalesce(p_dados->>'motivo_solicitacao', ''));
  v_motivo_ped text := btrim(coalesce(p_dados->>'motivo_pedido', ''));
  v_relato     text := btrim(coalesce(p_dados->>'relato', ''));
  v_termino    text := btrim(coalesce(p_dados->>'termino_experiencia', ''));
  v_modelo     text := btrim(coalesce(p_dados->>'modelo_aviso', ''));
  v_telefone   text := btrim(coalesce(p_dados->>'colaborador_telefone', ''));
  v_mail       text := btrim(coalesce(p_dados->>'colaborador_email', ''));
  v_posto      text := nullif(btrim(coalesce(p_dados->>'colaborador_posto', '')), '');
  v_alteracoes jsonb := '[]'::jsonb;
  v_removidos  text[] := '{}';
  v_n_novos    int := 0;
  v_n_rem      int := 0;
  v_resumo     text;
BEGIN
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;
  IF lower(coalesce(d.solicitante_email, '')) <> v_email OR v_email = '' THEN
    RAISE EXCEPTION 'Só quem abriu a solicitação pode ajustá-la.' USING ERRCODE = '42501';
  END IF;
  IF d.status <> 'Ajuste solicitado' THEN
    RAISE EXCEPTION 'Esta solicitação não está aguardando ajuste (agora está %).', d.status;
  END IF;

  -- A mesma régua do formulário de abertura.
  v_data_sol   := nullif(btrim(coalesce(p_dados->>'data_solicitacao', '')), '')::date;
  v_data_aviso := nullif(btrim(coalesce(p_dados->>'data_aviso', '')), '')::date;
  IF v_data_sol IS NULL THEN RAISE EXCEPTION 'Informe a data da solicitação.'; END IF;
  IF v_motivo_sol = '' THEN RAISE EXCEPTION 'Selecione o motivo da solicitação.'; END IF;
  IF v_motivo_ped = '' THEN RAISE EXCEPTION 'Selecione o motivo do pedido de demissão.'; END IF;
  IF length(v_relato) < 20 THEN RAISE EXCEPTION 'Relate o motivo com pelo menos 20 caracteres.'; END IF;
  IF v_termino = '' THEN RAISE EXCEPTION 'Informe o término de contrato de experiência.'; END IF;
  IF v_data_aviso IS NULL THEN RAISE EXCEPTION 'Informe a data do aviso.'; END IF;
  IF v_modelo = '' THEN RAISE EXCEPTION 'Selecione o modelo de aviso.'; END IF;
  IF length(regexp_replace(v_telefone, '\D', '', 'g')) < 10 THEN RAISE EXCEPTION 'Informe o telefone do colaborador com DDD.'; END IF;
  IF v_mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' THEN RAISE EXCEPTION 'Informe um e-mail válido do colaborador.'; END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('Data da solicitação', to_char(d.data_solicitacao, 'DD/MM/YYYY'), to_char(v_data_sol, 'DD/MM/YYYY')),
      ('Posto', d.colaborador_posto, coalesce(v_posto, d.colaborador_posto)),
      ('Motivo da solicitação', d.motivo_solicitacao, v_motivo_sol),
      ('Motivo do pedido', d.motivo_pedido, v_motivo_ped),
      ('Relato', d.relato, v_relato),
      ('Término de experiência', d.termino_experiencia, v_termino),
      ('Data do aviso', to_char(d.data_aviso, 'DD/MM/YYYY'), to_char(v_data_aviso, 'DD/MM/YYYY')),
      ('Modelo de aviso', d.modelo_aviso, v_modelo),
      ('Telefone do colaborador', d.colaborador_telefone, v_telefone),
      ('E-mail do colaborador', d.colaborador_email, v_mail)
    ) AS t(campo, antes, depois)
    WHERE t.antes IS DISTINCT FROM t.depois
  LOOP
    v_alteracoes := v_alteracoes || jsonb_build_object('campo', c.campo, 'antes', c.antes, 'depois', c.depois);
  END LOOP;

  -- Anexos: só os DESTA solicitação são removidos, venha o id que vier.
  WITH apagados AS (
    DELETE FROM public."SISTEMA_SOL_DEMISSAO_ANEXOS"
     WHERE solicitacao_id = p_id AND id = ANY (coalesce(p_anexos_remover, '{}'::bigint[]))
    RETURNING storage_path
  )
  SELECT coalesce(array_agg(storage_path), '{}') INTO v_removidos FROM apagados;
  v_n_rem := coalesce(array_length(v_removidos, 1), 0);

  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_anexos_novos, '[]'::jsonb)) LOOP
    -- O caminho tem que estar na pasta desta solicitação (o mesmo do formulário).
    IF coalesce(a->>'storage_path', '') NOT LIKE p_id::text || '/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta da solicitação #%.', p_id;
    END IF;
    INSERT INTO public."SISTEMA_SOL_DEMISSAO_ANEXOS" (solicitacao_id, nome, storage_path, tamanho, tipo, enviado_por)
    VALUES (p_id, coalesce(a->>'nome', 'arquivo'), a->>'storage_path',
            nullif(a->>'tamanho', '')::bigint, nullif(a->>'tipo', ''), v_email);
    v_n_novos := v_n_novos + 1;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_SOL_DEMISSAO_ANEXOS" WHERE solicitacao_id = p_id) THEN
    RAISE EXCEPTION 'Anexe pelo menos 1 documento.';
  END IF;
  IF jsonb_array_length(v_alteracoes) = 0 AND v_n_novos = 0 AND v_n_rem = 0 AND v_obs IS NULL THEN
    RAISE EXCEPTION 'Nada foi alterado. Corrija o que o RH pediu ou escreva uma observação para o RH.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  v_nome := coalesce(v_nome, v_email);

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET data_solicitacao = v_data_sol,
         colaborador_posto = coalesce(v_posto, colaborador_posto),
         motivo_solicitacao = v_motivo_sol,
         motivo_pedido = v_motivo_ped,
         relato = v_relato,
         termino_experiencia = v_termino,
         data_aviso = v_data_aviso,
         modelo_aviso = v_modelo,
         colaborador_telefone = v_telefone,
         colaborador_email = v_mail,
         status = 'Pendente RH',
         ajuste_feito_por = v_nome,
         ajuste_feito_em = now(),
         ajuste_observacao = v_obs,
         ajuste_alteracoes = v_alteracoes,
         atualizado_em = now()
   WHERE id = p_id;

  SELECT string_agg(e->>'campo' || ': ' || coalesce(e->>'antes', '—') || ' → ' || coalesce(e->>'depois', '—'), '; ')
    INTO v_resumo
    FROM jsonb_array_elements(v_alteracoes) e
   WHERE e->>'campo' <> 'Relato';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_alteracoes) e WHERE e->>'campo' = 'Relato') THEN
    v_resumo := concat_ws('; ', v_resumo, 'Relato alterado');
  END IF;
  IF v_n_novos > 0 THEN v_resumo := concat_ws('; ', v_resumo, v_n_novos || ' anexo(s) incluído(s)'); END IF;
  IF v_n_rem > 0 THEN v_resumo := concat_ws('; ', v_resumo, v_n_rem || ' anexo(s) removido(s)'); END IF;

  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, v_nome, v_email,
          '✏️ AJUSTE FEITO pelo solicitante — voltou para o RH.'
          || coalesce(' ' || v_resumo || '.', '')
          || coalesce(' Observação: ' || v_obs, ''));

  RETURN jsonb_build_object('id', p_id, 'status', 'Pendente RH', 'removidos', to_jsonb(v_removidos));
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text) TO authenticated;

-- ── 3) O RH também cancela em 'Ajuste solicitado' (copiada da mig 239) ─────
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
  v_sou_solic boolean;
  v_sou_rh    boolean;
  v_rh_status boolean;
  v_solic_id  uuid;
  v_ret       jsonb;
BEGIN
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Informe o motivo da reconsideração (mín. 10 caracteres).';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;

  IF d.status IN ('Concluída', 'Reprovada', 'Cancelada') THEN
    RAISE EXCEPTION 'A solicitação já está %: não há o que cancelar.', lower(d.status);
  END IF;
  IF d.status = 'Cancelamento solicitado' THEN
    RAISE EXCEPTION 'O cancelamento desta solicitação já foi pedido e está com o RH para aprovar.';
  END IF;

  v_sou_solic := lower(coalesce(d.solicitante_email, '')) = v_email;
  v_sou_rh    := public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'::public.app_acao);
  v_rh_status := d.status = ANY (ARRAY['Ajuste solicitado', 'Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído', 'ASO válido']);

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  v_nome := coalesce(v_nome, v_email);

  -- O RH decide a reconsideração: cancela direto (mig 186/198/200).
  IF v_sou_rh AND v_rh_status THEN
    v_ret := public.demissao_efetivar_cancelamento(p_id, d.status, p_motivo, v_nome || ' (RH)', v_email,
                                                   '🚫 DEMISSÃO CANCELADA pelo RH.', p_anexos);
    IF NOT v_sou_solic THEN
      SELECT id INTO v_solic_id FROM public.profiles WHERE lower(email) = lower(coalesce(d.solicitante_email, '')) LIMIT 1;
      IF v_solic_id IS NOT NULL AND v_solic_id IS DISTINCT FROM auth.uid() THEN
        INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
        VALUES (v_solic_id, 'Demissão cancelada pelo RH (reconsideração)',
                left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—') || ' — ' || btrim(p_motivo), 300),
                'warning', '/app/encarregados/minhas-solicitacoes');
      END IF;
    END IF;
    RETURN v_ret || jsonb_build_object('por', 'pelo RH');
  END IF;

  -- O encarregado PEDE — o RH aprova ou recusa (demissao_decidir_cancelamento).
  IF v_sou_solic THEN
    UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
       SET status = 'Cancelamento solicitado',
           cancel_status_anterior = d.status,
           cancel_pedido_por = v_nome,
           cancel_pedido_email = v_email,
           cancel_pedido_em = now(),
           cancel_pedido_motivo = btrim(p_motivo),
           cancel_recusa_por = NULL, cancel_recusa_em = NULL, cancel_recusa_motivo = NULL,
           atualizado_em = now()
     WHERE id = p_id;

    INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
    VALUES ('demissao', p_id::text, v_nome, v_email,
            '🚫 CANCELAMENTO SOLICITADO pelo solicitante (estava em ' || d.status || ') — aguardando a aprovação do RH. Motivo: ' || btrim(p_motivo));

    RETURN jsonb_build_object('id', p_id, 'status', 'Cancelamento solicitado', 'por', 'pedido', 'anterior', d.status);
  END IF;

  IF v_sou_rh THEN
    RAISE EXCEPTION 'O RH cancela a solicitação a partir do Pendente RH (agora está %).', d.status;
  END IF;
  RAISE EXCEPTION 'Só quem solicitou a demissão (pedindo ao RH), ou o RH, pode cancelá-la.';
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_cancelar(bigint, text, jsonb) TO authenticated;

-- ── 4) Sino (copiada da mig 256, com o ramo do pedido ajustado) ────────────
CREATE OR REPLACE FUNCTION public.sino_demissao_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_quem   text := '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
                   || coalesce(' — ' || nullif(btrim(NEW.contrato), ''), '');
  v_origem text;
  v_msg    text;
  v_sst    text[] := ARRAY['Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida',
                           'Agendamento concluído', 'ASO válido'];
BEGIN
  -- Cancelada (mig 256): avisa as filas por onde a solicitação passou.
  IF TG_OP = 'UPDATE' AND NEW.status = 'Cancelada' AND OLD.status IS DISTINCT FROM 'Cancelada' THEN
    v_origem := CASE WHEN OLD.status = 'Cancelamento solicitado'
                     THEN coalesce(NEW.cancel_status_anterior, OLD.cancel_status_anterior, OLD.status)
                     ELSE OLD.status END;
    v_msg := v_quem || ' — cancelada'
             || coalesce(' a pedido de ' || nullif(btrim(NEW.cancel_pedido_por), ''), '')
             || coalesce(' por ' || nullif(btrim(NEW.cancelado_por), ''), '')
             || coalesce('. Motivo: ' || nullif(btrim(NEW.cancelado_motivo), ''), '.');

    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_demissoes', 'visualizar'),
      '🚫 Demissão CANCELADA', v_msg, 'error', '/app/operacional/solicitacoes-demissao?abrir=' || NEW.id);
    IF v_origem = 'Pendente Diretoria' THEN
      PERFORM public.jur_notificar(public.sino_quem_tem_setor('diretoria_solicitacoes_demissao', 'visualizar', NEW.setor),
        '🚫 Demissão CANCELADA', v_msg, 'error', '/app/diretoria/solicitacoes-demissao?abrir=' || NEW.id);
    END IF;
    IF v_origem NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria') THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'visualizar'),
        '🚫 Demissão CANCELADA', v_msg, 'error', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
    END IF;
    IF v_origem = ANY (v_sst) THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('sst_aso_demissional', 'visualizar'),
        '🚫 Demissão CANCELADA — ASO não é mais necessário', v_msg, 'error', '/app/sst/aso-demissional?abrir=' || NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- O encarregado devolveu o pedido ajustado (mig 20261105020000). Sem este
  -- ramo, o RH leria "Demissão aprovada" numa solicitação que ele mesmo pediu
  -- para corrigir.
  IF TG_OP = 'UPDATE' AND OLD.status = 'Ajuste solicitado' AND NEW.status = 'Pendente RH' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'visualizar'),
      '✏️ Demissão ajustada pelo encarregado', v_quem || ' — confira o que mudou e libere para o SST.',
      'info', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.status IS NOT DISTINCT FROM OLD.status OR OLD.status = 'Cancelamento solicitado') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Pendente Operacional' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('operacional_demissoes', 'visualizar'),
      'Nova solicitação de demissão', v_quem || ' — aguardando a aprovação do Operacional.',
      'info', '/app/operacional/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente Diretoria' THEN
    PERFORM public.jur_notificar(public.sino_quem_tem_setor('diretoria_solicitacoes_demissao', 'visualizar', NEW.setor),
      'Nova solicitação de demissão', v_quem || coalesce(' (setor ' || nullif(btrim(NEW.setor), '') || ')', '') || ' — aguardando a Diretoria.',
      'info', '/app/diretoria/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente RH' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_demissoes', 'visualizar'),
      'Demissão aprovada — aguardando o RH', v_quem || ' — confira e libere para o SST.',
      'info', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
  ELSIF NEW.status = 'Pendente SST' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('sst_aso_demissional', 'visualizar'),
      'ASO demissional a agendar', v_quem || ' — liberada pelo RH.',
      'info', '/app/sst/aso-demissional?abrir=' || NEW.id);
  ELSIF NEW.status = 'Cancelamento solicitado' THEN
    -- Quem aprova decide; quem só acompanha o RH também fica sabendo (mig 256).
    PERFORM public.jur_notificar(
      ARRAY(SELECT DISTINCT u FROM unnest(public.jur_quem_tem('rh_demissoes', 'aprovar')
                                       || public.jur_quem_tem('rh_demissoes', 'visualizar')) AS u),
      '🚫 Pedido de CANCELAMENTO de demissão',
      v_quem || ' — ' || coalesce(NEW.cancel_pedido_por, NEW.solicitante_nome, 'o solicitante')
        || ' pede para cancelar. Motivo: ' || coalesce(NEW.cancel_pedido_motivo, '—'),
      'error', '/app/rh/solicitacoes-demissao?abrir=' || NEW.id);
  END IF;
  RETURN NEW;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (antes, devolver ao RH as que estiverem aguardando o encarregado:)
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET status = 'Pendente RH' WHERE status = 'Ajuste solicitado';
-- DROP FUNCTION IF EXISTS public.demissao_reenviar_ajuste(bigint, jsonb, jsonb, bigint[], text);
-- DROP FUNCTION IF EXISTS public.demissao_pedir_ajuste(bigint, text);
-- Reaplicar demissao_cancelar da 20260930000239 e sino_demissao_notificar da 20260930000256.
-- ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
--   DROP COLUMN IF EXISTS ajuste_por, DROP COLUMN IF EXISTS ajuste_em, DROP COLUMN IF EXISTS ajuste_motivo,
--   DROP COLUMN IF EXISTS ajuste_feito_por, DROP COLUMN IF EXISTS ajuste_feito_em,
--   DROP COLUMN IF EXISTS ajuste_observacao, DROP COLUMN IF EXISTS ajuste_alteracoes;
-- NOTIFY pgrst, 'reload schema';
