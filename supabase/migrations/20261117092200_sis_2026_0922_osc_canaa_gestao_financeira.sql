-- SIS-2026-0922: OSC Canaã — Gestão Financeira da Escola (Financeiro)
--
-- Substitui a planilha "Canaa_Previsao_Investimentos.xlsx" que a Operação
-- preenche à mão: repasse mensal da parceria, custo de referência por
-- rubrica (plano de trabalho), aplicações/reservas para férias e 13º, saldo
-- do mês, saldo acumulado, projeção até dezembro e planejamento de
-- investimentos (novos projetos).
--
-- INTEGRAÇÃO COM O MALOTE (o ponto central do chamado)
--   O "pago" vem de v_malote_pagamento_fluxo_caixa — a MESMA view que
--   alimenta o Fluxo de Caixa. Ela já resolve tudo o que o chamado pede
--   sobre status: só entra despesa 'despesa_paga' (ou parcela 'paga');
--   solicitado/aprovado/pronto para pagar NÃO entram; estorno/cancelamento
--   fazem a linha sumir sozinha; rateio já vem quebrado por empresa/
--   contrato/classificação; ajuste manual do Fluxo de Caixa
--   (financeiro_fluxo_caixa_ajuste) já vem aplicado. Por isso NÃO copiamos
--   pagamento nenhum para tabela própria: osc_pagamentos_malote() lê a view
--   na hora. Consequências deliberadas:
--     * um pagamento aparece uma única vez (não existe cópia para duplicar);
--     * estorno no Malote desfaz o efeito no painel na próxima leitura;
--     * o painel é recalculado a cada abertura, sem job/trigger no Malote.
--   Identificação da OSC: empresa da parceria (empresas.codigo = 'CANAA') e,
--   opcionalmente, uma lista de contratos ("OSC_PARCERIA".contrato_ids;
--   vazio = todos os contratos da empresa).
--   Rubrica OSC: de-para configurável classificação do Malote
--   (planejamento_orcamentario_classificacao) -> "OSC_RUBRICA". Não existe
--   no Malote nenhum campo "rubrica OSC"; a carga inicial liga pelo nome
--   (as "descrições originais" da planilha) e o resto é cadastro na tela.
--   Pagamento sem rubrica entra como "Sem rubrica" (conta no gasto, gera
--   alerta) — nunca é descartado em silêncio.
--   Revisão de classificação: "OSC_PAGAMENTO_AJUSTE" (rubrica, competência
--   ou "não é da OSC"), sempre com motivo, responsável e data, só via RPC.
--
-- CÁLCULO: feito no front (src/lib/oscFinanceiro.ts, testado no Vitest) a
--   partir das tabelas abaixo + osc_pagamentos_malote(). Mesmas regras da
--   planilha: saldo do mês = repasse − despesas − aplicação na reserva +
--   resgates; acumulado = saldo inicial + Σ saldos; competência fechada usa
--   o realizado, a do mês corrente/atrasada usa max(realizado, previsto) por
--   rubrica e a futura usa o previsto.
--
-- Acesso: 1 menu 'financeiro-osc-canaa' (rota /app/financeiro/osc-canaa),
--   ações: visualizar, incluir (lançamentos/projetos), alterar (premissas,
--   rubricas, de-para, reclassificação), excluir, aprovar (fechar/reabrir
--   competência e mexer em competência fechada), exportar. Nada de has_role
--   nem get_user_empresa.

-- ── 0. Auxiliar: normalização de nome (de-para por nome) ─────────────────
CREATE OR REPLACE FUNCTION public.osc_normalizar(_txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(translate(btrim(regexp_replace(COALESCE(_txt, ''), '\s+', ' ', 'g')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$$;

-- ── 1. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OSC_PARCERIA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  empresa_id uuid REFERENCES public.empresas(id),
  -- NULL/vazio = todos os contratos da empresa
  contrato_ids uuid[],
  repasse_mensal numeric(14,2) NOT NULL DEFAULT 0 CHECK (repasse_mensal >= 0),
  ativo boolean NOT NULL DEFAULT true,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."OSC_ANO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  ano int NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  -- "Reserva extra a confirmar" da planilha: compromisso ainda não lançado
  reserva_extra numeric(14,2) NOT NULL DEFAULT 0 CHECK (reserva_extra >= 0),
  premissas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parceria_id, ano)
);

CREATE TABLE IF NOT EXISTS public."OSC_RUBRICA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  nome text NOT NULL,
  grupo text NOT NULL DEFAULT 'outros' CHECK (grupo IN
    ('pessoal','encargos','ocupacao','consumo','servicos','materiais','tarifas','impostos','outros','reserva')),
  -- 'reserva' = transferência para aplicação (férias/13º): sai do saldo livre
  -- mas NÃO é despesa — o resgate volta como entrada, sem dupla contagem.
  tipo text NOT NULL DEFAULT 'despesa' CHECK (tipo IN ('despesa','reserva')),
  recorrente boolean NOT NULL DEFAULT false,
  ordem int NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parceria_id, nome)
);

-- De-para classificação do Malote -> rubrica OSC
CREATE TABLE IF NOT EXISTS public."OSC_RUBRICA_CLASSIFICACAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  rubrica_id uuid NOT NULL REFERENCES public."OSC_RUBRICA"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  UNIQUE (parceria_id, classificacao_id)
);

-- Repasse e situação por competência (1 linha por mês; mês sem linha usa
-- o repasse_mensal da parceria e fica "aberto").
CREATE TABLE IF NOT EXISTS public."OSC_COMPETENCIA" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  competencia date NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),
  repasse_previsto numeric(14,2) CHECK (repasse_previsto IS NULL OR repasse_previsto >= 0),
  repasse_recebido numeric(14,2) CHECK (repasse_recebido IS NULL OR repasse_recebido >= 0),
  repasse_recebido_em date,
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta','fechada')),
  -- de onde vem o realizado do mês: Malote (oficial) ou histórico importado
  -- da planilha (meses anteriores ao uso do Malote para a OSC)
  fonte_realizado text NOT NULL DEFAULT 'malote' CHECK (fonte_realizado IN ('malote','historico')),
  fechada_em timestamptz,
  fechada_por uuid,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parceria_id, competencia)
);

-- Custo de referência por rubrica (plano de trabalho) — base do previsto
CREATE TABLE IF NOT EXISTS public."OSC_PREVISAO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  rubrica_id uuid NOT NULL REFERENCES public."OSC_RUBRICA"(id) ON DELETE CASCADE,
  ano int NOT NULL,
  -- manual: usa base_mensal; ultimo_realizado: último mês fechado;
  -- media_realizado: média dos meses fechados do ano (como a planilha)
  criterio text NOT NULL DEFAULT 'manual' CHECK (criterio IN ('manual','ultimo_realizado','media_realizado')),
  base_mensal numeric(14,2) NOT NULL DEFAULT 0,
  ajuste_pct numeric(7,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rubrica_id, ano)
);

-- Valor previsto de um mês específico (sobrepõe o critério)
CREATE TABLE IF NOT EXISTS public."OSC_PREVISAO_MES" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  rubrica_id uuid NOT NULL REFERENCES public."OSC_RUBRICA"(id) ON DELETE CASCADE,
  competencia date NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),
  valor numeric(14,2) NOT NULL,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rubrica_id, competencia)
);

-- Lançamentos fora do Malote:
--   historico: importado da planilha; só conta no mês com fonte 'historico'
--   ajuste:    gasto pago fora do Malote (sempre conta; pode ser negativo)
--   resgate:   dinheiro que volta da aplicação (rubrica tipo 'reserva')
CREATE TABLE IF NOT EXISTS public."OSC_LANCAMENTO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  competencia date NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),
  rubrica_id uuid NOT NULL REFERENCES public."OSC_RUBRICA"(id),
  tipo text NOT NULL CHECK (tipo IN ('historico','ajuste','resgate')),
  valor numeric(14,2) NOT NULL CHECK (valor <> 0),
  descricao text,
  origem_ref text,
  lote_importacao uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_osc_lancamento_comp ON public."OSC_LANCAMENTO"(parceria_id, competencia);

