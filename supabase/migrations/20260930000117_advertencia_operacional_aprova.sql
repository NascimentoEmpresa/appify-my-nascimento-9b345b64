-- =========================================================================
-- Advertências: o OPERACIONAL aprova antes do Jurídico
--
-- Pedido do Pablo em 15/09/2026: "quando o usuário solicitar, vai pro
-- Operacional primeiro (Operacional › Advertências Solicitadas); o
-- Operacional aprova e vai pro Jurídico responder. Não cria gerenciamento
-- de acesso novo, usa o que já tem."
--
-- ANTES  encarregado → "Aguardando Aprovação" (analista do contrato, pela
--        tela do Jurídico) → "Aguardando Jurídico" → Concluída/Reprovada
-- AGORA  encarregado → "Aguardando Aprovação" (OPERACIONAL, em
--        /app/operacional/advertencias) → "Aguardando Jurídico" → ...
--
-- O status não muda de nome — só quem age nele. Sem menu novo: a rota
-- /app/operacional/advertencias cai no menu raiz do módulo
-- (`operacional_home`, /app/operacional) por prefixo — quem tem o
-- Operacional vê a tela. A RLS da tabela ganha esse mesmo código pra ler e
-- pra aprovar/reprovar. O Jurídico continua concluindo pela tela dele.
--
-- eh_analista_advertencia() fica nas policies pra não tirar de ninguém o
-- que já podia; a tela do Jurídico é que deixa de oferecer o botão.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP POLICY IF EXISTS adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_select ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR SELECT TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'advertencias', 'visualizar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'operacional_home', 'visualizar'::app_acao)
  OR solicitante_email = auth.email()
  OR public.eh_analista_advertencia(contrato_id)
);

DROP POLICY IF EXISTS adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE POLICY adv_update ON public."SISTEMA_SOLICITACOES_ADVERTENCIA" FOR UPDATE TO authenticated
USING (
  public.has_screen_access(auth.uid(), 'advertencias', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'operacional_home', 'visualizar'::app_acao)
  OR public.eh_analista_advertencia(contrato_id)
)
WITH CHECK (
  public.has_screen_access(auth.uid(), 'advertencias', 'alterar'::app_acao)
  OR public.has_screen_access(auth.uid(), 'operacional_home', 'visualizar'::app_acao)
  OR public.eh_analista_advertencia(contrato_id)
);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Recriar adv_select/adv_update sem o OR de 'operacional_home' (texto na
-- 20260717190007_hotfix_advertencias_3vias.sql) e NOTIFY pgrst, 'reload schema';
