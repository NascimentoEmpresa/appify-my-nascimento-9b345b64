-- =====================================================================
-- Catálogo: aprovar o enxoval libera o material, e a empresa deixa de
-- segurar rascunho na hora de enviar para aprovação.
--
-- Incidente de 14/09/2026: o lote do CEITEC LIMPEZA - 025/2026 foi
-- aprovado em /app/suprimentos/catalogo/aprovacoes, o Catálogo mostrava
-- "CAMISA MESCLA - CINZA GOLA LARANJA MC" e "CAMISA MESCLA GOLA AZUL" no
-- enxoval de SERVENTE DE LIMPEZA sem nenhuma marca de pendente, e o
-- encarregado em /app/encarregados/solicitar-materiais recebia "Esta função
-- ainda não tem materiais cadastrados".
--
-- Medido em produção no mesmo dia, para as duas camisas:
--     sup_funcao_item.aprovado = true   (o vínculo, aprovado no lote)
--     sup_item.aprovado        = false  (o material em si)
--     nenhuma linha em sup_cat_alteracao apontando para o material
--
-- sup_ext_itens() exige as DUAS flags. A etiqueta "pendente" do Catálogo
-- só olhava a do vínculo — por isso a tela dizia que estava tudo certo.
--
-- DE ONDE VEIO O MATERIAL SEM PROPOSTA
-- O ETL do sistema antigo (migracao-sistema-antigo/etl.mjs, 17/08/2026)
-- criou 304 materiais com aprovado = false "para o time de Compras revisar
-- na tela de Aprovações" (RESULTADO.md). Só que nenhuma proposta foi criada
-- para eles — as alterações do legado entraram com alvo_id NULL — então
-- não existia caminho na tela para aprová-los. O Suprimentos escolhia o
-- material na busca do "Adicionar material" (que lista aprovado ou não),
-- o lote aprovava o vínculo, e o material ficava invisível para sempre.
-- O mesmo buraco existe para qualquer material cuja proposta se perca:
-- criarItem grava o material e a proposta em duas chamadas separadas.
--
-- CORREÇÃO
--   1. sup_cat_decidir_lote: aprovar "incluir material no enxoval" aprova
--      também o material. É exatamente a decisão que o aprovador leu na
--      tela ("Incluir X no enxoval de Y") — não faz sentido aprovar o
--      vínculo e manter escondido o que ele vincula.
--   2. sup_cat_enviar_lote: envia TODOS os rascunhos, de qualquer empresa.
--      Desde 20260901000001 a RLS mostra rascunho de todas as empresas, e o
--      botão "Enviar para Aprovação (N)" conta todos — mas a RPC só levava
--      os da empresa ativa. O resto sobrava no rascunho sem ninguém ver por
--      que. Empresa é informação visual (decisão de 13/08/2026), não filtro.
--   3. Backfill: material pendente que JÁ está num enxoval aprovado e ativo
--      passa a aprovado. Fica de fora o material que tem proposta própria
--      em RASCUNHO/PENDENTE — esse espera a decisão do lote dele. Cada
--      material liberado ganha uma linha APROVADO em sup_cat_alteracao,
--      marcada com dados.origem = '20260930000097', para o rastro e para o
--      rollback. O resultado final do script é a lista do que foi liberado.
--
-- Não depende da 20260930000096 (postos da planilha + contrato de outra
-- empresa), mas as duas juntas é que fazem a cascata do encarregado
-- inteira ignorar a empresa. Aplicar a 096 antes desta.
--
-- ROLLBACK ao final do arquivo.
-- =====================================================================

