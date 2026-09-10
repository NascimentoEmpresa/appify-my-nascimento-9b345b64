-- =========================================================================
-- RT é RESERVA Técnica, não Reposição
--
-- A coluna nasceu hoje, na 20260930000085, com o nome errado. O certo é
-- Reserva Técnica — corrigido pelo Pablo na primeira vez que viu a tela.
--
-- Renomeia em vez de criar outra: a coluna tem menos de um dia de vida, não
-- há uma linha com `true` e nenhuma tela lida com o nome antigo além do
-- formulário que sobe nesta mesma PR. Deixar as duas seria o começo de um
-- "qual delas vale?" que ninguém responde daqui a seis meses.
--
-- Idempotente: só renomeia se a antiga existir e a nova ainda não.
-- Aplicar no banco do app.
-- =========================================================================

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'SISTEMA_RECRUTAMENTO'
           AND column_name = 'reposicao_tecnica')
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'SISTEMA_RECRUTAMENTO'
           AND column_name = 'reserva_tecnica')
  THEN
    ALTER TABLE public."SISTEMA_RECRUTAMENTO"
      RENAME COLUMN reposicao_tecnica TO reserva_tecnica;
  END IF;
END $$;

-- Rede de segurança: se alguém rodar esta migration num banco que nunca viu a
-- 085, a coluna nasce direto com o nome certo.
ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS reserva_tecnica boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".reserva_tecnica IS
  'A vaga é Reserva Técnica (RT)? Perguntado na etapa 2 da solicitação.';

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'SISTEMA_RECRUTAMENTO'
   AND column_name IN ('reserva_tecnica', 'reposicao_tecnica');

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" RENAME COLUMN reserva_tecnica TO reposicao_tecnica;
-- NOTIFY pgrst, 'reload schema';
