-- Lote 8g, bloco 5e: OBZ, importação de Grade de Licitações, estoque e
-- Copiloto IA — últimas funções com has_role direto antes da auditoria
-- final (Lote 8h).
-- Corpo de cada função copiado verbatim da última definição viva (conferido
-- lendo os arquivos-fonte): obz_status_guard de 20260429181611,
-- obz_versao_criar/submeter/aprovar/arquivar/obz_valor_upsert de
-- 20260508134000, pode_usar_copiloto de 20260513213829,
-- tg_centros_custo_troca_empresa de 20260520161217, licitacao_importacao_*
-- de 20260601045834 (última versão — supera 20260531212233),
-- estoque_aplicar_movimento de 20260430000723.
--
-- Mapeamento de menu/ação:
--   * obz_* -> menu 'obz-versoes' (já existe, Fase 3: obzv_select/insert/
--     update/delete + obzp_*/obzval_*). Lifecycle da versão (criar/submeter/
--     aprovar/arquivar/status_guard: admin+controladoria+diretor_adm) ->
--     'alterar'. obz_valor_upsert (mesmo trio + gestor_cc, ação mais
--     operacional de preencher valores) -> 'incluir', tier mais largo já
--     usado nesse menu, compatível com incluir o gestor_cc.
--   * pode_usar_copiloto -> 'plano_acoes_copiloto'/'visualizar': é a MESMA
--     tela que CopilotoIA.tsx (Lote 8c) já gateia via can("visualizar",
--     undefined,"plano_acoes_copiloto") — a função só nunca tinha sido
--     atualizada, então hoje bloqueia no banco quem o frontend já libera.
--     (O 'copiloto_ia' registrado em app_menu por 20260513213829 é um menu
--     morto, nunca referenciado pelo frontend — não usado aqui.)
--   * tg_centros_custo_troca_empresa -> 'administracao'/'alterar', mesmo
--     bypass já usado em admin_alterar_empresa_cc (Lote 8g-5b), que dispara
--     a mesma troca de empresa por outro caminho.
--   * licitacao_importacao_* -> 'pipeline'/'excluir': tabela licitacao já
--     usa o menu 'pipeline' (Fase 3); estas RPCs eram estritamente
--     "somente_admin", mais restrito que o CRUD geral (visualizar/incluir/
--     alterar) — 'excluir' é o tier mais alto já usado nesse menu
--     (lic_delete), preserva a restrição.
--   * estoque_aplicar_movimento -> 'movimentos'/'alterar': a tabela já usa
--     o menu 'movimentos' pro INSERT geral (Fase 3, 'incluir', admin/
--     almoxarife/comprador/controladoria); o check aqui é só pra "forçar
--     saldo negativo", um subconjunto mais restrito (admin+almoxarife) —
--     'alterar' nunca tinha sido usado nesse menu, grant novo pro Legado
--     abaixo.
--
-- ROLLBACK: recriar cada função com has_role() nas combinações originais
-- (arquivos-fonte citados acima); remover o grant de 'movimentos'/'alterar'
-- inserido no fim.

-- 1) obz_status_guard
CREATE OR REPLACE FUNCTION public.obz_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('aprovada','arquivada')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NOT public.can_access(auth.uid(), 'obz-versoes', 'alterar') THEN
    RAISE EXCEPTION 'Apenas admin pode aprovar ou arquivar versões OBZ';
  END IF;
  IF NEW.status = 'aprovada' AND OLD.status IS DISTINCT FROM 'aprovada' THEN
    NEW.aprovado_por := auth.uid();
    NEW.aprovado_em := now();
  END IF;
  RETURN NEW;
END; $$;

