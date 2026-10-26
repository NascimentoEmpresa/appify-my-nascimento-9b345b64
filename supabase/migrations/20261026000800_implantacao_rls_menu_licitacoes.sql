-- =====================================================================
-- [SEM-CHAMADO] — Implantação de Contratos aparece vazia pra todo mundo
--
-- SINTOMA
--   /app/licitacoes/implantacao mostra "Nenhum contrato" (0 contratos, 0/64
--   itens) mesmo com 17 implantacao_contrato no banco.
--
-- CAUSA
--   Existem DOIS menus de Implantação ativos em app_menu:
--     • 'implantacao'            (módulo Contratos, rota antiga
--                                 /app/contratos/implantacao)
--     • 'licitacoes.implantacao' (módulo Licitações, rota
--                                 /app/licitacoes/implantacao — a tela real,
--                                 a do menu lateral)
--   A 20260718100006 amarrou a RLS de implantacao_contrato e respostas ao
--   código 'implantacao'. Mas o Gerenciamento de Acesso hoje concede o acesso
--   no 'licitacoes.implantacao' (22 usuários com visualizar = true). No
--   'implantacao' só existem linhas allow = false e nenhum perfil concede —
--   can_access('implantacao', ...) é false pra todos. A tela abre (o guard da
--   rota usa o código novo), mas o SELECT volta vazio.
--   (O checklist e o painel de origem têm o mesmo problema — ja corrigido nas 20261014000005 e 20261021000080.)
--
-- O QUE MUDA
--   As policies de SELECT/INSERT/UPDATE de implantacao_contrato
--   passam a aceitar o menu REAL ('licitacoes.implantacao') OU o antigo
--   ('implantacao'). O antigo fica como alternativa pra não tirar o acesso de
--   ninguém que o receba depois; hoje não concede nada a ninguém.
--
-- NÃO MUDA
--   • DELETE de implantacao_contrato continua como está (ainda filtra por
--     user_empresa) — fora do escopo desta correção.
--   • Quem enxerga continua sendo decidido no Gerenciamento de Acesso. Observação
--     de negócio: no menu novo só 4 usuários têm incluir/alterar; os demais
--     (view-only) enxergam a lista mas não gravam resposta de checklist até
--     receberem essas ações lá.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── implantacao_contrato ─────────────────────────────────────────────
DROP POLICY IF EXISTS implantacao_select ON public.implantacao_contrato;
CREATE POLICY implantacao_select ON public.implantacao_contrato FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'licitacoes.implantacao', 'visualizar'::app_acao)
    OR public.can_access(auth.uid(), 'implantacao', 'visualizar'::app_acao)
  );

DROP POLICY IF EXISTS implantacao_insert ON public.implantacao_contrato;
CREATE POLICY implantacao_insert ON public.implantacao_contrato FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'licitacoes.implantacao', 'incluir'::app_acao)
    OR public.can_access(auth.uid(), 'implantacao', 'incluir'::app_acao)
  );

DROP POLICY IF EXISTS implantacao_update ON public.implantacao_contrato;
CREATE POLICY implantacao_update ON public.implantacao_contrato FOR UPDATE TO authenticated
  USING (
    public.can_access(auth.uid(), 'licitacoes.implantacao', 'alterar'::app_acao)
    OR public.can_access(auth.uid(), 'implantacao', 'alterar'::app_acao)
  );

-- A tabela `respostas` (legada) NÃO é a que a tela usa hoje — o checklist grava em
-- `checklist_respostas`, e o painel de origem lê implantacao_origem_contrato().
-- As duas ficaram presas ao menu 'implantacao' pela 20260930000275 e são
-- corrigidas depois (20261014000005 e 20261021000080). `respostas` fica como está.

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (volta ao estado da 20260718100006)
--   DROP POLICY IF EXISTS implantacao_select ON public.implantacao_contrato;
--   CREATE POLICY implantacao_select ON public.implantacao_contrato FOR SELECT TO authenticated
--     USING (public.can_access(auth.uid(), 'implantacao', 'visualizar'::app_acao));
--   DROP POLICY IF EXISTS implantacao_insert ON public.implantacao_contrato;
--   CREATE POLICY implantacao_insert ON public.implantacao_contrato FOR INSERT TO authenticated
--     WITH CHECK (public.can_access(auth.uid(), 'implantacao', 'incluir'::app_acao));
--   DROP POLICY IF EXISTS implantacao_update ON public.implantacao_contrato;
--   CREATE POLICY implantacao_update ON public.implantacao_contrato FOR UPDATE TO authenticated
--     USING (public.can_access(auth.uid(), 'implantacao', 'alterar'::app_acao));
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
