-- SIS-2026-0562: novo submódulo "Controle de Faturamento" dentro de
-- Controladoria — matriz contrato × competência (dashboard só-leitura,
-- reaproveita RLS já existente de contratos/planilha_custo/nf_emissao, sem
-- policy nova). Mesmo padrão de registro dos outros submenus de
-- Controladoria (empresas/cc/dre/obz, migration 20260513192434).

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'controle-faturamento', 'Controle de Faturamento',
       '/app/controladoria/controle-faturamento', 50
  FROM public.app_modulo m WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo = 'controle-faturamento';
--   NOTIFY pgrst, 'reload schema';
