-- ============================================================================
-- SIS-2026-0740 — permite salvar a primeira resposta do checklist de Implantação
--
-- A tela salva toda resposta com UPSERT em `checklist_respostas`. Uma pergunta
-- ainda não respondida percorre o ramo INSERT do UPSERT, mesmo quando a pessoa
-- está apenas alterando/preenchendo o checklist que já pode editar.
--
-- A policy anterior exigia somente `incluir` no INSERT. Assim, quem tinha
-- `alterar` — a permissão usada no UPDATE — preenchia a resposta, mas recebia
-- "new row violates row-level security policy" ao tentar gravar a primeira
-- resposta daquela pergunta.
--
-- A linha de resposta não é um cadastro independente na interface: ela é o
-- suporte de persistência da edição do checklist. Por isso, `alterar` também
-- autoriza seu INSERT inicial. `incluir` continua autorizado e SELECT/UPDATE
-- permanecem inalterados. Os dois códigos de menu são mantidos para a rota
-- atual e a rota legada da mesma funcionalidade.
-- ============================================================================

DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
CREATE POLICY checklist_respostas_insert ON public.checklist_respostas
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'incluir'::app_acao)
          OR public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'alterar'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)
          OR public.can_access(auth.uid(), 'implantacao'::text, 'alterar'::app_acao)
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK — volta a exigir `incluir` para a criação inicial da resposta.
--
-- DROP POLICY IF EXISTS checklist_respostas_insert ON public.checklist_respostas;
-- CREATE POLICY checklist_respostas_insert ON public.checklist_respostas
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     (
--       SELECT public.can_access(auth.uid(), 'licitacoes.implantacao'::text, 'incluir'::app_acao)
--           OR public.can_access(auth.uid(), 'implantacao'::text, 'incluir'::app_acao)
--     )
--   );
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
