-- =====================================================================
-- FORNECEDOR — limpeza dos dados
--
-- Decisão sua (04/08/2026): a área de fornecedores não está em uso e vai ser
-- refeita do zero, então os dados atuais podem sair.
--
-- O QUE HÁ HOJE (levantado no banco antes de escrever esta migration):
--   4.209 linhas — 186 PJ e 4.023 PF.
--   4.022 dos 4.023 PF têm CPF que casa com a tabela EMPREGADOS: são
--   colaboradores de vocês importados por engano como "fornecedor pessoa
--   física", num único lote em 20/05/2026 21:31. Não é dado de teste — é
--   dado pessoal no lugar errado, e tirá-lo daqui é correto também do ponto
--   de vista de proteção de dados.
--   11 fornecedores (2 PF + 9 PJ) estão referenciados por 24 titulo_pagar e
--   42 pre_titulo_pagar.
--
-- ⚠️ POR QUE ESTA MIGRATION ESVAZIA A TABELA EM VEZ DE DROPÁ-LA
--
-- Seis telas do Financeiro fazem embed de fornecedor no PostgREST:
--   src/pages/financeiro/ContasPagar.tsx:59
--   src/pages/financeiro/pagar/AnalisePeriodoTab.tsx:81
--   src/pages/financeiro/pagar/MalotesTab.tsx:224,236
--   src/pages/financeiro/pagar/PreTitulosTab.tsx:53,309,952
--   src/pages/financeiro/ProgramacaoPagamentos.tsx:104
--   src/pages/financeiro/ValidacaoPosPagamento.tsx:51
--
-- Se a TABELA sumir, essas consultas passam a responder 400 e as seis telas
-- quebram ao abrir — não é "some o nome do fornecedor", é a tela inteira.
-- Esvaziando, os embeds continuam válidos e devolvem nulo.
--
-- Quando você reescrever o Financeiro, é só rodar o bloco comentado do fim.
--
-- REVERTER: não há volta para o DELETE. Se quiser guardar antes, rode:
--   CREATE TABLE public.fornecedor_backup_20260821 AS SELECT * FROM public.fornecedor;
-- =====================================================================

-- ── 1. Confira antes de apagar ───────────────────────────────────────
SELECT tipo, count(*)::int AS total FROM public.fornecedor GROUP BY tipo;
SELECT count(*)::int AS titulos_que_perdem_o_fornecedor
  FROM public.titulo_pagar WHERE fornecedor_id IS NOT NULL;
SELECT count(*)::int AS pre_titulos_que_perdem_o_fornecedor
  FROM public.pre_titulo_pagar WHERE fornecedor_id IS NOT NULL;

-- ── 2. Solta as referências ──────────────────────────────────────────
-- Zera antes de apagar para não deixar id órfão apontando para o vazio: a
-- coluna continua existindo e as telas do Financeiro seguem carregando.
UPDATE public.titulo_pagar     SET fornecedor_id = NULL WHERE fornecedor_id IS NOT NULL;
UPDATE public.pre_titulo_pagar SET fornecedor_id = NULL WHERE fornecedor_id IS NOT NULL;

-- Tabelas do fluxo antigo, todas vazias hoje — o UPDATE é defensivo.
UPDATE public.cotacao          SET vencedor_fornecedor_id = NULL WHERE vencedor_fornecedor_id IS NOT NULL;
UPDATE public.estoque_lote     SET fornecedor_id = NULL WHERE fornecedor_id IS NOT NULL;
UPDATE public.nf_entrada       SET fornecedor_id = NULL WHERE fornecedor_id IS NOT NULL;
DELETE FROM public.cotacao_fornecedor;
DELETE FROM public.cotacao_proposta;

-- ── 3. Apaga os dados ────────────────────────────────────────────────
DELETE FROM public.fornecedor_conta_bancaria;
DELETE FROM public.fornecedor;

-- ── 4. Confere ───────────────────────────────────────────────────────
SELECT (SELECT count(*)::int FROM public.fornecedor)                AS fornecedores_restantes,
       (SELECT count(*)::int FROM public.fornecedor_conta_bancaria) AS contas_restantes;

-- =====================================================================
-- 5. DROP DA TABELA — só quando o Financeiro tiver sido reescrito
--
-- Descomente e rode SOMENTE depois de tirar os embeds de fornecedor das seis
-- telas listadas no cabeçalho. Antes disso, isto derruba o Contas a Pagar.
--
-- ALTER TABLE public.titulo_pagar     DROP COLUMN IF EXISTS fornecedor_id;
-- ALTER TABLE public.pre_titulo_pagar DROP COLUMN IF EXISTS fornecedor_id;
-- DROP TABLE IF EXISTS public.fornecedor_conta_bancaria CASCADE;
-- DROP TABLE IF EXISTS public.fornecedor CASCADE;
-- =====================================================================

NOTIFY pgrst, 'reload schema';
