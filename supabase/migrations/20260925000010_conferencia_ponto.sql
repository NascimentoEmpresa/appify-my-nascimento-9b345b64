-- =========================================================================
-- CONFERÊNCIA DE PONTO — porte do sistema Flask para o ERP
--
-- Uma linha por CONTRATO por MÊS, atravessando três setores:
--
--   Operacional confere o ponto → aprova e manda para o RH
--   RH confirma                 → informa o valor da folha → manda ao Financeiro
--   Financeiro paga             → marca como pago
--
--   Pendente Operacional → Pendente RH → Conferido RH
--        → Liberado Financeiro → Pago
--        ↘ Devolvido (volta uma casa, com motivo)   ↘ Problema
--
-- FONTE DOS CONTRATOS: lê `public."CONTRATOS"` (que já existe aqui, com a
-- mesma forma do sistema antigo: Empresa, Filial, "NOME CONTRATO", ANALISTA,
-- SUPERVISOR, ATIVO). NÃO duplica cadastro — a linha daqui guarda só o
-- andamento do mês, e o nome do contrato fica desnormalizado de propósito,
-- para o histórico não mudar quando alguém renomear o contrato depois.
--
-- ACESSO — a diferença central em relação ao Flask.
--   Lá o poder saía do SETOR da pessoa (SETOR_PERFIL: quem era do setor 'RH'
--   ganhava os poderes de RH, e havia um 'ADMIN' que furava tudo). Aqui esse
--   modelo não existe: este ERP concede acesso POR USUÁRIO, nunca por
--   cargo/setor (README.md da raiz). Cada ação virou um menu próprio,
--   liberado em Administração › Acesso por Usuário:
--
--     ponto_aprovar_contrato     → quem pode aprovar os contratos
--     ponto_confirmar_aprovacao  → quem pode confirmar a aprovação
--     ponto_informar_valor       → quem informa o valor e envia ao financeiro
--     ponto_marcar_pago          → quem pode marcar como pago
--
--   Os quatro são MENU FANTASMA (`rota = NULL`): não são telas, são blocos
--   com visibilidade própria dentro da Conferência de Ponto — o padrão que o
--   CLAUDE.md descreve e que outros 40 menus deste banco já usam.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) O andamento do contrato no mês ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_CONFERENCIA_PONTO" (
  id                BIGSERIAL PRIMARY KEY,

  -- A chave do contrato é (Empresa, Filial), como em CONTRATOS.
  contrato_empresa  BIGINT NOT NULL,
  contrato_filial   BIGINT NOT NULL,
  -- Desnormalizado: o histórico não pode mudar de nome retroativamente.
  contrato_nome     TEXT,

  mes_referencia    TEXT NOT NULL,   -- 'YYYY-MM'

  status            TEXT NOT NULL DEFAULT 'Pendente Operacional',

  -- O valor da folha, informado pelo RH ao liberar para o Financeiro.
  valor_folha       NUMERIC(14,2),

  -- Motivo da última devolução / do problema. Obrigatório na tela.
  devolucao_motivo  TEXT,

  -- Carimbo por etapa: quem fez e quando. Colunas separadas em vez de um
  -- jsonb (era assim no Flask) porque o Painel e os indicadores precisam
  -- filtrar e ordenar por elas.
  aprovado_por      TEXT,  aprovado_em      TIMESTAMPTZ,
  confirmado_por    TEXT,  confirmado_em    TIMESTAMPTZ,
  valor_por         TEXT,  valor_em         TIMESTAMPTZ,
  pago_por          TEXT,  pago_em          TIMESTAMPTZ,

  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por    TEXT,

  CONSTRAINT scp_mes_formato CHECK (mes_referencia ~ '^\d{4}-\d{2}$'),
  CONSTRAINT scp_status_conhecido CHECK (status IN (
    'Pendente Operacional', 'Em Andamento Operacional',
    'Pendente RH', 'Em Andamento RH', 'Conferido RH',
    'Liberado Financeiro', 'Pago',
    'Devolvido Operacional', 'Devolvido RH', 'Problema'
  )),
  -- Um contrato só entra uma vez por mês. É esta UNIQUE que deixa "preparar
  -- o mês" ser reexecutável sem duplicar nada.
  CONSTRAINT scp_contrato_mes_unico UNIQUE (contrato_empresa, contrato_filial, mes_referencia)
);

CREATE INDEX IF NOT EXISTS scp_mes_idx      ON public."SISTEMA_CONFERENCIA_PONTO"(mes_referencia);
CREATE INDEX IF NOT EXISTS scp_status_idx   ON public."SISTEMA_CONFERENCIA_PONTO"(status);
CREATE INDEX IF NOT EXISTS scp_contrato_idx ON public."SISTEMA_CONFERENCIA_PONTO"(contrato_empresa, contrato_filial);

