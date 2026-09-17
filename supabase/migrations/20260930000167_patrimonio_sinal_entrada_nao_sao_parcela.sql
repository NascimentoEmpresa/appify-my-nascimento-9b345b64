-- =========================================================================
-- Patrimônio › Contas/Obrigações: SINAL e ENTRADA não são parcela
--
-- SINTOMA (16/09/2026, GREEN PARCELAS / Imóvel Turim)
--   A lista mostrava "A) SINAL", "B) ENTRADA" e logo em seguida "Parcela
--   3/69", "Parcela 4/69"... O contrato tem 67 parcelas: as duas primeiras
--   linhas são o sinal e a entrada, pagos antes de o carnê começar. A
--   migration 20260930000108 numera pela ordem do vencimento e, sem saber
--   distinguir, contava as duas como parcelas 1 e 2 — a 1ª parcela de
--   verdade aparecia como 3/69 e o total do contrato saía 2 a mais.
--
-- REGRA
--   Cada linha de contrato ganha um `tipo_lancamento`:
--     parcela (padrão) · sinal · entrada · reforco · quitacao
--   Só `parcela` entra na numeração: N/T conta apenas as parcelas, sinal e
--   entrada ficam sem número (parcela_numero/parcela_total NULL). A planilha
--   de origem já era assim — o "Total de Parcelas" dela conta só as
--   numeradas; sinal, entrada, reforço e quitação são linhas à parte (ver
--   scripts/lancar-contas-patrimonio.mjs).
--
--   1. Cria a coluna e classifica o que existe pelo rótulo da descrição
--      ("A) SINAL", "B) ENTRADA", "Entrada", "Reforço", "Quitação"...).
--   2. Reescreve jur_parcelas_renumerar: numera só as parcelas e limpa o
--      número das demais. Os triggers da 000108 continuam os mesmos — já
--      chamam esta função em qualquer INSERT/UPDATE/DELETE, então trocar o
--      tipo pela tela renumera o contrato na hora.
--   3. Renumera todos os contratos.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Coluna + classificação do estoque ────────────────────────────────
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD COLUMN IF NOT EXISTS tipo_lancamento text NOT NULL DEFAULT 'parcela';

ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  DROP CONSTRAINT IF EXISTS jur_patr_obr_tipo_lancamento_chk;
ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES"
  ADD CONSTRAINT jur_patr_obr_tipo_lancamento_chk
  CHECK (tipo_lancamento IN ('parcela', 'sinal', 'entrada', 'reforco', 'quitacao'));

COMMENT ON COLUMN public."JUR_PATRIMONIO_OBRIGACOES".tipo_lancamento IS
  'O que esta linha é dentro do contrato: parcela (numerada), sinal, entrada, reforco ou quitacao. Só parcela entra em parcela_numero/parcela_total.';

-- O rótulo fica no fim da descrição, depois do " · " (ou é a descrição
-- inteira), às vezes com letra na frente: "GREEN PARCELAS · A) SINAL".
-- Só mexe em quem ainda está como 'parcela' — classificação feita pela tela
-- não é desfeita se a migration rodar de novo.
UPDATE public."JUR_PATRIMONIO_OBRIGACOES"
   SET tipo_lancamento = CASE
         WHEN descricao ~* '(^|·)\s*([a-z][\)\.\-]\s*)?sinal(\W|$)'            THEN 'sinal'
         WHEN descricao ~* '(^|·)\s*([a-z][\)\.\-]\s*)?entrada(\W|$)'          THEN 'entrada'
         WHEN descricao ~* '(^|·)\s*([a-z][\)\.\-]\s*)?refor[cç]o(\W|$)'       THEN 'reforco'
         WHEN descricao ~* '(^|·)\s*([a-z][\)\.\-]\s*)?quita[cç][aã]o(\W|$)'   THEN 'quitacao'
         ELSE tipo_lancamento
       END
 WHERE tipo_lancamento = 'parcela'
   AND contrato_uid IS NOT NULL
   AND descricao !~* '·\s*Parcela\s+\d+\s*/\s*\d+\s*$';

