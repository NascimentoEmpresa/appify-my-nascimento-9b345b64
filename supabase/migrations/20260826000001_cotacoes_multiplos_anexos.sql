-- =====================================================================
-- COTAÇÕES — vários anexos por lado
--
-- POR QUE
-- O modelo original (20260805000002) guarda UM arquivo de cada lado, em
-- colunas soltas: arquivo_url/arquivo_nome na ida, resposta_arquivo_url/
-- resposta_arquivo_nome na volta. Na prática uma cotação vem com edital +
-- planilha + anexo, e a resposta volta com vários orçamentos.
--
-- Teste em produção 2026-08-05: "não tem opção de anexar mais de um arquivo".
--
-- O QUE MUDA
--   1. tabela filha cotacoes_licitacao_arquivo, N por lado;
--   2. as 4 colunas antigas viram legado — migradas e não mais escritas;
--   3. sup_cot_responder passa a receber um ARRAY de anexos;
--   4. some a lista de extensões: qualquer formato é aceito. O que protege
--      contra .html/.svg com script é o download forçado no cliente
--      (createSignedUrl com `download`), não uma allowlist.
--
-- As colunas antigas NÃO são dropadas de propósito: outro dev pode ter
-- trabalho em cima delas. Ficam marcadas por COMMENT e param de ser lidas.
-- =====================================================================

-- ── 1. A tabela filha ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cotacoes_licitacao_arquivo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id       uuid NOT NULL REFERENCES public.cotacoes_licitacao(id) ON DELETE CASCADE,
  -- de qual lado do balcão veio o anexo
  lado             text NOT NULL CHECK (lado IN ('solicitacao', 'resposta')),
  caminho          text NOT NULL,
  nome             text NOT NULL,
  tamanho          bigint,
  enviado_por      uuid REFERENCES auth.users(id),
  enviado_por_nome text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Reenviar o mesmo arquivo no mesmo lado não duplica, e é o que torna a
  -- carga do passo 4 idempotente.
  CONSTRAINT cotacoes_arquivo_unico UNIQUE (cotacao_id, lado, caminho)
);

CREATE INDEX IF NOT EXISTS idx_cotacoes_arquivo_cotacao
  ON public.cotacoes_licitacao_arquivo (cotacao_id, lado);

COMMENT ON COLUMN public.cotacoes_licitacao.arquivo_url IS
  'LEGADO — migrado para cotacoes_licitacao_arquivo (lado=solicitacao) em 20260826000001. Não escrever.';
COMMENT ON COLUMN public.cotacoes_licitacao.resposta_arquivo_url IS
  'LEGADO — migrado para cotacoes_licitacao_arquivo (lado=resposta) em 20260826000001. Não escrever.';

-- ── 2. RLS ───────────────────────────────────────────────────────────
--
-- A visibilidade pega carona no pai: a subconsulta em cotacoes_licitacao
-- também passa pela RLS dela, então quem não enxerga a cotação não enxerga
-- anexo nenhum, sem repetir aqui a regra de empresa e de menu.

ALTER TABLE public.cotacoes_licitacao_arquivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cotacoes_arquivo_select ON public.cotacoes_licitacao_arquivo;
CREATE POLICY cotacoes_arquivo_select ON public.cotacoes_licitacao_arquivo
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cotacoes_licitacao c WHERE c.id = cotacao_id));

-- Cada lado só anexa no seu lado — o espelho do trigger cotacoes_guarda_colunas.
DROP POLICY IF EXISTS cotacoes_arquivo_insert ON public.cotacoes_licitacao_arquivo;
CREATE POLICY cotacoes_arquivo_insert ON public.cotacoes_licitacao_arquivo
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.cotacoes_licitacao c WHERE c.id = cotacao_id)
    AND (
      (lado = 'solicitacao' AND (public.can_access(auth.uid(), 'cotacoes-licitacao', 'incluir')
                              OR public.can_access(auth.uid(), 'cotacoes-licitacao', 'alterar')))
      OR
      (lado = 'resposta'    AND public.can_access(auth.uid(), 'sup_cotacoes', 'alterar'))
    )
  );

-- Tirar um anexo antes de enviar / ao editar. Mesma regra do insert.
DROP POLICY IF EXISTS cotacoes_arquivo_delete ON public.cotacoes_licitacao_arquivo;
CREATE POLICY cotacoes_arquivo_delete ON public.cotacoes_licitacao_arquivo
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.cotacoes_licitacao c WHERE c.id = cotacao_id)
    AND (
      (lado = 'solicitacao' AND public.can_access(auth.uid(), 'cotacoes-licitacao', 'alterar'))
      OR
      (lado = 'resposta'    AND public.can_access(auth.uid(), 'sup_cotacoes', 'alterar'))
    )
  );

