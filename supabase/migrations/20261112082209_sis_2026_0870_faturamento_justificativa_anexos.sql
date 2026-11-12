-- ============================================================================
-- SIS-2026-0870 — Anexos no chat de justificativa dos contratos não faturados (Controle de Faturamento)
-- ============================================================================
-- O chat da SIS-2026-0808 (20261105007000) só aceitava texto: comprovante e autorização de faturamento iam por
-- e-mail ("os comprovantes foram enviados por e-mail"), fora do histórico. Agora a mensagem leva arquivos:
--
--   1. Bucket privado `faturamento-justificativa-anexos` (25 MB por arquivo — documento, regra da 20261103009300),
--      caminhos <contrato_id>/<competência YYYY-MM-01>/<carimbo>_<nome>.
--      Ler: 'controle-faturamento' › 'visualizar' (o mesmo de ler o chat). Enviar: › 'responder'.
--      Apagar: só quem enviou e só enquanto o arquivo não está em mensagem nenhuma (limpeza de envio que falhou);
--      depois de enviado, o anexo é histórico como o texto — ninguém apaga.
--   2. faturamento_justificativa_mensagem.anexos jsonb: [{nome, path, tipo, tamanho}]. Mensagem só com anexo pode
--      ter texto vazio.
--   3. faturamento_justificativa_enviar ganha _anexos jsonb. A RPC não confia no que o navegador manda: o caminho
--      tem que estar na pasta DESTE contrato + competência e o objeto tem que existir no bucket enviado por quem
--      manda a mensagem; tipo e tamanho vêm do storage.objects, não do navegador.
--
-- Quem envia, data e hora continuam na própria mensagem (autor_id, created_at): o anexo é da mensagem.
--
-- ROLLBACK (só com o bucket vazio e nenhuma mensagem com anexo):
--   DROP FUNCTION IF EXISTS public.faturamento_justificativa_enviar(uuid, date, text, uuid, jsonb);
--   (recriar a versão de 4 argumentos da 20261105007000)
--   DROP FUNCTION IF EXISTS public.faturamento_justificativa_anexo_em_uso(text);
--   ALTER TABLE public.faturamento_justificativa_mensagem DROP CONSTRAINT IF EXISTS faturamento_justificativa_mensagem_conteudo;
--   ALTER TABLE public.faturamento_justificativa_mensagem DROP COLUMN IF EXISTS anexos;
--   ALTER TABLE public.faturamento_justificativa_mensagem ADD CONSTRAINT faturamento_justificativa_mensagem_texto_check
--     CHECK (length(btrim(texto)) >= 2 AND length(texto) <= 2000);
--   DROP POLICY IF EXISTS faturamento_justificativa_anexos_select ON storage.objects;
--   DROP POLICY IF EXISTS faturamento_justificativa_anexos_insert ON storage.objects;
--   DROP POLICY IF EXISTS faturamento_justificativa_anexos_delete ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'faturamento-justificativa-anexos';
--   NOTIFY pgrst, 'reload schema';

-- ── 1) Coluna de anexos e a regra do conteúdo ───────────────────────────────
ALTER TABLE public.faturamento_justificativa_mensagem
  ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.faturamento_justificativa_mensagem.anexos IS
  'SIS-2026-0870: arquivos da mensagem [{nome, path, tipo, tamanho}] no bucket faturamento-justificativa-anexos. Mensagem só com anexo tem texto vazio.';