-- 2) obz_versao_criar
CREATE OR REPLACE FUNCTION public.obz_versao_criar(_empresa_id uuid, _ano int, _nome text DEFAULT NULL, _descricao text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_versao int; m int;
BEGIN
  IF NOT public.can_access(auth.uid(), 'obz-versoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT COALESCE(MAX(versao),0)+1 INTO v_versao FROM obz_versoes WHERE empresa_id=_empresa_id AND ano=_ano;
  INSERT INTO obz_versoes(empresa_id, ano, versao, revisao, nome, descricao, status, criado_por)
  VALUES (_empresa_id, _ano, v_versao, 0, COALESCE(_nome, 'OBZ '||_ano||' v'||v_versao), _descricao, 'rascunho'::obz_status, auth.uid())
  RETURNING id INTO v_id;
  FOR m IN 1..12 LOOP
    INSERT INTO obz_periodos(versao_id, mes, status) VALUES (v_id, m, 'rascunho'::obz_status);
  END LOOP;
  RETURN v_id;
END $$;

-- 3) obz_versao_submeter
CREATE OR REPLACE FUNCTION public.obz_versao_submeter(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'obz-versoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE obz_versoes SET status='em_aprovacao'::obz_status WHERE id=_id AND status='rascunho';
  IF NOT FOUND THEN RAISE EXCEPTION 'Versão não está em rascunho'; END IF;
  UPDATE obz_periodos SET status='em_aprovacao'::obz_status WHERE versao_id=_id AND status='rascunho';
END $$;

-- 4) obz_versao_aprovar
CREATE OR REPLACE FUNCTION public.obz_versao_aprovar(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'obz-versoes', 'alterar') THEN
    RAISE EXCEPTION 'Apenas admin, controladoria ou diretor adm aprovam OBZ';
  END IF;
  UPDATE obz_versoes SET status='aprovada'::obz_status, aprovado_por=auth.uid(), aprovado_em=now()
   WHERE id=_id AND status='em_aprovacao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Versão não está em aprovação'; END IF;
  UPDATE obz_periodos SET status='aprovada'::obz_status WHERE versao_id=_id;
END $$;

-- 5) obz_versao_arquivar
CREATE OR REPLACE FUNCTION public.obz_versao_arquivar(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'obz-versoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE obz_versoes SET status='arquivada'::obz_status WHERE id=_id;
  UPDATE obz_periodos SET status='arquivada'::obz_status WHERE versao_id=_id;
END $$;

-- 6) obz_valor_upsert
CREATE OR REPLACE FUNCTION public.obz_valor_upsert(
  _versao_id uuid, _dre_linha_id uuid, _centro_custo_id uuid, _mes int, _valor numeric, _memoria text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_per uuid; v_ver_status obz_status; v_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'obz-versoes', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT status INTO v_ver_status FROM obz_versoes WHERE id=_versao_id;
  IF v_ver_status IS NULL THEN RAISE EXCEPTION 'Versão não encontrada'; END IF;
  IF v_ver_status NOT IN ('rascunho','em_aprovacao') THEN RAISE EXCEPTION 'Versão já aprovada/arquivada — não editável'; END IF;
  SELECT id INTO v_per FROM obz_periodos WHERE versao_id=_versao_id AND mes=_mes;
  IF v_per IS NULL THEN RAISE EXCEPTION 'Período mês % não existe', _mes; END IF;

  SELECT id INTO v_id FROM obz_valores
   WHERE versao_id=_versao_id AND periodo_id=v_per AND dre_linha_id=_dre_linha_id
     AND centro_custo_id IS NOT DISTINCT FROM _centro_custo_id;
  IF v_id IS NULL THEN
    INSERT INTO obz_valores(versao_id, periodo_id, dre_linha_id, centro_custo_id, valor, memoria_calculo)
    VALUES (_versao_id, v_per, _dre_linha_id, _centro_custo_id, _valor, _memoria) RETURNING id INTO v_id;
  ELSE
    UPDATE obz_valores SET valor=_valor, memoria_calculo=_memoria WHERE id=v_id;
  END IF;
  RETURN v_id;
END $$;

-- 7) pode_usar_copiloto
CREATE OR REPLACE FUNCTION public.pode_usar_copiloto(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access(_uid, 'plano_acoes_copiloto', 'visualizar')
$$;

-- 8) tg_centros_custo_troca_empresa
CREATE OR REPLACE FUNCTION public.tg_centros_custo_troca_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cenario text;
  motivo_txt text;
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    cenario := public.pode_alterar_empresa_cc(OLD.id);

    IF cenario = 'bloqueado' THEN
      RAISE EXCEPTION 'Não é possível alterar a empresa do CC % (%): existem movimentos vinculados (títulos, NFs, lançamentos, etc.). Faça o estorno/reemissão pelo processo administrativo.', OLD.codigo, OLD.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar a empresa de um CC.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    motivo_txt := current_setting('app.motivo_troca_empresa_cc', true);

    INSERT INTO public.centros_custo_empresa_log
      (centro_custo_id, empresa_id_anterior, empresa_id_novo, motivo, cenario, alterado_por)
    VALUES
      (OLD.id, OLD.empresa_id, NEW.empresa_id, NULLIF(motivo_txt, ''), cenario, auth.uid());

    UPDATE public.contrato
      SET empresa_id = NEW.empresa_id, updated_at = now()
      WHERE centro_custo_id = OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

