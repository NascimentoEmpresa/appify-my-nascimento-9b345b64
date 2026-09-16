-- =====================================================================
-- ESTOQUE — "não é tamanho, é material próprio"
--
-- PEDIDO (16/09/2026, tela /app/suprimentos/estoque-etiquetas)
--   "Preencho todas as informações de um novo item e o botão de dar entrada
--    continua indisponível; ele só fica disponível se eu clicar num item que
--    já existe no estoque. Às vezes precisamos criar um item que não existe."
--
-- O QUE ESTAVA ACONTECENDO
--   Desde a 20260930000163, sup_est_criar_material recusa nome que pareça
--   "BASE + TAMANHO": "JAQUETA M" com "JAQUETA" no catálogo é o tamanho M
--   dela, e cadastrar à parte criaria o item solto que aquela migration veio
--   acabar. A regra está certa para grade de uniforme e continua valendo.
--
--   O problema é o alcance dela. A checagem aceita QUALQUER palavra como
--   tamanho (sup_tamanho_da_variante só recusa a lista do "sem tamanho":
--   X, U, UN, UNICO, -). Então todo material legítimo de duas palavras cujo
--   primeiro pedaço exista no catálogo cai na recusa:
--
--     "TESTE EDUARDO"  → tamanho EDUARDO de "TESTE"     (o caso relatado)
--     "ALCOOL GEL"     → tamanho GEL     de "ALCOOL"
--     "CANETA AZUL"    → tamanho AZUL    de "CANETA"
--
--   E não havia saída: a tela oferecia só "use o material base com o tamanho
--   X", e o banco recusaria de qualquer jeito quem insistisse.
--
-- COMO FICA
--   A recusa continua sendo o padrão — é ela que segura o erro honesto de
--   digitar "JAQUETA M" na entrada. Mas passa a ser contornável por um
--   parâmetro explícito, p_forcar, que a tela só manda depois de mostrar a
--   sugestão do tamanho e a pessoa dizer que não é tamanho. Não é um bypass
--   silencioso: sem p_forcar, o comportamento é exatamente o de hoje.
--
-- POR QUE DROP, E NÃO SÓ UM CREATE OR REPLACE COM O PARÂMETRO A MAIS
--   Um parâmetro novo muda a assinatura, então o CREATE sozinho não
--   substituiria nada: deixaria DUAS funções vivas, cada uma com a sua cópia
--   da regra. Pior que a duplicação, a de 3 argumentos passaria a ser
--   ambígua — com f(a,b,c) e f(a,b,c,d DEFAULT) no mesmo nome, o Postgres
--   recusa a chamada de 3 com "function is not unique".
--
-- ISTO NÃO QUEBRA O FRONT QUE JÁ ESTÁ NO AR
--   A migration se aplica à mão no SQL Editor e o front novo sobe pelo
--   merge, então existe uma janela em que o site em produção ainda manda só
--   os 3 argumentos de sempre. Funciona: o PostgREST chama por parâmetro
--   NOMEADO, e p_forcar tem DEFAULT — a chamada antiga cai na função nova
--   com forcar = false, que é exatamente o comportamento de hoje.
--
-- ROLLBACK ao final do arquivo.
-- =====================================================================

DROP FUNCTION IF EXISTS public.sup_est_criar_material(uuid, text, text);

