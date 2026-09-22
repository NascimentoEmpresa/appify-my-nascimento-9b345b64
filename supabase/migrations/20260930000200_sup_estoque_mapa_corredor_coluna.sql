-- =====================================================================
-- ESTOQUE — mapa 3D: a letra é CORREDOR, e o caixote vira coluna:linha
-- (SIS-2026-0442, segunda rodada)
--
-- O QUE MUDOU DESDE A 20260930000197
--   A 197 assumiu que a letra do endereço ('A' em 'A-03-10') era a ESTANTE,
--   e modelou cada letra como um retângulo rígido de N colunas × N níveis.
--   Com o croqui anotado e os vídeos de 21/09/2026, o autor do chamado
--   confirmou: **a letra é o CORREDOR**. E um corredor não é um retângulo —
--   é um conjunto de colunas de caixotes, que no galpão real não têm todas a
--   mesma altura nem terminam todas na mesma linha (as fotos mostram
--   prateleira de 4 níveis encostada em outra de 7, e coluna que avança mais
--   que a vizinha).
--
--   Por isso a grade rígida sai e entra a peça que o pessoal do estoque vai
--   montar na tela, uma coluna de cada vez:
--
--       sup_estoque_corredor  (era sup_estoque_modulo) — a letra
--         └── sup_estoque_coluna — cada pilha de caixotes, com posição,
--             rotação e quantas linhas ela tem
--
--   O caixote passa a ser identificado por **coluna:linha**, que é como o
--   pedido pediu ("tudo padrão 'coluna:linha'"). Isso é só a LEITURA: o
--   endereço continua gravado como 'A-03-10' em sup_estoque_item.localizacao,
--   nenhuma das 577 fichas é reescrita e nenhuma tela antiga muda. A tela
--   mostra 'A · 10:3'; o banco continua com 'A-03-10'.
--
-- ⚠️ ORDEM DE APLICAÇÃO
--   Esta migration RENOMEIA sup_estoque_modulo e tira colunas dela. O código
--   que está em produção agora lê a tabela antiga. Aplicar esta migration e
--   publicar o frontend novo **na mesma janela** — entre uma coisa e outra, a
--   tela do Mapa 3D mostra o aviso de planta desatualizada (ela foi feita
--   para não quebrar). Nenhuma outra tela do sistema toca nestas tabelas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Módulo vira corredor
--
-- RENAME preserva dados, índices, policies e FKs — as 10 linhas semeadas pela
-- 197 continuam lá, só que agora com o nome certo do que elas sempre foram.
-- ---------------------------------------------------------------------
ALTER TABLE IF EXISTS public.sup_estoque_modulo
  RENAME TO sup_estoque_corredor;

ALTER TABLE public.sup_estoque_corredor
  RENAME CONSTRAINT sup_estoque_modulo_codigo_unico TO sup_estoque_corredor_codigo_unico;
ALTER TABLE public.sup_estoque_corredor
  RENAME CONSTRAINT sup_estoque_modulo_codigo_letra TO sup_estoque_corredor_codigo_letra;

COMMENT ON TABLE public.sup_estoque_corredor IS
  'Um corredor do galpão. codigo = a LETRA usada em sup_estoque_item.localizacao (A de A-03-10). As colunas de caixotes ficam em sup_estoque_coluna.';

COMMENT ON COLUMN public.sup_estoque_corredor.codigo IS
  'A letra do endereço. Confirmado em 21/09/2026: é o corredor, não a estante.';

