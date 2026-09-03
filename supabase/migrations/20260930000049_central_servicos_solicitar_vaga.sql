-- =====================================================================
-- CENTRAL DE SERVIÇOS › SOLICITAR VAGA
--
-- Terceira porta para abrir vaga, e a primeira pensada para o ESCRITÓRIO.
-- As outras duas continuam como estão:
--   • Encarregados › Solicitar Vaga  → copia cargo/contrato/escala/salário do
--     cadastro de um colaborador. Não tem (nem passa a ter) preenchimento à
--     mão: vaga do escritório não é o pedido do encarregado.
--   • RH › Gestão de Recrutamento    → o formulário completo, com "Preencher
--     manualmente" e o vínculo com o catálogo de Suprimentos.
--
-- Esta tela mostra EXATAMENTE o formulário da Gestão de Recrutamento (mesmo
-- componente React: components/recrutamento/ModalNovaVaga.tsx), mas sem
-- exigir acesso ao módulo de Recrutamento inteiro — quem só pede vaga não
-- precisa ver a fila, o kanban nem os candidatos.
--
-- UM MENU NOVO, NENHUMA CAPACIDADE NOVA. Quem libera o preenchimento à mão
-- continua sendo `recrutamento_vaga_administrativa`, que já existe e também
-- governa o checkbox "Vaga é administrativa?".
--
-- As policies abaixo só GANHAM um OR com o menu novo — nenhuma condição
-- existente foi afrouxada ou removida.
--
-- Idempotente: pode rodar mais de uma vez.
-- =====================================================================

-- 1) Menu ---------------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('central_servicos_solicitar_vaga', 'Solicitar Vaga', '/app/central-servicos/solicitar-vaga', 65)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Ativo mesmo se a linha já existisse desativada: can_access() devolve false
-- para menu inativo ANTES de olhar perfil, e nem o Administrador Geral escapa.
UPDATE public.app_menu SET ativo = true
 WHERE codigo = 'central_servicos_solicitar_vaga';

-- 2) RLS ----------------------------------------------------------------

-- 2.1) A vaga em si. Mantém a trava da vaga administrativa em pé: marcar uma
-- vaga como administrativa continua exigindo a capacidade de vê-las, senão
-- qualquer um criaria uma vaga que some da própria vista.
-- R3: cada DROP tem o CREATE correspondente logo em seguida.
DROP POLICY IF EXISTS sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO";
CREATE POLICY sistema_recrutamento_gate ON public."SISTEMA_RECRUTAMENTO"
  FOR ALL TO authenticated
  USING (
    (has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'visualizar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga'::text, 'visualizar'::app_acao))
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  )
  WITH CHECK (
    (has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'recrutamento_gestao'::text, 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'incluir'::app_acao)
      OR has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes'::text, 'alterar'::app_acao)
      OR has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga'::text, 'incluir'::app_acao))
    AND (NOT administrativa
      OR has_screen_access(auth.uid(), 'recrutamento_vaga_administrativa'::text, 'visualizar'::app_acao))
  );

-- 2.2) Busca do colaborador de referência (etapa 1 do formulário).
-- A lista de códigos é a da 20260717190010, com o menu novo somado ao fim.
DROP POLICY IF EXISTS erp_auth_read_empregados ON public."EMPREGADOS";
CREATE POLICY erp_auth_read_empregados ON public."EMPREGADOS" FOR SELECT TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'sst_aso', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'candidatos', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'patrimonios', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'duvidas', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_formularios', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
);

-- 2.3) Nome do contrato do colaborador escolhido (tabela legada "CONTRATOS").
DROP POLICY IF EXISTS contratos_gate ON public."CONTRATOS";
CREATE POLICY contratos_gate ON public."CONTRATOS" FOR SELECT TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'colaboradores', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
);

-- 2.4) Catálogo de Suprimentos (posto → função) — LEITURA apenas.
-- É o vínculo que define uniformes e EPIs da admissão, e é obrigatório no
-- formulário; sem estas duas linhas os selects chegam vazios e a vaga não
-- passa da etapa 1. A escrita do catálogo (sup_*_write) fica intocada:
-- continua exigindo 'sup_catalogo' + 'alterar'.
--
-- ⚠️ TABELAS DE OUTRO MÓDULO (Suprimentos). Avise o responsável.
DROP POLICY IF EXISTS sup_posto_select ON public.sup_posto;
CREATE POLICY sup_posto_select ON public.sup_posto FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
    OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
  );

DROP POLICY IF EXISTS sup_funcao_select ON public.sup_funcao;
CREATE POLICY sup_funcao_select ON public.sup_funcao FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_catalogo', 'visualizar')
    OR public.can_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar')
    OR public.can_access(auth.uid(), 'recrutamento_gestao', 'visualizar')
  );

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Recriar as cinco policies sem o OR de 'central_servicos_solicitar_vaga'
--   (versões em 20260913000004, 20260717190010, 20260717190009 e
--    20260901000001 — a de sup_* sem o OR de 'recrutamento_gestao' também);
--   DELETE FROM public.app_menu WHERE codigo = 'central_servicos_solicitar_vaga';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
