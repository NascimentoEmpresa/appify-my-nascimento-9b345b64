-- DOC CANAA — Gestão de Documentos da Escola Canaã, submódulo do Financeiro.
--
-- Migra o blueprint Flask legado `sistema_canaa` (ERP-main/sistemas_completo,
-- rota /canaa, tabelas SISTEMA_CANAA_PROTOCOLOS/SISTEMA_CANAA_HISTORICO_SLA,
-- bucket "Banco de Dados Nascimento" prefixo canaa/). Fluxo do legado:
--   Lançar Documento (qualquer usuário) → Operacional confere / devolve /
--   envia ao malote / anexa comprovante de malote / envia ao Financeiro →
--   Financeiro conclui o pagamento (com comprovante) ou devolve p/ Operação.
-- Trava mensal de orçamento por plano de aplicação (alerta, não bloqueia),
-- histórico por protocolo, exportação ZIP por competência.
--
-- Diferenças deliberadas em relação ao legado:
--   1. Acesso 100% por usuário (has_screen_access), nunca por setor/perfil —
--      o legado decidia OPERACIONAL/FINANCEIRO/CONTROLADORIA pelo Setor_ERP.
--      Os papéis viram 3 menus fantasma (rota NULL) liberáveis por pessoa.
--   2. Transição de status validada no servidor (o legado aceitava qualquer
--      string em atualizar_status_lote, a régua era só client-side).
--   3. Limites de orçamento saem do código (LIMITES_ORCAMENTO hardcoded) pra
--      tabela "DOC_CANAA_PLANO", editável na tela.
--   4. Comprovante de malote (Operacional) e de pagamento (Financeiro) em
--      colunas separadas — no legado o segundo sobrescrevia o primeiro.
--   5. Alerta de orçamento em coluna própria (acima_orcamento/saldo) em vez de
--      texto "⚠️ ACIMA DO ORÇAMENTO" concatenado na observação.
--   6. Histórico gravado pelo servidor (triggers/RPCs), não pelo client.
-- Migração do dado histórico do legado fica para uma fase posterior.

-- ── 1. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."DOC_CANAA_PLANO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  -- NULL = sem trava mensal (categorias gerais do legado)
  limite_mensal numeric(14,2) CHECK (limite_mensal IS NULL OR limite_mensal >= 0),
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."DOC_CANAA_PROTOCOLO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  data_competencia date NOT NULL,
  -- 1º dia do mês da data do serviço (o "mes_ano_comp" do legado)
  competencia date GENERATED ALWAYS AS (
    make_date(EXTRACT(YEAR FROM data_competencia)::int, EXTRACT(MONTH FROM data_competencia)::int, 1)
  ) STORED,
  favorecido text NOT NULL,
  despesa text NOT NULL,
  plano_id uuid NOT NULL REFERENCES public."DOC_CANAA_PLANO"(id),
  documento text NOT NULL,
  valor numeric(14,2) NOT NULL CHECK (valor >= 0),
  doc_path text NOT NULL,
  doc_nome text NOT NULL,
  comprovante_malote_path text,
  comprovante_malote_nome text,
  comprovante_pagamento_path text,
  comprovante_pagamento_nome text,
  status text NOT NULL DEFAULT 'aguardando_operacional'
    CHECK (status IN ('aguardando_operacional','conferido','enviado_malote','enviado_financeiro',
                      'pago','devolvido_operacao','devolvido_financeiro','excluido')),
  observacao text,
  acima_orcamento boolean NOT NULL DEFAULT false,
  saldo_orcamento numeric(14,2),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  excluido_por uuid REFERENCES auth.users(id),
  excluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_doc_canaa_protocolo_comp ON public."DOC_CANAA_PROTOCOLO"(competencia, status);
CREATE INDEX IF NOT EXISTS idx_doc_canaa_protocolo_plano ON public."DOC_CANAA_PROTOCOLO"(plano_id, competencia);

