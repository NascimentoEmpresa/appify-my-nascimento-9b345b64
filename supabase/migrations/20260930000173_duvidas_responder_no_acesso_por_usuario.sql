-- =========================================================================
-- Parecer Jurídico: quem RESPONDE as dúvidas passa a ser o Acesso por Usuário
--
-- Pedido do Pablo (17/09/2026). Mesmo desenho da mig 119 (aprovar):
--
-- ANTES  respondia quem era do setor JURIDICO (Trabalhando) ou quem estava
--        em JUR_DUVIDAS_RESPONSAVEIS — tabela sem tela desde que o botão
--        "Quem aprova/responde" saiu (mig 119); não havia como mudar.
-- AGORA  responde quem tem a ação `responder` no menu `duvidas`, marcada em
--        Administração › Acesso por Usuário, ao lado de Alterar e Aprovar.
--        Vale para a resposta principal E para os complementos do fio
--        (mig 170) — as duas RLS usam pode_responder_duvida().
--
-- Quem já respondia não perde: setor JURIDICO com login e os de
-- JUR_DUVIDAS_RESPONSAVEIS com login ganham a linha em screen_permission_user.
-- JUR_DUVIDAS_RESPONSAVEIS fica no banco, sem uso.
--
-- O toggle da TELA não concede 'responder' (switch próprio, como 'aprovar'
-- em Diárias — ver src/lib/acoesDoToggleAcesso.ts); desligar a tela revoga.
--
-- ⚠ Precisa da mig 172 aplicada ANTES, em execução separada (valor novo de
-- enum não pode ser usado na transação em que foi criado).
--
-- Idempotente. Aplicada no banco do app em 17/09/2026.
-- =========================================================================

-- 1) A ação no menu que já existe (aparece como switch no Acesso por Usuário)
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('duvidas', 'responder'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- 2) A regra do banco (RLS de UPDATE/DELETE em JUR_DUVIDAS e de INSERT/DELETE
--    em JUR_DUVIDAS_COMPLEMENTOS usam esta função)
CREATE OR REPLACE FUNCTION public.pode_responder_duvida()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'duvidas', 'responder'::app_acao);
$fn$;

-- 3) Quem respondia continua respondendo
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT e.auth_user_id, 'duvidas', 'responder'::app_acao, true,
       'Migração 20260930000173: respondia pela regra antiga (setor JURIDICO / JUR_DUVIDAS_RESPONSAVEIS)'
  FROM public."EMPREGADOS" e
 WHERE e.auth_user_id IS NOT NULL
   AND e."Situação" = 'Trabalhando'
   AND (e."Setor_ERP" = 'JURIDICO'
        OR EXISTS (SELECT 1 FROM public."JUR_DUVIDAS_RESPONSAVEIS" r WHERE r.empregado_id = e."ID"))
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user s
      WHERE s.user_id = e.auth_user_id AND s.menu_codigo = 'duvidas' AND s.acao = 'responder'::app_acao);

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT p.email FROM public.screen_permission_user s JOIN public.profiles p ON p.id = s.user_id
--  WHERE s.menu_codigo = 'duvidas' AND s.acao = 'responder' AND s.allow;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Reaplicar pode_responder_duvida() da 20260629000003 (setor JURIDICO / JUR_DUVIDAS_RESPONSAVEIS);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'duvidas' AND acao = 'responder';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'duvidas' AND acao = 'responder';
-- NOTIFY pgrst, 'reload schema';
