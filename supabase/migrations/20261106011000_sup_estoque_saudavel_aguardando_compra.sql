-- Cássio (06/11/2026): quantidade aguardando compra na prateleira saudável.
-- Fonte: malote_despesa.status + malote_despesa_item (nome/quantidade/tamanho).
-- Não é estoque nem recebimento futuro confirmado: não altera alvo, cobertura
-- ou compra sugerida. Pedidos enviados/recebidos saem desta contagem, mesmo
-- quando o Malote continua em cotacao_aprovada. Rascunho de PC ainda conta.
-- PC cancelado deixa a solicitação ativa voltar à fila de compra.
-- As pendências são atuais, independentemente da janela histórica de consumo.
-- Almoxarifado não existe na solicitação; segue o escopo de em_transito.
--
-- Costura na versão instalada para preservar os hotfixes de saldo/evolução.
-- Nenhuma permissão nova: mantém o gate de tela/empresa da RPC e seus grants.
-- ROLLBACK: restaurar a definição anterior de sup_estoque_saudavel; não há DML.

-- guardiao-ok: valida somente a definição da função, sem consultar dados de negócio; âncora ausente deve impedir uma alteração parcial da RPC.
DO $migration$
DECLARE
  v_def text;
  v_origem text;
  v_destino text;
BEGIN
  SELECT pg_get_functiondef(
    'public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position('malote_aguardando_compra AS (' IN v_def) > 0 THEN
    RAISE NOTICE 'sup_estoque_saudavel já expõe aguardando_compra.';
    RETURN;
  END IF;

  v_origem := '    em_transito AS (';
  v_destino := $trecho$
    -- Nome livre só pode resolver para UM material base da mesma empresa.
    -- O vínculo por id prevalece, inclusive se o catálogo foi renomeado.
    catalogo_nome_compra AS (
      SELECT lower(btrim(i.nome)) AS nome,
             (array_agg(i.id ORDER BY i.id))[1] AS base_id
        FROM public.sup_item i
       WHERE i.empresa_id = p_empresa_id AND i.item_pai_id IS NULL AND i.ativo
       GROUP BY lower(btrim(i.nome))
      HAVING count(*) = 1
    ),
    malote_aguardando_compra AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(mi.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(mi.quantidade)::numeric AS quantidade
        FROM public.malote_despesa d
        JOIN public.malote_despesa_item mi ON mi.despesa_id = d.id
        LEFT JOIN catalogo_nome_compra nome
          ON mi.sup_item_id IS NULL AND nome.nome = lower(btrim(mi.nome_item))
        JOIN public.sup_item i ON i.id = COALESCE(mi.sup_item_id, nome.base_id)
       WHERE d.empresa_id = p_empresa_id
         AND d.origem = 'solicitacao'
         AND d.deleted_at IS NULL
         AND d.status IN ('aguardando_cotacao', 'cotacao_realizada', 'cotacao_aprovada')
         AND (p_contrato_id IS NULL OR d.contrato_id = p_contrato_id)
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
         AND NOT EXISTS (
           SELECT 1 FROM public.sup_compra_pedido cp
            WHERE cp.despesa_id = d.id
              AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial', 'recebido')
         )
       GROUP BY 1, 2
    ),
    em_transito AS ($trecho$;
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora em_transito não encontrada em sup_estoque_saudavel.';
  END IF;
  v_def := replace(v_def, v_origem, v_destino);

  v_origem := '      UNION SELECT base_id, tamanho FROM em_transito WHERE base_id IS NOT NULL';
  v_destino := v_origem || E'\n' ||
    '      UNION SELECT base_id, tamanho FROM malote_aguardando_compra WHERE base_id IS NOT NULL';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora de chaves não encontrada em sup_estoque_saudavel.';
  END IF;
  v_def := replace(v_def, v_origem, v_destino);

  v_origem := '             COALESCE(tr.quantidade, 0) AS em_transito,';
  v_destino := v_origem || E'\n' ||
    '             COALESCE(mc.quantidade, 0) AS aguardando_compra,';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora de quantidade não encontrada em sup_estoque_saudavel.';
  END IF;
  v_def := replace(v_def, v_origem, v_destino);

  v_origem := '        LEFT JOIN em_transito tr  ON tr.base_id = k.base_id AND tr.tamanho IS NOT DISTINCT FROM k.tamanho';
  v_destino := v_origem || E'\n' ||
    '        LEFT JOIN malote_aguardando_compra mc ON mc.base_id = k.base_id AND mc.tamanho IS NOT DISTINCT FROM k.tamanho';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora de junção não encontrada em sup_estoque_saudavel.';
  END IF;
  v_def := replace(v_def, v_origem, v_destino);

  -- Segundo jsonb_build_object: o primeiro já está perto de 100 argumentos.
  v_origem := '''cobertura_dias'', cobertura_dias, ''meses_sem_giro'', meses_sem_giro,';
  v_destino := v_origem || E'\n' || '                 ''aguardando_compra'', aguardando_compra,';
  IF position(v_origem IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora do JSON não encontrada em sup_estoque_saudavel.';
  END IF;
  v_def := replace(v_def, v_origem, v_destino);

  EXECUTE v_def;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
