-- =========================================================================
-- Demissão: o cancelamento pedido pelo ENCARREGADO passa pela aprovação do RH
--
-- PEDIDO (25/09/2026, Pablo)
--   "Quando o encarregado solicita CANCELAMENTO de demissão, deve ir pro RH
--   aprovar o cancelamento. Com um ícone vermelho de cancelamento."
--
-- ANTES (mig 182 → 200)
--   O botão Cancelar do encarregado cancelava na hora (status 'Cancelada'),
--   até o ASO ser agendado. O RH só ficava sabendo pelo fio da conversa.
--
-- AGORA
--   1. Status novo 'Cancelamento solicitado'. O encarregado PEDE, com motivo;
--      a solicitação congela ali (nenhuma etapa age nela) e o status de onde
--      saiu fica em cancel_status_anterior. Vale em qualquer etapa em aberto,
--      inclusive com o ASO agendado ou válido: quem decide agora é o RH, que
--      já cancelava nesses status (mig 198/200).
--   2. RPC demissao_decidir_cancelamento(id, aprovar, observacao): só quem tem
--      rh_demissoes/aprovar.
--        · aprova → 'Cancelada' com o motivo do encarregado, cancela a vaga de
--          Substituição que nem abriu e, se estava no SST, avisa o SST pra
--          desmarcar o ASO (a mesma efetivação do cancelamento direto do RH);
--        · recusa (observação obrigatória) → volta pro status de antes, e o
--          encarregado é avisado no sino com o porquê.
--   3. O cancelamento DIRETO do RH (BlocoCancelarReconsideracaoRH) continua
--      igual — a efetivação saiu pra demissao_efetivar_cancelamento, que as
--      duas RPCs chamam.
--   4. Gatilhos que enxergavam status:
--        · demissao_exige_vaga deixa ir pra 'Cancelamento solicitado' sem a
--          vaga (pedir cancelamento não é "seguir");
--        · ssd_guard_aprovador_setor não barra o encarregado que pede
--          cancelamento de uma demissão em 'Pendente Diretoria' — a trava é
--          de APROVAÇÃO por setor, não de cancelamento (antes o cancelamento
--          direto ali também estourava essa trava).
--
-- O aviso ao RH quando chega o pedido é do gatilho de notificações da
-- mig 20260930000240 (status 'Cancelamento solicitado' → rh_demissoes/aprovar).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_DEMISSAO"
  ADD COLUMN IF NOT EXISTS cancel_pedido_por      text,
  ADD COLUMN IF NOT EXISTS cancel_pedido_email    text,
  ADD COLUMN IF NOT EXISTS cancel_pedido_em       timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_pedido_motivo   text,
  ADD COLUMN IF NOT EXISTS cancel_status_anterior text,
  ADD COLUMN IF NOT EXISTS cancel_recusa_por      text,
  ADD COLUMN IF NOT EXISTS cancel_recusa_em       timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_recusa_motivo   text;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_DEMISSAO".cancel_status_anterior IS
  'Status em que a demissão estava quando o encarregado pediu o cancelamento — pra onde ela volta se o RH recusar (mig 239, 25/09/2026).';

