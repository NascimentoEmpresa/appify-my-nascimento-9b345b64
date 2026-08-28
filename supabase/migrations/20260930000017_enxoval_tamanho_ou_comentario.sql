-- =========================================================================
-- Tamanho obrigatório: da lista OU escrito pelo colaborador
--
-- PEDIDO DO CASSIO (ajuste 10 da revisão de 27/08/2026)
-- "Formulário de admissão ser obrigatório que tamanho seja pela lista suspensa
-- ou comentário do colaborador. E que o formulário só apareça itens daquele
-- contrato → posto → função."
--
-- A SEGUNDA PARTE JÁ ESTAVA FEITA
-- `sup_adm_gerar_enxoval` recusa função que não pertence ao posto e posto que
-- não pertence ao contrato, e monta a lista a partir de `sup_funcao_item` —
-- ou seja, só o enxoval daquela função. A cascata não é da tela, é do banco.
--
-- O QUE FALTAVA
-- Item sem grade de tamanho cadastrada mostrava "este item não exige escolha
-- de tamanho" e seguia em branco. Na prática esse é justamente o caso em que o
-- tamanho importa e ninguém sabe: bota que só tem numeração do fabricante,
-- luva que veio sem grade no catálogo, item novo. O formulário aceitava vazio
-- e o problema aparecia no dia da entrega.
--
-- Agora, quando não há grade, o colaborador ESCREVE o tamanho. Continua
-- obrigatório — muda só a forma de responder.
--
-- POR QUE UMA COLUNA SEPARADA E NÃO REUSAR `tamanho`
-- Gravar texto livre em `tamanho` misturaria "M" (que casa com a grade do
-- estoque e vira etiqueta) com "calço 44, mas na régua da empresa acho que é
-- 43" (que é recado para o almoxarife). Quem separa as peças precisa saber a
-- diferença.
--
-- Idempotente.
-- ROLLBACK:
--   ALTER TABLE public.sup_admissao_enxoval_item DROP COLUMN IF EXISTS tamanho_informado;
-- =========================================================================

ALTER TABLE public.sup_admissao_enxoval_item
  ADD COLUMN IF NOT EXISTS tamanho_informado text;

COMMENT ON COLUMN public.sup_admissao_enxoval_item.tamanho_informado IS
  'Tamanho escrito pelo colaborador quando o item nao tem grade cadastrada. Texto livre, nao casa com a grade do estoque — e recado para quem separa, nao valor de etiqueta.';

-- ── Duas funções à parte, em vez de reescrever a RPC pública ─────────────
--
-- `sup_adm_enxoval_responder` tem ~90 linhas e trata link inválido, expirado,
-- já usado, foto do crachá e duas validações de tamanho. Reescrevê-la inteira
-- para acrescentar uma coluna é o tipo de mudança em que se perde uma guarda
-- sem perceber — e ela é a porta pública, sem login.
--
-- Em vez disso, a RPC continua gravando `tamanho` como sempre, e uma função
-- separada valida a regra nova. A tela chama as duas.
--
-- ATÉ ONDE A OBRIGATORIEDADE É GARANTIDA
-- Para item COM grade, quem exige é o banco: `sup_adm_enxoval_responder` já
-- recusa tamanho vazio. Para item SEM grade, quem exige é a tela
-- (`enxovalCompleto` em src/lib/suprimentos/admissao.ts) — o banco aceita
-- vazio, como sempre aceitou.
--
-- Isso é deliberado. Impor no banco significaria reescrever aquela RPC de ~90
-- linhas, que é a porta pública sem login, ou barrar em
-- `sup_adm_criar_pedido` — e barrar ali criaria um beco: o candidato já teria
-- enviado e usado o token, e o Suprimentos ficaria travado sem nenhuma forma
-- de destravar pela interface.
--
-- Na prática a página pública é o único cliente e o token é a credencial. E o
-- comportamento anterior aceitava vazio de qualquer forma: isto melhora, não
-- afrouxa nada.