CREATE TABLE IF NOT EXISTS public."DOC_CANAA_HISTORICO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocolo_id uuid NOT NULL REFERENCES public."DOC_CANAA_PROTOCOLO"(id) ON DELETE CASCADE,
  acao text NOT NULL,
  detalhes text,
  usuario_id uuid REFERENCES auth.users(id),
  usuario_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_canaa_historico_protocolo ON public."DOC_CANAA_HISTORICO"(protocolo_id, created_at);

DROP TRIGGER IF EXISTS doc_canaa_plano_set_updated ON public."DOC_CANAA_PLANO";
CREATE TRIGGER doc_canaa_plano_set_updated BEFORE UPDATE ON public."DOC_CANAA_PLANO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS doc_canaa_protocolo_set_updated ON public."DOC_CANAA_PROTOCOLO";
CREATE TRIGGER doc_canaa_protocolo_set_updated BEFORE UPDATE ON public."DOC_CANAA_PROTOCOLO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Catálogo de planos de aplicação (seed do legado) ───────────────────
INSERT INTO public."DOC_CANAA_PLANO" (nome, limite_mensal, ordem) VALUES
  ('PESSOAL', NULL, 10),
  ('ADMINISTRATIVAS', NULL, 20),
  ('ENCARGOS', NULL, 30),
  ('INVESTIMENTO', NULL, 40),
  ('ALIMENTAÇÃO', NULL, 50),
  ('TARIFAS', NULL, 60),
  ('SALDO BANCÁRIO', NULL, 70),
  ('MANUTENÇÃO', NULL, 80),
  ('OUTROS', NULL, 90),
  ('VALE-TRANSPORTE', 2000.00, 110),
  ('MATERIAIS PEDAGÓGICOS', 590.00, 120),
  ('MATERIAIS DE LIMPEZA', 1203.00, 130),
  ('ALUGUEL', 5800.00, 140),
  ('ÁGUA', 462.00, 150),
  ('LUZ', 899.00, 160),
  ('INTERNET', 150.00, 170),
  ('DEMAIS DESPESAS', 5808.38, 180)
ON CONFLICT (nome) DO NOTHING;