-- ── 4) Gatilhos ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demissao_exige_vaga()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.vaga_obrigatoria
     AND NEW.vaga_id IS NULL
     AND OLD.status IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
     AND NEW.status NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada', 'Cancelada', 'Cancelamento solicitado')
     AND length(btrim(coalesce(NEW.sem_vaga_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Esta demissão ainda não tem a vaga de reposição. Abra a vaga de Substituição de % ou descreva o motivo da exceção antes de o pedido seguir.', NEW.colaborador_nome;
  END IF;
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION public.ssd_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status = 'Pendente Diretoria'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('Cancelamento solicitado', 'Cancelada')
     AND NOT public.aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova demissões do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

-- ── 3) A efetivação (interna): o que o cancelamento faz, venha de onde vier ─
-- p_status_origem é o status em que a demissão ESTAVA (no pedido do
-- encarregado, o cancel_status_anterior) — é ele que decide se o SST precisa
-- desmarcar um exame. Não avisa o solicitante: cada RPC avisa com a frase dela.
CREATE OR REPLACE FUNCTION public.demissao_efetivar_cancelamento(
  p_id bigint, p_status_origem text, p_motivo text, p_cancelado_por text,
  p_email text, p_texto_fio text, p_anexos jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d          record;
  v_vaga     text := NULL;
  v_n_anexos int := 0;
  a          jsonb;
  v_no_sst   boolean := p_status_origem = ANY (ARRAY['Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído']);
  v_exame    text := '';
  v_n_sst    int := 0;
BEGIN
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = 'Cancelada',
         cancelado_por = p_cancelado_por,
         cancelado_em = now(),
         cancelado_motivo = btrim(p_motivo),
         atualizado_em = now()
   WHERE id = p_id;

  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) LOOP
    IF coalesce(a->>'storage_path', '') <> '' THEN
      INSERT INTO public."SISTEMA_SOL_DEMISSAO_ANEXOS" (solicitacao_id, nome, storage_path, tamanho, tipo, enviado_por)
      VALUES (p_id, 'Cancelamento — ' || coalesce(a->>'nome', 'arquivo'), a->>'storage_path',
              nullif(a->>'tamanho', '')::bigint, nullif(a->>'tipo', ''), p_email);
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

  IF p_status_origem = 'Agendamento concluído' THEN
    v_exame := ' Exame agendado: ' || coalesce(to_char(d.sst_data_exame::date, 'DD/MM/YYYY'), 'data não informada')
            || coalesce(' às ' || left(d.sst_hora_exame::text, 5), '')
            || coalesce(' — ' || nullif(rtrim(btrim(d.sst_local_exame::text), '.'), ''), '') || '.';
  END IF;

  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, p_cancelado_por, p_email,
          p_texto_fio
          || CASE WHEN v_no_sst THEN ' Estava no SST (' || p_status_origem || ') — SST avisado para cancelar o agendamento do ASO.'
                  WHEN p_status_origem = 'ASO válido' THEN ' Já estava concluída pelo SST (ASO válido — não havia exame a desmarcar).'
                  ELSE '' END
          || ' Motivo: ' || btrim(p_motivo)
          || CASE WHEN v_n_anexos > 0 THEN ' (' || v_n_anexos || ' arquivo(s) em Documentos)' ELSE '' END);

  IF v_no_sst THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT u, 'Cancelar agendamento do ASO demissional',
           left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—')
                || ' — demissão cancelada (reconsideração).' || v_exame
                || ' Motivo: ' || btrim(p_motivo), 300),
           'warning', '/app/sst/aso-demissional?abrir=' || p_id
      FROM public.malote_usuarios_com_acesso('sst_aso_demissional', 'visualizar'::public.app_acao) AS u
     WHERE u IS DISTINCT FROM auth.uid();
    GET DIAGNOSTICS v_n_sst = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'Cancelada', 'vaga', v_vaga,
                            'anexos', v_n_anexos, 'sst_avisados', v_n_sst);
