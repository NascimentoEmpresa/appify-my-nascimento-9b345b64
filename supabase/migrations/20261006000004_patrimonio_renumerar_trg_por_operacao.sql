-- =========================================================================
-- Patrimônio › Obrigações: "Erro: relation "velhas" does not exist" (06/10/2026)
--
-- SINTOMA (Pablo, 06/10/2026): cadastrar uma obrigação nova em qualquer
-- patrimônio dava o erro acima ao salvar.
--
-- CAUSA: jur_parcelas_renumerar_trg (mig 20260930000108) é a MESMA função
-- dos três gatilhos de "JUR_PATRIMONIO_OBRIGACOES", e numa consulta só lia
-- as duas transition tables (novas UNION velhas). Mas cada gatilho só
-- declara as que existem na operação:
--   · INSERT → só "novas"   → faltava "velhas" (o erro do cadastro);
--   · DELETE → só "velhas"  → faltava "novas" (excluir quebraria igual);
--   · UPDATE → as duas      → era o único caminho que funcionava.
--
-- CORREÇÃO: um ramo por TG_OP — o PL/pgSQL só prepara a consulta do ramo
-- que roda, então cada operação só toca a tabela que tem. A regra de
-- renumerar (jur_parcelas_renumerar) não muda.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.jur_parcelas_renumerar_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE c uuid;
BEGIN
  -- A renumeração faz UPDATE na mesma tabela; sem esta guarda o trigger se
  -- chamaria de novo (e de novo).
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    FOR c IN SELECT DISTINCT contrato_uid FROM novas WHERE contrato_uid IS NOT NULL LOOP
      PERFORM public.jur_parcelas_renumerar(c);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR c IN SELECT DISTINCT contrato_uid FROM velhas WHERE contrato_uid IS NOT NULL LOOP
      PERFORM public.jur_parcelas_renumerar(c);
    END LOOP;
  ELSE
    FOR c IN
      SELECT DISTINCT contrato_uid FROM (
        SELECT contrato_uid FROM novas  WHERE contrato_uid IS NOT NULL
        UNION ALL
        SELECT contrato_uid FROM velhas WHERE contrato_uid IS NOT NULL
      ) x
    LOOP
      PERFORM public.jur_parcelas_renumerar(c);
    END LOOP;
  END IF;
  RETURN NULL;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK: reaplicar jur_parcelas_renumerar_trg da mig 20260930000108
-- (volta o erro no INSERT/DELETE — não fazer).