-- ── 2) Numera só as parcelas ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_parcelas_renumerar(p_contrato uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_contrato IS NULL THEN RETURN; END IF;

  -- Parcelas: N-ésima pelo vencimento (empate: número antigo, depois id).
  WITH ordem AS (
    SELECT id,
           row_number() OVER (ORDER BY vencimento NULLS LAST, parcela_numero NULLS LAST, id) AS n,
           count(*)     OVER ()                                                             AS total
      FROM public."JUR_PATRIMONIO_OBRIGACOES"
     WHERE contrato_uid = p_contrato
       AND tipo_lancamento = 'parcela'
  )
  UPDATE public."JUR_PATRIMONIO_OBRIGACOES" o
     SET parcela_numero = ordem.n,
         parcela_total  = ordem.total,
         descricao      = CASE
                            WHEN o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$'
                              THEN regexp_replace(o.descricao, '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$', ' · Parcela ' || ordem.n || '/' || ordem.total)
                            ELSE o.descricao
                          END
    FROM ordem
   WHERE o.id = ordem.id
     AND (o.parcela_numero IS DISTINCT FROM ordem.n
          OR o.parcela_total IS DISTINCT FROM ordem.total
          OR (o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$'
              AND o.descricao !~ ('\s·\s*Parcela\s+' || ordem.n || '\s*/\s*' || ordem.total || '\s*$')));

  -- Sinal, entrada, reforço e quitação: sem número. Se a linha foi
  -- reclassificada pela tela e a descrição ainda dizia "· Parcela 1/69",
  -- troca pelo nome do tipo, senão a lista continuaria enganando.
  UPDATE public."JUR_PATRIMONIO_OBRIGACOES" o
     SET parcela_numero = NULL,
         parcela_total  = NULL,
         descricao      = CASE
                            WHEN o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$'
                              THEN regexp_replace(o.descricao, '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$',
                                     ' · ' || CASE o.tipo_lancamento
                                                WHEN 'sinal'    THEN 'Sinal'
                                                WHEN 'entrada'  THEN 'Entrada'
                                                WHEN 'reforco'  THEN 'Reforço'
                                                WHEN 'quitacao' THEN 'Quitação'
                                                ELSE o.tipo_lancamento END)
                            ELSE o.descricao
                          END
   WHERE o.contrato_uid = p_contrato
     AND o.tipo_lancamento <> 'parcela'
     AND (o.parcela_numero IS NOT NULL
          OR o.parcela_total IS NOT NULL
          OR o.descricao ~ '\s·\s*Parcela\s+\d+\s*/\s*\d+\s*$');
END $fn$;
REVOKE ALL ON FUNCTION public.jur_parcelas_renumerar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jur_parcelas_renumerar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.jur_parcelas_renumerar(uuid) TO authenticated;

-- ── 3) Renumera todos os contratos ──────────────────────────────────────
DO $$
DECLARE c uuid;
BEGIN
  FOR c IN SELECT DISTINCT contrato_uid FROM public."JUR_PATRIMONIO_OBRIGACOES" WHERE contrato_uid IS NOT NULL LOOP
    PERFORM public.jur_parcelas_renumerar(c);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência: o que ficou classificado como sinal/entrada/reforço/quitação.
-- SELECT patrimonio_id, tipo_lancamento, descricao, vencimento, valor
--   FROM public."JUR_PATRIMONIO_OBRIGACOES"
--  WHERE tipo_lancamento <> 'parcela' ORDER BY patrimonio_id, vencimento;
--
-- Conferência: parcela_total de cada contrato = quantidade de linhas 'parcela'.
-- SELECT contrato_uid, max(parcela_total) AS total, count(*) FILTER (WHERE tipo_lancamento = 'parcela') AS parcelas
--   FROM public."JUR_PATRIMONIO_OBRIGACOES" WHERE contrato_uid IS NOT NULL
--  GROUP BY contrato_uid HAVING max(parcela_total) <> count(*) FILTER (WHERE tipo_lancamento = 'parcela');

-- =========================================================================
-- ROLLBACK (volta a função da 000108, que numera tudo; a coluna pode ficar)
-- =========================================================================
-- CREATE OR REPLACE FUNCTION public.jur_parcelas_renumerar(p_contrato uuid) ... (corpo da 20260930000108)
-- DO $$ DECLARE c uuid; BEGIN
--   FOR c IN SELECT DISTINCT contrato_uid FROM public."JUR_PATRIMONIO_OBRIGACOES" WHERE contrato_uid IS NOT NULL LOOP
--     PERFORM public.jur_parcelas_renumerar(c);
--   END LOOP; END $$;
-- ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" DROP CONSTRAINT IF EXISTS jur_patr_obr_tipo_lancamento_chk;
-- ALTER TABLE public."JUR_PATRIMONIO_OBRIGACOES" DROP COLUMN IF EXISTS tipo_lancamento;
