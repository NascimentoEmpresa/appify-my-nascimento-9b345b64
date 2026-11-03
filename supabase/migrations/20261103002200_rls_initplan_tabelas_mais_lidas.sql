-- ============================================================================
-- Permissão em InitPlan nas 32 tabelas mais lidas (03/11/2026)
--
-- Continuação da 20261103002000 (Fluxo de Caixa). Lá ficou provado que uma
-- policy com `can_access(auth.uid(), 'menu', 'acao')` sem `(SELECT ...)` em
-- volta reavalia a permissão PARA CADA LINHA, a 1,5-5 ms por chamada —
-- "DEBITO_AUTOMATICO" levava 5,1 s para ler 1094 linhas e caiu para ~0,1 s.
--
-- Sobraram 670 policies nesse formato no resto do banco. A maioria é de
-- tabela pequena ou lida de um registro por vez, onde a diferença é de
-- milissegundos — mexer em todas de uma vez seria muito risco para pouco
-- ganho. Aqui entram só as 32 com mais linhas lidas desde a virada
-- (pg_stat_user_tables: seq_tup_read + idx_tup_fetch), que é onde está o
-- custo: SISTEMA_RECRUTAMENTO, WA_CURRICULOS, EMPREGADOS, nf_emissao,
-- JUR_PROCESSOS, malote_*, sup_*, as tabelas de acesso (profiles,
-- user_empresa...)...
--
-- Mesma técnica e mesma garantia da 20261103002000: só vai para dentro de
-- `(SELECT ...)` a chamada de permissão cujos argumentos são auth.uid() e
-- literais (não depende da linha), as funções são todas STABLE, e ALTER
-- POLICY mantém nome, comando, papéis e PERMISSIVE. Antes de aplicar,
-- conferido para 6 usuários (com e sem acesso aos módulos) que cada policy
-- alterada enxerga exatamente as mesmas linhas, com a expressão antiga e a
-- nova contadas na mesma foto do banco (REPEATABLE READ).
--
-- As tabelas de acesso (perfil_acesso, user_roles...) são lidas sobretudo de
-- dentro de has_screen_access, que é SECURITY DEFINER do dono e não passa
-- pela RLS — para elas o ganho é só nas leituras diretas do app.
--
-- ROLLBACK: o `(SELECT ...)` é semanticamente igual; para desfazer uma,
--   ALTER POLICY <nome> ON <tabela> USING (<expressão sem o SELECT>);
-- ============================================================================

SET lock_timeout = '5s';

DO $$
DECLARE
  -- Chamada de permissão que não depende da linha.
  chamada constant text :=
    '\m(can_access|has_screen_access|has_role|malote_gerente_financeiro)\(auth\.uid\(\)(, ''[^'']*''::[a-z_]+)*\)'
    || '|\mtem_acesso_menu\(''[^'']*''::text(, ''[^'']*''::text)*\)'
    || '|\mmalote_pode_pagar\(\)';
  p record;
  novo_qual text;
  novo_check text;
  n int := 0;
BEGIN
  FOR p IN
    SELECT pol.polname, c.relname, pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS wcheck
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relname IN (
         'perfil_acesso', 'malote_setor_visivel_usuario', 'EMPREGADOS', 'user_roles', 'profiles',
         'usuario_perfil_acesso', 'user_empresa', 'SISTEMA_RECRUTAMENTO', 'nf_emissao', 'WA_CURRICULOS',
         'JUR_PROCESSOS', 'SISTEMA_NOVIDADES', 'grade', 'RECRUTAMENTO_HISTORICO', 'malote_forma_pagamento',
         'sup_cat_lote', 'SISTEMA_RECRUTAMENTO_STATUS_LOG', 'CONTRATOS', 'TV_ITEM', 'fornecedor',
         'user_setor', 'nf_emissao_item', 'RH_ESCALA', 'cotacoes_licitacao',
         'malote_licitacao_classificacao_link', 'RH_POSTO_COLABORADOR', 'sup_funcao', 'sup_posto',
         'TV_DISPOSITIVO', 'malote_administrativo_classificacao_link', 'contrato_docs_config',
         'CHECKLIST_FATURAMENTO_MARCACAO')
  LOOP
    -- Tira o embrulho que já existir e embrulha tudo de novo: rodar duas
    -- vezes não vira `(SELECT (SELECT ...))`.
    novo_qual := regexp_replace(
      regexp_replace(p.qual, '\( SELECT (' || chamada || ') AS [a-z_]+\)', '\1', 'g'),
      '(' || chamada || ')', '(SELECT \1)', 'g');
    novo_check := regexp_replace(
      regexp_replace(p.wcheck, '\( SELECT (' || chamada || ') AS [a-z_]+\)', '\1', 'g'),
      '(' || chamada || ')', '(SELECT \1)', 'g');

    -- Só mexe se havia alguma chamada fora de SELECT.
    IF coalesce(regexp_count(p.qual, chamada), 0) > coalesce(regexp_count(p.qual, '\( SELECT (' || chamada || ') AS '), 0)
       OR coalesce(regexp_count(p.wcheck, chamada), 0) > coalesce(regexp_count(p.wcheck, '\( SELECT (' || chamada || ') AS '), 0)
    THEN
      IF novo_qual IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', p.polname, p.relname, novo_qual);
      END IF;
      IF novo_check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', p.polname, p.relname, novo_check);
      END IF;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'policies com permissao em InitPlan: %', n;
END $$;

NOTIFY pgrst, 'reload schema';
