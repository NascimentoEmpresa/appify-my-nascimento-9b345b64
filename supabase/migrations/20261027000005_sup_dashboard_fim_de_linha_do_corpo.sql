-- SIS-2026-0741 — normaliza o fim de linha do corpo de sup_dashboard_compras_estoque
--
-- ESTA MIGRATION TEM QUE RODAR ANTES DA 20261027000010. É por isso que ela
-- nasceu com um número MENOR: o aplicador roda os arquivos em ordem de nome
-- (`infra/ha/no-aplicar-migrations.sh`, `find | sort`), então 000005 entra
-- antes de 000010, que já está na main e não pode ser editada (append-only).
--
-- ============================================================================
-- O PROBLEMA QUE ELA RESOLVE
--
-- A 20261027000010 (código do produto no Dashboard de Suprimentos) não
-- republica a RPC `sup_dashboard_compras_estoque`, que é extensa e já recebeu
-- correções: ela lê a definição instalada com `pg_get_functiondef()` e costura
-- `codigo` nos trechos certos, conferindo cada trecho com `position(...)`.
--
-- Ela falhou em TODO merge para a main, sempre na primeira conferência:
--
--   ERROR: Não foi possível localizar o item canônico na RPC do dashboard.
--   CONTEXT: PL/pgSQL function inline_code_block line 20 at RAISE
--
-- A função não havia mudado. O que não batia era o FIM DE LINHA. A RPC foi
-- publicada em 07/10 (20261007000001) colando no SQL Editor da Supabase um
-- arquivo que está no repositório com fim de linha do Windows: o corpo
-- guardado em `pg_proc.prosrc` tem `\r\n`, e as âncoras de mais de uma linha
-- da 000010 são escritas com `\n` — nenhuma casa.
--
-- Reproduzido em cluster PostgreSQL 18 descartável: com o corpo em CRLF dá
-- exatamente o erro acima na linha 20; com o MESMO corpo em LF a 000010
-- aplica e o código aparece no JSON.
--
-- Como a transação é única, a 000010 abortava e voltava para a fila, barrando
-- todas as migrations seguintes — as de joão e pablo também (#1028: 5
-- pendentes, 0 aplicadas; #1029: 7 pendentes, 0 aplicadas).
--
-- O QUE ELA FAZ
-- Republica a MESMA definição instalada, só sem os `\r`. Nenhuma linha de
-- lógica muda: é `CREATE OR REPLACE` do que já está no banco, então grants e
-- comentário da função ficam como estão. Com o corpo em `\n`, a 000010 roda
-- em seguida e encontra os trechos que procura.
--
-- É idempotente: se o corpo já estiver sem `\r`, ela avisa e não faz nada.
--
-- ROLLBACK:
-- Nenhum. A migration não altera comportamento — só o fim de linha do texto
-- do corpo. Reverter seria reintroduzir o `\r`, que é o próprio defeito.
-- ============================================================================

DO $bloco$
DECLARE
  v_definicao text;
  v_limpa text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_dashboard_compras_estoque(uuid,date,date,uuid,text,text)'::regprocedure
  ) INTO v_definicao;

  IF v_definicao IS NULL THEN
    RAISE EXCEPTION 'Função sup_dashboard_compras_estoque não encontrada.';
  END IF;

  v_limpa := replace(v_definicao, chr(13), '');

  IF v_limpa = v_definicao THEN
    RAISE NOTICE 'sup_dashboard_compras_estoque já está com fim de linha unix; nada a fazer.';
    RETURN;
  END IF;

  RAISE NOTICE 'sup_dashboard_compras_estoque: % caracteres \r removidos do corpo.',
    length(v_definicao) - length(v_limpa);

  EXECUTE v_limpa;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
