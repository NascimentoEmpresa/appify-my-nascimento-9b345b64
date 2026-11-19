-- SIS-2026-0944 - acompanhamento publico da manutencao por QR da maquina.
-- O token e aleatorio, revogavel e nunca concede acesso a outros dados do ERP.

ALTER TABLE public.sup_patrimonio
  ADD COLUMN IF NOT EXISTS numero_serie text,
  ADD COLUMN IF NOT EXISTS placa_patrimonial text,
  ADD COLUMN IF NOT EXISTS manutencao_qr_token uuid,
  ADD COLUMN IF NOT EXISTS manutencao_qr_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manutencao_qr_gerado_em timestamptz,
  ADD COLUMN IF NOT EXISTS manutencao_qr_rotacionado_em timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_patrimonio_manutencao_qr_token
  ON public.sup_patrimonio(manutencao_qr_token)
  WHERE manutencao_qr_token IS NOT NULL;

ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO"
  ADD COLUMN IF NOT EXISTS patrimonio_id uuid REFERENCES public.sup_patrimonio(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS placa_patrimonial text,
  ADD COLUMN IF NOT EXISTS prestadora_empresa text,
  ADD COLUMN IF NOT EXISTS prestadora_responsavel text,
  ADD COLUMN IF NOT EXISTS orcamento_recebido_em timestamptz,
  ADD COLUMN IF NOT EXISTS execucao_iniciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS pronta_retirada_em timestamptz,
  ADD COLUMN IF NOT EXISTS encerrada_em timestamptz;

DO $do$
DECLARE v_nome text;
BEGIN
  FOR v_nome IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public."SUP_SOLICITACAO_MANUTENCAO"'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO" DROP CONSTRAINT %I', v_nome);
  END LOOP;
