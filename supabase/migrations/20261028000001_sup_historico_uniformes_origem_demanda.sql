-- SIS-2026-0753 — Demanda de uniforme por origem para planejar mínimo/máximo
--
-- Um pedido de implantação/aditivo não mede a mesma necessidade de estoque que
-- uma troca de colaborador ou uma reposição. A leitura mensal existente já
-- separa item+tamanho; esta revisão adiciona a origem que foi informada na
-- solicitação, preservando a saída física como utilização confirmada.
--
-- `tipo_admissao = aditivo` é a única marca persistida para implantação ou
-- expansão de contrato. Admissão por substituição continua separada; pedidos
-- sem admissão são reposição. Não inferimos origem por contrato ou por volume.
--
-- ROLLBACK:
--   -- Recriar a versão de 20261023000540_sup_historico_uniformes.sql.

DROP FUNCTION IF EXISTS public.sup_historico_uniformes(uuid, date, date, uuid);

CREATE FUNCTION public.sup_historico_uniformes(
  p_empresa_id  uuid,
  p_inicio      date,
  p_fim         date,
  p_contrato_id uuid DEFAULT NULL
)
RETURNS TABLE (
  mes             date,
  origem_demanda  text,
  tipo_uniforme   text,
  tamanho         text,
  solicitados     integer,
  utilizados      integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o histórico de uniformes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  IF p_fim - p_inicio > 1827 THEN
    RAISE EXCEPTION 'O período máximo do histórico é de cinco anos.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
     WHERE pr.id = v_uid AND (pr.acessa_todas_empresas OR pr.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue
     WHERE ue.user_id = v_uid AND ue.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH solicitacoes AS (
    SELECT
      date_trunc('month', p.data_solicitacao::timestamp)::date AS mes,
      CASE
        WHEN p.admissao AND p.tipo_admissao = 'aditivo' THEN 'implantacao_aditivo'
        WHEN p.admissao THEN 'substituicao'
        ELSE 'reposicao'
      END::text AS origem_demanda,
      COALESCE(item_base.nome, pi.nome_item, 'Uniforme sem descrição')::text AS tipo_uniforme,
      NULLIF(btrim(pi.tamanho), '')::text AS tamanho,
      sum(pi.quantidade)::integer AS solicitados,
      0::integer AS utilizados
    FROM public.sup_pedido p
    JOIN public.sup_pedido_item pi ON pi.pedido_id = p.id
    LEFT JOIN public.sup_item item_pedido ON item_pedido.id = pi.item_id
    LEFT JOIN public.sup_item item_base ON item_base.id = COALESCE(item_pedido.item_pai_id, item_pedido.id)
    WHERE p.empresa_id = p_empresa_id
      AND p.data_solicitacao BETWEEN p_inicio AND p_fim
      AND p.status <> 'CANCELADO'
      AND COALESCE(item_pedido.tipo, pi.tipo_item) = 'uniforme'
      AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
    GROUP BY 1, 2, 3, 4
  ),
  utilizacoes AS (
    SELECT
      date_trunc('month', m.created_at)::date AS mes,
      CASE
        WHEN p.admissao AND p.tipo_admissao = 'aditivo' THEN 'implantacao_aditivo'
        WHEN p.admissao THEN 'substituicao'
        ELSE 'reposicao'
      END::text AS origem_demanda,
      COALESCE(item_base.nome, item.nome, 'Uniforme sem descrição')::text AS tipo_uniforme,
      NULLIF(btrim(public.sup_tamanho_da_variante(COALESCE(m.tamanho, item.tamanho))), '')::text AS tamanho,
      0::integer AS solicitados,
      sum(abs(m.quantidade))::integer AS utilizados
    FROM public.sup_estoque_movimento m
    JOIN public.sup_item item ON item.id = m.sup_item_id
    LEFT JOIN public.sup_item item_base ON item_base.id = COALESCE(item.item_pai_id, item.id)
    LEFT JOIN public.sup_pedido p ON p.id = m.pedido_id
    WHERE m.empresa_id = p_empresa_id
      AND m.created_at >= p_inicio::timestamptz
      AND m.created_at < (p_fim + 1)::timestamptz
      AND m.tipo = 'saida'
      AND item.tipo = 'uniforme'
      AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
    GROUP BY 1, 2, 3, 4
  ),
  movimentos AS (
    SELECT * FROM solicitacoes
    UNION ALL
    SELECT * FROM utilizacoes
  )
  SELECT
    m.mes,
    m.origem_demanda,
    m.tipo_uniforme,
    m.tamanho,
    sum(m.solicitados)::integer AS solicitados,
    sum(m.utilizados)::integer AS utilizados
  FROM movimentos m
  GROUP BY m.mes, m.origem_demanda, m.tipo_uniforme, m.tamanho
  ORDER BY m.mes DESC, m.origem_demanda, m.tipo_uniforme, public.sup_tamanho_ordem(m.tamanho);
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_historico_uniformes(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_historico_uniformes(uuid, date, date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
