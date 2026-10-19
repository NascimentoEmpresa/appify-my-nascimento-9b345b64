-- =====================================================================
-- ESTOQUE — o mapa 3D vira um tabuleiro de quadrados (SIS-2026-0442)
--
-- POR QUE
--   Montar a planta digitando coordenada não funciona: foram três rodadas e
--   o desenho continuou sem bater com o galpão. O pedido agora é direto —
--   dividir o estoque em quadrados e deixar criar, arrastar e apagar
--   prateleira no próprio 3D, como num jogo.
--
--   Para isso o piso passa a ser uma grade de **60 cm**, e cada coluna de
--   caixotes ocupa exatamente UM quadrado. É o que permite arrastar sem
--   sobrepor e sem deixar fresta.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Põe toda coluna existente em cima de um quadrado e a redimensiona
--      para caber nele (60 x 60).
--   2. Reorganiza os corredores em coordenada de QUADRADO, não de metro —
--      é assim que a tela raciocina agora.
--
--   As colunas hoje estão espaçadas de 42 cm. Só "arredondar" a posição
--   faria duas colunas vizinhas caírem no MESMO quadrado e uma engolir a
--   outra, então cada corredor é reassentado quadrado a quadrado.
--
-- ⚠️ NÃO MEXE EM FICHA NENHUMA. O endereço do item casa com o `indice` da
--   coluna, não com a posição dela no piso — arrastar uma prateleira no 3D
--   nunca muda onde o sistema diz que o item está.
--
-- A PLANTA AQUI É PONTO DE PARTIDA, NÃO VERDADE. Ela segue o croqui, mas a
-- partir de agora quem manda é quem arrasta na tela.
-- =====================================================================

DO $grade$
DECLARE
  -- Lado do quadrado. Tem de ser igual a TAMANHO_CELULA em
  -- src/lib/suprimentos/gradeEstoque.ts — os dois lados fazem a mesma conta.
  T        numeric := 0.60;
  v_layout uuid;
  r        record;