-- ---------------------------------------------------------------------
-- 2) A coluna de caixotes — a peça que se monta na tela
--
-- `indice` é o número que aparece em coluna:linha. Ele é do CORREDOR, não da
-- posição física: duas colunas em lados opostos do mesmo corredor têm índices
-- diferentes, e é o índice que casa com o endereço escrito na ficha. Mover a
-- coluna de lugar no desenho não muda o endereço de nada.
--
-- `linhas` é a altura em caixotes. `linhas_ocultas` tira um caixote do meio
-- sem mexer na numeração dos outros — o vão do quadro de luz, a passagem, o
-- pedaço que a coluna de concreto come.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sup_estoque_coluna (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corredor_id     uuid NOT NULL REFERENCES public.sup_estoque_corredor(id) ON DELETE CASCADE,
  indice          int  NOT NULL,
  -- Canto traseiro-esquerdo da coluna no piso, em metros, e para onde a
  -- frente dela aponta. Mesma convenção da 197 e de enderecoEstoque.ts.
  pos_x           numeric(6,2) NOT NULL DEFAULT 0,
  pos_z           numeric(6,2) NOT NULL DEFAULT 0,
  rotacao_graus   int NOT NULL DEFAULT 0,
  -- Medidas tiradas dos vídeos: o vão é um pouco mais largo que alto, e a
  -- travessa da frente come cerca de um terço da altura da linha.
  largura_m       numeric(5,3) NOT NULL DEFAULT 0.420,
  profundidade_m  numeric(5,3) NOT NULL DEFAULT 0.580,
  altura_linha_m  numeric(5,3) NOT NULL DEFAULT 0.420,
  altura_base_m   numeric(5,3) NOT NULL DEFAULT 0.090,
  linhas          int NOT NULL DEFAULT 6,
  linhas_ocultas  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  atualizado_por  uuid,
  CONSTRAINT sup_estoque_coluna_indice_unico UNIQUE (corredor_id, indice),
  CONSTRAINT sup_estoque_coluna_indice_positivo CHECK (indice BETWEEN 1 AND 200),
  CONSTRAINT sup_estoque_coluna_linhas_sanas    CHECK (linhas BETWEEN 1 AND 20),
  CONSTRAINT sup_estoque_coluna_rotacao         CHECK (rotacao_graus IN (0, 90, 180, 270)),
  CONSTRAINT sup_estoque_coluna_ocultas_lista   CHECK (jsonb_typeof(linhas_ocultas) = 'array')
);

COMMENT ON TABLE public.sup_estoque_coluna IS
  'Uma pilha de caixotes dentro de um corredor. indice = o "coluna" do padrão coluna:linha; linhas = quantos caixotes empilhados.';

CREATE INDEX IF NOT EXISTS sup_estoque_coluna_corredor_idx
  ON public.sup_estoque_coluna (corredor_id, indice);

DROP TRIGGER IF EXISTS sup_estoque_coluna_touch ON public.sup_estoque_coluna;
CREATE TRIGGER sup_estoque_coluna_touch
  BEFORE UPDATE ON public.sup_estoque_coluna
  FOR EACH ROW EXECUTE FUNCTION public.sup_mapa_touch();

-- ---------------------------------------------------------------------
-- 3) Backfill — desmonta o retângulo da 197 em colunas de verdade
--
-- Cada corredor tinha `colunas` vãos de `largura_vao_m` ao longo do eixo X
-- local. Vira uma linha em sup_estoque_coluna por vão, já na posição que
-- ocupava no desenho, para nada sair do lugar entre uma versão e outra.
-- ---------------------------------------------------------------------
INSERT INTO public.sup_estoque_coluna
  (corredor_id, indice, pos_x, pos_z, rotacao_graus,
   largura_m, profundidade_m, altura_linha_m, linhas)
SELECT
  c.id,
  g.i,
  -- Desloca o canto da coluna ao longo da largura do corredor antigo,
  -- aplicando a mesma rotação que a 197 usava.
  ROUND((c.pos_x + (g.i - 1) * c.largura_vao_m * cos(radians(c.rotacao_graus)))::numeric, 2),
  ROUND((c.pos_z - (g.i - 1) * c.largura_vao_m * sin(radians(c.rotacao_graus)))::numeric, 2),
  c.rotacao_graus,
  c.largura_vao_m,
  c.profundidade_m,
  c.altura_nivel_m,
  c.niveis
FROM public.sup_estoque_corredor c
CROSS JOIN LATERAL generate_series(1, c.colunas) AS g(i)
WHERE NOT EXISTS (
  SELECT 1 FROM public.sup_estoque_coluna x WHERE x.corredor_id = c.id
);

-- A grade rígida não descreve mais nada — quem manda agora é a coluna.
ALTER TABLE public.sup_estoque_corredor
  DROP COLUMN IF EXISTS colunas,
  DROP COLUMN IF EXISTS niveis,
  DROP COLUMN IF EXISTS largura_vao_m,
  DROP COLUMN IF EXISTS altura_nivel_m,
  DROP COLUMN IF EXISTS profundidade_m,
  DROP COLUMN IF EXISTS pos_x,
  DROP COLUMN IF EXISTS pos_z,
  DROP COLUMN IF EXISTS rotacao_graus,
  DROP COLUMN IF EXISTS caixotes_ocultos;

