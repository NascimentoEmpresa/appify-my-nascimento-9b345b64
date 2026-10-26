-- =========================================================================
-- RH › DOCUMENTOS — PARA TODOS OS ENCARREGADOS, NA ENTRADA DO SISTEMA, ATÉ
-- ANEXAREM O ASSINADO (25/10/2026). Continua as migs 20261019000040 e
-- 20261022000500.
--
-- CHAMADO: "o documento anexo seja exibido na tela inicial de todos os
-- encarregados. Deverá permanecer disponível como pendência e ser
-- apresentado ao encarregado sempre que acessar o sistema, até que realize a
-- leitura, assine o documento e anexe o arquivo devidamente assinado no
-- próprio ERP. [...] A pendência deverá ser considerada concluída somente
-- após a anexação do documento assinado, permitindo o acompanhamento e a
-- rastreabilidade das confirmações." (procedimento de afastamentos, pontos
-- em 48 h e telemedicina)
--
-- O QUE FALTAVA E ENTRA AQUI
--   1. TIPO NOVO 'ciencia_anexo' ("Termo assinado e anexado"): aparece a
--      cada entrada no sistema, como o termo de ciência (GateTermoCiencia),
--      mas só conclui quando o destinatário ANEXA o documento assinado e
--      envia (rh_doc_concluir) — a assinatura no sistema não basta.
--   2. ENVIO PARA TODOS OS ENCARREGADOS de uma vez (rh_doc_solicitar_lote):
--      uma solicitação por encarregado, todas com o mesmo lote_id, para o RH
--      acompanhar o envio inteiro (quantos leram, quantos devolveram).
--      Encarregado = (a) responsável de contrato na Hierarquia de Postos com
--      login, ou (b) colaborador ativo com login e cargo de encarregado
--      (rh_doc_encarregados). O RH vê a lista e pode desmarcar alguém.
--   3. LEITURA: lido_em, gravado quando o destinatário abre o documento do
--      RH (rh_doc_marcar_lido) — "realize a leitura" fica registrado.
--   4. O ARQUIVO DO RH vai uma vez só para o storage e é ligado a todas as
--      solicitações do lote (rh_doc_anexo_replicar); a leitura do storage
--      passa a aceitar o arquivo de qualquer solicitação que a pessoa vê, e
--      tirar o anexo de uma não apaga o arquivo das outras.
--
-- Nenhuma permissão nova (criar continua rh_documentos/incluir).
-- Idempotente.
-- =========================================================================

-- ── 1) Tipo, lote e leitura ──────────────────────────────────────────────
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" DROP CONSTRAINT IF EXISTS rds_tipo_chk;
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO" ADD CONSTRAINT rds_tipo_chk
  CHECK (tipo IN ('registro', 'assinatura', 'ciencia', 'ciencia_anexo', 'anexo'));
ALTER TABLE public."RH_DOCUMENTO_SOLICITACAO"
  ADD COLUMN IF NOT EXISTS lote_id uuid,
  ADD COLUMN IF NOT EXISTS lido_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_rds_lote ON public."RH_DOCUMENTO_SOLICITACAO"(lote_id) WHERE lote_id IS NOT NULL;
-- A janela da entrada procura os dois tipos.
DROP INDEX IF EXISTS public.idx_rds_ciencia_pendente;
CREATE INDEX IF NOT EXISTS idx_rds_ciencia_pendente ON public."RH_DOCUMENTO_SOLICITACAO"(destinatario_id)
  WHERE tipo IN ('ciencia', 'ciencia_anexo') AND status = 'pendente';

CREATE OR REPLACE FUNCTION public.rh_doc_rotulo_tipo(_tipo text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE _tipo WHEN 'registro' THEN 'Registro' WHEN 'assinatura' THEN 'Assinatura'
                    WHEN 'ciencia' THEN 'Termo de ciência' WHEN 'ciencia_anexo' THEN 'Termo assinado e anexado'
                    ELSE 'Devolver anexado' END
$$;

-- ── 2) Solicitar: aceita o tipo novo e o lote ────────────────────────────
-- Corpo da mig 20261022000500; muda: 'ciencia_anexo' e lote_id (p->>'lote_id').
CREATE OR REPLACE FUNCTION public.rh_doc_solicitar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_tipo text := NULLIF(btrim(p->>'tipo'), '');
  v_tit  text := NULLIF(btrim(p->>'titulo'), '');
  v_desc text := NULLIF(btrim(p->>'descricao'), '');
  v_emp  bigint := NULLIF(p->>'contrato_empresa', '')::bigint;
  v_fil  bigint := NULLIF(p->>'contrato_filial', '')::bigint;
  v_dest uuid := NULLIF(p->>'destinatario_id', '')::uuid;
  v_prazo date := NULLIF(p->>'prazo', '')::date;
  v_lote uuid := NULLIF(p->>'lote_id', '')::uuid;
  v_d    record;
  v_eu   text := public.rh_doc_nome_usuario(auth.uid());
  v_id   bigint;
