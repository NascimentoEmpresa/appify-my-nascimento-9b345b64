-- =========================================================================
-- T.I sai do ERP
--
-- O código do módulo foi removido da branch (telas, rota, hook, item da
-- sidebar). Falta o banco: sem isto, os menus continuam listados em
-- Administração › Acesso por Usuário como telas que ninguém consegue abrir,
-- porque a rota não existe mais.
--
-- ⚠ ESTA MIGRATION NÃO APAGA DADO NENHUM. É de propósito.
--
--   As tabelas de T.I não estão vazias — bem longe disso:
--     TI_ATIVO             225 equipamentos
--     TI_ATIVO_EVENTO   12.073 registros de histórico
--     TI_PLANTA_CELULA     759 células de piso
--     TI_PLANTA_ELEMENTO   124 paredes, portas e móveis
--     TI_PLANTA              1 planta
--
--   Isso é o inventário de hardware da empresa com o histórico de cada peça.
--   Tirar a TELA é reversível: um `git revert` e um UPDATE trazem tudo de
--   volta. Dar DROP nas tabelas não tem volta sem backup, e o pedido foi
--   remover o módulo — não descartar o inventário. Se a decisão for essa
--   também, o script está pronto no fim do arquivo, comentado, para ser
--   rodado deliberadamente.
--
-- POR QUE `ativo = false` E NÃO `DELETE FROM app_menu`
--   Apagar a linha do menu levaria junto as concessões em
--   screen_permission_user (6 pessoas têm os toggles ligados hoje). Se o
--   módulo voltar, alguém teria de reconfigurar pessoa por pessoa, lembrando
--   de cabeça quem tinha o quê. Desativado, o menu some da tela e as
--   concessões ficam guardadas, esperando.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── Os menus somem da tela ───────────────────────────────────────────────
-- São sete: as quatro telas (uma delas, ti_mapa_hardware, é a antiga) e os
-- três "menus fantasma" de capacidade (rota NULL) — editar a planta,
-- gerenciar hardware e ver dados sensíveis.
UPDATE public.app_menu am
   SET ativo = false
  FROM public.app_modulo mo
 WHERE mo.id = am.modulo_id
   AND mo.codigo = 'ti'
   AND am.ativo = true;

-- ── E o módulo, para não sobrar um grupo vazio na tela de acesso ─────────
UPDATE public.app_modulo
   SET ativo = false
 WHERE codigo = 'ti'
   AND ativo = true;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT am.codigo, am.nome, am.ativo,
       (SELECT count(*) FROM public.screen_permission_user s
         WHERE s.menu_codigo = am.codigo AND s.allow) AS concessoes_preservadas
  FROM public.app_menu am
  JOIN public.app_modulo mo ON mo.id = am.modulo_id
 WHERE mo.codigo = 'ti'
 ORDER BY am.ordem;

-- =========================================================================
-- ROLLBACK — trazer o módulo de volta
-- =========================================================================
-- UPDATE public.app_modulo SET ativo = true WHERE codigo = 'ti';
-- UPDATE public.app_menu am SET ativo = true
--   FROM public.app_modulo mo WHERE mo.id = am.modulo_id AND mo.codigo = 'ti';
-- NOTIFY pgrst, 'reload schema';
-- (e reverter no código o commit que removeu as telas)

-- =========================================================================
-- DESCARTE DEFINITIVO — só rodar com a decisão tomada
-- =========================================================================
-- ⚠ APAGA O INVENTÁRIO DE HARDWARE E TODO O HISTÓRICO. Não tem desfazer.
--   Faça o backup antes:
--     supabase db dump --data-only -s public > backup-ti.sql
--
-- DROP TABLE IF EXISTS public."TI_ATIVO_EVENTO"    CASCADE;
-- DROP TABLE IF EXISTS public."TI_ATIVO_ANEXO"     CASCADE;
-- DROP TABLE IF EXISTS public."TI_ATIVO"           CASCADE;
-- DROP TABLE IF EXISTS public."TI_PLANTA_ELEMENTO" CASCADE;
-- DROP TABLE IF EXISTS public."TI_PLANTA_CELULA"   CASCADE;
-- DROP TABLE IF EXISTS public."TI_PLANTA"          CASCADE;
--
-- DROP FUNCTION IF EXISTS public.ti_ativo_guard()                 CASCADE;
-- DROP FUNCTION IF EXISTS public.ti_pode_construir(public.app_acao);
-- DROP FUNCTION IF EXISTS public.ti_pode(text, public.app_acao);
-- DROP FUNCTION IF EXISTS public.ti_pode_ver();
--
-- DELETE FROM public.screen_permission_user
--  WHERE menu_codigo IN (SELECT codigo FROM public.app_menu am
--                        JOIN public.app_modulo mo ON mo.id = am.modulo_id
--                       WHERE mo.codigo = 'ti');
-- DELETE FROM public.app_menu_acao
--  WHERE menu_codigo IN (SELECT codigo FROM public.app_menu am
--                        JOIN public.app_modulo mo ON mo.id = am.modulo_id
--                       WHERE mo.codigo = 'ti');
-- DELETE FROM public.app_menu am USING public.app_modulo mo
--  WHERE mo.id = am.modulo_id AND mo.codigo = 'ti';
-- DELETE FROM public.app_modulo WHERE codigo = 'ti';
--
-- NOTIFY pgrst, 'reload schema';