-- 9) licitacao_importacao_criar_lote
CREATE OR REPLACE FUNCTION public.licitacao_importacao_criar_lote(
  p_empresa uuid,
  p_arquivo_nome text,
  p_arquivo_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_lote   uuid := gen_random_uuid();
  v_codigo text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_pode_atuar_empresa(v_uid, p_empresa) THEN
    RAISE EXCEPTION 'empresa_fora_de_atuacao' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access(v_uid, 'pipeline', 'excluir') THEN
    RAISE EXCEPTION 'somente_admin_pode_importar_grade' USING ERRCODE = '42501';
  END IF;

  v_codigo := 'LIC-GRADE-'
           || to_char(now() AT TIME ZONE 'utc', 'YYYYMMDD-HH24MISS')
           || '-' || left(replace(v_lote::text, '-', ''), 8);

  INSERT INTO public.integration_batches (
    id, empresa_id, codigo, descricao, status,
    enviado_por, total_linhas, linhas_validas, linhas_invalidas,
    observacoes, metadata, created_at, updated_at
  ) VALUES (
    v_lote,
    p_empresa,
    v_codigo,
    COALESCE(NULLIF(p_arquivo_nome, ''), 'Importação Grade 2026'),
    'rascunho'::public.integ_batch_status,
    v_uid, 0, 0, 0,
    'Espelho técnico para stg_licitacoes.batch_id (fluxo licitacao_importacao_lote).',
    jsonb_build_object(
      'origem', 'licitacao_importacao_lote',
      'arquivo_nome', p_arquivo_nome,
      'arquivo_hash', p_arquivo_hash,
      'fluxo', 'grade_2026'
    ),
    now(), now()
  );

  INSERT INTO public.licitacao_importacao_lote (
    id, empresa_id, arquivo_nome, arquivo_hash,
    criado_por, status, criado_em, updated_at
  ) VALUES (
    v_lote, p_empresa, p_arquivo_nome, p_arquivo_hash,
    v_uid, 'rascunho', now(), now()
  );

  RETURN v_lote;
END
$function$;

-- 10) licitacao_importacao_anexar_linhas
CREATE OR REPLACE FUNCTION public.licitacao_importacao_anexar_linhas(
  p_lote uuid,
  p_linhas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.licitacao_importacao_lote;
  v_row jsonb; v_idx int := 0; v_ok int := 0; v_err int := 0;
  v_msg text; v_abertura date; v_valor numeric;
  v_numero text; v_orgao text; v_objeto text; v_status_txt text;
  v_erros jsonb := '[]'::jsonb;
  v_valid_status text[] := ARRAY['rascunho','oportunidade','em_andamento','vencida','perdida','cancelada'];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_lote FROM public.licitacao_importacao_lote
   WHERE id = p_lote FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'lote_inexistente'; END IF;
  IF NOT public.user_pode_atuar_empresa(v_uid, v_lote.empresa_id) THEN
    RAISE EXCEPTION 'empresa_fora_de_atuacao' USING ERRCODE='42501'; END IF;
  IF NOT public.can_access(v_uid, 'pipeline', 'excluir') THEN
    RAISE EXCEPTION 'somente_admin' USING ERRCODE='42501'; END IF;
  IF v_lote.status <> 'rascunho' THEN
    RAISE EXCEPTION 'lote_nao_esta_em_rascunho' USING DETAIL = v_lote.status; END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'p_linhas_deve_ser_array'; END IF;

  DELETE FROM public.stg_licitacoes WHERE batch_id = p_lote;
  UPDATE public.licitacao_importacao_lote
     SET total_linhas = 0, total_erros = 0,
         erros_json = '[]'::jsonb, status = 'rascunho'
   WHERE id = p_lote;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_idx := v_idx + 1;
    v_msg := NULL; v_abertura := NULL; v_valor := NULL;
    v_numero := NULLIF(v_row->>'numero','');
    v_orgao  := NULLIF(v_row->>'orgao','');
    v_objeto := NULLIF(v_row->>'objeto','');
    v_status_txt := NULLIF(v_row->>'status','');

    IF v_numero IS NULL OR v_orgao IS NULL OR v_objeto IS NULL
       OR COALESCE(v_row->>'abertura','') = '' THEN
      v_msg := 'campos_obrigatorios_ausentes';
    END IF;
    IF v_msg IS NULL THEN
      BEGIN v_abertura := (v_row->>'abertura')::date;
      EXCEPTION WHEN others THEN v_msg := 'data_invalida'; END;
    END IF;
    IF v_msg IS NULL AND COALESCE(v_row->>'valor_estimado','') <> '' THEN
      BEGIN v_valor := (v_row->>'valor_estimado')::numeric;
      EXCEPTION WHEN others THEN v_msg := 'valor_estimado_invalido'; END;
    END IF;
    IF v_msg IS NULL AND v_status_txt IS NOT NULL
       AND NOT (v_status_txt = ANY(v_valid_status)) THEN
      v_msg := 'status_invalido';
    END IF;
    IF v_msg IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.stg_licitacoes s
         WHERE s.batch_id = p_lote AND s.valido = true
           AND s.empresa_id = v_lote.empresa_id
           AND (s.raw->>'orgao')  = v_orgao
           AND (s.raw->>'numero') = v_numero
           AND NULLIF(s.raw->>'abertura','')::date = v_abertura
      ) THEN v_msg := 'duplicada_no_lote'; END IF;
    END IF;

    INSERT INTO public.stg_licitacoes
      (batch_id, empresa_id, linha_origem, objeto, raw, valido, erro_msg,
       data_sessao, status_obs, local_prestacao)
    VALUES
      (p_lote, v_lote.empresa_id, v_idx, v_objeto, v_row,
       (v_msg IS NULL), v_msg, v_abertura, v_status_txt,
       v_row->>'local_prestacao');

    IF v_msg IS NULL THEN v_ok := v_ok + 1;
    ELSE v_err := v_err + 1;
         v_erros := v_erros || jsonb_build_object('linha', v_idx, 'erro', v_msg);
    END IF;
  END LOOP;

  UPDATE public.licitacao_importacao_lote
     SET total_linhas = v_idx, total_erros = v_err, erros_json = v_erros,
         status = CASE WHEN v_idx > 0 AND v_err = 0 THEN 'validado' ELSE 'rascunho' END
   WHERE id = p_lote;

  UPDATE public.integration_batches
     SET total_linhas     = v_idx,
         linhas_validas   = v_ok,
         linhas_invalidas = v_err,
         status = CASE
           WHEN v_idx = 0 THEN 'rascunho'::public.integ_batch_status
           WHEN v_err = 0 THEN 'validado_ok'::public.integ_batch_status
           ELSE 'validado_com_erros'::public.integ_batch_status
         END,
         updated_at = now()
   WHERE id = p_lote;

  RETURN jsonb_build_object(
    'linhas_recebidas', v_idx,
    'linhas_validas',   v_ok,
    'linhas_invalidas', v_err);