-- ── 1. Aprovar o vínculo aprova o material ───────────────────────────
--
-- Resto da função idêntico a 20260819000001; muda só o ramo
-- APROVADO / criar / funcao_item e o search_path ganha pg_temp.
CREATE OR REPLACE FUNCTION public.sup_cat_decidir_lote(
  p_lote_id uuid, p_status text, p_comentario text DEFAULT NULL
) RETURNS public.sup_cat_lote
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_lote public.sup_cat_lote;
  r      record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_catalogo_aprovacao', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar catálogo';
  END IF;
  IF p_status NOT IN ('APROVADO','REPROVADO') THEN
    RAISE EXCEPTION 'Status inválido: %', p_status;
  END IF;

  SELECT * INTO v_lote FROM public.sup_cat_lote l WHERE l.id = p_lote_id FOR UPDATE;
  IF v_lote.id IS NULL THEN RAISE EXCEPTION 'Lote não encontrado'; END IF;
  -- Idempotência: decidir duas vezes é erro, não silêncio (legado §11.3).
  IF v_lote.status <> 'PENDENTE' THEN
    RAISE EXCEPTION 'Lote já foi decidido (status atual: %)', v_lote.status;
  END IF;

  FOR r IN
    SELECT a.tipo_entidade, a.tipo_acao, a.alvo_id
      FROM public.sup_cat_alteracao a
     WHERE a.lote_id = p_lote_id AND a.status = 'PENDENTE'
  LOOP
    IF p_status = 'APROVADO' THEN
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET aprovado = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN
            UPDATE public.sup_funcao_item SET aprovado = true WHERE id = r.alvo_id;
            -- O material vinculado vai junto. Sem isto, material sem
            -- proposta própria (os 304 do legado) ficava aprovado no
            -- enxoval e invisível no sup_ext_itens — incidente do CEITEC.
            UPDATE public.sup_item i
               SET aprovado = true
              FROM public.sup_funcao_item fi
             WHERE fi.id = r.alvo_id
               AND i.id = fi.item_id
               AND i.aprovado = false;
          ELSE NULL; -- 'opcoes' acompanha o item, não tem flag própria
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id;
          ELSE NULL;
        END CASE;
      END IF;
    ELSE -- REPROVADO
      IF r.tipo_acao = 'criar' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN DELETE FROM public.sup_posto       WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao'      THEN DELETE FROM public.sup_funcao      WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'item'        THEN DELETE FROM public.sup_item        WHERE id = r.alvo_id AND aprovado = false;
          WHEN 'funcao_item' THEN DELETE FROM public.sup_funcao_item WHERE id = r.alvo_id AND aprovado = false;
          ELSE NULL;
        END CASE;
      ELSIF r.tipo_acao = 'excluir' THEN
        CASE r.tipo_entidade
          WHEN 'posto'       THEN UPDATE public.sup_posto       SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao'      THEN UPDATE public.sup_funcao      SET ativo = true WHERE id = r.alvo_id;
          WHEN 'item'        THEN UPDATE public.sup_item        SET ativo = true WHERE id = r.alvo_id;
          WHEN 'funcao_item' THEN UPDATE public.sup_funcao_item SET ativo = true WHERE id = r.alvo_id;
          ELSE NULL;
        END CASE;
      END IF;
    END IF;
  END LOOP;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.sup_cat_alteracao a SET status = p_status WHERE a.lote_id = p_lote_id;
  UPDATE public.sup_cat_lote l
     SET status = p_status, comentario = p_comentario, decidido_por = v_uid,
         decidido_por_nome = v_nome, data_resposta = now()
   WHERE l.id = p_lote_id
  RETURNING * INTO v_lote;

  RETURN v_lote;
END $$;

