-- SIS-2026-0473 (Iury, mockup HTML via Discord): novo submódulo "Aplicações
-- Financeiras" (Financeiro > Gestão Financeira), parecido com Débito
-- Automático — regista aplicações (CDB/Fundo DI/Conta remunerada/etc.) e
-- resgates (totais ou parciais), e alimenta o Fluxo de Caixa: aplicar é uma
-- SAÍDA (dinheiro saiu da conta corrente), cada resgate é uma ENTRADA
-- própria. Rendimento é só informativo/manual (mesmo aviso do protótipo:
-- "valores de rendimento deste prototipo sao informados manualmente") — sem
-- cálculo automático de indexador/CDI nesta v1.
--
-- Decisões confirmadas com o usuário:
--   - Aplicar = saída, Resgate = entrada no Fluxo de Caixa (bate 1:1 com o
--     extrato bancário).
--   - Resgate parcial E total (o próprio mockup já comentava isso) — tabela
--     filha própria, uma linha por resgate.
--   - NÃO substitui o ignore de "BB Rende Fácil" na Conciliação Bancária
--     (MEMOS_IGNORAR) por agora — módulo novo e paralelo.
--   - Rendimento manual (sem cálculo automático de indexador).
--
-- "Vencida" (status exibido quando data_vencimento < hoje e ainda ativa) é
-- calculado na view/RPC de listagem, não é um valor gravado em `status` —
-- evita depender de job agendado pra transição de estado.

-- ── 1. Tabela de domínio ────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.aplicacao_financeira_numero_seq;

CREATE TABLE public."APLICACAO_FINANCEIRA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  data_aplicacao date NOT NULL,
  competencia date NOT NULL,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  banco_id uuid NOT NULL REFERENCES public.malote_cartao_banco(id),
  produto text NOT NULL CHECK (produto IN ('CDB', 'Fundo DI', 'Conta remunerada', 'Poupança', 'Outro')),
  tipo_aplicacao text NOT NULL CHECK (tipo_aplicacao IN ('aplicacao_inicial', 'reaplicacao', 'aporte_adicional')),
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  forma_pagamento text NOT NULL,
  descricao text NOT NULL,
  valor_aplicado numeric NOT NULL CHECK (valor_aplicado > 0),
  -- Campos informativos do produto — todos opcionais (Conta remunerada não
  -- tem vencimento fixo, por exemplo; "Outro" pode não ter indexador/taxa
  -- conhecidos no momento do cadastro).
  indexador text,
  taxa text,
  data_vencimento date,
  liquidez text,
  -- Manual, sem cálculo de indexador/CDI (decisão confirmada) — atualizado
  -- via aplicacao_financeira_atualizar_rendimento.
  rendimento_acumulado numeric NOT NULL DEFAULT 0 CHECK (rendimento_acumulado >= 0),
  -- 'ativa' | 'resgatada' — "vencida" é calculada, não gravada (ver acima).
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'resgatada')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_aplicacao_financeira_status ON public."APLICACAO_FINANCEIRA"(status);
CREATE INDEX idx_aplicacao_financeira_competencia ON public."APLICACAO_FINANCEIRA"(competencia);
CREATE INDEX idx_aplicacao_financeira_empresa ON public."APLICACAO_FINANCEIRA"(empresa_id);

CREATE TRIGGER aplicacao_financeira_set_updated BEFORE UPDATE ON public."APLICACAO_FINANCEIRA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_gerar_numero()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'AF-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.aplicacao_financeira_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aplicacao_financeira_set_numero ON public."APLICACAO_FINANCEIRA";
CREATE TRIGGER aplicacao_financeira_set_numero BEFORE INSERT ON public."APLICACAO_FINANCEIRA"
  FOR EACH ROW EXECUTE FUNCTION public.aplicacao_financeira_gerar_numero();

-- ── 2. Resgates (parcial ou total) ──────────────────────────────────────
-- Cada linha é um evento de resgate real — 1:N com a aplicação, pra suportar
-- resgate parcial sem perder o histórico dos anteriores. valor_principal +
-- valor_rendimento juntos são o valor que efetivamente entra no Fluxo de
-- Caixa (entrada) nessa data.
CREATE TABLE public."APLICACAO_FINANCEIRA_RESGATE" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacao_id uuid NOT NULL REFERENCES public."APLICACAO_FINANCEIRA"(id) ON DELETE CASCADE,
  data_resgate date NOT NULL,
  valor_principal numeric NOT NULL CHECK (valor_principal > 0),
  valor_rendimento numeric NOT NULL DEFAULT 0 CHECK (valor_rendimento >= 0),
  tipo text NOT NULL CHECK (tipo IN ('parcial', 'total')),
  observacao text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_aplicacao_financeira_resgate_aplicacao ON public."APLICACAO_FINANCEIRA_RESGATE"(aplicacao_id);

