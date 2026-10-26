-- =========================================================================
-- RECRUTAMENTO → COMPRAS: o pedido nasce no envio (15/10/2026)
--
-- Pablo (prints do kanban e de Pedidos de Materiais): "quando for enviado pro
-- compras, preciso que gere um ID de pedido e fique registrado nesse
-- histórico; ao clicar em compras [no kanban], vai aparecer o ID do pedido e o
-- STATUS, e o compras pode colocar observações, atualizar o status… Também
-- adiciona uma opção de OBSERVAÇÃO antes de enviar pro compras e pro SST; às
-- vezes não precisa passar pelo compras — o recrutamento informa que não
-- precisa de pedido, mas o compras tem que ficar ciente: a solicitação vai
-- pro compras igual, apenas informando o motivo."
--
--   1. WA_CURRICULOS: compras_obs_rh (observação do RH para o Compras),
--      compras_dispensado + compras_dispensa_motivo. Na view, no fim.
--   2. rec_enxoval_informar GERA o pedido (antes era no "Aprovar" do Compras)
--      e registra "Pedido PED-… gerado" no histórico do candidato.
--      Quem envia é o RH, que não tem a tela de Pedidos: sup_ext_pode_ver_contrato
--      aceita o contrato quando a criação vem DESTE fluxo (marca na transação,
--      ligada só aqui dentro — não há como ligá-la pela API).
--   3. sup_adm_criar_pedido_interno: o corpo da criação, sem portão (o portão
--      fica em quem chama: sup_adm_criar_pedido exige o Compras;
--      rec_enxoval_informar exige o Recrutamento).
--   4. rec_pedido_candidato / rec_pedidos_da_vaga: o kanban mostra ID, status,
--      itens e histórico do pedido para o RH (que não lê sup_pedido).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."WA_CURRICULOS"
  ADD COLUMN IF NOT EXISTS compras_obs_rh          text,
  ADD COLUMN IF NOT EXISTS compras_dispensado      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compras_dispensa_motivo text;

CREATE OR REPLACE VIEW public."VW_RECRUTAMENTO_CANDIDATOS" WITH (security_invoker = true) AS
 SELECT c.id AS candidato_id,
    c.vaga_id, c.nome, c.telefone, c.email,
    COALESCE(c.cpf, c.cpf_cand) AS cpf,
    c.origem, c.storage_path, c.mensagem, c.etapa_processo, c.etapa_changed_at,
    c.selecionado_por, c.selecionado_em,
    c.juridico_ok, c.juridico_obs, c.juridico_por, c.juridico_em,
    c.sst_ok, c.sst_obs, c.sst_por, c.sst_em, c.sst_data_exame, c.sst_hora_exame, c.sst_local_exame,
    c.sst_agendado_por, c.sst_agendado_em,
    c.compras_necessidades, c.compras_por, c.compras_em, c.compras_obs, c.compras_data_chegada,
    c.epis_informados, c.epis_informados_em,
    c.enviado_admissao_por, c.enviado_admissao_em, c.admitido_por, c.admitido_em,
    c.empregado_id, c.motivo_reprovacao,
    c.experiencia_1, c.experiencia_2, c.experiencia_3,
    c.favorito, c.tipo_candidatura,
    c.created_at AS candidatura_em,
    s.cargo, s.contrato, s.cidade, s.status AS vaga_status, s.motivo_vaga, s.nome_substituido,
    s.escala, s.horario, s.salario, s.beneficios, s.insalubridade_recebe, s.insalubridade_quanto,
    s.local_exato, s.data_inicio_prevista, s.quantidade_vagas,
    s.req_obrigatorios, s.req_desejaveis, s.exp_minima, s.exp_minima_qual, s.grau_urgencia,
    s.solicitante_nome,
    (b.cpf_digits IS NOT NULL) AS possui_restricao,
    b.motivo AS restricao_motivo,
    c.compras_ok,
    c.desistiu, c.desistencia_motivo, c.desistencia_etapa, c.desistencia_em, c.desistencia_por,
    s.contrato_id, s.posto_id, s.funcao_id,
    c.juridico_nivel, c.juridico_pulado,
    c.cracha_foto_path,
    c.sst_visto_em, c.sst_visto_por, c.compras_visto_em, c.compras_visto_por,
    c.urgente_sst, c.urgente_compras, c.urgente_em, c.urgente_por, c.urgente_motivo,
    c.sst_maps_url,
    -- 15/10/2026
    c.compras_obs_rh, c.compras_dispensado, c.compras_dispensa_motivo
   FROM ((public."WA_CURRICULOS" c
     JOIN public."SISTEMA_RECRUTAMENTO" s ON ((s.id = c.vaga_id)))
     LEFT JOIN public."RECRUTAMENTO_CPF_BLACKLIST" b ON ((b.cpf_digits = regexp_replace(COALESCE(c.cpf, c.cpf_cand, ''::text), '\D'::text, ''::text, 'g'::text))))
  WHERE (c.etapa_processo IS NOT NULL);