/**
 * O item está respondido?
 *
 * COM grade → escolher da lista continua obrigatório, e o texto é um extra.
 * SEM grade → escrever é obrigatório, porque não há o que escolher.
 *
 * A primeira regra não é preguiça: `sup_adm_enxoval_responder` — a RPC pública
 * que recebe a resposta — já exige `tamanho` em todo item com grade. Se aqui
 * eu aceitasse texto no lugar da escolha, a tela deixaria enviar e o banco
 * recusaria depois, com uma mensagem que não explicaria nada ao candidato.
 *
 * E há uma razão de negócio: valor escolhido da grade casa com o estoque e
 * vira etiqueta; texto livre é recado para quem separa. Trocar um pelo outro
 * transformaria "M" em algo que o almoxarife precisa interpretar.
 */
CREATE OR REPLACE FUNCTION public.sup_adm_enxoval_item_valido(
  p_tem_grade         boolean,
  p_tamanho           text,
  p_tamanho_informado text
)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_tem_grade THEN coalesce(btrim(p_tamanho), '') <> ''
    ELSE coalesce(btrim(p_tamanho_informado), '') <> ''
  END;
$fn$;

/**
 * Grava o tamanho escrito. Chamada pela página pública junto com a resposta.
 *
 * Separada da RPC principal de propósito (ver a nota acima). O token continua
 * sendo a credencial: sem login, quem tem o link é o candidato.
 */
