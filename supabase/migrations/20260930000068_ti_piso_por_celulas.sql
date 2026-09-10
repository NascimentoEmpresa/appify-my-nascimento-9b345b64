-- =====================================================================
-- T.I — o piso deixa de ser um retângulo e passa a ser um conjunto de
-- quadrados de 1 m².
--
-- POR QUÊ
--   Escritório de verdade não é retângulo. Com `largura_cm × altura_cm` só dá
--   para desenhar caixas; para um andar em L, em T ou com um recorte na
--   escada, o retângulo mente. Cada quadrado clicado passa a ser uma célula
--   ocupada, e o piso é a união delas.
--
-- COMO CONVIVE COM O QUE JÁ EXISTE
--   Planta SEM nenhuma célula continua sendo desenhada como o retângulo
--   inteiro (é o que todas as plantas de hoje são). Na primeira vez que
--   alguém clica num "+", a RPC MATERIALIZA o retângulo em células e só então
--   acrescenta a nova — ninguém precisa migrar nada, e o mapa não muda de
--   forma sozinho.
--
--   `largura_cm`/`altura_cm` continuam existindo como a MOLDURA: o tamanho da
--   grade de trabalho e o enquadramento da câmera. A RPC cresce a moldura
--   sozinha quando a célula pedida cai fora dela.
--
-- COORDENADA NEGATIVA
--   Clicar no "+" à esquerda da origem daria cx = -1. Em vez de aceitar
--   coordenada negativa (que espalharia sinal por todo o código da cena), a
--   RPC empurra o mundo: cresce a moldura para o oeste e soma 1 m em tudo —
--   peças, equipamentos e células. O usuário vê o piso crescer para a
--   esquerda; o banco continua com a origem no canto.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- 1) As células ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."TI_PLANTA_CELULA" (
  planta_id uuid NOT NULL REFERENCES public."TI_PLANTA"(id) ON DELETE CASCADE,
  -- Índice do quadrado, não centímetros: cx=3, cy=2 é o quarto quadrado da
  -- esquerda, terceiro de cima. Inteiro pequeno, e a comparação é exata —
  -- com centímetros, arredondamento faria duas células "quase iguais".
  cx integer NOT NULL,
  cy integer NOT NULL,
  PRIMARY KEY (planta_id, cx, cy)
);

ALTER TABLE public."TI_PLANTA_CELULA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ti_celula_select ON public."TI_PLANTA_CELULA";
CREATE POLICY ti_celula_select ON public."TI_PLANTA_CELULA" FOR SELECT TO authenticated USING (public.ti_pode_ver());
DROP POLICY IF EXISTS ti_celula_insert ON public."TI_PLANTA_CELULA";
CREATE POLICY ti_celula_insert ON public."TI_PLANTA_CELULA" FOR INSERT TO authenticated WITH CHECK (public.ti_pode_construir('incluir'));
DROP POLICY IF EXISTS ti_celula_delete ON public."TI_PLANTA_CELULA";
CREATE POLICY ti_celula_delete ON public."TI_PLANTA_CELULA" FOR DELETE TO authenticated USING (public.ti_pode_construir('excluir'));

-- 2) Expandir a moldura passa a mover as células também -------------------
-- (a versão da 20260930000067 movia peças e equipamentos, mas as células
-- ainda não existiam; sem isto, crescer para oeste deslocaria o desenho e
-- deixaria o piso para trás)
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
    UPDATE public."TI_PLANTA_CELULA" SET cx = cx + p_metros WHERE planta_id = p_planta;

  ELSE -- norte
    UPDATE public."TI_PLANTA" SET altura_cm = altura_cm + v_cm WHERE id = p_planta;
    UPDATE public."TI_PLANTA_ELEMENTO" SET y = y + v_cm WHERE planta_id = p_planta;
    UPDATE public."TI_ATIVO" SET pos_y = pos_y + v_cm WHERE planta_id = p_planta AND pos_y IS NOT NULL;
    UPDATE public."TI_PLANTA_CELULA" SET cy = cy + p_metros WHERE planta_id = p_planta;
  END IF;
END $$;

-- 3) Materializar o retângulo em células ---------------------------------
/**
 * Transforma a moldura retangular no conjunto de células equivalente.
 *
 * Só age quando a planta ainda não tem célula nenhuma — é o que permite o
 * modelo novo conviver com as plantas antigas sem migração e sem a forma do
 * mapa mudar sozinha.
 */
