-- SIS-2026-0614: as NFs subiam para o Relatório de Serviços na ordem em que o ANALISTA as criou
-- (created_at); precisam subir na ordem em que o FINANCEIRO as concluiu.
--
-- nf_emissao não guardava o momento da conclusão (updated_at muda a cada edição, não serve).
--   1) coluna concluida_em: o momento em que o Financeiro concluiu (ou cancelou) a validação;
--   2) trigger que a grava quando o status passa para concluida/cancelada.
-- A tela ordena por concluida_em, com fallback para created_at.
--
-- SEM backfill de propósito: uma primeira versão com backfill deu deadlock ao rodar com o sistema em
-- uso (ACCESS EXCLUSIVE em nf_emissao + leitura do histórico na mesma transação). Notas concluídas
-- ANTES desta migration ficam sem concluida_em e continuam ordenadas pela data de criação, como hoje;
-- toda conclusão a partir de agora já grava o momento certo.
--
-- Rodar fora de pico. lock_timeout faz a migration desistir em 5 s em vez de ficar travando as
-- gravações de NF; se estourar, é só rodar de novo.

SET lock_timeout = '5s';

ALTER TABLE public.nf_emissao ADD COLUMN IF NOT EXISTS concluida_em timestamptz;

CREATE OR REPLACE FUNCTION public.nf_emissao_marca_concluida_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('concluida', 'cancelada')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.concluida_em IS NULL THEN
    NEW.concluida_em := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfe_marca_concluida_em ON public.nf_emissao;
CREATE TRIGGER nfe_marca_concluida_em
  BEFORE INSERT OR UPDATE OF status ON public.nf_emissao
  FOR EACH ROW EXECUTE FUNCTION public.nf_emissao_marca_concluida_em();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TRIGGER IF EXISTS nfe_marca_concluida_em ON public.nf_emissao;
--   DROP FUNCTION IF EXISTS public.nf_emissao_marca_concluida_em();
--   ALTER TABLE public.nf_emissao DROP COLUMN IF EXISTS concluida_em;
--   NOTIFY pgrst, 'reload schema';
