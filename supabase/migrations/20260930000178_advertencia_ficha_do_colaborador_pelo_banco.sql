-- =========================================================================
-- Advertência: a ficha do advertido vem de EMPREGADOS pelo próprio banco
--
-- SINTOMA (17/09/2026, card de MARINES DE ABREU CRUZ, #12)
--   Posto, Admissão, Tempo de empresa e Escala em "—". A advertência foi
--   aberta antes de a tela gravar colaborador_admissao/posto/escala (mig
--   175) — e a produção continua com o front antigo, que não manda essas
--   colunas. Está tudo em EMPREGADOS; é o banco que tem que puxar.
--
-- O QUE MUDA
--   1. Trigger adv_ficha_do_colaborador (BEFORE INSERT): o que vier NULL
--      (admissão, posto, escala, e também CPF, cargo e filial) é copiado de
--      EMPREGADOS pelo colaborador_id. Front novo ou velho, a ficha sai
--      completa.
--        admissão ← "Admissão" (ISO ou DD/MM/AAAA — rh_data_br_para_date)
--        posto    ← "Descrição do Local" (senão "Nome do Posto")
--        escala   ← "Escala" — já é a descrição ("08:45-12:00/13:15-18:00
--                   (200h)"); o código fica em "Escala_1" (302) e não serve
--                   pra ninguém ler.
--   2. Estoque: as 7 advertências sem esses dados são preenchidas agora.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.adv_ficha_do_colaborador()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  e record;
BEGIN
  IF NEW.colaborador_id IS NULL THEN RETURN NEW; END IF;
  SELECT "CPF", "Título do Cargo", "Nome Filial", "Admissão", "Descrição do Local", "Nome do Posto", "Escala"
    INTO e
    FROM public."EMPREGADOS" WHERE "ID" = NEW.colaborador_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.colaborador_cpf      := coalesce(nullif(NEW.colaborador_cpf, ''),      e."CPF");
  NEW.colaborador_cargo    := coalesce(nullif(NEW.colaborador_cargo, ''),    e."Título do Cargo");
  NEW.colaborador_filial   := coalesce(nullif(NEW.colaborador_filial, ''),   e."Nome Filial");
  NEW.colaborador_admissao := coalesce(NEW.colaborador_admissao,             public.rh_data_br_para_date(e."Admissão"));
  NEW.colaborador_posto    := coalesce(nullif(NEW.colaborador_posto, ''),    nullif(e."Descrição do Local", ''), nullif(e."Nome do Posto", ''));
  NEW.colaborador_escala   := coalesce(nullif(NEW.colaborador_escala, ''),   nullif(e."Escala", ''));
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_adv_ficha_do_colaborador ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
CREATE TRIGGER trg_adv_ficha_do_colaborador
  BEFORE INSERT ON public."SISTEMA_SOLICITACOES_ADVERTENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.adv_ficha_do_colaborador();

-- Estoque: o que já foi pedido sem a ficha.
UPDATE public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   SET colaborador_admissao = coalesce(a.colaborador_admissao, public.rh_data_br_para_date(e."Admissão")),
       colaborador_posto    = coalesce(nullif(a.colaborador_posto, ''),  nullif(e."Descrição do Local", ''), nullif(e."Nome do Posto", '')),
       colaborador_escala   = coalesce(nullif(a.colaborador_escala, ''), nullif(e."Escala", '')),
       colaborador_cpf      = coalesce(nullif(a.colaborador_cpf, ''),    e."CPF"),
       colaborador_cargo    = coalesce(nullif(a.colaborador_cargo, ''),  e."Título do Cargo")
  FROM public."EMPREGADOS" e
 WHERE e."ID" = a.colaborador_id
   AND (a.colaborador_admissao IS NULL OR coalesce(a.colaborador_posto, '') = '' OR coalesce(a.colaborador_escala, '') = '');

NOTIFY pgrst, 'reload schema';

-- Conferência: deve devolver 0.
-- SELECT count(*) FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA"
--  WHERE colaborador_id IS NOT NULL AND (colaborador_admissao IS NULL OR colaborador_escala IS NULL);

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_adv_ficha_do_colaborador ON public."SISTEMA_SOLICITACOES_ADVERTENCIA";
-- DROP FUNCTION IF EXISTS public.adv_ficha_do_colaborador();
-- (o preenchimento do estoque fica — é o dado real do cadastro)
-- NOTIFY pgrst, 'reload schema';