BEGIN
  IF NOT public.rh_doc_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar documentos.' USING ERRCODE = '42501';
  END IF;
  -- 'anexo' é só das solicitações antigas: não se cria mais.
  IF v_tipo IS NULL OR v_tipo NOT IN ('registro', 'assinatura', 'ciencia', 'ciencia_anexo') THEN
    RAISE EXCEPTION 'Escolha o tipo: Registro, Assinatura, Termo de ciência ou Termo assinado e anexado.';
  END IF;
  IF v_tit IS NULL THEN RAISE EXCEPTION 'Informe o título.'; END IF;
  IF v_desc IS NULL THEN RAISE EXCEPTION 'Descreva o que está sendo solicitado.'; END IF;
  IF (v_emp IS NULL) <> (v_fil IS NULL) THEN RAISE EXCEPTION 'Contrato incompleto.'; END IF;
  SELECT * INTO v_d FROM public.rh_doc_validar_destino(v_emp, v_fil, v_dest);
  IF v_tipo = 'registro' THEN v_prazo := NULL; END IF;

  INSERT INTO public."RH_DOCUMENTO_SOLICITACAO"
    (tipo, titulo, descricao, contrato_empresa, contrato_filial, contrato_nome, destinatario_id, destinatario_nome,
     destinatario_empregado_id, solicitante_nome, prazo, status, concluida_em, concluida_por, lote_id)
  VALUES (v_tipo, v_tit, v_desc, v_emp, v_fil, v_d.contrato_nome, v_dest, v_d.nome, v_d.empregado_id, v_eu, v_prazo,
          CASE WHEN v_tipo = 'registro' THEN 'concluida' ELSE 'pendente' END,
          CASE WHEN v_tipo = 'registro' THEN now() END,
          CASE WHEN v_tipo = 'registro' THEN v_eu END,
          v_lote)
  RETURNING id INTO v_id;

  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (v_id, 'criada',
          public.rh_doc_rotulo_tipo(v_tipo) || ' — para ' || coalesce(v_d.nome, '—') || coalesce(' — ' || v_d.contrato_nome, '')
            || CASE WHEN v_lote IS NOT NULL THEN ' (envio para todos os encarregados)' ELSE '' END,
          v_eu, 'rh');

  IF v_tipo <> 'registro' THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_dest,
            CASE v_tipo WHEN 'ciencia' THEN 'Termo de ciência para assinar'
                        WHEN 'ciencia_anexo' THEN 'Documento para ler, assinar e anexar'
                        ELSE 'Documento para assinar' END,
            v_tit || coalesce(' — ' || v_d.contrato_nome, '') || coalesce('. Prazo: ' || to_char(v_prazo, 'DD/MM/YYYY'), '') || '.',
            'rh_documento_solicitado', public.rh_doc_link_destinatario(v_dest, v_id));
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_solicitar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_solicitar(jsonb) TO authenticated;

