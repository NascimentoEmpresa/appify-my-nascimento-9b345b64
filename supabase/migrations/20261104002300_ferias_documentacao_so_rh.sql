-- =========================================================================
-- FÉRIAS — malote e retorno da documentação: só o RH grava (04/11/2026)
--
-- Pablo: "é o RH que define o STATUS da documentação e a data do malote, não
-- é o encarregado/solicitante." Na tela o encarregado só VÊ os campos
-- (mig 20261104002200), mas a tabela tem a policy aberta sf_all_auth: pela
-- API qualquer logado gravaria. Aqui a garantia no banco.
--
--   ferias_documentacao_so_rh (BEFORE INSERT OR UPDATE OF data_malote,
--   retorno_documentacao): quem não tem Gestão de Férias › alterar
--   (has_screen_access 'rh_ferias') não muda os dois campos — no UPDATE a
--   tentativa é recusada; no INSERT (o encarregado criando o pedido) os
--   campos são zerados em silêncio, porque o formulário nunca os manda.
--   Sem usuário (auth.uid() nulo: carga/manutenção direto no banco) passa.
-- Em 04/11/2026 têm o "alterar": NATHALY, SABRINA e os demais do RH (17).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.ferias_documentacao_so_rh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR public.has_screen_access(auth.uid(), 'rh_ferias', 'alterar'::app_acao) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.data_malote := NULL;
    NEW.retorno_documentacao := NULL;
    RETURN NEW;
  END IF;
  IF NEW.data_malote IS DISTINCT FROM OLD.data_malote
     OR NEW.retorno_documentacao IS DISTINCT FROM OLD.retorno_documentacao THEN
    RAISE EXCEPTION 'Só o RH (Gestão de Férias › alterar) define a data do malote e o retorno da documentação.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_documentacao_so_rh() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_documentacao_so_rh ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_documentacao_so_rh
  BEFORE INSERT OR UPDATE OF data_malote, retorno_documentacao ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_documentacao_so_rh();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_ferias_documentacao_so_rh ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP FUNCTION IF EXISTS public.ferias_documentacao_so_rh();
-- NOTIFY pgrst, 'reload schema';
