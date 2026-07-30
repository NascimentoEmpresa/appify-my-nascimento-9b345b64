-- Mesmo padrão de bug encontrado em "Legado: operacional" (20260809000004):
-- "Legado: treinamentos" também estava sem nenhuma linha para
-- recrutamento_gestao. Só não travou ninguém em produção até agora porque o
-- único usuário com cargo 'treinamentos' também tem "Administrador Geral"
-- (concede_tudo) — mas outras contas administrativas que dependem só de
-- "Legado: treinamentos" (ex: senior@) ficariam sem 'alterar' em
-- recrutamento_gestao ao migrar Recrutamento.tsx pra can_access.
--
-- ROLLBACK: DELETE FROM perfil_acesso_permissao
--   WHERE perfil_id = (SELECT id FROM perfil_acesso WHERE nome = 'Legado: treinamentos')
--     AND menu_codigo = 'recrutamento_gestao';

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'recrutamento_gestao', x.acao::public.app_acao, true
FROM public.perfil_acesso pa, (VALUES ('visualizar'), ('alterar'), ('aprovar')) AS x(acao)
WHERE pa.nome = 'Legado: treinamentos'
  AND NOT EXISTS (
    SELECT 1 FROM public.perfil_acesso_permissao pap
    WHERE pap.perfil_id = pa.id AND pap.menu_codigo = 'recrutamento_gestao' AND pap.acao = x.acao::public.app_acao
  );
