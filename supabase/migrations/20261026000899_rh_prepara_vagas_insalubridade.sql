-- SIS-2026-0741 — prepara as vagas antes da migração de insalubridade 0900
--
-- A 20261026000900 atualiza as vagas em aberto para refletir a Senior, mas
-- o guard de edição de vagas exige auth.uid() e bloqueia uma migration. A
-- 00895 já tentou antecipar a correção, porém novos dados da Senior podem
-- chegar entre aquela execução e a 0900 pendente. Esta migration roda logo
-- antes da 0900 e repete somente o saneamento com o guard desligado.
--
-- Quando a 0900 executar em seguida, sua cláusula IS DISTINCT FROM não acha
-- linhas para alterar; portanto o guard não dispara. O vínculo continua pelo
-- empregado substituído, nunca por nome.
--
-- ROLLBACK:
--   Não há DDL persistente a reverter. Os valores anteriores podem ser
--   recuperados do histórico de vagas se necessário.
-- ============================================================================

-- A função foi criada pela 20261026000895, que sempre roda antes deste arquivo.
SELECT public.rh_sync_adicionais_do_senior();

ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;

WITH certo AS (
  SELECT r.id,
         public.col_num(e."% Insalubridade") AS pct
    FROM public."SISTEMA_RECRUTAMENTO" r
    JOIN public."EMPREGADOS" e ON e."ID" = r.substituido_id
   WHERE r.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
     AND public.col_num(e."% Insalubridade") IS NOT NULL
),
novo AS (
  SELECT c.id,
         CASE WHEN c.pct > 0 THEN 'Sim' ELSE 'Não' END AS recebe,
         CASE WHEN c.pct > 0 THEN replace(trim_scale(c.pct)::text, '.', ',') || '%' ELSE '' END AS quanto
    FROM certo c
)
UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET insalubridade_recebe = n.recebe,
       insalubridade_quanto = n.quanto
  FROM novo n
 WHERE r.id = n.id
   AND (
     r.insalubridade_recebe IS DISTINCT FROM n.recebe
     OR (
       n.recebe = 'Sim'
       AND public.col_num(substring(coalesce(r.insalubridade_quanto, '') FROM '([0-9]+(?:[.,][0-9]+)?)%'))
             IS DISTINCT FROM (SELECT c.pct FROM certo c WHERE c.id = n.id)
     )
   );

ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

NOTIFY pgrst, 'reload schema';