-- ── 3. Histórico/eventos (mesmo padrão de DEBITO_AUTOMATICO_EVENTO) ─────
CREATE TABLE public."APLICACAO_FINANCEIRA_EVENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacao_id uuid NOT NULL REFERENCES public."APLICACAO_FINANCEIRA"(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('criacao', 'edicao', 'rendimento_atualizado', 'resgate_parcial', 'resgate_total', 'exclusao')),
  ator_user_id uuid REFERENCES auth.users(id),
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_aplicacao_financeira_evento ON public."APLICACAO_FINANCEIRA_EVENTO"(aplicacao_id, created_at);

-- ── 4. RLS ───────────────────────────────────────────────────────────────
-- Defesa em profundidade: caminho oficial é via RPC (SECURITY DEFINER,
-- abaixo), a tabela não fica aberta por trás. Gateado só por menu/ação
-- (`can_access`), sem recorte por dono/empresa — mesmo padrão do resto da
-- Gestão Financeira (Fluxo de Caixa, Débito Automático, Cartão de Crédito).
ALTER TABLE public."APLICACAO_FINANCEIRA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."APLICACAO_FINANCEIRA_RESGATE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."APLICACAO_FINANCEIRA_EVENTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aplicacao_financeira_select ON public."APLICACAO_FINANCEIRA";
CREATE POLICY aplicacao_financeira_select ON public."APLICACAO_FINANCEIRA"
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar'));

DROP POLICY IF EXISTS aplicacao_financeira_insert ON public."APLICACAO_FINANCEIRA";
CREATE POLICY aplicacao_financeira_insert ON public."APLICACAO_FINANCEIRA"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'incluir'));

DROP POLICY IF EXISTS aplicacao_financeira_update ON public."APLICACAO_FINANCEIRA";
CREATE POLICY aplicacao_financeira_update ON public."APLICACAO_FINANCEIRA"
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar'));

DROP POLICY IF EXISTS aplicacao_financeira_delete ON public."APLICACAO_FINANCEIRA";
CREATE POLICY aplicacao_financeira_delete ON public."APLICACAO_FINANCEIRA"
  FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'excluir'));

DROP POLICY IF EXISTS aplicacao_financeira_resgate_select ON public."APLICACAO_FINANCEIRA_RESGATE";
CREATE POLICY aplicacao_financeira_resgate_select ON public."APLICACAO_FINANCEIRA_RESGATE"
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar'));

DROP POLICY IF EXISTS aplicacao_financeira_evento_select ON public."APLICACAO_FINANCEIRA_EVENTO";
CREATE POLICY aplicacao_financeira_evento_select ON public."APLICACAO_FINANCEIRA_EVENTO"
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'visualizar'));

-- Sem policy de INSERT/UPDATE/DELETE direta em RESGATE/EVENTO — só as RPCs
-- abaixo (SECURITY DEFINER) escrevem.

-- ── 5. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_criar(
  _data_aplicacao date, _competencia date, _empresa_id uuid, _banco_id uuid,
  _produto text, _tipo_aplicacao text, _forma_pagamento text,
  _descricao text, _valor_aplicado numeric,
  _indexador text DEFAULT NULL, _taxa text DEFAULT NULL,
  _data_vencimento date DEFAULT NULL, _liquidez text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_classificacao_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para incluir Aplicação Financeira.';
  END IF;

  SELECT id INTO v_classificacao_id
  FROM public.planejamento_orcamentario_classificacao
  WHERE nome_key = 'aplicacao financeira';

  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'Classificação "Aplicação Financeira" não encontrada — contate o suporte.';
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA" (
    data_aplicacao, competencia, empresa_id, banco_id, produto, tipo_aplicacao,
    classificacao_id, forma_pagamento, descricao, valor_aplicado,
    indexador, taxa, data_vencimento, liquidez, created_by
  ) VALUES (
    _data_aplicacao, _competencia, _empresa_id, _banco_id, _produto, _tipo_aplicacao,
    v_classificacao_id, _forma_pagamento, _descricao, _valor_aplicado,
    _indexador, _taxa, _data_vencimento, _liquidez, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'criacao', auth.uid(), 'Aplicação financeira registrada.');

  RETURN v_id;
END;
$$;