CREATE OR REPLACE FUNCTION public.sup_adm_enxoval_tamanhos_escritos(
  p_token text,
  p_itens jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_enxoval_id uuid;
  v_qtd        integer := 0;
BEGIN
  SELECT id INTO v_enxoval_id
    FROM public.sup_admissao_enxoval
   WHERE token = btrim(p_token) AND preenchido_em IS NULL;

  IF v_enxoval_id IS NULL THEN
    RAISE EXCEPTION 'Link inválido ou já utilizado';
  END IF;

  WITH escolhas AS (
    SELECT (e->>'id')::uuid AS item_id,
           NULLIF(btrim(e->>'tamanho_informado'), '') AS texto
      FROM jsonb_array_elements(COALESCE(p_itens, '[]'::jsonb)) e
     WHERE NULLIF(btrim(e->>'tamanho_informado'), '') IS NOT NULL
  ),
  gravadas AS (
    UPDATE public.sup_admissao_enxoval_item ai
       SET tamanho_informado = left(x.texto, 120)
      FROM escolhas x
     WHERE ai.id = x.item_id AND ai.enxoval_id = v_enxoval_id
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_qtd FROM gravadas;

  RETURN v_qtd;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_adm_enxoval_item_valido(boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_adm_enxoval_item_valido(boolean, text, text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.sup_adm_enxoval_tamanhos_escritos(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_adm_enxoval_tamanhos_escritos(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── O tamanho escrito precisa CHEGAR ao almoxarife ───────────────────────
--
-- Sem esta parte o ajuste seria meio feito: o candidato escreveria "42", o
-- texto ficaria guardado em `sup_admissao_enxoval_item`, e o pedido de
-- materiais nasceria com tamanho vazio — exatamente o problema que o Cassio
-- relatou, só que uma tela adiante.
--
-- `sup_adm_criar_pedido` monta o payload com `'tamanho', ai.tamanho`, que é
-- NULL justamente nos itens sem grade. Duas mudanças, e só duas:
--
--   1. Item SEM grade → o texto escrito vira o tamanho do item do pedido.
--      Ali `sup_pedido_item.tamanho` já é texto livre: não há grade para
--      casar, e é o campo que o separador lê. Item COM grade não muda —
--      `ai.tamanho` está preenchido e o COALESCE nem chega no segundo termo.
--
--   2. Observação escrita em item COM grade → vai para as observações do
--      pedido, com o nome do item na frente. `sup_pedido_item` não tem coluna
--      de observação, e inventar uma para isso seria desproporcional; jogar o
--      texto dentro de `tamanho` seria pior, porque contaminaria o valor que
--      casa com o estoque e vira etiqueta.
--
-- O resto da função continua igual, incluindo as três guardas (permissão,
-- pedido já gerado, tamanhos ainda não informados) e o FOR UPDATE.
--
-- ROLLBACK: recriar a função pela definição de 20260928000001.

CREATE OR REPLACE FUNCTION public.sup_adm_criar_pedido(p_enxoval_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_enxoval    public.sup_admissao_enxoval;
  v_candidato  record;
  v_itens      jsonb;
  v_observacao text;
  v_payload    jsonb;
  v_pedido_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_epis_admissao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para gerar o pedido de materiais';
  END IF;

  SELECT * INTO v_enxoval
    FROM public.sup_admissao_enxoval e
   WHERE e.id = p_enxoval_id
   FOR UPDATE;
  IF v_enxoval.id IS NULL THEN RAISE EXCEPTION 'Enxoval não encontrado'; END IF;
  IF v_enxoval.pedido_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este candidato já tem pedido de materiais';
  END IF;
  IF v_enxoval.preenchido_em IS NULL THEN
    RAISE EXCEPTION 'O candidato ainda não informou os tamanhos';
  END IF;

  SELECT c.nome, c.empregado_id INTO v_candidato
    FROM public."WA_CURRICULOS" c WHERE c.id = v_enxoval.candidato_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'item_id', ai.sup_item_id,
      -- (1) o escrito só entra onde não havia grade
      'tamanho', COALESCE(
        NULLIF(btrim(ai.tamanho), ''),
        NULLIF(btrim(ai.tamanho_informado), '')
      ),
      'quantidade', ai.quantidade
    ) ORDER BY ai.ordem, ai.id
  ), '[]'::jsonb)
  INTO v_itens
  FROM public.sup_admissao_enxoval_item ai
  WHERE ai.enxoval_id = v_enxoval.id;

  -- (2) observação de item que JÁ tinha tamanho escolhido
  SELECT string_agg(
           ai.nome_item || ': ' || btrim(ai.tamanho_informado),
           E'\n' ORDER BY ai.ordem, ai.id
         )
    INTO v_observacao
    FROM public.sup_admissao_enxoval_item ai
   WHERE ai.enxoval_id = v_enxoval.id
     AND NULLIF(btrim(ai.tamanho), '')           IS NOT NULL
     AND NULLIF(btrim(ai.tamanho_informado), '') IS NOT NULL;

  IF v_observacao IS NOT NULL THEN
    v_observacao := concat_ws(
      E'\n',
      NULLIF(btrim(coalesce(v_enxoval.observacoes, '')), ''),
      'Observações do colaborador sobre os tamanhos:',
      v_observacao
    );
  ELSE
    v_observacao := v_enxoval.observacoes;
  END IF;

  v_payload := jsonb_build_object(
    'contrato_id', v_enxoval.contrato_id,
    'posto_id', v_enxoval.posto_id,
    'funcao_id', v_enxoval.funcao_id,
    'tipo_pedido', 'ambos',
    'admissao', true,
    'nome_colaborador', v_candidato.nome,
    'colaborador_empregado_id', v_candidato.empregado_id,
    'imagem_cracha_path', v_enxoval.foto_cracha_path,
    'observacoes_solicitante', v_observacao,
    'itens', v_itens
  );

  -- A criação e os itens permanecem centralizados na RPC oficial do pedido.
  SELECT (public.sup_ext_criar_pedido(v_payload)).id INTO v_pedido_id;

  UPDATE public.sup_admissao_enxoval
     SET pedido_id = v_pedido_id
   WHERE id = v_enxoval.id;

  RETURN v_pedido_id;
END $$;

NOTIFY pgrst, 'reload schema';
