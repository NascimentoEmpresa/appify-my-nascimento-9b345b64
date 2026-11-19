-- ============================================================================
-- SIS-2026-0945 — Dashboard de pedidos cancelados (por mês, motivo e valor)
--
-- O SIS-2026-0948 estruturou o motivo do cancelamento, mas o painel dele só
-- contava `cancelamento_estado = 'APROVADO'`. Em 19/11/2026 havia 70 pedidos
-- CANCELADO na produção — todos de ANTES do 0948, com o motivo em texto livre
-- no sup_pedido_historico (32 em branco, 29 cancelados depois de despachados).
-- O painel mostrava zero. Daqui em diante:
--
--   • sup_cancelamentos_base — UMA regra de "cancelado" para as duas RPCs, para
--     o cartão "Cancelados" da aba Solicitações e a aba Cancelamentos baterem.
--     Os antigos entram com legado = true e o texto da época; o sistema NÃO
--     adivinha o motivo deles pelo texto.
--   • Data do cancelamento: aprovação do Suprimentos (cancelamento_decidido_em);
--     nos antigos, o último CANCELADO do histórico (sem ele, updated_at). O mês
--     é contado no fuso de São Paulo.
--   • Valor = quantidade × preço de referência ATUAL do estoque. Não é dinheiro
--     gasto. O pedido aponta para o item BASE e o preço mora no FILHO de cada
--     tamanho (20260930000163), por isso o casamento é pela família.
--   • "Provável novo pedido para a vaga": primeiro pedido não cancelado da mesma
--     empresa + contrato + posto + função, criado depois do cancelado e até 45
--     dias após o cancelamento. Na produção, 11 de 16 desistências tiveram um.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_dashboard_cancelamentos_painel(uuid[], date, date, uuid, text);
--   -- recriar sup_dashboard_cancelamentos como em 20261119210000 (só APROVADO);
--   DROP FUNCTION IF EXISTS public.sup_cancelamento_rotulo_motivo(text, boolean);
--   DROP FUNCTION IF EXISTS public.sup_cancelamento_rotulo_origem(text, boolean);
--   DROP FUNCTION IF EXISTS public.sup_dashboard_cancelamentos_validar(uuid[], date, date);
--   DROP FUNCTION IF EXISTS public.sup_cancelamentos_base(uuid[], date, date, uuid, text);
--   DROP FUNCTION IF EXISTS public.sup_pedido_valor_referencia(uuid);
-- ============================================================================

-- Valor de referência de um pedido. Prefere o preço da mesma empresa, do filho
-- do mesmo tamanho, de ficha não arquivada e o mais recente.
CREATE OR REPLACE FUNCTION public.sup_pedido_valor_referencia(p_pedido_id uuid)
RETURNS TABLE (unidades numeric, valor numeric, unidades_sem_preco numeric)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(sum(pi.quantidade), 0)::numeric,
         COALESCE(sum(pi.quantidade * pr.valor_unitario), 0)::numeric,
         COALESCE(sum(CASE WHEN pr.valor_unitario IS NULL THEN pi.quantidade ELSE 0 END), 0)::numeric
    FROM public.sup_pedido p
    JOIN public.sup_pedido_item pi ON pi.pedido_id = p.id
    LEFT JOIN LATERAL (
      SELECT ei.valor_unitario
        FROM public.sup_item v
        JOIN public.sup_estoque_item ei ON ei.sup_item_id = v.id
       WHERE (v.id = pi.item_id OR v.item_pai_id = pi.item_id)
         AND ei.valor_unitario > 0
       ORDER BY (ei.empresa_id = p.empresa_id) DESC,
                (upper(btrim(COALESCE(v.tamanho, ''))) = upper(btrim(COALESCE(pi.tamanho, '')))) DESC,
                (ei.arquivado_em IS NULL) DESC,
                ei.updated_at DESC
       LIMIT 1
    ) pr ON true
   WHERE p.id = p_pedido_id;
$fn$;

REVOKE ALL ON FUNCTION public.sup_pedido_valor_referencia(uuid) FROM PUBLIC, anon, authenticated;