-- `set_atualizado_em` nasceu na 20260925000009 — a coluna aqui também está
-- em português, e a `set_updated_at` grava NEW.updated_at (foi exatamente
-- esse descasamento que travou a Troca de Função inteira).
DROP TRIGGER IF EXISTS trg_scp_atualizado ON public."SISTEMA_CONFERENCIA_PONTO";
CREATE TRIGGER trg_scp_atualizado BEFORE UPDATE ON public."SISTEMA_CONFERENCIA_PONTO"
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- ── 2) A trilha de eventos ───────────────────────────────────────────────
-- Tabela à parte em vez do `historico jsonb` do Flask: o histórico é lido
-- por contrato e escrito uma linha de cada vez, e um jsonb que só cresce
-- deixava a listagem do mês pesada (lá o SELECT da lista tinha que excluir a
-- coluna explicitamente para não arrastar tudo).
CREATE TABLE IF NOT EXISTS public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" (
  id              BIGSERIAL PRIMARY KEY,
  conferencia_id  BIGINT NOT NULL REFERENCES public."SISTEMA_CONFERENCIA_PONTO"(id) ON DELETE CASCADE,
  acao            TEXT NOT NULL,
  de_status       TEXT,
  para_status     TEXT,
  observacao      TEXT,
  usuario_nome    TEXT,
  usuario_email   TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scpe_conf_idx ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS"(conferencia_id, criado_em DESC);

-- ── 3) RLS ───────────────────────────────────────────────────────────────
-- Aberta para authenticated e controle no menu/RouteGuard, igual ao resto
-- do fluxo de solicitações (SISTEMA_SOLICITACOES_DEMISSAO 20260909000005,
-- SISTEMA_SOLICITACOES_TROCA_FUNCAO 20260925000004). Quem decide o que cada
-- um PODE FAZER são os quatro menus da seção 4.
ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_CONFERENCIA_PONTO" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_CONFERENCIA_PONTO_id_seq" TO authenticated;

DROP POLICY IF EXISTS scp_all_auth ON public."SISTEMA_CONFERENCIA_PONTO";
CREATE POLICY scp_all_auth ON public."SISTEMA_CONFERENCIA_PONTO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_CONFERENCIA_PONTO_EVENTOS_id_seq" TO authenticated;

DROP POLICY IF EXISTS scpe_select_auth ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS";
CREATE POLICY scpe_select_auth ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS"
  FOR SELECT TO authenticated USING (true);

-- A trilha é append-only: nem UPDATE nem DELETE para authenticated. Um
-- histórico que pode ser reescrito não serve de histórico.
DROP POLICY IF EXISTS scpe_insert_auth ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS";
CREATE POLICY scpe_insert_auth ON public."SISTEMA_CONFERENCIA_PONTO_EVENTOS"
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── 4) Navegação e as quatro chaves de acesso ────────────────────────────
-- Duas TELAS (com rota) e quatro BLOCOS de ação (menu fantasma, rota NULL).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(y.ordem) FROM public.app_menu y WHERE y.modulo_id = m.id), 0) + x.ordem,
       true
  FROM (VALUES
    ('rh_conferencia_ponto',        'Conferência de Ponto',        '/app/rh/conferencia-ponto',         1),
    ('rh_conferencia_ponto_painel', 'Conferência de Ponto — Painel','/app/rh/conferencia-ponto/painel', 2),
    -- Menus fantasma: as quatro perguntas do pedido, uma por linha.
    ('ponto_aprovar_contrato',      'Ponto — aprovar contratos',                       NULL, 3),
    ('ponto_confirmar_aprovacao',   'Ponto — confirmar a aprovação',                   NULL, 4),
    ('ponto_informar_valor',        'Ponto — informar valor e enviar ao financeiro',   NULL, 5),
    ('ponto_marcar_pago',           'Ponto — marcar como pago',                        NULL, 6)
  ) AS x(codigo, nome, rota, ordem)
  CROSS JOIN public.app_modulo m
 WHERE m.codigo = 'rh'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu z WHERE z.codigo = x.codigo);

-- ── 5) Conferência ───────────────────────────────────────────────────────
SELECT codigo, nome, COALESCE(rota, '(fantasma — só permissão)') AS rota, ativo
  FROM public.app_menu
 WHERE codigo IN ('rh_conferencia_ponto','rh_conferencia_ponto_painel',
                  'ponto_aprovar_contrato','ponto_confirmar_aprovacao',
                  'ponto_informar_valor','ponto_marcar_pago')
 ORDER BY ordem;

SELECT count(*) AS contratos_ativos FROM public."CONTRATOS" WHERE "ATIVO" = 'SIM';

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: liberar em Administração › Acesso por Usuário.
--   rh_conferencia_ponto        → todo mundo que participa do fluxo
--                                 (visualizar basta — quem age são os 4 abaixo)
--   rh_conferencia_ponto_painel → quem acompanha o painel / TV
--   ponto_aprovar_contrato      → Operacional
--   ponto_confirmar_aprovacao   → RH
--   ponto_informar_valor        → RH (quem fecha a folha)
--   ponto_marcar_pago           → Financeiro
--
-- NÃO semeei em perfil_acesso_permissao de propósito: as quatro ações são
-- de pessoas específicas dentro de cada setor, não do setor inteiro — é a
-- mesma razão pela qual `escritorio_troca_funcao` ficou de fora do seed na
-- 20260925000008.
-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo IN (
--     'rh_conferencia_ponto','rh_conferencia_ponto_painel',
--     'ponto_aprovar_contrato','ponto_confirmar_aprovacao',
--     'ponto_informar_valor','ponto_marcar_pago');
--   DROP TABLE IF EXISTS public."SISTEMA_CONFERENCIA_PONTO_EVENTOS";
--   DROP TABLE IF EXISTS public."SISTEMA_CONFERENCIA_PONTO";
-- =========================================================================
