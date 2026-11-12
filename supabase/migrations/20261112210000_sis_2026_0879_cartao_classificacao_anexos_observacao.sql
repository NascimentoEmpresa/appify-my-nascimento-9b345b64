-- ============================================================================
-- SIS-2026-0879 — Classificar Lançamentos de Cartão: anexos (NF, prints) e observação no item
-- ============================================================================
-- Pedido: "Na tela de classificar lançamentos, ao classificar ter a opção de anexar nf e/ou prints e campo de observação".
-- O diálogo "Classificar item" (RateioItemFaturaDialog, SIS-2026-0568) só gravava o rateio Classificação + Contrato.
--
--   1. malote_cartao_fatura_item_complemento : 1 linha por item da fatura com observacao (até 2000) e anexos
--      [{nome, path, tipo, tamanho}]. Tabela à parte, e não colunas em malote_cartao_fatura_item, porque o UPDATE do
--      item exige 'alterar' no Cartão de Crédito inteiro, e quem classifica pode ser só um autorizado POR CARTÃO
--      (usuarios_classificar_ids). O complemento é DO ITEM, não de cada linha do rateio.
--      Leitura: quem vê o rateio (mesma regra de mcfir_select). Escrita: só pela RPC do passo 3.
--   2. Bucket privado `cartao-classificacao-anexos` (25 MB por arquivo — documento, regra da 20261103009300),
--      caminhos <item_id>/<carimbo>-<i>_<nome>. Ler: 'visualizar' no Cartão de Crédito ou poder classificar o item.
--      Enviar: poder classificar o item. Apagar: poder classificar o item E o arquivo não estar mais no complemento
--      (a tela tira da lista pela RPC e só depois apaga o arquivo — assim nenhum anexo gravado some por baixo).
--   3. cartao_fatura_item_salvar_complemento(_item_id, _observacao, _anexos): não confia no navegador. Cada caminho
--      tem que estar direto na pasta DESTE item; anexo novo tem que existir no bucket e ter sido enviado por quem
--      salva (tipo e tamanho vêm do storage.objects); anexo que já estava salvo continua valendo, seja de quem for.
--
-- Item da fatura apagado (reimportação com exclusão) leva o complemento junto (ON DELETE CASCADE), como o rateio.
-- Idempotente. NOTIFY ao final.
--
-- ROLLBACK (só com o bucket vazio):
--   DROP FUNCTION IF EXISTS public.cartao_fatura_item_salvar_complemento(uuid, text, jsonb);
--   DROP POLICY IF EXISTS cartao_classificacao_anexos_select ON storage.objects;
--   DROP POLICY IF EXISTS cartao_classificacao_anexos_insert ON storage.objects;
--   DROP POLICY IF EXISTS cartao_classificacao_anexos_delete ON storage.objects;
--   DROP FUNCTION IF EXISTS public.cartao_fatura_anexo_em_uso(text);
--   DROP FUNCTION IF EXISTS public.cartao_fatura_anexo_acesso(text, uuid, boolean);
--   DELETE FROM storage.buckets WHERE id = 'cartao-classificacao-anexos';
--   DROP TABLE IF EXISTS public.malote_cartao_fatura_item_complemento;
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '5s';

-- ── 1) Complemento do item: observação + anexos ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.malote_cartao_fatura_item_complemento (
  item_id uuid PRIMARY KEY REFERENCES public.malote_cartao_fatura_item(id) ON DELETE CASCADE,
  observacao text NOT NULL DEFAULT '' CHECK (length(observacao) <= 2000),
  anexos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(anexos) = 'array' AND jsonb_array_length(anexos) <= 10),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.malote_cartao_fatura_item_complemento IS
  'SIS-2026-0879: observação e anexos (NF, prints) de um item da fatura do cartão, preenchidos ao classificar. Escrita só por cartao_fatura_item_salvar_complemento.';

DROP TRIGGER IF EXISTS malote_cartao_fatura_item_complemento_set_updated ON public.malote_cartao_fatura_item_complemento;
CREATE TRIGGER malote_cartao_fatura_item_complemento_set_updated
  BEFORE UPDATE ON public.malote_cartao_fatura_item_complemento
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.malote_cartao_fatura_item_complemento ENABLE ROW LEVEL SECURITY;

-- Mesma regra de leitura do rateio (mcfir_select, 20260930000276).
DROP POLICY IF EXISTS malote_cartao_fatura_item_complemento_select ON public.malote_cartao_fatura_item_complemento;
CREATE POLICY malote_cartao_fatura_item_complemento_select ON public.malote_cartao_fatura_item_complemento
  FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access((SELECT auth.uid()), 'financeiro-cartao-credito', 'visualizar'::public.app_acao))
    OR public.cartao_fatura_pode_classificar(item_id, (SELECT auth.uid()))
  );

GRANT SELECT ON public.malote_cartao_fatura_item_complemento TO authenticated;

-- ── 2) Bucket e policies do storage ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cartao-classificacao-anexos', 'cartao-classificacao-anexos', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