-- _campos: jsonb só com os campos que mudaram (mesmo padrão de
-- debito_automatico_editar). Não deixa editar valor_aplicado por aqui —
-- isso mudaria a saída já lançada no Fluxo; correção de valor errado é via
-- exclusão + novo cadastro, igual outras telas do Fluxo de Caixa.
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_editar(_id uuid, _campos jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes public."APLICACAO_FINANCEIRA"%ROWTYPE;
  v_diff text := '';
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Aplicação Financeira.';
  END IF;

  SELECT * INTO v_antes FROM public."APLICACAO_FINANCEIRA" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA" SET
    indexador         = CASE WHEN _campos ? 'indexador' THEN _campos->>'indexador' ELSE indexador END,
    taxa              = CASE WHEN _campos ? 'taxa' THEN _campos->>'taxa' ELSE taxa END,
    data_vencimento   = CASE WHEN _campos ? 'data_vencimento' THEN (_campos->>'data_vencimento')::date ELSE data_vencimento END,
    liquidez          = CASE WHEN _campos ? 'liquidez' THEN _campos->>'liquidez' ELSE liquidez END,
    descricao         = COALESCE(_campos->>'descricao', descricao),
    updated_by        = auth.uid()
  WHERE id = _id;

  IF _campos ? 'descricao' AND (_campos->>'descricao') IS DISTINCT FROM v_antes.descricao THEN
    v_diff := v_diff || format('Descrição: "%s" → "%s". ', v_antes.descricao, _campos->>'descricao');
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'edicao', auth.uid(), NULLIF(btrim(v_diff), ''));
END;
$$;

-- Rendimento é manual (decisão confirmada) — soma ao acumulado, não
-- substitui, pra ficar como "quanto rendeu desde a última atualização".
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_atualizar_rendimento(_id uuid, _valor numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."APLICACAO_FINANCEIRA"%ROWTYPE;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar Aplicação Financeira.';
  END IF;
  IF _valor <= 0 THEN
    RAISE EXCEPTION 'Valor de rendimento deve ser positivo.';
  END IF;

  SELECT * INTO v_row FROM public."APLICACAO_FINANCEIRA" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;
  IF v_row.status <> 'ativa' THEN
    RAISE EXCEPTION 'Só é possível atualizar rendimento de aplicação ativa.';
  END IF;

  UPDATE public."APLICACAO_FINANCEIRA"
    SET rendimento_acumulado = rendimento_acumulado + _valor, updated_by = auth.uid()
  WHERE id = _id;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'rendimento_atualizado', auth.uid(), format('Rendimento informado: +R$ %s.', _valor));
END;
$$;

