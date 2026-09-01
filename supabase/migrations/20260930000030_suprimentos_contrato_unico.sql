-- Suprimentos: as quatro telas que ainda liam o cadastro antigo passam a ler
-- public.contratos. Esta migration faz UMA coisa só: soltar a FK que prende
-- contrato_id ao cadastro antigo e prendê-la no cadastro novo.
--
-- POR QUE PRECISA DE MIGRATION
--   O banco tem dois cadastros de contrato vivos:
--     • public.contrato  (singular, de 29/04) — numero/objeto/orgao, da tela
--       /app/contratos/ativos, usado por financeiro, cobranças e orçamento.
--     • public.contratos (plural, de 14/07) — nome/cliente/status, de
--       /app/licitacoes/contratos, raiz da cascata de todo o Supply novo.
--
--   Almoxarifados, Estoque, NF de Entrada e Requisições listavam a singular.
--   Trocar só o React não bastaria: almoxarifado, estoque_movimento e
--   nf_entrada têm FK para public.contrato, e o primeiro salvamento com um id
--   vindo de public.contratos seria recusado pelo banco.
--
-- O QUE ESTA MIGRATION *NÃO* FAZ, DE PROPÓSITO
--   • Não cria, não altera e não remove nenhuma policy, permissão ou menu.
--     Quem enxerga essas telas hoje enxerga exatamente igual depois. A leitura
--     de public.contratos já é aberta a authenticated desde a migration
--     20260901000002 — não há nada ligado a user_empresa entrando aqui.
--   • Não mexe em requisicao_compra: a coluna contrato_id nunca teve FK (uuid
--     solto desde 29/04) e continua sem. Criar uma agora seria regra nova.
--   • Não reescreve, não apaga e não remapeia dado histórico. Ver abaixo.
--   • Não desativa public.contrato, que segue servindo os outros módulos.
--
-- AS LINHAS ANTIGAS
--   Quem já tem contrato_id gravado guarda um id do cadastro antigo. A FK
--   nova entra como NOT VALID: o Postgres passa a cobrar o vínculo de tudo
--   que for gravado daqui pra frente e deixa as linhas existentes exatamente
--   como estão — nenhum valor é perdido.
--
--   Efeito colateral honesto: se alguém EDITAR uma dessas linhas antigas, o
--   banco vai cobrar um contrato válido na hora de salvar, e a pessoa precisa
--   escolher um contrato da lista nova (ou deixar em branco). Para saber
--   quantas linhas estão nessa situação:
--
--     SELECT 'almoxarifado' AS tabela, count(*) FROM public.almoxarifado a
--      WHERE a.contrato_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = a.contrato_id)
--     UNION ALL
--     SELECT 'estoque_movimento', count(*) FROM public.estoque_movimento m
--      WHERE m.contrato_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = m.contrato_id)
--     UNION ALL
--     SELECT 'nf_entrada', count(*) FROM public.nf_entrada n
--      WHERE n.contrato_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.id = n.contrato_id);
--
-- IDEMPOTENTE: pode ser reexecutada.

-- ── 1. Soltar a FK do cadastro antigo ────────────────────────────────
--
-- Por descoberta e não pelo nome: as três nasceram inline no CREATE TABLE e
-- carregam o nome padrão do Postgres, mas procurar por conrelid/confrelid
-- acerta mesmo que alguma tenha sido recriada com outro nome no caminho.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rel.relname AS tabela, con.conname AS nome_constraint
      FROM pg_constraint con
      JOIN pg_class rel     ON rel.oid = con.conrelid
      JOIN pg_class ref     ON ref.oid = con.confrelid
      JOIN pg_namespace n   ON n.oid   = rel.relnamespace
     WHERE con.contype = 'f'
       AND n.nspname   = 'public'
       AND ref.relname = 'contrato'
       AND rel.relname IN ('almoxarifado','estoque_movimento','nf_entrada')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tabela, r.nome_constraint);
  END LOOP;
END $$;

-- ── 2. Prender a mesma FK no cadastro novo ───────────────────────────
--
-- Sem ON DELETE: as três originais eram `REFERENCES public.contrato(id)` seco,
-- e a regra de apagamento continua a mesma (NO ACTION).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'almoxarifado_contrato_id_fkey') THEN
    ALTER TABLE public.almoxarifado
      ADD CONSTRAINT almoxarifado_contrato_id_fkey
      FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estoque_movimento_contrato_id_fkey') THEN
    ALTER TABLE public.estoque_movimento
      ADD CONSTRAINT estoque_movimento_contrato_id_fkey
      FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nf_entrada_contrato_id_fkey') THEN
    ALTER TABLE public.nf_entrada
      ADD CONSTRAINT nf_entrada_contrato_id_fkey
      FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) NOT VALID;
  END IF;
END $$;

-- ── 3. Validar as três chaves ────────────────────────────────────────
--
-- A FK entrou NOT VALID por precaução, para não esbarrar em linha antiga
-- apontando para o cadastro velho. Conferido em produção em 01/09/2026: as
-- três tabelas têm ZERO linha com contrato_id preenchido — nunca ninguém
-- vinculou contrato por essas telas. Sem dado legado, não há o que preservar,
-- e a chave pode valer para tudo.
--
-- VALIDATE em constraint já validada é no-op, então a reexecução continua
-- inofensiva. Se um dia isto rodar num banco COM linha antiga, o comando vai
-- falhar em vez de mascarar — e falhar aqui é o comportamento certo: quer
-- dizer que existe vínculo apontando para cadastro que não é mais o oficial.
ALTER TABLE public.almoxarifado      VALIDATE CONSTRAINT almoxarifado_contrato_id_fkey;
ALTER TABLE public.estoque_movimento VALIDATE CONSTRAINT estoque_movimento_contrato_id_fkey;
ALTER TABLE public.nf_entrada        VALIDATE CONSTRAINT nf_entrada_contrato_id_fkey;

-- ── Conferência ──────────────────────────────────────────────────────
SELECT rel.relname AS tabela, con.conname AS constraint_, ref.relname AS aponta_para, con.convalidated
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_class ref   ON ref.oid = con.confrelid
  JOIN pg_namespace n ON n.oid   = rel.relnamespace
 WHERE con.contype = 'f'
   AND n.nspname   = 'public'
   AND rel.relname IN ('almoxarifado','estoque_movimento','nf_entrada')
   AND con.conname LIKE '%contrato%'
 ORDER BY rel.relname;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (cola no SQL Editor se precisar voltar)
--
-- ALTER TABLE public.almoxarifado      DROP CONSTRAINT IF EXISTS almoxarifado_contrato_id_fkey;
-- ALTER TABLE public.estoque_movimento DROP CONSTRAINT IF EXISTS estoque_movimento_contrato_id_fkey;
-- ALTER TABLE public.nf_entrada        DROP CONSTRAINT IF EXISTS nf_entrada_contrato_id_fkey;
--
-- ALTER TABLE public.almoxarifado
--   ADD CONSTRAINT almoxarifado_contrato_id_fkey
--   FOREIGN KEY (contrato_id) REFERENCES public.contrato(id) NOT VALID;
-- ALTER TABLE public.estoque_movimento
--   ADD CONSTRAINT estoque_movimento_contrato_id_fkey
--   FOREIGN KEY (contrato_id) REFERENCES public.contrato(id) NOT VALID;
-- ALTER TABLE public.nf_entrada
--   ADD CONSTRAINT nf_entrada_contrato_id_fkey
--   FOREIGN KEY (contrato_id) REFERENCES public.contrato(id) NOT VALID;
--
-- NOTIFY pgrst, 'reload schema';
