-- =====================================================================
-- ESTOQUE — mapa 3D do galpão (SIS-2026-0442)
--
-- PEDIDO (Bernardo Campos, 17/09/2026; detalhado pelo Eduardo em 21/09/2026
-- com dois vídeos do galpão e uma planta do Excalidraw):
--   "Mapeamento 3d do estoque para melhor localização de itens." — desenho 3D
--   do estoque inteiro, dividido nas baias/caixotes como no vídeo, o pessoal
--   do estoque podendo entrar no desenho e dizer onde fica cada caixote, e um
--   botão pequeno na entrada do item para ver a localização 3D dele.
--
-- POR QUE ISTO NÃO CRIA ENDEREÇO NOVO
--   `sup_estoque_item.localizacao` já existe (carga do legado em
--   20260903000001, ligada às telas em 20260930000174) e em 21/09/2026 tem
--   747 fichas preenchidas num único almoxarifado. Medindo esses 747 valores:
--
--     formato        casos   letras          2º comp.   3º comp.
--     'A-03-10'       471    A..G            1..6       1..15
--     'A4.14'         237    A..H, J, Z      1..6 (Z:9,10)  1..15 (Z:24)
--     sujo            ~30    TESTE, N/A, 0-00-00, 00.00, INS-0004, '1'
--     multi-posição     3    G-04-05-06/02, G-03-01/02/03
--
--   As duas notações usam as MESMAS letras e as MESMAS faixas — é o mesmo
--   galpão escrito de dois jeitos (o legado com hífen, a digitação recente
--   com ponto), não duas áreas. E a faixa do 2º componente (1..6) bate com os
--   5-6 níveis que aparecem no vídeo, enquanto o 3º (1..15) bate com os vãos
--   de um módulo. Ou seja: o endereço JÁ É tridimensional —
--
--       letra = estante (baia)  |  2º = nível  |  3º = coluna do caixote
--
--   e A..G são sete estantes, exatamente os sete blocos da planta desenhada
--   (quatro no perímetro + a ilha comprida + o bloco central de duas faces).
--   Por isso esta migration NÃO mexe em `localizacao`, não faz backfill e não
--   cria coluna: ela só dá ao endereço que já existe um corpo geométrico.
--
-- O QUE ENTRA
--   sup_loc_parse()          — lê as duas notações, devolve NULL no que é sujo
--   sup_estoque_layout       — a planta do galpão (dimensões, mesa de trabalho)
--   sup_estoque_modulo       — cada estante: onde fica, quantos níveis/colunas
--   v_sup_estoque_mapa       — ficha + endereço decomposto + saldo
--   sup_layout_salvar/…      — o editor que o pessoal do estoque usa
--   menu sup_estoque_mapa    — com a permissão semeada (menu sem regra nasce
--                              aberto para todo autenticado)
--
-- O SEED usa os dados reais: cada estante nasce com níveis e colunas iguais
-- ao MAIOR endereço já cadastrado naquela letra. O desenho abre já cabendo o
-- que existe, e o pessoal ajusta o resto na própria tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) O parser do endereço
--
-- IMMUTABLE porque só depende do texto — é o que permite usá-la em índice e
-- em view sem custo por linha repetido. Não é SECURITY DEFINER: é função
-- pura, não toca em tabela nenhuma.
--
-- Endereço ilegível NÃO é erro: devolve (NULL, NULL, NULL) e a ficha cai no
-- balde "sem endereço" da tela. Zero também não é endereço — '0-00-00' e
-- '00.00' são 14 fichas que vieram assim do legado e significam "não sei".
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sup_loc_parse(
  p_texto text,
  OUT rua text,
  OUT nivel int,
  OUT coluna int
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text;
  m text[];
BEGIN
  rua := NULL; nivel := NULL; coluna := NULL;
  v := upper(btrim(coalesce(p_texto, '')));
  IF v = '' THEN RETURN; END IF;

  -- 'A-03-10', e também 'G-04-05-06/02' (ancora nos dois primeiros números;
  -- o resto é o material ocupando mais de um vão, que o texto original guarda)
  m := regexp_match(v, '^([A-Z])[-. ]+0*([0-9]{1,2})[-. ]+0*([0-9]{1,2})');
  IF m IS NULL THEN
    -- 'A4.14'
    m := regexp_match(v, '^([A-Z])0*([0-9]{1,2})[.]0*([0-9]{1,2})');
  END IF;
  IF m IS NULL THEN RETURN; END IF;

  -- Zero em qualquer eixo é "não sei", não endereço.
  IF m[2]::int = 0 OR m[3]::int = 0 THEN RETURN; END IF;

  rua := m[1]; nivel := m[2]::int; coluna := m[3]::int;
END;
$$;

COMMENT ON FUNCTION public.sup_loc_parse(text) IS
  'Quebra o endereço livre de sup_estoque_item.localizacao em (rua, nivel, coluna). Aceita A-03-10 e A4.14. Devolve NULLs no que não reconhece.';

-- ---------------------------------------------------------------------
-- 2) A planta
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sup_estoque_layout (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  almoxarifado_id  uuid NOT NULL REFERENCES public.almoxarifado(id) ON DELETE CASCADE,
  nome             text NOT NULL DEFAULT 'Planta principal',
  -- Medidas do salão em metros. X é a largura (esquerda-direita), Z a
  -- profundidade (fundo-frente); Y é a altura, e por isso não entra aqui.
  largura_m        numeric(6,2) NOT NULL DEFAULT 12.0,
  profundidade_m   numeric(6,2) NOT NULL DEFAULT 12.0,
  pe_direito_m     numeric(6,2) NOT NULL DEFAULT 3.10,
  -- A bancada onde o pessoal fica sentado nos PCs. É de onde a câmera parte
  -- no voo até a baia — o "puxa o zoom desde onde a gente senta" do pedido.
  mesa_x           numeric(6,2) NOT NULL DEFAULT 1.40,
  mesa_z           numeric(6,2) NOT NULL DEFAULT 10.60,
  mesa_rotacao     int          NOT NULL DEFAULT 0,
  observacoes      text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  CONSTRAINT sup_estoque_layout_um_por_almox UNIQUE (almoxarifado_id),
  CONSTRAINT sup_estoque_layout_dim_positiva
    CHECK (largura_m > 0 AND profundidade_m > 0 AND pe_direito_m > 0)
);

