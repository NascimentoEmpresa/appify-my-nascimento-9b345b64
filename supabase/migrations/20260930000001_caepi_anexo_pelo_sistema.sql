-- =========================================================================
-- Lista de CA anexada pelo próprio sistema
--
-- POR QUE ISTO EXISTE
-- O site do Ministério do Trabalho recusa download automático: responde 403
-- para qualquer cliente que não seja um navegador de verdade. A primeira
-- solução foi o worker ler um arquivo depositado numa pasta da máquina dele —
-- o que só o Eduardo conseguiria fazer, e só sentado naquele PC.
--
-- A ideia do Eduardo é melhor e é a que vale: um botão no ERP leva o usuário
-- ao site do Ministério, ele baixa e **anexa na própria tela**. Qualquer pessoa
-- com permissão resolve, de qualquer navegador, sem tocar em servidor.
--
-- POR QUE O ARQUIVO NÃO É PROCESSADO NA TELA
-- São 20 MB compactados que viram 98 MB e 33 mil linhas. Descompactar e
-- percorrer isso no navegador travaria a aba de quem anexou. Então a tela só
-- envia para o Storage e registra a intenção; quem processa é o worker, que
-- já tem o parser e não tem pressa.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sst_ca_registrar_upload(text, text);
--   ALTER TABLE public.sst_ca_sincronizacao
--     DROP COLUMN IF EXISTS arquivo_path,
--     DROP COLUMN IF EXISTS arquivo_nome,
--     DROP COLUMN IF EXISTS origem,
--     DROP COLUMN IF EXISTS enviado_por,
--     DROP COLUMN IF EXISTS enviado_por_nome;
--   DROP POLICY IF EXISTS caepi_stg_read ON storage.objects;
--   DROP POLICY IF EXISTS caepi_stg_write ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'caepi';
-- =========================================================================

-- ── 1) De onde veio a carga ──────────────────────────────────────────────

ALTER TABLE public.sst_ca_sincronizacao
  ADD COLUMN IF NOT EXISTS arquivo_path     text,
  ADD COLUMN IF NOT EXISTS arquivo_nome     text,
  -- 'upload' = anexado na tela · 'pasta' = deixado na maquina do worker
  -- 'site'   = baixado sozinho, se um dia o Ministerio permitir
  ADD COLUMN IF NOT EXISTS origem           text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS enviado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enviado_por_nome text;

-- Fila do worker: anexado e ainda não processado.
CREATE INDEX IF NOT EXISTS idx_sst_ca_sinc_pendente
  ON public.sst_ca_sincronizacao(iniciado_em)
  WHERE arquivo_path IS NOT NULL AND concluido_em IS NULL AND erro IS NULL;

-- ── 2) Bucket ────────────────────────────────────────────────────────────
-- Privado. 60 MB cobre com folga os ~20 MB do arquivo compactado e deixa
-- margem para o Ministério voltar a servir sem compactação, como já fez.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('caepi', 'caepi', false, 62914560)  -- 60 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS caepi_stg_read  ON storage.objects;
DROP POLICY IF EXISTS caepi_stg_write ON storage.objects;

CREATE POLICY caepi_stg_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'caepi' AND public.can_access(auth.uid(), 'sst_ca', 'visualizar'));

CREATE POLICY caepi_stg_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'caepi' AND public.can_access(auth.uid(), 'sst_ca', 'incluir'));

-- Sem policy de DELETE de propósito: o arquivo é a prova de qual base foi
-- carregada em cada data. Se um CA for contestado depois, é ele que responde.

-- ── 3) Registrar o anexo ─────────────────────────────────────────────────
-- A tela envia o arquivo ao Storage e chama esta função. Ela só enfileira —
-- quem lê e carrega é o worker.

CREATE OR REPLACE FUNCTION public.sst_ca_registrar_upload(
  p_path text,
  p_nome text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sst_ca', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para atualizar a lista de CA';
  END IF;
  IF coalesce(btrim(p_path), '') = '' THEN
    RAISE EXCEPTION 'Arquivo não informado';
  END IF;

  -- Uma carga pendente por vez: dois anexos seguidos fariam o worker processar
  -- 33 mil linhas duas vezes sem necessidade, e a segunda venceria de qualquer
  -- forma. Marcar a anterior como substituída deixa o histórico honesto.
  UPDATE public.sst_ca_sincronizacao
     SET erro = 'substituída por um envio mais recente'
   WHERE arquivo_path IS NOT NULL
     AND concluido_em IS NULL
     AND erro IS NULL;

  INSERT INTO public.sst_ca_sincronizacao
    (arquivo_path, arquivo_nome, origem, enviado_por, enviado_por_nome)
  VALUES
    (btrim(p_path), nullif(btrim(p_nome), ''), 'upload', v_uid,
     public.sup_malote_nome_ator())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── 4) Situação do catálogo, para a tela ─────────────────────────────────
-- Responde "a lista está atualizada?" numa chamada só. Sem isso a tela teria
-- de montar isso no cliente e cada um faria de um jeito.

CREATE OR REPLACE FUNCTION public.sst_ca_situacao_catalogo()
RETURNS TABLE (
  total_cas        integer,
  carregado_em     timestamptz,
  dias_desde       integer,
  arquivo_nome     text,
  enviado_por_nome text,
  processando      boolean,
  ultimo_erro      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT
    (SELECT count(*)::integer FROM public.sst_ca_catalogo),
    u.concluido_em,
    CASE WHEN u.concluido_em IS NULL THEN NULL
         ELSE (CURRENT_DATE - u.concluido_em::date)::integer END,
    u.arquivo_nome,
    u.enviado_por_nome,
    EXISTS (
      SELECT 1 FROM public.sst_ca_sincronizacao p
       WHERE p.arquivo_path IS NOT NULL AND p.concluido_em IS NULL AND p.erro IS NULL
    ),
    (SELECT e.erro FROM public.sst_ca_sincronizacao e
      WHERE e.erro IS NOT NULL ORDER BY e.iniciado_em DESC LIMIT 1)
  FROM (
    SELECT * FROM public.sst_ca_sincronizacao
     WHERE concluido_em IS NOT NULL AND erro IS NULL
     ORDER BY concluido_em DESC LIMIT 1
  ) u
  RIGHT JOIN (SELECT 1) x ON true;
$fn$;

REVOKE ALL ON FUNCTION public.sst_ca_registrar_upload(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sst_ca_situacao_catalogo()          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ca_registrar_upload(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sst_ca_situacao_catalogo()          TO authenticated;

NOTIFY pgrst, 'reload schema';