END $fn$;
-- Interna: só as RPCs abaixo (SECURITY DEFINER) chamam.
REVOKE ALL ON FUNCTION public.demissao_efetivar_cancelamento(bigint, text, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_efetivar_cancelamento(bigint, text, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.demissao_efetivar_cancelamento(bigint, text, text, text, text, text, jsonb) FROM authenticated;

-- ── 1) demissao_cancelar: o RH cancela direto; o encarregado PEDE ─────────
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
  v_rh_status := d.status = ANY (ARRAY['Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído', 'ASO válido']);

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

-- ── 2) O RH decide o pedido ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.demissao_decidir_cancelamento(p_id bigint, p_aprovar boolean, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d          record;
  v_email    text := lower(coalesce(auth.email(), ''));
  v_nome     text;
  v_solic_id uuid;
  v_obs      text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_ret      jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'::public.app_acao) THEN
    RAISE EXCEPTION 'Só o RH (Solicitações de Demissão › aprovar) decide o pedido de cancelamento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public."SISTEMA_SOLICITACOES_DEMISSAO" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Solicitação #% não existe.', p_id; END IF;
  IF d.status <> 'Cancelamento solicitado' THEN
    RAISE EXCEPTION 'A solicitação #% não tem pedido de cancelamento em aberto (está %).', p_id, d.status;
  END IF;
  IF NOT p_aprovar AND length(coalesce(v_obs, '')) < 10 THEN
    RAISE EXCEPTION 'Explique ao solicitante por que o cancelamento foi recusado (mín. 10 caracteres).';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  v_nome := coalesce(v_nome, v_email);
  SELECT id INTO v_solic_id FROM public.profiles WHERE lower(email) = lower(coalesce(d.solicitante_email, '')) LIMIT 1;

  IF p_aprovar THEN
    v_ret := public.demissao_efetivar_cancelamento(
      p_id, coalesce(d.cancel_status_anterior, ''), d.cancel_pedido_motivo,
      coalesce(d.cancel_pedido_por, d.solicitante_nome, 'Solicitante') || ' · aprovado pelo RH (' || v_nome || ')',
      v_email,
      '🚫 DEMISSÃO CANCELADA — pedido do solicitante APROVADO pelo RH (' || v_nome || ').'
        || coalesce(' Observação do RH: ' || v_obs || '.', ''),
      '[]'::jsonb);
    IF v_solic_id IS NOT NULL AND v_solic_id IS DISTINCT FROM auth.uid() THEN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v_solic_id, 'Cancelamento de demissão aprovado pelo RH',
              left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—') || ' — a demissão foi cancelada.'
                   || coalesce(' ' || v_obs, ''), 300),
              'success', '/app/encarregados/minhas-solicitacoes');
    END IF;
    RETURN v_ret || jsonb_build_object('decisao', 'aprovado');
  END IF;

  IF coalesce(d.cancel_status_anterior, '') = '' THEN
    RAISE EXCEPTION 'Não sei para onde a solicitação #% volta (status anterior não gravado). Fale com o suporte.', p_id;
  END IF;

  UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
     SET status = d.cancel_status_anterior,
         cancel_recusa_por = v_nome,
         cancel_recusa_em = now(),
         cancel_recusa_motivo = v_obs,
         atualizado_em = now()
   WHERE id = p_id;

  INSERT INTO public."SISTEMA_COMENTARIOS" (modulo, entidade_id, autor_nome, autor_cpf, texto)
  VALUES ('demissao', p_id::text, v_nome, v_email,
          '↩ Pedido de cancelamento RECUSADO pelo RH — a demissão segue em ' || d.cancel_status_anterior || '. Motivo: ' || v_obs);

  IF v_solic_id IS NOT NULL AND v_solic_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_solic_id, 'Cancelamento de demissão recusado pelo RH',
            left('#' || p_id || ' · ' || coalesce(d.colaborador_nome, '—') || ' — a demissão continua. Motivo: ' || v_obs, 300),
            'warning', '/app/encarregados/minhas-solicitacoes');
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', d.cancel_status_anterior, 'decisao', 'recusado');
END $fn$;
REVOKE ALL ON FUNCTION public.demissao_decidir_cancelamento(bigint, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demissao_decidir_cancelamento(bigint, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.demissao_decidir_cancelamento(bigint, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (antes, devolver as que estiverem em 'Cancelamento solicitado':)
-- UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" SET status = cancel_status_anterior
--  WHERE status = 'Cancelamento solicitado' AND cancel_status_anterior IS NOT NULL;
-- DROP FUNCTION IF EXISTS public.demissao_decidir_cancelamento(bigint, boolean, text);
-- DROP FUNCTION IF EXISTS public.demissao_efetivar_cancelamento(bigint, text, text, text, text, text, jsonb);
-- Reaplicar demissao_cancelar da 20260930000200, demissao_exige_vaga da 182
-- e ssd_guard_aprovador_setor da versão anterior (sem a exceção de cancelamento).
-- NOTIFY pgrst, 'reload schema';