-- A CHECK da coluna texto (length(btrim(texto)) >= 2) foi criada sem nome na 20261105007000: acha pelo conteúdo
-- em vez de chutar o nome gerado.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.faturamento_justificativa_mensagem'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%btrim(texto)%'
       AND conname <> 'faturamento_justificativa_mensagem_conteudo'
  LOOP
    EXECUTE format('ALTER TABLE public.faturamento_justificativa_mensagem DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.faturamento_justificativa_mensagem DROP CONSTRAINT IF EXISTS faturamento_justificativa_mensagem_conteudo;
ALTER TABLE public.faturamento_justificativa_mensagem ADD CONSTRAINT faturamento_justificativa_mensagem_conteudo CHECK (
  jsonb_typeof(anexos) = 'array'
  AND length(texto) <= 2000
  AND (length(btrim(texto)) >= 2 OR jsonb_array_length(anexos) > 0)
);

-- ── 2) Bucket e policies do storage ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('faturamento-justificativa-anexos', 'faturamento-justificativa-anexos', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

-- Arquivo já citado em alguma mensagem? SECURITY DEFINER: a policy de DELETE do storage precisa enxergar a tabela
-- mesmo para quem não tem 'visualizar' (e não pode depender da RLS dela).
CREATE OR REPLACE FUNCTION public.faturamento_justificativa_anexo_em_uso(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.faturamento_justificativa_mensagem m
     WHERE m.anexos @> jsonb_build_array(jsonb_build_object('path', _path))
  );
$$;
REVOKE ALL ON FUNCTION public.faturamento_justificativa_anexo_em_uso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faturamento_justificativa_anexo_em_uso(text) TO authenticated;

DROP POLICY IF EXISTS faturamento_justificativa_anexos_select ON storage.objects;
CREATE POLICY faturamento_justificativa_anexos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'faturamento-justificativa-anexos'
    AND (SELECT public.can_access((SELECT auth.uid()), 'controle-faturamento', 'visualizar'))
  );

DROP POLICY IF EXISTS faturamento_justificativa_anexos_insert ON storage.objects;
CREATE POLICY faturamento_justificativa_anexos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'faturamento-justificativa-anexos'
    AND (SELECT public.can_access((SELECT auth.uid()), 'controle-faturamento', 'responder'))
  );

DROP POLICY IF EXISTS faturamento_justificativa_anexos_delete ON storage.objects;
CREATE POLICY faturamento_justificativa_anexos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'faturamento-justificativa-anexos'
    AND owner = (SELECT auth.uid())
    AND NOT public.faturamento_justificativa_anexo_em_uso(name)
  );

-- ── 3) RPC de envio com anexos ──────────────────────────────────────────────
-- Assinatura muda (5º argumento): a de 4 sai para o PostgREST não ficar com duas sobrecargas ambíguas.
DROP FUNCTION IF EXISTS public.faturamento_justificativa_enviar(uuid, date, text, uuid);

