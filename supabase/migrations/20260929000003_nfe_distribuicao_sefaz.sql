-- =========================================================================
-- NF-e de entrada pela SEFAZ (NFeDistribuicaoDFe) — estado e recepção
--
-- A SEFAZ mantém uma caixa postal numerada por CNPJ. Cada documento recebe um
-- NSU (Número Sequencial Único), que é a posição na fila — não o número da
-- nota. A consulta é sempre "me dá o que veio depois do NSU X", devolve até 50
-- documentos e informa até onde entregou.
--
-- POR QUE O ultNSU VIVE NO BANCO E NÃO NUM ARQUIVO
-- O worker guarda estado em `state/*.json`, mas aqui isso seria um risco caro:
-- perder o arquivo faz a fila recomeçar do zero, e em 26/08/2026 o CNPJ
-- 03644009000123 tinha 10.914 documentos acumulados — a 50 por chamada, são
-- ~219 chamadas para recuperar o atraso. O NSU também é estado fiscal, e faz
-- sentido estar visível ao lado das notas.
--
-- A REGRA QUE CUSTOU UM BLOQUEIO, medida em produção
-- Pular para um NSU arbitrário em vez de continuar do último devolvido faz a
-- SEFAZ responder `cStat 656 — Consumo Indevido` e **bloquear o CNPJ por 1
-- hora**. Aconteceu ao saltar de 50 para 10890. Por isso `bloqueado_ate`
-- existe nesta tabela: o worker precisa respeitar a punição entre reinícios,
-- senão volta a bater na porta e renova o castigo.
--
-- `cStat 137` ("Nenhum documento localizado") NÃO é erro — é fim da fila.
--
-- DOIS NÍVEIS DE DOCUMENTO
-- Nota emitida contra a empresa chega primeiro como RESUMO (`resNFe`): traz
-- emitente, valor e chave, mas não os itens. O XML completo (`procNFe`) só é
-- liberado depois da Manifestação do Destinatário. Por isso `tipo` distingue
-- os dois e `xml` pode conter um ou outro.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.nfe_dist_documento;
--   DROP TABLE IF EXISTS public.nfe_dist_estado;
-- =========================================================================

-- ── 1) Estado da fila, por CNPJ ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nfe_dist_estado (
  cnpj           text PRIMARY KEY,
  ult_nsu        text NOT NULL DEFAULT '000000000000000',
  max_nsu        text,
  -- Enquanto agora() < bloqueado_ate, o worker não consulta. Sobrevive a
  -- reinício, que é o ponto: sem isso, reiniciar o processo faz ele bater na
  -- SEFAZ durante a punição e recomeçar a contagem.
  bloqueado_ate  timestamptz,
  ultimo_erro    text,
  consultado_em  timestamptz,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.nfe_dist_estado.ult_nsu IS
  'Ultimo NSU entregue pela SEFAZ. A proxima consulta parte DESTE valor: pular para um NSU arbitrario devolve cStat 656 e bloqueia o CNPJ por 1 hora.';

-- ── 2) O que chegou ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nfe_dist_documento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj            text NOT NULL,
  nsu             text NOT NULL,
  schema          text,
  -- 'resumo'  = resNFe, so cabecalho, chega sozinho
  -- 'completo'= procNFe, com itens, so apos manifestacao
  -- 'evento'  = resEvento/procEventoNFe
  tipo            text NOT NULL DEFAULT 'resumo'
                    CHECK (tipo IN ('resumo', 'completo', 'evento')),
  chave           text,
  emitente_cnpj   text,
  emitente_nome   text,
  valor           numeric(14,2),
  emitida_em      date,
  xml             text,
  -- Marcado quando a Ciencia da Operacao e registrada com sucesso na SEFAZ.
  -- Autorizado pelo Eduardo em 26/08/2026. Ciencia apenas declara que a
  -- empresa sabe da existencia da nota; NAO confirma recebimento de
  -- mercadoria, que e evento distinto e mais forte.
  ciencia_em      timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cnpj, nsu)
);

CREATE INDEX IF NOT EXISTS idx_nfe_dist_doc_chave
  ON public.nfe_dist_documento(chave);
CREATE INDEX IF NOT EXISTS idx_nfe_dist_doc_pendente_ciencia
  ON public.nfe_dist_documento(cnpj)
  WHERE tipo = 'resumo' AND ciencia_em IS NULL;

-- ── 3) RLS ───────────────────────────────────────────────────────────────
-- Leitura para quem tem a tela de NF de entrada. Escrita não tem policy:
-- quem grava é o worker, com service role, por fora da RLS.

ALTER TABLE public.nfe_dist_estado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfe_dist_documento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nfe_dist_estado_select ON public.nfe_dist_estado;
CREATE POLICY nfe_dist_estado_select ON public.nfe_dist_estado
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'nf-entrada', 'visualizar'));

DROP POLICY IF EXISTS nfe_dist_documento_select ON public.nfe_dist_documento;
CREATE POLICY nfe_dist_documento_select ON public.nfe_dist_documento
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'nf-entrada', 'visualizar'));

NOTIFY pgrst, 'reload schema';
