-- =====================================================================
-- Anexos dos chamados: o Storage acha a linha do anexo pelo índice (16/11/2026)
--
-- Anexos e prints dos chamados não abriam. O console mostrava dezenas de
-- "status 544" do Storage. No storage-api v1.80.2, 544 = DatabaseTimeout: o
-- pedido esperou mais de 3 s por uma das 20 conexões que o Storage tem com o
-- banco (ou a consulta passou de 30 s). O laço de novas tentativas da tela
-- foi corrigido no front (useAnexoChamado). Isto aqui encurta o tempo que
-- cada leitura de anexo segura a conexão do Storage.
--
-- A policy "chamados sistemas anexo select" (mig 20260831000001) libera o
-- objeto só se existir a linha em CHAMADO_SISTEMA_ANEXO com aquele
-- storage_path, e storage_path NÃO tinha índice: cada download/assinatura
-- varria a tabela inteira. Dentro dessa subconsulta roda a RLS da própria
-- tabela, que chamava chamado_sistema_gestor() por linha, sem (SELECT ...).
-- Com isso, ela passa a rodar uma vez por consulta, como nas migs 20261103002000/2200.
--
-- Mesma regra, só mais rápida: a expressão da policy é a mesma, com o
-- (SELECT ...) em volta da função sem argumento. É STABLE e dá a mesma
-- resposta na consulta inteira.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_anexo_storage_path
  ON public."CHAMADO_SISTEMA_ANEXO"(storage_path);

ALTER POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
  USING (EXISTS (
    SELECT 1 FROM public."CHAMADO_SISTEMA" c
     WHERE c.id = chamado_id
       AND ((SELECT public.chamado_sistema_gestor())
            OR c.responsavel_id = auth.uid()
            OR (c.solicitante_id = auth.uid() AND campo <> 'interno'))
  ));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP INDEX IF EXISTS public.idx_chamado_sistema_anexo_storage_path;
-- ALTER POLICY chamado_sistema_anexo_select ON public."CHAMADO_SISTEMA_ANEXO"
--   USING (EXISTS (
--     SELECT 1 FROM public."CHAMADO_SISTEMA" c
--      WHERE c.id = chamado_id
--        AND (public.chamado_sistema_gestor()
--             OR c.responsavel_id = auth.uid()
--             OR (c.solicitante_id = auth.uid() AND campo <> 'interno'))
--   ));
