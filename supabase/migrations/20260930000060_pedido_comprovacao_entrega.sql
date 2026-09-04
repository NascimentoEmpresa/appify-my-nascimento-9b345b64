-- =====================================================================
-- SIS-2026-0322 — comprovação de entrega dos pedidos de materiais
-- =====================================================================

-- 1) Formulário e fotos
CREATE TABLE IF NOT EXISTS public.sup_pedido_comprovacao (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id             uuid NOT NULL UNIQUE REFERENCES public.sup_pedido(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'PENDENTE',
  gerado_em             timestamptz NOT NULL DEFAULT now(),
  respondido_em         timestamptz,
  respondido_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respondido_por_nome   text,
  recebedor_nome        text,
  observacao            text
);

ALTER TABLE public.sup_pedido_comprovacao
  DROP CONSTRAINT IF EXISTS sup_pedido_comprovacao_status_check;
ALTER TABLE public.sup_pedido_comprovacao
  ADD CONSTRAINT sup_pedido_comprovacao_status_check
  CHECK (status IN ('PENDENTE', 'ENVIADO', 'DISPENSADO'));

CREATE TABLE IF NOT EXISTS public.sup_pedido_comprovacao_foto (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comprovacao_id     uuid NOT NULL REFERENCES public.sup_pedido_comprovacao(id) ON DELETE CASCADE,
  storage_path       text NOT NULL,
  colaborador_nome   text,
  ordem              integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sup_pedido_comprovacao_foto_comp
  ON public.sup_pedido_comprovacao_foto(comprovacao_id, ordem);

-- 2) O formulário nasce por mudança de estado, independentemente do caminho
-- que fez o UPDATE (RPC, correção manual ou integração futura).
CREATE OR REPLACE FUNCTION public.sup_pedido_criar_comprovacao_despacho()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'DESPACHADO' AND OLD.status <> 'DESPACHADO' THEN
    INSERT INTO public.sup_pedido_comprovacao (pedido_id)
    VALUES (NEW.id)
    ON CONFLICT (pedido_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sup_pedido_criar_comprovacao ON public.sup_pedido;
CREATE TRIGGER trg_sup_pedido_criar_comprovacao
  AFTER UPDATE ON public.sup_pedido
  FOR EACH ROW EXECUTE FUNCTION public.sup_pedido_criar_comprovacao_despacho();

-- Marco temporal da regra: o acervo que já estava despachado na aplicação
-- permanece no comportamento antigo, sem formulário nem pendência. Somente
-- despachos posteriores a esta migration nascem como PENDENTE pelo trigger.
INSERT INTO public.sup_pedido_comprovacao (pedido_id, status)
SELECT p.id, 'DISPENSADO'
  FROM public.sup_pedido p
 WHERE p.status = 'DESPACHADO'
ON CONFLICT (pedido_id) DO NOTHING;

-- 3) RLS das tabelas. O solicitante só alcança pedidos que criou ou que
-- pertencem à identificação/contrato da sessão externa atual; Compras ainda
-- precisa da permissão de tela e do recorte da sua empresa.
ALTER TABLE public.sup_pedido_comprovacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_pedido_comprovacao_foto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_pedido_comprovacao_select ON public.sup_pedido_comprovacao;
CREATE POLICY sup_pedido_comprovacao_select ON public.sup_pedido_comprovacao
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.sup_pedido p
     WHERE p.id = sup_pedido_comprovacao.pedido_id
       AND (
         p.criado_por = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.sup_ext_sessao s
            WHERE s.user_id = auth.uid()
              AND s.contrato_id = p.contrato_id
              AND s.login_informado = p.solicitante_login
         )
         OR (
           public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
           AND p.empresa_id IN (
             SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
           )
         )
       )
  ));

DROP POLICY IF EXISTS sup_pedido_comprovacao_foto_select ON public.sup_pedido_comprovacao_foto;
CREATE POLICY sup_pedido_comprovacao_foto_select ON public.sup_pedido_comprovacao_foto
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1
      FROM public.sup_pedido_comprovacao c
      JOIN public.sup_pedido p ON p.id = c.pedido_id
     WHERE c.id = sup_pedido_comprovacao_foto.comprovacao_id
       AND (
         p.criado_por = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.sup_ext_sessao s
            WHERE s.user_id = auth.uid()
              AND s.contrato_id = p.contrato_id
              AND s.login_informado = p.solicitante_login
         )
         OR (
           public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
           AND p.empresa_id IN (
             SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
           )
         )
       )
  ));

