-- =========================================================================
-- RECRUTAMENTO — o avanco para ADMISSAO vira regra do BANCO
--
-- SST e Compras aprovam em MODULOS DIFERENTES (SST > ASO/Admissao e
-- Suprimentos > EPIs/Admissoes), cada um com o seu acesso. Nenhuma das duas
-- telas pode ser dona da regra "os dois aprovaram, entao vai para
-- ADMISSAO": qualquer uma que fosse teria de saber do estado da outra, e a
-- primeira a aprovar nao tem como saber se sera a ultima.
--
-- Por isso o avanco e um TRIGGER: quem quer que grave o segundo `ok`
-- dispara a passagem, sem que a tela precise saber disso.
--
-- Tambem registra no historico, porque a movimentacao deixa de ter uma tela
-- por tras para faze-lo.
--
-- Idempotente.
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_rec_paralelo_admissao ON public."WA_CURRICULOS";
--   DROP FUNCTION IF EXISTS public.rec_paralelo_admissao();
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_paralelo_admissao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- So age na etapa paralela e so quando os DOIS estao aprovados. Os nomes
  -- antigos entram porque dado gravado antes da fusao continua valendo.
  IF NEW.etapa_processo IN ('SST + COMPRAS', 'EXAME SST', 'COMPRAS')
     AND NEW.sst_ok IS TRUE AND NEW.compras_ok IS TRUE
  THEN
    NEW.etapa_processo   := 'ADMISSÃO';
    NEW.etapa_changed_at := now();

    INSERT INTO public."RECRUTAMENTO_HISTORICO"
      (solicitacao_id, candidato_id, candidato_nome, evento, de_status, para_status, papel, usuario_nome, detalhe)
    VALUES
      (NEW.vaga_id, NEW.id, NEW.nome, 'SST e Compras aprovaram → Admissão',
       'SST + COMPRAS', 'ADMISSÃO', 'SST + Suprimentos', 'Sistema',
       'Avanço automático: os dois setores aprovaram.');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_rec_paralelo_admissao ON public."WA_CURRICULOS";
CREATE TRIGGER trg_rec_paralelo_admissao
  BEFORE UPDATE OF sst_ok, compras_ok ON public."WA_CURRICULOS"
  FOR EACH ROW EXECUTE FUNCTION public.rec_paralelo_admissao();

NOTIFY pgrst, 'reload schema';
