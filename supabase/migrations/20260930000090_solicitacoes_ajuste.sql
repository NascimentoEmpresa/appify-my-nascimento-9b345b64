-- SIS-2026-0305 (Carol): "SOLICITO MIGRAÇÃO PARA O SISTEMA DE ERP" — migra
-- o módulo "Ajustes" (prefixo aju_*, ~28 funções) do mesmo app legado
-- Python/eel (Sistema Financeiro Nascimento, ...\FINANCEIRO\ANA X ISA) que
-- já teve o Checklist de Faturamento migrado (SIS-2026-0304). Fluxo: pedido
-- de documentos/comprovantes de RH por contrato+competência, com itens
-- individuais respondidos/anexados, reabertura (com importação de itens da
-- rodada anterior), prazos e unificação de PDF pro envio final.
--
-- Fase 1 confirmada com o usuário: sobe a ESTRUTURA funcional agora (esta
-- migration); migração do dado histórico do legado (42 solicitações + 191
-- itens + 345 anexos reais) é uma fase separada e posterior, depois do
-- time validar o desenho em uso — mesma sequência já usada no 0304.
--
-- Decisões confirmadas com o usuário (mapeamento completo em
-- ~/.claude memory project_solicitacoes_ajuste_legado.md):
--   1. Local: Financeiro → Ferramentas (Sidebar.tsx já reservava o lugar).
--   2. Acesso 100% por usuário via has_screen_access — NÃO reabre o padrão
--      de cargo do Malote (malote_supervisor_por_cargo é piloto isolado,
--      não expandir sem alinhar de novo).
--   3. Sem senha mestra de reabertura do legado — substituída pela ação
--      real 'excluir' (mais forte que 'alterar').
--   4. Catálogo de tipos é NOVO e próprio (não reaproveita doc_tipos — já
--      verificado que é conceito diferente: doc_tipos é por empresa, com
--      periodicidade/obrigatoriedade por contrato; o catálogo daqui é só
--      uma lista plana de sugestão de autocomplete, sem vínculo nenhum).
--      Documentando aqui pra não repetir o gap do 0304
--      (20260930000064_checklist_usa_doc_tipos.sql), que só descobriu o
--      catálogo existente depois de já ter criado um paralelo.

-- ── 1. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE public."SOLICITACAO_AJUSTE_TIPO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."SOLICITACAO_AJUSTE" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES public.contratos(id),
  competencia date NOT NULL,
  iteracao smallint NOT NULL DEFAULT 1,
  sol_anterior_id uuid REFERENCES public."SOLICITACAO_AJUSTE"(id),
  status text NOT NULL DEFAULT 'em_conferencia'
    CHECK (status IN ('em_conferencia','aguardando_rh','em_conferencia_rh','concluido_rh','enviado','arquivada')),
  -- Texto livre (quem recebeu o pedido), igual ao legado — não é FK pra
  -- auth.users de propósito, é só uma anotação informativa, nem sempre
  -- corresponde a um usuário com login no ERP.
  quem_recebeu text,
  data_recebimento date,
  data_reenvio date,
  prazo_resposta date,
  data_despacho date,
  prazo_despacho date,
  doc_pedido_path text,
  doc_pedido_nome text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sol_ajuste_contrato_comp ON public."SOLICITACAO_AJUSTE"(contrato_id, competencia);
CREATE INDEX idx_sol_ajuste_anterior ON public."SOLICITACAO_AJUSTE"(sol_anterior_id);

CREATE TABLE public."SOLICITACAO_AJUSTE_ITEM" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."SOLICITACAO_AJUSTE"(id) ON DELETE CASCADE,
  numero_item int NOT NULL,
  descricao text NOT NULL,
  data_resposta date,
  respondido_por uuid REFERENCES auth.users(id),
  UNIQUE (solicitacao_id, numero_item)
);

CREATE TABLE public."SOLICITACAO_AJUSTE_ANEXO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public."SOLICITACAO_AJUSTE_ITEM"(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  nome_original text NOT NULL,
  tamanho_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sol_ajuste_anexo_item ON public."SOLICITACAO_AJUSTE_ANEXO"(item_id);

CREATE TRIGGER solicitacao_ajuste_set_updated BEFORE UPDATE ON public."SOLICITACAO_AJUSTE"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Numeração de item segura sob concorrência ─────────────────────────
-- Legado calculava numero_item = MAX+1 em Python — seguro num app desktop
-- single-user, mas gera corrida em web multi-usuário. Trigger cobre isso
-- server-side, dispensando o client de calcular.
CREATE OR REPLACE FUNCTION public.solicitacao_ajuste_item_numerar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero_item IS NULL THEN
    SELECT COALESCE(MAX(numero_item), 0) + 1 INTO NEW.numero_item
      FROM public."SOLICITACAO_AJUSTE_ITEM"
     WHERE solicitacao_id = NEW.solicitacao_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS solicitacao_ajuste_item_numerar_trg ON public."SOLICITACAO_AJUSTE_ITEM";