-- 4) Bucket privado. A posse é conferida pelo primeiro segmento do caminho,
-- que obrigatoriamente é o UUID do pedido; o papel authenticated, sozinho,
-- nunca autoriza o upload de um encarregado no pedido de outro.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sup-comprovacoes', 'sup-comprovacoes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sup_comprovacoes_insert ON storage.objects;
CREATE POLICY sup_comprovacoes_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'sup-comprovacoes'
    AND EXISTS (
      SELECT 1 FROM public.sup_pedido p
       WHERE p.id::text = (storage.foldername(name))[1]
         AND (
           p.criado_por = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.sup_ext_sessao s
              WHERE s.user_id = auth.uid()
                AND s.contrato_id = p.contrato_id
                AND s.login_informado = p.solicitante_login
           )
         )
    )
  );

DROP POLICY IF EXISTS sup_comprovacoes_select ON storage.objects;
CREATE POLICY sup_comprovacoes_select ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'sup-comprovacoes'
    AND EXISTS (
      SELECT 1 FROM public.sup_pedido p
       WHERE p.id::text = (storage.foldername(name))[1]
         AND (
           p.criado_por = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.sup_ext_sessao s
              WHERE s.user_id = auth.uid()
                AND s.contrato_id = p.contrato_id
                AND s.login_informado = p.solicitante_login
           )
           OR (
             public.can_access(auth.uid(), 'sup_pedidos_materiais', 'visualizar')
             AND p.empresa_id IN (
               SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
             )
           )
         )
    )
  );

-- Permite desfazer somente os arquivos do próprio pedido quando uma tentativa
-- de envio falha depois do upload. A comprovação enviada nunca chama DELETE.
DROP POLICY IF EXISTS sup_comprovacoes_delete ON storage.objects;
CREATE POLICY sup_comprovacoes_delete ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'sup-comprovacoes'
    AND EXISTS (
      SELECT 1 FROM public.sup_pedido p
       WHERE p.id::text = (storage.foldername(name))[1]
         AND (
           p.criado_por = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.sup_ext_sessao s
              WHERE s.user_id = auth.uid()
                AND s.contrato_id = p.contrato_id
                AND s.login_informado = p.solicitante_login
           )
         )
    )
  );

