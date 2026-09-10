-- =========================================================================
-- Demissão — o SST só recebe DEPOIS do RH, e agora quem garante é o banco.
--
-- O QUE ACONTECEU (08/09/2026)
--   A ordem virou Encarregado → Analista → RH → SST, mas a regra morava só
--   no bundle do React. Produção seguiu servindo o build antigo por algumas
--   horas, e nesse intervalo o analista aprovou três solicitações que foram
--   direto para "Pendente SST", sem passar pelo RH — apareceram na fila do
--   SST com `rh_por` vazio.
--
--   Os carimbos não deixam dúvida: a #7, aprovada às 12:49 pelo build novo,
--   foi para "Pendente RH"; as #9/#10/#11, às 17:24-17:53 pelo build antigo,
--   foram para o SST.
--
-- POR QUE UM TRIGGER, E NÃO SÓ CORRIGIR O FRONT
--   O front JÁ estava certo. O que faltava era a regra existir em algum lugar
--   que a aba velha de alguém não consiga contornar — e aba velha é a coisa
--   mais comum do mundo num ERP que fica aberto o dia inteiro. Ordem de fluxo
--   é regra de negócio; morar só no JavaScript é morar do lado errado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.demissao_exige_rh_antes_do_sst()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- `rh_por` é o carimbo de quem liberou. Sem ele, a solicitação não passou
  -- pelo RH — venha o UPDATE de onde vier.
  IF NEW.status = 'Pendente SST' AND coalesce(btrim(NEW.rh_por), '') = '' THEN
    RAISE EXCEPTION 'A solicitação só vai para o SST depois que o RH liberar.'
      USING HINT = 'Recarregue a página: a tela está com uma versão antiga do fluxo.';
  END IF;
  RETURN NEW;
END $$;

-- Trigger não aceita CREATE OR REPLACE.
DROP TRIGGER IF EXISTS trg_demissao_exige_rh_antes_do_sst ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_exige_rh_antes_do_sst
  BEFORE INSERT OR UPDATE ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_exige_rh_antes_do_sst();

-- As três que ficaram presas no SST voltam para a fila do RH, que é onde
-- deveriam estar. O SST ainda não tocou em nenhuma (`sst_por` vazio).
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente RH'
 WHERE status = 'Pendente SST'
   AND coalesce(btrim(rh_por), '') = ''
   AND sst_por IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT status, count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" GROUP BY 1 ORDER BY 1;

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_demissao_exige_rh_antes_do_sst ON public."SISTEMA_SOLICITACOES_DEMISSAO";
--   DROP FUNCTION IF EXISTS public.demissao_exige_rh_antes_do_sst();
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
