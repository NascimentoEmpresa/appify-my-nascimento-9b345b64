-- ============================================================================
-- SIS-2026-0451 — Solicitações de manutenção e reparo de equipamentos
--
-- O supervisor abre na Central de Serviços; o Almoxarifado decide a ação.
-- A compra interna nasce no Malote pela RPC abaixo, na mesma transação que
-- registra a decisão, para não existir solicitação marcada como encaminhada
-- sem o respectivo item de compra.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_responder_solicitacao_manutencao(uuid,text,text);
--   DROP TABLE IF EXISTS public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO",
--     public."SUP_SOLICITACAO_MANUTENCAO_ANEXO", public."SUP_SOLICITACAO_MANUTENCAO" CASCADE;
--   DELETE FROM public.app_menu WHERE codigo IN
--     ('central_servicos_solicitar_manutencao_equipamento','sup_solicitacoes_manutencoes');
-- ============================================================================

-- 1) Menus e permissões ------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('central_servicos_solicitar_manutencao_equipamento', 'Solicitar Manutenção de Equipamento', '/app/central-servicos/solicitar-manutencao-equipamento', 80),
   ('sup_solicitacoes_manutencoes', 'Solicitações de Manutenção', '/app/suprimentos/solicitacoes-manutencoes', 72)
 ) AS x(codigo, nome, rota, ordem)
 WHERE (m.codigo = 'central_servicos' AND x.codigo = 'central_servicos_solicitar_manutencao_equipamento')
    OR (m.codigo = 'suprimentos' AND x.codigo = 'sup_solicitacoes_manutencoes')
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

-- Menus novos precisam nascer configurados: só o administrador geral recebe a
-- liberação inicial; os supervisores e o Almoxarifado são definidos no painel.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('central_servicos_solicitar_manutencao_equipamento'),
   ('sup_solicitacoes_manutencoes')
 ) AS m(codigo)
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
   ('alterar'::public.app_acao), ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) Solicitação, foto e trilha ---------------------------------------------
CREATE TABLE IF NOT EXISTS public."SUP_SOLICITACAO_MANUTENCAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('peca', 'manutencao')),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE RESTRICT,
  maquinario text NOT NULL CHECK (length(btrim(maquinario)) > 0),
  numero_serie text NOT NULL CHECK (length(btrim(numero_serie)) > 0),
  descricao text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN (
    'aberta', 'peca_disponivel', 'compra_solicitada',
    'manutencao_autorizada', 'manutencao_reprovada'
  )),
  decisao_motivo text,
  malote_despesa_id uuid REFERENCES public.malote_despesa(id) ON DELETE SET NULL,
  solicitante_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  solicitante_nome text,
  respondida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respondida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sup_solicitacao_manutencao_decisao_coerente CHECK (
    (status = 'aberta' AND respondida_por IS NULL AND respondida_em IS NULL)
    OR (status <> 'aberta' AND respondida_por IS NOT NULL AND respondida_em IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sup_solicitacao_manutencao_status
  ON public."SUP_SOLICITACAO_MANUTENCAO" (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_solicitacao_manutencao_solicitante
  ON public."SUP_SOLICITACAO_MANUTENCAO" (solicitante_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."SUP_SOLICITACAO_MANUTENCAO"(id) ON DELETE CASCADE,
  nome_arquivo text NOT NULL,
  caminho text NOT NULL UNIQUE,
  tipo_mime text,
  tamanho_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."SUP_SOLICITACAO_MANUTENCAO"(id) ON DELETE CASCADE,
  status text NOT NULL,
  motivo text,
  autor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sup_solicitacao_manutencao_auditar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO"
    (solicitacao_id, status, motivo, autor_id)
  VALUES (
    NEW.id, NEW.status,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.descricao ELSE NEW.decisao_motivo END,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.solicitante_id ELSE NEW.respondida_por END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sup_solicitacao_manutencao_updated ON public."SUP_SOLICITACAO_MANUTENCAO";
CREATE TRIGGER trg_sup_solicitacao_manutencao_updated
  BEFORE UPDATE ON public."SUP_SOLICITACAO_MANUTENCAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_sup_solicitacao_manutencao_auditar ON public."SUP_SOLICITACAO_MANUTENCAO";
CREATE TRIGGER trg_sup_solicitacao_manutencao_auditar
  AFTER INSERT OR UPDATE OF status ON public."SUP_SOLICITACAO_MANUTENCAO"
  FOR EACH ROW EXECUTE FUNCTION public.sup_solicitacao_manutencao_auditar();

-- 3) RLS --------------------------------------------------------------------
ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO" ENABLE ROW LEVEL SECURITY;

CREATE POLICY sup_solicitacao_manutencao_select
  ON public."SUP_SOLICITACAO_MANUTENCAO" FOR SELECT TO authenticated
  USING (
    (solicitante_id = auth.uid()
      AND public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'visualizar'))
    OR public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'visualizar')
  );

CREATE POLICY sup_solicitacao_manutencao_insert
  ON public."SUP_SOLICITACAO_MANUTENCAO" FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'incluir')
    AND status = 'aberta' AND respondida_por IS NULL AND respondida_em IS NULL
  );

