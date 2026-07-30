-- Lote 8e: erp-caixa-export é um endpoint com hardening de segurança deliberado
-- (comentário original "SEG-CAIXA-EXPORT-1 v3"), sempre restrito a admin/
-- controladoria/presidencia — nunca financeiro, mesmo financeiro tendo acesso
-- à tela normal de Fluxo de Caixa Diário. Reaproveitar o menu_codigo
-- 'fluxo-caixa-diario' (que financeiro já usa) alargaria esse endpoint pra
-- financeiro também, então registramos um menu novo e dedicado só pra ele.
--
-- ROLLBACK:
--   DELETE FROM perfil_acesso_permissao WHERE menu_codigo = 'caixa-export-consolidado';
--   DELETE FROM app_menu WHERE codigo = 'caixa-export-consolidado';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'caixa-export-consolidado', 'Exportação consolidada de caixa (API)', NULL, 32, true
FROM public.app_modulo m
WHERE m.codigo = 'financeiro'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'caixa-export-consolidado', 'exportar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: controladoria', 'Legado: presidencia')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'caixa-export-consolidado' AND pap.acao = 'exportar'
  );

NOTIFY pgrst, 'reload schema';
