-- =========================================================================
-- FORMULÁRIOS — VISUALIZAR RESPOSTAS: REGRA POR FORMULÁRIO
--
-- O PROBLEMA
--   As capacidades de leitura (`ver_tudo`, `ver_proprias`, `ver_setor`) eram
--   GLOBAIS: valiam para o catálogo inteiro. Marcar "Visualizar tudo" numa
--   pessoa abria TODAS as respostas de TODOS os formulários. Não havia como
--   dizer "a Anita vê tudo da Avaliação de Treinamentos, mas no Feedbacks só
--   vê o setor dela" — e é exatamente disso que a operação precisa.
--
-- O MODELO (decidido pelo Pablo, 21/08/2026)
--   A regra do formulário SUBSTITUI a geral naquele formulário. Não é soma:
--     * pessoa SEM regra própria no formulário X  → valem as capacidades
--       gerais, exatamente como hoje;
--     * pessoa COM regra própria no formulário X  → ali valem SÓ as marcadas
--       em X, mesmo que ela tenha `ver_tudo` no geral.
--   Assim dá para deixar o geral aberto e fechar um formulário sensível, ou o
--   contrário, sem inventar capacidade nova.
--
--   O que liga o override é uma linha MARCADORA `papel='ver_regra_form'`
--   (gravada quando o formulário entra na lista do usuário). Sem ela o
--   override não existiria quando o admin adiciona o formulário e deixa todos
--   os switches desligados — e "adicionei e desmarquei tudo, mas ela continua
--   vendo" seria a pior armadilha possível num painel de permissão.
--   Marcador presente + nenhum switch = não vê nada NAQUELE formulário.
--
-- ONDE MORA
--   Na própria "CS_FORM_ACESSOS", na coluna `formulario_id` que já existe (é a
--   mesma que a lista do botão "Acesso" usa desde 20260906000004). NÃO há
--   tabela nova de permissão — a regra do projeto é não espalhar estrutura de
--   acesso.
--
-- O QUE **NÃO** MUDA
--   * `editar_criar` / `encerrar_excluir` / `ver_lixeira` seguem globais. Quem
--     precisa de edição por formulário usa a lista do botão "Acesso"
--     (form_dono/form_gerenciar/form_editar/form_ver), que já faz isso.
--   * `criar_setor` (setor-dono do formulário) e a liderança de setor
--     (`cs_form_lidera_setor`) continuam ADITIVOS: são outra pergunta —
--     "este formulário/esta resposta é da minha área" —, não o recorte de
--     leitura que o painel controla.
--
-- ⚠ CORREÇÃO DE REGRESSÃO: a policy `cs_form_resp_select` recriada em
--   20260906000004 perdeu o ramo `cs_form_lidera_setor(setor)` que existia
--   desde 20260801000001 (o comentário "ANTES:" daquela migration transcreveu
--   a expressão sem ele). Gerente/diretor de setor parou de receber as
--   respostas do setor que lidera. Esta migration devolve o ramo.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) A coluna formulario_id passa a aceitar as capacidades de leitura ──
-- A constraint anterior amarrava `formulario_id IS NOT NULL` aos quatro papéis
-- da lista de acesso. Agora: os papéis da lista CONTINUAM obrigados a ter
-- formulário; os de leitura PODEM ter (geral quando NULL, do formulário quando
-- preenchido); o resto segue proibido de ter.
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_sem_form;
ALTER TABLE public."CS_FORM_ACESSOS" DROP CONSTRAINT IF EXISTS cs_form_acessos_form_por_papel;
ALTER TABLE public."CS_FORM_ACESSOS" ADD  CONSTRAINT cs_form_acessos_form_por_papel
  CHECK (
    CASE
      WHEN papel IN ('form_dono','form_gerenciar','form_editar','form_ver') THEN formulario_id IS NOT NULL
      WHEN papel IN ('ver_tudo','ver_proprias','ver_setor','ver_regra_form') THEN true
      ELSE formulario_id IS NULL
    END
  );

-- ── 2) Unicidade ─────────────────────────────────────────────────────────
-- O índice da lista de acesso cobria (user_id, formulario_id) para QUALQUER
-- linha com formulário — o que impediria a mesma pessoa de ter mais de uma
-- capacidade de leitura no mesmo formulário. Restringe-se aos papéis da lista.
DROP INDEX IF EXISTS cs_form_acessos_unq_form;
CREATE UNIQUE INDEX cs_form_acessos_unq_form
  ON public."CS_FORM_ACESSOS"(user_id, formulario_id)
  WHERE papel IN ('form_dono','form_gerenciar','form_editar','form_ver');

