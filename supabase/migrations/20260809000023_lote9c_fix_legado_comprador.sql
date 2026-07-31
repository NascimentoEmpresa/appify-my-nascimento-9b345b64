-- Lote 9c (correção): perfil "Legado: comprador" nunca recebeu grants em
-- 'cotacoes'/'nf-entrada'/'recebimentos'. As policies antigas
-- (cot_*_all, nfi_write, ocor_update) já incluíam has_role(comprador) no OR
-- diretamente — regressão real de backfill, não atribuição individual
-- (confirmado: 4 usuários reais diferentes com "Legado: comprador",
-- todos com o mesmo gap uniforme).
--
-- fornecedor_conta_bancaria/bdi_* (via has_permissao) NÃO entram aqui:
-- confirmado que role_permissions nunca teve nenhuma linha pra 'comprador'
-- em nenhum menu — ou seja, comprador nunca teve acesso a isso, false ali
-- é comportamento idêntico ao de sempre, não é regressão.
--
-- ROLLBACK: remover as 3 linhas inseridas abaixo de
-- perfil_acesso_permissao (perfil 'Legado: comprador').

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu_codigo, 'alterar'::public.app_acao, true
FROM public.perfil_acesso pa, (VALUES ('cotacoes'), ('nf-entrada'), ('recebimentos')) AS x(menu_codigo)
WHERE pa.nome = 'Legado: comprador'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = x.menu_codigo AND pap.acao = 'alterar'::public.app_acao
  );

NOTIFY pgrst, 'reload schema';