COMMENT ON TABLE public.sup_estoque_layout IS
  'Planta do galpão de um almoxarifado, em metros. Uma por almoxarifado.';

-- ---------------------------------------------------------------------
-- 3) As estantes
--
-- `codigo` é a LETRA do endereço, não um nome bonito: é ele que amarra o
-- desenho ao que está escrito em sup_estoque_item.localizacao. Por isso a
-- unicidade é por (layout, codigo) e o check exige uma letra só.
--
-- Não existe "dupla face" aqui de propósito. Duas estantes costa com costa
-- são DUAS letras (o endereço não tem como dizer de que lado está), e no
-- desenho elas ficam na mesma posição com rotação oposta.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sup_estoque_modulo (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id        uuid NOT NULL REFERENCES public.sup_estoque_layout(id) ON DELETE CASCADE,
  codigo           text NOT NULL,
  nome             text,
  -- Canto do módulo no piso, em metros, e para onde ele está virado.
  pos_x            numeric(6,2) NOT NULL DEFAULT 0,
  pos_z            numeric(6,2) NOT NULL DEFAULT 0,
  rotacao_graus    int  NOT NULL DEFAULT 0,
  -- A grade de caixotes.
  colunas          int  NOT NULL DEFAULT 10,
  niveis           int  NOT NULL DEFAULT 5,
  largura_vao_m    numeric(5,3) NOT NULL DEFAULT 0.450,
  altura_nivel_m   numeric(5,3) NOT NULL DEFAULT 0.480,
  profundidade_m   numeric(5,3) NOT NULL DEFAULT 0.550,
  -- Vãos que existem na grade mas não na parede (passagem, quadro de luz,
  -- o pilar que aparece no vídeo). Lista de {"nivel":n,"coluna":c}.
  caixotes_ocultos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ordem            int NOT NULL DEFAULT 0,
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_por   uuid,
  CONSTRAINT sup_estoque_modulo_codigo_unico UNIQUE (layout_id, codigo),
  CONSTRAINT sup_estoque_modulo_codigo_letra CHECK (codigo ~ '^[A-Z]$'),
  CONSTRAINT sup_estoque_modulo_grade_sana
    CHECK (colunas BETWEEN 1 AND 40 AND niveis BETWEEN 1 AND 12),
  CONSTRAINT sup_estoque_modulo_rotacao
    CHECK (rotacao_graus IN (0, 90, 180, 270)),
  CONSTRAINT sup_estoque_modulo_ocultos_lista
    CHECK (jsonb_typeof(caixotes_ocultos) = 'array')
);

