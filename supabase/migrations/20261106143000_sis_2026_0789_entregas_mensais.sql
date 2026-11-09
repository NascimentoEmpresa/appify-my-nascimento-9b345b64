-- SIS-2026-0789: pedidos recebidos e despachados são populações independentes.
-- Reutiliza o acesso do dashboard, sem conceder novas permissões.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.sup_dashboard_entregas_mensais(
  p_mes date, p_empresa_id uuid DEFAULT NULL, p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inicio date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_screen_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o dashboard.' USING ERRCODE = '42501';
  END IF;
  IF p_mes IS NULL THEN
    RAISE EXCEPTION 'Informe o mês.' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH base AS (
      SELECT p.id, p.contrato_id,
        COALESCE(ct.nome, NULLIF(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato,
        p.admissao, p.envio_tipo,
        p.data_solicitacao >= v_inicio AND p.data_solicitacao < v_fim AS recebido,
        p.data_despachado >= (v_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND p.data_despachado < (v_fim::timestamp AT TIME ZONE 'America/Sao_Paulo') AS despachado
      FROM public.sup_pedido p
      LEFT JOIN public.contratos ct ON ct.id = p.contrato_id
      WHERE (p_empresa_id IS NULL OR p.empresa_id = p_empresa_id)
        AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
        AND ((p.data_solicitacao >= v_inicio AND p.data_solicitacao < v_fim)
          OR (p.data_despachado >= (v_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
            AND p.data_despachado < (v_fim::timestamp AT TIME ZONE 'America/Sao_Paulo')))
        AND (p_categoria IS NULL OR EXISTS (
          SELECT 1 FROM public.sup_pedido_item pi
          LEFT JOIN public.sup_item i ON i.id = pi.item_id
          WHERE pi.pedido_id = p.id AND COALESCE(i.tipo, pi.tipo_item) = p_categoria
        ))
    ), cotacoes AS (
      -- Uma declaração por pedido: revisões não multiplicam o frete.
      SELECT b.*, d.frete_cotado FROM base b
      LEFT JOIN LATERAL (
        SELECT dc.frete_cotado FROM public.sup_correio_declaracao dc
        WHERE dc.pedido_id = b.id
        ORDER BY dc.updated_at DESC NULLS LAST, dc.id DESC LIMIT 1
      ) d ON b.despachado AND b.envio_tipo = 'CORREIO'
    ), linhas AS (
      SELECT contrato_id, contrato,
        count(*) FILTER (WHERE recebido) AS recebidos,
        count(*) FILTER (WHERE recebido AND admissao IS TRUE) AS admissoes,
        count(*) FILTER (WHERE recebido AND admissao IS FALSE) AS reposicoes,
        count(*) FILTER (WHERE recebido AND admissao IS NULL) AS motivo_nao_informado,
        count(*) FILTER (WHERE despachado) AS despachados,
        count(*) FILTER (WHERE despachado AND envio_tipo = 'CORREIO') AS correios,
        count(*) FILTER (WHERE despachado AND envio_tipo = 'SUPERVISOR') AS supervisores,
        count(*) FILTER (WHERE despachado AND (envio_tipo IS NULL OR envio_tipo NOT IN ('CORREIO','SUPERVISOR'))) AS modalidade_nao_informada,
        count(*) FILTER (WHERE despachado AND envio_tipo = 'CORREIO' AND frete_cotado IS NULL) AS correios_sem_cotacao,
        COALESCE(sum(frete_cotado) FILTER (WHERE despachado AND envio_tipo = 'CORREIO'), 0) AS frete_estimado
      FROM cotacoes GROUP BY contrato_id, contrato
    )
    SELECT jsonb_build_object('contratos', COALESCE(jsonb_agg(to_jsonb(l) ORDER BY recebidos DESC, contrato), '[]'::jsonb),
      'resumo', jsonb_build_object(
        'recebidos', COALESCE(sum(recebidos),0), 'admissoes', COALESCE(sum(admissoes),0),
        'reposicoes', COALESCE(sum(reposicoes),0), 'motivo_nao_informado', COALESCE(sum(motivo_nao_informado),0),
        'despachados', COALESCE(sum(despachados),0), 'correios', COALESCE(sum(correios),0),
        'supervisores', COALESCE(sum(supervisores),0), 'modalidade_nao_informada', COALESCE(sum(modalidade_nao_informada),0),
        'correios_sem_cotacao', COALESCE(sum(correios_sem_cotacao),0), 'frete_estimado', COALESCE(sum(frete_estimado),0)))
    FROM linhas l
  );
END;
$$;
REVOKE ALL ON FUNCTION public.sup_dashboard_entregas_mensais(date,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_entregas_mensais(date,uuid,uuid,text) TO authenticated;

-- ROLLBACK: DROP FUNCTION public.sup_dashboard_entregas_mensais(date,uuid,uuid,text);
NOTIFY pgrst, 'reload schema';
