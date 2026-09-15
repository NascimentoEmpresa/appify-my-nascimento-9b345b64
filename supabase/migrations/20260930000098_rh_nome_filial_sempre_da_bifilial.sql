-- =========================================================================
-- EMPREGADOS: "Nome Filial" se mantém sozinho, a partir de "Filial"
--
-- "Como faço para isso se manter assim?" (11/09/2026)
--
--   O robô do Senior (integracao-senior/, RPC rh_sync_senior_empregados)
--   grava "Filial" (o codfil) a cada rodada, mas nunca "Nome Filial". Um
--   admitido novo ficava com o nome em branco até alguém rodar
--   rh_enriquecer_empregados_do_espelho() à mão — e não há cron para isso.
--   O gatilho da 089 só PREFIXAVA um nome que já existisse.
--
--   Agora o gatilho DERIVA: sempre que "Filial" chega (INSERT) ou muda
--   (UPDATE), "Nome Filial" recebe "<código> - <apelido>" da BiFilial da
--   mesma empresa. Filial é a verdade; o nome é consequência. Se a filial
--   não existir no espelho (5 linhas históricas), vale o comportamento
--   antigo: prefixa o que veio.
--
--   Com isto a corrente fecha sem ninguém apertar botão:
--     Senior -> espelho (BiFilial)  -> EMPREGADOS."Nome Filial" (este gatilho)
--            -> demissão.contrato   (trg_demissao_contrato_pelo_cadastro, 097)
--            -> vaga.contrato       (rotuloContrato, na tela)
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_empregados_nome_filial_com_codigo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, espelho, pg_temp
AS $fn$
DECLARE
  v_oficial text;
BEGIN
  IF NEW."Filial" IS NULL THEN
    RETURN NEW;
  END IF;

  -- Filial nova ou trocada: o nome vem do espelho, ponto.
  IF TG_OP = 'INSERT'
     OR NEW."Filial" IS DISTINCT FROM OLD."Filial"
     OR nullif(btrim(coalesce(NEW."Nome Filial", '')), '') IS NULL THEN
    SELECT f.codigo::text || ' - ' || btrim(f.apelido) INTO v_oficial
      FROM espelho."BiFilial" f
     WHERE f.empresa = NEW."Empresa" AND f.codigo = NEW."Filial"
       AND nullif(btrim(f.apelido), '') IS NOT NULL
     LIMIT 1;
    IF v_oficial IS NOT NULL THEN
      NEW."Nome Filial" := v_oficial;
      RETURN NEW;
    END IF;
  END IF;

  -- Fora do espelho: ao menos o código na frente (regra da 089).
  IF nullif(btrim(coalesce(NEW."Nome Filial", '')), '') IS NOT NULL
     AND NEW."Nome Filial" !~ '^\s*\d+\s*-' THEN
    NEW."Nome Filial" := NEW."Filial"::text || ' - ' || btrim(NEW."Nome Filial");
  END IF;
  RETURN NEW;
END $fn$;

-- O gatilho já existe (089) e aponta para esta função; só garante que está
-- ligado nos eventos certos.
DROP TRIGGER IF EXISTS trg_rh_empregados_nome_filial_com_codigo ON public."EMPREGADOS";
CREATE TRIGGER trg_rh_empregados_nome_filial_com_codigo
  BEFORE INSERT OR UPDATE OF "Nome Filial", "Filial", "Empresa" ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.rh_empregados_nome_filial_com_codigo();

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
-- Simulação (revertida): INSERT sem Nome Filial tem que sair com ele.
-- =========================================================================
-- ROLLBACK: recriar a função pela 20260930000089.
-- =========================================================================
