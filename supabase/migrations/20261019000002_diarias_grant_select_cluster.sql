-- =========================================================================
-- DIÁRIAS: "permission denied for table DIARIA_SOLICITACAO" (19/10/2026)
--
-- Pablo (print do Controle de Diárias / Minhas solicitações): a lista vinha
-- vazia com "permission denied for table DIARIA_SOLICITACAO" para alguns
-- usuários, depois da virada para o cluster (16/10).
--
-- O QUE O ERRO QUER DIZER
-- "permission denied for table" é GRANT, não RLS: a policy nem chega a rodar.
-- As tabelas DIARIA_* são as poucas em que o authenticated tem SÓ SELECT
-- (escrita é por RPC — ver 20260930000019_operacional_diarias.sql), e é
-- justamente o tipo de grant explícito que pode não ter atravessado a virada
-- (a conferência do Eduardo bateu tabelas, índices, funções, policies e
-- constraints; grants não foram listados).
--
-- O QUE ESTA MIGRATION FAZ
-- Reaplica o SELECT do authenticated nas 12 tabelas DIARIA_*, exatamente como
-- está na Supabase antiga (congelada no estado de antes da virada — conferido
-- em information_schema.role_table_grants). GRANT só acrescenta: se o cluster
-- já tinha, não muda nada. Não mexe em RLS, nem em anon.
--
-- SE O ERRO CONTINUAR DEPOIS DISTO
-- Então a causa é a outra possível: a requisição chega SEM sessão válida (como
-- anon, que nunca teve grant aqui — dá exatamente a mesma mensagem). Resolve
-- com Sair e entrar de novo; ver o GoTrue do cluster (commit 9f889fc7).
--
-- Idempotente. Entra sozinha no merge da main (cluster_pos_merge.yml).
-- ROLLBACK (só se o cluster NÃO tinha estes grants e se quiser voltar a isso):
--   REVOKE SELECT ON public."DIARIA_ANEXO", public."DIARIA_EVENTO", public."DIARIA_LINHA",
--     public."DIARIA_SOLICITACAO", public."DIARIA_UFRGS", public."DIARIA_UFRGS_ANEXO",
--     public."DIARIA_UFRGS_EVENTO", public."DIARIA_UFRGS_LOTACAO", public."DIARIA_UFRGS_POSTO",
--     public."DIARIA_UFRGS_TARIFA", public."DIARIA_UFRGS_VISUALIZACAO", public."DIARIA_VISUALIZACAO"
--   FROM authenticated;
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================

GRANT SELECT ON TABLE
  public."DIARIA_ANEXO",
  public."DIARIA_EVENTO",
  public."DIARIA_LINHA",
  public."DIARIA_SOLICITACAO",
  public."DIARIA_UFRGS",
  public."DIARIA_UFRGS_ANEXO",
  public."DIARIA_UFRGS_EVENTO",
  public."DIARIA_UFRGS_LOTACAO",
  public."DIARIA_UFRGS_POSTO",
  public."DIARIA_UFRGS_TARIFA",
  public."DIARIA_UFRGS_VISUALIZACAO",
  public."DIARIA_VISUALIZACAO"
TO authenticated;

NOTIFY pgrst, 'reload schema';