END
$function$;

-- 11) licitacao_importacao_confirmar
CREATE OR REPLACE FUNCTION public.licitacao_importacao_confirmar(p_lote uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.licitacao_importacao_lote;
  v_stg RECORD; v_existing public.licitacao;
  v_ins int := 0; v_upd int := 0; v_ign int := 0;
  v_pend jsonb := '[]'::jsonb; v_erros jsonb := '[]'::jsonb;
  v_resp_texto text; v_payload jsonb;
  v_status_eff public.licitacao_status;
  v_abertura date; v_valor numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_lote FROM public.licitacao_importacao_lote
   WHERE id = p_lote FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'lote_inexistente'; END IF;
  IF NOT public.user_pode_atuar_empresa(v_uid, v_lote.empresa_id) THEN
    RAISE EXCEPTION 'empresa_fora_de_atuacao' USING ERRCODE='42501'; END IF;
  IF NOT public.can_access(v_uid, 'pipeline', 'excluir') THEN
    RAISE EXCEPTION 'somente_admin' USING ERRCODE='42501'; END IF;
  IF v_lote.status NOT IN ('rascunho','validado') THEN
    RAISE EXCEPTION 'lote_nao_confirmavel' USING DETAIL = v_lote.status; END IF;
  IF EXISTS (SELECT 1 FROM public.stg_licitacoes
              WHERE batch_id = p_lote AND valido = false) THEN
    RAISE EXCEPTION 'lote_possui_linhas_invalidas'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stg_licitacoes
                  WHERE batch_id = p_lote AND valido = true) THEN
    RAISE EXCEPTION 'lote_sem_linhas_validas'; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('lic_imp_confirm:' || v_lote.empresa_id::text, 0));

  FOR v_stg IN
    SELECT * FROM public.stg_licitacoes
     WHERE batch_id = p_lote AND valido = true
     ORDER BY linha_origem
  LOOP
    v_payload  := v_stg.raw;
    v_abertura := (v_payload->>'abertura')::date;
    v_valor    := NULLIF(v_payload->>'valor_estimado','')::numeric;
    v_status_eff := COALESCE(NULLIF(v_payload->>'status',''),'rascunho')::public.licitacao_status;

    SELECT * INTO v_existing FROM public.licitacao
     WHERE empresa_id = v_lote.empresa_id
       AND orgao  = v_payload->>'orgao'
       AND numero = v_payload->>'numero'
       AND abertura = v_abertura
     FOR UPDATE;

    v_resp_texto := NULL;
    IF COALESCE(v_payload->>'observacoes','') ~* 'Resp:[[:space:]]*[^|;]+' THEN
      v_resp_texto := btrim(regexp_replace(
        v_payload->>'observacoes',
        '.*Resp:[[:space:]]*([^|;]+).*',
        '\1',
        'i'));
    END IF;
    IF v_resp_texto IS NOT NULL
       AND (v_existing.id IS NULL OR v_existing.responsavel_user_id IS NULL) THEN
      v_pend := v_pend || jsonb_build_object(
        'linha', v_stg.linha_origem,
        'orgao', v_payload->>'orgao',
        'numero', v_payload->>'numero',
        'responsavel_texto', v_resp_texto);
    END IF;

    IF v_existing.id IS NULL THEN
      INSERT INTO public.licitacao
        (empresa_id, numero, objeto, orgao, modalidade,
         valor_estimado, status, abertura, observacoes,
         local_prestacao, origem_carga, batch_id)
      VALUES
        (v_lote.empresa_id,
         v_payload->>'numero',
         v_payload->>'objeto',
         v_payload->>'orgao',
         NULLIF(v_payload->>'modalidade',''),
         COALESCE(v_valor, 0),
         v_status_eff,
         v_abertura,
         NULLIF(v_payload->>'observacoes',''),
         NULLIF(v_payload->>'local_prestacao',''),
         'grade_import_' || p_lote::text,
         p_lote);
      v_ins := v_ins + 1;
    ELSE
      IF v_existing.status IN ('vencida','cancelada')
         AND v_status_eff <> v_existing.status THEN
        v_erros := v_erros || jsonb_build_object(
          'linha', v_stg.linha_origem, 'motivo','status_protegido',
          'status_atual', v_existing.status,
          'status_recebido', v_status_eff);
        v_ign := v_ign + 1;
        CONTINUE;
      END IF;
      UPDATE public.licitacao
         SET objeto          = COALESCE(NULLIF(v_payload->>'objeto',''), objeto),
             modalidade      = COALESCE(NULLIF(v_payload->>'modalidade',''), modalidade),
             valor_estimado  = COALESCE(v_valor, valor_estimado),
             status          = v_status_eff,
             observacoes     = COALESCE(NULLIF(v_payload->>'observacoes',''), observacoes),
             local_prestacao = COALESCE(NULLIF(v_payload->>'local_prestacao',''), local_prestacao),
             origem_carga    = 'grade_import_' || p_lote::text,
             batch_id        = p_lote,
             updated_at      = now()
       WHERE id = v_existing.id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  UPDATE public.licitacao_importacao_lote
     SET total_inseridas = v_ins, total_atualizadas = v_upd, total_ignoradas = v_ign,
         erros_json = erros_json || v_erros,
         pendencias_responsavel = v_pend,
         status = 'confirmado', finalizado_em = now()
   WHERE id = p_lote;

  UPDATE public.integration_batches
     SET status = 'carregado'::public.integ_batch_status,
         updated_at = now()
   WHERE id = p_lote;

  RETURN jsonb_build_object(
    'lote', p_lote, 'inseridas', v_ins, 'atualizadas', v_upd,
    'ignoradas', v_ign,
    'pendencias_responsavel', jsonb_array_length(v_pend),
    'erros', jsonb_array_length(v_erros));