CREATE POLICY sup_solicitacao_manutencao_anexo_select
  ON public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."SUP_SOLICITACAO_MANUTENCAO" s WHERE s.id = solicitacao_id
  ));

CREATE POLICY sup_solicitacao_manutencao_anexo_insert
  ON public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."SUP_SOLICITACAO_MANUTENCAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid()
  ));

CREATE POLICY sup_solicitacao_manutencao_historico_select
  ON public."SUP_SOLICITACAO_MANUTENCAO_HISTORICO" FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."SUP_SOLICITACAO_MANUTENCAO" s WHERE s.id = solicitacao_id
  ));

-- 4) Anexo privado da foto ---------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sup-solicitacoes-manutencao', 'sup-solicitacoes-manutencao', false, 5242880) -- 5 MB
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "sup solicitacoes manutencao storage insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'sup-solicitacoes-manutencao'
    AND name LIKE auth.uid()::text || '/%'
  );

CREATE POLICY "sup solicitacoes manutencao storage select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-solicitacoes-manutencao'
    AND EXISTS (
      SELECT 1 FROM public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" a
      JOIN public."SUP_SOLICITACAO_MANUTENCAO" s ON s.id = a.solicitacao_id
      WHERE a.caminho = storage.objects.name
        AND (
          (s.solicitante_id = auth.uid()
           AND public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'visualizar'))
          OR public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'visualizar')
        )
    )
  );

-- 5) Decisão do Almoxarifado e encaminhamento ao Malote --------------------
CREATE OR REPLACE FUNCTION public.sup_responder_solicitacao_manutencao(
  p_solicitacao_id uuid,
  p_decisao text,
  p_motivo text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_solicitacao public."SUP_SOLICITACAO_MANUTENCAO"%ROWTYPE;
  v_status text;
  v_malote_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(
    auth.uid(), 'sup_solicitacoes_manutencoes', 'alterar'
  ) THEN
    RAISE EXCEPTION 'Sem permissão para responder solicitações de manutenção.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_solicitacao
    FROM public."SUP_SOLICITACAO_MANUTENCAO"
   WHERE id = p_solicitacao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF v_solicitacao.status <> 'aberta' THEN
    RAISE EXCEPTION 'Esta solicitação já foi respondida.' USING ERRCODE = 'P0001';
  END IF;

  IF (v_solicitacao.tipo = 'peca' AND p_decisao NOT IN ('peca_disponivel', 'solicitar_compra'))
     OR (v_solicitacao.tipo = 'manutencao' AND p_decisao NOT IN ('autorizar_manutencao', 'reprovar_manutencao')) THEN
    RAISE EXCEPTION 'A decisão não é compatível com o tipo da solicitação.' USING ERRCODE = '22023';
  END IF;
  IF v_solicitacao.tipo = 'manutencao' AND nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da autorização ou reprovação da manutenção.' USING ERRCODE = '22023';
  END IF;

  v_status := CASE p_decisao
    WHEN 'peca_disponivel' THEN 'peca_disponivel'
    WHEN 'solicitar_compra' THEN 'compra_solicitada'
    WHEN 'autorizar_manutencao' THEN 'manutencao_autorizada'
    WHEN 'reprovar_manutencao' THEN 'manutencao_reprovada'
  END;

  IF p_decisao = 'solicitar_compra' THEN
    INSERT INTO public.malote_despesa (
      empresa_id, origem, status, nome, valor_total, motivo, descricao,
      contrato_id, created_by, tipo
    )
    SELECT c.empresa_id, 'solicitacao', 'aguardando_cotacao',
      'Compra interna — manutenção: ' || v_solicitacao.maquinario,
      0,
      'Peça para ' || v_solicitacao.maquinario || ' (série ' || v_solicitacao.numero_serie || ')',
      concat_ws(E'\n', 'Origem: solicitação de manutenção ' || v_solicitacao.id::text,
        nullif(btrim(v_solicitacao.descricao), ''), nullif(btrim(p_motivo), '')),
      v_solicitacao.contrato_id, auth.uid(), 'contrato'
      FROM public.contratos c WHERE c.id = v_solicitacao.contrato_id
    RETURNING id INTO v_malote_id;
  END IF;

  UPDATE public."SUP_SOLICITACAO_MANUTENCAO"
     SET status = v_status,
         decisao_motivo = nullif(btrim(p_motivo), ''),
         malote_despesa_id = v_malote_id,
         respondida_por = auth.uid(),
         respondida_em = now()
   WHERE id = v_solicitacao.id;

  RETURN v_malote_id;
END;
$$;
REVOKE ALL ON FUNCTION public.sup_responder_solicitacao_manutencao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_responder_solicitacao_manutencao(uuid, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
