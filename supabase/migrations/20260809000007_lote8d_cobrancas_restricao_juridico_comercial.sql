-- Lote 8d: NotasAbertoTab.tsx filtrava linhas por cargo (Jurídico só via >30
-- dias reais de atraso, Comercial só >60 dias, Financeiro/Controladoria/Admin
-- viam tudo). Migrado pro código pra usar can_access com 3 ações na mesma
-- tela 'cobrancas': 'alterar'=vê tudo, 'aprovar'=restrito a 30 dias,
-- 'visualizar'=restrito a 60 dias — sem nenhuma marcação, a pessoa vê tudo
-- (mesmo comportamento de hoje pra quem não é Jurídico/Comercial).
--
-- Sem este backfill, ninguém ficaria travado (o padrão sem marcação é "vê
-- tudo"), mas o Jurídico e o Comercial passariam a ver MAIS dados do que
-- deveriam até alguém configurar manualmente — esta migration evita essa
-- janela replicando a restrição de hoje direto nos perfis Legado.
--
-- ROLLBACK: DELETE FROM perfil_acesso_permissao WHERE menu_codigo = 'cobrancas'
--   AND perfil_id IN (SELECT id FROM perfil_acesso WHERE nome IN ('Legado: juridico','Legado: comercial'));

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'cobrancas', 'aprovar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Legado: juridico'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'cobrancas' AND pap.acao = 'aprovar'
  );

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'cobrancas', 'visualizar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome = 'Legado: comercial'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'cobrancas' AND pap.acao = 'visualizar'
  );
