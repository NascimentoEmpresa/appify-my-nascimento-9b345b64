-- ============================================================================
-- SIS-2026-0599 — Base Mestre de Início de Contrato e os 4 resumos setoriais
--
-- O chamado veio com 6 telas desenhadas e 2 planilhas. Os números batem entre
-- as seis telas (170 postos, 177 colaboradores, 101 locais, 22 cidades,
-- R$ 802.699,72/mês), o que diz o essencial do desenho: NÃO são seis telas com
-- dados próprios, é UMA base com cinco recortes de leitura. Por isso aqui
-- nascem 6 tabelas de base e nenhuma tabela por setor — Financeiro, RH,
-- Operacional e Compras leem destas, por RPC, cada uma com o seu menu.
--
-- DE ONDE VEM O DADO (decidido com o Eduardo em 15/10/2026):
-- a tela abre lendo o que está GRAVADO aqui (consulta leve, sem recalcular), e
-- o botão "Atualizar da base" chama implantacao_base_semear() pra repuxar de
-- contratos / planilha_custo / sup_posto / sup_funcao_item. Não é "ao vivo a
-- cada F5" de propósito: a instância é Small e já caiu 3x por CPU/conexão/
-- memória (23/09/2026). E não é congelado pra sempre: o botão existe.
--
-- QUANTIDADE DO ENXOVAL: sup_funcao_item ganha `quantidade`. O catálogo já
-- sabe QUE a função LIMPEZA usa avental, luva e máscara (11.810 vínculos), mas
-- não sabia QUANTOS — isso só existia na planilha do Yuri. Como sup_funcao
-- pendura em sup_posto, que tem contrato_id, a quantidade já é por contrato:
-- não há conflito entre dois contratos que usem o mesmo nome de função.
-- Conferido antes de alterar: o frontend lê sup_funcao_item com lista
-- explícita de colunas (useSupCatalogo.ts:234) e insere com colunas
-- explícitas, então a coluna nova é invisível para o Catálogo do Suprimentos.
--
-- Idempotente. NÃO se auto-aplica: rodar no SQL Editor do projeto remoto.
-- ============================================================================

-- DDL em tabela com tráfego vivo entra na fila e barra leitura do ERP enquanto
-- espera (63s já travaram duas telas aqui). Melhor falhar rápido e repetir.
SET lock_timeout = '5s';

-- ── 1) Quantidade no enxoval do catálogo ────────────────────────────────────
ALTER TABLE public.sup_funcao_item
  ADD COLUMN IF NOT EXISTS quantidade numeric(10,2);

COMMENT ON COLUMN public.sup_funcao_item.quantidade IS
  'Quantas peças deste item a função recebe (ex. 2 aventais, 5 máscaras). '
  'Nasceu em SIS-2026-0599, preenchida pela Base Mestre de Início de Contrato. '
  'Nula = quantidade ainda não declarada; o catálogo do Suprimentos não exibe '
  'esta coluna, e nenhuma tela dele seleciona *.';

