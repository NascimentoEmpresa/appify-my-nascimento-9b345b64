-- =========================================================================
-- Mudança de Função: quem aprova, aprova SÓ os setores marcados
--
-- Pedido do Pablo em 16/09/2026: "na troca de função, em gerenciamento de
-- acesso por usuário, tem que ter quem aprova de qual setor — e somente
-- quem tem permissão pra aprovar do setor marcado vai poder aprovar".
--
-- Mesmo molde do Reembolso (CS_REEMBOLSO_APROVADOR_SETOR, migration 007):
-- um painel a mais em Administração › Acesso por Usuário, ao lado dos
-- menus de aprovação da Mudança de Função (operacional_troca_funcao /
-- escritorio_troca_funcao). Não é tela de permissão nova.
--
-- REGRA: na etapa de APROVAÇÃO (status "Pendente Operacional" ou "Pendente
-- Escritório"), a pessoa só decide (aprovar/reprovar) se o SETOR da
-- solicitação estiver entre os setores marcados pra ela. Opt-out: sem setor
-- marcado, não aprova nenhuma solicitação que tenha setor.
--   • Solicitação SEM setor (contrato, campo opcional) não tem o que casar:
--     continua governada só pelo menu, como hoje. Escritório sempre tem
--     setor (obrigatório desde 15/09/2026).
--   • Analista, SST e RH não mudam — o pedido foi sobre quem aprova.
--
-- A tabela SISTEMA_SOLICITACOES_TROCA_FUNCAO tem RLS aberta (quem gateia é o
-- menu), então a regra vai num trigger BEFORE UPDATE — vale pra tela e pra
-- qualquer outro caminho autenticado. Sem auth.uid() (service role,
-- automações) o trigger não interfere.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- 1) Quem aprova qual setor
CREATE TABLE IF NOT EXISTS public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor      text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, setor)
);
CREATE INDEX IF NOT EXISTS idx_stf_aprovador_setor_user
  ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR"(user_id);

ALTER TABLE public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" TO authenticated;

-- A própria configuração a pessoa vê (a tela diz "você aprova: X, Y"); a dos
-- outros é de quem administra acesso.
DROP POLICY IF EXISTS stf_aprovador_setor_select ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR";
CREATE POLICY stf_aprovador_setor_select ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar'));

-- Mesmo gate da tela de Gerenciamento de Acesso (podeGerenciar).
DROP POLICY IF EXISTS stf_aprovador_setor_write ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR";
CREATE POLICY stf_aprovador_setor_write ON public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR"
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

-- 2) Esta pessoa aprova troca de função deste setor?
--    Setor vazio → não há o que casar → true. Reusa a normalização do
--    Reembolso (acento/caixa) pra "Licitações" casar com "LICITACAO".
CREATE OR REPLACE FUNCTION public.stf_aprova_setor(_setor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.cs_reembolso_norm_setor(_setor) IS NULL
      OR EXISTS (
        SELECT 1 FROM public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR" a
         WHERE a.user_id = auth.uid()
           AND public.cs_reembolso_norm_setor(a.setor) = public.cs_reembolso_norm_setor(_setor)
      );
$fn$;
REVOKE ALL ON FUNCTION public.stf_aprova_setor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stf_aprova_setor(text) TO authenticated;

-- 3) O trigger que faz valer: decidir na etapa de aprovação exige o setor.
CREATE OR REPLACE FUNCTION public.stf_guard_aprovador_setor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;          -- service role / automação
  IF OLD.status IN ('Pendente Operacional', 'Pendente Escritório')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.stf_aprova_setor(OLD.setor) THEN
    RAISE EXCEPTION 'Você não aprova mudanças de função do setor "%". Peça ao administrador para marcar o setor em Acesso por Usuário.', coalesce(OLD.setor, '—')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_stf_guard_aprovador_setor ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_stf_guard_aprovador_setor
  BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.stf_guard_aprovador_setor();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_stf_guard_aprovador_setor ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
--   DROP FUNCTION IF EXISTS public.stf_guard_aprovador_setor();
--   DROP FUNCTION IF EXISTS public.stf_aprova_setor(text);
--   DROP TABLE IF EXISTS public."SISTEMA_TROCA_FUNCAO_APROVADOR_SETOR";
-- =========================================================================