END
$function$;

-- 12) licitacao_importacao_cancelar
CREATE OR REPLACE FUNCTION public.licitacao_importacao_cancelar(p_lote uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.licitacao_importacao_lote;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_lote FROM public.licitacao_importacao_lote
   WHERE id = p_lote FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'lote_inexistente'; END IF;
  IF NOT public.user_pode_atuar_empresa(v_uid, v_lote.empresa_id) THEN
    RAISE EXCEPTION 'empresa_fora_de_atuacao' USING ERRCODE='42501'; END IF;
  IF NOT public.can_access(v_uid, 'pipeline', 'excluir') THEN
    RAISE EXCEPTION 'somente_admin' USING ERRCODE='42501'; END IF;
  IF v_lote.status NOT IN ('rascunho','validado') THEN
    RAISE EXCEPTION 'lote_nao_cancelavel_neste_status' USING DETAIL = v_lote.status; END IF;

  UPDATE public.licitacao_importacao_lote
     SET status = 'cancelado', finalizado_em = now()
   WHERE id = p_lote;

  UPDATE public.integration_batches
     SET status = 'arquivado'::public.integ_batch_status,
         updated_at = now()
   WHERE id = p_lote;
END
$function$;

-- 13) estoque_aplicar_movimento
CREATE OR REPLACE FUNCTION estoque_aplicar_movimento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saldo_atual numeric(15,4);
  v_qtd_disponivel numeric(15,4);
  v_novo_custo_medio numeric(15,4);
  v_qtd_existente numeric(15,4);
  v_custo_existente numeric(15,4);
  v_metodo produto_metodo_custeio;
