-- Remoção das tabelas do Mapa 3D de T.I do banco do app (executado em 2026-09-11).
-- Backup completo dos dados está ao lado, em *.json + restaurar.sql.
-- As funções abaixo só existem por causa dessas tabelas (triggers e RPCs da planta).
-- Bucket "ti-ativos" (vazio) e linhas ti_* em app_menu ficaram de fora de propósito.
BEGIN;

DROP TABLE IF EXISTS public."TI_ATIVO_EVENTO";
DROP TABLE IF EXISTS public."TI_ATIVO_ANEXO";
DROP TABLE IF EXISTS public."TI_ATIVO";
DROP TABLE IF EXISTS public."TI_PLANTA_ELEMENTO";
DROP TABLE IF EXISTS public."TI_PLANTA_CELULA";
DROP TABLE IF EXISTS public."TI_PLANTA";

DROP FUNCTION IF EXISTS public.gerar_codigo_ti_ativo();
DROP FUNCTION IF EXISTS public.ti_ativo_guard();
DROP FUNCTION IF EXISTS public.ti_ativo_registrar_evento();
DROP FUNCTION IF EXISTS public.ti_celula_definir(uuid, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.ti_expandir_planta(uuid, text, integer);
DROP FUNCTION IF EXISTS public.ti_materializar_celulas(uuid);

COMMIT;
NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar as migrations 20260930000060..74 (branch ti) e rodar restaurar.sql
