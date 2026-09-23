-- =========================================================================
-- Treinamentos: sai a tela "Importar alunos"
--
-- Pedido do Pablo em 22/09/2026 ("esse importar alunos pode tirar"). Desde a
-- 20260930000194 todo colaborador de EMPREGADOS já é aluno, pela
-- sincronização — a importação por planilha (herança do membox) ficou sem
-- uso. A tela, a rota e os links saíram do React.
--
--   • app_menu treinamentos_alunos_importar → ativo = false: some de
--     Administração › Acesso por Usuário, e can_access() nega menu inativo.
--     Desativado, não apagado: quem tinha a permissão não perde a linha se
--     um dia a tela voltar.
--   • As policies de TRN_ALUNO/TRN_ALUNO_TAG/TRN_MATRICULA que citam esse
--     código num OR continuam como estão — o ramo passa a dar falso e os
--     outros (treinamentos_alunos / _novo) seguem valendo.
--   • trn_importar_alunos fica no banco, sem tela chamando (a guarda dela
--     também aceita treinamentos_alunos/incluir).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

UPDATE public.app_menu
   SET ativo = false, updated_at = now()
 WHERE codigo = 'treinamentos_alunos_importar'
   AND ativo;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public.app_menu SET ativo = true, updated_at = now() WHERE codigo = 'treinamentos_alunos_importar';
-- (e restaurar src/pages/treinamentos/plataforma/AlunosImportar.tsx + rota/Sidebar pelo git)
