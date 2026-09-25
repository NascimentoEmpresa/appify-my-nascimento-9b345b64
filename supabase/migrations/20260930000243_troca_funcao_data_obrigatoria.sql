-- =========================================================================
-- Mudança de função / de horário: a DATA da troca passa a ser obrigatória
--
-- PEDIDO (25/09/2026, RH via Pablo)
--   "Precisamos que seja ajustado para obrigatório a data de troca de função
--   ou de horário, pois recebemos uma solicitação sem a mesma e isso impede
--   que seja feita a devida troca, pois não contém a data a qual se dará."
--
-- O formulário (SolicitarTrocaFuncao.tsx) já exige a data; o banco repete a
-- regra num gatilho BEFORE INSERT. Não é CHECK nem NOT NULL de propósito:
-- existe 1 pedido antigo sem data, e uma CHECK barraria qualquer UPDATE nele
-- (aprovar, concluir). Só pedido NOVO precisa da data.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.troca_funcao_exige_data()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.data_pretendida IS NULL THEN
    RAISE EXCEPTION 'Informe a data da troca (a partir de quando vale a nova função ou o novo horário).'
      USING HINT = 'Recarregue a página: a tela está com uma versão antiga do formulário.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_troca_funcao_exige_data ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_troca_funcao_exige_data
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.troca_funcao_exige_data();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_troca_funcao_exige_data ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- DROP FUNCTION IF EXISTS public.troca_funcao_exige_data();
-- NOTIFY pgrst, 'reload schema';