-- ── 2) Menus ────────────────────────────────────────────────────────────────
-- Tela nova nasce FECHADA desde a mig 20261008000006 (o "concede tudo" não
-- alcança). Semeia-se a partir de quem já tem `licitacoes.implantacao`: é o
-- time que faz implantação hoje. Os setores (Financeiro, RH, Operacional,
-- Compras) entram pelo painel Acesso por Usuário, um a um — não se abre um
-- módulo inteiro por tabela nova.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem, true
  FROM (VALUES
    ('licitacoes',  'implantacao.base',            'Base Mestre de Contrato', '/app/licitacoes/implantacao/base',  31),
    ('financeiro',  'financeiro.inicio_contrato',  'Início de Contrato',      '/app/financeiro/inicio-de-contrato', 90),
    ('rh',          'rh.inicio_contrato',          'Início de Contrato',      '/app/rh/inicio-de-contrato',         90),
    ('operacional', 'operacional.inicio_contrato', 'Início de Contrato',      '/app/operacional/inicio-de-contrato',90),
    ('suprimentos', 'suprimentos.inicio_contrato', 'Início de Contrato',      '/app/suprimentos/inicio-de-contrato',90)
  ) AS v(modulo, codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = v.modulo
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow)
SELECT s.user_id, v.codigo, s.acao, true
  FROM public.screen_permission_user s
  CROSS JOIN (VALUES ('implantacao.base'), ('financeiro.inicio_contrato'), ('rh.inicio_contrato'),
                     ('operacional.inicio_contrato'), ('suprimentos.inicio_contrato')) AS v(codigo)
 WHERE s.menu_codigo = 'licitacoes.implantacao' AND s.allow
   AND s.acao IN ('visualizar', 'incluir', 'alterar', 'excluir')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, v.codigo, p.acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
  CROSS JOIN (VALUES ('implantacao.base'), ('financeiro.inicio_contrato'), ('rh.inicio_contrato'),
                     ('operacional.inicio_contrato'), ('suprimentos.inicio_contrato')) AS v(codigo)
 WHERE p.menu_codigo = 'licitacoes.implantacao' AND p.allow
   AND p.acao IN ('visualizar', 'incluir', 'alterar', 'excluir')
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 3) Tabelas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL,
  contrato_id            uuid NOT NULL UNIQUE REFERENCES public.contratos(id) ON DELETE CASCADE,
  implantacao_id         uuid REFERENCES public.implantacao_contrato(id) ON DELETE SET NULL,
  cnpj_contratante       text,
  objeto                 text,
  responsavel_interno    text,
  gerente_responsavel    text,
  supervisor_responsavel text,
  valor_mensal           numeric(14,2),
  qt_postos              integer NOT NULL DEFAULT 0,
  qt_colaboradores       integer NOT NULL DEFAULT 0,
  situacao               text    NOT NULL DEFAULT 'rascunho',
  observacoes            text,
  sincronizado_em        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_situacao_chk CHECK (situacao IN ('rascunho', 'pronto', 'encerrado'))
);

COMMENT ON TABLE public."IMPLANTACAO_BASE" IS
  'Cabeçalho da Base Mestre de Início de Contrato (SIS-2026-0599). Uma linha '
  'por contrato. `sincronizado_em` diz quando alguém clicou "Atualizar da base" '
  '— os números daqui são foto, não espelho ao vivo de contratos.';

CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_POSTO" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id           uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id        uuid NOT NULL,
  ordem             integer NOT NULL DEFAULT 0,
  tipo_posto        text,
  tipo_servico      text NOT NULL,
  cbo               text,
  escala            text,
  carga_horaria     text,
  dias_turno        text,
  qt_postos         integer NOT NULL DEFAULT 0,
  qt_funcionarios   integer NOT NULL DEFAULT 0,
  salario_base      numeric(14,2),
  total_remuneracao numeric(14,2),
  valor_posto       numeric(14,2),
  sindicato         text,
  vt_dia            numeric(14,2),
  vt_desconto       numeric(14,2),
  va_dia            text,
  insalubridade     numeric(14,2),
  cidade            text,
  planilha_custo_id uuid REFERENCES public.planilha_custo(id) ON DELETE SET NULL,
  sup_funcao_id     uuid REFERENCES public.sup_funcao(id) ON DELETE SET NULL,
  origem            text NOT NULL DEFAULT 'manual',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_posto_origem_chk CHECK (origem IN ('manual', 'planilha', 'base'))
);

CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_LOCAL" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id         uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id      uuid NOT NULL,
  ordem           integer NOT NULL DEFAULT 0,
  local_nome      text NOT NULL,
  cidade          text,
  endereco        text,
  posto           text,
  qt_postos       integer NOT NULL DEFAULT 0,
  qt_funcionarios integer NOT NULL DEFAULT 0,
  sup_posto_id    uuid REFERENCES public.sup_posto(id) ON DELETE SET NULL,
  base_posto_id   uuid REFERENCES public."IMPLANTACAO_BASE_POSTO"(id) ON DELETE SET NULL,
  origem          text NOT NULL DEFAULT 'manual',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_local_origem_chk CHECK (origem IN ('manual', 'planilha', 'base'))
);

CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_ITEM" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id       uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id    uuid NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  cargo         text NOT NULL,
  sup_funcao_id uuid REFERENCES public.sup_funcao(id) ON DELETE SET NULL,
  item_id       uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  descricao     text NOT NULL,
  tipo          text NOT NULL,
  categoria     text,
  quantidade    numeric(12,2) NOT NULL DEFAULT 0,
  prioridade    text NOT NULL DEFAULT 'media',
  status        text NOT NULL DEFAULT 'planejado',
  origem        text NOT NULL DEFAULT 'manual',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_item_tipo_chk       CHECK (tipo IN ('uniforme', 'epi', 'material', 'equipamento', 'insumo')),
  CONSTRAINT implantacao_base_item_prioridade_chk CHECK (prioridade IN ('alta', 'media', 'baixa')),
  CONSTRAINT implantacao_base_item_status_chk     CHECK (status IN ('planejado', 'solicitado', 'comprado', 'entregue')),
  CONSTRAINT implantacao_base_item_origem_chk     CHECK (origem IN ('manual', 'planilha', 'base'))
);

COMMENT ON COLUMN public."IMPLANTACAO_BASE_ITEM".item_id IS
  'Aponta para o catálogo (sup_item) sempre que o item existe lá — é o que '
  'impede a lista de congelar na planilha importada. Nulo = item só da '
  'planilha, ainda sem par no catálogo.';

CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_PRAZO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id     uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id  uuid NOT NULL,
  ordem       integer NOT NULL DEFAULT 0,
  etapa       text NOT NULL,
  responsavel text,
  data_limite date,
  status      text NOT NULL DEFAULT 'pendente',
  observacoes text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_prazo_status_chk CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'atrasado'))
);

CREATE TABLE IF NOT EXISTS public."IMPLANTACAO_BASE_DOC" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id       uuid NOT NULL REFERENCES public."IMPLANTACAO_BASE"(id) ON DELETE CASCADE,
  empresa_id    uuid NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  documento     text NOT NULL,
  data_entrega  date,
  status        text NOT NULL DEFAULT 'pendente',
  observacoes   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT implantacao_base_doc_status_chk CHECK (status IN ('pendente', 'entregue', 'dispensado'))
);

CREATE INDEX IF NOT EXISTS implantacao_base_contrato_idx     ON public."IMPLANTACAO_BASE" (contrato_id);
CREATE INDEX IF NOT EXISTS implantacao_base_posto_base_idx   ON public."IMPLANTACAO_BASE_POSTO" (base_id, ordem);
CREATE INDEX IF NOT EXISTS implantacao_base_local_base_idx   ON public."IMPLANTACAO_BASE_LOCAL" (base_id, ordem);
CREATE INDEX IF NOT EXISTS implantacao_base_item_base_idx    ON public."IMPLANTACAO_BASE_ITEM" (base_id, ordem);
CREATE INDEX IF NOT EXISTS implantacao_base_prazo_base_idx   ON public."IMPLANTACAO_BASE_PRAZO" (base_id, ordem);
CREATE INDEX IF NOT EXISTS implantacao_base_doc_base_idx     ON public."IMPLANTACAO_BASE_DOC" (base_id, ordem);

-- ── 4) updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.implantacao_base_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['IMPLANTACAO_BASE', 'IMPLANTACAO_BASE_POSTO', 'IMPLANTACAO_BASE_LOCAL',
                           'IMPLANTACAO_BASE_ITEM', 'IMPLANTACAO_BASE_PRAZO', 'IMPLANTACAO_BASE_DOC']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', lower(t) || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.implantacao_base_touch()',
                   lower(t) || '_touch', t);
  END LOOP;
END $$;

-- ── 5) RLS ──────────────────────────────────────────────────────────────────
-- Leitura: quem tem a Base Mestre OU qualquer um dos 4 menus setoriais (as
-- telas setoriais leem destas mesmas tabelas). Escrita: só a Base Mestre.
-- Policies separadas por comando de propósito: `FOR ALL` pesa no SELECT —
-- a policy de escrita roda junto na leitura e dobra o custo por linha.
CREATE OR REPLACE FUNCTION public.implantacao_base_pode_ver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT has_screen_access(auth.uid(), 'implantacao.base',            'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'financeiro.inicio_contrato',  'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'rh.inicio_contrato',          'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'operacional.inicio_contrato', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'suprimentos.inicio_contrato', 'visualizar'::app_acao);
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_pode_escrever()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT has_screen_access(auth.uid(), 'implantacao.base', 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'implantacao.base', 'alterar'::app_acao);
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['IMPLANTACAO_BASE', 'IMPLANTACAO_BASE_POSTO', 'IMPLANTACAO_BASE_LOCAL',
                           'IMPLANTACAO_BASE_ITEM', 'IMPLANTACAO_BASE_PRAZO', 'IMPLANTACAO_BASE_DOC']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.implantacao_base_pode_ver())',
                   lower(t) || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.implantacao_base_pode_escrever())',
                   lower(t) || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.implantacao_base_pode_escrever()) WITH CHECK (public.implantacao_base_pode_escrever())',
                   lower(t) || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (has_screen_access(auth.uid(), ''implantacao.base'', ''excluir''::app_acao))',
                   lower(t) || '_delete', t);
  END LOOP;