-- ── Contrato liberado só para o pedido que nasce do envio do Recrutamento ─
CREATE OR REPLACE FUNCTION public.sup_ext_pode_ver_contrato(p_contrato_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_contrato_id IS NULL THEN RETURN false; END IF;

  -- 15/10/2026: pedido de admissão criado DENTRO de rec_enxoval_informar (o
  -- RH que envia não tem a tela de Pedidos). A marca é local da transação e
  -- só é ligada lá dentro; set_config não é chamável pela API.
  IF current_setting('sup.pedido_admissao_recrutamento', true) = 'on' THEN
    RETURN EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = p_contrato_id);
  END IF;

  -- Externo: exatamente o contrato que ele escolheu ao entrar.
  IF EXISTS (
    SELECT 1 FROM public.sup_ext_sessao s
     WHERE s.user_id = v_uid AND s.contrato_id = p_contrato_id
  ) THEN
    RETURN true;
  END IF;

  -- Interno: precisa da tela (solicitar OU editar a fila). Empresa NÃO
  -- entra — ver 20260901000001 e o incidente do CEITEC no cabeçalho.
  RETURN (
       public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
    OR public.can_access(v_uid, 'sup_pedidos_materiais', 'alterar')
  ) AND EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = p_contrato_id);
END $function$;

