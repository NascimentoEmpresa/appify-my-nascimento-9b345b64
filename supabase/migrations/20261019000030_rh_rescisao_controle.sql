-- =========================================================================
-- RH › Solicitações de Demissão — o CONTROLE DA RESCISÃO (a planilha do RH)
--
-- PEDIDO (19/10/2026, Pablo): "deixar a tabela da rota parecida com a
-- utilizada no excel" — a PLANILHA DE RESCISÃO Geral 2026 que o RH mantém à
-- mão: homologação, datas de aviso / último dia / demissão / pagamento, tipo
-- de desligamento, programadas (rescisão e vales), malote, envio e retorno da
-- documentação e o status da rescisão. Respostas do Pablo às dúvidas:
--   · homologação = a mesma lista de 5 da planilha;
--   · tipo de desligamento = lista fixa (a planilha tinha 41 escritas para
--     ~15 tipos, quase todas a mesma coisa digitada diferente);
--   · programadas = DUAS marcações (rescisão e vales);
--   · também entram Malote e Status da rescisão;
--   · as linhas da planilha são IMPORTADAS (pela tela, ver abaixo).
--
-- POR QUE UMA TABELA À PARTE, e não colunas em SISTEMA_SOLICITACOES_DEMISSAO
--   A importação traz ~1.100 desligamentos que nunca passaram pelo ERP
--   (Survey Monkey, dissídio, complementares…). Como linha de solicitação
--   eles entrariam nos relatórios de turnover / TVs (que contam essa tabela
--   por status e por data do aviso) e esbarrariam nos gatilhos do fluxo
--   (duplicidade, contrato pelo cadastro, vaga de reposição). Aqui eles são o
--   que são: o controle da rescisão. A solicitação do ERP ganha a SUA linha
--   (solicitacao_id, 1 para 1) na primeira vez que o RH edita.
--
-- IMPORTAÇÃO — pela tela (botão "Importar planilha"), nunca por migration:
--   são nomes e matrículas de gente desligada, e dado pessoal não vai pro git.
--   `planilha_chave` (empresa|matrícula|nome|demissão|pagamento) torna a
--   importação repetível: reimportar não duplica.
--
-- ACESSO — pela tela rh_demissoes (has_screen_access):
--   ver = visualizar · lançar/editar = alterar OU aprovar (o RH que já libera
--   pro SST tem "aprovar"; exigir "alterar" deixaria todo mundo com 403 até
--   alguém marcar a ação nova) · apagar = excluir.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. A tabela ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RH_RESCISAO" (
  id                  BIGSERIAL PRIMARY KEY,
  solicitacao_id      BIGINT UNIQUE REFERENCES public."SISTEMA_SOLICITACOES_DEMISSAO"(id) ON DELETE CASCADE,
  origem              TEXT NOT NULL DEFAULT 'erp',
  planilha_chave      TEXT UNIQUE,

  -- Identificação. Na linha do ERP quem manda é a solicitação; aqui só vale
  -- para a linha importada (que não tem solicitação).
  empresa             TEXT,
  matricula           TEXT,
  colaborador_nome    TEXT,
  contrato            TEXT,
  data_recebimento    DATE,
  solicitado_por      TEXT,

  -- O que a planilha controla.
  homologacao         TEXT,
  sst_ok              BOOLEAN,
  data_aviso          DATE,
  data_ultimo_dia     DATE,
  data_demissao       DATE,
  data_pagamento      DATE,
  tipo_desligamento   TEXT,
  rescisao_programada BOOLEAN NOT NULL DEFAULT false,
  vales_programados   BOOLEAN NOT NULL DEFAULT false,
  malote_data         DATE,
  malote_obs          TEXT,
  envio_meio          TEXT,
  envio_data          DATE,
  envio_obs           TEXT,
  retorno_meio        TEXT,
  retorno_data        DATE,
  retorno_obs         TEXT,
  status_rescisao     TEXT,
  observacao          TEXT,

  atualizado_por      TEXT,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rh_rescisao_origem_chk CHECK (origem IN ('erp', 'planilha')),
  CONSTRAINT rh_rescisao_homologacao_chk CHECK (homologacao IS NULL OR homologacao IN
    ('Não', 'Sim', 'Aguardando carta', 'Carta não homo', 'Realizado')),
  CONSTRAINT rh_rescisao_status_chk CHECK (status_rescisao IS NULL OR status_rescisao IN
    ('Por fazer', 'Feita', 'Rescisão OK', 'Rescisão e documentos OK', 'Encaminhado ao INSS')),
  CONSTRAINT rh_rescisao_tipo_chk CHECK (tipo_desligamento IS NULL OR tipo_desligamento IN
    ('Sem justa causa - trabalhado', 'Sem justa causa - indenizado',
     'Pedido de demissão', 'Pedido de demissão (vai cumprir aviso)',
     'Término de contrato', 'Término de contrato - jovem aprendiz', 'Término de contrato - estágio',
     'Término antecipado pelo empregado', 'Término antecipado pela empresa',
     'Acordo por lei', 'Justa causa', 'Abandono de emprego', 'Rescisão por morte',
     'Rescisão indireta', 'Rescisão complementar'))
);

COMMENT ON TABLE public."RH_RESCISAO" IS
  'Controle da rescisão (a planilha do RH): 1 linha por solicitação do ERP (solicitacao_id) ou importada da planilha (origem = planilha). Mig 20261019000030.';

CREATE INDEX IF NOT EXISTS rh_rescisao_pagamento_idx ON public."RH_RESCISAO"(data_pagamento DESC);
CREATE INDEX IF NOT EXISTS rh_rescisao_status_idx    ON public."RH_RESCISAO"(status_rescisao);

-- atualizado_em sozinho, para a tela não ter que lembrar.
CREATE OR REPLACE FUNCTION public.rh_rescisao_tocar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_rh_rescisao_tocar ON public."RH_RESCISAO";
CREATE TRIGGER trg_rh_rescisao_tocar
  BEFORE UPDATE ON public."RH_RESCISAO"
  FOR EACH ROW EXECUTE FUNCTION public.rh_rescisao_tocar();

-- ── 2. RLS ───────────────────────────────────────────────────────────
ALTER TABLE public."RH_RESCISAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RH_RESCISAO" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."RH_RESCISAO_id_seq" TO authenticated;

DROP POLICY IF EXISTS rh_rescisao_select ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_select ON public."RH_RESCISAO" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_demissoes', 'visualizar'));

DROP POLICY IF EXISTS rh_rescisao_insert ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_insert ON public."RH_RESCISAO" FOR INSERT TO authenticated
  WITH CHECK (public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'));

DROP POLICY IF EXISTS rh_rescisao_update ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_update ON public."RH_RESCISAO" FOR UPDATE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
      OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'))
  WITH CHECK (public.has_screen_access(auth.uid(), 'rh_demissoes', 'alterar')
           OR public.has_screen_access(auth.uid(), 'rh_demissoes', 'aprovar'));

DROP POLICY IF EXISTS rh_rescisao_delete ON public."RH_RESCISAO";
CREATE POLICY rh_rescisao_delete ON public."RH_RESCISAO" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_demissoes', 'excluir'));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_rh_rescisao_tocar ON public."RH_RESCISAO";
-- DROP FUNCTION IF EXISTS public.rh_rescisao_tocar();
-- DROP TABLE IF EXISTS public."RH_RESCISAO";
-- NOTIFY pgrst, 'reload schema';
