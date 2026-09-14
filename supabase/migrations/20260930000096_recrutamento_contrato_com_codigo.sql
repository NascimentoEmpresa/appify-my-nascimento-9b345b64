-- =========================================================================
-- Recrutamento: o contrato da vaga leva o código da filial
--
-- "POLÍCIA CIVIL RS LIMPEZA - 066/2026" vira "1109 - POLÍCIA CIVIL RS
-- LIMPEZA - 066/2026" em SISTEMA_RECRUTAMENTO.contrato — a mesma regra do
-- "Nome Filial" de EMPREGADOS (20260930000089): o RH fala do contrato pelo
-- código, e a lista do Recrutamento sem ele obrigava a ler o nome inteiro.
--
-- Daqui em diante a tela grava com o código (rotuloContrato, em
-- lib/recrutamento/vagaRegras.ts). Isto aqui é o estoque: casa o nome
-- gravado com CONTRATOS."NOME CONTRATO" e prefixa o Filial de lá. Vaga cujo
-- nome não casa com nenhum contrato (não há nenhuma hoje) fica como está.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- O gatilho sistema_recrutamento_guard só deixa "gestor" mexer em coluna que
-- não seja a data de início — e no SQL Editor não há auth.uid(). Desliga só
-- para este estoque e religa em seguida.
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;

UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET contrato = c."Filial"::text || ' - ' || btrim(c."NOME CONTRATO")
  FROM public."CONTRATOS" c
 WHERE upper(btrim(c."NOME CONTRATO")) = upper(btrim(r.contrato))
   AND c."Filial" IS NOT NULL
   AND r.contrato !~ '^\d+\s*-';

ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT count(*) AS total,
       count(*) FILTER (WHERE contrato ~ '^\d+ - ') AS com_codigo
  FROM public."SISTEMA_RECRUTAMENTO";

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
-- UPDATE public."SISTEMA_RECRUTAMENTO" SET contrato = regexp_replace(contrato, '^\d+\s*-\s*', '') WHERE contrato ~ '^\d+\s*-';
-- ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;
-- NOTIFY pgrst, 'reload schema';
