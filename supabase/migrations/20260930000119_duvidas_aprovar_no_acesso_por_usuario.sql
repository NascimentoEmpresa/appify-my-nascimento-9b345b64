-- =========================================================================
-- Parecer Jurídico: quem APROVA as dúvidas passa a ser o Acesso por Usuário
--
-- Pedido do Pablo em 15/09/2026: "colocar no gerenciamento de acesso já
-- existente a permissão de quem aprova os pareceres jurídicos, e tirar o
-- botão 'Quem aprova/responde' da tela".
--
-- ANTES  aprovava quem era do setor DIRETOR ADMINISTRATIVO ou quem estava
--        em JUR_DUVIDAS_APROVADORES (tabela própria, gerida por um botão na
--        tela — o único lugar do ERP com um segundo gerenciamento de acesso).
-- AGORA  aprova quem tem a ação `aprovar` no menu `duvidas` (Parecer
--        Jurídico), marcada em Administração › Acesso por Usuário, igual a
--        tudo o mais. Sem menu novo: a ação entra no menu que já existe.
--
-- Quem já aprovava não perde: os do setor DIRETOR ADMINISTRATIVO com login
-- e os de JUR_DUVIDAS_APROVADORES com login ganham a linha em
-- screen_permission_user. (Medido em 15/09/2026: 1 diretor, 0 na tabela.)
-- JUR_DUVIDAS_APROVADORES fica no banco, sem uso — a tela não escreve mais.
--
-- Quem RESPONDE não muda (setor JURIDICO ou JUR_DUVIDAS_RESPONSAVEIS): o
-- pedido foi só sobre aprovar, e não há ação "responder" no enum.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) A ação no menu que já existe
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('duvidas', 'aprovar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- 2) A regra do banco (RLS de UPDATE em JUR_DUVIDAS usa esta função)
CREATE OR REPLACE FUNCTION public.pode_aprovar_duvida()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'duvidas', 'aprovar'::app_acao);
$fn$;

-- 3) Quem aprovava continua aprovando
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT e.auth_user_id, 'duvidas', 'aprovar'::app_acao, true,
       'Migração 20260930000119: aprovava pela regra antiga (setor Diretor Administrativo / JUR_DUVIDAS_APROVADORES)'
  FROM public."EMPREGADOS" e
 WHERE e.auth_user_id IS NOT NULL
   AND e."Situação" = 'Trabalhando'
   AND (e."Setor_ERP" = 'DIRETOR ADMINISTRATIVO'
        OR EXISTS (SELECT 1 FROM public."JUR_DUVIDAS_APROVADORES" a WHERE a.empregado_id = e."ID"))
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user s
      WHERE s.user_id = e.auth_user_id AND s.menu_codigo = 'duvidas' AND s.acao = 'aprovar'::app_acao);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT p.email FROM public.screen_permission_user s JOIN public.profiles p ON p.id = s.user_id
--  WHERE s.menu_codigo = 'duvidas' AND s.acao = 'aprovar' AND s.allow;

-- ROLLBACK
-- Recriar pode_aprovar_duvida() com a regra antiga (setor / JUR_DUVIDAS_APROVADORES);
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'duvidas' AND acao = 'aprovar';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'duvidas' AND acao = 'aprovar' AND motivo LIKE 'Migração 20260930000119%';
