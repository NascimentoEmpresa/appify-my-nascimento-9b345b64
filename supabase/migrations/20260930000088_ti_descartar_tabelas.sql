-- =========================================================================
-- T.I: descarte definitivo das tabelas do Mapa 3D
--
-- Continuação da 20260930000084_ti_remover_modulo.sql, que desligou os menus
-- mas deixou os dados de pé e o DROP comentado "para ser rodado
-- deliberadamente". A decisão foi tomada em 11/09/2026 e o DROP abaixo JÁ FOI
-- EXECUTADO no banco do app nesse dia — esta migration existe para o
-- repositório não mentir sobre o banco (R4), e é idempotente se rodar de novo.
--
-- ANTES de apagar, o conteúdo inteiro foi exportado (select * de cada tabela,
-- 225 ativos / 12.073 eventos / 1 planta / 759 células / 124 elementos /
-- 0 anexos) e guardado fora deste repositório remoto, junto com um
-- restaurar.sql que recria as linhas por json_populate_recordset. Se um dia
-- o módulo voltar, é reaplicar as migrations 20260930000060..74 e rodar o
-- restaurar.sql.
--
-- As seis funções abaixo só existiam para essas tabelas (três são funções de
-- trigger da TI_ATIVO; três são RPCs da planta). ti_pode/ti_pode_ver/
-- ti_pode_construir ficam: só consultam permissão, não tocam nas tabelas, e
-- o bloco comentado da 000084 continua valendo para elas, menus e concessões.
-- =========================================================================

BEGIN;

-- Ordem inversa das FKs: filhos primeiro.
-- portaria-ok: R2 — módulo T.I removido na 000084; dados exportados em 11/09/2026 antes do DROP
DROP TABLE IF EXISTS public."TI_ATIVO_EVENTO";
-- portaria-ok: R2 — módulo T.I removido na 000084; tabela estava vazia (0 linhas)
DROP TABLE IF EXISTS public."TI_ATIVO_ANEXO";
-- portaria-ok: R2 — módulo T.I removido na 000084; dados exportados em 11/09/2026 antes do DROP
DROP TABLE IF EXISTS public."TI_ATIVO";
-- portaria-ok: R2 — módulo T.I removido na 000084; dados exportados em 11/09/2026 antes do DROP
DROP TABLE IF EXISTS public."TI_PLANTA_ELEMENTO";
-- portaria-ok: R2 — módulo T.I removido na 000084; dados exportados em 11/09/2026 antes do DROP
DROP TABLE IF EXISTS public."TI_PLANTA_CELULA";
-- portaria-ok: R2 — módulo T.I removido na 000084; dados exportados em 11/09/2026 antes do DROP
DROP TABLE IF EXISTS public."TI_PLANTA";

-- Funções de trigger da TI_ATIVO (os triggers já caíram com a tabela).
DROP FUNCTION IF EXISTS public.gerar_codigo_ti_ativo();
DROP FUNCTION IF EXISTS public.ti_ativo_guard();
DROP FUNCTION IF EXISTS public.ti_ativo_registrar_evento();

-- RPCs da planta.
DROP FUNCTION IF EXISTS public.ti_celula_definir(uuid, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.ti_expandir_planta(uuid, text, integer);
DROP FUNCTION IF EXISTS public.ti_materializar_celulas(uuid);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência: deve voltar vazio ───────────────────────────────────────
-- SELECT relname FROM pg_class
--  WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'TI\_%';

-- =========================================================================
-- ROLLBACK — não existe por SQL: as tabelas se foram com os dados.
-- Recriar: migrations 20260930000060..74 (estrutura) + restaurar.sql (dados),
-- ambos guardados fora do remoto por quem executou o descarte.
-- =========================================================================