-- ── 3. Responder com vários anexos ───────────────────────────────────
--
-- Assinatura nova (jsonb), então a antiga sai. Continua exigindo comentário
-- E ao menos um arquivo (§7.2: não existe resposta sem documento), e o nome
-- de quem respondeu continua vindo de profiles, não do cliente.

DROP FUNCTION IF EXISTS public.sup_cot_responder(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.sup_cot_responder(
  p_id         uuid,
  p_comentario text,
  p_arquivos   jsonb)   -- [{ caminho, nome, tamanho }, ...]
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_n    int;
BEGIN
  IF NOT public.can_access(v_uid, 'sup_cotacoes', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para responder cotação.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_comentario), '') = '' THEN
    RAISE EXCEPTION 'O comentário da resposta é obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF p_arquivos IS NULL OR jsonb_array_length(p_arquivos) = 0 THEN
    RAISE EXCEPTION 'A resposta exige ao menos um arquivo anexado.' USING ERRCODE = '22023';
  END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;
  v_nome := COALESCE(v_nome, 'Compras');

  UPDATE public.cotacoes_licitacao
     SET resposta_comentario = p_comentario,
         respondente_id      = v_uid,
         respondente_nome    = v_nome,
         data_resposta       = now(),
         status              = 'respondido',
         -- Resposta nova é resposta não lida: reacende o aviso na Licitação.
         resposta_visualizada_por_id = NULL,
         resposta_visualizada_em     = NULL
   WHERE id = p_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Cotação não encontrada ou fora do seu acesso.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.cotacoes_licitacao_arquivo
         (cotacao_id, lado, caminho, nome, tamanho, enviado_por, enviado_por_nome)
  SELECT p_id, 'resposta',
         a->>'caminho', a->>'nome', NULLIF(a->>'tamanho', '')::bigint, v_uid, v_nome
    FROM jsonb_array_elements(p_arquivos) AS a
   WHERE COALESCE(btrim(a->>'caminho'), '') <> ''
  ON CONFLICT (cotacao_id, lado, caminho) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.sup_cot_responder(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_cot_responder(uuid, text, jsonb) TO authenticated;

-- ── 4. Migrar o que já existe ────────────────────────────────────────
-- Idempotente pelo UNIQUE: rodar de novo não duplica.

INSERT INTO public.cotacoes_licitacao_arquivo
       (cotacao_id, lado, caminho, nome, enviado_por, enviado_por_nome, created_at)
SELECT c.id, 'solicitacao', c.arquivo_url, COALESCE(c.arquivo_nome, 'Arquivo'),
       c.remetente_id, c.remetente_nome, c.created_at
  FROM public.cotacoes_licitacao c
 WHERE COALESCE(btrim(c.arquivo_url), '') <> ''
ON CONFLICT (cotacao_id, lado, caminho) DO NOTHING;

INSERT INTO public.cotacoes_licitacao_arquivo
       (cotacao_id, lado, caminho, nome, enviado_por, enviado_por_nome, created_at)
SELECT c.id, 'resposta', c.resposta_arquivo_url, COALESCE(c.resposta_arquivo_nome, 'Arquivo'),
       c.respondente_id, c.respondente_nome, COALESCE(c.data_resposta, c.created_at)
  FROM public.cotacoes_licitacao c
 WHERE COALESCE(btrim(c.resposta_arquivo_url), '') <> ''
ON CONFLICT (cotacao_id, lado, caminho) DO NOTHING;

-- ── 5. Bucket: qualquer extensão ─────────────────────────────────────
-- Já estava sem allowed_mime_types (o navegador manda mime inconsistente para
-- .xls/.zip). Fica só o teto de 10 MB por arquivo, que é o que protege o
-- serviço. A defesa contra .html/.svg com script é o download forçado no
-- cliente, que impede o arquivo de renderizar na aba.
UPDATE storage.buckets
   SET allowed_mime_types = NULL, file_size_limit = 10485760
 WHERE id = 'cotacoes-arquivos';

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT lado, count(*) AS anexos FROM public.cotacoes_licitacao_arquivo GROUP BY lado ORDER BY lado;

SELECT count(*) AS cotacoes_com_arquivo_antigo_nao_migrado
  FROM public.cotacoes_licitacao c
 WHERE COALESCE(btrim(c.arquivo_url), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM public.cotacoes_licitacao_arquivo a
                    WHERE a.cotacao_id = c.id AND a.lado = 'solicitacao');

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TABLE IF EXISTS public.cotacoes_licitacao_arquivo;
--   DROP FUNCTION IF EXISTS public.sup_cot_responder(uuid, text, jsonb);
--   -- e recriar sup_cot_responder(uuid,text,text,text) da 20260825000001
-- =====================================================================