-- ── 2. Enviar lote sem filtro de empresa ─────────────────────────────
--
-- Mesma assinatura (a tela continua mandando a empresa ativa), mas
-- p_empresa_id agora só vira o rótulo do lote — sup_cat_lote.empresa_id é
-- NOT NULL. Quem entra no lote é todo RASCUNHO, que é o que a tela conta.
--
-- O total sai do próprio UPDATE (ROW_COUNT), não de um count(*) anterior:
-- rascunho gravado entre as duas consultas entrava no lote sem entrar no
-- total.
CREATE OR REPLACE FUNCTION public.sup_cat_enviar_lote(p_empresa_id uuid)
RETURNS public.sup_cat_lote
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_nome    text;
  v_total   int;
  v_empresa uuid;
  v_lote    public.sup_cat_lote;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.can_access(v_uid, 'sup_catalogo', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para enviar alterações de catálogo';
  END IF;

  -- Rótulo: a empresa ativa de quem envia; sem ela, a do rascunho mais antigo.
  v_empresa := coalesce(p_empresa_id, (
    SELECT a.empresa_id FROM public.sup_cat_alteracao a
     WHERE a.status = 'RASCUNHO'
     ORDER BY a.created_at
     LIMIT 1));
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Nenhuma alteração em rascunho para enviar';
  END IF;

  SELECT p.display_name INTO v_nome FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.sup_cat_lote (empresa_id, codigo, total_alteracoes, criado_por, criado_por_nome)
  VALUES (v_empresa,
          'LOTE-' || to_char(now(), 'YYYYMMDDHH24MISS'),
          0, v_uid, v_nome)
  RETURNING * INTO v_lote;

  UPDATE public.sup_cat_alteracao a
     SET lote_id = v_lote.id, status = 'PENDENTE'
   WHERE a.status = 'RASCUNHO';
  GET DIAGNOSTICS v_total = ROW_COUNT;

  IF v_total = 0 THEN
    -- Desfaz o lote vazio junto (a exceção aborta a transação inteira).
    RAISE EXCEPTION 'Nenhuma alteração em rascunho para enviar';
  END IF;

  UPDATE public.sup_cat_lote l SET total_alteracoes = v_total
   WHERE l.id = v_lote.id
  RETURNING * INTO v_lote;

  RETURN v_lote;
END $$;

REVOKE EXECUTE ON FUNCTION public.sup_cat_enviar_lote(uuid)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sup_cat_enviar_lote(uuid)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.sup_cat_decidir_lote(uuid, text, text) TO authenticated;

-- ── 3. Backfill: material de enxoval já aprovado ─────────────────────
--
-- Alvo: material ativo e pendente, usado por ao menos um vínculo aprovado
-- e ativo, SEM proposta própria esperando decisão. A lista vai para uma
-- tabela temporária antes do UPDATE para o script devolver exatamente o
-- que liberou (é o resultado que aparece no SQL Editor).
DROP TABLE IF EXISTS pg_temp.sup_097_liberados;
CREATE TEMP TABLE sup_097_liberados AS
SELECT i.id, i.empresa_id, i.nome, i.tipo,
       count(DISTINCT fi.funcao_id) AS funcoes_com_enxoval_aprovado
  FROM public.sup_item i
  JOIN public.sup_funcao_item fi
    ON fi.item_id = i.id AND fi.aprovado AND fi.ativo
 WHERE NOT i.aprovado
   AND i.ativo
   AND NOT EXISTS (
     SELECT 1 FROM public.sup_cat_alteracao a
      WHERE a.alvo_id = i.id
        AND a.tipo_entidade = 'item'
        AND a.status IN ('RASCUNHO', 'PENDENTE'))
 GROUP BY i.id, i.empresa_id, i.nome, i.tipo;

UPDATE public.sup_item i
   SET aprovado = true
  FROM sup_097_liberados l
 WHERE i.id = l.id;

-- Rastro: o Catálogo e a Aprovação passam a enxergar por que o material
-- está aprovado sem nunca ter passado por um lote.
INSERT INTO public.sup_cat_alteracao
  (empresa_id, tipo_entidade, tipo_acao, alvo_id, dados, contexto, descricao,
   status, criado_por_nome)
SELECT l.empresa_id, 'item', 'criar', l.id,
       jsonb_build_object('origem', '20260930000097', 'nome', l.nome, 'tipo', l.tipo),
       jsonb_build_object('item', l.nome),
       'Material liberado junto com o enxoval já aprovado (correção de 14/09/2026)',
       'APROVADO', 'Sistema (migration 20260930000097)'
  FROM sup_097_liberados l;

NOTIFY pgrst, 'reload schema';

-- ── 4. Conferência: o que foi liberado ───────────────────────────────
SELECT l.nome AS material_liberado, l.tipo, l.funcoes_com_enxoval_aprovado
  FROM sup_097_liberados l
 ORDER BY l.nome;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Funções: recriar sup_cat_decidir_lote e sup_cat_enviar_lote como estão
-- em 20260819000001_supply_catalogo.sql, e então:
--
-- UPDATE public.sup_item i SET aprovado = false
--   FROM public.sup_cat_alteracao a
--  WHERE a.alvo_id = i.id
--    AND a.tipo_entidade = 'item'
--    AND a.dados->>'origem' = '20260930000097';
-- DELETE FROM public.sup_cat_alteracao a
--  WHERE a.dados->>'origem' = '20260930000097';
-- NOTIFY pgrst, 'reload schema';
--
-- Materiais que um lote aprovou DEPOIS desta migration pelo ramo novo do
-- funcao_item não têm marca e não voltam com o rollback — e não devem:
-- foram aprovados por uma pessoa na tela.
-- =====================================================================