COMMENT ON TABLE public.sup_estoque_modulo IS
  'Uma estante (baia) do mapa 3D. codigo = a letra usada em sup_estoque_item.localizacao.';

CREATE INDEX IF NOT EXISTS sup_estoque_modulo_layout_idx
  ON public.sup_estoque_modulo (layout_id, ordem, codigo);

-- Carimbo de atualização — mesma função usada pelo resto do módulo.
CREATE OR REPLACE FUNCTION public.sup_mapa_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;

-- Trigger não aceita CREATE OR REPLACE.
DROP TRIGGER IF EXISTS sup_estoque_layout_touch ON public.sup_estoque_layout;
CREATE TRIGGER sup_estoque_layout_touch
  BEFORE UPDATE ON public.sup_estoque_layout
  FOR EACH ROW EXECUTE FUNCTION public.sup_mapa_touch();

DROP TRIGGER IF EXISTS sup_estoque_modulo_touch ON public.sup_estoque_modulo;
CREATE TRIGGER sup_estoque_modulo_touch
  BEFORE UPDATE ON public.sup_estoque_modulo
  FOR EACH ROW EXECUTE FUNCTION public.sup_mapa_touch();

-- ---------------------------------------------------------------------
-- 4) RLS — quem vê o estoque vê o mapa; quem altera precisa da ação própria
-- ---------------------------------------------------------------------
ALTER TABLE public.sup_estoque_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_modulo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_layout_select ON public.sup_estoque_layout;
CREATE POLICY sup_estoque_layout_select ON public.sup_estoque_layout
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque_mapa', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

DROP POLICY IF EXISTS sup_estoque_modulo_select ON public.sup_estoque_modulo;
CREATE POLICY sup_estoque_modulo_select ON public.sup_estoque_modulo
  FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_estoque_mapa', 'visualizar')
    OR public.can_access(auth.uid(), 'sup_estoque', 'visualizar')
  );

-- A escrita não tem policy: ela passa pelas RPCs abaixo, que são
-- SECURITY DEFINER e checam a ação 'alterar'. Deixar a tabela sem policy de
-- INSERT/UPDATE/DELETE é o jeito de garantir que ninguém edite a planta por
-- fora do fluxo (PostgREST recusa por falta de policy).