-- Uma linha por pedido cancelado no período. Interna: só as RPCs abaixo, que
-- fazem o portão de acesso, a chamam.
CREATE OR REPLACE FUNCTION public.sup_cancelamentos_base(
  p_empresa_ids uuid[],
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
) RETURNS TABLE (
  id uuid, empresa_id uuid, pedido_id text, contrato_id uuid, contrato_nome text,
  posto_nome text, funcao_nome text, nome_colaborador text, criado_em timestamptz,
  cancelado_em timestamptz, legado boolean, categoria text, detalhe text, origem text,
  solicitado_por_nome text, decidido_por_nome text, situacao_anterior text,
  unidades numeric, valor numeric, unidades_sem_preco numeric,
  reposicao_id uuid, reposicao_pedido_id text, reposicao_criado_em timestamptz,
  reposicao_valor numeric
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
  WITH cancelados AS (
    SELECT p.id AS c_id, p.empresa_id AS c_empresa_id, p.pedido_id AS c_pedido_id,
           p.contrato_id AS c_contrato_id, p.contrato_nome AS c_contrato_nome,
           p.posto_id AS c_posto_id, p.funcao_id AS c_funcao_id,
           p.posto_nome AS c_posto_nome, p.funcao_nome AS c_funcao_nome,
           p.nome_colaborador AS c_colaborador, p.created_at AS c_criado_em,
           (p.cancelamento_estado <> 'APROVADO') AS c_legado,
           CASE WHEN p.cancelamento_estado = 'APROVADO' THEN p.cancelamento_categoria END AS c_categoria,
           CASE WHEN p.cancelamento_estado = 'APROVADO' THEN p.cancelamento_detalhe
                ELSE NULLIF(btrim(h.observacao), '') END AS c_detalhe,
           CASE WHEN p.cancelamento_estado = 'APROVADO' THEN p.cancelamento_origem END AS c_origem,
           CASE WHEN p.cancelamento_estado = 'APROVADO' THEN p.cancelamento_solicitado_por_nome END AS c_solicitado_por,
           CASE WHEN p.cancelamento_estado = 'APROVADO' THEN p.cancelamento_decidido_por_nome
                ELSE h.alterado_por_nome END AS c_decidido_por,
           h.status_anterior AS c_situacao_anterior,
           CASE WHEN p.cancelamento_estado = 'APROVADO' AND p.cancelamento_decidido_em IS NOT NULL
                THEN p.cancelamento_decidido_em
                ELSE COALESCE(h.data_alteracao, p.updated_at) END AS c_cancelado_em
      FROM public.sup_pedido p
      LEFT JOIN LATERAL (
        SELECT hh.observacao, hh.alterado_por_nome, hh.status_anterior, hh.data_alteracao
          FROM public.sup_pedido_historico hh
         WHERE hh.pedido_id = p.id
           AND hh.acao IN ('CANCELADO', 'CANCELAMENTO_APROVADO')
         ORDER BY hh.data_alteracao DESC, hh.id DESC
         LIMIT 1
      ) h ON true
     WHERE p.status = 'CANCELADO'
       AND p.empresa_id = ANY (p_empresa_ids)
       AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
       AND (
         p_categoria IS NULL OR EXISTS (
           SELECT 1
             FROM public.sup_pedido_item pi
             LEFT JOIN public.sup_item i ON i.id = pi.item_id
            WHERE pi.pedido_id = p.id
              AND COALESCE(i.tipo, pi.tipo_item) = p_categoria
         )
       )
  ), no_periodo AS (
    SELECT c.*
      FROM cancelados c
     WHERE (c.c_cancelado_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_inicio AND p_fim
  )
  SELECT c.c_id, c.c_empresa_id, c.c_pedido_id, c.c_contrato_id, c.c_contrato_nome,
         c.c_posto_nome, c.c_funcao_nome, c.c_colaborador, c.c_criado_em,
         c.c_cancelado_em, c.c_legado, c.c_categoria, c.c_detalhe, c.c_origem,
         c.c_solicitado_por, c.c_decidido_por, c.c_situacao_anterior,
         v.unidades, v.valor, v.unidades_sem_preco,
         r.id, r.pedido_id, r.created_at,
         CASE WHEN r.id IS NULL THEN NULL ELSE rv.valor END
    FROM no_periodo c
    CROSS JOIN LATERAL public.sup_pedido_valor_referencia(c.c_id) v
    LEFT JOIN LATERAL (
      SELECT q.id, q.pedido_id, q.created_at
        FROM public.sup_pedido q
       WHERE q.contrato_id = c.c_contrato_id
         AND q.empresa_id = c.c_empresa_id
         AND q.posto_id = c.c_posto_id
         AND q.funcao_id = c.c_funcao_id
         AND q.id <> c.c_id
         AND q.status <> 'CANCELADO'
         AND q.created_at > c.c_criado_em
         AND q.created_at <= c.c_cancelado_em + interval '45 days'
       ORDER BY q.created_at
       LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL public.sup_pedido_valor_referencia(r.id) rv ON r.id IS NOT NULL;
$fn$;

REVOKE ALL ON FUNCTION public.sup_cancelamentos_base(uuid[], date, date, uuid, text) FROM PUBLIC, anon, authenticated;

-- Mesmo portão de empresa das RPCs do dashboard (20261119210000), para cada id.
CREATE OR REPLACE FUNCTION public.sup_dashboard_cancelamentos_validar(
  p_empresa_ids uuid[],
  p_inicio date,
  p_fim date
) RETURNS void
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_screen_access(v_uid, 'sup_dashboard_compras_estoque', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o Dashboard de Compras, Estoque e Saving.' USING ERRCODE = '42501';
  END IF;
  IF p_empresa_ids IS NULL OR cardinality(p_empresa_ids) = 0
     OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(p_empresa_ids) AS e(empresa_id)
     WHERE e.empresa_id IS NULL
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.profiles pr
             WHERE pr.id = v_uid AND (pr.acessa_todas_empresas OR pr.empresa_id = e.empresa_id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.user_empresa ue
             WHERE ue.user_id = v_uid AND ue.empresa_id = e.empresa_id
          )
        )
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_dashboard_cancelamentos_validar(uuid[], date, date) FROM PUBLIC, anon, authenticated;

-- Rótulos iguais a CATEGORIAS_CANCELAMENTO_PEDIDO (src/lib/suprimentos/cancelamentoPedido.ts).
CREATE OR REPLACE FUNCTION public.sup_cancelamento_rotulo_motivo(p_categoria text, p_legado boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_legado THEN 'Registro antigo (sem motivo padronizado)'
           WHEN p_categoria = 'DUPLICIDADE' THEN 'Pedido duplicado'
           WHEN p_categoria = 'DESISTENCIA_ADMISSAO' THEN 'Desistência da admissão'
           WHEN p_categoria = 'PEDIDO_INCORRETO' THEN 'Pedido incorreto'
           WHEN p_categoria = 'COLABORADOR_DESLIGADO' THEN 'Colaborador desligado'
           WHEN p_categoria = 'NAO_NECESSARIO' THEN 'Material não necessário'
           ELSE 'Outro'
         END;
$fn$;

CREATE OR REPLACE FUNCTION public.sup_cancelamento_rotulo_origem(p_origem text, p_legado boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_legado THEN 'Registro antigo'
           WHEN p_origem = 'RECRUTAMENTO' THEN 'Recrutamento'
           ELSE 'Encarregado'
         END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_cancelamento_rotulo_motivo(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sup_cancelamento_rotulo_origem(text, boolean) FROM PUBLIC, anon, authenticated;

-- A RPC do 0948 mantém assinatura e chaves (o front da aba Solicitações lê
-- total/por_motivo/por_origem) e passa a contar também os registros antigos.
CREATE OR REPLACE FUNCTION public.sup_dashboard_cancelamentos(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  PERFORM public.sup_dashboard_cancelamentos_validar(ARRAY[p_empresa_id], p_inicio, p_fim);

  RETURN (
    WITH cancelados AS (
      SELECT * FROM public.sup_cancelamentos_base(ARRAY[p_empresa_id], p_inicio, p_fim, p_contrato_id, p_categoria)
    )
    SELECT jsonb_build_object(
      'total', (SELECT count(*) FROM cancelados),
      'por_motivo', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT public.sup_cancelamento_rotulo_motivo(c.categoria, c.legado) AS nome,
                   count(*)::int AS quantidade
              FROM cancelados c
             GROUP BY 1
          ) x
      ), '[]'::jsonb),
      'por_origem', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT public.sup_cancelamento_rotulo_origem(c.origem, c.legado) AS nome,
                   count(*)::int AS quantidade
              FROM cancelados c
             GROUP BY 1
          ) x
      ), '[]'::jsonb)
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_cancelamentos(uuid, date, date, uuid, text) IS
  'SIS-2026-0948/0945: cancelamentos do período (inclui registros antigos), por motivo e origem.';

-- A aba Cancelamentos. Recebe o array de empresas para o "Todas" sair em UMA
-- requisição (Promise.all num .map reprova no guardião, regra D7).
CREATE OR REPLACE FUNCTION public.sup_dashboard_cancelamentos_painel(
  p_empresa_ids uuid[],
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_limite constant int := 500;
BEGIN
  PERFORM public.sup_dashboard_cancelamentos_validar(p_empresa_ids, p_inicio, p_fim);

  RETURN (
    WITH cancelados AS (
      SELECT c.*,
             public.sup_cancelamento_rotulo_motivo(c.categoria, c.legado) AS motivo_nome,
             public.sup_cancelamento_rotulo_origem(c.origem, c.legado) AS origem_nome,
             CASE
               WHEN c.situacao_anterior = 'AGUARDANDO COMPRA' THEN 'AGUARDANDO_COMPRA'
               WHEN c.situacao_anterior IN ('EM PREPARACAO', 'EM SEPARACAO', 'AGUARDANDO ENVIO') THEN 'ANTES_DESPACHO'
               WHEN c.situacao_anterior IS NULL THEN 'NAO_INFORMADO'
               ELSE 'APOS_DESPACHO'
             END AS situacao,
             -- Recompra conta só onde a vaga ficou vazia: desistência e
             -- desligamento. Os antigos ficam FORA do cartão — na carga da
             -- produção (19/11) eles davam 53 de 70, porque duplicado e
             -- devolução também têm "pedido seguinte" e o motivo não diz qual
             -- é qual. A coluna continua na tabela, linha a linha.
             (c.reposicao_id IS NOT NULL AND NOT c.legado
               AND c.categoria IN ('DESISTENCIA_ADMISSAO', 'COLABORADOR_DESLIGADO')) AS conta_reposicao,
             to_char(date_trunc('month', c.cancelado_em AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes
        FROM public.sup_cancelamentos_base(p_empresa_ids, p_inicio, p_fim, p_contrato_id, p_categoria) c
    ), criados AS (
      SELECT to_char(date_trunc('month', p.created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
             count(*)::int AS quantidade
        FROM public.sup_pedido p
       WHERE p.empresa_id = ANY (p_empresa_ids)
         AND (p.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_inicio AND p_fim
         AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
         AND (
           p_categoria IS NULL OR EXISTS (
             SELECT 1
               FROM public.sup_pedido_item pi
               LEFT JOIN public.sup_item i ON i.id = pi.item_id
              WHERE pi.pedido_id = p.id
                AND COALESCE(i.tipo, pi.tipo_item) = p_categoria
           )
         )
       GROUP BY 1
    ), meses AS (
      SELECT to_char(m, 'YYYY-MM') AS mes
        FROM generate_series(date_trunc('month', p_inicio::timestamp),
                             date_trunc('month', p_fim::timestamp),
                             interval '1 month') AS m
    ), pendentes AS (
      SELECT p.id, p.pedido_id, p.status, p.contrato_nome, p.nome_colaborador,
             p.cancelamento_categoria, p.cancelamento_detalhe, p.cancelamento_origem,
             p.cancelamento_solicitado_por_nome, p.cancelamento_solicitado_em
        FROM public.sup_pedido p
       WHERE p.empresa_id = ANY (p_empresa_ids)
         AND p.cancelamento_estado = 'SOLICITADO'
         AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
    )
    SELECT jsonb_build_object(
      'resumo', (
        SELECT jsonb_build_object(
          'total', count(*)::int,
          'estruturados', count(*) FILTER (WHERE NOT c.legado)::int,
          'legados', count(*) FILTER (WHERE c.legado)::int,
          'valor', COALESCE(sum(c.valor), 0),
          'unidades', COALESCE(sum(c.unidades), 0),
          'unidades_sem_preco', COALESCE(sum(c.unidades_sem_preco), 0),
          'pedidos_no_periodo', COALESCE((SELECT sum(cr.quantidade) FROM criados cr), 0)::int,
          'aguardando_decisao', (SELECT count(*) FROM pendentes)::int,
          'recusados', (
            SELECT count(*)::int
              FROM public.sup_pedido p
             WHERE p.empresa_id = ANY (p_empresa_ids)
               AND p.cancelamento_estado = 'RECUSADO'
               AND (p_contrato_id IS NULL OR p.contrato_id = p_contrato_id)
               AND (p.cancelamento_decidido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_inicio AND p_fim
          ),
          'vagas_com_reposicao', count(*) FILTER (WHERE c.conta_reposicao)::int,
          -- Dois cancelados da mesma vaga apontam para o MESMO pedido novo:
          -- o valor dele entra uma vez só.
          'valor_reposicao', COALESCE((
            SELECT sum(r.reposicao_valor)
              FROM (SELECT DISTINCT ON (cc.reposicao_id) cc.reposicao_valor
                      FROM cancelados cc WHERE cc.conta_reposicao) r
          ), 0)
        )
          FROM cancelados c
      ),
      'por_mes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'mes', m.mes,
                 'cancelados', COALESCE(x.quantidade, 0),
                 'pedidos_criados', COALESCE(cr.quantidade, 0),
                 'valor', COALESCE(x.valor, 0)
               ) ORDER BY m.mes)
          FROM meses m
          LEFT JOIN (
            SELECT c.mes, count(*)::int AS quantidade, sum(c.valor) AS valor
              FROM cancelados c GROUP BY c.mes
          ) x ON x.mes = m.mes
          LEFT JOIN criados cr ON cr.mes = m.mes
      ), '[]'::jsonb),
      'por_motivo', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT CASE WHEN c.legado THEN 'LEGADO' ELSE COALESCE(c.categoria, 'OUTRO') END AS categoria,
                   c.motivo_nome AS nome, count(*)::int AS quantidade, COALESCE(sum(c.valor), 0) AS valor
              FROM cancelados c GROUP BY 1, 2
          ) x
      ), '[]'::jsonb),
      'por_origem', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.nome)
          FROM (
            SELECT c.origem_nome AS nome, count(*)::int AS quantidade
              FROM cancelados c GROUP BY 1
          ) x
      ), '[]'::jsonb),
      'por_situacao', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.situacao)
          FROM (
            SELECT c.situacao, count(*)::int AS quantidade, COALESCE(sum(c.valor), 0) AS valor
              FROM cancelados c GROUP BY 1
          ) x
      ), '[]'::jsonb),
      'por_contrato', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade DESC, x.contrato)
          FROM (
            SELECT COALESCE(c.contrato_nome, 'Sem contrato') AS contrato,
                   count(*)::int AS quantidade, COALESCE(sum(c.valor), 0) AS valor
              FROM cancelados c GROUP BY 1
             ORDER BY 2 DESC, 1
             LIMIT 10
          ) x
      ), '[]'::jsonb),
      'linhas', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.cancelado_em DESC, x.pedido_id)
          FROM (
            SELECT c.id, c.empresa_id, c.pedido_id, c.contrato_nome, c.posto_nome, c.funcao_nome,
                   c.nome_colaborador, c.cancelado_em, c.legado, c.categoria, c.motivo_nome,
                   c.detalhe, c.origem_nome, c.solicitado_por_nome, c.decidido_por_nome,
                   c.situacao, c.unidades, c.valor, c.unidades_sem_preco,
                   c.reposicao_pedido_id, c.reposicao_criado_em, c.reposicao_valor
              FROM cancelados c
             ORDER BY c.cancelado_em DESC, c.pedido_id
             LIMIT v_limite
          ) x
      ), '[]'::jsonb),
      'linhas_truncadas', (SELECT count(*) > v_limite FROM cancelados),
      'pendentes', COALESCE((
        SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.cancelamento_solicitado_em)
          FROM pendentes pd
      ), '[]'::jsonb)
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sup_dashboard_cancelamentos_painel(uuid[], date, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_cancelamentos_painel(uuid[], date, date, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_cancelamentos_painel(uuid[], date, date, uuid, text) IS
  'SIS-2026-0945: aba Cancelamentos do Dashboard de Compras — por mês, motivo, origem, situação, contrato, valor de referência e provável novo pedido para a vaga.';

NOTIFY pgrst, 'reload schema';
