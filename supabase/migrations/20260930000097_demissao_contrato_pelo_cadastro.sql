-- =========================================================================
-- Demissão: o contrato da solicitação vem SEMPRE do cadastro (gatilho)
--
-- O SINTOMA (11/09/2026, de novo)
--   A 20260930000089 corrigiu as 31 solicitações que tinham o POSTO gravado
--   como contrato ("1109 - DECA") e a tela passou a gravar a filial. Só que a
--   tela corrigida está na branch, não em produção: o site continuou com o
--   código antigo e as #43–#53, abertas hoje, nasceram erradas de novo
--   (16 das 47 divergindo do cadastro).
--
-- A CORREÇÃO — no banco, onde vale para qualquer versão da tela
--   Gatilho BEFORE INSERT/UPDATE em SISTEMA_SOLICITACOES_DEMISSAO: com
--   `colaborador_id`, `contrato` e `colaborador_filial` recebem o
--   "Nome Filial" atual de EMPREGADOS ("1109 - POLICIA CIVIL RS LIMPEZA
--   066.2026", já com o código desde a 089/095). O que a tela mandar nesses
--   dois campos é ignorado — a fonte é o cadastro, não o formulário.
--   `colaborador_posto` continua sendo o posto ("1109 - DECA"): é outra
--   coluna, com outro nome, e a tela mostra como "Posto".
--
--   E o estoque: as 16 são reescritas pelo mesmo caminho.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.demissao_contrato_pelo_cadastro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome_filial text;
BEGIN
  IF NEW.colaborador_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT nullif(btrim(e."Nome Filial"), '') INTO v_nome_filial
    FROM public."EMPREGADOS" e WHERE e."ID" = NEW.colaborador_id;
  IF v_nome_filial IS NOT NULL THEN
    NEW.contrato           := v_nome_filial;
    NEW.colaborador_filial := v_nome_filial;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_demissao_contrato_pelo_cadastro ON public."SISTEMA_SOLICITACOES_DEMISSAO";
CREATE TRIGGER trg_demissao_contrato_pelo_cadastro
  BEFORE INSERT OR UPDATE OF colaborador_id, contrato, colaborador_filial
  ON public."SISTEMA_SOLICITACOES_DEMISSAO"
  FOR EACH ROW EXECUTE FUNCTION public.demissao_contrato_pelo_cadastro();

-- Estoque: passa cada linha divergente pelo gatilho.
UPDATE public."SISTEMA_SOLICITACOES_DEMISSAO" s
   SET contrato = s.contrato
  FROM public."EMPREGADOS" e
 WHERE e."ID" = s.colaborador_id
   AND nullif(btrim(e."Nome Filial"), '') IS NOT NULL
   AND (s.contrato IS DISTINCT FROM btrim(e."Nome Filial")
     OR s.colaborador_filial IS DISTINCT FROM btrim(e."Nome Filial"));

NOTIFY pgrst, 'reload schema';

-- ── Conferência (esperado: 0) ────────────────────────────────────────────
SELECT count(*) AS divergentes
  FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
  JOIN public."EMPREGADOS" e ON e."ID" = s.colaborador_id
 WHERE nullif(btrim(e."Nome Filial"), '') IS NOT NULL
   AND s.contrato IS DISTINCT FROM btrim(e."Nome Filial");

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_demissao_contrato_pelo_cadastro ON public."SISTEMA_SOLICITACOES_DEMISSAO";
-- DROP FUNCTION IF EXISTS public.demissao_contrato_pelo_cadastro();
-- (o contrato reescrito não volta a ser o posto — não faz sentido)
-- NOTIFY pgrst, 'reload schema';
