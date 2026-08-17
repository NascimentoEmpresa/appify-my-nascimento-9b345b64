-- =========================================================================
-- FORMULARIOS — ACESSO POR FORMULARIO (botao "Acesso" em cada card)
--
-- Ate aqui as capacidades eram GLOBAIS: quem tinha 'editar_criar' editava
-- TODOS os formularios. Nao havia como dizer "este formulario e so a
-- Fulana que administra". Esta migration cria a lista por formulario.
--
-- ONDE MORA: na propria "CS_FORM_ACESSOS", usando a coluna `formulario_id`
-- que ja existia (sobra do modelo antigo 'visualiza', hoje 100% nula — 0
-- linhas em 17/08/2026). NAO ha tabela nova de permissao: a regra do
-- projeto e nao espalhar estrutura de acesso.
--
-- PAPEIS POR FORMULARIO (formulario_id NOT NULL):
--   form_dono       ver + editar + excluir + gerenciar acesso
--   form_gerenciar  ver + editar +           gerenciar acesso
--   form_editar     ver + editar
--   form_ver        ver
--
-- COMO A LISTA AGE (decisao do Pablo, 17/08/2026):
--   * Formulario SEM lista  -> nada muda, valem as regras globais de hoje.
--   * Formulario COM lista  -> a lista RESTRINGE: quem nao esta nela perde
--     o formulario, mesmo tendo 'editar_criar' global. E o unico jeito de
--     "deixar pra apenas uma pessoa".
--   * Chave-mestra: quem tem 'ver_tudo' global SEMPRE le as respostas e
--     SEMPRE consegue abrir/reatribuir a lista. E a valvula de escape para
--     dono desligado da empresa — sem ela, formulario orfao so voltaria com
--     SQL na mao.
--
-- Repare que 'ver_tudo' NAO da direito de editar: ele reatribui o acesso e
-- le, mas para mexer no formulario tem que se colocar como dono. E de
-- proposito — a chave-mestra e para destravar, nao para trabalhar.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;
--   ALTER TABLE public."CS_FORM_ACESSOS" ADD CONSTRAINT cs_form_acessos_sem_form CHECK (formulario_id IS NULL);
--   DELETE FROM public."CS_FORM_ACESSOS" WHERE formulario_id IS NOT NULL;
--   (e recriar as 4 policies com as expressoes anteriores, anotadas em cada bloco abaixo)
-- =========================================================================

-- ── 1) Liberar a coluna formulario_id ────────────────────────────────────
-- A constraint antiga proibia QUALQUER linha por formulario. A nova mantem
-- a mesma garantia para os papeis globais (eles seguem obrigados a ter
-- formulario_id NULL) e abre a excecao so para os papeis novos.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_sem_form;
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_form_por_papel
  CHECK ((formulario_id IS NOT NULL) = (papel IN ('form_dono','form_gerenciar','form_editar','form_ver')));

-- Uma pessoa tem UM papel por formulario. O indice antigo era
-- (papel, user_id, formulario_id), que deixaria a mesma pessoa ser dono E
-- so-ver no mesmo formulario — dois papeis brigando na mesma pergunta.
DROP INDEX IF EXISTS cs_form_acessos_unq_form;
CREATE UNIQUE INDEX cs_form_acessos_unq_form
  ON public."CS_FORM_ACESSOS"(user_id, formulario_id) WHERE formulario_id IS NOT NULL;

-- ── 2) Helpers ───────────────────────────────────────────────────────────
-- Todos SECURITY DEFINER: alem de padronizar, e o que evita recursao
-- infinita quando a policy de CS_FORM_ACESSOS pergunta a CS_FORM_ACESSOS
-- quem pode escrever nela.

