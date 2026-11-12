-- =========================================================================
-- LOGIN DO GITHUB DA THAMIRES → PESSOA (13/11/2026)
--
-- Complemento da mig 20261112230000 (auditoria da Bonificação, item 1
-- aprovado pelo Iury: todo chamado entra do mesmo jeito). As Edges
-- chamado-vincular-pr e chamado-concluir-pr leem "DEV_GITHUB_USUARIO"; sem
-- esta linha, a PR da Thamires (controladoriathamires-hub) não concluiria
-- nem vincularia o chamado — o mesmo desvio que existia com Pablo e Otavio.
-- O profile_id é o responsável pelos chamados dela em CHAMADO_SISTEMA.
-- =========================================================================
SET lock_timeout = '5s';

INSERT INTO public."DEV_GITHUB_USUARIO" (login, profile_id)
SELECT 'controladoriathamires-hub', '0cc9cfd8-9427-420f-95aa-7b2491d797b0'::uuid
 WHERE NOT EXISTS (SELECT 1 FROM public."DEV_GITHUB_USUARIO" WHERE lower(login) = 'controladoriathamires-hub');

-- Conferência:
--   SELECT login, profile_id FROM public."DEV_GITHUB_USUARIO" ORDER BY 1;

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public."DEV_GITHUB_USUARIO" WHERE login = 'controladoriathamires-hub';
-- =========================================================================
