-- =====================================================================
-- "CARGOS": leitura para quem abre vaga
--
-- A tabela é o cadastro oficial de cargos (207 linhas: "ADVOGADO", "AGENTE
-- DE PORTARIA"…). Estava com RLS LIGADA e NENHUMA policy — ou seja, ninguém
-- autenticado lia nada dela. Não incomodava porque nenhuma tela usava; passa
-- a incomodar agora, que o modo "Preencher manualmente" do modal de nova vaga
-- sugere os cargos existentes (components/recrutamento/ModalNovaVaga.tsx).
--
-- É SUGESTÃO, não lista fechada: o campo continua aceitando cargo digitado
-- que ainda não está no cadastro. A policy existe só para o combo não vir
-- vazio.
--
-- Leitura apenas, e só para as duas telas que abrem vaga do escritório.
-- Escrita continua sem policy nenhuma: quem popula "CARGOS" é a importação
-- do Senior, não o app.
--
-- Idempotente.
-- =====================================================================

DROP POLICY IF EXISTS cargos_select_abrir_vaga ON public."CARGOS";
CREATE POLICY cargos_select_abrir_vaga ON public."CARGOS" FOR SELECT TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
);

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS cargos_select_abrir_vaga ON public."CARGOS";
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
