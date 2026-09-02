-- public.contratos passa a emitir eventos de Realtime.
--
-- POR QUE
--   O Catálogo de Materiais (/app/suprimentos/catalogo) começa escolhendo o
--   contrato, mas quem cadastra contrato é Licitações, em outra tela e quase
--   sempre em outra pessoa. Até agora o Supply só via um contrato novo depois
--   de sair da aba e voltar — é quando o React Query refaz a busca sozinho.
--   Com a tabela na publication, a tela recebe o aviso na hora e recarrega a
--   lista sem ninguém apertar nada.
--
-- O QUE MUDA, E O QUE NÃO MUDA
--   Realtime NÃO cria caminho de acesso: o evento só chega a quem já podia ler
--   a linha pela policy de SELECT. Nenhuma policy, permissão ou menu é tocado
--   aqui — só a publication e a replica identity da tabela.
--
--   REPLICA IDENTITY FULL porque, sem ela, o evento de UPDATE/DELETE não leva
--   a linha antiga e o Realtime não consegue conferir a RLS do assinante —
--   resultado prático: contrato excluído ou renomeado não chegaria na tela.
--   O custo é a WAL guardar a linha inteira a cada escrita; em dezenas de
--   linhas que mudam raramente, é irrelevante.
--
--   ⚠️ TABELA DE OUTRO MÓDULO (Licitações). Nada muda para quem já usa
--   contrato hoje — nem tela, nem escrita, nem leitura.
--
-- PRIMEIRO USO DE REALTIME NO PROJETO. Se por algum motivo o Realtime estiver
-- desligado nas configurações do projeto, nada quebra: o canal fica sem
-- receber evento e a tela volta ao comportamento antigo, atualizando quando a
-- janela recupera o foco.
--
-- IDEMPOTENTE: pode ser reexecutada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'A publication supabase_realtime não existe neste projeto. Ligue o Realtime no painel do Supabase antes de rodar esta migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'contratos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contratos;
  END IF;
END $$;

ALTER TABLE public.contratos REPLICA IDENTITY FULL;

-- ── Conferência ──────────────────────────────────────────────────────
-- Esperado: uma linha, com na_publicacao = true e replica_identity = 'f'.
SELECT c.relname                        AS tabela,
       EXISTS (SELECT 1 FROM pg_publication_tables pt
                WHERE pt.pubname = 'supabase_realtime'
                  AND pt.schemaname = 'public'
                  AND pt.tablename  = 'contratos') AS na_publicacao,
       c.relreplident                   AS replica_identity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'contratos';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (cola no SQL Editor se precisar voltar)
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.contratos;
-- ALTER TABLE public.contratos REPLICA IDENTITY DEFAULT;
-- NOTIFY pgrst, 'reload schema';
