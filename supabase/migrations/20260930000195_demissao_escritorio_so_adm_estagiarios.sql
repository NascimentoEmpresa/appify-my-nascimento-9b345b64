-- =========================================================================
-- Demissão: só o contrato ADM E ESTAGIÁRIOS é "escritório" (→ Diretoria)
--
-- PEDIDO (18/09/2026, Pablo): "o pessoal tá conseguindo selecionar quem não
-- é ADM e Estagiários NH" — a #83 (UFRGS Auxiliar de Saúde Bucal) foi parar
-- em Pendente Diretoria porque o encarregado escolheu um SETOR, e setor
-- sozinho roteava pra Diretoria. A tela agora marca "escritório" sozinha
-- pelo contrato e só mostra setor quando é escritório; aqui o banco repete
-- a regra pra ninguém contornar.
--
--   • trigger demissao_escritorio_pelo_contrato (BEFORE INSERT): contrato
--     fora de "ADM E ESTAGI…" → e_escritorio = false, setor = NULL e, se
--     nasceu "Pendente Diretoria", vai pra "Pendente Operacional".
--   • a #83 é corrigida: volta pro Operacional, sem setor.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.demissao_contrato_eh_escritorio(_contrato text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT upper(translate(coalesce(_contrato, ''), 'ÁÉÍÓÚÂÊÔÃÕÇ', 'AEIOUAEOAOC')) ~ '\mADM(INISTRATIV\w*)?\s*E\s*ESTAGI';
$fn$;

CREATE OR REPLACE FUNCTION public.demissao_escritorio_pelo_contrato()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT public.demissao_contrato_eh_escritorio(NEW.contrato) THEN
    NEW.e_escritorio := false;
    NEW.setor := NULL;
    IF NEW.status = 'Pendente Diretoria' THEN NEW.status := 'Pendente Operacional'; END IF;
  ELSE
    NEW.e_escritorio := true;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_escritorio_pelo_contrato ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_escritorio_pelo_contrato
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_escritorio_pelo_contrato();

-- A que já vazou: volta pra fila certa.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO"
   SET status = 'Pendente Operacional', setor = NULL, e_escritorio = false, atualizado_em = now()
 WHERE status = 'Pendente Diretoria'
   AND NOT public.demissao_contrato_eh_escritorio(contrato);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_demissao_escritorio_pelo_contrato ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP FUNCTION IF EXISTS public.demissao_escritorio_pelo_contrato(), public.demissao_contrato_eh_escritorio(text);
-- NOTIFY pgrst, 'reload schema';