-- Uma linha por (usuário, papel, formulário) nas capacidades sem setor.
DROP INDEX IF EXISTS cs_form_acessos_unq_cap_form;
CREATE UNIQUE INDEX cs_form_acessos_unq_cap_form
  ON public."CS_FORM_ACESSOS"(user_id, papel, formulario_id)
  WHERE formulario_id IS NOT NULL AND papel IN ('ver_tudo','ver_proprias','ver_regra_form');

-- ver_setor: o índice antigo era (user_id, setor) e valia para a linha geral.
-- Agora existem os dois mundos — o geral (formulario_id NULL) e o do
-- formulário —, e NULL em índice único não colide com NULL, então são dois
-- índices parciais em vez de um com a coluna nula.
DROP INDEX IF EXISTS cs_form_acessos_unq_setor;
CREATE UNIQUE INDEX cs_form_acessos_unq_setor
  ON public."CS_FORM_ACESSOS"(user_id, setor)
  WHERE papel = 'ver_setor' AND formulario_id IS NULL;

DROP INDEX IF EXISTS cs_form_acessos_unq_setor_form;
CREATE UNIQUE INDEX cs_form_acessos_unq_setor_form
  ON public."CS_FORM_ACESSOS"(user_id, setor, formulario_id)
  WHERE papel = 'ver_setor' AND formulario_id IS NOT NULL;

-- ── 3) Helpers ───────────────────────────────────────────────────────────
-- SECURITY DEFINER como as irmãs: a policy de CS_FORM_ACESSOS pergunta a
-- CS_FORM_ACESSOS, e sem isso a leitura entra em recursão.

-- Este formulário tem regra própria de leitura para MIM? É o que liga o
-- override — e é o marcador, não a existência de switches ligados.
CREATE OR REPLACE FUNCTION public.cs_form_regra_propria(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _form IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.user_id = auth.uid()
       AND a.formulario_id = _form
       AND a.papel = 'ver_regra_form');
$$;