BEGIN
  SELECT metodo_custeio INTO v_metodo FROM produto WHERE id = NEW.produto_id;

  IF NEW.tipo IN ('entrada', 'ajuste') AND NEW.quantidade > 0 THEN
    INSERT INTO estoque_saldo (empresa_id, almoxarifado_id, produto_id, lote_id, quantidade, custo_unitario, ultima_movimentacao)
    VALUES (NEW.empresa_id, NEW.almoxarifado_id, NEW.produto_id, NEW.lote_id, NEW.quantidade, NEW.custo_unitario, NEW.data_movimento)
    ON CONFLICT (almoxarifado_id, produto_id, lote_id) DO UPDATE
      SET quantidade = estoque_saldo.quantidade + NEW.quantidade,
          custo_unitario = CASE
            WHEN v_metodo = 'medio' AND (estoque_saldo.quantidade + NEW.quantidade) > 0 THEN
              ((estoque_saldo.quantidade * estoque_saldo.custo_unitario) + (NEW.quantidade * NEW.custo_unitario))
              / (estoque_saldo.quantidade + NEW.quantidade)
            ELSE NEW.custo_unitario
          END,
          ultima_movimentacao = NEW.data_movimento;

    IF v_metodo = 'medio' THEN
      SELECT COALESCE(SUM(quantidade), 0), COALESCE(SUM(quantidade * custo_unitario) / NULLIF(SUM(quantidade), 0), 0)
        INTO v_qtd_existente, v_novo_custo_medio
        FROM estoque_saldo WHERE produto_id = NEW.produto_id AND empresa_id = NEW.empresa_id;
      UPDATE produto SET custo_medio_atual = v_novo_custo_medio WHERE id = NEW.produto_id;
    END IF;

  ELSIF NEW.tipo IN ('saida', 'consumo') OR (NEW.tipo = 'ajuste' AND NEW.quantidade < 0) THEN
    SELECT quantidade, quantidade - quantidade_reservada INTO v_saldo_atual, v_qtd_disponivel
      FROM estoque_saldo
     WHERE almoxarifado_id = NEW.almoxarifado_id AND produto_id = NEW.produto_id
       AND (lote_id = NEW.lote_id OR (lote_id IS NULL AND NEW.lote_id IS NULL));

    IF v_saldo_atual IS NULL THEN v_saldo_atual := 0; END IF;

    IF v_saldo_atual < ABS(NEW.quantidade) AND NOT NEW.permitiu_negativo THEN
      RAISE EXCEPTION 'Saldo insuficiente: disponível %, solicitado %. Use justificativa para forçar.',
        v_saldo_atual, ABS(NEW.quantidade);
    END IF;

    IF NEW.permitiu_negativo AND NOT public.can_access(auth.uid(), 'movimentos', 'alterar') THEN
      RAISE EXCEPTION 'Apenas admin ou almoxarife pode forçar saldo negativo';
    END IF;

    IF NEW.permitiu_negativo AND (NEW.justificativa_negativo IS NULL OR NEW.justificativa_negativo = '') THEN
      RAISE EXCEPTION 'Justificativa obrigatória para saldo negativo';
    END IF;

    UPDATE estoque_saldo
       SET quantidade = quantidade - ABS(NEW.quantidade),
           ultima_movimentacao = NEW.data_movimento
     WHERE almoxarifado_id = NEW.almoxarifado_id AND produto_id = NEW.produto_id
       AND (lote_id = NEW.lote_id OR (lote_id IS NULL AND NEW.lote_id IS NULL));

  ELSIF NEW.tipo = 'transferencia' THEN
    IF NEW.almoxarifado_destino_id IS NULL THEN
      RAISE EXCEPTION 'Transferência exige almoxarifado_destino_id';
    END IF;
    UPDATE estoque_saldo SET quantidade = quantidade - ABS(NEW.quantidade), ultima_movimentacao = NEW.data_movimento
     WHERE almoxarifado_id = NEW.almoxarifado_id AND produto_id = NEW.produto_id
       AND (lote_id = NEW.lote_id OR (lote_id IS NULL AND NEW.lote_id IS NULL));
    INSERT INTO estoque_saldo (empresa_id, almoxarifado_id, produto_id, lote_id, quantidade, custo_unitario, ultima_movimentacao)
    VALUES (NEW.empresa_id, NEW.almoxarifado_destino_id, NEW.produto_id, NEW.lote_id, ABS(NEW.quantidade), NEW.custo_unitario, NEW.data_movimento)
    ON CONFLICT (almoxarifado_id, produto_id, lote_id) DO UPDATE
      SET quantidade = estoque_saldo.quantidade + ABS(NEW.quantidade),
          ultima_movimentacao = NEW.data_movimento;
  END IF;

  IF NEW.user_id IS NULL THEN NEW.user_id := auth.uid(); END IF;

  RETURN NEW;
END $$;

-- Grant novo: 'alterar' nunca existiu no menu 'movimentos' até agora
-- (só 'visualizar'/'incluir'). Legado: admin não precisa (concede_tudo).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'movimentos', 'alterar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Legado: almoxarife'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'movimentos' AND pap.acao = 'alterar'::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
