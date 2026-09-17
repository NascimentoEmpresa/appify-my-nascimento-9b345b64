-- =========================================================================
-- Advertência: ninguém aplica advertência em si mesmo
--
-- PEDIDO (17/09/2026, Pablo): "o usuário não pode dar uma advertência pra
-- si mesmo, não pode selecionar o próprio nome; o sistema avisa".
--
-- A tela já recusa a escolha (MinhasSolicitacoes › selecionarColabAdv, por
-- ID do vínculo ou CPF). Este trigger é o piso: BEFORE INSERT em
-- SISTEMA_SOLICITACOES_ADVERTENCIA compara o colaborador advertido com quem
-- está logado — pelo ID de EMPREGADOS vinculado ao login (auth_user_id) e,
-- na falta do vínculo, pelo CPF do cadastro contra o e-mail do solicitante.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.adv_nao_em_si_mesmo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_meu_id  bigint;
  v_meu_cpf text;
BEGIN
  IF NEW.colaborador_id IS NULL THEN RETURN NEW; END IF;
  SELECT e."ID", regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g')
    INTO v_meu_id, v_meu_cpf
    FROM public."EMPREGADOS" e
   WHERE e.auth_user_id = auth.uid()
   LIMIT 1;
  IF v_meu_id IS NOT NULL AND NEW.colaborador_id = v_meu_id THEN
    RAISE EXCEPTION 'Você não pode aplicar uma advertência em si mesmo.';
  END IF;
  IF v_meu_cpf <> '' AND regexp_replace(coalesce(NEW.colaborador_cpf, ''), '\D', '', 'g') = v_meu_cpf THEN
    RAISE EXCEPTION 'Você não pode aplicar uma advertência em si mesmo.';
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_adv_nao_em_si_mesmo ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_nao_em_si_mesmo
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.adv_nao_em_si_mesmo();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_adv_nao_em_si_mesmo ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP FUNCTION IF EXISTS public.adv_nao_em_si_mesmo();
-- NOTIFY pgrst, 'reload schema';