-- Revisão de classificação de um pagamento do Malote (chave do lançamento:
-- despesa + parcela + classificação de origem)
CREATE TABLE IF NOT EXISTS public."OSC_PAGAMENTO_AJUSTE" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  despesa_id uuid NOT NULL,
  numero_parcela int NOT NULL DEFAULT 0,
  classificacao_id_origem uuid,
  rubrica_id uuid REFERENCES public."OSC_RUBRICA"(id) ON DELETE SET NULL,
  competencia date CHECK (competencia IS NULL OR EXTRACT(DAY FROM competencia) = 1),
  ignorar boolean NOT NULL DEFAULT false,
  motivo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_osc_pagamento_ajuste_chave ON public."OSC_PAGAMENTO_AJUSTE"
  (parceria_id, despesa_id, numero_parcela, COALESCE(classificacao_id_origem, '00000000-0000-0000-0000-000000000000'::uuid));

-- Planejamento de investimentos (novos projetos)
CREATE TABLE IF NOT EXISTS public."OSC_PROJETO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parceria_id uuid NOT NULL REFERENCES public."OSC_PARCERIA"(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  rubrica_id uuid REFERENCES public."OSC_RUBRICA"(id) ON DELETE SET NULL,
  valor_estimado numeric(14,2) NOT NULL CHECK (valor_estimado >= 0),
  -- NULL = sem mês definido (a projeção considera dezembro)
  competencia_prevista date CHECK (competencia_prevista IS NULL OR EXTRACT(DAY FROM competencia_prevista) = 1),
  -- pendente/aprovado abatem do saldo projetado; executado já está no
  -- Malote (não abate de novo); cancelado não conta.
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','executado','cancelado')),
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);

-- Trilha de alterações (gravada por trigger, nunca pelo client)
CREATE TABLE IF NOT EXISTS public."OSC_HISTORICO" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parceria_id uuid,
  tabela text NOT NULL,
  registro_id uuid,
  acao text NOT NULL,
  antes jsonb,
  depois jsonb,
  usuario_id uuid,
  usuario_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_osc_historico_parceria ON public."OSC_HISTORICO"(parceria_id, created_at DESC);

-- Índice em toda FOREIGN KEY (guardião M2): sem ele, JOIN pela coluna e
-- DELETE na tabela referenciada varrem a tabela inteira. As FKs cobertas
-- pelo início de um UNIQUE/índice composto já existente não precisam de outro.
CREATE INDEX IF NOT EXISTS osc_parceria_empresa_id_idx ON public."OSC_PARCERIA" (empresa_id);
CREATE INDEX IF NOT EXISTS osc_rubrica_classificacao_classificacao_id_idx ON public."OSC_RUBRICA_CLASSIFICACAO" (classificacao_id);
CREATE INDEX IF NOT EXISTS osc_rubrica_classificacao_rubrica_id_idx ON public."OSC_RUBRICA_CLASSIFICACAO" (rubrica_id);
CREATE INDEX IF NOT EXISTS osc_previsao_parceria_id_idx ON public."OSC_PREVISAO" (parceria_id);
CREATE INDEX IF NOT EXISTS osc_previsao_mes_parceria_id_idx ON public."OSC_PREVISAO_MES" (parceria_id);
CREATE INDEX IF NOT EXISTS osc_lancamento_rubrica_id_idx ON public."OSC_LANCAMENTO" (rubrica_id);
CREATE INDEX IF NOT EXISTS osc_pagamento_ajuste_rubrica_id_idx ON public."OSC_PAGAMENTO_AJUSTE" (rubrica_id);
CREATE INDEX IF NOT EXISTS osc_projeto_parceria_id_idx ON public."OSC_PROJETO" (parceria_id);
CREATE INDEX IF NOT EXISTS osc_projeto_rubrica_id_idx ON public."OSC_PROJETO" (rubrica_id);

-- ── 2. updated_at ────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['OSC_PARCERIA','OSC_ANO','OSC_RUBRICA','OSC_COMPETENCIA','OSC_PREVISAO',
                           'OSC_PREVISAO_MES','OSC_LANCAMENTO','OSC_PAGAMENTO_AJUSTE','OSC_PROJETO'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS osc_set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER osc_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ── 3. Guardas ───────────────────────────────────────────────────────────
-- Competência: fechar/reabrir, ou mexer em competência fechada, exige
-- 'aprovar'. auth.uid() nulo = migration/serviço (carga inicial).
CREATE OR REPLACE FUNCTION public.osc_competencia_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar') THEN
    IF TG_OP = 'INSERT' AND NEW.situacao = 'fechada' THEN
      RAISE EXCEPTION 'Fechar competência exige a permissão "aprovar".';
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.situacao = 'fechada' OR NEW.situacao IS DISTINCT FROM OLD.situacao) THEN
      RAISE EXCEPTION 'Competência fechada (ou fechar/reabrir) exige a permissão "aprovar".';
    END IF;
  END IF;
  IF NEW.situacao = 'fechada' AND (TG_OP = 'INSERT' OR OLD.situacao IS DISTINCT FROM 'fechada') THEN
    NEW.fechada_em := now();
    NEW.fechada_por := auth.uid();
  ELSIF NEW.situacao = 'aberta' THEN
    NEW.fechada_em := NULL;
    NEW.fechada_por := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS osc_competencia_guard_trg ON public."OSC_COMPETENCIA";
CREATE TRIGGER osc_competencia_guard_trg BEFORE INSERT OR UPDATE ON public."OSC_COMPETENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.osc_competencia_guard();

-- Lançamento: competência fechada exige 'aprovar'; resgate só em rubrica de
-- reserva e sempre positivo; histórico positivo.
CREATE OR REPLACE FUNCTION public.osc_lancamento_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_par uuid;
  v_comp date;
  v_tipo_rubrica text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_par := OLD.parceria_id; v_comp := OLD.competencia;
  ELSE
    v_par := NEW.parceria_id; v_comp := NEW.competencia;
  END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar')
     AND (EXISTS (SELECT 1 FROM public."OSC_COMPETENCIA" c
                   WHERE c.parceria_id = v_par AND c.competencia = v_comp AND c.situacao = 'fechada')
          OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public."OSC_COMPETENCIA" c
                   WHERE c.parceria_id = OLD.parceria_id AND c.competencia = OLD.competencia AND c.situacao = 'fechada')))
  THEN
    RAISE EXCEPTION 'Competência fechada: alterar lançamento exige a permissão "aprovar".';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT tipo INTO v_tipo_rubrica FROM public."OSC_RUBRICA" WHERE id = NEW.rubrica_id AND parceria_id = NEW.parceria_id;
  IF v_tipo_rubrica IS NULL THEN
    RAISE EXCEPTION 'Rubrica não pertence a esta parceria.';
  END IF;
  IF NEW.tipo = 'resgate' AND v_tipo_rubrica <> 'reserva' THEN
    RAISE EXCEPTION 'Resgate só pode ser lançado em rubrica de reserva/aplicação.';
  END IF;
  IF NEW.tipo IN ('resgate','historico') AND NEW.valor < 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS osc_lancamento_guard_trg ON public."OSC_LANCAMENTO";
CREATE TRIGGER osc_lancamento_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public."OSC_LANCAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.osc_lancamento_guard();

-- Projeto: aprovar (ou mexer em projeto aprovado) exige 'aprovar'.
CREATE OR REPLACE FUNCTION public.osc_projeto_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar')
     AND ((TG_OP = 'INSERT' AND NEW.status = 'aprovado')
          OR (TG_OP = 'UPDATE' AND (NEW.status = 'aprovado' OR OLD.status = 'aprovado')
              AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.valor_estimado IS DISTINCT FROM OLD.valor_estimado
                   OR NEW.competencia_prevista IS DISTINCT FROM OLD.competencia_prevista)))
  THEN
    RAISE EXCEPTION 'Aprovar projeto (ou alterar projeto aprovado) exige a permissão "aprovar".';
  END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS osc_projeto_guard_trg ON public."OSC_PROJETO";
CREATE TRIGGER osc_projeto_guard_trg BEFORE INSERT OR UPDATE ON public."OSC_PROJETO"
  FOR EACH ROW EXECUTE FUNCTION public.osc_projeto_guard();

-- ── 4. Carga inicial a partir da planilha (só se ainda não há parceria) ──
-- Janeiro a julho/2026: realizado da planilha (aba "Base janeiro a julho",
-- 132 linhas com a célula de origem), competências fechadas com fonte
-- 'historico' e repasse recebido de R$ 91.883,96. Agosto a dezembro: custo
-- de referência (coluna "Previsão mensal" + critério) e os valores mês a mês
-- digitados na aba "Projeção". Reproduz os números da planilha: saldo de
-- julho R$ 50.596,73, custo de referência R$ 89.204,79, dezembro −R$ 680,42.
DO $$
DECLARE
  v_emp uuid;
  v_par uuid;
  v_lote uuid := gen_random_uuid();