-- ---------------------------------------------------------------------
-- 5) A view que a tela lê
--
-- security_invoker porque senão a view enxergaria com os olhos do dono e
-- devolveria estoque para quem tem a tela mas não tem os dados — o mesmo
-- cuidado tomado em 20260930000163.
--
-- O saldo NÃO é recalculado aqui: sai de sup_estoque_saldo, que desde
-- 20260930000076 é quem sabe descontar reserva. Uma terceira cópia dessa
-- fórmula seria a terceira chance de ela divergir.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_sup_estoque_mapa;
CREATE VIEW public.v_sup_estoque_mapa
WITH (security_invoker = true) AS
SELECT
  ei.id                        AS item_estoque_id,
  ei.almoxarifado_id,
  ax.nome                      AS almoxarifado_nome,
  it.id                        AS sup_item_id,
  it.codigo                    AS codigo_item,
  it.nome                      AS material,
  it.tipo                      AS tipo_material,
  it.tamanho,
  pai.nome                     AS material_base,
  ei.localizacao,
  loc.rua,
  loc.nivel,
  loc.coluna,
  (loc.rua IS NOT NULL)        AS endereco_valido,
  ei.estoque_minimo,
  COALESCE(sd.fisico, 0)       AS fisico,
  COALESCE(sd.reservado, 0)    AS reservado,
  COALESCE(sd.disponivel, 0)   AS disponivel
FROM public.sup_estoque_item ei
JOIN public.sup_item          it  ON it.id = ei.sup_item_id
LEFT JOIN public.sup_item     pai ON pai.id = it.item_pai_id
LEFT JOIN public.almoxarifado ax  ON ax.id = ei.almoxarifado_id
LEFT JOIN public.sup_estoque_saldo sd ON sd.item_estoque_id = ei.id
CROSS JOIN LATERAL public.sup_loc_parse(ei.localizacao) AS loc
WHERE ei.arquivado_em IS NULL;

COMMENT ON VIEW public.v_sup_estoque_mapa IS
  'Ficha de estoque com o endereço já quebrado em rua/nivel/coluna e o saldo de sup_estoque_saldo. Alimenta o mapa 3D (SIS-2026-0442).';