END $do$;

ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO"
  ADD CONSTRAINT sup_solicitacao_manutencao_status_check CHECK (status IN (
    'aberta', 'peca_disponivel', 'compra_solicitada',
    'aguardando_orcamento', 'aguardando_autorizacao',
    'manutencao_autorizada', 'manutencao_reprovada',
    'em_execucao', 'pronta_retirada', 'encerrada'
  )),
  ADD CONSTRAINT sup_solicitacao_manutencao_decisao_coerente CHECK (
    (status IN ('aberta', 'aguardando_orcamento', 'aguardando_autorizacao')
      AND respondida_por IS NULL AND respondida_em IS NULL)
    OR
    (status NOT IN ('aberta', 'aguardando_orcamento', 'aguardando_autorizacao'))
  ),
  ADD CONSTRAINT sup_solicitacao_manutencao_patrimonio_coerente CHECK (
    (tipo = 'peca' AND patrimonio_id IS NULL)
    OR
    (tipo = 'manutencao' AND patrimonio_id IS NOT NULL
      AND nullif(btrim(placa_patrimonial), '') IS NOT NULL)
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_manutencao_ativa_por_patrimonio
  ON public."SUP_SOLICITACAO_MANUTENCAO"(patrimonio_id)
  WHERE tipo = 'manutencao' AND patrimonio_id IS NOT NULL AND status <> 'encerrada';

ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO"
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'sistema',
  ADD COLUMN IF NOT EXISTS autor_nome text,
  ADD COLUMN IF NOT EXISTS detalhes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.sup_solicitacao_manutencao_auditar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_origem text := nullif(current_setting('app.manutencao_origem', true), '');
  v_autor_nome text := nullif(current_setting('app.manutencao_autor_nome', true), '');
BEGIN
  IF v_origem IS NULL THEN
    v_origem := CASE WHEN TG_OP = 'INSERT' THEN 'solicitante' ELSE 'suprimentos' END;
  END IF;
  INSERT INTO public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO"
    (solicitacao_id, status, motivo, autor_id, origem, autor_nome, detalhes)
  VALUES (
    NEW.id, NEW.status,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.descricao ELSE NEW.decisao_motivo END,
    CASE WHEN v_origem = 'prestadora' THEN NULL
         WHEN TG_OP = 'INSERT' THEN NEW.solicitante_id ELSE coalesce(NEW.respondida_por, auth.uid()) END,
    v_origem, v_autor_nome,
    jsonb_strip_nulls(jsonb_build_object('empresa', NEW.prestadora_empresa,
                                         'responsavel', NEW.prestadora_responsavel))
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_manutencao_notificar_suprimentos(
  p_titulo text, p_mensagem text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.notificacoes (user_id, empresa_id, titulo, mensagem, tipo, link)
  SELECT p.id, p.empresa_id, p_titulo, p_mensagem, 'info', '/app/suprimentos/solicitacoes-manutencoes'
    FROM public.profiles p
   WHERE p.ativo
     AND public.has_screen_access(p.id, 'sup_solicitacoes_manutencoes', 'alterar');
END;
$$;
REVOKE ALL ON FUNCTION public.sup_manutencao_notificar_suprimentos(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sup_equipamentos_para_manutencao(p_contrato_id uuid)
RETURNS TABLE (
  id uuid, nome text, numero_serie text, placa_patrimonial text, contrato_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'incluir')
    OR public.has_screen_access(auth.uid(), 'encarregados_solicitar_manutencao_equipamento', 'incluir')
  ) THEN
    RAISE EXCEPTION 'Sem permissao para consultar equipamentos.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.nome, p.numero_serie, p.placa_patrimonial, p.contrato_id
    FROM public.sup_patrimonio p
   WHERE p.ativo AND p.categoria = 'equipamento' AND p.contrato_id = p_contrato_id
     AND nullif(btrim(p.numero_serie), '') IS NOT NULL
     AND nullif(btrim(p.placa_patrimonial), '') IS NOT NULL
   ORDER BY p.nome, p.placa_patrimonial;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_equipamentos_para_manutencao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_equipamentos_para_manutencao(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_patrimonio_qr_emitir(
  p_patrimonio_id uuid, p_rotacionar boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_bem public.sup_patrimonio%ROWTYPE; v_token uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_patrimonio', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao para gerar o QR.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bem FROM public.sup_patrimonio WHERE id = p_patrimonio_id FOR UPDATE;
  IF NOT FOUND OR v_bem.categoria <> 'equipamento' THEN RAISE EXCEPTION 'Equipamento nao encontrado.'; END IF;
  IF nullif(btrim(v_bem.numero_serie), '') IS NULL OR nullif(btrim(v_bem.placa_patrimonial), '') IS NULL THEN
    RAISE EXCEPTION 'Informe numero de serie e placa patrimonial antes de gerar o QR.' USING ERRCODE = '22023';
  END IF;
  v_token := CASE WHEN p_rotacionar OR v_bem.manutencao_qr_token IS NULL
                  THEN gen_random_uuid() ELSE v_bem.manutencao_qr_token END;
  UPDATE public.sup_patrimonio
     SET manutencao_qr_token = v_token, manutencao_qr_ativo = true,
         manutencao_qr_gerado_em = coalesce(manutencao_qr_gerado_em, now()),
         manutencao_qr_rotacionado_em = CASE WHEN p_rotacionar THEN now() ELSE manutencao_qr_rotacionado_em END
   WHERE id = p_patrimonio_id;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_patrimonio_qr_emitir(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_patrimonio_qr_emitir(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_patrimonio_qr_revogar(p_patrimonio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_patrimonio', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao para revogar o QR.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sup_patrimonio SET manutencao_qr_ativo = false WHERE id = p_patrimonio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipamento nao encontrado.'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_patrimonio_qr_revogar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_patrimonio_qr_revogar(uuid) TO authenticated;

-- A policy de INSERT não pode depender da RLS de Patrimônio: o solicitante
-- enxerga a lista mínima pela RPC acima, sem ganhar acesso à tela patrimonial.
CREATE OR REPLACE FUNCTION public.sup_manutencao_patrimonio_compativel(
  p_patrimonio_id uuid, p_contrato_id uuid, p_numero_serie text, p_placa_patrimonial text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sup_patrimonio p
     WHERE p.id = p_patrimonio_id AND p.ativo AND p.categoria = 'equipamento'
       AND p.contrato_id = p_contrato_id
       AND p.numero_serie = p_numero_serie
       AND p.placa_patrimonial = p_placa_patrimonial
  );
$$;
REVOKE ALL ON FUNCTION public.sup_manutencao_patrimonio_compativel(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_manutencao_patrimonio_compativel(uuid, uuid, text, text) TO authenticated;

DROP POLICY IF EXISTS sup_solicitacao_manutencao_insert ON public."SUP_SOLICITACAO_MANUTENCAO";
CREATE POLICY sup_solicitacao_manutencao_insert
  ON public."SUP_SOLICITACAO_MANUTENCAO" FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = (SELECT auth.uid())
    AND (
      (SELECT public.has_screen_access((SELECT auth.uid()), 'central_servicos_solicitar_manutencao_equipamento', 'incluir'))
      OR (SELECT public.has_screen_access((SELECT auth.uid()), 'encarregados_solicitar_manutencao_equipamento', 'incluir'))
    )
    AND ((tipo = 'peca' AND status = 'aberta')
      OR (tipo = 'manutencao' AND status = 'aguardando_orcamento'))
    AND respondida_por IS NULL AND respondida_em IS NULL
    AND decisao_motivo IS NULL AND malote_despesa_id IS NULL
    AND prestadora_empresa IS NULL AND prestadora_responsavel IS NULL
    AND orcamento_recebido_em IS NULL AND execucao_iniciada_em IS NULL
    AND pronta_retirada_em IS NULL AND encerrada_em IS NULL
    AND (tipo = 'peca' OR (SELECT public.sup_manutencao_patrimonio_compativel(
      patrimonio_id, contrato_id, numero_serie, placa_patrimonial
    )))
  );

CREATE OR REPLACE FUNCTION public.sup_solicitacao_manutencao_registrar_orcamento(p_solicitacao_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public."SUP_SOLICITACAO_MANUTENCAO" WHERE id = p_solicitacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitacao nao encontrada.'; END IF;
  IF auth.uid() IS NULL OR NOT (v_s.solicitante_id = auth.uid()
    OR public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'alterar')) THEN
    RAISE EXCEPTION 'Sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF v_s.tipo <> 'manutencao' OR v_s.status NOT IN ('aguardando_orcamento', 'manutencao_reprovada') THEN
    RAISE EXCEPTION 'O orcamento nao pode ser enviado nesta etapa.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" a
                  WHERE a.solicitacao_id = v_s.id AND a.categoria = 'orcamento') THEN
    RAISE EXCEPTION 'Anexe o orcamento antes de envia-lo para autorizacao.';
  END IF;
  PERFORM set_config('app.manutencao_origem', CASE WHEN v_s.solicitante_id = auth.uid() THEN 'solicitante' ELSE 'suprimentos' END, true);
  UPDATE public."SUP_SOLICITACAO_MANUTENCAO"
     SET status = 'aguardando_autorizacao', decisao_motivo = NULL,
         respondida_por = NULL, respondida_em = NULL, orcamento_recebido_em = now()
   WHERE id = v_s.id;
  PERFORM public.sup_manutencao_notificar_suprimentos(
    'Orcamento aguardando autorizacao', v_s.maquinario || ' - patrimonio ' || v_s.placa_patrimonial);
END;
$$;
REVOKE ALL ON FUNCTION public.sup_solicitacao_manutencao_registrar_orcamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_solicitacao_manutencao_registrar_orcamento(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_responder_solicitacao_manutencao(
  p_solicitacao_id uuid, p_decisao text, p_motivo text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE; v_status text; v_malote uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissao para responder solicitacoes.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM public."SUP_SOLICITACAO_MANUTENCAO" WHERE id = p_solicitacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitacao nao encontrada.'; END IF;
  IF (v_s.tipo = 'peca' AND v_s.status <> 'aberta')
     OR (v_s.tipo = 'manutencao' AND v_s.status <> 'aguardando_autorizacao') THEN
    RAISE EXCEPTION 'Esta solicitacao nao aguarda decisao.' USING ERRCODE = 'P0001';
  END IF;
  IF (v_s.tipo = 'peca' AND p_decisao NOT IN ('peca_disponivel', 'solicitar_compra'))
     OR (v_s.tipo = 'manutencao' AND p_decisao NOT IN ('autorizar_manutencao', 'reprovar_manutencao')) THEN
    RAISE EXCEPTION 'Decisao incompativel com a solicitacao.' USING ERRCODE = '22023';
  END IF;
  IF v_s.tipo = 'manutencao' AND nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da decisao.' USING ERRCODE = '22023';
  END IF;
  v_status := CASE p_decisao WHEN 'peca_disponivel' THEN 'peca_disponivel'
    WHEN 'solicitar_compra' THEN 'compra_solicitada'
    WHEN 'autorizar_manutencao' THEN 'manutencao_autorizada'
    ELSE 'manutencao_reprovada' END;
  IF p_decisao = 'solicitar_compra' THEN
    INSERT INTO public.malote_despesa (empresa_id, origem, status, nome, valor_total, motivo, descricao,
      contrato_id, created_by, tipo)
    SELECT c.empresa_id, 'solicitacao', 'aguardando_cotacao', 'Compra interna - manutencao: ' || v_s.maquinario,
      0, 'Peca para ' || v_s.maquinario || ' (serie ' || v_s.numero_serie || ')',
      concat_ws(E'\n', v_s.descricao, p_motivo), v_s.contrato_id, auth.uid(), 'contrato'
      FROM public.contratos c WHERE c.id = v_s.contrato_id RETURNING id INTO v_malote;
  END IF;
  PERFORM set_config('app.manutencao_origem', 'suprimentos', true);
  UPDATE public."SUP_SOLICITACAO_MANUTENCAO"
     SET status = v_status, decisao_motivo = nullif(btrim(p_motivo), ''),
         malote_despesa_id = v_malote, respondida_por = auth.uid(), respondida_em = now()
   WHERE id = v_s.id;
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.solicitante_id, 'Atualizacao da manutencao', v_s.maquinario || ': ' || replace(v_status, '_', ' '),
          'info', '/app/central-servicos/solicitar-manutencao-equipamento');
  RETURN v_malote;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_responder_solicitacao_manutencao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_responder_solicitacao_manutencao(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sup_manutencao_publica_registrar_orcamento(
  p_token uuid, p_empresa text, p_responsavel text, p_nome text,
  p_caminho text, p_mime text, p_tamanho integer
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE; v_antigo text;
BEGIN
  SELECT s.* INTO v_s
    FROM public."SUP_SOLICITACAO_MANUTENCAO" s
    JOIN public.sup_patrimonio p ON p.id = s.patrimonio_id
   WHERE p.manutencao_qr_token = p_token AND p.manutencao_qr_ativo
     AND s.tipo = 'manutencao' AND s.status <> 'encerrada' FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'QR invalido ou sem manutencao ativa.' USING ERRCODE = 'P0001'; END IF;
  IF v_s.status NOT IN ('aguardando_orcamento', 'manutencao_reprovada') THEN
    RAISE EXCEPTION 'O orcamento nao pode ser enviado nesta etapa.' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(btrim(p_empresa), '') IS NULL OR nullif(btrim(p_responsavel), '') IS NULL THEN
    RAISE EXCEPTION 'Informe empresa e responsavel.' USING ERRCODE = '22023';
  END IF;
  SELECT caminho INTO v_antigo FROM public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
   WHERE solicitacao_id = v_s.id AND categoria = 'orcamento' ORDER BY created_at DESC LIMIT 1;
  DELETE FROM public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
   WHERE solicitacao_id = v_s.id AND categoria = 'orcamento';
  INSERT INTO public."SUP_SOLICITACAO_MANUTENCAO_ANEXO"
    (solicitacao_id, categoria, nome_arquivo, caminho, tipo_mime, tamanho_bytes)
  VALUES (v_s.id, 'orcamento', p_nome, p_caminho, p_mime, p_tamanho);
  PERFORM set_config('app.manutencao_origem', 'prestadora', true);
  PERFORM set_config('app.manutencao_autor_nome', btrim(p_responsavel), true);
  UPDATE public."SUP_SOLICITACAO_MANUTENCAO"
     SET status = 'aguardando_autorizacao', prestadora_empresa = btrim(p_empresa),
         prestadora_responsavel = btrim(p_responsavel), orcamento_recebido_em = now(),
         decisao_motivo = NULL, respondida_por = NULL, respondida_em = NULL
   WHERE id = v_s.id;
  PERFORM public.sup_manutencao_notificar_suprimentos(
    'Orcamento recebido da prestadora', v_s.maquinario || ' - patrimonio ' || v_s.placa_patrimonial);
  RETURN v_antigo;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_manutencao_publica_registrar_orcamento(uuid, text, text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_manutencao_publica_registrar_orcamento(uuid, text, text, text, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.sup_manutencao_publica_transicionar(
  p_token uuid, p_acao text, p_empresa text DEFAULT NULL, p_responsavel text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE; v_status text;
BEGIN
  SELECT s.* INTO v_s FROM public."SUP_SOLICITACAO_MANUTENCAO" s
  JOIN public.sup_patrimonio p ON p.id = s.patrimonio_id
  WHERE p.manutencao_qr_token = p_token AND p.manutencao_qr_ativo
    AND s.tipo = 'manutencao' AND s.status <> 'encerrada' FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'QR invalido ou sem manutencao ativa.' USING ERRCODE = 'P0001'; END IF;
  IF p_acao = 'iniciar' AND v_s.status = 'manutencao_autorizada' THEN v_status := 'em_execucao';
  ELSIF p_acao = 'concluir' AND v_s.status = 'em_execucao' THEN v_status := 'pronta_retirada';
  ELSE RAISE EXCEPTION 'Acao indisponivel nesta etapa.' USING ERRCODE = 'P0001'; END IF;
  IF v_status = 'em_execucao'
     AND (nullif(btrim(coalesce(v_s.prestadora_empresa, p_empresa, '')), '') IS NULL
       OR nullif(btrim(coalesce(v_s.prestadora_responsavel, p_responsavel, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Informe empresa e responsavel antes de iniciar.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.manutencao_origem', 'prestadora', true);
  PERFORM set_config('app.manutencao_autor_nome', coalesce(v_s.prestadora_responsavel, nullif(btrim(p_responsavel), ''), 'Prestadora'), true);
  UPDATE public."SUP_SOLICITACAO_MANUTENCAO"
     SET status = v_status,
         prestadora_empresa = coalesce(prestadora_empresa, nullif(btrim(p_empresa), '')),
         prestadora_responsavel = coalesce(prestadora_responsavel, nullif(btrim(p_responsavel), '')),
         execucao_iniciada_em = CASE WHEN v_status = 'em_execucao' THEN now() ELSE execucao_iniciada_em END,
         pronta_retirada_em = CASE WHEN v_status = 'pronta_retirada' THEN now() ELSE pronta_retirada_em END
   WHERE id = v_s.id;
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.solicitante_id, 'Atualizacao da manutencao',
    CASE WHEN v_status = 'em_execucao' THEN v_s.maquinario || ': conserto iniciado'
         ELSE v_s.maquinario || ': pronto para retirada' END,
    'info', '/app/central-servicos/solicitar-manutencao-equipamento');
  PERFORM public.sup_manutencao_notificar_suprimentos('Atualizacao da prestadora',
    v_s.maquinario || ': ' || replace(v_status, '_', ' '));
END;
$$;
REVOKE ALL ON FUNCTION public.sup_manutencao_publica_transicionar(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_manutencao_publica_transicionar(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.sup_encerrar_solicitacao_manutencao(p_solicitacao_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM public."SUP_SOLICITACAO_MANUTENCAO" WHERE id = p_solicitacao_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR v_s.solicitante_id <> auth.uid() THEN
    RAISE EXCEPTION 'Solicitacao nao encontrada ou sem permissao.' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'pronta_retirada' THEN RAISE EXCEPTION 'A manutencao ainda nao esta pronta para retirada.'; END IF;
  PERFORM set_config('app.manutencao_origem', 'solicitante', true);
  UPDATE public."SUP_SOLICITACAO_MANUTENCAO" SET status = 'encerrada', encerrada_em = now() WHERE id = v_s.id;
  PERFORM public.sup_manutencao_notificar_suprimentos('Manutencao encerrada', v_s.maquinario || ' foi retirado e encerrado.');
END;
$$;
REVOKE ALL ON FUNCTION public.sup_encerrar_solicitacao_manutencao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_encerrar_solicitacao_manutencao(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
