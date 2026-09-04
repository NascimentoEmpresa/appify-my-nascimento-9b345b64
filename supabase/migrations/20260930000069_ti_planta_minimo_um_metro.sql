-- =====================================================================
-- T.I — a planta pode ter 1 metro de lado.
--
-- O ERRO QUE ISTO CORRIGE (04/09/2026, na tela)
--   "new row for relation TI_PLANTA violates check constraint
--    TI_PLANTA_altura_cm_check" ao salvar 1 m de profundidade.
--
--   O CHECK exigia no mínimo 200 cm. Fazia sentido quando a planta ERA o
--   piso: um retângulo de 1 m não era um escritório, era um engano de
--   digitação. Deixou de fazer com o piso por células (20260930000068): agora
--   a moldura é só a área de trabalho, e começar de um quadrado para ir
--   somando com o "+" é um jeito legítimo — e bom — de montar um andar de
--   forma irregular.
--
--   O teto de 200 m continua: ali o número redondo ainda denuncia engano
--   (alguém digitando centímetros onde o campo pede metros).
--
-- A tela também passou a recusar antes de mandar, com mensagem em português;
-- mas quem garante é este CHECK.
--
-- Idempotente.
-- =====================================================================

ALTER TABLE public."TI_PLANTA" DROP CONSTRAINT IF EXISTS "TI_PLANTA_largura_cm_check";
ALTER TABLE public."TI_PLANTA" ADD CONSTRAINT "TI_PLANTA_largura_cm_check" CHECK (largura_cm BETWEEN 100 AND 20000);

ALTER TABLE public."TI_PLANTA" DROP CONSTRAINT IF EXISTS "TI_PLANTA_altura_cm_check";
ALTER TABLE public."TI_PLANTA" ADD CONSTRAINT "TI_PLANTA_altura_cm_check" CHECK (altura_cm BETWEEN 100 AND 20000);

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'public."TI_PLANTA"'::regclass AND contype = 'c'
 ORDER BY conname;

-- =====================================================================
-- ROLLBACK
--   ALTER TABLE public."TI_PLANTA" DROP CONSTRAINT "TI_PLANTA_largura_cm_check";
--   ALTER TABLE public."TI_PLANTA" ADD CONSTRAINT "TI_PLANTA_largura_cm_check" CHECK (largura_cm BETWEEN 200 AND 20000);
--   ALTER TABLE public."TI_PLANTA" DROP CONSTRAINT "TI_PLANTA_altura_cm_check";
--   ALTER TABLE public."TI_PLANTA" ADD CONSTRAINT "TI_PLANTA_altura_cm_check" CHECK (altura_cm BETWEEN 200 AND 20000);
--   -- ⚠ só depois de conferir que nenhuma planta ficou abaixo de 2 m.
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
