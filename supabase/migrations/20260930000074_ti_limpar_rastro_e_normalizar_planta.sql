-- =========================================================================
-- T.I › Construir o mapa — a planta esticou para 197 m e o piso parou de
-- crescer.
--
-- SINTOMA: arrastar piso falhava com
--   new row for relation "TI_PLANTA" violates check constraint
--   "TI_PLANTA_altura_cm_check"      (CHECK altura_cm BETWEEN 100 AND 20000)
-- e, como a tela pinta o piso antes de o banco responder, o chão aparecia e
-- sumia — sem mensagem, porque o erro vinha do rollback da pintura.
--
-- CAUSA: um rastro de células fantasma. Até a correção dos botões do mouse
-- (08/09/2026), arrastar com o botão DIREITO movia a câmera E abria piso na
-- mesma passada, criando uma célula por passo do arrasto. Sobrou uma diagonal
-- perfeita — (4,159), (5,154), (6,149) … (35,4) — de 33 quadrados soltos,
-- longe do escritório. A planta cresce para caber a célula mais distante,
-- então esses 33 quadrados sozinhos empurraram `altura_cm` de 2800 para
-- 19700, encostando no teto do CHECK.
--
-- CONSERTO, em duas partes:
--   1. apagar o rastro (cy < 160 — o piso real começa em 164);
--   2. reencostar o mundo na origem: as células que sobram descem para cy 0,
--      e peças e equipamentos andam o MESMO tanto em cm, senão a mobília
--      ficaria boiando 164 m ao norte do piso.
--
-- Não há nada de valor na área apagada: as 41 peças e todos os equipamentos
-- posicionados estão em y >= 16400, ou seja, dentro do piso real.
--
-- Uma transação só: metade disto aplicado é pior do que nada — o piso desce e
-- a mobília fica para trás.
-- =========================================================================

BEGIN;

DO $$
DECLARE
  v_planta uuid;
  v_apagadas int;
  v_min_cy int;
  v_max_cy int;
  v_desloca int;
BEGIN
  SELECT id INTO v_planta FROM public."TI_PLANTA" ORDER BY nivel LIMIT 1;

  -- 1) o rastro
  DELETE FROM public."TI_PLANTA_CELULA" WHERE planta_id = v_planta AND cy < 160;
  GET DIAGNOSTICS v_apagadas = ROW_COUNT;
  RAISE NOTICE 'celulas do rastro apagadas: %', v_apagadas;

  SELECT min(cy), max(cy) INTO v_min_cy, v_max_cy
    FROM public."TI_PLANTA_CELULA" WHERE planta_id = v_planta;

  IF v_min_cy IS NULL THEN
    RAISE EXCEPTION 'a planta ficaria sem piso nenhum — abortando';
  END IF;

  -- 2) encostar na origem. O deslocamento sai do dado, não de um número
  -- escrito à mão: se o rastro for outro amanhã, a conta continua certa.
  v_desloca := v_min_cy;

  UPDATE public."TI_PLANTA_CELULA"
     SET cy = cy - v_desloca
   WHERE planta_id = v_planta;

  UPDATE public."TI_PLANTA_ELEMENTO"
     SET y = y - (v_desloca * 100)
   WHERE planta_id = v_planta;

  UPDATE public."TI_ATIVO"
     SET pos_y = pos_y - (v_desloca * 100)
   WHERE planta_id = v_planta AND pos_y IS NOT NULL;

  UPDATE public."TI_PLANTA"
     SET altura_cm = (v_max_cy - v_min_cy + 1) * 100
   WHERE id = v_planta;

  RAISE NOTICE 'planta normalizada: deslocou % m, altura agora % cm',
    v_desloca, (v_max_cy - v_min_cy + 1) * 100;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT p.largura_cm, p.altura_cm,
       (SELECT count(*) FROM public."TI_PLANTA_CELULA" c WHERE c.planta_id = p.id) AS celulas,
       (SELECT min(cy) FROM public."TI_PLANTA_CELULA" c WHERE c.planta_id = p.id) AS min_cy,
       (SELECT max(cy) FROM public."TI_PLANTA_CELULA" c WHERE c.planta_id = p.id) AS max_cy,
       (SELECT min(y)  FROM public."TI_PLANTA_ELEMENTO" e WHERE e.planta_id = p.id) AS min_y_peca
  FROM public."TI_PLANTA" p;

-- =========================================================================
-- ROLLBACK
--   Não tem: as células apagadas eram lixo e não foram guardadas. O
--   deslocamento, esse sim, se desfaz somando de volta o que o NOTICE
--   informou (v_desloca) em cy, y e pos_y, e devolvendo altura_cm a 19700.
-- =========================================================================