ALTER TABLE public.sup_estoque_corredor
  DROP CONSTRAINT IF EXISTS sup_estoque_modulo_grade_sana,
  DROP CONSTRAINT IF EXISTS sup_estoque_modulo_rotacao,
  DROP CONSTRAINT IF EXISTS sup_estoque_modulo_ocultos_lista;

-- ---------------------------------------------------------------------
-- 4) Marcos do salão — o que não é prateleira mas precisa estar no desenho
--
-- A coluna de concreto no meio do bloco central (aparece no croqui e nos
-- vídeos), a porta que dá para a rua e a porta interna. Sem elas o desenho
-- fica "um salão qualquer"; com elas a pessoa se localiza.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sup_estoque_marco (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id      uuid NOT NULL REFERENCES public.sup_estoque_layout(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  nome           text,
  pos_x          numeric(6,2) NOT NULL DEFAULT 0,
  pos_z          numeric(6,2) NOT NULL DEFAULT 0,
  largura_m      numeric(6,2) NOT NULL DEFAULT 1,
  profundidade_m numeric(6,2) NOT NULL DEFAULT 1,
  altura_m       numeric(6,2),
  rotacao_graus  int NOT NULL DEFAULT 0,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sup_estoque_marco_tipo CHECK (tipo IN ('pilar', 'porta_rua', 'porta_interna', 'bancada')),
  CONSTRAINT sup_estoque_marco_rotacao CHECK (rotacao_graus IN (0, 90, 180, 270))
);

COMMENT ON TABLE public.sup_estoque_marco IS
  'Pilar, portas e bancada — o que o desenho precisa mostrar além das prateleiras (SIS-2026-0442).';

-- Largura da bancada deixa de ser chumbada no frontend: no croqui ela
-- atravessa quase todo o fundo do salão, não é uma mesinha de canto.
ALTER TABLE public.sup_estoque_layout
  ADD COLUMN IF NOT EXISTS mesa_largura_m numeric(6,2) NOT NULL DEFAULT 3.20;

-- ---------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.sup_estoque_coluna ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_marco  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_coluna_select ON public.sup_estoque_coluna;
CREATE POLICY sup_estoque_coluna_select ON public.sup_estoque_coluna
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque_mapa', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

DROP POLICY IF EXISTS sup_estoque_marco_select ON public.sup_estoque_marco;
CREATE POLICY sup_estoque_marco_select ON public.sup_estoque_marco
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque_mapa', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

-- Escrita continua só pelas RPCs, como na 197.

-- ---------------------------------------------------------------------
-- 6) As RPCs do editor
-- ---------------------------------------------------------------------

-- A de módulo não descreve mais nada.
DROP FUNCTION IF EXISTS public.sup_mapa_salvar_modulo(jsonb);
DROP FUNCTION IF EXISTS public.sup_mapa_excluir_modulo(uuid);