CREATE OR REPLACE FUNCTION public.ti_materializar_celulas(p_planta uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_l integer;
  v_a integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public."TI_PLANTA_CELULA" WHERE planta_id = p_planta) THEN
    RETURN;
  END IF;

  SELECT ceil(largura_cm / 100.0)::int, ceil(altura_cm / 100.0)::int
    INTO v_l, v_a
    FROM public."TI_PLANTA" WHERE id = p_planta;
  IF v_l IS NULL THEN
    RAISE EXCEPTION 'Planta não encontrada.';
  END IF;

  INSERT INTO public."TI_PLANTA_CELULA" (planta_id, cx, cy)
  SELECT p_planta, gx, gy
    FROM generate_series(0, v_l - 1) AS gx,
         generate_series(0, v_a - 1) AS gy
  ON CONFLICT DO NOTHING;
END $$;

-- 4) Ocupar / liberar um quadrado ----------------------------------------
/**
 * O clique no "+" (ocupar) e no "−" (liberar) do editor.
 *
 * Cuida sozinho de três coisas que a tela não deveria ter que saber:
 *   • materializa o retângulo na primeira vez;
 *   • empurra o mundo quando a célula pedida tem coordenada negativa;
 *   • cresce a moldura quando a célula cai fora dela.
 *
 * Devolve a posição REAL usada, porque depois de um empurrão para o oeste o
 * cx pedido não é mais o cx gravado — e a tela precisa saber disso para
 * selecionar/realçar o quadrado certo.
 */
CREATE OR REPLACE FUNCTION public.ti_celula_definir(
  p_planta uuid,
  p_cx     integer,
  p_cy     integer,
  p_ocupar boolean DEFAULT true
)
RETURNS TABLE (cx integer, cy integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_cx integer := p_cx;
  v_cy integer := p_cy;
  v_l  integer;
  v_a  integer;
BEGIN
  IF NOT public.ti_pode_construir('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar a planta.';
  END IF;

  PERFORM public.ti_materializar_celulas(p_planta);

  IF p_ocupar THEN
    -- Coordenada negativa vira crescimento do outro lado (ver cabeçalho).
    IF v_cx < 0 THEN
      PERFORM public.ti_expandir_planta(p_planta, 'oeste', -v_cx);
      v_cy := v_cy;  -- cy não muda ao empurrar no eixo X
      v_cx := 0;
    END IF;
    IF v_cy < 0 THEN
      PERFORM public.ti_expandir_planta(p_planta, 'norte', -v_cy);
      v_cy := 0;
    END IF;

    SELECT ceil(largura_cm / 100.0)::int, ceil(altura_cm / 100.0)::int
      INTO v_l, v_a FROM public."TI_PLANTA" WHERE id = p_planta;

    IF v_cx > v_l - 1 THEN
      PERFORM public.ti_expandir_planta(p_planta, 'leste', v_cx - (v_l - 1));
    END IF;
    IF v_cy > v_a - 1 THEN
      PERFORM public.ti_expandir_planta(p_planta, 'sul', v_cy - (v_a - 1));
    END IF;

    INSERT INTO public."TI_PLANTA_CELULA" (planta_id, cx, cy)
    VALUES (p_planta, v_cx, v_cy)
    ON CONFLICT DO NOTHING;
  ELSE
    -- Liberar. A última célula não sai: piso vazio deixaria a tela sem nada
    -- em que clicar para voltar atrás.
    IF (SELECT count(*) FROM public."TI_PLANTA_CELULA" WHERE planta_id = p_planta) > 1 THEN
      DELETE FROM public."TI_PLANTA_CELULA" c
       WHERE c.planta_id = p_planta AND c.cx = v_cx AND c.cy = v_cy;
    END IF;
  END IF;

  RETURN QUERY SELECT v_cx, v_cy;
END $$;

REVOKE ALL ON FUNCTION public.ti_materializar_celulas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ti_materializar_celulas(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ti_celula_definir(uuid, integer, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ti_celula_definir(uuid, integer, integer, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────
SELECT p.nome, p.largura_cm, p.altura_cm,
       (SELECT count(*) FROM public."TI_PLANTA_CELULA" c WHERE c.planta_id = p.id) AS celulas
  FROM public."TI_PLANTA" p ORDER BY p.nivel;

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.ti_celula_definir(uuid, integer, integer, boolean);
--   DROP FUNCTION IF EXISTS public.ti_materializar_celulas(uuid);
--   DROP TABLE IF EXISTS public."TI_PLANTA_CELULA";
--   -- e reexecutar a ti_expandir_planta da 20260930000067
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