-- Corpo idêntico ao de 20260930000163:373; muda SÓ o parâmetro novo e o
-- `IF NOT p_forcar` no bloco da variante.
CREATE OR REPLACE FUNCTION public.sup_est_criar_material(
  p_almoxarifado_id uuid, p_nome text, p_tipo text, p_forcar boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text := upper(regexp_replace(btrim(COALESCE(p_nome, '')), '\s+', ' ', 'g'));
  v_tipo    text := lower(btrim(COALESCE(p_tipo, '')));
  v_empresa uuid;
  v_ex      record;
  v_base    record;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_estoque', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para dar entrada no estoque';
  END IF;
  IF length(v_nome) < 2 THEN RAISE EXCEPTION 'Informe o nome do material'; END IF;
  -- A mesma lista de sup_est_editar_item (20260930000161) e do CHECK
  -- sup_item_tipo_check (20260930000013).
  IF v_tipo NOT IN ('uniforme', 'epi', 'insumo', 'equipamento', 'limpeza') THEN
    RAISE EXCEPTION 'Escolha o tipo do material';
  END IF;

  -- A empresa do material é a do almoxarifado: sup_est_entrada_quantidade
  -- recusa material de outra empresa.
  SELECT a.empresa_id INTO v_empresa FROM public.almoxarifado a WHERE a.id = p_almoxarifado_id;
  IF v_empresa IS NULL THEN RAISE EXCEPTION 'Almoxarifado não encontrado'; END IF;

  -- Nome já existente devolve o existente, forçado ou não: "cadastrar mesmo
  -- assim" resolve a confusão com TAMANHO, nunca autoriza material duplicado.
  SELECT i.id, i.codigo, i.nome, i.ativo INTO v_ex
    FROM public.sup_item i
   WHERE i.empresa_id = v_empresa
     AND upper(regexp_replace(btrim(i.nome), '\s+', ' ', 'g')) = v_nome
   ORDER BY i.ativo DESC
   LIMIT 1;
  IF v_ex.id IS NOT NULL THEN
    IF NOT v_ex.ativo THEN
      RAISE EXCEPTION 'Já existe um material chamado % (código %), desativado no Catálogo. Reative-o lá em vez de cadastrar de novo.',
        v_ex.nome, COALESCE(v_ex.codigo, '—');
    END IF;
    RETURN jsonb_build_object('id', v_ex.id, 'codigo', v_ex.codigo, 'nome', v_ex.nome, 'criado', false);
  END IF;

  -- Base mais comprido primeiro: "CAMISA POLO G" é tamanho G de
  -- "CAMISA POLO", não tamanho "POLO G" de "CAMISA". Tamanho é uma palavra
  -- só, pela mesma razão.
  --
  -- EDIÇÃO 0164: a consulta só é feita quando NÃO é forçado. Forçado, o
  -- nome segue direto para o INSERT como material próprio — a pessoa já viu
  -- na tela "é o tamanho X de Y" e respondeu que não é.
  IF NOT COALESCE(p_forcar, false) THEN
    SELECT b.nome, substr(v_nome, length(b.nome) + 2) AS tam INTO v_base
      FROM public.sup_item b
     WHERE b.empresa_id = v_empresa AND b.ativo AND b.item_pai_id IS NULL
       AND left(v_nome, length(b.nome) + 1) = b.nome || ' '
       AND position(' ' IN substr(v_nome, length(b.nome) + 2)) = 0
       AND public.sup_tamanho_da_variante(substr(v_nome, length(b.nome) + 2)) IS NOT NULL
     ORDER BY length(b.nome) DESC
     LIMIT 1;
    IF v_base.nome IS NOT NULL THEN
      RAISE EXCEPTION '"%" é o tamanho % de "%". Escolha "%" na lista e informe o tamanho %.',
        v_nome, v_base.tam, v_base.nome, v_base.nome, v_base.tam;
    END IF;
  END IF;

  INSERT INTO public.sup_item (empresa_id, nome, tipo, ativo, aprovado, created_by)
  VALUES (v_empresa, v_nome, v_tipo, true, false, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'codigo', (SELECT i.codigo FROM public.sup_item i WHERE i.id = v_id),
    'nome', v_nome,
    'criado', true);
END
$fn$;

REVOKE ALL ON FUNCTION public.sup_est_criar_material(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_est_criar_material(uuid, text, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.sup_est_criar_material(uuid, text, text, boolean);
--   -- e recriar a versão de 3 argumentos, corpo de
--   -- 20260930000163_sup_item_codigo_por_tamanho.sql:373-442, seguida de:
--   -- REVOKE ALL ON FUNCTION public.sup_est_criar_material(uuid, text, text) FROM PUBLIC, anon;
--   -- GRANT EXECUTE ON FUNCTION public.sup_est_criar_material(uuid, text, text) TO authenticated;
--   NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────