-- Resgate parcial ou total. Parcial: baixa o rendimento resgatado do
-- acumulado (o rendimento embutido nesse resgate já saiu, não é mais "a
-- render"), aplicação continua 'ativa'. Total: fecha a aplicação
-- ('resgatada') e zera o rendimento acumulado restante (foi todo resgatado
-- junto). _valor_principal não pode passar do saldo de principal ainda não
-- resgatado (valor_aplicado - soma dos resgates anteriores).
CREATE OR REPLACE FUNCTION public.aplicacao_financeira_resgatar(
  _id uuid, _data_resgate date, _valor_principal numeric, _valor_rendimento numeric,
  _tipo text, _observacao text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."APLICACAO_FINANCEIRA"%ROWTYPE;
  v_ja_resgatado numeric;
  v_saldo_principal numeric;
  v_resgate_id uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para registrar resgate.';
  END IF;
  IF _tipo NOT IN ('parcial', 'total') THEN
    RAISE EXCEPTION 'Tipo de resgate inválido: %', _tipo;
  END IF;
  IF _valor_principal <= 0 THEN
    RAISE EXCEPTION 'Valor do principal resgatado deve ser positivo.';
  END IF;

  SELECT * INTO v_row FROM public."APLICACAO_FINANCEIRA" WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;
  IF v_row.status <> 'ativa' THEN
    RAISE EXCEPTION 'Aplicação já está resgatada.';
  END IF;

  SELECT COALESCE(SUM(valor_principal), 0) INTO v_ja_resgatado
  FROM public."APLICACAO_FINANCEIRA_RESGATE" WHERE aplicacao_id = _id;
  v_saldo_principal := v_row.valor_aplicado - v_ja_resgatado;

  IF _valor_principal > v_saldo_principal THEN
    RAISE EXCEPTION 'Valor do principal (R$ %) maior que o saldo disponível (R$ %).', _valor_principal, v_saldo_principal;
  END IF;
  IF _valor_rendimento > v_row.rendimento_acumulado THEN
    RAISE EXCEPTION 'Valor de rendimento (R$ %) maior que o rendimento acumulado (R$ %).', _valor_rendimento, v_row.rendimento_acumulado;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_RESGATE" (
    aplicacao_id, data_resgate, valor_principal, valor_rendimento, tipo, observacao, created_by
  ) VALUES (
    _id, _data_resgate, _valor_principal, _valor_rendimento, _tipo, _observacao, auth.uid()
  ) RETURNING id INTO v_resgate_id;

  -- Resgate total fecha a posição mesmo que o valor informado não bata
  -- centavo a centavo com o saldo (arredondamento) — decisão de UX: quem
  -- registra "resgate total" quer fechar a aplicação, não deixar um resíduo
  -- de poucos centavos "ativo" pra sempre.
  IF _tipo = 'total' THEN
    UPDATE public."APLICACAO_FINANCEIRA"
      SET status = 'resgatada', rendimento_acumulado = 0, updated_by = auth.uid()
    WHERE id = _id;
  ELSE
    UPDATE public."APLICACAO_FINANCEIRA"
      SET rendimento_acumulado = rendimento_acumulado - _valor_rendimento, updated_by = auth.uid()
    WHERE id = _id;
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (
    _id, CASE WHEN _tipo = 'total' THEN 'resgate_total' ELSE 'resgate_parcial' END, auth.uid(),
    format('Resgate %s: principal R$ %s + rendimento R$ %s.', _tipo, _valor_principal, _valor_rendimento)
  );

  RETURN v_resgate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.aplicacao_financeira_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public."APLICACAO_FINANCEIRA"%ROWTYPE;
  v_tem_resgate boolean;
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-aplicacao-financeira', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir Aplicação Financeira.';
  END IF;

  SELECT * INTO v_row FROM public."APLICACAO_FINANCEIRA" WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro não encontrado: %', _id;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public."APLICACAO_FINANCEIRA_RESGATE" WHERE aplicacao_id = _id) INTO v_tem_resgate;
  IF v_tem_resgate THEN
    RAISE EXCEPTION 'Aplicação com resgate registrado não pode ser excluída.';
  END IF;

  INSERT INTO public."APLICACAO_FINANCEIRA_EVENTO" (aplicacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'exclusao', auth.uid(), 'Registro excluído.');
  DELETE FROM public."APLICACAO_FINANCEIRA" WHERE id = _id;
END;
$$;

REVOKE ALL ON FUNCTION public.aplicacao_financeira_criar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_editar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_atualizar_rendimento FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_resgatar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aplicacao_financeira_excluir FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_criar TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_editar TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_atualizar_rendimento TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_resgatar TO authenticated;
GRANT EXECUTE ON FUNCTION public.aplicacao_financeira_excluir TO authenticated;

-- ── 6. View de listagem (saldo/status calculados, sem join no client) ───
CREATE VIEW public.v_aplicacao_financeira_lista AS
SELECT
  af.id,
  af.numero,
  af.data_aplicacao,
  af.competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  af.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  af.produto,
  af.tipo_aplicacao,
  af.classificacao_id,
  cl.nome AS classificacao_nome,
  af.forma_pagamento,
  af.descricao,
  af.valor_aplicado,
  af.indexador,
  af.taxa,
  af.data_vencimento,
  af.liquidez,
  af.rendimento_acumulado,
  COALESCE(r.total_principal_resgatado, 0) AS total_principal_resgatado,
  COALESCE(r.total_rendimento_resgatado, 0) AS total_rendimento_resgatado,
  af.valor_aplicado - COALESCE(r.total_principal_resgatado, 0) AS saldo_principal,
  (af.valor_aplicado - COALESCE(r.total_principal_resgatado, 0)) + af.rendimento_acumulado AS saldo_atual,
  af.status,
  -- "Vencida" é só de exibição: ativa + data de vencimento já passada.
  CASE
    WHEN af.status = 'ativa' AND af.data_vencimento IS NOT NULL AND af.data_vencimento < CURRENT_DATE THEN 'vencida'
    ELSE af.status
  END AS status_exibicao,
  af.created_by,
  af.created_at
FROM public."APLICACAO_FINANCEIRA" af
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id
LEFT JOIN (
  SELECT aplicacao_id,
    SUM(valor_principal) AS total_principal_resgatado,
    SUM(valor_rendimento) AS total_rendimento_resgatado
  FROM public."APLICACAO_FINANCEIRA_RESGATE"
  GROUP BY aplicacao_id
) r ON r.aplicacao_id = af.id;

ALTER VIEW public.v_aplicacao_financeira_lista SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_lista TO authenticated;

-- ── 7. Views pro Fluxo de Caixa (aplicar = saída, resgate = entrada) ────
-- Colunas alinhadas 1:1 com v_debito_automatico_fluxo_caixa/
-- v_malote_pagamento_fluxo_caixa pra concatenar no client sem transformação.
CREATE VIEW public.v_aplicacao_financeira_fluxo_caixa AS
SELECT
  af.id AS despesa_id,
  af.numero AS id_malote,
  af.data_aplicacao AS data_pagamento,
  af.competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  af.classificacao_id,
  cl.nome AS classificacao_nome,
  af.descricao,
  af.forma_pagamento,
  af.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  af.valor_aplicado AS valor,
  'saida'::text AS tipo
FROM public."APLICACAO_FINANCEIRA" af
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id;

ALTER VIEW public.v_aplicacao_financeira_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_fluxo_caixa TO authenticated;

CREATE VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa AS
SELECT
  r.id AS despesa_id,
  af.numero AS id_malote,
  r.data_resgate AS data_pagamento,
  to_char(r.data_resgate, 'YYYY-MM-01')::date AS competencia,
  af.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
  NULL::uuid AS contrato_id,
  NULL::text AS contrato_nome,
  af.classificacao_id,
  cl.nome AS classificacao_nome,
  format('Resgate %s — %s', CASE WHEN r.tipo = 'total' THEN 'total' ELSE 'parcial' END, af.descricao) AS descricao,
  af.forma_pagamento,
  af.banco_id,
  cb.nome AS banco_nome,
  cb.logo_path AS banco_logo_path,
  NULL::int AS numero_parcela,
  NULL::int AS numero_parcelas,
  r.valor_principal + r.valor_rendimento AS valor,
  'entrada'::text AS tipo
FROM public."APLICACAO_FINANCEIRA_RESGATE" r
JOIN public."APLICACAO_FINANCEIRA" af ON af.id = r.aplicacao_id
LEFT JOIN public.empresas e ON e.id = af.empresa_id
LEFT JOIN public.malote_cartao_banco cb ON cb.id = af.banco_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = af.classificacao_id;

ALTER VIEW public.v_aplicacao_financeira_resgate_fluxo_caixa SET (security_invoker = true);
GRANT SELECT ON public.v_aplicacao_financeira_resgate_fluxo_caixa TO authenticated;

-- ── 8. Menu + permissão (J2: seed OBRIGATÓRIO, senão nasce aberto pra
--    qualquer autenticado) ────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-aplicacao-financeira', 'Financeiro — Aplicações Financeiras',
  '/app/financeiro/gestao-financeira/aplicacoes-financeiras', 35
FROM public.app_modulo m WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Mesmo público que já usa Fluxo de Caixa/Débito Automático/Conciliação —
-- perfil "Malote" (ajustável depois em Gerenciamento de Acesso).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro-aplicacao-financeira', acao.nome::public.app_acao, true
FROM public.perfil_acesso pa
CROSS JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('excluir'), ('exportar')) AS acao(nome)
WHERE pa.nome = 'Malote'
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