-- ---------------------------------------------------------------------
-- 6) O editor — salvar a planta e as estantes
--
-- SECURITY DEFINER com search_path fixo, e a checagem de acesso é a primeira
-- coisa que roda. Todas devolvem a linha em jsonb para a tela atualizar sem
-- um segundo round-trip.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sup_mapa_salvar_layout(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_almox uuid := (p->>'almoxarifado_id')::uuid;
  v_id    uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa do estoque.'
      USING ERRCODE = '42501';
  END IF;
  IF v_almox IS NULL THEN
    RAISE EXCEPTION 'Informe o almoxarifado.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sup_estoque_layout AS l
    (almoxarifado_id, nome, largura_m, profundidade_m, pe_direito_m,
     mesa_x, mesa_z, mesa_rotacao, observacoes, atualizado_por)
  VALUES
    (v_almox,
     COALESCE(NULLIF(btrim(p->>'nome'), ''), 'Planta principal'),
     COALESCE((p->>'largura_m')::numeric, 12.0),
     COALESCE((p->>'profundidade_m')::numeric, 12.0),
     COALESCE((p->>'pe_direito_m')::numeric, 3.10),
     COALESCE((p->>'mesa_x')::numeric, 1.40),
     COALESCE((p->>'mesa_z')::numeric, 10.60),
     COALESCE((p->>'mesa_rotacao')::int, 0),
     NULLIF(btrim(p->>'observacoes'), ''),
     auth.uid())
  ON CONFLICT (almoxarifado_id) DO UPDATE SET
    nome           = COALESCE(NULLIF(btrim(p->>'nome'), ''), l.nome),
    largura_m      = COALESCE((p->>'largura_m')::numeric, l.largura_m),
    profundidade_m = COALESCE((p->>'profundidade_m')::numeric, l.profundidade_m),
    pe_direito_m   = COALESCE((p->>'pe_direito_m')::numeric, l.pe_direito_m),
    mesa_x         = COALESCE((p->>'mesa_x')::numeric, l.mesa_x),
    mesa_z         = COALESCE((p->>'mesa_z')::numeric, l.mesa_z),
    mesa_rotacao   = COALESCE((p->>'mesa_rotacao')::int, l.mesa_rotacao),
    observacoes    = COALESCE(NULLIF(btrim(p->>'observacoes'), ''), l.observacoes)
  RETURNING l.id INTO v_id;

  RETURN to_jsonb((SELECT x FROM public.sup_estoque_layout x WHERE x.id = v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.sup_mapa_salvar_modulo(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_layout uuid := (p->>'layout_id')::uuid;
  v_codigo text := upper(btrim(coalesce(p->>'codigo', '')));
  v_id     uuid := NULLIF(p->>'id', '')::uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para editar o mapa do estoque.'
      USING ERRCODE = '42501';
  END IF;
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'Informe a planta.' USING ERRCODE = '22023';
  END IF;
  IF v_codigo !~ '^[A-Z]$' THEN
    RAISE EXCEPTION 'A estante é identificada por uma letra só (A a Z) — é ela que aparece no endereço do item.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sup_estoque_modulo AS m
    (id, layout_id, codigo, nome, pos_x, pos_z, rotacao_graus,
     colunas, niveis, largura_vao_m, altura_nivel_m, profundidade_m,
     caixotes_ocultos, ordem, ativo, atualizado_por)
  VALUES
    (COALESCE(v_id, gen_random_uuid()), v_layout, v_codigo,
     NULLIF(btrim(p->>'nome'), ''),
     COALESCE((p->>'pos_x')::numeric, 0),
     COALESCE((p->>'pos_z')::numeric, 0),
     COALESCE((p->>'rotacao_graus')::int, 0),
     COALESCE((p->>'colunas')::int, 10),
     COALESCE((p->>'niveis')::int, 5),
     COALESCE((p->>'largura_vao_m')::numeric, 0.450),
     COALESCE((p->>'altura_nivel_m')::numeric, 0.480),
     COALESCE((p->>'profundidade_m')::numeric, 0.550),
     COALESCE(p->'caixotes_ocultos', '[]'::jsonb),
     COALESCE((p->>'ordem')::int, 0),
     COALESCE((p->>'ativo')::boolean, true),
     auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    codigo           = EXCLUDED.codigo,
    nome             = EXCLUDED.nome,
    pos_x            = EXCLUDED.pos_x,
    pos_z            = EXCLUDED.pos_z,
    rotacao_graus    = EXCLUDED.rotacao_graus,
    colunas          = EXCLUDED.colunas,
    niveis           = EXCLUDED.niveis,
    largura_vao_m    = EXCLUDED.largura_vao_m,
    altura_nivel_m   = EXCLUDED.altura_nivel_m,
    profundidade_m   = EXCLUDED.profundidade_m,
    caixotes_ocultos = EXCLUDED.caixotes_ocultos,
    ordem            = EXCLUDED.ordem,
    ativo            = EXCLUDED.ativo
  RETURNING m.id INTO v_id;

  RETURN to_jsonb((SELECT x FROM public.sup_estoque_modulo x WHERE x.id = v_id));
END;
$$;

-- Excluir estante do desenho NÃO apaga endereço de item nenhum: o endereço
-- mora no texto da ficha. A estante some do desenho, e as fichas daquela
-- letra passam a aparecer no balde "sem lugar no desenho" da tela — que é
-- justamente o aviso de que alguém apagou uma estante que ainda tem coisa.
CREATE OR REPLACE FUNCTION public.sup_mapa_excluir_modulo(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque_mapa', 'excluir') THEN
    RAISE EXCEPTION 'Sem permissão para excluir estante do mapa.'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.sup_estoque_modulo WHERE id = p_id;
END;
$$;

-- Gravar a localização de um item direto do desenho 3D — é o "entrar no
-- desenho e dizer onde fica" do pedido. Escreve no MESMO campo de texto que a
-- tela de entrada escreve, no formato com hífen (o do legado, maioria).
CREATE OR REPLACE FUNCTION public.sup_mapa_enderecar_item(
  p_item_estoque_id uuid,
  p_rua text,
  p_nivel int,
  p_coluna int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_end text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o estoque.' USING ERRCODE = '42501';
  END IF;

  IF p_rua IS NULL THEN
    -- Tirar o item do desenho = apagar o endereço, não gravar 'null'.
    v_end := NULL;
  ELSE
    IF upper(btrim(p_rua)) !~ '^[A-Z]$' THEN
      RAISE EXCEPTION 'Estante inválida.' USING ERRCODE = '22023';
    END IF;
    IF p_nivel IS NULL OR p_coluna IS NULL OR p_nivel < 1 OR p_coluna < 1 THEN
      RAISE EXCEPTION 'Nível e coluna começam em 1.' USING ERRCODE = '22023';
    END IF;
    v_end := upper(btrim(p_rua)) || '-' || lpad(p_nivel::text, 2, '0')
                                 || '-' || lpad(p_coluna::text, 2, '0');
  END IF;

  UPDATE public.sup_estoque_item
     SET localizacao = v_end
   WHERE id = p_item_estoque_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha de estoque não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('item_estoque_id', p_item_estoque_id, 'localizacao', v_end);
END;
$$;

REVOKE ALL ON FUNCTION public.sup_mapa_salvar_layout(jsonb)    FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_salvar_modulo(jsonb)    FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_excluir_modulo(uuid)    FROM public;
REVOKE ALL ON FUNCTION public.sup_mapa_enderecar_item(uuid, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.sup_mapa_salvar_layout(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_salvar_modulo(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_excluir_modulo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sup_mapa_enderecar_item(uuid, text, int, int) TO authenticated;

-- ---------------------------------------------------------------------
-- 7) O menu (+ a permissão, senão nasce aberto para todo autenticado)
-- ---------------------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.modulo_id, 'sup_estoque_mapa', 'Mapa 3D do Estoque',
       '/app/suprimentos/estoque-mapa', m.ordem + 1, true
  FROM public.app_menu m
 WHERE m.codigo = 'sup_estoque'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu a WHERE a.codigo = 'sup_estoque_mapa');

-- Quem já enxerga o estoque hoje passa a enxergar o mapa. Sem esta linha o
-- menu nasceria sem regra nenhuma — e menu sem regra é menu aberto.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sup_estoque_mapa', pp.acao, pp.allow
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'sup_estoque'
   AND pp.acao IN ('visualizar', 'alterar', 'excluir')
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- Quais switches a tela de Acesso por Usuário mostra para este menu.
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sup_estoque_mapa', 'alterar'),
       ('sup_estoque_mapa', 'excluir')
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ---------------------------------------------------------------------
-- 8) Seed — a planta desenhada, com as estantes já do tamanho dos dados
--
-- O contorno vem do croqui do Excalidraw: quatro estantes no perímetro
-- (topo, direita, baixo, esquerda), a ilha comprida logo abaixo do topo, e o
-- bloco central de duas faces. Sete blocos, sete letras A..G — as mesmas sete
-- que aparecem nos 747 endereços cadastrados.
--
-- Níveis e colunas saem do MAIOR endereço já usado em cada letra, com um piso
-- mínimo para a estante não nascer raquítica. Assim o desenho abre já cabendo
-- o que está cadastrado, em vez de abrir genérico e esconder metade.
-- ---------------------------------------------------------------------
DO $seed$
DECLARE
  v_almox  uuid;
  v_layout uuid;
  r        record;
BEGIN
  -- O almoxarifado que realmente tem estoque endereçado hoje.
  SELECT ei.almoxarifado_id INTO v_almox
    FROM public.sup_estoque_item ei
   WHERE ei.almoxarifado_id IS NOT NULL
     AND ei.arquivado_em IS NULL
   GROUP BY ei.almoxarifado_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF v_almox IS NULL THEN
    RAISE NOTICE 'Nenhum almoxarifado com estoque — seed do mapa 3D pulado.';
    RETURN;
  END IF;

  INSERT INTO public.sup_estoque_layout
    (almoxarifado_id, nome, largura_m, profundidade_m, pe_direito_m, mesa_x, mesa_z, mesa_rotacao)
  VALUES (v_almox, 'Planta principal', 12.0, 12.0, 3.10, 1.40, 10.60, 0)
  ON CONFLICT (almoxarifado_id) DO UPDATE SET nome = EXCLUDED.nome
  RETURNING id INTO v_layout;

  FOR r IN
    -- Convenção da posição (a mesma que o desenho usa em
    -- src/lib/suprimentos/enderecoEstoque.ts): pos_x/pos_z é o canto
    -- TRASEIRO-ESQUERDO do módulo no piso; a largura corre no +X local, a
    -- profundidade no +Z local, e a frente (onde ficam as plaquinhas) é a
    -- face +Z. rotacao_graus gira em torno desse canto. Com isso:
    --   0   = frente virada para a frente do salão
    --   90  = encostada na parede esquerda, olhando para dentro
    --   180 = frente virada para o fundo
    --   270 = encostada na parede direita, olhando para dentro
    WITH croqui(codigo, nome, pos_x, pos_z, rot, ordem, col_min, niv_min) AS (
      VALUES
        ('A', 'Estante A — parede do fundo',    2.00, 0.05,   0, 1, 15, 5),
        ('B', 'Estante B — parede direita',    11.95, 1.20, 270, 2, 12, 6),
        ('C', 'Estante C — parede da frente',   9.00,11.95, 180, 3, 13, 6),
        ('D', 'Estante D — parede esquerda',    0.05,10.50,  90, 4, 15, 5),
        ('E', 'Ilha E — corredor do fundo',     8.75, 2.90, 180, 5, 10, 6),
        ('F', 'Bloco central F — face fundo',   8.75, 5.60, 180, 6,  9, 6),
        ('G', 'Bloco central G — face frente',  4.70, 5.60,   0, 7,  9, 6)
    ),
    medido AS (
      SELECT loc.rua,
             max(loc.coluna) AS col_max,
             max(loc.nivel)  AS niv_max
        FROM public.sup_estoque_item ei
        CROSS JOIN LATERAL public.sup_loc_parse(ei.localizacao) AS loc
       WHERE ei.arquivado_em IS NULL
         AND loc.rua IS NOT NULL
       GROUP BY loc.rua
    )
    SELECT c.*,
           GREATEST(c.col_min, COALESCE(m.col_max, 0)) AS colunas,
           GREATEST(c.niv_min, COALESCE(m.niv_max, 0)) AS niveis
      FROM croqui c
      LEFT JOIN medido m ON m.rua = c.codigo
  LOOP
    INSERT INTO public.sup_estoque_modulo
      (layout_id, codigo, nome, pos_x, pos_z, rotacao_graus, colunas, niveis, ordem)
    VALUES
      (v_layout, r.codigo, r.nome, r.pos_x, r.pos_z, r.rot, r.colunas, r.niveis, r.ordem)
    ON CONFLICT (layout_id, codigo) DO NOTHING;
  END LOOP;

  -- Letras que existem nos endereços mas não no croqui — medindo em
  -- 21/09/2026: H (2 fichas), J (1) e Z (6), provavelmente prateleiras
  -- avulsas que ninguém desenhou. Elas nascem paradas na área livre da
  -- frente, fora do caminho e visivelmente "soltas", só para NÃO existir
  -- ficha endereçada sem lugar no desenho. Quem conhece o galpão arrasta
  -- para onde é de verdade — e o nome já avisa que falta fazer isso.
  FOR r IN
    SELECT loc.rua AS codigo,
           GREATEST(6, max(loc.coluna)) AS colunas,
           GREATEST(3, max(loc.nivel))  AS niveis,
           row_number() OVER (ORDER BY loc.rua) AS n
      FROM public.sup_estoque_item ei
      CROSS JOIN LATERAL public.sup_loc_parse(ei.localizacao) AS loc
     WHERE ei.arquivado_em IS NULL
       AND loc.rua IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.sup_estoque_modulo m
              WHERE m.layout_id = v_layout AND m.codigo = loc.rua)
     GROUP BY loc.rua
  LOOP
    INSERT INTO public.sup_estoque_modulo
      (layout_id, codigo, nome, pos_x, pos_z, rotacao_graus, colunas, niveis, ordem)
    VALUES
      (v_layout, r.codigo,
       'Estante ' || r.codigo || ' — posição a conferir',
       1.60, 7.40 + (r.n - 1) * 1.10, 0, r.colunas, r.niveis, 50 + r.n)
    ON CONFLICT (layout_id, codigo) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Mapa 3D semeado: layout % com % estantes.',
    v_layout, (SELECT count(*) FROM public.sup_estoque_modulo WHERE layout_id = v_layout);
END;
$seed$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Conferência (rodar depois de aplicar)
-- ---------------------------------------------------------------------
-- -- 1. O parser concorda com o que foi medido? (esperado: ~717 válidos de 747)
-- SELECT count(*) FILTER (WHERE endereco_valido) AS validos,
--        count(*) FILTER (WHERE NOT endereco_valido AND localizacao IS NOT NULL) AS sujos,
--        count(*) FILTER (WHERE localizacao IS NULL) AS sem_endereco
--   FROM public.v_sup_estoque_mapa;
--
-- -- 2. Os casos que motivaram o parser
-- SELECT * FROM public.sup_loc_parse('A-03-10');        -- (A,3,10)
-- SELECT * FROM public.sup_loc_parse('A4.14');          -- (A,4,14)
-- SELECT * FROM public.sup_loc_parse('G-04-05-06/02');  -- (G,4,5)
-- SELECT * FROM public.sup_loc_parse('0-00-00');        -- (,,)
-- SELECT * FROM public.sup_loc_parse('TESTE');          -- (,,)
--
-- -- 3. Endereço apontando para fora da estante desenhada (o pessoal ajusta na tela)
-- SELECT v.rua, v.nivel, v.coluna, count(*)
--   FROM public.v_sup_estoque_mapa v
--   LEFT JOIN public.sup_estoque_modulo m ON m.codigo = v.rua
--  WHERE v.endereco_valido
--    AND (m.id IS NULL OR v.nivel > m.niveis OR v.coluna > m.colunas)
--  GROUP BY 1,2,3 ORDER BY 1,2,3;

-- ROLLBACK
-- DROP VIEW IF EXISTS public.v_sup_estoque_mapa;
-- DROP FUNCTION IF EXISTS public.sup_mapa_enderecar_item(uuid, text, int, int);
-- DROP FUNCTION IF EXISTS public.sup_mapa_excluir_modulo(uuid);
-- DROP FUNCTION IF EXISTS public.sup_mapa_salvar_modulo(jsonb);
-- DROP FUNCTION IF EXISTS public.sup_mapa_salvar_layout(jsonb);
-- DROP TRIGGER IF EXISTS sup_estoque_modulo_touch ON public.sup_estoque_modulo;
-- DROP TRIGGER IF EXISTS sup_estoque_layout_touch ON public.sup_estoque_layout;
-- DROP FUNCTION IF EXISTS public.sup_mapa_touch();
-- DROP TABLE IF EXISTS public.sup_estoque_modulo;
-- DROP TABLE IF EXISTS public.sup_estoque_layout;
-- DROP FUNCTION IF EXISTS public.sup_loc_parse(text);
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sup_estoque_mapa';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_estoque_mapa';
-- DELETE FROM public.app_menu WHERE codigo = 'sup_estoque_mapa';
-- NOTIFY pgrst, 'reload schema';
