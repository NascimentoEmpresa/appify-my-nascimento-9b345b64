-- =====================================================================
-- Catálogo de Materiais: Contrato e Posto passam a ser DERIVADOS.
--
-- Contexto: a cascata Contrato -> Posto -> Funcao -> Enxoval nasceu com os
-- quatro níveis editáveis na própria tela. Na prática, os dois primeiros
-- níveis não são cadastro do Suprimentos:
--
--   * Contrato -- nasce em Licitações (public.contratos). A tela já só lia,
--                 nunca escrevia; nada muda no banco por causa dele.
--   * Posto    -- nasce na Planilha de Custo (public.planilha_custo.posto),
--                 que é a fonte oficial de qual posto existe em cada
--                 contrato. Cadastrar posto à mão aqui criava um segundo
--                 lugar da verdade: o Suprimentos enxergava posto que a
--                 planilha não tem, e vice-versa.
--
-- Depois desta migration, quem cria/edita/exclui posto é a Planilha de
-- Custo -- e só ela. Função e enxoval continuam editáveis na tela e
-- continuam passando pelo lote de aprovação (sup_cat_enviar_lote /
-- sup_cat_decidir_lote), inalterados.
--
-- Por que sup_posto CONTINUA existindo, em vez de a cascata ler
-- planilha_custo direto: sup_posto.id é FK de sup_funcao, sup_pedido,
-- sup_patrimonio, operacional_diaria e admissao_uniforme_epi. Trocar isso
-- por texto livre da planilha quebraria seis módulos. Então sup_posto passa
-- a ser um ESPELHO da planilha, sincronizado sob demanda.
--
-- ROLLBACK ao final do arquivo.
-- =====================================================================

-- ── 1. sup_posto vira somente-leitura para a tela ────────────────────
--
-- Basta remover a policy de escrita: sem policy de INSERT/UPDATE/DELETE,
-- a role `authenticated` não escreve. As RPCs que legitimamente mexem em
-- sup_posto (sup_cat_decidir_lote, e a sincronização abaixo) são
-- SECURITY DEFINER e por isso não passam por RLS -- continuam funcionando
-- sem alteração nenhuma. A policy de leitura fica como está.
DROP POLICY IF EXISTS sup_posto_write ON public.sup_posto;

