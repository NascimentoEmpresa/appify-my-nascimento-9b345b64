-- Complemento da migration 20260809000003 (que criou os menus
-- recrutamento_etapa_juridico/sst/compras): faltou dar a permissão
-- correspondente aos perfis "Legado: <cargo>" de quem tinha essa capacidade
-- via cargo antigo, senão ninguém que só tinha cargo (sem perfil novo
-- atribuído manualmente) consegue mover candidato na etapa dele.
--
-- ROLLBACK: DELETE FROM perfil_acesso_permissao WHERE menu_codigo IN
--   ('recrutamento_etapa_juridico','recrutamento_etapa_sst','recrutamento_etapa_compras')
--   AND acao = 'aprovar';

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu_codigo, 'aprovar', true
FROM public.perfil_acesso pa, (VALUES
  ('Legado: juridico',   'recrutamento_etapa_juridico'),
  ('Legado: sst',        'recrutamento_etapa_sst'),
  ('Legado: comprador',  'recrutamento_etapa_compras'),
  ('Legado: almoxarife', 'recrutamento_etapa_compras')
) AS x(perfil_nome, menu_codigo)
WHERE pa.nome = x.perfil_nome
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = x.menu_codigo AND pap.acao = 'aprovar'
  );
