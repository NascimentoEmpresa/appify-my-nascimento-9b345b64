-- =====================================================================
-- ESTOQUE — prateleiras na posição do croqui (SIS-2026-0442, 3ª rodada)
--
-- O QUE ESTAVA ERRADO
--   As duas rodadas anteriores trataram o CORREDOR como se fosse a
--   prateleira: cada letra virou uma fileira de caixotes. O autor do chamado
--   mandou o croqui com as posições desenhadas por cima do 3D e a leitura
--   certa ficou óbvia —
--
--       corredor = o VÃO por onde se anda (vazio)
--       ESTOQUE  = o bloco de prateleira ao lado dele
--
--   O croqui tem 6 blocos de ESTOQUE e 4 corredores nomeados (A à direita,
--   B à esquerda, C e D horizontais), mais a coluna de concreto no meio do
--   bloco central e a mesa dos computadores atravessando a frente.
--
-- COMO AS LETRAS FORAM DISTRIBUÍDAS
--   Cada bloco encosta em um corredor, e é dele que a pessoa alcança o
--   caixote — então o bloco leva a letra do corredor que o serve. Como todo
--   corredor tem prateleira dos DOIS lados e o endereço não diz de que lado
--   está, os dois lados ficam com letras diferentes:
--
--     fundo do salão ──── D ───┐
--                              │ corredor D (1,04 m)
--     bloco meio-alto ──── E ──┘
--     bloco meio-alto ──── C ──┐
--                              │ corredor C (1,04 m)
--     bloco central 1 ──── F ──┘
--     bloco central 1 ──── G ──┐
--                              │ corredor central (1,04 m)
--     bloco central 2 ──── H ──┘
--     bloco central 2 ──── J
--     parede esquerda ──── B      (corredor B na frente dela)
--     parede direita  ──── A      (corredor A na frente dela)
--
--   Z (24 colunas, 5 fichas) não tem lugar no croqui e continua dobrado no
--   canto, com o nome avisando que a posição é para conferir.
--
--   Isto é a melhor leitura possível do croqui, não uma certeza: se alguma
--   letra estiver no bloco errado, arrastar na tela resolve, e o endereço
--   das fichas não muda com isso (o índice da coluna é que casa com o
--   endereço, não a posição no piso).
--
-- POR QUE UMA MIGRATION NOVA
--   A 20260930000200 já foi aplicada no Supabase — mexer nela desalinharia
--   o que está rodando (R4: migration aplicada é append-only).
--
-- NÃO MEXE EM NENHUMA FICHA. Só posição, rotação e as medidas do salão.
-- =====================================================================

DO $planta$
DECLARE
  v_layout uuid;
  r        record;