-- ── 2. Sincronização Planilha de Custo -> sup_posto ──────────────────
--
-- Chamada pela tela ao selecionar um contrato: sincroniza e devolve a
-- lista, num único round-trip.
--
-- Três passos, nesta ordem:
--   (a) insere posto que a planilha tem e a cascata não;
--   (b) reativa posto que voltou à planilha depois de ter sido desativado;
--   (c) desativa posto que a planilha NÃO tem -- mas SÓ se ele não tiver
--       nenhuma função ativa pendurada.
--
-- O (c) é deliberadamente covarde. Desativar posto com função ativa
-- levaria embora enxoval já aprovado e deixaria sup_pedido apontando para
-- posto invisível. Posto fora da planilha COM função continua na lista, e
-- volta marcado com na_planilha = false para a tela poder avisar; quem
-- quiser removê-lo tira as funções primeiro. Além disso, (c) só roda
-- quando a planilha tem alguma linha para o contrato: contrato cuja
-- planilha ainda não foi importada não pode ter a coluna Posto esvaziada.
--
-- Posto derivado nasce aprovado = true. Não existe etapa de aprovação para
-- ele -- o que se aprovou foi a Planilha de Custo, lá atrás. Sem isto o
-- posto ficaria invisível para o encarregado, porque as RPCs sup_ext_*
-- filtram aprovado = true.
CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (
  id          uuid,
  contrato_id uuid,
  nome        text,
  ativo       boolean,
  aprovado    boolean,
  na_planilha boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- Os parâmetros de saída do RETURNS TABLE (id, nome, ativo, aprovado) têm o
-- mesmo nome de colunas de sup_posto que aparecem no INSERT e no ON CONFLICT
-- abaixo. Sem este pragma, plpgsql pode resolver o nome para a variável e
-- recusar a instrução por ambiguidade. Nenhuma dessas variáveis é lida aqui
-- (a devolução é por RETURN QUERY), então preferir a coluna é sempre o certo.
#variable_conflict use_column
DECLARE
  v_empresa   uuid;
  v_contrato  text;
  v_nomes     text[];   -- nomes de posto como a planilha escreveu
  v_norm      text[];   -- os mesmos, normalizados, para casar sem acento/caixa
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_catalogo', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  -- Os postos que a planilha declara para este contrato.
  --
  -- O casamento aceita contrato_id OU nome porque planilha_custo.contrato_id
  -- foi preenchido por um UPDATE de uma vez (20260714000002) e não há
  -- trigger que o mantenha: linha importada depois disso pode ter o FK
  -- nulo e só o nome do contrato em texto.
  SELECT array_agg(p.nome), array_agg(public.sup_norm_nome(p.nome))
    INTO v_nomes, v_norm
    FROM (
      SELECT DISTINCT btrim(pc.posto) AS nome
        FROM public.planilha_custo pc
       WHERE btrim(coalesce(pc.posto, '')) <> ''
         AND (pc.contrato_id = p_contrato_id
              OR (pc.contrato_id IS NULL
                  AND pc.empresa_id = v_empresa
                  AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
    ) p;

  v_nomes := coalesce(v_nomes, ARRAY[]::text[]);
  v_norm  := coalesce(v_norm,  ARRAY[]::text[]);

  -- (a) novos
  INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado)
  SELECT v_empresa, p_contrato_id, n, true, true
    FROM unnest(v_nomes) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_posto sp
      WHERE sp.contrato_id = p_contrato_id
        AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(n))
  ON CONFLICT (contrato_id, nome) DO NOTHING;

  -- (b) reativados
  UPDATE public.sup_posto sp
     SET ativo = true, aprovado = true, updated_at = now()
   WHERE sp.contrato_id = p_contrato_id
     AND (sp.ativo IS FALSE OR sp.aprovado IS FALSE)
     AND public.sup_norm_nome(sp.nome) = ANY (v_norm);

  -- (c) saiu da planilha e não tem função -- sai da lista
  IF array_length(v_norm, 1) > 0 THEN
    UPDATE public.sup_posto sp
       SET ativo = false, updated_at = now()
     WHERE sp.contrato_id = p_contrato_id
       AND sp.ativo
       AND NOT (public.sup_norm_nome(sp.nome) = ANY (v_norm))
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_funcao f
          WHERE f.posto_id = sp.id AND f.ativo);
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.contrato_id, sp.nome, sp.ativo, sp.aprovado,
         (public.sup_norm_nome(sp.nome) = ANY (v_norm)) AS na_planilha
    FROM public.sup_posto sp
   WHERE sp.contrato_id = p_contrato_id
     AND sp.ativo
   ORDER BY sp.nome;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_cat_postos_do_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_cat_postos_do_contrato(uuid) TO authenticated;

-- ── 3. Limpa o que a regra antiga deixou pendurado ───────────────────
--
-- Rascunho ainda não enviado (lote_id IS NULL) de criar/editar/excluir
-- POSTO não tem mais como ser revisto pela tela -- a tela não oferece mais
-- a ação. Deixá-lo em RASCUNHO travaria o contador "Enviar para Aprovação
-- (N)" num número que o usuário não consegue zerar.
--
-- Alteração de posto que JÁ está em lote enviado (lote_id NOT NULL) fica
-- intocada: aquele lote é decisão de alguém e sup_cat_decidir_lote continua
-- sabendo aplicá-la.
DELETE FROM public.sup_cat_alteracao
 WHERE tipo_entidade = 'posto'
   AND status = 'RASCUNHO'
   AND lote_id IS NULL;

-- Posto já existente que a planilha confirma passa a valer sem esperar
-- aprovação -- senão ficaria pendente para sempre, porque o caminho de
-- aprovação dele deixou de existir.
UPDATE public.sup_posto sp
   SET aprovado = true, updated_at = now()
 WHERE sp.aprovado IS FALSE
   AND EXISTS (
     SELECT 1
       FROM public.contratos c
       JOIN public.planilha_custo pc
         ON (pc.contrato_id = c.id
             OR (pc.contrato_id IS NULL
                 AND pc.empresa_id = c.empresa_id
                 AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(c.nome)))
      WHERE c.id = sp.contrato_id
        AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(sp.nome));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.sup_cat_postos_do_contrato(uuid);
--
-- DROP POLICY IF EXISTS sup_posto_write ON public.sup_posto;
-- CREATE POLICY sup_posto_write ON public.sup_posto FOR ALL TO authenticated
--   USING (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'))
--   WITH CHECK (public.can_access(auth.uid(), 'sup_catalogo', 'alterar'));
--
-- NOTIFY pgrst, 'reload schema';
--
-- Os DELETE/UPDATE de dados do passo 3 não têm rollback: rascunho apagado
-- não volta, e `aprovado = false` não se recupera sem saber quais linhas
-- foram tocadas. Faça backup de sup_cat_alteracao e sup_posto antes se
-- quiser essa garantia.
