-- Lote 9a (correção): perfil "Legado: financeiro" nunca recebeu grants em
-- 'fiscal-principal'. Antes da migration 20260809000020, nf_manage e
-- param_fiscal_select já incluíam has_role(auth.uid(),'financeiro') no OR —
-- então cargo financeiro sempre teve visualizar+alterar equivalente nessas
-- tabelas; o backfill original (Fase 1) só nunca propagou isso pro perfil
-- correspondente. Confirmado via diagnóstico: TODOS os 5 usuários reais com
-- cargo financeiro (não só um) ficaram com can_access=false pros dois —
-- gap sistêmico do perfil, não atribuição individual de usuário.
--
-- ROLLBACK: remover as duas linhas inseridas abaixo de
-- perfil_acesso_permissao (perfil 'Legado: financeiro', menu
-- 'fiscal-principal', ações 'visualizar' e 'alterar').

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'fiscal-principal', x.acao::public.app_acao, true
FROM public.perfil_acesso pa, (VALUES ('visualizar'), ('alterar')) AS x(acao)
WHERE pa.nome = 'Legado: financeiro'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'fiscal-principal' AND pap.acao = x.acao::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