BEGIN
  SELECT id INTO v_layout FROM public.sup_estoque_layout ORDER BY criado_em LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE NOTICE 'Sem planta — nada a reposicionar.';
    RETURN;
  END IF;

  -- O croqui é praticamente quadrado; a versão anterior usava 11 x 12.
  -- A bancada atravessa a frente do salão, como está desenhado.
  UPDATE public.sup_estoque_layout
     SET largura_m = 11.00, profundidade_m = 11.00, pe_direito_m = 3.05,
         mesa_x = 2.40, mesa_z = 9.70, mesa_largura_m = 7.20, mesa_rotacao = 0
   WHERE id = v_layout;

  -- Medidas iguais para todo mundo; quem for diferente, o pessoal ajusta.
  UPDATE public.sup_estoque_coluna k
     SET largura_m = 0.420, profundidade_m = 0.580, altura_linha_m = 0.420
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout;

  -- ---------------------------------------------------------------
  -- Os blocos, na posição do croqui.
  --
  -- `eixo` diz por onde a fileira corre: 'x' para os blocos horizontais
  -- (fundo e centro) e 'z' para as faixas das paredes. `base` é onde a
  -- primeira coluna começa e `passo` o sentido em que as outras seguem.
  -- ---------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      --  letra, eixo, base,  passo,  fixo,   rot,  nome
      ('D', 'x',  1.70,  0.42,  0.10,    0, 'Fundo do salão — corredor D na frente'),
      ('E', 'x',  8.00, -0.42,  2.30,  180, 'Bloco do meio — face do corredor D'),
      ('C', 'x',  2.60,  0.42,  2.30,    0, 'Bloco do meio — face do corredor C'),
      ('F', 'x',  7.80, -0.42,  4.50,  180, 'Bloco central 1 — face do corredor C'),
      ('G', 'x',  2.90,  0.42,  4.50,    0, 'Bloco central 1 — face do corredor do meio'),
      ('H', 'x',  7.80, -0.42,  6.70,  180, 'Bloco central 2 — face do corredor do meio'),
      ('J', 'x',  2.90,  0.42,  6.70,    0, 'Bloco central 2 — face da frente'),
      ('B', 'z',  7.20, -0.42,  0.08,   90, 'Parede esquerda — corredor B na frente'),
      ('A', 'z',  0.90,  0.42, 10.92,  270, 'Parede direita — corredor A na frente')
    ) AS t(codigo, eixo, base, passo, fixo, rot, nome)
  LOOP
    UPDATE public.sup_estoque_corredor
       SET nome = r.nome
     WHERE layout_id = v_layout AND codigo = r.codigo;

    UPDATE public.sup_estoque_coluna k
       SET rotacao_graus = r.rot,
           pos_x = CASE WHEN r.eixo = 'x'
                        THEN ROUND((r.base + (k.indice - 1) * r.passo)::numeric, 2)
                        ELSE r.fixo END,
           pos_z = CASE WHEN r.eixo = 'x'
                        THEN r.fixo
                        ELSE ROUND((r.base + (k.indice - 1) * r.passo)::numeric, 2) END
      FROM public.sup_estoque_corredor c
     WHERE c.id = k.corredor_id
       AND c.layout_id = v_layout
       AND c.codigo = r.codigo;
  END LOOP;

  -- Z continua dobrado no canto da frente à esquerda: 24 colunas numa
  -- fileira só atravessariam o salão e tapariam a vista da bancada.
  UPDATE public.sup_estoque_corredor
     SET nome = 'Corredor Z — posição a conferir'
   WHERE layout_id = v_layout AND codigo = 'Z';

  UPDATE public.sup_estoque_coluna k
     SET pos_x = ROUND((0.60 + ((k.indice - 1) % 8) * 0.42)::numeric, 2),
         pos_z = ROUND((7.50 + ((k.indice - 1) / 8) * 0.70)::numeric, 2),
         rotacao_graus = 0
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout AND c.codigo = 'Z';

  -- ---------------------------------------------------------------
  -- Marcos, conforme o croqui.
  --
  -- A coluna de concreto fica no corredor do meio, entre os dois blocos
  -- centrais — é onde ela aparece no desenho e é assim que ela aparece nos
  -- vídeos, encostada no caminho e revestida de branco.
  -- ---------------------------------------------------------------
  UPDATE public.sup_estoque_marco
     SET pos_x = 5.20, pos_z = 5.30, largura_m = 0.45, profundidade_m = 0.45, altura_m = 3.05
   WHERE layout_id = v_layout AND tipo = 'pilar';

  UPDATE public.sup_estoque_marco
     SET pos_x = 0.02, pos_z = 8.20, largura_m = 0.10, profundidade_m = 1.60, altura_m = 2.30
   WHERE layout_id = v_layout AND tipo = 'porta_rua';

  UPDATE public.sup_estoque_marco
     SET pos_x = 0.80, pos_z = 10.94, largura_m = 1.40, profundidade_m = 0.10, altura_m = 2.30
   WHERE layout_id = v_layout AND tipo = 'porta_interna';

  -- ---------------------------------------------------------------
  -- Trava de altura, de novo (a 200 já tinha): nenhuma coluna pode furar o
  -- forro. O pé-direito mudou de 3,05 para 3,05 aqui, mas a largura da
  -- sala mudou, e é barato reconferir.
  -- ---------------------------------------------------------------
  UPDATE public.sup_estoque_coluna k
     SET altura_linha_m = GREATEST(
           0.18,
           ROUND(((l.pe_direito_m - 0.12 - k.altura_base_m) / k.linhas)::numeric, 3))
    FROM public.sup_estoque_corredor c
    JOIN public.sup_estoque_layout l ON l.id = c.layout_id
   WHERE c.id = k.corredor_id
     AND c.layout_id = v_layout
     AND k.altura_base_m + k.linhas * k.altura_linha_m > l.pe_direito_m - 0.12;

  RAISE NOTICE 'Planta do croqui aplicada: % colunas em % corredores.',
    (SELECT count(*) FROM public.sup_estoque_coluna k
       JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
      WHERE c.layout_id = v_layout),
    (SELECT count(*) FROM public.sup_estoque_corredor WHERE layout_id = v_layout);
END;
$planta$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (rodar depois de aplicar)
-- ---------------------------------------------------------------------
-- -- 1. Cada corredor no seu bloco, e tudo dentro das paredes (11 x 11)
-- SELECT c.codigo, count(*) AS colunas,
--        round(min(k.pos_x),2)||'..'||round(max(k.pos_x),2) AS x,
--        round(min(k.pos_z),2)||'..'||round(max(k.pos_z),2) AS z,
--        max(k.rotacao_graus) AS rot, c.nome
--   FROM public.sup_estoque_coluna k
--   JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
--  GROUP BY c.codigo, c.nome ORDER BY c.codigo;
--
-- -- 2. Nada pode ficar fora do salão
-- SELECT coalesce(string_agg(DISTINCT c.codigo, ','), 'nenhuma fora')
--   FROM public.sup_estoque_coluna k
--   JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
--   JOIN public.sup_estoque_layout l ON l.id = c.layout_id
--  WHERE k.pos_x < 0 OR k.pos_x > l.largura_m
--     OR k.pos_z < 0 OR k.pos_z > l.profundidade_m;
--
-- -- 3. Nada pode furar o forro
-- SELECT coalesce(string_agg(DISTINCT c.codigo, ','), 'nenhuma fura o teto')
--   FROM public.sup_estoque_coluna k
--   JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id
--   JOIN public.sup_estoque_layout l ON l.id = c.layout_id
--  WHERE k.altura_base_m + k.linhas * k.altura_linha_m > l.pe_direito_m;

-- ROLLBACK
-- Esta migration só reposiciona. Voltar atrás é reaplicar o bloco de
-- reposicionamento da 20260930000200 (seção 7 daquele arquivo) — nenhuma
-- estrutura foi criada nem removida aqui, e nenhuma ficha foi tocada.
