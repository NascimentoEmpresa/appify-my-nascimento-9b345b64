-- Causa raiz real (confirmada por teste direto no banco, reproduzindo o
-- payload exato do app): todo UPDATE ... RETURNING no Postgres também exige
-- que a linha resultante passe pela policy de SELECT (pa_select), não só
-- pela de UPDATE. A pa_select só concede acesso a uma ação
-- visibilidade='especifico' se já existir linha em
-- plano_acao_visibilidade_usuario para esse usuário NAQUELA ação. O app
-- (Detalhe.tsx) primeiro faz UPDATE em plano_acao mudando visibilidade pra
-- 'especifico', e SÓ DEPOIS insere as pessoas em
-- plano_acao_visibilidade_usuario (requisição separada). No instante do
-- UPDATE a lista ainda está vazia — a linha nova não passa no RETURNING e a
-- RLS rejeita, MESMO pra admin/pode_ver_todas, porque esses bypasses só
-- valiam dentro do ramo "privado" da pa_select, não fora dele.
--
-- Corrige tornando admin/criado_por/responsável/pode_ver_todas/
-- pode_administrar bypasses válidos independente de visibilidade — igual já
-- vale em plano_acao_visible_by_user. 'publico' e 'especifico'-por-lista
-- continuam como caminhos adicionais pra quem não tem acesso amplo.

DROP POLICY IF EXISTS pa_select ON public.plano_acao;
CREATE POLICY pa_select ON public.plano_acao
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR criado_por = auth.uid()
      OR responsavel_profile_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.plano_acao_usuario_permissao pap
         WHERE pap.profile_id = auth.uid()
           AND (pap.pode_ver_todas = true OR pap.pode_administrar = true)
      )
      OR visibilidade = 'publico'
      OR (
        visibilidade = 'especifico'
        AND EXISTS (
          SELECT 1 FROM public.plano_acao_visibilidade_usuario pav
           WHERE pav.plano_acao_id = plano_acao.id
             AND pav.profile_id = auth.uid()
        )
      )
    )
  );