-- 5) Envio externo. SECURITY DEFINER exige que a mesma posse da listagem seja
-- repetida aqui; depender da RLS ou do papel authenticated abriria pedidos de
-- terceiros para as sessões anônimas do Supabase.
CREATE OR REPLACE FUNCTION public.sup_ext_comprovacao_enviar(
  p_pedido_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pedido public.sup_pedido%ROWTYPE;
  v_comprovacao public.sup_pedido_comprovacao%ROWTYPE;
  v_foto jsonb;
  v_nome text;
  v_recebedor text := nullif(btrim(p_payload->>'recebedor_nome'), '');
  v_fotos jsonb := COALESCE(p_payload->'fotos', '[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_recebedor IS NULL THEN RAISE EXCEPTION 'Informe o nome de quem recebeu'; END IF;
  IF jsonb_typeof(v_fotos) <> 'array' OR jsonb_array_length(v_fotos) < 1 THEN
    RAISE EXCEPTION 'Envie pelo menos uma foto dos colaboradores';
  END IF;

  SELECT p.* INTO v_pedido
    FROM public.sup_pedido p
   WHERE p.id = p_pedido_id
     AND (
       p.criado_por = v_uid
       OR EXISTS (
         SELECT 1 FROM public.sup_ext_sessao s
          WHERE s.user_id = v_uid
            AND s.contrato_id = p.contrato_id
            AND s.login_informado = p.solicitante_login
       )
     )
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou sem acesso'; END IF;

  SELECT c.* INTO v_comprovacao
    FROM public.sup_pedido_comprovacao c
   WHERE c.pedido_id = p_pedido_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprovação de entrega não encontrada'; END IF;
  IF v_comprovacao.status = 'ENVIADO' THEN
    RAISE EXCEPTION 'A comprovação deste pedido já foi enviada';
  END IF;
  IF v_comprovacao.status = 'DISPENSADO' THEN
    RAISE EXCEPTION 'Este pedido é anterior à regra de comprovação de entrega';
  END IF;

  -- Confere tanto o prefixo quanto a existência física do upload. Assim a
  -- linha nunca aponta para arquivo de outro pedido nem para caminho inventado.
  FOR v_foto IN SELECT value FROM jsonb_array_elements(v_fotos) LOOP
    IF COALESCE(v_foto->>'storage_path', '') NOT LIKE p_pedido_id::text || '/%' THEN
      RAISE EXCEPTION 'Caminho de foto inválido para este pedido';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'sup-comprovacoes'
         AND o.name = v_foto->>'storage_path'
    ) THEN
      RAISE EXCEPTION 'Foto enviada não encontrada no armazenamento';
    END IF;
  END LOOP;

  v_nome := COALESCE(
    public.sup_est_nome_usuario(),
    nullif(v_pedido.solicitante_nome, ''),
    nullif(v_pedido.solicitante_login, ''),
    'Solicitante'
  );

  INSERT INTO public.sup_pedido_comprovacao_foto
    (comprovacao_id, storage_path, colaborador_nome, ordem)
  SELECT v_comprovacao.id,
         f.value->>'storage_path',
         nullif(btrim(f.value->>'colaborador_nome'), ''),
         COALESCE((f.value->>'ordem')::integer, f.ordinality::integer - 1)
    FROM jsonb_array_elements(v_fotos) WITH ORDINALITY AS f(value, ordinality);

  UPDATE public.sup_pedido_comprovacao
     SET status = 'ENVIADO',
         respondido_em = now(),
         respondido_por = v_uid,
         respondido_por_nome = v_nome,
         recebedor_nome = v_recebedor,
         observacao = nullif(btrim(p_payload->>'observacao'), '')
   WHERE id = v_comprovacao.id;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES (p_pedido_id, 'COMPROVACAO', v_pedido.status,
          'Comprovação de entrega recebida', v_uid, v_nome);

  RETURN jsonb_build_object('comprovacao_id', v_comprovacao.id, 'status', 'ENVIADO');
END $$;

-- 6) A listagem do solicitante ganha os dois campos derivados da relação
-- 1–1. A mudança do RETURNS TABLE exige DROP + CREATE no PostgreSQL.
DROP FUNCTION IF EXISTS public.sup_ext_meus_pedidos();
CREATE FUNCTION public.sup_ext_meus_pedidos()
RETURNS TABLE (
  id uuid, pedido_id text, status text, data_solicitacao date,
  contrato_nome text, posto_nome text, funcao_nome text,
  nome_colaborador text, matricula_colaborador text,
  tipo_pedido text, observacoes_solicitante text, observacao text,
  data_despachado timestamptz, created_at timestamptz,
  comprovacao_id uuid, comprovacao_status text,
  itens jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id, p.pedido_id, p.status, p.data_solicitacao,
         p.contrato_nome, p.posto_nome, p.funcao_nome,
         p.nome_colaborador, p.matricula_colaborador,
         p.tipo_pedido, p.observacoes_solicitante, p.observacao,
         p.data_despachado, p.created_at,
         c.id, c.status,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object(
                    'nome', pi.nome_item, 'tipo', pi.tipo_item,
                    'tamanho', pi.tamanho, 'quantidade', pi.quantidade,
                    'litros', pi.litros) ORDER BY pi.ordem)
             FROM public.sup_pedido_item pi WHERE pi.pedido_id = p.id
         ), '[]'::jsonb)
    FROM public.sup_pedido p
    LEFT JOIN public.sup_pedido_comprovacao c ON c.pedido_id = p.id
   WHERE auth.uid() IS NOT NULL
     AND (
       p.criado_por = auth.uid()
       OR EXISTS (
         SELECT 1 FROM public.sup_ext_sessao s
          WHERE s.user_id = auth.uid()
            AND s.contrato_id = p.contrato_id
            AND s.login_informado = p.solicitante_login
       )
     )
   ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.sup_ext_comprovacao_enviar(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sup_ext_meus_pedidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_ext_comprovacao_enviar(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_ext_meus_pedidos() TO authenticated;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sup_ext_comprovacao_enviar(uuid, jsonb);
-- A versão anterior de sup_ext_meus_pedidos() deve ser restaurada da migration
-- 20260819000003 depois de remover esta versão.
-- DROP TRIGGER IF EXISTS trg_sup_pedido_criar_comprovacao ON public.sup_pedido;
-- DROP FUNCTION IF EXISTS public.sup_pedido_criar_comprovacao_despacho();
-- DROP POLICY IF EXISTS sup_comprovacoes_select ON storage.objects;
-- DROP POLICY IF EXISTS sup_comprovacoes_insert ON storage.objects;
-- DROP POLICY IF EXISTS sup_comprovacoes_delete ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'sup-comprovacoes';
-- DROP TABLE IF EXISTS public.sup_pedido_comprovacao_foto;
-- DROP TABLE IF EXISTS public.sup_pedido_comprovacao;

NOTIFY pgrst, 'reload schema';