END $$;

-- ── 6) Semear: puxa das tabelas que já existem ──────────────────────────────
-- É o "Atualizar da base" da tela. Idempotente: só repõe o que tem
-- origem <> 'manual', pra nunca apagar linha que o José digitou.
CREATE OR REPLACE FUNCTION public.implantacao_base_semear(p_contrato_id uuid)
RETURNS TABLE (base_id uuid, postos integer, locais integer, itens integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base    uuid;
  v_emp     uuid;
  v_postos  integer := 0;
  v_locais  integer := 0;
  v_itens   integer := 0;
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para atualizar a Base Mestre de Início de Contrato';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" AS b (empresa_id, contrato_id, implantacao_id, cnpj_contratante,
                                              valor_mensal, qt_postos, qt_colaboradores, sincronizado_em)
  SELECT c.empresa_id, c.id,
         (SELECT ic.id FROM public.implantacao_contrato ic WHERE ic.contrato_id = c.id LIMIT 1),
         c.cnpj_cliente, c.valor_mensal_contratado, 0, 0, now()
    FROM public.contratos c WHERE c.id = p_contrato_id
  ON CONFLICT (contrato_id) DO UPDATE
    SET cnpj_contratante = EXCLUDED.cnpj_contratante,
        valor_mensal     = EXCLUDED.valor_mensal,
        implantacao_id   = COALESCE(b.implantacao_id, EXCLUDED.implantacao_id),
        sincronizado_em  = now()
  RETURNING b.id INTO v_base;

  -- Postos: a Planilha de Custo é a fonte real (o contrato-piloto tem 192
  -- linhas nela e ZERO em `postos` — ver o chamado).
  -- Alias obrigatório: `base_id` também é nome de coluna do RETURNS TABLE, e
  -- sem qualificar o plpgsql liga o nome à variável de saída (nula), apagando
  -- linha nenhuma ou a tabela toda, conforme o caso. Pego no teste local.
  DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_POSTO"
    (base_id, empresa_id, ordem, tipo_servico, tipo_posto, qt_postos, qt_funcionarios,
     salario_base, sindicato, insalubridade, planilha_custo_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY pc.posto),
         pc.posto, pc.servico, COALESCE(pc.qt_postos, 0), COALESCE(pc.qt_postos, 0),
         pc.salario, pc.sindicato, pc.insalubridade, pc.id, 'base'
    FROM public.planilha_custo pc
   WHERE pc.contrato_id = p_contrato_id
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_POSTO" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.tipo_servico) = upper(pc.posto));
  GET DIAGNOSTICS v_postos = ROW_COUNT;

  -- Locais: sup_posto é quem guarda os locais do contrato (151 no piloto:
  -- 1ª DP Alvorada, 1ª DPRM Gravataí...). planilha_posto_localizacao cobre
  -- endereço quando existe — no piloto ela está vazia.
  DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_LOCAL"
    (base_id, empresa_id, ordem, local_nome, cidade, endereco, qt_postos, qt_funcionarios, sup_posto_id, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY sp.nome), sp.nome,
         loc.municipio,
         NULLIF(trim(concat_ws(', ', loc.logradouro, loc.numero, loc.bairro)), ''),
         0, COALESCE(loc.qt_pessoas_orcadas, 0), sp.id, 'base'
    FROM public.sup_posto sp
    LEFT JOIN LATERAL (
      SELECT l.* FROM public.planilha_posto_localizacao l
       JOIN public.planilha_custo pc ON pc.id = l.planilha_custo_id AND pc.contrato_id = p_contrato_id
      WHERE upper(l.nome) = upper(sp.nome) LIMIT 1
    ) loc ON true
   WHERE sp.contrato_id = p_contrato_id AND sp.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_LOCAL" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND upper(x.local_nome) = upper(sp.nome));
  GET DIAGNOSTICS v_locais = ROW_COUNT;

  -- Enxoval: o catálogo vivo (sup_funcao_item → sup_item). A quantidade sai
  -- da coluna nova; nula vira 0 e aparece como pendente na tela de Compras.
  DELETE FROM public."IMPLANTACAO_BASE_ITEM" t WHERE t.base_id = v_base AND t.origem = 'base';
  INSERT INTO public."IMPLANTACAO_BASE_ITEM"
    (base_id, empresa_id, ordem, cargo, sup_funcao_id, item_id, descricao, tipo, quantidade, origem)
  SELECT v_base, v_emp, row_number() OVER (ORDER BY f.nome, i.nome),
         f.nome, f.id, i.id, i.nome, i.tipo, COALESCE(fi.quantidade, 0), 'base'
    FROM public.sup_funcao f
    JOIN public.sup_posto  sp ON sp.id = f.posto_id AND sp.contrato_id = p_contrato_id
    JOIN public.sup_funcao_item fi ON fi.funcao_id = f.id AND fi.ativo
    JOIN public.sup_item   i  ON i.id = fi.item_id AND i.ativo
   WHERE f.ativo
     AND NOT EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_ITEM" x
                      WHERE x.base_id = v_base AND x.origem <> 'base'
                        AND x.item_id = i.id AND upper(x.cargo) = upper(f.nome));
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         sincronizado_em  = now()
   WHERE b.id = v_base;

  RETURN QUERY SELECT v_base, v_postos, v_locais, v_itens;
