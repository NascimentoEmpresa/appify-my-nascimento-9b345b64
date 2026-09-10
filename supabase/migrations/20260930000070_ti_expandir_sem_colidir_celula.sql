-- =====================================================================
-- T.I — corrige "duplicate key ... TI_PLANTA_CELULA_pkey" ao aumentar o piso
-- pela esquerda ou por cima.
--
-- O QUE ACONTECIA (04/09/2026, clicando num "+" do lado oeste)
--   `ti_expandir_planta` deslocava as células com
--       UPDATE "TI_PLANTA_CELULA" SET cx = cx + 1 WHERE planta_id = ...
--   e a PK é (planta_id, cx, cy). Postgres valida chave única LINHA A LINHA,
--   não no fim do comando: a célula (0,0) vira (1,0) enquanto a (1,0) original
--   ainda está lá, e o UPDATE aborta com chave duplicada. O resultado final
--   seria válido — o caminho até ele é que não é.
--
--   O sintoma some quando o piso é uma coluna só (nada para colidir), o que
--   explica ter passado no ensaio: a planta de teste tinha uma peça e nenhuma
--   célula materializada.
--
-- A CORREÇÃO
--   Apagar e reinserir na MESMA instrução, com um CTE `DELETE ... RETURNING`.
--   As linhas antigas saem antes de as novas entrarem, então não existe
--   instante em que duas células disputem a mesma chave.
--
--   A alternativa seria tornar a PK DEFERRABLE e adiar a checagem para o fim
--   da transação. Foi descartada: mudar a natureza da chave primária de uma
--   tabela para acomodar um UPDATE é caro demais para o problema, e afrouxa a
--   garantia para todo mundo, não só para este caminho.
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
  v_cm integer := p_metros * 100;
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

    -- Sai e volta na mesma instrução: ver o cabeçalho.
    WITH movidas AS (
      DELETE FROM public."TI_PLANTA_CELULA"
       WHERE planta_id = p_planta
      RETURNING planta_id, cx, cy
    )
    INSERT INTO public."TI_PLANTA_CELULA" (planta_id, cx, cy)
    SELECT planta_id, cx + p_metros, cy FROM movidas;

  ELSE -- norte
    UPDATE public."TI_PLANTA" SET altura_cm = altura_cm + v_cm WHERE id = p_planta;
    UPDATE public."TI_PLANTA_ELEMENTO" SET y = y + v_cm WHERE planta_id = p_planta;
    UPDATE public."TI_ATIVO" SET pos_y = pos_y + v_cm WHERE planta_id = p_planta AND pos_y IS NOT NULL;

    WITH movidas AS (
      DELETE FROM public."TI_PLANTA_CELULA"
       WHERE planta_id = p_planta
      RETURNING planta_id, cx, cy
    )
    INSERT INTO public."TI_PLANTA_CELULA" (planta_id, cx, cy)
    SELECT planta_id, cx, cy + p_metros FROM movidas;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reexecutar a versão de 20260930000068 (a que usa UPDATE nas células) —
--   e com ela o bug de chave duplicada volta.
-- =====================================================================