BEGIN
  SELECT id INTO v_layout FROM public.sup_estoque_layout ORDER BY criado_em LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE NOTICE 'Sem planta — nada a fazer.';
    RETURN;
  END IF;

  -- Salão de 11 x 11 dá 18 x 18 quadrados. A bancada fica na última fileira.
  UPDATE public.sup_estoque_layout
     SET largura_m = 11.00, profundidade_m = 11.00, pe_direito_m = 3.05,
         mesa_x = 3.00, mesa_z = 10.20, mesa_largura_m = 7.20, mesa_rotacao = 0
   WHERE id = v_layout;

  -- Toda coluna passa a ter o tamanho do quadrado. Sem isto os blocos não
  -- encostam: sobra fresta na largura e sobra corpo na profundidade.
  UPDATE public.sup_estoque_coluna k
     SET largura_m = T, profundidade_m = T
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout;

  -- ---------------------------------------------------------------
  -- Cada corredor reassentado em quadrados.
  --
  -- (cx0, cz0) é o quadrado da coluna de índice 1, e (dcx, dcz) o passo até
  -- a seguinte. A conversão de quadrado para o canto que vai em pos_x/pos_z
  -- depende da rotação — é a mesma regra de `cantoDaCelula` no frontend:
  --
  --     rot   0 -> canto = (cx,   cz)      · corpo cresce para +X e +Z
  --     rot  90 -> canto = (cx,   cz+1)
  --     rot 180 -> canto = (cx+1, cz+1)
  --     rot 270 -> canto = (cx+1, cz)
  --
  -- Corredores de 2 quadrados (1,20 m) entre as fileiras do miolo, que é o
  -- que as fotos mostram; junto à parede esquerda sobra 1 quadrado, porque
  -- o salão não dá para mais.
  -- ---------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      -- letra, cx0, cz0, dcx, dcz, rot, nome
      ('D',  1,  0,  1,  0,   0, 'Fundo do salão'),
      ('E', 13,  3, -1,  0, 180, 'Bloco do meio — face do fundo'),
      ('C',  2,  4,  1,  0,   0, 'Bloco do meio — face da frente'),
      ('F', 13,  7, -1,  0, 180, 'Bloco central 1 — face do fundo'),
      ('G',  2,  8,  1,  0,   0, 'Bloco central 1 — face da frente'),
      ('H', 13, 11, -1,  0, 180, 'Bloco central 2 — face do fundo'),
      ('J',  2, 12,  1,  0,   0, 'Bloco central 2 — face da frente'),
      ('A', 17,  1,  0,  1, 270, 'Parede direita'),
      ('B',  0, 14,  0, -1,  90, 'Parede esquerda')
    ) AS t(codigo, cx0, cz0, dcx, dcz, rot, nome)
  LOOP
    UPDATE public.sup_estoque_corredor
       SET nome = r.nome
     WHERE layout_id = v_layout AND codigo = r.codigo;

    UPDATE public.sup_estoque_coluna k
       SET rotacao_graus = r.rot,
           pos_x = ((r.cx0 + (k.indice - 1) * r.dcx)
                    + CASE WHEN r.rot IN (180, 270) THEN 1 ELSE 0 END) * T,
           pos_z = ((r.cz0 + (k.indice - 1) * r.dcz)
                    + CASE WHEN r.rot IN (90, 180) THEN 1 ELSE 0 END) * T
      FROM public.sup_estoque_corredor c
     WHERE c.id = k.corredor_id
       AND c.layout_id = v_layout
       AND c.codigo = r.codigo;
  END LOOP;

  -- Z tem 24 colunas e 5 fichas, e não aparece no croqui. Fica empilhado em
  -- fileiras de 8 no canto da frente à esquerda, fora da linha de visão de
  -- quem senta na bancada. Agora é só arrastar para o lugar certo.
  UPDATE public.sup_estoque_corredor
     SET nome = 'Corredor Z — arraste para o lugar certo'
   WHERE layout_id = v_layout AND codigo = 'Z';

  UPDATE public.sup_estoque_coluna k
     SET rotacao_graus = 0,
         pos_x = (1 + ((k.indice - 1) % 8)) * T,
         pos_z = (14 + ((k.indice - 1) / 8)) * T
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout AND c.codigo = 'Z';

  -- Marcos: a coluna de concreto passa a ocupar um quadrado inteiro, no
  -- corredor entre os dois blocos centrais.
  UPDATE public.sup_estoque_marco
     SET pos_x = 8 * T, pos_z = 9 * T, largura_m = T, profundidade_m = T, altura_m = 3.05
   WHERE layout_id = v_layout AND tipo = 'pilar';

  UPDATE public.sup_estoque_marco
     SET pos_x = 0.02, pos_z = 8.40, largura_m = 0.10, profundidade_m = 1.60, altura_m = 2.30
   WHERE layout_id = v_layout AND tipo = 'porta_rua';

  UPDATE public.sup_estoque_marco
     SET pos_x = 0.60, pos_z = 10.94, largura_m = 1.40, profundidade_m = 0.10, altura_m = 2.30
   WHERE layout_id = v_layout AND tipo = 'porta_interna';

  -- Trava de altura: nenhuma coluna pode furar o forro (o corredor Z tem
  -- endereço até a linha 10). A linha encolhe em vez de ser cortada —
  -- cortar faria o endereço apontar para linha inexistente.
  UPDATE public.sup_estoque_coluna k
     SET altura_linha_m = GREATEST(
           0.18,
           ROUND(((l.pe_direito_m - 0.12 - k.altura_base_m) / k.linhas)::numeric, 3))
    FROM public.sup_estoque_corredor c
    JOIN public.sup_estoque_layout l ON l.id = c.layout_id
   WHERE c.id = k.corredor_id
     AND c.layout_id = v_layout
     AND k.altura_base_m + k.linhas * k.altura_linha_m > l.pe_direito_m - 0.12;

  RAISE NOTICE 'Grade aplicada: % colunas em quadrados de % m.',
    (SELECT count(*) FROM public.sup_estoque_coluna k
       JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
      WHERE c.layout_id = v_layout),
    T;
END;
$grade$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (rodar depois de aplicar)
-- ---------------------------------------------------------------------
-- -- 1. Toda coluna em cima de um quadrado (posição múltipla de 0,60)?
-- SELECT coalesce(string_agg(DISTINCT c.codigo, ','), 'todas na grade')
--   FROM public.sup_estoque_coluna k
--   JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
--  WHERE (k.pos_x * 100)::int % 60 <> 0 OR (k.pos_z * 100)::int % 60 <> 0;
--
-- -- 2. Duas colunas no MESMO quadrado? (tem de vir vazio)
-- WITH cel AS (
--   SELECT k.id, c.codigo,
--          round(k.pos_x / 0.6)::int - CASE WHEN k.rotacao_graus IN (180,270) THEN 1 ELSE 0 END AS cx,
--          round(k.pos_z / 0.6)::int - CASE WHEN k.rotacao_graus IN (90,180)  THEN 1 ELSE 0 END AS cz
--     FROM public.sup_estoque_coluna k
--     JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id)
-- SELECT cx, cz, count(*), string_agg(codigo, ',') FROM cel
--  GROUP BY cx, cz HAVING count(*) > 1;
--
-- -- 3. Tudo dentro das paredes (18 x 18 quadrados)
-- SELECT coalesce(string_agg(DISTINCT c.codigo, ','), 'nenhuma fora')
--   FROM public.sup_estoque_coluna k
--   JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
--   JOIN public.sup_estoque_layout l ON l.id = c.layout_id
--  WHERE k.pos_x < 0 OR k.pos_x > l.largura_m OR k.pos_z < 0 OR k.pos_z > l.profundidade_m;

-- ROLLBACK
-- Só reposiciona e redimensiona — não cria nem remove estrutura, e não toca
-- em ficha. Voltar atrás é reaplicar o bloco de posições da
-- 20260930000213_sup_estoque_mapa_planta_do_croqui.sql.