-- Meu papel NESTE formulario (null = nao estou na lista).
CREATE OR REPLACE FUNCTION public.cs_form_papel_no_form(_form uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.papel FROM public."CS_FORM_ACESSOS" a
   WHERE a.formulario_id = _form AND a.user_id = auth.uid()
   LIMIT 1;
$$;

-- O formulario tem lista propria? (define se o modo restrito esta ligado)
CREATE OR REPLACE FUNCTION public.cs_form_tem_lista(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a WHERE a.formulario_id = _form);
$$;

-- A lista deste formulario esta me deixando de fora? Usada para PODAR as
-- regras globais — e por isso que ela responde `false` quando nao ha lista.
CREATE OR REPLACE FUNCTION public.cs_form_lista_exclui(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _form IS NOT NULL
     AND public.cs_form_tem_lista(_form)
     AND public.cs_form_papel_no_form(_form) IS NULL;
$$;

-- Capacidade efetiva neste formulario. _cap: ver | editar | excluir | acesso
CREATE OR REPLACE FUNCTION public.cs_form_pode(_form uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _form IS NULL THEN false
    -- Chave-mestra: le tudo e sempre consegue reatribuir. Nao inclui
    -- 'editar'/'excluir' de proposito.
    WHEN _cap IN ('ver','acesso') AND public.cs_form_cap('ver_tudo') THEN true
    ELSE coalesce(
      CASE _cap
        WHEN 'ver'     THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar','form_ver')
        WHEN 'editar'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar')
        WHEN 'excluir' THEN public.cs_form_papel_no_form(_form) =  'form_dono'
        WHEN 'acesso'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar')
                         -- Sem lista ainda: quem ja administra hoje e quem
                         -- cria a primeira linha. Sem isto o botao "Acesso"
                         -- nasceria util para ninguem.
                         OR (NOT public.cs_form_tem_lista(_form)
                             AND (public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir')))
        ELSE false
      END, false)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_papel_no_form(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_tem_lista(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_lista_exclui(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_pode(uuid, text)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_papel_no_form(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_tem_lista(uuid)     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_lista_exclui(uuid)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_pode(uuid, text)    TO authenticated;

-- ── 3) Policies ──────────────────────────────────────────────────────────
-- O padrao em todas: a expressao de HOJE fica intacta, so ganha o freio
-- `AND NOT cs_form_lista_exclui(...)`; e a lista entra como um OR novo.
-- Formulario sem lista cai exatamente no comportamento anterior.

-- ANTES: USING/CHECK (cs_form_cap('editar_criar') OR cs_form_cap('encerrar_excluir'))
DROP POLICY IF EXISTS cs_forms_update ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_update ON public."CS_FORMULARIOS" FOR UPDATE TO authenticated
  USING (
    ((public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir'))
      AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'editar')
  )
  WITH CHECK (
    ((public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir'))
      AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'editar')
  );

-- ANTES: USING cs_form_cap('encerrar_excluir')
DROP POLICY IF EXISTS cs_forms_delete ON public."CS_FORMULARIOS";
CREATE POLICY cs_forms_delete ON public."CS_FORMULARIOS" FOR DELETE TO authenticated
  USING (
    (public.cs_form_cap('encerrar_excluir') AND NOT public.cs_form_lista_exclui(id))
    OR public.cs_form_pode(id, 'excluir')
  );

-- ANTES: USING (cs_form_cap('ver_tudo') OR (cs_form_cap('ver_proprias') AND
--        cs_form_minha_resposta(criado_por, respondente_nome)) OR
--        cs_form_cap_setor(setor) OR cs_form_cap_form_setor(formulario_id))
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS" FOR SELECT TO authenticated
  USING (
    (NOT public.cs_form_lista_exclui(formulario_id)
      AND (
        public.cs_form_cap('ver_tudo')
        OR (public.cs_form_cap('ver_proprias') AND public.cs_form_minha_resposta(criado_por, respondente_nome))
        OR public.cs_form_cap_setor(setor)
        OR public.cs_form_cap_form_setor(formulario_id)
      ))
    OR public.cs_form_pode(formulario_id, 'ver')
  );

-- CS_FORM_ACESSOS: dono/gerenciar do formulario passam a escrever as linhas
-- DAQUELE formulario. A clausula global antiga fica intacta — quem
-- administra em Acesso por Usuario continua podendo tudo.
-- ANTES (nas 3): ((papel='dashboard' AND user_id=auth.uid()) OR
--        (papel<>'dashboard' AND can_access(auth.uid(),'central_servicos_formularios','alterar')))
DROP POLICY IF EXISTS cs_form_acessos_insert ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_insert ON public."CS_FORM_ACESSOS" FOR INSERT TO authenticated
  WITH CHECK (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

DROP POLICY IF EXISTS cs_form_acessos_update ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_update ON public."CS_FORM_ACESSOS" FOR UPDATE TO authenticated
  USING (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  )
  WITH CHECK (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

DROP POLICY IF EXISTS cs_form_acessos_delete ON public."CS_FORM_ACESSOS";
CREATE POLICY cs_form_acessos_delete ON public."CS_FORM_ACESSOS" FOR DELETE TO authenticated
  USING (
    ((papel = 'dashboard') AND (user_id = auth.uid()))
    OR ((papel <> 'dashboard') AND public.can_access(auth.uid(), 'central_servicos_formularios', 'alterar'))
    OR (formulario_id IS NOT NULL AND public.cs_form_pode(formulario_id, 'acesso'))
  );

NOTIFY pgrst, 'reload schema';
