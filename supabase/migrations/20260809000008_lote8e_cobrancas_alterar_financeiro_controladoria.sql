-- Lote 8e: a edge function regua-cobranca-aprovar (aprovar/rejeitar envio de
-- régua de cobrança) precisa checar "esta pessoa tem algum acesso real a
-- cobranças" via can_access — mas a tela NotasAbertoTab.tsx (Lote 8d) só
-- registrou 'aprovar' em Legado: juridico e 'visualizar' em Legado: comercial;
-- Financeiro/Controladoria nunca ganharam nada explícito em 'cobrancas'
-- porque, no frontend, o "vê tudo" deles vem só do fallback de código (sem
-- nenhuma marcação = vê tudo), não de um grant real no banco. Pra uma
-- edge function poder checar isso via can_access, precisa existir de fato.
--
-- ROLLBACK: DELETE FROM perfil_acesso_permissao WHERE menu_codigo = 'cobrancas'
--   AND acao = 'alterar'
--   AND perfil_id IN (SELECT id FROM perfil_acesso WHERE nome IN ('Legado: financeiro','Legado: controladoria'));

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'cobrancas', 'alterar'::public.app_acao, true
FROM public.perfil_acesso pa
WHERE pa.nome IN ('Legado: financeiro', 'Legado: controladoria')
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'cobrancas' AND pap.acao = 'alterar'
  );