-- ── A criação do pedido de admissão, sem portão (quem chama é que cobra) ──
CREATE OR REPLACE FUNCTION public.sup_adm_criar_pedido_interno(p_enxoval_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_enxoval    public.sup_admissao_enxoval;
  v_candidato  record;
  v_itens      jsonb;
  v_observacao text;
  v_payload    jsonb;
  v_pedido_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_enxoval FROM public.sup_admissao_enxoval e WHERE e.id = p_enxoval_id FOR UPDATE;
  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Enxoval não encontrado'; END IF;
  IF v_enxoval.pedido_id IS NOT NULL THEN RETURN v_enxoval.pedido_id; END IF;
  IF v_enxoval.preenchido_em IS NULL THEN RAISE EXCEPTION 'O enxoval ainda não tem os tamanhos'; END IF;

  SELECT c.nome, c.empregado_id, c.cracha_foto_path, c.compras_obs_rh INTO v_candidato
    FROM public."WA_CURRICULOS" c WHERE c.id = v_enxoval.candidato_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', ai.sup_item_id,
           'tamanho', COALESCE(NULLIF(btrim(ai.tamanho), ''), NULLIF(btrim(ai.tamanho_informado), '')),
           'quantidade', ai.quantidade) ORDER BY ai.ordem, ai.id), '[]'::jsonb)
    INTO v_itens
    FROM public.sup_admissao_enxoval_item ai WHERE ai.enxoval_id = v_enxoval.id;

  SELECT string_agg(ai.nome_item || ': ' || btrim(ai.tamanho_informado), E'\n' ORDER BY ai.ordem, ai.id)
    INTO v_observacao
    FROM public.sup_admissao_enxoval_item ai
   WHERE ai.enxoval_id = v_enxoval.id
     AND NULLIF(btrim(ai.tamanho), '') IS NOT NULL AND NULLIF(btrim(ai.tamanho_informado), '') IS NOT NULL;
  v_observacao := concat_ws(E'\n',
    CASE WHEN NULLIF(btrim(coalesce(v_candidato.compras_obs_rh, '')), '') IS NOT NULL
         THEN 'Observação do Recrutamento: ' || btrim(v_candidato.compras_obs_rh) END,
    NULLIF(btrim(coalesce(v_enxoval.observacoes, '')), ''),
    CASE WHEN v_observacao IS NOT NULL THEN 'Observações do colaborador sobre os tamanhos:' || E'\n' || v_observacao END);

  v_payload := jsonb_build_object(
    'contrato_id', v_enxoval.contrato_id, 'posto_id', v_enxoval.posto_id, 'funcao_id', v_enxoval.funcao_id,
    'tipo_pedido', 'ambos', 'admissao', true,
    'nome_colaborador', v_candidato.nome, 'colaborador_empregado_id', v_candidato.empregado_id,
    'imagem_cracha_path', coalesce(v_enxoval.foto_cracha_path, v_candidato.cracha_foto_path),
    'observacoes_solicitante', NULLIF(v_observacao, ''),
    'itens', v_itens);

  PERFORM set_config('sup.pedido_admissao_recrutamento', 'on', true);
  SELECT (public.sup_ext_criar_pedido(v_payload)).id INTO v_pedido_id;
  PERFORM set_config('sup.pedido_admissao_recrutamento', 'off', true);

  UPDATE public.sup_admissao_enxoval SET pedido_id = v_pedido_id WHERE id = v_enxoval.id;
  RETURN v_pedido_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sup_adm_criar_pedido_interno(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_adm_criar_pedido(p_enxoval_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(auth.uid(), 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o pedido de materiais';
  END IF;
  RETURN public.sup_adm_criar_pedido_interno(p_enxoval_id);
END $fn$;

-- ── O envio do Recrutamento grava o enxoval E gera o pedido ────────────────
DROP FUNCTION IF EXISTS public.rec_enxoval_gerar_pedido(bigint);
CREATE OR REPLACE FUNCTION public.rec_enxoval_gerar_pedido(p_candidato_id bigint, p_obs_rh text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_enx  public.sup_admissao_enxoval;
  v_cand record;
  v_ped  uuid;
  v_prot text;
  v_novo boolean := false;
BEGIN
  IF NOT public.can_access(auth.uid(), 'recrutamento_gestao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão (Gestão Recrutamento › Alterar).' USING ERRCODE = '42501';
  END IF;
  -- A observação do RH para o Compras vai junto no pedido.
  UPDATE public."WA_CURRICULOS" SET compras_obs_rh = nullif(btrim(p_obs_rh), '')
   WHERE id = p_candidato_id AND p_obs_rh IS NOT NULL;
  SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id;
  IF v_enx.id IS NULL THEN RETURN jsonb_build_object('pedido_id', NULL); END IF;
  v_ped := v_enx.pedido_id;
  IF v_ped IS NULL THEN
    v_ped := public.sup_adm_criar_pedido_interno(v_enx.id);
    v_novo := true;
  END IF;
  SELECT pedido_id INTO v_prot FROM public.sup_pedido WHERE id = v_ped;
  IF v_novo THEN
    SELECT c.vaga_id, c.nome INTO v_cand FROM public."WA_CURRICULOS" c WHERE c.id = p_candidato_id;
    INSERT INTO public."RECRUTAMENTO_HISTORICO" (solicitacao_id, candidato_id, candidato_nome, evento, de_status, para_status, papel, usuario_nome, detalhe)
    VALUES (v_cand.vaga_id, p_candidato_id, v_cand.nome, 'Pedido de materiais ' || v_prot || ' gerado para o Compras',
            'SST + COMPRAS', 'SST + COMPRAS', 'Recrutamento',
            (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid()),
            'Gerado no envio para SST + COMPRAS — aparece em Suprimentos › Pedidos de Materiais.');
  END IF;
  RETURN jsonb_build_object('pedido_id', v_ped, 'protocolo', v_prot, 'novo', v_novo);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_enxoval_gerar_pedido(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_enxoval_gerar_pedido(bigint, text) TO authenticated;

-- ── O kanban lê o pedido (o RH não lê sup_pedido direto) ───────────────────
CREATE OR REPLACE FUNCTION public.rec_pode_ver_pedido_candidato()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
       public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_epis_admissao', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar'));
$fn$;

CREATE OR REPLACE FUNCTION public.rec_pedidos_da_vaga(p_vaga_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN public.rec_pode_ver_pedido_candidato() THEN
    COALESCE((SELECT jsonb_object_agg(c.id::text, jsonb_build_object('protocolo', p.pedido_id, 'status', p.status))
                FROM public."WA_CURRICULOS" c
                JOIN public.sup_admissao_enxoval e ON e.candidato_id = c.id
                JOIN public.sup_pedido p ON p.id = e.pedido_id
               WHERE c.vaga_id = p_vaga_id), '{}'::jsonb)
  ELSE '{}'::jsonb END;
$fn$;
REVOKE ALL ON FUNCTION public.rec_pedidos_da_vaga(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_pedidos_da_vaga(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_pedido_candidato(p_candidato_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE c public."WA_CURRICULOS"; p public.sup_pedido; v_itens jsonb; v_hist jsonb;
BEGIN
  IF NOT public.rec_pode_ver_pedido_candidato() THEN
    RAISE EXCEPTION 'Sem acesso ao pedido deste candidato.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public."WA_CURRICULOS" WHERE id = p_candidato_id;
  SELECT sp.* INTO p FROM public.sup_admissao_enxoval e JOIN public.sup_pedido sp ON sp.id = e.pedido_id WHERE e.candidato_id = p_candidato_id;
  IF p.id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'item_id', i.item_id, 'nome_item', i.nome_item, 'tamanho', i.tamanho,
                                                 'quantidade', i.quantidade, 'ordem', i.ordem) ORDER BY i.ordem, i.nome_item), '[]'::jsonb)
      INTO v_itens FROM public.sup_pedido_item i WHERE i.pedido_id = p.id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('acao', h.acao, 'status_anterior', h.status_anterior, 'status_novo', h.status_novo,
                                                 'observacao', h.observacao, 'por', h.alterado_por_nome, 'em', h.data_alteracao,
                                                 'campo', h.campo) ORDER BY h.data_alteracao, h.id), '[]'::jsonb)
      INTO v_hist FROM public.sup_pedido_historico h WHERE h.pedido_id = p.id;
  END IF;
  RETURN jsonb_build_object(
    'dispensado', c.compras_dispensado, 'dispensa_motivo', c.compras_dispensa_motivo, 'obs_rh', c.compras_obs_rh,
    'compras_ok', c.compras_ok, 'compras_por', c.compras_por, 'compras_em', c.compras_em, 'compras_obs', c.compras_obs,
    'compras_visto_em', c.compras_visto_em, 'compras_visto_por', c.compras_visto_por,
    'pedido', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', p.id, 'pedido_id', p.pedido_id, 'status', p.status, 'observacao', p.observacao,
      'envio_tipo', p.envio_tipo, 'envio_rastreio', p.envio_rastreio, 'tipo_pedido', p.tipo_pedido,
      'nome_colaborador', p.nome_colaborador, 'observacoes_solicitante', p.observacoes_solicitante,
      'retirado_em', p.retirado_em, 'retirado_por_nome', p.retirado_por_nome, 'created_at', p.created_at,
      'contrato_nome', p.contrato_nome, 'posto_nome', p.posto_nome, 'funcao_nome', p.funcao_nome,
      'sup_pedido_item', v_itens, 'historico', v_hist) END);
END $fn$;
REVOKE ALL ON FUNCTION public.rec_pedido_candidato(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_pedido_candidato(bigint) TO authenticated;

-- ── Aprovar no EPIs — Admissões: o pedido já existe; dispensado = ciência ──
CREATE OR REPLACE FUNCTION public.sup_adm_aprovar_compras(p_candidato_id bigint, p_obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_cand   public."WA_CURRICULOS";
  v_enx    public.sup_admissao_enxoval;
  v_pedido uuid;
  v_novo   boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar o Compras (EPIs — Admissões › Alterar).' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(btrim(display_name), ''), email) INTO v_nome FROM public.profiles WHERE id = v_uid;

  SELECT * INTO v_cand FROM public."WA_CURRICULOS" WHERE id = p_candidato_id FOR UPDATE;
  IF v_cand.id IS NULL THEN RAISE EXCEPTION 'Candidato não encontrado.'; END IF;
  IF v_cand.etapa_processo NOT IN ('SST + COMPRAS', 'EXAME SST', 'COMPRAS') THEN
    RAISE EXCEPTION 'O candidato não está mais em SST + COMPRAS (está em %).', v_cand.etapa_processo;
  END IF;
  IF v_cand.compras_ok IS TRUE THEN RAISE EXCEPTION 'O Compras já aprovou este candidato.'; END IF;

  IF NOT v_cand.compras_dispensado THEN
    SELECT * INTO v_enx FROM public.sup_admissao_enxoval WHERE candidato_id = p_candidato_id;
    v_pedido := v_enx.pedido_id;
    IF v_enx.id IS NOT NULL AND v_enx.pedido_id IS NULL AND v_enx.preenchido_em IS NOT NULL THEN
      v_pedido := public.sup_adm_criar_pedido_interno(v_enx.id);
      v_novo := true;
    END IF;
  END IF;

  UPDATE public."WA_CURRICULOS" SET
    compras_ok = true, compras_por = v_nome, compras_em = now(),
    compras_obs = nullif(btrim(coalesce(p_obs, '')), ''),
    compras_visto_em = coalesce(compras_visto_em, now()), compras_visto_por = coalesce(compras_visto_por, v_nome)
  WHERE id = p_candidato_id;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido, 'pedido_novo', v_novo, 'dispensado', v_cand.compras_dispensado,
    'protocolo', (SELECT p.pedido_id FROM public.sup_pedido p WHERE p.id = v_pedido),
    'sst_ok', v_cand.sst_ok IS TRUE);
END $fn$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (reaplicar sup_ext_pode_ver_contrato e sup_adm_criar_pedido/sup_adm_aprovar_compras da 20261015000003/20261014000045)
-- DROP FUNCTION IF EXISTS public.rec_pedido_candidato(bigint), public.rec_pedidos_da_vaga(bigint), public.rec_pode_ver_pedido_candidato(),
--   public.rec_enxoval_gerar_pedido(bigint, text), public.sup_adm_criar_pedido_interno(uuid);
-- (as 3 colunas novas de WA_CURRICULOS ficam — a view precisaria de DROP + CREATE para tirá-las)
-- NOTIFY pgrst, 'reload schema';