CREATE TRIGGER solicitacao_ajuste_item_numerar_trg BEFORE INSERT ON public."SOLICITACAO_AJUSTE_ITEM"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_ajuste_item_numerar();

-- ── 3. Transição de status validada no servidor ──────────────────────────
-- Legado (aju_mudar_status_sol) aceitava qualquer string sem validar
-- transição nem perfil — a régua (fluxoFin/fluxoRH) era só client-side.
-- Aqui a régua é real: só as transições legítimas passam, sair de
-- 'enviado' exige a ação 'excluir' (substitui a senha mestra compartilhada
-- do legado), e entrar em 'enviado' calcula data_reenvio/prazo_despacho
-- automaticamente (mesma regra do legado, hoje feita em Python).
CREATE OR REPLACE FUNCTION public.solicitacao_ajuste_valida_transicao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'em_conferencia' AND NEW.status = 'aguardando_rh')
    OR (OLD.status = 'aguardando_rh' AND NEW.status = 'em_conferencia_rh')
    OR (OLD.status = 'em_conferencia_rh' AND NEW.status IN ('aguardando_rh', 'concluido_rh'))
    OR (OLD.status = 'concluido_rh' AND NEW.status IN ('em_conferencia_rh', 'enviado'))
    OR (OLD.status = 'enviado' AND NEW.status = 'em_conferencia')
  ) THEN
    RAISE EXCEPTION 'Transição de status inválida: % → %', OLD.status, NEW.status;
  END IF;

  IF OLD.status = 'enviado' AND NOT public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'excluir') THEN
    RAISE EXCEPTION 'Reabrir uma solicitação já enviada exige a permissão de excluir da tela.';
  END IF;

  IF NEW.status = 'enviado' THEN
    NEW.data_reenvio := current_date;
    NEW.prazo_despacho := current_date + 5;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS solicitacao_ajuste_valida_transicao_trg ON public."SOLICITACAO_AJUSTE";
CREATE TRIGGER solicitacao_ajuste_valida_transicao_trg BEFORE UPDATE OF status ON public."SOLICITACAO_AJUSTE"
  FOR EACH ROW EXECUTE FUNCTION public.solicitacao_ajuste_valida_transicao();

-- ── 4. RPC: criar solicitação (com reabertura) ───────────────────────────
-- Única operação genuinamente multi-tabela/atômica do módulo — o resto é
-- CRUD simples de 1 tabela, coberto só por RLS (igual ao Checklist de
-- Faturamento, zero RPCs). Espelha aju_nova_solicitacao/
-- aju_verificar_reabertura (main.py:2910-3050 do legado), com a checagem
-- de permissão real que faltava lá.
CREATE OR REPLACE FUNCTION public.solicitacao_ajuste_criar(
  _contrato_id uuid,
  _competencia date,
  _quem_recebeu text,
  _prazo_resposta date,
  _doc_pedido_path text,
  _doc_pedido_nome text,
  _itens jsonb,
  _itens_importar_ids uuid[] DEFAULT NULL,
  _data_recebimento date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sol_ativa record;
  v_nova_id uuid;
  v_iteracao smallint := 1;
  v_anterior_id uuid := NULL;
  v_item jsonb;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para criar solicitação de ajuste.';
  END IF;

  SELECT id, status, iteracao INTO v_sol_ativa
    FROM public."SOLICITACAO_AJUSTE"
   WHERE contrato_id = _contrato_id AND competencia = _competencia AND status <> 'arquivada'
   LIMIT 1;

  IF v_sol_ativa.id IS NOT NULL THEN
    IF v_sol_ativa.status <> 'enviado' THEN
      RAISE EXCEPTION 'Já existe uma solicitação em conferência para este contrato e competência — conclua-a antes de criar outra.';
    END IF;
    UPDATE public."SOLICITACAO_AJUSTE" SET status = 'arquivada' WHERE id = v_sol_ativa.id;
    v_anterior_id := v_sol_ativa.id;
    v_iteracao := v_sol_ativa.iteracao + 1;
  END IF;

  INSERT INTO public."SOLICITACAO_AJUSTE" (
    contrato_id, competencia, iteracao, sol_anterior_id, quem_recebeu,
    data_recebimento, prazo_resposta, doc_pedido_path, doc_pedido_nome, created_by
  ) VALUES (
    _contrato_id, _competencia, v_iteracao, v_anterior_id, _quem_recebeu,
    COALESCE(_data_recebimento, current_date), _prazo_resposta, _doc_pedido_path, _doc_pedido_nome, auth.uid()
  ) RETURNING id INTO v_nova_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb))
  LOOP
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao)
    VALUES (v_nova_id, v_item->>'descricao');
  END LOOP;

  IF v_anterior_id IS NOT NULL AND _itens_importar_ids IS NOT NULL THEN
    INSERT INTO public."SOLICITACAO_AJUSTE_ITEM" (solicitacao_id, descricao)
    SELECT v_nova_id, descricao
      FROM public."SOLICITACAO_AJUSTE_ITEM"
     WHERE id = ANY(_itens_importar_ids) AND solicitacao_id = v_anterior_id;
  END IF;

  RETURN v_nova_id;