-- ── 3) Quem são os encarregados ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_doc_encarregados()
RETURNS TABLE(id uuid, nome text, cargo text, contratos text, por_hierarquia boolean, por_cargo boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.rh_doc_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar documentos.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH hier AS (
    SELECT r.auth_user_id uid, string_agg(DISTINCT c."NOME CONTRATO", ' · ') contratos
      FROM public.rh_hier_responsaveis() r
      LEFT JOIN public."CONTRATOS" c ON c."Empresa" = r.empresa AND c."Filial" = r.filial
     WHERE r.auth_user_id IS NOT NULL
     GROUP BY r.auth_user_id
  ),
  carg AS (
    SELECT DISTINCT ON (e.auth_user_id) e.auth_user_id uid, e."Título do Cargo" cargo, e."Nome Filial" filial
      FROM public."EMPREGADOS" e
     WHERE e.auth_user_id IS NOT NULL AND public.esp_col_esta_ativo(e."Situação")
       AND e."Título do Cargo" ILIKE '%ENCARREGAD%'
     ORDER BY e.auth_user_id, e."ID" DESC
  ),
  todos AS (SELECT uid FROM hier UNION SELECT uid FROM carg)
  SELECT t.uid, public.rh_doc_nome_usuario(t.uid),
         COALESCE(cg.cargo, (SELECT e."Título do Cargo" FROM public."EMPREGADOS" e WHERE e.auth_user_id = t.uid
                              ORDER BY (e."Situação" = 'Trabalhando') DESC, e."ID" DESC LIMIT 1))::text,
         COALESCE(h.contratos, cg.filial)::text,
         h.uid IS NOT NULL, cg.uid IS NOT NULL
    FROM todos t
    JOIN auth.users u ON u.id = t.uid AND (u.banned_until IS NULL OR u.banned_until < now())
    LEFT JOIN hier h ON h.uid = t.uid
    LEFT JOIN carg cg ON cg.uid = t.uid
   ORDER BY 2;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_encarregados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_encarregados() TO authenticated;

-- ── 4) Envio para vários (o lote) ────────────────────────────────────────
-- p = {tipo, titulo, descricao, prazo, destinatarios: [uuid…]} → {lote_id, ids}.
CREATE OR REPLACE FUNCTION public.rh_doc_solicitar_lote(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_lote uuid := gen_random_uuid();
  v_dest uuid;
  v_ids  bigint[] := ARRAY[]::bigint[];
BEGIN
  IF NOT public.rh_doc_pode('incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar documentos.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p->'destinatarios') <> 'array' OR jsonb_array_length(p->'destinatarios') = 0 THEN
    RAISE EXCEPTION 'Escolha ao menos um encarregado.';
  END IF;
  IF NULLIF(btrim(p->>'tipo'), '') = 'registro' THEN
    RAISE EXCEPTION 'Registro não vai para várias pessoas — escolha Assinatura ou um dos termos.';
  END IF;
  FOR v_dest IN SELECT DISTINCT (x #>> '{}')::uuid FROM jsonb_array_elements(p->'destinatarios') x LOOP
    v_ids := v_ids || public.rh_doc_solicitar(
      (p - 'destinatarios' - 'contrato_empresa' - 'contrato_filial')
        || jsonb_build_object('destinatario_id', v_dest, 'lote_id', v_lote));
  END LOOP;
  RETURN jsonb_build_object('lote_id', v_lote, 'ids', to_jsonb(v_ids));
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_solicitar_lote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_solicitar_lote(jsonb) TO authenticated;

-- O que o RH anexou na primeira solicitação do lote vale para todas (o mesmo
-- arquivo no storage, sem subir N vezes).
CREATE OR REPLACE FUNCTION public.rh_doc_anexo_replicar(p_lote uuid, p_de bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n int;
BEGIN
  IF NOT (public.rh_doc_pode('incluir') OR public.rh_doc_pode('alterar')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_de AND lote_id = p_lote) THEN
    RAISE EXCEPTION 'A solicitação % não é deste envio.', p_de;
  END IF;
  INSERT INTO public."RH_DOCUMENTO_ANEXO" (solicitacao_id, origem, storage_path, nome_arquivo, mime_type, tamanho_bytes, enviado_por_id, enviado_por)
  SELECT s.id, 'rh', a.storage_path, a.nome_arquivo, a.mime_type, a.tamanho_bytes, a.enviado_por_id, a.enviado_por
    FROM public."RH_DOCUMENTO_SOLICITACAO" s
    JOIN public."RH_DOCUMENTO_ANEXO" a ON a.solicitacao_id = p_de AND a.origem = 'rh'
   WHERE s.lote_id = p_lote AND s.id <> p_de
     AND NOT EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_ANEXO" x WHERE x.solicitacao_id = s.id AND x.storage_path = a.storage_path);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_anexo_replicar(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_anexo_replicar(uuid, bigint) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_rda_storage_path ON public."RH_DOCUMENTO_ANEXO"(storage_path);

-- Storage: o arquivo pode estar na pasta de outra solicitação do lote.
DROP POLICY IF EXISTS "rh documentos select" ON storage.objects;
CREATE POLICY "rh documentos select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rh-documentos' AND (
    public.rh_doc_pode_ver(public.rh_doc_id_do_caminho(name))
    OR EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_ANEXO" a
                WHERE a.storage_path = storage.objects.name AND public.rh_doc_pode_ver(a.solicitacao_id))));

-- Tirar o anexo de uma solicitação não apaga o arquivo que outras usam.
-- Corpo da mig 20261019000040; muda só o retorno do caminho.
CREATE OR REPLACE FUNCTION public.rh_doc_anexo_remover(p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public."RH_DOCUMENTO_ANEXO";
BEGIN
  SELECT * INTO v FROM public."RH_DOCUMENTO_ANEXO" WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado.'; END IF;
  IF NOT public.rh_doc_pode_anexar(v.solicitacao_id) THEN
    RAISE EXCEPTION 'A solicitação não está pendente.' USING ERRCODE = '42501';
  END IF;
  IF v.enviado_por_id IS DISTINCT FROM auth.uid() AND NOT public.rh_doc_pode('alterar') THEN
    RAISE EXCEPTION 'Só quem anexou pode remover o arquivo.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."RH_DOCUMENTO_ANEXO" WHERE id = p_id;
  IF EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_ANEXO" WHERE storage_path = v.storage_path) THEN
    RETURN NULL;   -- outra solicitação usa o mesmo arquivo
  END IF;
  RETURN v.storage_path;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_anexo_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_anexo_remover(bigint) TO authenticated;

-- ── 5) Leitura registrada ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_doc_marcar_lido(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_s public."RH_DOCUMENTO_SOLICITACAO";
BEGIN
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id;
  IF NOT FOUND OR v_s.destinatario_id IS DISTINCT FROM auth.uid() OR v_s.lido_em IS NOT NULL THEN RETURN; END IF;
  UPDATE public."RH_DOCUMENTO_SOLICITACAO" SET lido_em = now() WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'lido', 'Abriu o documento do RH', public.rh_doc_nome_usuario(auth.uid()), 'destinatario');
END $fn$;
REVOKE ALL ON FUNCTION public.rh_doc_marcar_lido(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_doc_marcar_lido(bigint) TO authenticated;

-- ── 6) Concluir anexando: o fluxo antigo e o termo assinado e anexado ────
-- Corpo da mig 20261022000500; muda só o tipo aceito.
CREATE OR REPLACE FUNCTION public.rh_doc_concluir(p_id bigint, p_observacao text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_s   public."RH_DOCUMENTO_SOLICITACAO";
  v_obs text := NULLIF(btrim(p_observacao), '');
  v_eu  text := public.rh_doc_nome_usuario(auth.uid());
BEGIN
  SELECT * INTO v_s FROM public."RH_DOCUMENTO_SOLICITACAO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v_s.destinatario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Só o destinatário envia o documento.' USING ERRCODE = '42501';
  END IF;
  IF v_s.tipo NOT IN ('anexo', 'ciencia_anexo') THEN RAISE EXCEPTION 'Este documento se conclui assinando, não anexando.'; END IF;
  IF v_s.status <> 'pendente' THEN RAISE EXCEPTION 'A solicitação não está pendente (está %).', v_s.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."RH_DOCUMENTO_ANEXO" WHERE solicitacao_id = p_id AND origem = 'destinatario') THEN
    RAISE EXCEPTION 'Anexe o documento assinado antes de enviar.';
  END IF;
  UPDATE public."RH_DOCUMENTO_SOLICITACAO"
     SET status = 'concluida', concluida_em = now(), concluida_por = v_eu, observacao_envio = v_obs,
         lido_em = COALESCE(lido_em, now())
   WHERE id = p_id;
  INSERT INTO public."RH_DOCUMENTO_EVENTO" (solicitacao_id, acao, texto, autor_nome, lado)
  VALUES (p_id, 'concluida', v_obs, v_eu, 'destinatario');
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  VALUES (v_s.solicitante_id, 'Documento devolvido assinado',
          v_s.titulo || ' — ' || coalesce(v_eu, '') || coalesce(' — ' || v_s.contrato_nome, '') || coalesce('. Obs.: ' || left(v_obs, 200), ''),
          'rh_documento_concluido', '/app/rh/documentos?s=' || p_id);
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar rh_doc_solicitar, rh_doc_concluir e rh_doc_rotulo_tipo da mig 20261022000500,
-- rh_doc_anexo_remover e a policy "rh documentos select" da mig 20261019000040;
-- DROP FUNCTION IF EXISTS public.rh_doc_marcar_lido(bigint), public.rh_doc_anexo_replicar(uuid, bigint),
--   public.rh_doc_solicitar_lote(jsonb), public.rh_doc_encarregados();
-- (antes de voltar o CHECK do tipo, trocar 'ciencia_anexo' por 'anexo')