-- ── 9. Classificação fixa "Aplicação Financeira" ────────────────────────
INSERT INTO public.planejamento_orcamentario_classificacao (nome)
VALUES ('Aplicação Financeira')
ON CONFLICT (nome_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-aplicacao-financeira';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-aplicacao-financeira';
--   DROP VIEW IF EXISTS public.v_aplicacao_financeira_resgate_fluxo_caixa;
--   DROP VIEW IF EXISTS public.v_aplicacao_financeira_fluxo_caixa;
--   DROP VIEW IF EXISTS public.v_aplicacao_financeira_lista;
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_excluir(uuid);
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_resgatar(uuid, date, numeric, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_atualizar_rendimento(uuid, numeric);
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_editar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_criar(date, date, uuid, uuid, text, text, text, text, numeric, text, text, date, text);
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA_EVENTO";
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA_RESGATE";
--   DROP TABLE IF EXISTS public."APLICACAO_FINANCEIRA";
--   DROP FUNCTION IF EXISTS public.aplicacao_financeira_gerar_numero();
--   DROP SEQUENCE IF EXISTS public.aplicacao_financeira_numero_seq;
--   -- (a linha "Aplicação Financeira" em planejamento_orcamentario_classificacao
--   -- não é removida automaticamente — decisão manual se ainda tem uso)
-- =====================================================================
