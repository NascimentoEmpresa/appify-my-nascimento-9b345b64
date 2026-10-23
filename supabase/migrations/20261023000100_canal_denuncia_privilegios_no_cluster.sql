-- =========================================================================
-- Canal de Denúncias: "permission denied for table CANAL_DENUNCIA" ao SALVAR
-- a ficha — DE NOVO, agora no cluster (23/10/2026)
--
-- SINTOMA
--   Comitê de Ética › Denúncias › abrir um caso › Salvar ficha →
--   "Erro ao salvar: permission denied for table CANAL_DENUNCIA". A lista e a
--   ficha abrem (leitura pela visão v_canal_denuncia); só o UPDATE falha.
--   FichaDenuncia.tsx não muda desde ago/2026.
--
-- CAUSA
--   É o erro da 20260930000107, que voltou. O desenho é de propósito:
--   `authenticated` NÃO tem SELECT na tabela (quem lê é a visão, que mascara
--   o denunciante) e tem UPDATE. Só que o UPDATE precisa de SELECT nas
--   colunas que ele LÊ — `id` no WHERE, `empresa_id` na policy
--   canal_denuncia_update — e a 0107 deu isso por COLUNA. Privilégio por
--   coluna (e os REVOKE/GRANT finos da 0914000002) não veio na virada para o
--   cluster (16/10): as funções também não vieram na replicação lógica (ver
--   20261019000005). Sem SELECT em id/empresa_id o UPDATE morre antes da RLS.
--
-- CORREÇÃO
--   Reaplica, idempotente, os privilégios que o repositório já define para o
--   canal — nenhum novo, nada de identidade:
--   * CANAL_DENUNCIA: UPDATE na tabela + SELECT só em id, empresa_id
--     (0107) e status (20260930000217, Painel da Presidência);
--   * filhas e visão: os mesmos GRANTs das migrations de origem.
--   O SELECT da tabela inteira continua negado (o REVOKE é repetido aqui),
--   então um `select=*` direto segue barrado.
--
-- Idempotente.
-- =========================================================================

REVOKE ALL ON TABLE public."CANAL_DENUNCIA" FROM anon;
REVOKE SELECT ON TABLE public."CANAL_DENUNCIA" FROM authenticated;
GRANT UPDATE ON TABLE public."CANAL_DENUNCIA" TO authenticated;
GRANT SELECT (id, empresa_id, status) ON public."CANAL_DENUNCIA" TO authenticated;

GRANT SELECT ON public.v_canal_denuncia TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_MENSAGEM" TO authenticated;
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_EVENTO" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."CANAL_DENUNCIA_PROVIDENCIA" TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_ANEXO" TO authenticated;
GRANT SELECT, UPDATE ON TABLE public."CANAL_DENUNCIA_ALERTA" TO authenticated;
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_EMPRESA" TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public."CANAL_DENUNCIA_EMPRESA" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."COMITE_ETICA_RESPONSAVEL" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin, banco postgres): deve devolver empresa_id,id,status — e nada mais.
-- SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.column_privileges
--  WHERE grantee = 'authenticated' AND table_name = 'CANAL_DENUNCIA' AND privilege_type = 'SELECT';

-- ROLLBACK (volta ao estado quebrado — só se este arquivo causar outro problema)
-- REVOKE SELECT (id, empresa_id, status) ON public."CANAL_DENUNCIA" FROM authenticated;
-- NOTIFY pgrst, 'reload schema';