-- A capacidade de leitura que VALE neste formulário.
--   com regra própria → só o que está marcado no formulário;
--   sem regra própria → a capacidade geral, como sempre foi.
CREATE OR REPLACE FUNCTION public.cs_form_cap_ver(_form uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.cs_form_regra_propria(_form) THEN EXISTS (
      SELECT 1 FROM public."CS_FORM_ACESSOS" a
       WHERE a.user_id = auth.uid() AND a.formulario_id = _form AND a.papel = _cap)
    ELSE public.cs_form_cap(_cap)
  END;
$$;

-- Mesma régua para o recorte por setor do respondente.
CREATE OR REPLACE FUNCTION public.cs_form_cap_setor_em(_form uuid, _setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.cs_form_regra_propria(_form) THEN _setor IS NOT NULL AND EXISTS (
      SELECT 1 FROM public."CS_FORM_ACESSOS" a
       WHERE a.user_id = auth.uid() AND a.formulario_id = _form AND a.papel = 'ver_setor'
         AND upper(btrim(a.setor)) = upper(btrim(_setor)))
    ELSE public.cs_form_cap_setor(_setor)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.cs_form_regra_propria(uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_ver(uuid, text)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor_em(uuid, text)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_regra_propria(uuid)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_ver(uuid, text)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_setor_em(uuid, text)   TO authenticated;

-- ── 4) A policy de leitura das respostas ─────────────────────────────────
-- Mesma estrutura de 20260906000004; o que muda é que os três ramos de
-- capacidade passam a perguntar "…NESTE formulário". O ramo da liderança
-- volta (ver o aviso de regressão no cabeçalho).
DROP POLICY IF EXISTS cs_form_resp_select ON public."CS_FORM_RESPOSTAS";
CREATE POLICY cs_form_resp_select ON public."CS_FORM_RESPOSTAS" FOR SELECT TO authenticated
  USING (
    (NOT public.cs_form_lista_exclui(formulario_id)
      AND (
        public.cs_form_cap_ver(formulario_id, 'ver_tudo')
        OR (public.cs_form_cap_ver(formulario_id, 'ver_proprias')
            AND public.cs_form_minha_resposta(criado_por, respondente_nome))
        OR public.cs_form_cap_setor_em(formulario_id, setor)
        OR public.cs_form_cap_form_setor(formulario_id)   -- setor-dono: aditivo
        OR public.cs_form_lidera_setor(setor)             -- gerente/diretor: aditivo
      ))
    OR public.cs_form_pode(formulario_id, 'ver')
  );

-- ── 5) A chave-mestra também respeita a regra do formulário ──────────────
-- `cs_form_pode(_form,'ver')` deixava quem tem `ver_tudo` global ler qualquer
-- formulário, inclusive um com lista restrita. Se a pessoa tem regra própria
-- no formulário, é ela que vale — senão o override seria contornado por aqui.
-- 'acesso' NÃO muda: continua sendo a válvula de escape para reatribuir
-- formulário órfão (dono desligado da empresa), e isso não é ler resposta.
CREATE OR REPLACE FUNCTION public.cs_form_pode(_form uuid, _cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _form IS NULL THEN false
    WHEN _cap = 'ver'    AND public.cs_form_cap_ver(_form, 'ver_tudo') THEN true
    WHEN _cap = 'acesso' AND public.cs_form_cap('ver_tudo')            THEN true
    ELSE coalesce(
      CASE _cap
        WHEN 'ver'     THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar','form_ver')
        WHEN 'editar'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar','form_editar')
        WHEN 'excluir' THEN public.cs_form_papel_no_form(_form) =  'form_dono'
        WHEN 'acesso'  THEN public.cs_form_papel_no_form(_form) IN ('form_dono','form_gerenciar')
                         OR (NOT public.cs_form_tem_lista(_form)
                             AND (public.cs_form_cap('editar_criar') OR public.cs_form_cap('encerrar_excluir')))
        ELSE false
      END, false)
  END;
$$;

-- `cs_form_papel_no_form` pegava a PRIMEIRA linha da pessoa naquele formulário,
-- qualquer que fosse o papel. Com as linhas de leitura por formulário, uma
-- pessoa de fora da lista de acesso passaria a devolver 'ver_tudo' aqui — e
-- `cs_form_lista_exclui` concluiria que ela está na lista, furando o modo
-- restrito. O papel da LISTA é só um dos quatro.
CREATE OR REPLACE FUNCTION public.cs_form_papel_no_form(_form uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.papel FROM public."CS_FORM_ACESSOS" a
   WHERE a.formulario_id = _form AND a.user_id = auth.uid()
     AND a.papel IN ('form_dono','form_gerenciar','form_editar','form_ver')
   LIMIT 1;
$$;

-- `cs_form_tem_lista` conta QUALQUER linha do formulário — e agora existem
-- linhas de leitura por formulário, que não são lista de acesso. Sem esta
-- correção, dar "ver_tudo só neste formulário" para alguém ligaria o modo
-- restrito do formulário e tiraria todo mundo que não estivesse na lista.
CREATE OR REPLACE FUNCTION public.cs_form_tem_lista(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.formulario_id = _form
       AND a.papel IN ('form_dono','form_gerenciar','form_editar','form_ver'));
$$;

-- ── 6) Conferência ───────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE formulario_id IS NULL)     AS grants_gerais,
       count(*) FILTER (WHERE formulario_id IS NOT NULL) AS grants_por_formulario
  FROM public."CS_FORM_ACESSOS"
 WHERE papel IN ('ver_tudo','ver_proprias','ver_setor','ver_regra_form');

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DELETE FROM public."CS_FORM_ACESSOS"
--    WHERE formulario_id IS NOT NULL
--      AND papel IN ('ver_tudo','ver_proprias','ver_setor','ver_regra_form');
--   DROP FUNCTION IF EXISTS public.cs_form_cap_setor_em(uuid, text);
--   DROP FUNCTION IF EXISTS public.cs_form_cap_ver(uuid, text);
--   DROP FUNCTION IF EXISTS public.cs_form_regra_propria(uuid);
--   DROP INDEX IF EXISTS cs_form_acessos_unq_cap_form;
--   DROP INDEX IF EXISTS cs_form_acessos_unq_setor_form;
--   (e recriar constraint/índices/policy/funções como em 20260906000004)
-- =========================================================================
