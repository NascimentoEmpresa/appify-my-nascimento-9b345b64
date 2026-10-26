-- SIS-2026-0622 — Histórico de uniformes fornecidos por colaborador
--
-- A aba de rotatividade já mostra o consumo agregado. Para analisar o custo
-- de uma vaga em caso de turnover, porém, é indispensável saber QUEM recebeu
-- cada peça e em que data. A fonte é a saída física do almoxarifado: pedido
-- solicitado ou despachado não é tratado como fornecimento até que a baixa
-- seja gravada em `sup_estoque_movimento`.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_fornecimentos_uniformes_colaborador(uuid, date, date, uuid);

CREATE OR REPLACE FUNCTION public.sup_fornecimentos_uniformes_colaborador(
  p_empresa_id  uuid,
  p_inicio      date,
  p_fim         date,
  p_contrato_id uuid DEFAULT NULL
)
RETURNS TABLE (
  data_fornecimento date,
  colaborador       text,
  matricula         text,
  contrato          text,
  posto             text,
  protocolo         text,
  tipo_uniforme     text,
  tamanho           text,
  quantidade        integer
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
    RAISE EXCEPTION 'Sem permissão para visualizar os fornecimentos de uniformes.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  IF p_fim - p_inicio > 1827 THEN
    RAISE EXCEPTION 'O período máximo do histórico é de cinco anos.' USING ERRCODE = '22023';
  END IF;

  -- A função agrega tabelas de estoque sob SECURITY DEFINER, mas a empresa
  -- continua sendo obrigatoriamente uma das empresas que a pessoa pode abrir.
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles pr
     WHERE pr.id = v_uid
       AND (pr.acessa_todas_empresas OR pr.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.user_empresa ue
     WHERE ue.user_id = v_uid
       AND ue.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (m.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_fornecimento,
    btrim(p.nome_colaborador)::text AS colaborador,
    NULLIF(btrim(p.matricula_colaborador), '')::text AS matricula,
    p.contrato_nome::text AS contrato,
    p.posto_nome::text AS posto,
    p.pedido_id::text AS protocolo,
    COALESCE(item_base.nome, item.nome, pi.nome_item, 'Uniforme sem descrição')::text AS tipo_uniforme,
    NULLIF(btrim(public.sup_tamanho_da_variante(COALESCE(m.tamanho, item.tamanho, pi.tamanho))), '')::text AS tamanho,
    sum(abs(m.quantidade))::integer AS quantidade
  FROM public.sup_estoque_movimento m
  JOIN public.sup_pedido p ON p.id = m.pedido_id
  LEFT JOIN public.sup_pedido_item pi ON pi.id = m.pedido_item_id
  LEFT JOIN public.sup_item item ON item.id = m.sup_item_id
  LEFT JOIN public.sup_item item_base
    ON item_base.id = COALESCE(item.item_pai_id, item.id)
  WHERE m.empresa_id = p_empresa_id
    AND m.created_at >= p_inicio::timestamptz
    AND m.created_at < (p_fim + 1)::timestamptz
    -- Saída é a baixa que entregou a peça. Devolução, ajuste e remoção não
    -- são fornecimento e não podem inflar a leitura do consumo por pessoa.
    AND m.tipo = 'saida'
    AND COALESCE(item.tipo, pi.tipo_item) = 'uniforme'
    AND NULLIF(btrim(p.nome_colaborador), '') IS NOT NULL
    AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
  GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  ORDER BY 1 DESC, 2, 7, 8;
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_fornecimentos_uniformes_colaborador(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_fornecimentos_uniformes_colaborador(uuid, date, date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
