-- SIS-2026-0556: duas telas novas em Controladoria — Faturamento da Empresa e
-- Lucratividade de Contratos. Só leitura: reaproveitam a RLS já existente de
-- nf_emissao/contratos/planilha_custo/Fluxo de Caixa, sem policy nova. O acesso
-- é liberado por usuário em /app/administracao?tab=modulos.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, v.codigo, v.nome, v.rota, v.ordem
  FROM public.app_modulo m
  CROSS JOIN (VALUES
    ('faturamento-empresa',      'Faturamento da Empresa',      '/app/controladoria/faturamento-empresa',      51),
    ('lucratividade-contratos',  'Lucratividade de Contratos',  '/app/controladoria/lucratividade-contratos',  52)
  ) AS v(codigo, nome, rota, ordem)
 WHERE m.codigo = 'controladoria'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo IN ('faturamento-empresa', 'lucratividade-contratos');
--   NOTIFY pgrst, 'reload schema';
