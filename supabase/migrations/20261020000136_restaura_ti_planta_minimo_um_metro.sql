-- =====================================================================
-- RESTAURAÇÃO DO MÓDULO T.I (20/10/2026) — cópia FIEL da migration
-- 20260930000069.sql da branch local `ti`.
--
-- Pedido do Pablo: "restaura TUDO da branch ti". O Mapa 3D tinha saído da
-- pablo em 10/09/2026 (revert 7cb8e295) e o banco foi limpo pelas migs
-- 20260930000084 (módulo desligado) e 20260930000088 (tabelas TI_* apagadas).
-- As originais já constam como aplicadas no aplicador do cluster, por isso
-- voltam com número novo, na MESMA ordem: 0130 (= 060) … 0140 (= 074);
-- 0141 religa o módulo e os menus; 0142 devolve os dados do backup.
-- O corpo abaixo não foi alterado.
-- =====================================================================

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
