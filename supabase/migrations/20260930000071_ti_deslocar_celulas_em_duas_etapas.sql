-- =====================================================================
-- T.I — segunda (e definitiva) correção do "duplicate key" ao aumentar o
-- piso pela esquerda ou por cima.
--
-- A PRIMEIRA TENTATIVA (20260930000070) NÃO FUNCIONOU, e vale registrar por
-- quê, porque o erro é sutil:
--
--   WITH movidas AS (DELETE ... RETURNING ...) INSERT ... SELECT FROM movidas
--
--   parece resolver — apaga antes de inserir —, mas em Postgres as partes de
--   uma instrução com CTE que modifica dados rodam no MESMO SNAPSHOT. O
--   INSERT não enxerga o efeito do DELETE, o índice único ainda contém as
--   linhas antigas, e a chave (planta, 7, 6) colide igual. Provado no banco:
--   o ensaio com o piso materializado falhou exatamente assim.
--
-- O QUE FUNCIONA
--   Duas instruções separadas, com uma parada numa faixa que ninguém usa:
--     1) cx = cx + 1000000   → todas saem da faixa real
--     2) cx = cx - 1000000 + N → todas voltam já deslocadas
--   Em nenhum dos dois passos a origem e o destino se cruzam, então não há
--   instante com duas células na mesma chave. O valor de parada é grande o
--   bastante para nunca encostar num piso real (seria um escritório de 10 mil
--   quilômetros).
--
--   Alternativas descartadas: PK DEFERRABLE (afrouxa a garantia para todo
--   mundo por causa de um caminho só) e tabela temporária (mais peças móveis
--   para o mesmo efeito).
--
-- Idempotente.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ti_expandir_planta(
  p_planta uuid,
  p_lado   text,
  p_metros integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cm     integer := p_metros * 100;
  v_parada constant integer := 1000000;
BEGIN
  IF NOT public.ti_pode_construir('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar a planta.';
  END IF;
  IF p_lado NOT IN ('norte', 'sul', 'leste', 'oeste') THEN
    RAISE EXCEPTION 'Lado inválido: %', p_lado;
  END IF;
  IF p_metros IS NULL OR p_metros < 1 OR p_metros > 20 THEN
    RAISE EXCEPTION 'Expansão precisa ser de 1 a 20 metros.';
  END IF;

  IF p_lado = 'leste' THEN
    UPDATE public."TI_PLANTA" SET largura_cm = largura_cm + v_cm WHERE id = p_planta;

  ELSIF p_lado = 'sul' THEN
    UPDATE public."TI_PLANTA" SET altura_cm = altura_cm + v_cm WHERE id = p_planta;

  ELSIF p_lado = 'oeste' THEN
    UPDATE public."TI_PLANTA" SET largura_cm = largura_cm + v_cm WHERE id = p_planta;
    UPDATE public."TI_PLANTA_ELEMENTO" SET x = x + v_cm WHERE planta_id = p_planta;
    UPDATE public."TI_ATIVO" SET pos_x = pos_x + v_cm WHERE planta_id = p_planta AND pos_x IS NOT NULL;

    UPDATE public."TI_PLANTA_CELULA" SET cx = cx + v_parada WHERE planta_id = p_planta;
    UPDATE public."TI_PLANTA_CELULA" SET cx = cx - v_parada + p_metros WHERE planta_id = p_planta;

  ELSE -- norte
    UPDATE public."TI_PLANTA" SET altura_cm = altura_cm + v_cm WHERE id = p_planta;
    UPDATE public."TI_PLANTA_ELEMENTO" SET y = y + v_cm WHERE planta_id = p_planta;
    UPDATE public."TI_ATIVO" SET pos_y = pos_y + v_cm WHERE planta_id = p_planta AND pos_y IS NOT NULL;

    UPDATE public."TI_PLANTA_CELULA" SET cy = cy + v_parada WHERE planta_id = p_planta;
    UPDATE public."TI_PLANTA_CELULA" SET cy = cy - v_parada + p_metros WHERE planta_id = p_planta;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reexecutar a versão de 20260930000068 — e com ela o bug de chave
--   duplicada volta.
-- =====================================================================