CREATE OR REPLACE FUNCTION public.faturamento_justificativa_enviar(
  _contrato_id uuid,
  _competencia date,
  _texto text,
  _destinatario_id uuid DEFAULT NULL,
  _anexos jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_texto text := btrim(coalesce(_texto, ''));
  v_comp date;
  v_id uuid;
  v_contrato text;
  v_pasta text;
  v_anexos jsonb := '[]'::jsonb;
  v_item jsonb;
  v_path text;
  v_nome text;
  v_obj record;
  v_resumo text;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(v_uid, 'controle-faturamento', 'responder') THEN
    RAISE EXCEPTION 'Sem permissão para escrever no chat do Controle de Faturamento.';
  END IF;
  IF _contrato_id IS NULL OR _competencia IS NULL THEN
    RAISE EXCEPTION 'Informe o contrato e a competência.';
  END IF;

  SELECT nome INTO v_contrato FROM public.contratos WHERE id = _contrato_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado.'; END IF;
  v_comp := date_trunc('month', _competencia)::date;
  v_pasta := _contrato_id::text || '/' || to_char(v_comp, 'YYYY-MM-DD') || '/';

  -- Anexos: confere cada um no storage e monta a lista com o que o storage diz (tipo e tamanho).
  IF _anexos IS NOT NULL AND _anexos <> 'null'::jsonb THEN
    IF jsonb_typeof(_anexos) <> 'array' THEN RAISE EXCEPTION 'Anexos inválidos.'; END IF;
    IF jsonb_array_length(_anexos) > 10 THEN RAISE EXCEPTION 'No máximo 10 arquivos por mensagem.'; END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(_anexos) LOOP
      v_path := v_item->>'path';
      v_nome := left(btrim(coalesce(v_item->>'nome', '')), 255);
      -- Direto na pasta do chat: nada de subpasta nem "..". (Ponto duplo DENTRO do nome, "relatorio..pdf", é nome.)
      IF v_path IS NULL OR v_path !~ ('^' || v_pasta || '[^/]+$') OR v_path ~ '/\.\.?$' THEN
        RAISE EXCEPTION 'Anexo fora da pasta deste contrato e competência.';
      END IF;
      SELECT o.owner, o.metadata INTO v_obj
        FROM storage.objects o
       WHERE o.bucket_id = 'faturamento-justificativa-anexos' AND o.name = v_path;
      IF NOT FOUND THEN RAISE EXCEPTION 'O arquivo "%" não chegou ao servidor. Anexe de novo.', coalesce(nullif(v_nome, ''), v_path); END IF;
      IF v_obj.owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Anexo enviado por outro usuário.'; END IF;
      IF v_anexos @> jsonb_build_array(jsonb_build_object('path', v_path)) THEN CONTINUE; END IF;
      v_anexos := v_anexos || jsonb_build_array(jsonb_build_object(
        'nome', coalesce(nullif(v_nome, ''), regexp_replace(v_path, '^.*/\d+-\d+_', '')),
        'path', v_path,
        'tipo', v_obj.metadata->>'mimetype',
        'tamanho', (v_obj.metadata->>'size')::bigint
      ));
    END LOOP;
  END IF;

  IF length(v_texto) > 2000 THEN RAISE EXCEPTION 'A mensagem pode ter no máximo 2000 caracteres.'; END IF;
  IF length(v_texto) < 2 AND jsonb_array_length(v_anexos) = 0 THEN RAISE EXCEPTION 'Escreva a mensagem ou anexe um arquivo.'; END IF;

  v_resumo := CASE
    WHEN v_texto <> '' THEN left(v_texto, 140)
    WHEN jsonb_array_length(v_anexos) = 1 THEN 'Anexo: ' || (v_anexos->0->>'nome')
    ELSE jsonb_array_length(v_anexos) || ' anexos'
  END;

  -- Avisa o destinatário e quem já participou do chat (antes de gravar a nova mensagem), menos quem envia.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT DISTINCT p.uid,
         CASE WHEN p.uid = _destinatario_id THEN 'Pergunta sobre faturamento: ' ELSE 'Nova mensagem sobre faturamento: ' END || v_contrato,
         to_char(v_comp, 'MM/YYYY') || ' · ' || v_resumo,
         'faturamento_justificativa',
         '/app/financeiro/controle-faturamento?chat=' || _contrato_id || '&competencia=' || v_comp
    FROM (
      SELECT autor_id AS uid FROM public.faturamento_justificativa_mensagem WHERE contrato_id = _contrato_id AND competencia = v_comp
      UNION
      SELECT destinatario_id FROM public.faturamento_justificativa_mensagem WHERE contrato_id = _contrato_id AND competencia = v_comp AND destinatario_id IS NOT NULL
      UNION
      SELECT _destinatario_id WHERE _destinatario_id IS NOT NULL
    ) p
   WHERE p.uid IS DISTINCT FROM v_uid;

  INSERT INTO public.faturamento_justificativa_mensagem (contrato_id, competencia, autor_id, destinatario_id, texto, anexos)
  VALUES (_contrato_id, v_comp, v_uid, _destinatario_id, v_texto, v_anexos)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.faturamento_justificativa_enviar(uuid, date, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.faturamento_justificativa_enviar(uuid, date, text, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