-- ── 3. Helpers internos ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.doc_canaa_log(_protocolo_id uuid, _acao text, _detalhes text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nome text;
BEGIN
  SELECT COALESCE(NULLIF(display_name, ''), email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."DOC_CANAA_HISTORICO" (protocolo_id, acao, detalhes, usuario_id, usuario_nome)
  VALUES (_protocolo_id, _acao, NULLIF(_detalhes, ''), auth.uid(), COALESCE(v_nome, 'Sistema'));
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_log(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.doc_canaa_append_obs(_atual text, _nova text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(_nova, '')), '') IS NULL THEN _atual
    WHEN NULLIF(btrim(COALESCE(_atual, '')), '') IS NULL THEN btrim(_nova)
    ELSE _atual || ' | ' || btrim(_nova)
  END
$$;

-- ── 4. Trigger: defaults do insert + checagem de orçamento ─────────────────
-- Mesma regra do legado (salvar_protocolo/editar_centro): soma do plano na
-- competência, ignorando devolvidos e excluídos, + o valor deste documento;
-- passou do limite → alerta (não bloqueia). Roda no INSERT e sempre que
-- plano/valor/data mudam, excluindo o próprio registro da soma.
CREATE OR REPLACE FUNCTION public.doc_canaa_protocolo_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limite numeric;
  v_gasto numeric;
  v_comp date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'aguardando_operacional';
    NEW.created_by := auth.uid();
    NEW.comprovante_malote_path := NULL;
    NEW.comprovante_malote_nome := NULL;
    NEW.comprovante_pagamento_path := NULL;
    NEW.comprovante_pagamento_nome := NULL;
    NEW.excluido_por := NULL;
    NEW.excluido_em := NULL;
  END IF;

  NEW.favorecido := upper(btrim(NEW.favorecido));
  NEW.despesa := upper(btrim(NEW.despesa));
  NEW.documento := upper(btrim(NEW.documento));

  IF TG_OP = 'INSERT'
     OR NEW.plano_id IS DISTINCT FROM OLD.plano_id
     OR NEW.valor IS DISTINCT FROM OLD.valor
     OR NEW.data_competencia IS DISTINCT FROM OLD.data_competencia THEN
    SELECT limite_mensal INTO v_limite FROM public."DOC_CANAA_PLANO" WHERE id = NEW.plano_id;
    IF v_limite IS NULL THEN
      NEW.acima_orcamento := false;
      NEW.saldo_orcamento := NULL;
    ELSE
      v_comp := make_date(EXTRACT(YEAR FROM NEW.data_competencia)::int, EXTRACT(MONTH FROM NEW.data_competencia)::int, 1);
      SELECT COALESCE(SUM(valor), 0) INTO v_gasto
        FROM public."DOC_CANAA_PROTOCOLO"
       WHERE plano_id = NEW.plano_id
         AND competencia = v_comp
         AND status NOT IN ('devolvido_operacao', 'devolvido_financeiro', 'excluido')
         AND id <> NEW.id;
      NEW.saldo_orcamento := v_limite - v_gasto;
      NEW.acima_orcamento := (v_gasto + NEW.valor) > v_limite;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS doc_canaa_protocolo_before_trg ON public."DOC_CANAA_PROTOCOLO";
CREATE TRIGGER doc_canaa_protocolo_before_trg BEFORE INSERT OR UPDATE ON public."DOC_CANAA_PROTOCOLO"
  FOR EACH ROW EXECUTE FUNCTION public.doc_canaa_protocolo_before();

CREATE OR REPLACE FUNCTION public.doc_canaa_protocolo_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.doc_canaa_log(
    NEW.id, 'PROTOCOLO ENVIADO',
    format('Valor: R$ %s | Competência: %s%s',
      to_char(NEW.valor, 'FM999G999G990D00'),
      to_char(NEW.data_competencia, 'DD/MM/YYYY'),
      CASE WHEN NEW.acima_orcamento
        THEN format(' | ACIMA DO ORÇAMENTO (saldo era R$ %s)', to_char(NEW.saldo_orcamento, 'FM999G999G990D00'))
        ELSE '' END)
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS doc_canaa_protocolo_after_insert_trg ON public."DOC_CANAA_PROTOCOLO";
CREATE TRIGGER doc_canaa_protocolo_after_insert_trg AFTER INSERT ON public."DOC_CANAA_PROTOCOLO"
  FOR EACH ROW EXECUTE FUNCTION public.doc_canaa_protocolo_after_insert();

-- ── 5. Régua de status ─────────────────────────────────────────────────────
-- Retorna o menu exigido pra transição, ou NULL se ela não existe.
-- 'pago' e 'excluido' têm RPC própria (exigem comprovante / ação excluir).
CREATE OR REPLACE FUNCTION public.doc_canaa_menu_transicao(_de text, _para text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _de = 'aguardando_operacional' AND _para IN ('conferido', 'devolvido_operacao')
      THEN 'financeiro-doc-canaa-operacional'
    WHEN _de = 'conferido' AND _para IN ('enviado_malote', 'devolvido_operacao', 'aguardando_operacional')
      THEN 'financeiro-doc-canaa-operacional'
    WHEN _de = 'enviado_malote' AND _para IN ('enviado_financeiro', 'devolvido_operacao', 'conferido')
      THEN 'financeiro-doc-canaa-operacional'
    WHEN _de = 'devolvido_financeiro' AND _para IN ('conferido', 'enviado_malote', 'devolvido_operacao')
      THEN 'financeiro-doc-canaa-operacional'
    WHEN _de = 'enviado_financeiro' AND _para = 'devolvido_financeiro'
      THEN 'financeiro-doc-canaa-financeiro'
    WHEN _de = 'pago' AND _para = 'enviado_financeiro'
      THEN 'financeiro-doc-canaa-financeiro'
    WHEN _de = 'devolvido_operacao' AND _para = 'aguardando_operacional'
      THEN 'financeiro-doc-canaa'
  END
$$;

-- ── 6. RPCs ────────────────────────────────────────────────────────────────
-- 6a. Mudança de status em lote (Conferido, Enviar ao Malote, Enviar ao
-- Financeiro, Devolver, Reenviar, Estornar pagamento).
CREATE OR REPLACE FUNCTION public.doc_canaa_mudar_status(_ids uuid[], _status text, _obs text DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_menu text;
  v_acao public.app_acao;
  v_qtd int := 0;
BEGIN
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Nenhum documento selecionado.';
  END IF;
  IF _status IN ('devolvido_operacao', 'devolvido_financeiro') AND NULLIF(btrim(COALESCE(_obs, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da devolução.';
  END IF;

  FOR r IN SELECT * FROM public."DOC_CANAA_PROTOCOLO" WHERE id = ANY(_ids) ORDER BY numero FOR UPDATE
  LOOP
    IF r.status = _status THEN
      CONTINUE;
    END IF;
    v_menu := public.doc_canaa_menu_transicao(r.status, _status);
    IF v_menu IS NULL THEN
      RAISE EXCEPTION 'Protocolo #%: transição de status inválida (% → %).', r.numero, r.status, _status;
    END IF;
    v_acao := CASE
      WHEN v_menu = 'financeiro-doc-canaa' THEN 'incluir'::public.app_acao
      WHEN r.status = 'pago' THEN 'alterar'::public.app_acao
      ELSE 'visualizar'::public.app_acao
    END;
    IF NOT public.has_screen_access(auth.uid(), v_menu, v_acao) THEN
      RAISE EXCEPTION 'Protocolo #%: sem permissão para esta ação.', r.numero;
    END IF;
    IF _status = 'enviado_financeiro' AND r.valor > 0 AND r.comprovante_malote_path IS NULL THEN
      RAISE EXCEPTION 'Protocolo #% está sem comprovante de malote — anexe antes de enviar ao Financeiro.', r.numero;
    END IF;

    UPDATE public."DOC_CANAA_PROTOCOLO"
       SET status = _status,
           observacao = public.doc_canaa_append_obs(observacao, _obs)
     WHERE id = r.id;

    PERFORM public.doc_canaa_log(r.id, 'STATUS: ' || upper(replace(_status, '_', ' ')), _obs);
    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN v_qtd;
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_mudar_status(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_mudar_status(uuid[], text, text) TO authenticated;

-- 6b. Comprovante de malote (Operacional).
CREATE OR REPLACE FUNCTION public.doc_canaa_anexar_comprovante_malote(_id uuid, _path text, _nome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-operacional', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para anexar comprovante de malote.';
  END IF;
  UPDATE public."DOC_CANAA_PROTOCOLO"
     SET comprovante_malote_path = _path, comprovante_malote_nome = _nome
   WHERE id = _id AND status NOT IN ('pago', 'excluido');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocolo não encontrado ou já finalizado.';
  END IF;
  PERFORM public.doc_canaa_log(_id, 'COMPROVANTE DE MALOTE ANEXADO', 'Arquivo: ' || _nome);
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_anexar_comprovante_malote(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_anexar_comprovante_malote(uuid, text, text) TO authenticated;

-- 6c. Concluir pagamento (Financeiro) — comprovante obrigatório.
CREATE OR REPLACE FUNCTION public.doc_canaa_concluir_pagamento(_id uuid, _path text, _nome text, _obs text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-financeiro', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para concluir pagamento.';
  END IF;
  IF NULLIF(btrim(COALESCE(_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Anexe o comprovante de pagamento.';
  END IF;
  UPDATE public."DOC_CANAA_PROTOCOLO"
     SET status = 'pago',
         comprovante_pagamento_path = _path,
         comprovante_pagamento_nome = _nome,
         observacao = public.doc_canaa_append_obs(observacao, _obs)
   WHERE id = _id AND status = 'enviado_financeiro';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só é possível concluir protocolos com status "Enviado ao Financeiro".';
  END IF;
  PERFORM public.doc_canaa_log(_id, 'PAGAMENTO CONCLUÍDO',
    'Comprovante: ' || _nome || COALESCE(' | ' || NULLIF(btrim(_obs), ''), ''));
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_concluir_pagamento(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_concluir_pagamento(uuid, text, text, text) TO authenticated;

-- 6d. Alterar plano de aplicação (Operacional) — reavalia orçamento via trigger.
CREATE OR REPLACE FUNCTION public.doc_canaa_alterar_plano(_id uuid, _plano_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_velho text;
  v_novo text;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-operacional', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o plano de aplicação.';
  END IF;
  SELECT pl.nome INTO v_velho
    FROM public."DOC_CANAA_PROTOCOLO" p JOIN public."DOC_CANAA_PLANO" pl ON pl.id = p.plano_id
   WHERE p.id = _id AND p.status NOT IN ('pago', 'excluido');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocolo não encontrado ou já finalizado.';
  END IF;
  SELECT nome INTO v_novo FROM public."DOC_CANAA_PLANO" WHERE id = _plano_id AND ativo;
  IF v_novo IS NULL THEN
    RAISE EXCEPTION 'Plano de aplicação inválido.';
  END IF;
  UPDATE public."DOC_CANAA_PROTOCOLO" SET plano_id = _plano_id WHERE id = _id;
  PERFORM public.doc_canaa_log(_id, 'PLANO DE APLICAÇÃO ALTERADO', format('De "%s" para "%s"', v_velho, v_novo));
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_alterar_plano(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_alterar_plano(uuid, uuid) TO authenticated;

-- 6e. Observação avulsa.
CREATE OR REPLACE FUNCTION public.doc_canaa_adicionar_obs(_id uuid, _obs text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'alterar')
          OR public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-operacional', 'visualizar')
          OR public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-financeiro', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para adicionar observação.';
  END IF;
  IF NULLIF(btrim(COALESCE(_obs, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Observação vazia.';
  END IF;
  UPDATE public."DOC_CANAA_PROTOCOLO"
     SET observacao = public.doc_canaa_append_obs(observacao, _obs)
   WHERE id = _id AND status <> 'excluido';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocolo não encontrado.';
  END IF;
  PERFORM public.doc_canaa_log(_id, 'OBSERVAÇÃO', _obs);
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_adicionar_obs(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_adicionar_obs(uuid, text) TO authenticated;

-- 6f. Corrigir dados do protocolo (não existia no legado — lá o devolvido
-- precisava ser relançado do zero). Quem tem 'alterar' corrige qualquer
-- protocolo em aberto; quem só tem 'incluir' corrige os próprios enquanto
-- aguardam o Operacional ou foram devolvidos pra base.
CREATE OR REPLACE FUNCTION public.doc_canaa_editar(
  _id uuid,
  _favorecido text,
  _despesa text,
  _plano_id uuid,
  _documento text,
  _valor numeric,
  _data_competencia date,
  _doc_path text DEFAULT NULL,
  _doc_nome text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public."DOC_CANAA_PROTOCOLO" WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR r.status IN ('pago', 'excluido') THEN
    RAISE EXCEPTION 'Protocolo não encontrado ou já finalizado.';
  END IF;
  IF NOT (
    public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'alterar')
    OR (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'incluir')
        AND r.created_by = auth.uid()
        AND r.status IN ('aguardando_operacional', 'devolvido_operacao'))
  ) THEN
    RAISE EXCEPTION 'Sem permissão para editar este protocolo.';
  END IF;
  IF _valor IS NULL OR _valor < 0 THEN
    RAISE EXCEPTION 'Valor inválido.';
  END IF;

  UPDATE public."DOC_CANAA_PROTOCOLO"
     SET favorecido = _favorecido,
         despesa = _despesa,
         plano_id = _plano_id,
         documento = _documento,
         valor = _valor,
         data_competencia = _data_competencia,
         doc_path = COALESCE(NULLIF(_doc_path, ''), doc_path),
         doc_nome = COALESCE(NULLIF(_doc_nome, ''), doc_nome)
   WHERE id = _id;

  PERFORM public.doc_canaa_log(_id, 'PROTOCOLO EDITADO',
    format('Valor: R$ %s | Competência: %s%s',
      to_char(_valor, 'FM999G999G990D00'), to_char(_data_competencia, 'DD/MM/YYYY'),
      CASE WHEN NULLIF(_doc_path, '') IS NOT NULL THEN ' | Arquivo substituído' ELSE '' END));
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_editar(uuid, text, text, uuid, text, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_editar(uuid, text, text, uuid, text, numeric, date, text, text) TO authenticated;

-- 6g. Exclusão lógica (como no legado — status 'excluido', some das listas).
CREATE OR REPLACE FUNCTION public.doc_canaa_excluir(_id uuid, _motivo text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir.';
  END IF;
  UPDATE public."DOC_CANAA_PROTOCOLO"
     SET status = 'excluido', excluido_por = auth.uid(), excluido_em = now()
   WHERE id = _id AND status <> 'excluido';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocolo não encontrado.';
  END IF;
  PERFORM public.doc_canaa_log(_id, 'EXCLUÍDO', COALESCE(NULLIF(btrim(_motivo), ''), 'Documento excluído pelo usuário'));
END;
$$;
REVOKE ALL ON FUNCTION public.doc_canaa_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_canaa_excluir(uuid, text) TO authenticated;

-- ── 7. RLS ─────────────────────────────────────────────────────────────────
-- Protocolo: leitura por quem vê a tela; INSERT direto (trigger força os
-- campos de controle); UPDATE/DELETE só pelas RPCs acima (sem policy).
ALTER TABLE public."DOC_CANAA_PLANO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DOC_CANAA_PROTOCOLO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DOC_CANAA_HISTORICO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS doc_canaa_plano_select ON public."DOC_CANAA_PLANO";
CREATE POLICY doc_canaa_plano_select ON public."DOC_CANAA_PLANO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'visualizar'));
DROP POLICY IF EXISTS doc_canaa_plano_gerenciar ON public."DOC_CANAA_PLANO";
CREATE POLICY doc_canaa_plano_gerenciar ON public."DOC_CANAA_PLANO"
  FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-orcamento', 'visualizar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-orcamento', 'visualizar'));

DROP POLICY IF EXISTS doc_canaa_protocolo_select ON public."DOC_CANAA_PROTOCOLO";
CREATE POLICY doc_canaa_protocolo_select ON public."DOC_CANAA_PROTOCOLO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'visualizar'));
DROP POLICY IF EXISTS doc_canaa_protocolo_incluir ON public."DOC_CANAA_PROTOCOLO";
CREATE POLICY doc_canaa_protocolo_incluir ON public."DOC_CANAA_PROTOCOLO"
  FOR INSERT TO authenticated WITH CHECK (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'incluir'));

DROP POLICY IF EXISTS doc_canaa_historico_select ON public."DOC_CANAA_HISTORICO";
CREATE POLICY doc_canaa_historico_select ON public."DOC_CANAA_HISTORICO"
  FOR SELECT TO authenticated USING (public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'visualizar'));

-- ── 8. Storage — bucket privado ────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('doc-canaa', 'doc-canaa', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "doc canaa arquivo select" ON storage.objects;
CREATE POLICY "doc canaa arquivo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'doc-canaa' AND public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'visualizar'));

DROP POLICY IF EXISTS "doc canaa arquivo insert" ON storage.objects;
CREATE POLICY "doc canaa arquivo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'doc-canaa' AND (
    public.has_screen_access(auth.uid(), 'financeiro-doc-canaa', 'incluir')
    OR public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-operacional', 'visualizar')
    OR public.has_screen_access(auth.uid(), 'financeiro-doc-canaa-financeiro', 'visualizar')
  ));

-- ── 9. Menus + acesso ──────────────────────────────────────────────────────
-- Tela + 3 menus fantasma (rota NULL) que substituem os "setores" do legado:
--   operacional → conferir, devolver p/ base, malote, comprovante de malote,
--                 enviar ao Financeiro, alterar plano
--   financeiro  → concluir pagamento, devolver p/ Operação ('alterar' estorna pago)
--   orcamento   → editar planos de aplicação e limites mensais
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM public.app_modulo m
 CROSS JOIN (VALUES
    ('financeiro-doc-canaa', 'Financeiro — DOC CANAA', '/app/financeiro/doc-canaa', 37),
    ('financeiro-doc-canaa-operacional', 'DOC CANAA: Ações do Operacional', NULL, 38),
    ('financeiro-doc-canaa-financeiro', 'DOC CANAA: Ações do Financeiro', NULL, 39),
    ('financeiro-doc-canaa-orcamento', 'DOC CANAA: Configurar Orçamento', NULL, 40)
 ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-doc-canaa', 'incluir'),
  ('financeiro-doc-canaa', 'alterar'),
  ('financeiro-doc-canaa', 'excluir'),
  ('financeiro-doc-canaa', 'exportar'),
  ('financeiro-doc-canaa-financeiro', 'alterar')
ON CONFLICT DO NOTHING;

-- Menu novo nasce aberto: semeia só os perfis "concede tudo" (admin).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu, x.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('financeiro-doc-canaa', 'visualizar'::public.app_acao),
    ('financeiro-doc-canaa', 'incluir'::public.app_acao),
    ('financeiro-doc-canaa', 'alterar'::public.app_acao),
    ('financeiro-doc-canaa', 'excluir'::public.app_acao),
    ('financeiro-doc-canaa', 'exportar'::public.app_acao),
    ('financeiro-doc-canaa-operacional', 'visualizar'::public.app_acao),
    ('financeiro-doc-canaa-financeiro', 'visualizar'::public.app_acao),
    ('financeiro-doc-canaa-financeiro', 'alterar'::public.app_acao),
    ('financeiro-doc-canaa-orcamento', 'visualizar'::public.app_acao)
 ) AS x(menu, acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo LIKE 'financeiro-doc-canaa%';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo LIKE 'financeiro-doc-canaa%';
--   DELETE FROM public.app_menu WHERE codigo LIKE 'financeiro-doc-canaa%';
--   DROP POLICY IF EXISTS "doc canaa arquivo insert" ON storage.objects;
--   DROP POLICY IF EXISTS "doc canaa arquivo select" ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'doc-canaa';
--   DELETE FROM storage.buckets WHERE id = 'doc-canaa';
--   DROP FUNCTION IF EXISTS public.doc_canaa_excluir(uuid, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_editar(uuid, text, text, uuid, text, numeric, date, text, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_adicionar_obs(uuid, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_alterar_plano(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.doc_canaa_concluir_pagamento(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_anexar_comprovante_malote(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_mudar_status(uuid[], text, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_menu_transicao(text, text);
--   DROP TRIGGER IF EXISTS doc_canaa_protocolo_after_insert_trg ON public."DOC_CANAA_PROTOCOLO";
--   DROP TRIGGER IF EXISTS doc_canaa_protocolo_before_trg ON public."DOC_CANAA_PROTOCOLO";
--   DROP FUNCTION IF EXISTS public.doc_canaa_protocolo_after_insert();
--   DROP FUNCTION IF EXISTS public.doc_canaa_protocolo_before();
--   DROP FUNCTION IF EXISTS public.doc_canaa_append_obs(text, text);
--   DROP FUNCTION IF EXISTS public.doc_canaa_log(uuid, text, text);
--   DROP TABLE IF EXISTS public."DOC_CANAA_HISTORICO";
--   DROP TABLE IF EXISTS public."DOC_CANAA_PROTOCOLO";
--   DROP TABLE IF EXISTS public."DOC_CANAA_PLANO";
-- =====================================================================
