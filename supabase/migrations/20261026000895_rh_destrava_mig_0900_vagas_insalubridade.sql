-- =========================================================================
-- DESTRAVA A MIG 20261026000900 NO PÓS-MERGE (27/10/2026)
--
-- SINTOMA: Solicitar Treinamento abria com 'relation "public.TRN_SOLICITACAO"
-- does not exist'. A 20261026000910 (que cria a tabela) nunca rodou porque
-- o aplicador do pós-merge para no primeiro erro, e o erro era a 0900:
--
--   ERROR: Depois de criada, você só pode alterar a Data de Início Prevista
--   da vaga. Para mudar qualquer outra informação, fale com o Recrutamento.
--
-- CAUSA: o passo (c) da 0900 corrige a insalubridade das vagas em aberto
-- com um UPDATE em SISTEMA_RECRUTAMENTO. Dentro da migration não existe
-- auth.uid(), então o trg_sistema_recrutamento_guard trata o UPDATE como de
-- um "não gestor" e recusa. Correção de dado não é edição de usuário — as
-- migs 187 e 20261019000004 já desligam o guard em volta do UPDATE.
--
-- POR QUE ESTE ARQUIVO E NÃO EDITAR A 0900: migration que está na main é
-- append-only (portaria R4), mesmo uma que nunca entrou no banco. O
-- aplicador pega as pendentes em ordem de número, então esta (0895) roda
-- ANTES da 0900 e faz o mesmo trabalho com o guard desligado:
--   1. cria rh_sync_adicionais_do_senior() — corpo IDÊNTICO ao da 0900, que
--      a recria igual logo depois — e roda (EMPREGADOS igual à Senior);
--   2. faz o UPDATE das vagas da 0900, com o guard desligado só em volta.
-- Quando a 0900 roda em seguida, o UPDATE dela não acha mais nenhuma vaga
-- diferente (a condição é IS DISTINCT FROM do mesmo cálculo), 0 linhas são
-- tocadas, o guard (FOR EACH ROW) nem dispara, e ela entra inteira — e com
-- ela a 0910.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Adicionais da Senior no EMPREGADOS (igual à 0900, passo a) ────────
CREATE OR REPLACE FUNCTION public.rh_sync_adicionais_do_senior()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_n int := 0;
BEGIN
  IF to_regclass('espelho."BiEmpregados"') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'espelho sem BiEmpregados');
  END IF;

  WITH bi AS (
    SELECT DISTINCT ON (b.numemp, b.numcad)
           b.numemp, b.numcad,
           public.col_num(to_jsonb(b)->>'perins') AS perins,
           public.col_num(to_jsonb(b)->>'perper') AS perper
      FROM espelho."BiEmpregados" b
     WHERE b.tipcol = 1
     ORDER BY b.numemp, b.numcad, b.datadm DESC NULLS LAST
  ),
  calc AS (
    SELECT e."ID", e."Empresa", e."Cadastro",
           CASE WHEN bi.perins IS NOT NULL AND bi.perins IS DISTINCT FROM public.col_num(e."% Insalubridade")
                THEN replace(to_char(bi.perins, 'FM990.00'), '.', ',') ELSE e."% Insalubridade" END AS insal_nova,
           CASE WHEN bi.perper IS NOT NULL AND bi.perper IS DISTINCT FROM public.col_num(e."% Periculosidade")
                THEN replace(to_char(bi.perper, 'FM990.00'), '.', ',') ELSE e."% Periculosidade" END AS peric_nova,
           jsonb_build_object('% Insalubridade', e."% Insalubridade", '% Periculosidade', e."% Periculosidade") AS antes
      FROM public."EMPREGADOS" e
      JOIN bi ON bi.numemp = e."Empresa" AND bi.numcad = e."Cadastro"
  ),
  mudou AS (
    SELECT c.* FROM calc c JOIN public."EMPREGADOS" e ON e."ID" = c."ID"
     WHERE e."% Insalubridade"  IS DISTINCT FROM c.insal_nova
        OR e."% Periculosidade" IS DISTINCT FROM c.peric_nova
  ),
  upd AS (
    UPDATE public."EMPREGADOS" e
       SET "% Insalubridade"  = m.insal_nova,
           "% Periculosidade" = m.peric_nova
      FROM mudou m
     WHERE e."ID" = m."ID"
    RETURNING e."ID", m."Empresa", m."Cadastro", m.antes,
              jsonb_build_object('% Insalubridade', e."% Insalubridade", '% Periculosidade', e."% Periculosidade") AS depois
  )
  INSERT INTO public."EMPREGADOS_SYNC_SENIOR_LOG"(empregado_id, empresa, cadastro, pessoa_trocada, antes, depois)
  SELECT "ID", "Empresa", "Cadastro", false, antes, depois FROM upd;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('adicionais_corrigidos', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.rh_sync_adicionais_do_senior() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_adicionais_do_senior() TO service_role;


SELECT public.rh_sync_adicionais_do_senior();

-- ── 2. Vagas em aberto (igual à 0900, passo c), com o guard desligado ────
ALTER TABLE public."SISTEMA_RECRUTAMENTO" DISABLE TRIGGER trg_sistema_recrutamento_guard;
WITH certo AS (
  SELECT r.id,
         public.col_num(e."% Insalubridade") AS pct,
         jsonb_build_object('insalubridade_recebe', r.insalubridade_recebe, 'insalubridade_quanto', r.insalubridade_quanto) AS antes
    FROM public."SISTEMA_RECRUTAMENTO" r
    JOIN public."EMPREGADOS" e ON e."ID" = r.substituido_id
   WHERE r.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
     AND public.col_num(e."% Insalubridade") IS NOT NULL
),
novo AS (
  SELECT c.id, c.antes,
         CASE WHEN c.pct > 0 THEN 'Sim' ELSE 'Não' END AS recebe,
         -- "40%" / "20,5%": o mesmo texto que a tela grava (custoPosto.ts).
         CASE WHEN c.pct > 0 THEN replace(trim_scale(c.pct)::text, '.', ',') || '%' ELSE '' END AS quanto
    FROM certo c
)
UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET insalubridade_recebe = n.recebe,
       insalubridade_quanto = n.quanto
  FROM novo n
 WHERE r.id = n.id
   AND (r.insalubridade_recebe IS DISTINCT FROM n.recebe
        -- Percentual gravado ("... (20%)" ou "20%") diferente do da Senior.
        OR (n.recebe = 'Sim' AND public.col_num(substring(coalesce(r.insalubridade_quanto, '') FROM '([0-9]+(?:[.,][0-9]+)?)%'))
                                 IS DISTINCT FROM (SELECT c.pct FROM certo c WHERE c.id = n.id)));
ALTER TABLE public."SISTEMA_RECRUTAMENTO" ENABLE TRIGGER trg_sistema_recrutamento_guard;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.rh_sync_adicionais_do_senior();  -- (só se a 0900 também sair)
-- Os valores anteriores de "% Insalubridade"/"% Periculosidade" estão em
-- EMPREGADOS_SYNC_SENIOR_LOG (antes/depois); os das vagas não têm backup —
-- a 0900 também não guardava.