CREATE OR REPLACE FUNCTION public.sup_mapa_salvar_corredor(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     uuid := NULLIF(p->>'id', '')::uuid;
  v_codigo text := upper(btrim(coalesce(p->>'codigo', '')));
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa do estoque.' USING ERRCODE = '42501';
  END IF;
  IF v_codigo !~ '^[A-Z]$' THEN
    RAISE EXCEPTION 'O corredor é identificado por uma letra só (A a Z) — é ela que aparece no endereço do item.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sup_estoque_corredor AS c
    (id, layout_id, codigo, nome, ordem, ativo, atualizado_por)
  VALUES
    (COALESCE(v_id, gen_random_uuid()),
     (p->>'layout_id')::uuid, v_codigo,
     NULLIF(btrim(p->>'nome'), ''),
     COALESCE((p->>'ordem')::int, 0),
     COALESCE((p->>'ativo')::boolean, true),
     auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    codigo = EXCLUDED.codigo,
    nome   = EXCLUDED.nome,
    ordem  = EXCLUDED.ordem,
    ativo  = EXCLUDED.ativo
  RETURNING c.id INTO v_id;

  RETURN to_jsonb((SELECT x FROM public.sup_estoque_corredor x WHERE x.id = v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_mapa_excluir_corredor(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir corredor do mapa.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sup_estoque_corredor WHERE id = p_id;
END;
$$;

-- Salvar uma coluna. Aceita várias de uma vez para o editor conseguir
-- arrastar/empilhar sem um round-trip por clique.
CREATE OR REPLACE FUNCTION public.sup_mapa_salvar_colunas(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item   jsonb;
  v_id   uuid;
  v_ids  uuid[] := '{}';
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa do estoque.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) <> 'array' THEN
    RAISE EXCEPTION 'Esperava uma lista de colunas.' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p) LOOP
    v_id := NULLIF(item->>'id', '')::uuid;

    INSERT INTO public.sup_estoque_coluna AS k
      (id, corredor_id, indice, pos_x, pos_z, rotacao_graus,
       largura_m, profundidade_m, altura_linha_m, altura_base_m,
       linhas, linhas_ocultas, ativo, atualizado_por)
    VALUES
      (COALESCE(v_id, gen_random_uuid()),
       (item->>'corredor_id')::uuid,
       (item->>'indice')::int,
       COALESCE((item->>'pos_x')::numeric, 0),
       COALESCE((item->>'pos_z')::numeric, 0),
       COALESCE((item->>'rotacao_graus')::int, 0),
       COALESCE((item->>'largura_m')::numeric, 0.420),
       COALESCE((item->>'profundidade_m')::numeric, 0.580),
       COALESCE((item->>'altura_linha_m')::numeric, 0.420),
       COALESCE((item->>'altura_base_m')::numeric, 0.090),
       COALESCE((item->>'linhas')::int, 6),
       COALESCE(item->'linhas_ocultas', '[]'::jsonb),
       COALESCE((item->>'ativo')::boolean, true),
       auth.uid())
    ON CONFLICT (id) DO UPDATE SET
      corredor_id    = EXCLUDED.corredor_id,
      indice         = EXCLUDED.indice,
      pos_x          = EXCLUDED.pos_x,
      pos_z          = EXCLUDED.pos_z,
      rotacao_graus  = EXCLUDED.rotacao_graus,
      largura_m      = EXCLUDED.largura_m,
      profundidade_m = EXCLUDED.profundidade_m,
      altura_linha_m = EXCLUDED.altura_linha_m,
      altura_base_m  = EXCLUDED.altura_base_m,
      linhas         = EXCLUDED.linhas,
      linhas_ocultas = EXCLUDED.linhas_ocultas,
      ativo          = EXCLUDED.ativo
    RETURNING k.id INTO v_id;

    v_ids := v_ids || v_id;
  END LOOP;

  RETURN COALESCE(
    (SELECT jsonb_agg(to_jsonb(x)) FROM public.sup_estoque_coluna x WHERE x.id = ANY(v_ids)),
    '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_mapa_excluir_coluna(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir coluna do mapa.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sup_estoque_coluna WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_mapa_salvar_marco(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid := NULLIF(p->>'id', '')::uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa do estoque.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.sup_estoque_marco AS m
    (id, layout_id, tipo, nome, pos_x, pos_z, largura_m, profundidade_m, altura_m, rotacao_graus)
  VALUES
    (COALESCE(v_id, gen_random_uuid()),
     (p->>'layout_id')::uuid,
     p->>'tipo',
     NULLIF(btrim(p->>'nome'), ''),
     COALESCE((p->>'pos_x')::numeric, 0),
     COALESCE((p->>'pos_z')::numeric, 0),
     COALESCE((p->>'largura_m')::numeric, 1),
     COALESCE((p->>'profundidade_m')::numeric, 1),
     (p->>'altura_m')::numeric,
     COALESCE((p->>'rotacao_graus')::int, 0))
  ON CONFLICT (id) DO UPDATE SET
    tipo = EXCLUDED.tipo, nome = EXCLUDED.nome,
    pos_x = EXCLUDED.pos_x, pos_z = EXCLUDED.pos_z,
    largura_m = EXCLUDED.largura_m, profundidade_m = EXCLUDED.profundidade_m,
    altura_m = EXCLUDED.altura_m, rotacao_graus = EXCLUDED.rotacao_graus
  RETURNING m.id INTO v_id;

  RETURN to_jsonb((SELECT x FROM public.sup_estoque_marco x WHERE x.id = v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_mapa_excluir_marco(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir marco do mapa.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sup_estoque_marco WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sup_mapa_salvar_corredor(jsonb)  FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_excluir_corredor(uuid)  FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_salvar_colunas(jsonb)   FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_excluir_coluna(uuid)    FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_salvar_marco(jsonb)     FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_excluir_marco(uuid)     FROM public;
GRANT EXECUTE ON FUNCTION public.sup_mapa_salvar_corredor(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_excluir_corredor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_salvar_colunas(jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_excluir_coluna(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_salvar_marco(jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_excluir_marco(uuid)    TO authenticated;

-- ---------------------------------------------------------------------
-- 7) A planta redesenhada em cima do croqui anotado
--
-- O croqui de 21/09/2026 nomeia os corredores (A à direita, B à esquerda, C e
-- D horizontais), marca a COLUNA DE CONCRETO no meio do bloco central, põe a
-- bancada atravessando o fundo do salão e mostra as duas portas. Os vídeos
-- mostram que os corredores são ESTREITOS (~1,15 m) e as prateleiras altas —
-- a versão anterior tinha corredores largos demais.
--
-- Aqui o seed só REPOSICIONA o que já existe, sem inventar corredor novo e
-- sem apagar coluna nenhuma: quem tem o galpão na cabeça termina o ajuste na
-- própria tela, que agora deixa.
-- ---------------------------------------------------------------------
DO $planta$
DECLARE
  v_layout uuid;
BEGIN
  SELECT id INTO v_layout FROM public.sup_estoque_layout ORDER BY criado_em LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE NOTICE 'Sem planta — nada a reposicionar.';
    RETURN;
  END IF;

  -- A bancada atravessa o fundo do salão (croqui) e olha para dentro dele,
  -- que é de onde a câmera arranca. Com rotação 0 a largura corre em +X a
  -- partir de mesa_x — 2,40 + 6,20 = 8,60, dentro dos 11 m de parede.
  UPDATE public.sup_estoque_layout
     SET largura_m = 11.00, profundidade_m = 12.00, pe_direito_m = 3.05,
         mesa_x = 2.40, mesa_z = 10.55, mesa_largura_m = 6.20, mesa_rotacao = 0
   WHERE id = v_layout;

  -- Nomes conforme o croqui anotado. A, B, C e D são os quatro que o croqui
  -- nomeia; as outras letras existem nos endereços mas não no croqui, então
  -- ganham um nome honesto em vez de um palpite.
  UPDATE public.sup_estoque_corredor SET nome = 'Corredor A — lado direito'  WHERE layout_id = v_layout AND codigo = 'A';
  UPDATE public.sup_estoque_corredor SET nome = 'Corredor B — lado esquerdo' WHERE layout_id = v_layout AND codigo = 'B';
  UPDATE public.sup_estoque_corredor SET nome = 'Corredor C — central'       WHERE layout_id = v_layout AND codigo = 'C';
  UPDATE public.sup_estoque_corredor SET nome = 'Corredor D — do fundo'      WHERE layout_id = v_layout AND codigo = 'D';

  UPDATE public.sup_estoque_corredor
     SET nome = 'Corredor ' || codigo || ' — posição a conferir'
   WHERE layout_id = v_layout
     AND codigo NOT IN ('A', 'B', 'C', 'D');

  -- Marcos: a coluna de concreto e as duas portas.
  INSERT INTO public.sup_estoque_marco (layout_id, tipo, nome, pos_x, pos_z, largura_m, profundidade_m, altura_m)
  SELECT v_layout, 'pilar', 'Coluna de concreto', 5.15, 4.20, 0.45, 0.95, 3.05
   WHERE NOT EXISTS (SELECT 1 FROM public.sup_estoque_marco WHERE layout_id = v_layout AND tipo = 'pilar');

  INSERT INTO public.sup_estoque_marco (layout_id, tipo, nome, pos_x, pos_z, largura_m, profundidade_m, altura_m, rotacao_graus)
  SELECT v_layout, 'porta_rua', 'Porta que dá para a rua', 0.02, 8.60, 0.10, 1.60, 2.30, 0
   WHERE NOT EXISTS (SELECT 1 FROM public.sup_estoque_marco WHERE layout_id = v_layout AND tipo = 'porta_rua');

  INSERT INTO public.sup_estoque_marco (layout_id, tipo, nome, pos_x, pos_z, largura_m, profundidade_m, altura_m, rotacao_graus)
  SELECT v_layout, 'porta_interna', 'Porta interna', 0.70, 11.96, 1.40, 0.10, 2.30, 0
   WHERE NOT EXISTS (SELECT 1 FROM public.sup_estoque_marco WHERE layout_id = v_layout AND tipo = 'porta_interna');

  -- ---------------------------------------------------------------
  -- Reposiciona as colunas de A, B, C e D conforme o croqui, com
  -- corredor ESTREITO. É a correção que motivou esta rodada: a planta
  -- anterior tinha corredor de 2 m e por isso o desenho não parecia o
  -- galpão. Nos vídeos a escada de abrir quase encosta nos dois lados.
  --
  -- Só mexe nas quatro letras que o croqui nomeia. As outras ficam onde
  -- estão, com o nome avisando que a posição é para conferir — chutar
  -- onde elas ficam seria inventar galpão.
  -- ---------------------------------------------------------------
  -- Medidas padrão, iguais para todo mundo (o pessoal ajusta o que for
  -- diferente na tela).
  UPDATE public.sup_estoque_coluna k
     SET largura_m = 0.420, profundidade_m = 0.580, altura_linha_m = 0.420
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout;

  -- A e B encostam nas paredes que o croqui aponta: A à direita, B à
  -- esquerda, as duas olhando para dentro do salão.
  UPDATE public.sup_estoque_coluna k
     SET pos_x = 10.94, pos_z = ROUND((0.60 + (k.indice - 1) * 0.42)::numeric, 2),
         rotacao_graus = 270
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout AND c.codigo = 'A';

  UPDATE public.sup_estoque_coluna k
     SET pos_x = 0.06, pos_z = ROUND((7.80 - (k.indice - 1) * 0.42)::numeric, 2),
         rotacao_graus = 90
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout AND c.codigo = 'B';

  -- O miolo do salão são FILEIRAS COSTA COM COSTA, separadas por corredor de
  -- 1,10 m — é assim nas fotos, e é o que a versão anterior errou ao deixar
  -- 2 m de corredor. Cada par (frente para o fundo / frente para a frente)
  -- divide a mesma carcaça, como D+C, E+F e G+H.
  --
  --   z=0,63 frente de D ─┐
  --                       │ corredor 1,10
  --   z=1,73 frente de C ─┘   (C e E dividem a carcaça em z=2,31)
  --   z=2,89 frente de E ─┐
  --                       │ corredor 1,10
  --   z=3,99 frente de F ─┘   (F e G dividem a carcaça em z=4,57)
  --   ... e assim por diante até a bancada.
  UPDATE public.sup_estoque_coluna k
     SET rotacao_graus = f.rot,
         pos_z = f.pz,
         pos_x = CASE WHEN f.rot = 0
                      THEN ROUND((1.40 + (k.indice - 1) * 0.42)::numeric, 2)
                      ELSE ROUND((8.60 - (k.indice - 1) * 0.42)::numeric, 2)
                 END
    FROM public.sup_estoque_corredor c
    JOIN (VALUES
            ('D', 0,   0.05),
            ('C', 180, 2.31),
            ('E', 0,   2.31),
            ('F', 180, 4.57),
            ('G', 0,   4.57),
            ('H', 180, 6.83),
            ('J', 0,   6.83)
         ) AS f(codigo, rot, pz) ON f.codigo = c.codigo
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout;

  -- Z tem 24 colunas — uma fileira só atravessaria o salão inteiro e taparia
  -- a vista da bancada. Como são 5 fichas e ninguém sabe onde Z fica de
  -- verdade, ele é DOBRADO em fileiras curtas encostadas no canto da frente
  -- à esquerda: continua inteiro e clicável, sem cortar o salão no meio. O
  -- nome já avisa que a posição é para conferir.
  UPDATE public.sup_estoque_coluna k
     SET pos_x = ROUND((0.50 + ((k.indice - 1) % 8) * 0.42)::numeric, 2),
         pos_z = ROUND((7.70 + ((k.indice - 1) / 8) * 0.70)::numeric, 2),
         rotacao_graus = 0
    FROM public.sup_estoque_corredor c
   WHERE c.id = k.corredor_id AND c.layout_id = v_layout AND c.codigo = 'Z';

  -- ---------------------------------------------------------------
  -- Trava de altura: nenhuma coluna pode furar o forro.
  --
  -- Acontece de verdade — o corredor Z tem endereço até a linha 10
  -- ('Z10.24'), e 10 linhas de 42 cm dariam 4,29 m num pé-direito de
  -- 3,05 m. No desenho isso vira uma parede atravessando o teto.
  --
  -- A saída NÃO é cortar linhas: cortar faria o endereço 'Z-10-24'
  -- apontar para uma linha que não existe, e a ficha sumiria do mapa.
  -- Em vez disso a linha fica mais baixa, o que além de caber é o mais
  -- provável de ser verdade — prateleira com muito nível tem nível
  -- baixo.
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

  RAISE NOTICE 'Planta reposicionada: % corredores, % colunas, % marcos.',
    (SELECT count(*) FROM public.sup_estoque_corredor WHERE layout_id = v_layout),
    (SELECT count(*) FROM public.sup_estoque_coluna k JOIN public.sup_estoque_corredor c ON c.id = k.corredor_id WHERE c.layout_id = v_layout),
    (SELECT count(*) FROM public.sup_estoque_marco WHERE layout_id = v_layout);
END;
$planta$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (rodar depois de aplicar)
-- ---------------------------------------------------------------------
-- -- 1. Toda coluna do retângulo antigo virou linha nova?
-- SELECT c.codigo, count(k.*) AS colunas, min(k.linhas) AS menor, max(k.linhas) AS maior
--   FROM public.sup_estoque_corredor c
--   LEFT JOIN public.sup_estoque_coluna k ON k.corredor_id = c.id
--  GROUP BY c.codigo ORDER BY c.codigo;
--
-- -- 2. Endereço apontando para coluna que não existe no desenho
-- SELECT v.rua, v.coluna, count(*)
--   FROM public.v_sup_estoque_mapa v
--   LEFT JOIN public.sup_estoque_corredor c ON c.codigo = v.rua
--   LEFT JOIN public.sup_estoque_coluna  k ON k.corredor_id = c.id AND k.indice = v.coluna
--  WHERE v.endereco_valido AND k.id IS NULL
--  GROUP BY 1,2 ORDER BY 1,2;
--
-- -- 3. Endereço com linha acima do que a coluna tem
-- SELECT v.rua, v.coluna, v.nivel, k.linhas
--   FROM public.v_sup_estoque_mapa v
--   JOIN public.sup_estoque_corredor c ON c.codigo = v.rua
--   JOIN public.sup_estoque_coluna  k ON k.corredor_id = c.id AND k.indice = v.coluna
--  WHERE v.endereco_valido AND v.nivel > k.linhas;

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.sup_mapa_excluir_marco(uuid);
-- DROP FUNCTION IF EXISTS public.sup_mapa_salvar_marco(jsonb);
-- DROP FUNCTION IF EXISTS public.sup_mapa_excluir_coluna(uuid);
-- DROP FUNCTION IF EXISTS public.sup_mapa_salvar_colunas(jsonb);
-- DROP FUNCTION IF EXISTS public.sup_mapa_excluir_corredor(uuid);
-- DROP FUNCTION IF EXISTS public.sup_mapa_salvar_corredor(jsonb);
-- DROP TABLE IF EXISTS public.sup_estoque_marco;
-- DROP TABLE IF EXISTS public.sup_estoque_coluna;
-- ALTER TABLE public.sup_estoque_layout DROP COLUMN IF EXISTS mesa_largura_m;
-- ALTER TABLE public.sup_estoque_corredor
--   ADD COLUMN colunas int NOT NULL DEFAULT 10,
--   ADD COLUMN niveis int NOT NULL DEFAULT 5,
--   ADD COLUMN largura_vao_m numeric(5,3) NOT NULL DEFAULT 0.450,
--   ADD COLUMN altura_nivel_m numeric(5,3) NOT NULL DEFAULT 0.480,
--   ADD COLUMN profundidade_m numeric(5,3) NOT NULL DEFAULT 0.550,
--   ADD COLUMN pos_x numeric(6,2) NOT NULL DEFAULT 0,
--   ADD COLUMN pos_z numeric(6,2) NOT NULL DEFAULT 0,
--   ADD COLUMN rotacao_graus int NOT NULL DEFAULT 0,
--   ADD COLUMN caixotes_ocultos jsonb NOT NULL DEFAULT '[]'::jsonb;
-- ALTER TABLE public.sup_estoque_corredor RENAME TO sup_estoque_modulo;
-- NOTIFY pgrst, 'reload schema';