END;
$$;
REVOKE ALL ON FUNCTION public.solicitacao_ajuste_criar(uuid, date, text, date, text, text, jsonb, uuid[], date) FROM PUBLIC, anon;

-- ── 5. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public."SOLICITACAO_AJUSTE_TIPO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SOLICITACAO_AJUSTE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SOLICITACAO_AJUSTE_ITEM" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SOLICITACAO_AJUSTE_ANEXO" ENABLE ROW LEVEL SECURITY;

CREATE POLICY sol_ajuste_tipo_select ON public."SOLICITACAO_AJUSTE_TIPO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'visualizar'));
CREATE POLICY sol_ajuste_tipo_alterar ON public."SOLICITACAO_AJUSTE_TIPO"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));

CREATE POLICY sol_ajuste_select ON public."SOLICITACAO_AJUSTE"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'visualizar'));
CREATE POLICY sol_ajuste_alterar ON public."SOLICITACAO_AJUSTE"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));
CREATE POLICY sol_ajuste_excluir ON public."SOLICITACAO_AJUSTE"
  FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'excluir'));

CREATE POLICY sol_ajuste_item_select ON public."SOLICITACAO_AJUSTE_ITEM"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'visualizar'));
CREATE POLICY sol_ajuste_item_incluir ON public."SOLICITACAO_AJUSTE_ITEM"
  FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));
CREATE POLICY sol_ajuste_item_alterar ON public."SOLICITACAO_AJUSTE_ITEM"
  FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));
CREATE POLICY sol_ajuste_item_excluir ON public."SOLICITACAO_AJUSTE_ITEM"
  FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'excluir'));

CREATE POLICY sol_ajuste_anexo_select ON public."SOLICITACAO_AJUSTE_ANEXO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'visualizar'));
CREATE POLICY sol_ajuste_anexo_incluir ON public."SOLICITACAO_AJUSTE_ANEXO"
  FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));
CREATE POLICY sol_ajuste_anexo_excluir ON public."SOLICITACAO_AJUSTE_ANEXO"
  FOR DELETE TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'excluir'));

-- ── 6. Storage — bucket privado ───────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('solicitacoes-ajuste-anexos', 'solicitacoes-ajuste-anexos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY sol_ajuste_anexos_bucket_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'solicitacoes-ajuste-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'visualizar'));

CREATE POLICY sol_ajuste_anexos_bucket_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'solicitacoes-ajuste-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'alterar'));

CREATE POLICY sol_ajuste_anexos_bucket_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'solicitacoes-ajuste-anexos' AND public.has_screen_access(auth.uid(), 'financeiro-solicitacoes-ajuste', 'excluir'));

-- ── 7. Menu + acesso ───────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-solicitacoes-ajuste', 'Financeiro — Solicitações de Ajuste',
  '/app/financeiro/solicitacoes-ajuste', 36
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-solicitacoes-ajuste', 'incluir'),
  ('financeiro-solicitacoes-ajuste', 'alterar'),
  ('financeiro-solicitacoes-ajuste', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-solicitacoes-ajuste', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('visualizar'::public.app_acao),
    ('incluir'::public.app_acao),
    ('alterar'::public.app_acao),
    ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-solicitacoes-ajuste';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-solicitacoes-ajuste';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-solicitacoes-ajuste';
--   DROP POLICY IF EXISTS sol_ajuste_anexos_bucket_delete ON storage.objects;
--   DROP POLICY IF EXISTS sol_ajuste_anexos_bucket_insert ON storage.objects;
--   DROP POLICY IF EXISTS sol_ajuste_anexos_bucket_select ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'solicitacoes-ajuste-anexos';
--   DELETE FROM storage.buckets WHERE id = 'solicitacoes-ajuste-anexos';
--   DROP FUNCTION IF EXISTS public.solicitacao_ajuste_criar(uuid, date, text, date, text, text, jsonb, uuid[], date);
--   DROP TRIGGER IF EXISTS solicitacao_ajuste_valida_transicao_trg ON public."SOLICITACAO_AJUSTE";
--   DROP FUNCTION IF EXISTS public.solicitacao_ajuste_valida_transicao();
--   DROP TRIGGER IF EXISTS solicitacao_ajuste_item_numerar_trg ON public."SOLICITACAO_AJUSTE_ITEM";
--   DROP FUNCTION IF EXISTS public.solicitacao_ajuste_item_numerar();
--   DROP TABLE IF EXISTS public."SOLICITACAO_AJUSTE_ANEXO";
--   DROP TABLE IF EXISTS public."SOLICITACAO_AJUSTE_ITEM";
--   DROP TABLE IF EXISTS public."SOLICITACAO_AJUSTE";
--   DROP TABLE IF EXISTS public."SOLICITACAO_AJUSTE_TIPO";
-- =====================================================================
