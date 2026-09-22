-- =========================================================================
-- Treinamentos: saem as TAGS de alunos
--
-- Pedido do Pablo em 22/09/2026 ("tira as tags, não vai precisar"). Herança
-- do membox, onde tag = posto/contrato; aqui o aluno já é o colaborador do
-- cadastro e a segmentação (ações em massa) é por contrato e status. Nenhuma
-- tag tinha sido criada (TRN_TAG, TRN_ALUNO_TAG e os públicos por tag de
-- aviso/notificação/evento estavam vazios em 22/09).
--
--   • app_menu treinamentos_alunos_tags → ativo = false (some de Acesso por
--     Usuário; can_access nega menu inativo). A tela, a rota, o seletor de
--     tags da ficha do aluno, o filtro/coluna/ações por tag da lista e a
--     opção "alunos com tags" do público de aviso/notificação/evento saíram
--     do React.
--   • As tabelas TRN_TAG / TRN_ALUNO_TAG / *_TAG ficam (vazias): as RPCs
--     antigas (trn_alunos_lista, trn_acao_massa, alcance) ainda as leem, e
--     derrubar exigiria reescrever todas sem ganho nenhum.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

UPDATE public.app_menu SET ativo = false, updated_at = now()
 WHERE codigo = 'treinamentos_alunos_tags' AND ativo;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.app_menu SET ativo = true, updated_at = now() WHERE codigo = 'treinamentos_alunos_tags';