-- Quem lê / escreve num arquivo do bucket, pela pasta (= id do item). Pasta que não é uuid não é de item nenhum.
CREATE OR REPLACE FUNCTION public.cartao_fatura_anexo_acesso(_path text, _uid uuid, _escrever boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pasta text := split_part(coalesce(_path, ''), '/', 1);
BEGIN
  IF _uid IS NULL OR v_pasta !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  IF NOT _escrever AND public.can_access(_uid, 'financeiro-cartao-credito', 'visualizar'::public.app_acao) THEN
    RETURN true;
  END IF;
  RETURN public.cartao_fatura_pode_classificar(v_pasta::uuid, _uid);
END;
$$;
REVOKE ALL ON FUNCTION public.cartao_fatura_anexo_acesso(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_anexo_acesso(text, uuid, boolean) TO authenticated;

-- Arquivo ainda citado no complemento do item? SECURITY DEFINER: a policy de DELETE do storage não pode depender da RLS.
CREATE OR REPLACE FUNCTION public.cartao_fatura_anexo_em_uso(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_cartao_fatura_item_complemento c
     WHERE c.anexos @> jsonb_build_array(jsonb_build_object('path', _path))
  );
$$;
REVOKE ALL ON FUNCTION public.cartao_fatura_anexo_em_uso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_anexo_em_uso(text) TO authenticated;

DROP POLICY IF EXISTS cartao_classificacao_anexos_select ON storage.objects;
CREATE POLICY cartao_classificacao_anexos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cartao-classificacao-anexos'
    AND public.cartao_fatura_anexo_acesso(name, (SELECT auth.uid()), false)
  );

DROP POLICY IF EXISTS cartao_classificacao_anexos_insert ON storage.objects;
CREATE POLICY cartao_classificacao_anexos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cartao-classificacao-anexos'
    AND public.cartao_fatura_anexo_acesso(name, (SELECT auth.uid()), true)
  );

DROP POLICY IF EXISTS cartao_classificacao_anexos_delete ON storage.objects;
CREATE POLICY cartao_classificacao_anexos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cartao-classificacao-anexos'
    AND public.cartao_fatura_anexo_acesso(name, (SELECT auth.uid()), true)
    AND NOT public.cartao_fatura_anexo_em_uso(name)
  );

-- ── 3) RPC que grava observação + anexos do item ────────────────────────────
CREATE OR REPLACE FUNCTION public.cartao_fatura_item_salvar_complemento(
  _item_id uuid,
  _observacao text,
  _anexos jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_obs text := btrim(coalesce(_observacao, ''));
  v_atuais jsonb;
  v_anexos jsonb := '[]'::jsonb;
  v_pasta text;
  v_item jsonb;
  v_path text;
  v_nome text;
  v_existente jsonb;
  v_obj record;
BEGIN
  IF _item_id IS NULL THEN
    RAISE EXCEPTION 'Informe o item da fatura.';
  END IF;
  IF v_uid IS NULL OR NOT public.cartao_fatura_pode_classificar(_item_id, v_uid) THEN
    RAISE EXCEPTION 'Sem permissão para classificar este item do cartão.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.malote_cartao_fatura_item WHERE id = _item_id) THEN
    RAISE EXCEPTION 'Item da fatura não encontrado.';
  END IF;
  IF length(v_obs) > 2000 THEN
    RAISE EXCEPTION 'A observação pode ter no máximo 2000 caracteres.';
  END IF;

  SELECT c.anexos INTO v_atuais FROM public.malote_cartao_fatura_item_complemento c WHERE c.item_id = _item_id;
  v_atuais := coalesce(v_atuais, '[]'::jsonb);
  v_pasta := _item_id::text || '/';

  IF _anexos IS NOT NULL AND _anexos <> 'null'::jsonb THEN
    IF jsonb_typeof(_anexos) <> 'array' THEN RAISE EXCEPTION 'Anexos inválidos.'; END IF;
    IF jsonb_array_length(_anexos) > 10 THEN RAISE EXCEPTION 'No máximo 10 arquivos por item.'; END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(_anexos) LOOP
      v_path := v_item->>'path';
      v_nome := left(btrim(coalesce(v_item->>'nome', '')), 255);
      -- Direto na pasta do item: nada de subpasta nem "..".
      IF v_path IS NULL OR v_path !~ ('^' || v_pasta || '[^/]+$') OR v_path ~ '/\.\.?$' THEN
        RAISE EXCEPTION 'Anexo fora da pasta deste item.';
      END IF;
      IF v_anexos @> jsonb_build_array(jsonb_build_object('path', v_path)) THEN CONTINUE; END IF;

      -- Já estava salvo: mantém como está (pode ter sido enviado por outra pessoa).
      SELECT e INTO v_existente FROM jsonb_array_elements(v_atuais) e WHERE e->>'path' = v_path LIMIT 1;
      IF v_existente IS NOT NULL THEN
        v_anexos := v_anexos || jsonb_build_array(v_existente);
        CONTINUE;
      END IF;

      SELECT o.owner, o.metadata INTO v_obj
        FROM storage.objects o
       WHERE o.bucket_id = 'cartao-classificacao-anexos' AND o.name = v_path;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'O arquivo "%" não chegou ao servidor. Anexe de novo.', coalesce(nullif(v_nome, ''), v_path);
      END IF;
      IF v_obj.owner IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'Anexo enviado por outro usuário.'; END IF;

      v_anexos := v_anexos || jsonb_build_array(jsonb_build_object(
        'nome', coalesce(nullif(v_nome, ''), regexp_replace(v_path, '^.*/\d+-\d+_', '')),
        'path', v_path,
        'tipo', v_obj.metadata->>'mimetype',
        'tamanho', (v_obj.metadata->>'size')::bigint
      ));
    END LOOP;
  END IF;

  INSERT INTO public.malote_cartao_fatura_item_complemento (item_id, observacao, anexos, updated_by)
  VALUES (_item_id, v_obs, v_anexos, v_uid)
  ON CONFLICT (item_id) DO UPDATE
    SET observacao = EXCLUDED.observacao,
        anexos = EXCLUDED.anexos,
        updated_by = EXCLUDED.updated_by;
END;
$$;
REVOKE ALL ON FUNCTION public.cartao_fatura_item_salvar_complemento(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cartao_fatura_item_salvar_complemento(uuid, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