BEGIN
  IF EXISTS (SELECT 1 FROM public."OSC_PARCERIA") THEN
    RETURN;
  END IF;
  SELECT id INTO v_emp FROM public.empresas WHERE codigo = 'CANAA' ORDER BY ativa DESC LIMIT 1;

  INSERT INTO public."OSC_PARCERIA" (nome, empresa_id, repasse_mensal, observacao)
  VALUES ('OSC Canaã — Escola Infantil', v_emp, 91883.96,
          'Repasse mensal informado no chamado SIS-2026-0922 (12 parcelas = R$ 1.102.607,52, sujeito a confirmação dos recebimentos).')
  RETURNING id INTO v_par;

  INSERT INTO public."OSC_ANO" (parceria_id, ano, saldo_inicial, reserva_extra, premissas)
  VALUES (v_par, 2026, 0, 0,
'Base: demonstrativos de execução financeira (planilha Canaa_Previsao_Investimentos.xlsx). Janeiro a julho realizados; agosto a dezembro projetados.
Pessoal, aluguel, internet e seguro de vida: valor do último mês fechado. Água, luz e demais rubricas: média dos meses fechados (inclui meses sem lançamento).
Aplicação: R$ 14.300 por mês, separada dos gastos. O total aplicado não equivale ao saldo bancário da reserva.
Sem reajustes, rendimentos ou recursos anteriores informados. Saldo inicial assumido zero.
O saldo é uma estimativa, sem conciliação bancária e sem confirmação das obrigações de fim de ano. A utilização de eventual saldo deve obedecer ao instrumento de parceria, ao plano de trabalho e às regras de prestação de contas.');

  INSERT INTO public."OSC_RUBRICA" (parceria_id, nome, grupo, tipo, recorrente, ordem)
  SELECT v_par, x.nome, x.grupo, x.tipo, x.recorrente, x.ordem
    FROM (VALUES
      ('Salários', 'pessoal', 'despesa', true, 10),
      ('FGTS mensal', 'encargos', 'despesa', true, 20),
      ('INSS mensal', 'encargos', 'despesa', true, 30),
      ('Vale-transporte', 'pessoal', 'despesa', true, 40),
      ('Aluguel', 'ocupacao', 'despesa', true, 50),
      ('Internet', 'consumo', 'despesa', true, 60),
      ('Água', 'consumo', 'despesa', true, 70),
      ('Luz', 'consumo', 'despesa', true, 80),
      ('Seguro de vida', 'pessoal', 'despesa', true, 90),
      ('Manutenção', 'ocupacao', 'despesa', false, 100),
      ('Marketing', 'outros', 'despesa', false, 110),
      ('Tarifas bancárias', 'tarifas', 'despesa', false, 120),
      ('Tarifa Pix', 'tarifas', 'despesa', false, 130),
      ('Gás', 'consumo', 'despesa', false, 140),
      ('FGTS rescisão', 'encargos', 'despesa', false, 150),
      ('Material administrativo', 'materiais', 'despesa', false, 160),
      ('Avante', 'outros', 'despesa', false, 170),
      ('Material pedagógico', 'materiais', 'despesa', false, 180),
      ('Móveis', 'materiais', 'despesa', false, 190),
      ('Rescisão', 'pessoal', 'despesa', false, 200),
      ('Saúde ocupacional', 'servicos', 'despesa', false, 210),
      ('Seguro residencial', 'ocupacao', 'despesa', false, 220),
      ('Serviço de nutrição', 'servicos', 'despesa', false, 230),
      ('Serviço pedagógico', 'servicos', 'despesa', false, 240),
      ('Alimentação', 'consumo', 'despesa', false, 250),
      ('Despesas diretas', 'outros', 'despesa', false, 260),
      ('Diárias', 'servicos', 'despesa', false, 270),
      ('Férias', 'pessoal', 'despesa', false, 280),
      ('Recolhimento de débito', 'impostos', 'despesa', false, 290),
      ('IPTU', 'impostos', 'despesa', false, 300),
      ('Frete', 'outros', 'despesa', false, 310),
      ('Jovem aprendiz', 'pessoal', 'despesa', false, 320),
      ('Impostos', 'impostos', 'despesa', false, 330),
      ('Aplicação para férias e 13º', 'reserva', 'reserva', false, 340)
    ) AS x(nome, grupo, tipo, recorrente, ordem);

  INSERT INTO public."OSC_PREVISAO" (parceria_id, rubrica_id, ano, criterio, base_mensal)
  SELECT v_par, r.id, 2026, x.criterio, x.base
    FROM (VALUES
      ('Salários', 'ultimo_realizado', 37087.6),
      ('FGTS mensal', 'ultimo_realizado', 4248.05),
      ('INSS mensal', 'ultimo_realizado', 10886.36),
      ('Vale-transporte', 'ultimo_realizado', 3528),
      ('Aluguel', 'ultimo_realizado', 5113.73),
      ('Internet', 'ultimo_realizado', 149.9),
      ('Água', 'media_realizado', 410.92),
      ('Luz', 'media_realizado', 1055.74),
      ('Seguro de vida', 'ultimo_realizado', 167.7),
      ('Manutenção', 'media_realizado', 1646.63),
      ('Marketing', 'media_realizado', 40.71),
      ('Tarifas bancárias', 'media_realizado', 98.55),
      ('Tarifa Pix', 'media_realizado', 21.7),
      ('Gás', 'media_realizado', 180.71),
      ('FGTS rescisão', 'media_realizado', 668.08),
      ('Material administrativo', 'media_realizado', 21.43),
      ('Avante', 'media_realizado', 835.5),
      ('Material pedagógico', 'media_realizado', 1154.34),
      ('Móveis', 'media_realizado', 68.57),
      ('Rescisão', 'media_realizado', 1736.62),
      ('Saúde ocupacional', 'media_realizado', 70.29),
      ('Seguro residencial', 'media_realizado', 793.47),
      ('Serviço de nutrição', 'media_realizado', 618.3),
      ('Serviço pedagógico', 'media_realizado', 200.83),
      ('Alimentação', 'media_realizado', 262.03),
      ('Despesas diretas', 'media_realizado', 3672.47),
      ('Diárias', 'media_realizado', 564.29),
      ('Férias', 'media_realizado', 1063.32),
      ('Recolhimento de débito', 'media_realizado', 96.89),
      ('IPTU', 'media_realizado', 285.97),
      ('Frete', 'media_realizado', 9.85),
      ('Jovem aprendiz', 'manual', 0),
      ('Impostos', 'media_realizado', 589.09),
      ('Aplicação para férias e 13º', 'ultimo_realizado', 14300)
    ) AS x(nome, criterio, base)
    JOIN public."OSC_RUBRICA" r ON r.parceria_id = v_par AND r.nome = x.nome;

  INSERT INTO public."OSC_PREVISAO_MES" (parceria_id, rubrica_id, competencia, valor, observacao)
  SELECT v_par, r.id, make_date(2026, x.mes, 1), x.valor, x.obs::text
    FROM (VALUES
      ('Salários', 8, 33686.19, NULL),
      ('Salários', 9, 39092.5, NULL),
      ('FGTS mensal', 8, 4181.62, NULL),
      ('FGTS mensal', 9, 4094.23, NULL),
      ('INSS mensal', 8, 11583.73, NULL),
      ('INSS mensal', 9, 12000, NULL),
      ('Vale-transporte', 8, 3225.2, NULL),
      ('Vale-transporte', 9, 3312, NULL),
      ('Aluguel', 11, 6045, NULL),
      ('Aluguel', 12, 6045, NULL),
      ('Água', 8, 475.32, NULL),
      ('Água', 9, 390.85, NULL),
      ('Luz', 8, 849.27, NULL),
      ('Luz', 9, 980.18, NULL),
      ('Luz', 10, 754.5, NULL),
      ('Seguro de vida', 8, 380.12, NULL),
      ('Seguro de vida', 9, 0, NULL),
      ('Manutenção', 8, 550, NULL),
      ('Manutenção', 9, 270, NULL),
      ('Manutenção', 10, 0, NULL),
      ('Manutenção', 11, 480, NULL),
      ('Manutenção', 12, 0, NULL),
      ('Marketing', 8, 0, NULL),
      ('Marketing', 9, 0, NULL),
      ('Marketing', 10, 1040, NULL),
      ('Tarifas bancárias', 8, 192.84, NULL),
      ('Tarifas bancárias', 9, 363.89, NULL),
      ('Tarifa Pix', 8, 401.8, NULL),
      ('Tarifa Pix', 9, 0, NULL),
      ('Gás', 8, 0, NULL),
      ('Gás', 9, 470, NULL),
      ('Gás', 10, 960, NULL),
      ('FGTS rescisão', 8, 0, 'Planilha original tira esta linha do total de agosto (J43 = soma − J22 − J27): R$ 6457,71. Confirmar se foi paga com resgate da reserva.'),
      ('FGTS rescisão', 9, 3108.05, NULL),
      ('FGTS rescisão', 10, 0, NULL),
      ('Material administrativo', 8, 0, NULL),
      ('Material administrativo', 9, 0, NULL),
      ('Material administrativo', 10, 0, NULL),
      ('Avante', 8, 884.98, NULL),
      ('Avante', 9, 1965.49, NULL),
      ('Material pedagógico', 8, 4332.11, NULL),
      ('Material pedagógico', 9, 435.58, NULL),
      ('Material pedagógico', 11, 500, NULL),
      ('Material pedagógico', 12, 500, NULL),
      ('Móveis', 8, 0, NULL),
      ('Móveis', 9, 0, NULL),
      ('Móveis', 10, 0, NULL),
      ('Rescisão', 8, 0, 'Planilha original tira esta linha do total de agosto (J43 = soma − J22 − J27): R$ 15303,67. Confirmar se foi paga com resgate da reserva.'),
      ('Rescisão', 9, 12245.19, NULL),
      ('Rescisão', 10, 0, NULL),
      ('Saúde ocupacional', 8, 0, NULL),
      ('Saúde ocupacional', 9, 0, NULL),
      ('Seguro residencial', 8, 0, NULL),
      ('Seguro residencial', 9, 0, NULL),
      ('Serviço de nutrição', 8, 1442.5, NULL),
      ('Serviço de nutrição', 9, 0, NULL),
      ('Serviço pedagógico', 8, 0, NULL),
      ('Serviço pedagógico', 9, 0, NULL),
      ('Serviço pedagógico', 10, 0, NULL),
      ('Alimentação', 8, 0, NULL),
      ('Alimentação', 9, 679.04, NULL),
      ('Alimentação', 10, 0, NULL),
      ('Despesas diretas', 8, 2725.48, NULL),
      ('Despesas diretas', 9, 7965.53, NULL),
      ('Despesas diretas', 11, 2055.9, NULL),
      ('Despesas diretas', 12, 1000, NULL),
      ('Diárias', 8, 2330, NULL),
      ('Diárias', 9, 1200, NULL),
      ('Diárias', 11, 100, NULL),
      ('Diárias', 12, 200, NULL),
      ('Férias', 9, 4096.05, NULL),
      ('Férias', 10, 0, NULL),
      ('Recolhimento de débito', 8, 1316.94, NULL),
      ('Recolhimento de débito', 9, 0, NULL),
      ('IPTU', 8, 19.74, NULL),
      ('IPTU', 9, 0, NULL),
      ('Frete', 8, 0, NULL),
      ('Frete', 9, 0, NULL),
      ('Jovem aprendiz', 10, 6618.33, NULL),
      ('Jovem aprendiz', 11, 9927.49, NULL),
      ('Jovem aprendiz', 12, 9927.49, NULL),
      ('Impostos', 8, 0, NULL),
      ('Impostos', 9, 0, NULL),
      ('Impostos', 12, 20000, NULL)
    ) AS x(nome, mes, valor, obs)
    JOIN public."OSC_RUBRICA" r ON r.parceria_id = v_par AND r.nome = x.nome;

  INSERT INTO public."OSC_COMPETENCIA" (parceria_id, competencia, repasse_recebido, situacao, fonte_realizado, observacao)
  SELECT v_par, make_date(2026, m, 1), 91883.96, 'fechada', 'historico',
         'Carga inicial: realizado da planilha (demonstrativos de execução). Conferir com o Malote antes de trocar a fonte para Malote.'
    FROM generate_series(1, 7) AS m;

  INSERT INTO public."OSC_LANCAMENTO" (parceria_id, competencia, rubrica_id, tipo, valor, descricao, origem_ref, lote_importacao)
  SELECT v_par, make_date(2026, x.mes, 1), r.id, 'historico', x.valor, x.descricao, 'Planilha: ' || x.origem, v_lote
    FROM (VALUES
      (1, 'Água', 'ÁGUA', 303.66, 'MES 01!B26'),
      (1, 'Aluguel', 'ALUGUEL', 4427.46, 'MES 01!B27'),
      (1, 'Internet', 'INTERNET', 149.9, 'MES 01!B28'),
      (1, 'Luz', 'LUZ', 821.12, 'MES 01!B29'),
      (1, 'Manutenção', 'MANUTENÇÃO', 200, 'MES 01!B30'),
      (1, 'Marketing', 'MARKETING', 285, 'MES 01!B31'),
      (1, 'Manutenção', 'MANUTENÇÃO HIDRAULICA', 130, 'MES 01!B32'),
      (1, 'Salários', 'SALARIO', 28070.74, 'MES 01!B33'),
      (1, 'Tarifas bancárias', 'TARIFA', 135.2, 'MES 01!B34'),
      (1, 'Tarifa Pix', 'TARIFA PIX', 18.03, 'MES 01!B35'),
      (1, 'Vale-transporte', 'VT', 2464, 'MES 01!B36'),
      (1, 'Gás', 'GÁS', 520, 'MES 01!B37'),
      (2, 'Água', 'ÁGUA', 394.98, 'MES 02!B27'),
      (2, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 02!B28'),
      (2, 'Aplicação para férias e 13º', 'APLICAÇÃO (conta vinculada)', 15941.2, 'MES 02!B29'),
      (2, 'FGTS mensal', 'FGTS MENSAL', 3057.04, 'MES 02!B30'),
      (2, 'FGTS rescisão', 'FGTS RESCISÃO', 3225.3, 'MES 02!B31'),
      (2, 'INSS mensal', 'INSS MENSAL', 11966.62, 'MES 02!B32'),
      (2, 'Internet', 'INTERNET', 149.9, 'MES 02!B33'),
      (2, 'Luz', 'LUZ', 1298.2, 'MES 02!B34'),
      (2, 'Manutenção', 'MANUTENÇÃO', 1070, 'MES 02!B35'),
      (2, 'Material administrativo', 'MATERIAL ADM', 150, 'MES 02!B36'),
      (2, 'Avante', 'AVANTE', 1048.55, 'MES 02!B37'),
      (2, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 605.64, 'MES 02!B38'),
      (2, 'Móveis', 'MOVEIS', 480, 'MES 02!B39'),
      (2, 'Rescisão', 'RESCISÃO', 3746.7, 'MES 02!B40'),
      (2, 'Salários', 'SALARIO', 30384, 'MES 02!B41'),
      (2, 'Saúde ocupacional', 'SAUDE OCUPACIONAL', 492, 'MES 02!B42'),
      (2, 'Seguro de vida', 'SEGURO DE VIDA', 156.52, 'MES 02!B43'),
      (2, 'Seguro residencial', 'SEGURO RESIDENCIAL', 1388.56, 'MES 02!B44'),
      (2, 'Serviço de nutrição', 'SERVIÇO DE NUTRIÇÃO', 1442.7, 'MES 02!B45'),
      (2, 'Serviço pedagógico', 'SERVIÇO PEDAGOGICO', 1405.78, 'MES 02!B46'),
      (2, 'Tarifas bancárias', 'TARIFA', 67.6, 'MES 02!B47'),
      (2, 'Tarifa Pix', 'TARIFA PIX', 37.77, 'MES 02!B48'),
      (2, 'Vale-transporte', 'VT', 2380.4, 'MES 02!B49'),
      (3, 'Água', 'ÁGUA', 323.34, 'MES 03!B30'),
      (3, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 03!B31'),
      (3, 'Alimentação', 'ALIMENTAÇÃO', 1412.45, 'MES 03!B32'),
      (3, 'FGTS mensal', 'FGTS MENSAL', 3432.16, 'MES 03!B33'),
      (3, 'FGTS rescisão', 'FGTS RESCISÃO', 1149.46, 'MES 03!B34'),
      (3, 'INSS mensal', 'INSS MENSAL', 12951.47, 'MES 03!B35'),
      (3, 'Internet', 'INTERNET', 149.9, 'MES 03!B36'),
      (3, 'Aplicação para férias e 13º', 'APLICAÇÃO (conta vinculada jan/mar)', 28600, 'MES 03!B37'),
      (3, 'Despesas diretas', 'DESPESAS DIRETAS', 4263.73, 'MES 03!B38'),
      (3, 'Diárias', 'DIARIA', 2000, 'MES 03!B39'),
      (3, 'Luz', 'LUZ', 1230.9, 'MES 03!B40'),
      (3, 'Férias', 'FÉRIAS', 3347.19, 'MES 03!B41'),
      (3, 'Manutenção', 'MANUTENÇÃO', 3230, 'MES 03!B42'),
      (3, 'Recolhimento de débito', 'RECOLHIMENTO DE DEBITO', 678.23, 'MES 03!B43'),
      (3, 'Avante', 'AVANTE', 1199.95, 'MES 03!B44'),
      (3, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 370, 'MES 03!B45'),
      (3, 'Rescisão', 'RESCISÃO', 7386.26, 'MES 03!B46'),
      (3, 'Salários', 'SALARIO', 28573.73, 'MES 03!B47'),
      (3, 'Seguro residencial', 'SEGURO RESIDENCIAL', 1388.56, 'MES 03!B48'),
      (3, 'Tarifas bancárias', 'TARIFA', 67.6, 'MES 03!B49'),
      (3, 'Tarifa Pix', 'TARIFA PIX', 89.66, 'MES 03!B50'),
      (3, 'Vale-transporte', 'VT', 2844.4, 'MES 03!B51'),
      (4, 'Água', 'ÁGUA', 456.41, 'MES 04!B24'),
      (4, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 04!B25'),
      (4, 'FGTS mensal', 'FGTS MENSAL', 3200.95, 'MES 04!B27'),
      (4, 'FGTS rescisão', 'FGTS RESCISÃO', 301.81, 'MES 04!B28'),
      (4, 'INSS mensal', 'INSS MENSAL', 13327.52, 'MES 04!B29'),
      (4, 'Internet', 'INTERNET', 149.9, 'MES 04!B30'),
      (4, 'Aplicação para férias e 13º', 'APLICAÇÃO', 14300, 'MES 04!B31'),
      (4, 'Despesas diretas', 'DESPESAS DIRETAS', 2386.46, 'MES 04!B32'),
      (4, 'Diárias', 'DIARIA', 100, 'MES 04!B33'),
      (4, 'Luz', 'LUZ', 1410.5, 'MES 04!B34'),
      (4, 'Manutenção', 'MANUTENÇÃO', 780, 'MES 04!B35'),
      (4, 'Avante', 'AVANTE', 1200, 'MES 04!B36'),
      (4, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 2085.07, 'MES 04!B37'),
      (4, 'Serviço de nutrição', 'NUTRIÇÃO', 1442.7, 'MES 04!B38'),
      (4, 'Rescisão', 'RESCISÃO', 1023.39, 'MES 04!B39'),
      (4, 'Salários', 'SALARIO', 32023.49, 'MES 04!B40'),
      (4, 'Seguro residencial', 'SEGURO RESIDENCIAL', 1388.56, 'MES 04!B41'),
      (4, 'Tarifas bancárias', 'TARIFA', 67.6, 'MES 04!B42'),
      (4, 'Tarifa Pix', 'TARIFA PIX', 6.42, 'MES 04!B43'),
      (4, 'Vale-transporte', 'VT', 2690, 'MES 04!B44'),
      (5, 'Água', 'ÁGUA', 476.82, 'MES 05!B28'),
      (5, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 05!B29'),
      (5, 'FGTS mensal', 'FGTS MENSAL', 3429.27, 'MES 05!B31'),
      (5, 'IPTU', 'IPTU', 1343.3, 'MES 05!B32'),
      (5, 'INSS mensal', 'INSS MENSAL', 12932.33, 'MES 05!B33'),
      (5, 'Internet', 'INTERNET', 149.9, 'MES 05!B34'),
      (5, 'Aplicação para férias e 13º', 'APLICAÇÃO', 14300, 'MES 05!B35'),
      (5, 'Despesas diretas', 'DESPESAS DIRETAS', 8125.37, 'MES 05!B36'),
      (5, 'Diárias', 'DIARIA', 500, 'MES 05!B37'),
      (5, 'Luz', 'LUZ', 934.62, 'MES 05!B38'),
      (5, 'Manutenção', 'MANUTENÇÃO', 5916.44, 'MES 05!B39'),
      (5, 'Avante', 'AVANTE', 1200, 'MES 05!B40'),
      (5, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 301.39, 'MES 05!B41'),
      (5, 'Serviço de nutrição', 'NUTRIÇÃO', 721.35, 'MES 05!B42'),
      (5, 'Seguro de vida', 'SEGURO DE VIDA', 178.88, 'MES 05!B43'),
      (5, 'Salários', 'SALARIO', 32360.66, 'MES 05!B44'),
      (5, 'Seguro residencial', 'SEGURO RESIDENCIAL', 1388.61, 'MES 05!B45'),
      (5, 'Tarifas bancárias', 'TARIFA', 182.84, 'MES 05!B46'),
      (5, 'Vale-transporte', 'VT', 2788, 'MES 05!B47'),
      (6, 'Água', 'ÁGUA', 496.14, 'MES 06!B27'),
      (6, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 06!B28'),
      (6, 'Alimentação', 'ALIMENTAÇÃO', 421.75, 'MES 06!B29'),
      (6, 'FGTS mensal', 'FGTS MENSAL', 3465.52, 'MES 06!B30'),
      (6, 'INSS mensal', 'INSS MENSAL', 12345.11, 'MES 06!B32'),
      (6, 'Internet', 'INTERNET', 149.9, 'MES 06!B33'),
      (6, 'IPTU', 'IPTU', 658.47, 'MES 06!B34'),
      (6, 'Aplicação para férias e 13º', 'APLICAÇÃO', 14300, 'MES 06!B35'),
      (6, 'Despesas diretas', 'DESPESAS DIRETAS', 5882.26, 'MES 06!B36'),
      (6, 'Diárias', 'DIARIA', 150, 'MES 06!B37'),
      (6, 'Luz', 'LUZ', 659.13, 'MES 06!B38'),
      (6, 'Avante', 'AVANTE', 1200, 'MES 06!B40'),
      (6, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 321.84, 'MES 06!B41'),
      (6, 'Serviço de nutrição', 'NUTRIÇÃO', 721.35, 'MES 06!B42'),
      (6, 'Salários', 'SALARIO', 36907.57, 'MES 06!B44'),
      (6, 'Seguro de vida', 'SEGURO DE VIDA', 167.7, 'MES 06!B45'),
      (6, 'Tarifas bancárias', 'TARIFA', 169, 'MES 06!B47'),
      (6, 'Frete', 'FRETE', 68.95, 'MES 06!B48'),
      (6, 'Vale-transporte', 'VT', 3510.8, 'MES 06!B49'),
      (7, 'Água', 'ÁGUA', 425.09, 'MES 07!B26'),
      (7, 'Aluguel', 'ALUGUEL', 5113.73, 'MES 07!B27'),
      (7, 'FGTS mensal', 'FGTS MENSAL', 4248.05, 'MES 07!B29'),
      (7, 'INSS mensal', 'INSS MENSAL', 10886.36, 'MES 07!B30'),
      (7, 'Internet', 'INTERNET', 149.9, 'MES 07!B31'),
      (7, 'Aplicação para férias e 13º', 'APLICAÇÃO', 14300, 'MES 07!B32'),
      (7, 'Despesas diretas', 'DESPESAS DIRETAS', 5049.45, 'MES 07!B33'),
      (7, 'Diárias', 'DIARIA', 1200, 'MES 07!B34'),
      (7, 'Luz', 'LUZ', 1035.74, 'MES 07!B35'),
      (7, 'Manutenção', 'MANUTENÇÃO', 200, 'MES 07!B36'),
      (7, 'Material pedagógico', 'MATERIAL PEDAGOGICO', 4396.43, 'MES 07!B37'),
      (7, 'Seguro de vida', 'SEGURO DE VIDA', 167.7, 'MES 07!B38'),
      (7, 'Férias', 'FÉRIAS', 4096.05, 'MES 07!B39'),
      (7, 'Salários', 'SALARIO', 37087.6, 'MES 07!B40'),
      (7, 'Impostos', 'IMPOSTOS', 4123.63, 'MES 07!B41'),
      (7, 'Gás', 'GÁS', 745, 'MES 07!B42'),
      (7, 'Vale-transporte', 'VT', 3528, 'MES 07!B43')
    ) AS x(mes, nome, descricao, valor, origem)
    JOIN public."OSC_RUBRICA" r ON r.parceria_id = v_par AND r.nome = x.nome;

  -- De-para inicial por nome: "descrição original" da planilha (ou o nome
  -- da rubrica) igual ao nome da classificação do Malote, ignorando
  -- acento/caixa. O que não casar fica como "Sem rubrica" na tela.
  INSERT INTO public."OSC_RUBRICA_CLASSIFICACAO" (parceria_id, classificacao_id, rubrica_id)
  SELECT DISTINCT ON (c.id) v_par, c.id, r.id
    FROM (VALUES
      ('ÁGUA', 'Água'),
      ('ALUGUEL', 'Aluguel'),
      ('INTERNET', 'Internet'),
      ('LUZ', 'Luz'),
      ('MANUTENÇÃO', 'Manutenção'),
      ('MARKETING', 'Marketing'),
      ('MANUTENÇÃO HIDRAULICA', 'Manutenção'),
      ('SALARIO', 'Salários'),
      ('TARIFA', 'Tarifas bancárias'),
      ('TARIFA PIX', 'Tarifa Pix'),
      ('VT', 'Vale-transporte'),
      ('GÁS', 'Gás'),
      ('APLICAÇÃO (conta vinculada)', 'Aplicação para férias e 13º'),
      ('FGTS MENSAL', 'FGTS mensal'),
      ('FGTS RESCISÃO', 'FGTS rescisão'),
      ('INSS MENSAL', 'INSS mensal'),
      ('MATERIAL ADM', 'Material administrativo'),
      ('AVANTE', 'Avante'),
      ('MATERIAL PEDAGOGICO', 'Material pedagógico'),
      ('MOVEIS', 'Móveis'),
      ('RESCISÃO', 'Rescisão'),
      ('SAUDE OCUPACIONAL', 'Saúde ocupacional'),
      ('SEGURO DE VIDA', 'Seguro de vida'),
      ('SEGURO RESIDENCIAL', 'Seguro residencial'),
      ('SERVIÇO DE NUTRIÇÃO', 'Serviço de nutrição'),
      ('SERVIÇO PEDAGOGICO', 'Serviço pedagógico'),
      ('ALIMENTAÇÃO', 'Alimentação'),
      ('APLICAÇÃO (conta vinculada jan/mar)', 'Aplicação para férias e 13º'),
      ('DESPESAS DIRETAS', 'Despesas diretas'),
      ('DIARIA', 'Diárias'),
      ('FÉRIAS', 'Férias'),
      ('RECOLHIMENTO DE DEBITO', 'Recolhimento de débito'),
      ('APLICAÇÃO', 'Aplicação para férias e 13º'),
      ('NUTRIÇÃO', 'Serviço de nutrição'),
      ('IPTU', 'IPTU'),
      ('FRETE', 'Frete'),
      ('IMPOSTOS', 'Impostos')
    ) AS x(descricao_original, nome)
    JOIN public."OSC_RUBRICA" r ON r.parceria_id = v_par AND r.nome = x.nome
    JOIN public.planejamento_orcamentario_classificacao c
      ON public.osc_normalizar(c.nome) IN (public.osc_normalizar(x.descricao_original), public.osc_normalizar(x.nome))
   ORDER BY c.id, (public.osc_normalizar(c.nome) = public.osc_normalizar(x.descricao_original)) DESC
  ON CONFLICT (parceria_id, classificacao_id) DO NOTHING;
END $$;

-- ── 5. Trilha de alterações ──────────────────────────────────────────────
-- Criada DEPOIS da carga inicial de propósito (não polui a trilha com as
-- ~300 linhas da planilha; a carga fica registrada pelo lote_importacao).
CREATE OR REPLACE FUNCTION public.osc_auditar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_antes jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_depois jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_ref jsonb := COALESCE(v_depois, v_antes);
  v_nome text;
BEGIN
  IF TG_OP = 'UPDATE' AND (v_antes - 'updated_at' - 'updated_by') = (v_depois - 'updated_at' - 'updated_by') THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."OSC_HISTORICO" (parceria_id, tabela, registro_id, acao, antes, depois, usuario_id, usuario_nome)
  VALUES (
    COALESCE((v_ref->>'parceria_id')::uuid, CASE WHEN TG_TABLE_NAME = 'OSC_PARCERIA' THEN (v_ref->>'id')::uuid END),
    TG_TABLE_NAME, (v_ref->>'id')::uuid, TG_OP, v_antes, v_depois, auth.uid(), v_nome);
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.osc_auditar() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['OSC_PARCERIA','OSC_ANO','OSC_RUBRICA','OSC_RUBRICA_CLASSIFICACAO','OSC_COMPETENCIA',
                           'OSC_PREVISAO','OSC_PREVISAO_MES','OSC_LANCAMENTO','OSC_PAGAMENTO_AJUSTE','OSC_PROJETO'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS osc_auditar_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER osc_auditar_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.osc_auditar()', t);
  END LOOP;
END $$;

-- ── 6. RPCs ──────────────────────────────────────────────────────────────
-- 6a. Pagamentos do Malote da OSC no ano (por competência efetiva).
-- Agrega as linhas da view por despesa+parcela+contrato+classificação (o
-- rateio por integrante não interessa aqui). A chave de revisão é
-- despesa+parcela+classificação de origem.
CREATE OR REPLACE FUNCTION public.osc_pagamentos_malote(_parceria_id uuid, _ano int)
RETURNS TABLE (
  chave text,
  despesa_id uuid,
  id_malote text,
  numero_parcela int,
  data_pagamento date,
  competencia_malote date,
  competencia date,
  contrato_nome text,
  classificacao_id uuid,
  classificacao_nome text,
  descricao text,
  fornecedor text,
  forma_pagamento text,
  valor numeric,
  rubrica_id uuid,
  rubrica_origem text,
  ajuste_id uuid,
  ajuste_motivo text,
  ajuste_em timestamptz,
  ajuste_por text,
  ignorado boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  p record;
  v_ids uuid[];
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver a gestão financeira da OSC.';
  END IF;
  SELECT * INTO p FROM public."OSC_PARCERIA" WHERE id = _parceria_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parceria não encontrada.';
  END IF;
  IF p.empresa_id IS NULL THEN
    RETURN;
  END IF;

  -- Pré-filtro por despesa_id (chave de partição das janelas da view): o
  -- Postgres empurra o filtro para dentro da view em vez de montar o Malote
  -- inteiro e filtrar depois.
  v_ids := ARRAY(
    SELECT d.id FROM public.malote_despesa d WHERE d.empresa_id = p.empresa_id
    UNION
    SELECT rl.despesa_id FROM public.malote_despesa_rateio_linha rl WHERE rl.empresa_id = p.empresa_id
    UNION
    SELECT aj.despesa_id FROM public.financeiro_fluxo_caixa_ajuste aj
     WHERE aj.origem = 'malote' AND aj.empresa_id = p.empresa_id
  );

  RETURN QUERY
  WITH v AS (
    SELECT f.despesa_id,
           f.id_malote::text AS id_malote,
           f.numero_parcela::int AS numero_parcela,
           f.data_pagamento::date AS data_pagamento,
           date_trunc('month', COALESCE(f.competencia::date, f.data_pagamento::date))::date AS comp,
           f.contrato_nome::text AS contrato_nome,
           f.classificacao_id,
           f.classificacao_nome::text AS classificacao_nome,
           f.descricao::text AS descricao,
           f.forma_pagamento::text AS forma_pagamento,
           sum(CASE WHEN f.tipo = 'entrada' THEN -f.valor ELSE f.valor END)::numeric AS valor
      FROM public.v_malote_pagamento_fluxo_caixa f
     WHERE f.despesa_id = ANY(v_ids)
       AND f.empresa_id = p.empresa_id
       AND (p.contrato_ids IS NULL OR cardinality(p.contrato_ids) = 0 OR f.contrato_id = ANY(p.contrato_ids))
     GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
  ), r AS (
    SELECT v.*,
           a.id AS a_id, a.rubrica_id AS a_rubrica, a.competencia AS a_comp, a.ignorar AS a_ignorar,
           a.motivo AS a_motivo, a.updated_at AS a_em,
           (SELECT COALESCE(pr.display_name, pr.email) FROM public.profiles pr WHERE pr.id = a.updated_by) AS a_por,
           dp.rubrica_id AS dp_rubrica
      FROM v
      LEFT JOIN public."OSC_PAGAMENTO_AJUSTE" a
        ON a.parceria_id = _parceria_id AND a.despesa_id = v.despesa_id
       AND a.numero_parcela = COALESCE(v.numero_parcela, 0)
       AND a.classificacao_id_origem IS NOT DISTINCT FROM v.classificacao_id
      LEFT JOIN public."OSC_RUBRICA_CLASSIFICACAO" dp
        ON dp.parceria_id = _parceria_id AND dp.classificacao_id = v.classificacao_id
  )
  SELECT concat_ws(':', r.despesa_id::text, COALESCE(r.numero_parcela, 0)::text,
                   COALESCE(r.classificacao_id::text, '-'), COALESCE(r.contrato_nome, '-')),
         r.despesa_id, r.id_malote, r.numero_parcela, r.data_pagamento, r.comp,
         COALESCE(r.a_comp, r.comp),
         r.contrato_nome, r.classificacao_id, r.classificacao_nome, r.descricao,
         (SELECT string_agg(DISTINCT COALESCE(fo.nome_fantasia, fo.razao_social), ', ')
            FROM public.malote_despesa_rateio_linha rl
            JOIN public.fornecedor fo ON fo.id = rl.fornecedor_id
           WHERE rl.despesa_id = r.despesa_id),
         r.forma_pagamento, round(r.valor, 2),
         COALESCE(r.a_rubrica, r.dp_rubrica),
         CASE WHEN r.a_rubrica IS NOT NULL THEN 'reclassificado'
              WHEN r.dp_rubrica IS NOT NULL THEN 'de_para' END,
         r.a_id, r.a_motivo, r.a_em, r.a_por,
         COALESCE(r.a_ignorar, false)
    FROM r
   WHERE EXTRACT(YEAR FROM COALESCE(r.a_comp, r.comp)) = _ano;
END;
$$;
REVOKE ALL ON FUNCTION public.osc_pagamentos_malote(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_pagamentos_malote(uuid, int) TO authenticated;

-- 6b. Malote da OSC aprovado e ainda NÃO pago (empenhado/comprometido).
-- Só informativo no painel — não entra no saldo (o pago entra quando for
-- pago). Usa a empresa da despesa (rateio para outra empresa não entra).
CREATE OR REPLACE FUNCTION public.osc_malote_comprometido(_parceria_id uuid)
RETURNS TABLE (
  despesa_id uuid,
  id_malote text,
  descricao text,
  status text,
  competencia date,
  classificacao_id uuid,
  classificacao_nome text,
  valor numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  p record;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver a gestão financeira da OSC.';
  END IF;
  SELECT * INTO p FROM public."OSC_PARCERIA" WHERE id = _parceria_id;
  IF NOT FOUND OR p.empresa_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT d.id, d.numero::text, d.nome::text, d.status::text,
         date_trunc('month', d.competencia::date)::date,
         d.classificacao_id, cl.nome::text,
         round(COALESCE(d.valor_aprovado, d.valor_total, 0)::numeric, 2)
    FROM public.malote_despesa d
    LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
   WHERE d.empresa_id = p.empresa_id
     AND d.deleted_at IS NULL
     AND d.status IN ('pendente_aprovacao','aguardando_pagamento','pronto_para_pagar','ajuste_pagamento')
     AND (p.contrato_ids IS NULL OR cardinality(p.contrato_ids) = 0 OR d.contrato_id = ANY(p.contrato_ids));
END;
$$;
REVOKE ALL ON FUNCTION public.osc_malote_comprometido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_malote_comprometido(uuid) TO authenticated;

-- 6c. Revisar a classificação de um pagamento do Malote (rubrica,
-- competência ou "não é da OSC"). Motivo obrigatório; quem/quando ficam no
-- registro e na trilha. Não altera nada no Malote.
CREATE OR REPLACE FUNCTION public.osc_reclassificar_pagamento(
  _parceria_id uuid,
  _despesa_id uuid,
  _numero_parcela int,
  _classificacao_id uuid,
  _rubrica_id uuid,
  _competencia date,
  _ignorar boolean,
  _motivo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_parcela int := COALESCE(_numero_parcela, 0);
  v_comp date := CASE WHEN _competencia IS NULL THEN NULL ELSE date_trunc('month', _competencia)::date END;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para reclassificar pagamentos.';
  END IF;
  IF length(btrim(COALESCE(_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo da revisão (mínimo 5 caracteres).';
  END IF;
  IF _rubrica_id IS NULL AND v_comp IS NULL AND NOT COALESCE(_ignorar, false) THEN
    RAISE EXCEPTION 'Nada para revisar: escolha rubrica, competência ou marque "não é da OSC".';
  END IF;
  IF _rubrica_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public."OSC_RUBRICA" WHERE id = _rubrica_id AND parceria_id = _parceria_id) THEN
    RAISE EXCEPTION 'Rubrica não pertence a esta parceria.';
  END IF;
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar') AND EXISTS (
       SELECT 1 FROM public."OSC_COMPETENCIA" c
        WHERE c.parceria_id = _parceria_id AND c.situacao = 'fechada' AND c.competencia = v_comp) THEN
    RAISE EXCEPTION 'Competência de destino fechada: exige a permissão "aprovar".';
  END IF;

  SELECT id INTO v_id FROM public."OSC_PAGAMENTO_AJUSTE"
   WHERE parceria_id = _parceria_id AND despesa_id = _despesa_id AND numero_parcela = v_parcela
     AND classificacao_id_origem IS NOT DISTINCT FROM _classificacao_id
   FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public."OSC_PAGAMENTO_AJUSTE"
      (parceria_id, despesa_id, numero_parcela, classificacao_id_origem, rubrica_id, competencia, ignorar, motivo)
    VALUES (_parceria_id, _despesa_id, v_parcela, _classificacao_id, _rubrica_id, v_comp, COALESCE(_ignorar, false), btrim(_motivo))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."OSC_PAGAMENTO_AJUSTE"
       SET rubrica_id = _rubrica_id, competencia = v_comp, ignorar = COALESCE(_ignorar, false),
           motivo = btrim(_motivo), updated_by = auth.uid()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.osc_reclassificar_pagamento(uuid, uuid, int, uuid, uuid, date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_reclassificar_pagamento(uuid, uuid, int, uuid, uuid, date, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.osc_desfazer_reclassificacao(_ajuste_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para reclassificar pagamentos.';
  END IF;
  DELETE FROM public."OSC_PAGAMENTO_AJUSTE" WHERE id = _ajuste_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revisão não encontrada.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.osc_desfazer_reclassificacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_desfazer_reclassificacao(uuid) TO authenticated;

-- 6d'. Fechar/reabrir competência — basta 'aprovar' (a tabela pede
-- 'alterar' na policy; aqui é o atalho de quem só aprova).
CREATE OR REPLACE FUNCTION public.osc_definir_situacao(_parceria_id uuid, _competencia date, _situacao text, _observacao text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp date := date_trunc('month', _competencia)::date;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar') THEN
    RAISE EXCEPTION 'Fechar/reabrir competência exige a permissão "aprovar".';
  END IF;
  IF _situacao NOT IN ('aberta','fechada') THEN
    RAISE EXCEPTION 'Situação inválida.';
  END IF;
  INSERT INTO public."OSC_COMPETENCIA" (parceria_id, competencia, situacao, observacao)
  VALUES (_parceria_id, v_comp, _situacao, NULLIF(btrim(COALESCE(_observacao, '')), ''))
  ON CONFLICT (parceria_id, competencia) DO UPDATE
     SET situacao = EXCLUDED.situacao,
         observacao = COALESCE(EXCLUDED.observacao, "OSC_COMPETENCIA".observacao);
END;
$$;
REVOKE ALL ON FUNCTION public.osc_definir_situacao(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_definir_situacao(uuid, date, text, text) TO authenticated;

-- 6d. Importar histórico (planilha) — substitui SÓ os lançamentos
-- 'historico' dos meses importados; nunca toca Malote, ajustes ou resgates.
-- _linhas: [{"competencia":"2026-01-01","rubrica":"Água","descricao":"ÁGUA","valor":303.66,"origem":"MES 01!B26"}]
CREATE OR REPLACE FUNCTION public.osc_importar_historico(
  _parceria_id uuid,
  _linhas jsonb,
  _usar_como_realizado boolean DEFAULT true,
  _criar_rubricas boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lote uuid := gen_random_uuid();
  v_meses date[];
  v_faltando text[];
  v_qtd int;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'incluir')
          AND public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'alterar')) THEN
    RAISE EXCEPTION 'Importar exige as permissões "incluir" e "alterar".';
  END IF;
  IF jsonb_typeof(_linhas) <> 'array' OR jsonb_array_length(_linhas) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha para importar.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS osc_tmp_import (
    competencia date, rubrica text, descricao text, valor numeric, origem text
  ) ON COMMIT DROP;
  DELETE FROM osc_tmp_import;
  INSERT INTO osc_tmp_import
  SELECT date_trunc('month', (l->>'competencia')::date)::date,
         btrim(l->>'rubrica'), NULLIF(btrim(l->>'descricao'), ''),
         round((l->>'valor')::numeric, 2), NULLIF(btrim(l->>'origem'), '')
    FROM jsonb_array_elements(_linhas) l;
  DELETE FROM osc_tmp_import WHERE valor IS NULL OR valor = 0;

  IF EXISTS (SELECT 1 FROM osc_tmp_import WHERE competencia IS NULL OR COALESCE(rubrica, '') = '' OR valor < 0) THEN
    RAISE EXCEPTION 'Há linhas sem competência, sem rubrica ou com valor negativo.';
  END IF;

  SELECT array_agg(DISTINCT t.rubrica) INTO v_faltando
    FROM osc_tmp_import t
   WHERE NOT EXISTS (SELECT 1 FROM public."OSC_RUBRICA" r
                      WHERE r.parceria_id = _parceria_id AND public.osc_normalizar(r.nome) = public.osc_normalizar(t.rubrica));
  IF v_faltando IS NOT NULL THEN
    IF NOT _criar_rubricas THEN
      RAISE EXCEPTION 'Rubricas não cadastradas: %', array_to_string(v_faltando, ', ');
    END IF;
    INSERT INTO public."OSC_RUBRICA" (parceria_id, nome, grupo, tipo, ordem)
    SELECT _parceria_id, f, 'outros', 'despesa', 900 FROM unnest(v_faltando) f
    ON CONFLICT (parceria_id, nome) DO NOTHING;
  END IF;

  SELECT array_agg(DISTINCT competencia) INTO v_meses FROM osc_tmp_import;

  IF NOT public.has_screen_access(auth.uid(), 'financeiro-osc-canaa', 'aprovar') AND EXISTS (
       SELECT 1 FROM public."OSC_COMPETENCIA" c
        WHERE c.parceria_id = _parceria_id AND c.situacao = 'fechada' AND c.competencia = ANY(v_meses)) THEN
    RAISE EXCEPTION 'Há competência fechada entre os meses importados: exige a permissão "aprovar".';
  END IF;

  DELETE FROM public."OSC_LANCAMENTO"
   WHERE parceria_id = _parceria_id AND tipo = 'historico' AND competencia = ANY(v_meses);

  INSERT INTO public."OSC_LANCAMENTO" (parceria_id, competencia, rubrica_id, tipo, valor, descricao, origem_ref, lote_importacao)
  SELECT _parceria_id, t.competencia, r.id, 'historico', t.valor, t.descricao, t.origem, v_lote
    FROM osc_tmp_import t
    JOIN LATERAL (SELECT r.id FROM public."OSC_RUBRICA" r
                   WHERE r.parceria_id = _parceria_id AND public.osc_normalizar(r.nome) = public.osc_normalizar(t.rubrica)
                   LIMIT 1) r ON true;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;

  IF _usar_como_realizado THEN
    INSERT INTO public."OSC_COMPETENCIA" (parceria_id, competencia, fonte_realizado)
    SELECT _parceria_id, m, 'historico' FROM unnest(v_meses) m
    ON CONFLICT (parceria_id, competencia) DO UPDATE SET fonte_realizado = 'historico';
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'linhas', v_qtd, 'meses', to_jsonb(v_meses));
END;
$$;
REVOKE ALL ON FUNCTION public.osc_importar_historico(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.osc_importar_historico(uuid, jsonb, boolean, boolean) TO authenticated;

-- ── 7. RLS ───────────────────────────────────────────────────────────────
-- Leitura: quem vê a tela. Premissas/rubricas/de-para/competência:
-- 'alterar' (competência fechada ainda passa pela guarda de 'aprovar').
-- Lançamentos e projetos: incluir/alterar/excluir. Revisão de pagamento e
-- trilha: só leitura (escrita pelas RPCs/trigger).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['OSC_PARCERIA','OSC_ANO','OSC_RUBRICA','OSC_RUBRICA_CLASSIFICACAO','OSC_COMPETENCIA',
                           'OSC_PREVISAO','OSC_PREVISAO_MES','OSC_LANCAMENTO','OSC_PAGAMENTO_AJUSTE','OSC_PROJETO',
                           'OSC_HISTORICO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS osc_select ON public.%I', t);
    EXECUTE format('CREATE POLICY osc_select ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L)))',
                   t, 'financeiro-osc-canaa', 'visualizar');
  END LOOP;

  FOREACH t IN ARRAY ARRAY['OSC_PARCERIA','OSC_ANO','OSC_RUBRICA','OSC_RUBRICA_CLASSIFICACAO','OSC_COMPETENCIA',
                           'OSC_PREVISAO','OSC_PREVISAO_MES'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS osc_gerenciar ON public.%I', t);
    EXECUTE format('CREATE POLICY osc_gerenciar ON public.%I FOR ALL TO authenticated USING ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L))) WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L)))',
                   t, 'financeiro-osc-canaa', 'alterar', 'financeiro-osc-canaa', 'alterar');
  END LOOP;

  FOREACH t IN ARRAY ARRAY['OSC_LANCAMENTO','OSC_PROJETO'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS osc_incluir ON public.%I', t);
    EXECUTE format('CREATE POLICY osc_incluir ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L)))',
                   t, 'financeiro-osc-canaa', 'incluir');
    EXECUTE format('DROP POLICY IF EXISTS osc_alterar ON public.%I', t);
    EXECUTE format('CREATE POLICY osc_alterar ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L))) WITH CHECK ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L)))',
                   t, 'financeiro-osc-canaa', 'alterar', 'financeiro-osc-canaa', 'alterar');
    EXECUTE format('DROP POLICY IF EXISTS osc_excluir ON public.%I', t);
    EXECUTE format('CREATE POLICY osc_excluir ON public.%I FOR DELETE TO authenticated USING ((SELECT public.has_screen_access((SELECT auth.uid()), %L, %L)))',
                   t, 'financeiro-osc-canaa', 'excluir');
  END LOOP;
END $$;

-- ── 8. Menu + acesso ─────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'financeiro-osc-canaa', 'Financeiro — OSC Canaã (Gestão Financeira da Escola)', '/app/financeiro/osc-canaa', 41
  FROM public.app_modulo m
 WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('financeiro-osc-canaa', 'incluir'),
  ('financeiro-osc-canaa', 'alterar'),
  ('financeiro-osc-canaa', 'excluir'),
  ('financeiro-osc-canaa', 'aprovar'),
  ('financeiro-osc-canaa', 'exportar')
ON CONFLICT DO NOTHING;

-- Sem semear permissão: desde 20261008000006 tela nova nasce sem ninguém
-- (nem o "concede tudo") e é liberada por pessoa em Administração › Acesso
-- por Usuário.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'financeiro-osc-canaa';
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro-osc-canaa';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'financeiro-osc-canaa';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro-osc-canaa';
--   DROP FUNCTION IF EXISTS public.osc_importar_historico(uuid, jsonb, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.osc_definir_situacao(uuid, date, text, text);
--   DROP FUNCTION IF EXISTS public.osc_desfazer_reclassificacao(uuid);
--   DROP FUNCTION IF EXISTS public.osc_reclassificar_pagamento(uuid, uuid, int, uuid, uuid, date, boolean, text);
--   DROP FUNCTION IF EXISTS public.osc_malote_comprometido(uuid);
--   DROP FUNCTION IF EXISTS public.osc_pagamentos_malote(uuid, int);
--   DROP TABLE IF EXISTS public."OSC_HISTORICO", public."OSC_PROJETO", public."OSC_PAGAMENTO_AJUSTE",
--     public."OSC_LANCAMENTO", public."OSC_PREVISAO_MES", public."OSC_PREVISAO", public."OSC_COMPETENCIA",
--     public."OSC_RUBRICA_CLASSIFICACAO", public."OSC_RUBRICA", public."OSC_ANO", public."OSC_PARCERIA";
--   DROP FUNCTION IF EXISTS public.osc_auditar();
--   DROP FUNCTION IF EXISTS public.osc_projeto_guard();
--   DROP FUNCTION IF EXISTS public.osc_lancamento_guard();
--   DROP FUNCTION IF EXISTS public.osc_competencia_guard();
--   DROP FUNCTION IF EXISTS public.osc_normalizar(text);
-- =====================================================================
