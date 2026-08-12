-- =====================================================================
-- COMITÊ DE ÉTICA — módulo próprio para as denúncias
--
-- POR QUE
-- As denúncias moravam dentro de Central de Serviços, ao lado de reunião,
-- veículos e chamados. Denúncia não é atendimento ao colaborador: é assunto
-- de comitê, com acesso restrito e tratativa própria. Misturada no meio do
-- resto, a liberação do menu virava detalhe fácil de conceder sem pensar.
--
-- O QUE MUDA
--   1. Módulo `comite_etica`.
--   2. As duas telas de denúncia passam para ele, com o CÓDIGO PRESERVADO —
--      quem já tinha o menu liberado continua tendo, e a RLS de
--      CANAL_DENUNCIA (que aponta para 'central_servicos_canal_denuncias')
--      segue valendo sem precisar de outra migration.
--   3. Some o "(Canal de Ética)" do nome: a tela é a de Denúncias, e o canal
--      é o formulário público que alimenta ela.
--
-- Os códigos ficam com o prefixo antigo de propósito. Renomeá-los para
-- `comite_etica_*` obrigaria a remigrar screen_permission_user e a reescrever
-- a policy da tabela — risco sem retorno, já que código é identificador
-- interno e ninguém o vê na tela.
--
-- Idempotente.
-- =====================================================================

INSERT INTO public.app_modulo (codigo, nome, descricao, icone, ordem)
SELECT 'comite_etica', 'Comitê de Ética', 'Denúncias e apuração de conduta',
       'ShieldAlert',
       COALESCE((SELECT max(ordem) FROM public.app_modulo), 200) + 5
WHERE NOT EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'comite_etica');

-- Painel do canal próprio (o que recebe as denúncias do formulário público).
UPDATE public.app_menu am
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica'),
       nome      = 'Denúncias',
       rota      = '/app/comite-etica/denuncias',
       ordem     = 10
 WHERE am.codigo = 'central_servicos_canal_denuncias';

-- Espelho legado da Contato Seguro: fica no mesmo módulo, mas identificado
-- pela origem, senão as duas telas viram "Denúncias" e ninguém sabe qual é.
UPDATE public.app_menu am
   SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica'),
       nome      = 'Denúncias (Contato Seguro)',
       rota      = '/app/comite-etica/denuncias-contato-seguro',
       ordem     = 20
 WHERE am.codigo = 'central_servicos_denuncias';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT m.codigo AS modulo, am.codigo AS menu, am.nome, am.rota
  FROM public.app_menu am
  JOIN public.app_modulo m ON m.id = am.modulo_id
 WHERE am.codigo IN ('central_servicos_canal_denuncias', 'central_servicos_denuncias')
 ORDER BY am.ordem;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo='central_servicos'),
--          nome='Denúncias (Canal de Ética)', rota='/app/central-servicos/denuncias', ordem=50
--    WHERE codigo='central_servicos_denuncias';
--   UPDATE public.app_menu SET modulo_id = (SELECT id FROM public.app_modulo WHERE codigo='central_servicos'),
--          nome='Canal de Denúncias', rota='/app/central-servicos/canal-denuncias', ordem=55
--    WHERE codigo='central_servicos_canal_denuncias';
--   DELETE FROM public.app_modulo WHERE codigo='comite_etica';
-- =====================================================================
