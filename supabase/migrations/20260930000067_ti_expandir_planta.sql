-- =====================================================================
-- T.I — aumentar o escritório clicando no "+" do quadrado.
--
-- O QUE ESTA RPC RESOLVE, E POR QUE NÃO DÁ PARA FAZER NO FRONT
--   Crescer para LESTE ou para o SUL é só aumentar a largura/profundidade da
--   planta: a origem (canto superior esquerdo) não se move e nada do que já
--   está desenhado muda de lugar.
--
--   Crescer para o NORTE ou para o OESTE é outra história: a origem passa a
--   ser um metro antes, então TODAS as paredes, mesas e equipamentos precisam
--   andar +100 cm no eixo, senão o desenho inteiro escorrega em relação ao
--   piso — a sala que estava encostada na parede de cima passa a flutuar.
--
--   São três tabelas mexendo juntas. Feito no front, seriam três requisições
--   sem transação: se a segunda falhasse, o escritório ficaria com a planta
--   maior e as peças no lugar velho, e ninguém saberia dizer o que aconteceu.
--   Aqui é uma chamada só, tudo ou nada.
--
-- SEGURANÇA
--   SECURITY DEFINER (precisa alterar linhas de três tabelas), mas cobra
--   `ti_pode_construir('alterar')` na primeira linha — a mesma permissão que
--   a policy de UPDATE exige. Sem isso, a função seria um buraco que deixa
--   qualquer autenticado remodelar o escritório.
--
-- Idempotente (é uma função). ROLLBACK no fim.
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
  -- 1 a 20 m por clique. O teto existe para um clique acidental com o
  -- parâmetro errado não transformar a sala num aeroporto.
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

  ELSE -- norte
    UPDATE public."TI_PLANTA" SET altura_cm = altura_cm + v_cm WHERE id = p_planta;
    UPDATE public."TI_PLANTA_ELEMENTO" SET y = y + v_cm WHERE planta_id = p_planta;
    UPDATE public."TI_ATIVO" SET pos_y = pos_y + v_cm WHERE planta_id = p_planta AND pos_y IS NOT NULL;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.ti_expandir_planta(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ti_expandir_planta(uuid, text, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT nome, largura_cm, altura_cm FROM public."TI_PLANTA" ORDER BY nivel;

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.ti_expandir_planta(uuid, text, integer);
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