END;
$$;

-- ── 6.1) Importar a planilha ────────────────────────────────────────────────
-- Recebe o que o parser do frontend leu dos dois anexos do chamado. Faz num
-- lugar só o que não dá para fazer no cliente sem N consultas:
--   * casa cada item pelo NOME com o catálogo (sup_item);
--   * cria como PENDENTE DE APROVAÇÃO o que não existe lá (colher de café e
--     copo long drink não existem hoje) — mesmo caminho que o Catálogo já usa
--     para função nova, nunca aprovado por fora;
--   * grava a quantidade declarada em sup_funcao_item, quando a função do
--     contrato tem aquele item no enxoval.
-- Idempotente por origem: reimportar substitui o que veio de planilha e não
-- encosta no que foi digitado à mão.
CREATE OR REPLACE FUNCTION public.implantacao_base_importar(p_contrato_id uuid, p_payload jsonb)
RETURNS TABLE (postos integer, locais integer, itens integer, itens_novos integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base   uuid;
  v_emp    uuid;
  v_postos integer := 0;
  v_locais integer := 0;
  v_itens  integer := 0;
  v_novos  integer := 0;
  r        record;
  v_item   uuid;
  v_funcao uuid;
BEGIN
  IF NOT public.implantacao_base_pode_escrever() THEN
    RAISE EXCEPTION 'Sem acesso para importar na Base Mestre de Início de Contrato';
  END IF;

  SELECT c.empresa_id INTO v_emp FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Contrato % não encontrado', p_contrato_id;
  END IF;

  INSERT INTO public."IMPLANTACAO_BASE" (empresa_id, contrato_id)
       VALUES (v_emp, p_contrato_id)
  ON CONFLICT (contrato_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_base;

  -- Postos
  IF p_payload ? 'postos' THEN
    DELETE FROM public."IMPLANTACAO_BASE_POSTO" t WHERE t.base_id = v_base AND t.origem = 'planilha';
    INSERT INTO public."IMPLANTACAO_BASE_POSTO"
      (base_id, empresa_id, ordem, tipo_posto, tipo_servico, cbo, escala, carga_horaria, dias_turno,
       qt_postos, qt_funcionarios, salario_base, total_remuneracao, sindicato, vt_dia, vt_desconto,
       va_dia, insalubridade, origem)
    SELECT v_base, v_emp, row_number() OVER (),
           j->>'tipo_posto', j->>'tipo_servico', j->>'cbo', j->>'escala', j->>'carga_horaria', j->>'dias_turno',
           COALESCE((j->>'qt_postos')::int, 0), COALESCE((j->>'qt_funcionarios')::int, 0),
           (j->>'salario_base')::numeric, (j->>'total_remuneracao')::numeric, j->>'sindicato',
           (j->>'vt_dia')::numeric, (j->>'vt_desconto')::numeric, j->>'va_dia', (j->>'insalubridade')::numeric,
           'planilha'
      FROM jsonb_array_elements(p_payload->'postos') j
     WHERE NULLIF(j->>'tipo_servico', '') IS NOT NULL;
    GET DIAGNOSTICS v_postos = ROW_COUNT;

    -- A planilha manda mais que a Planilha de Custo (traz escala, CBO, nº de
    -- funcionários), então o que veio de `semear` para o MESMO posto sai de
    -- cena. Sem isto os dois se somam e o KPI conta o contrato duas vezes —
    -- 146 postos num contrato de 79, pego no teste local.
    DELETE FROM public."IMPLANTACAO_BASE_POSTO" t
     WHERE t.base_id = v_base AND t.origem = 'base'
       AND EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_POSTO" p
                    WHERE p.base_id = v_base AND p.origem = 'planilha'
                      AND upper(p.tipo_servico) = upper(t.tipo_servico));
  END IF;

  -- Locais
  IF p_payload ? 'locais' THEN
    DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t WHERE t.base_id = v_base AND t.origem = 'planilha';
    INSERT INTO public."IMPLANTACAO_BASE_LOCAL"
      (base_id, empresa_id, ordem, local_nome, cidade, endereco, posto, qt_postos, qt_funcionarios, sup_posto_id, origem)
    SELECT v_base, v_emp, row_number() OVER (),
           j->>'local_nome', j->>'cidade', j->>'endereco', j->>'posto',
           COALESCE((j->>'qt_postos')::int, 0), COALESCE((j->>'qt_funcionarios')::int, 0),
           (SELECT sp.id FROM public.sup_posto sp
             WHERE sp.contrato_id = p_contrato_id AND upper(sp.nome) = upper(j->>'local_nome') LIMIT 1),
           'planilha'
      FROM jsonb_array_elements(p_payload->'locais') j
     WHERE NULLIF(j->>'local_nome', '') IS NOT NULL;
    GET DIAGNOSTICS v_locais = ROW_COUNT;

    DELETE FROM public."IMPLANTACAO_BASE_LOCAL" t
     WHERE t.base_id = v_base AND t.origem = 'base'
       AND EXISTS (SELECT 1 FROM public."IMPLANTACAO_BASE_LOCAL" l
                    WHERE l.base_id = v_base AND l.origem = 'planilha'
                      AND upper(l.local_nome) = upper(t.local_nome));
  END IF;

  -- Itens: um a um, porque cada linha pode criar item no catálogo.
  IF p_payload ? 'itens' THEN
    DELETE FROM public."IMPLANTACAO_BASE_ITEM" t WHERE t.base_id = v_base AND t.origem = 'planilha';
    FOR r IN SELECT j->>'cargo' AS cargo, j->>'descricao' AS descricao, j->>'tipo' AS tipo,
                    COALESCE((j->>'quantidade')::numeric, 0) AS quantidade
               FROM jsonb_array_elements(p_payload->'itens') j
              WHERE NULLIF(j->>'descricao', '') IS NOT NULL
    LOOP
      SELECT i.id INTO v_item
        FROM public.sup_item i
       WHERE upper(i.nome) = upper(r.descricao) AND i.ativo
       ORDER BY i.aprovado DESC
       LIMIT 1;

      IF v_item IS NULL THEN
        INSERT INTO public.sup_item (empresa_id, nome, tipo, ativo, aprovado)
             VALUES (v_emp, upper(r.descricao), CASE WHEN r.tipo = 'uniforme' THEN 'uniforme' ELSE 'equipamento' END, true, false)
          RETURNING id INTO v_item;
        v_novos := v_novos + 1;
      END IF;

      -- Função do contrato com o mesmo nome do cargo da planilha.
      SELECT f.id INTO v_funcao
        FROM public.sup_funcao f
        JOIN public.sup_posto sp ON sp.id = f.posto_id AND sp.contrato_id = p_contrato_id
       WHERE upper(f.nome) = upper(r.cargo) AND f.ativo
       LIMIT 1;

      INSERT INTO public."IMPLANTACAO_BASE_ITEM"
        (base_id, empresa_id, cargo, sup_funcao_id, item_id, descricao, tipo, quantidade, origem)
      VALUES (v_base, v_emp, r.cargo, v_funcao, v_item, r.descricao,
              CASE WHEN r.tipo IN ('uniforme', 'epi', 'material', 'equipamento', 'insumo') THEN r.tipo ELSE 'material' END,
              r.quantidade, 'planilha');
      v_itens := v_itens + 1;

      DELETE FROM public."IMPLANTACAO_BASE_ITEM" t
       WHERE t.base_id = v_base AND t.origem = 'base'
         AND upper(t.cargo) = upper(r.cargo) AND upper(t.descricao) = upper(r.descricao);

      -- A quantidade declarada volta para o catálogo, que é quem não a tinha.
      IF v_funcao IS NOT NULL AND r.quantidade > 0 THEN
        UPDATE public.sup_funcao_item fi
           SET quantidade = r.quantidade
         WHERE fi.funcao_id = v_funcao AND fi.item_id = v_item AND fi.quantidade IS DISTINCT FROM r.quantidade;
      END IF;
    END LOOP;
  END IF;

  UPDATE public."IMPLANTACAO_BASE" b
     SET qt_postos        = COALESCE((SELECT sum(p.qt_postos)       FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         qt_colaboradores = COALESCE((SELECT sum(p.qt_funcionarios) FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
         -- NULLIF: importação parcial (um posto só, sem valor) somava zero e
         -- APAGAVA o valor do contrato. Zero aqui quer dizer "não sei", não
         -- "vale nada" — pego no teste local.
         valor_mensal     = COALESCE(NULLIF((SELECT sum(COALESCE(p.valor_posto, p.total_remuneracao, 0) * p.qt_postos)
                                               FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = v_base), 0),
                                     b.valor_mensal),
         sincronizado_em  = now()
   WHERE b.id = v_base;

  RETURN QUERY SELECT v_postos, v_locais, v_itens, v_novos;
END;
$$;

-- ── 7) Recortes de leitura ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.implantacao_base_resumo(p_contrato_id uuid)
RETURNS TABLE (
  base_id uuid, contrato_nome text, cliente text, cnpj_contratante text, objeto text,
  valor_mensal numeric, qt_postos integer, qt_colaboradores integer,
  qt_locais integer, qt_cidades integer, qt_tipos_servico integer,
  qt_itens_uniforme integer, qt_itens_material integer,
  qt_prazos integer, qt_documentos integer, situacao text, sincronizado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT b.id, c.nome, c.cliente, b.cnpj_contratante, COALESCE(b.objeto, ce.objeto),
         b.valor_mensal, b.qt_postos, b.qt_colaboradores,
         (SELECT count(DISTINCT l.local_nome)::int FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id),
         (SELECT count(DISTINCT l.cidade)::int     FROM public."IMPLANTACAO_BASE_LOCAL" l WHERE l.base_id = b.id AND l.cidade IS NOT NULL),
         (SELECT count(DISTINCT p.tipo_servico)::int FROM public."IMPLANTACAO_BASE_POSTO" p WHERE p.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_ITEM" i WHERE i.base_id = b.id AND i.tipo NOT IN ('uniforme', 'epi')),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_PRAZO" x WHERE x.base_id = b.id),
         (SELECT count(*)::int FROM public."IMPLANTACAO_BASE_DOC"   x WHERE x.base_id = b.id),
         b.situacao, b.sincronizado_em
    FROM public."IMPLANTACAO_BASE" b
    JOIN public.contratos c ON c.id = b.contrato_id
    LEFT JOIN public.capa_edital ce ON ce.contrato_id = c.id
   WHERE b.contrato_id = p_contrato_id
     AND public.implantacao_base_pode_ver();
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_financeiro(p_contrato_id uuid)
RETURNS TABLE (
  posto text, valor_posto numeric, qt_postos integer, valor_mensal_postos numeric,
  faixa_custo text, participacao numeric, cidade text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT p.*, COALESCE(p.valor_posto, p.total_remuneracao, p.salario_base, 0) AS v_unit
      FROM public."IMPLANTACAO_BASE_POSTO" p
      JOIN public."IMPLANTACAO_BASE" b ON b.id = p.base_id AND b.contrato_id = p_contrato_id
     WHERE has_screen_access(auth.uid(), 'financeiro.inicio_contrato', 'visualizar'::app_acao)
        OR has_screen_access(auth.uid(), 'implantacao.base',           'visualizar'::app_acao)
  ), tot AS (SELECT NULLIF(sum(v_unit * qt_postos), 0) AS total FROM base)
  SELECT b.tipo_servico, b.v_unit, b.qt_postos, b.v_unit * b.qt_postos,
         CASE WHEN b.v_unit >= 10000 THEN 'alta' WHEN b.v_unit >= 5000 THEN 'media' ELSE 'baixa' END,
         round(100 * (b.v_unit * b.qt_postos) / (SELECT total FROM tot), 2),
         b.cidade
    FROM base b
   ORDER BY b.v_unit * b.qt_postos DESC;
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_rh(p_contrato_id uuid)
RETURNS TABLE (
  tipo_servico text, cbo text, carga_horaria text, escala text,
  salario_base numeric, total_remuneracao numeric, qt_postos integer, qt_funcionarios integer,
  sindicato text, vt_dia numeric, va_dia text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.tipo_servico, p.cbo, p.carga_horaria, p.escala, p.salario_base, p.total_remuneracao,
         p.qt_postos, p.qt_funcionarios, p.sindicato, p.vt_dia, p.va_dia
    FROM public."IMPLANTACAO_BASE_POSTO" p
    JOIN public."IMPLANTACAO_BASE" b ON b.id = p.base_id AND b.contrato_id = p_contrato_id
   WHERE has_screen_access(auth.uid(), 'rh.inicio_contrato', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'implantacao.base',    'visualizar'::app_acao)
   ORDER BY p.qt_funcionarios DESC, p.tipo_servico;
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_operacional(p_contrato_id uuid)
RETURNS TABLE (
  local_nome text, cidade text, endereco text, posto text,
  qt_postos integer, qt_funcionarios integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT l.local_nome, l.cidade, l.endereco, l.posto, l.qt_postos, l.qt_funcionarios
    FROM public."IMPLANTACAO_BASE_LOCAL" l
    JOIN public."IMPLANTACAO_BASE" b ON b.id = l.base_id AND b.contrato_id = p_contrato_id
   WHERE has_screen_access(auth.uid(), 'operacional.inicio_contrato', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'implantacao.base',            'visualizar'::app_acao)
   ORDER BY l.qt_funcionarios DESC, l.local_nome;
$$;

CREATE OR REPLACE FUNCTION public.implantacao_base_compras(p_contrato_id uuid)
RETURNS TABLE (
  cargo text, descricao text, tipo text, categoria text,
  quantidade numeric, prioridade text, status text, no_catalogo boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.cargo, i.descricao, i.tipo, i.categoria, i.quantidade, i.prioridade, i.status,
         i.item_id IS NOT NULL
    FROM public."IMPLANTACAO_BASE_ITEM" i
    JOIN public."IMPLANTACAO_BASE" b ON b.id = i.base_id AND b.contrato_id = p_contrato_id
   WHERE has_screen_access(auth.uid(), 'suprimentos.inicio_contrato', 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'implantacao.base',            'visualizar'::app_acao)
   ORDER BY i.cargo, i.tipo, i.descricao;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.implantacao_base_compras(uuid), public.implantacao_base_operacional(uuid),
--   public.implantacao_base_rh(uuid), public.implantacao_base_financeiro(uuid),
--   public.implantacao_base_resumo(uuid), public.implantacao_base_semear(uuid);
-- DROP TABLE IF EXISTS public."IMPLANTACAO_BASE_DOC", public."IMPLANTACAO_BASE_PRAZO",
--   public."IMPLANTACAO_BASE_ITEM", public."IMPLANTACAO_BASE_LOCAL",
--   public."IMPLANTACAO_BASE_POSTO", public."IMPLANTACAO_BASE";
-- DROP FUNCTION IF EXISTS public.implantacao_base_pode_ver(), public.implantacao_base_pode_escrever(),
--   public.implantacao_base_touch();
-- ALTER TABLE public.sup_funcao_item DROP COLUMN IF EXISTS quantidade;
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo IN ('implantacao.base','financeiro.inicio_contrato','rh.inicio_contrato','operacional.inicio_contrato','suprimentos.inicio_contrato');
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('implantacao.base','financeiro.inicio_contrato','rh.inicio_contrato','operacional.inicio_contrato','suprimentos.inicio_contrato');
-- DELETE FROM public.app_menu                WHERE codigo      IN ('implantacao.base','financeiro.inicio_contrato','rh.inicio_contrato','operacional.inicio_contrato','suprimentos.inicio_contrato');
-- NOTIFY pgrst, 'reload schema';
