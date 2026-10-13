-- [SEM-CHAMADO] Rotatividade do Estoque — RPC da aba do dashboard
--
-- Pedido da diretoria: qual tamanho mais sai, qual mais entra, qual mais roda
-- dentro do estoque, por contrato, com valor e ao longo do tempo.
--
-- Fontes, e por que cada uma:
--   sup_pedido / sup_pedido_item    demanda atendida — histórico completo
--                                   (desde 2026-03-17). É a fonte pedida pela
--                                   diretoria: "cada pedido feito, para quem,
--                                   qual contrato, qual valor, em que período".
--   sup_estoque_movimento           entrada/saída física do almoxarifado. SÓ
--                                   EXISTE A PARTIR DE 2026-08-04, quando o
--                                   módulo de estoque entrou em operação. O
--                                   payload devolve `movimento_desde` para a
--                                   tela poder avisar isso em vez de deixar o
--                                   diretor achar que o ano todo está ali.
--   sup_estoque_saldo               saldo atual, denominador do giro.
--   sup_levantamento_uniforme       grade declarada (o que a equipe veste).
--
-- Decisões que mudam o número e por isso estão explícitas:
--
--   • CONTRATO vem de contratos.nome via sup_pedido.contrato_id (100%
--     preenchido), nunca de sup_pedido.contrato_nome. O campo texto tem a
--     mesma UFRGS escrita de três formas ("UFRGS - LIMPEZA GERAL - 047/2022",
--     "UFRGS LIMPEZA GERAL - 047.2022", "UFRGS-LIMPEZA GERAL- 047 2022"),
--     herdadas da migração do sistema antigo, e agrupar por ele parte o mesmo
--     contrato em três linhas no gráfico.
--
--   • VALOR do item de pedido resolve por FAMÍLIA + TAMANHO. sup_pedido_item
--     .item_id aponta para o item BASE ("JAQUETA"), enquanto o preço mora em
--     sup_estoque_item do item FILHO ("JAQUETA M"). Casar direto por item_id
--     devolve quase zero (R$ 300 no lugar de R$ 180 mil). A cadeia é
--     família+tamanho → média da família → zero.
--
--   • GIRO = unidades que saíram no período ÷ saldo disponível atual. Não
--     existe histórico de saldo (não há snapshot diário), então o denominador
--     é o saldo de hoje e o número é uma aproximação — é o giro que os dados
--     permitem calcular, e a tela rotula assim.
--
--   • TAMANHO não é fundido. O formulário oferece 7 opções (PP, P, M, G, GG,
--     EGG, EXG) e o catálogo de estoque usa 9 rótulos, com XGG e EXGG. Tratar
--     "XGG" como "EGG" seria adivinhar equivalência de grade; cada rótulo
--     aparece como é e `alertas` sinaliza os que só existem de um lado.
--
--   • NOME DE ITEM também não é fundido. O catálogo tem pares quase idênticos
--     ("MOLETON CINZA" / "MOLETOM CINZA", "BABUCHE - PRETO" / "BABUCHE
--     PRETO") que são cadastros distintos de verdade. Em vez de somar por
--     palpite, `alertas` lista os pares suspeitos por similaridade (pg_trgm)
--     para Suprimentos resolver no catálogo.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_dashboard_rotatividade_estoque(uuid,date,date,uuid,text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sup_dashboard_rotatividade_estoque(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contrato_id uuid DEFAULT NULL,
  p_categoria text DEFAULT 'uniforme'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_categoria  text := NULLIF(btrim(lower(COALESCE(p_categoria, ''))), '');
  v_dias       integer;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o Dashboard de Compras, Estoque e Saving.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL OR p_inicio IS NULL OR p_fim IS NULL OR p_inicio > p_fim THEN
    RAISE EXCEPTION 'Empresa e período válido são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  IF p_fim - p_inicio > 1827 THEN
    RAISE EXCEPTION 'O período máximo do dashboard é de cinco anos.' USING ERRCODE = '22023';
  END IF;

  -- Mesma validação de empresa do dashboard principal (20261007000001).
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles pr
     WHERE pr.id = v_uid
       AND (pr.acessa_todas_empresas OR pr.empresa_id = p_empresa_id)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_empresa ue
     WHERE ue.user_id = v_uid AND ue.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Usuário sem acesso à empresa selecionada.' USING ERRCODE = '42501';
  END IF;

  v_dias := GREATEST((p_fim - p_inicio) + 1, 1);

  RETURN (
    WITH
    -- ------------------------------------------------------------------
    -- Preço: família + tamanho, com média da família como rede
    -- ------------------------------------------------------------------
    preco_variante AS (
      SELECT COALESCE(i.item_pai_id, i.id)              AS base_id,
             public.sup_tamanho_da_variante(i.tamanho)  AS tamanho,
             avg(NULLIF(ei.valor_unitario, 0))          AS valor_unitario
        FROM public.sup_item i
        JOIN public.sup_estoque_item ei
          ON ei.sup_item_id = i.id AND ei.arquivado_em IS NULL
       WHERE i.empresa_id = p_empresa_id
       GROUP BY 1, 2
    ),
    preco_familia AS (
      SELECT base_id, avg(valor_unitario) AS valor_unitario
        FROM preco_variante
       GROUP BY 1
    ),

    -- ------------------------------------------------------------------
    -- Demanda atendida: itens de pedido no período
    -- ------------------------------------------------------------------
    pedido_item AS (
      SELECT pe.id                                        AS pedido_id,
             pe.data_solicitacao,
             pe.contrato_id,
             COALESCE(ct.nome, pe.contrato_nome, 'Sem contrato') AS contrato,
             COALESCE(base.nome, pi.nome_item)            AS peca,
             COALESCE(base.id, pi.item_id)                AS base_id,
             COALESCE(it.tipo, pi.tipo_item, 'insumo')    AS categoria,
             public.sup_tamanho_da_variante(pi.tamanho)   AS tamanho,
             pi.quantidade::numeric                       AS quantidade,
             pi.quantidade * COALESCE(
               pv.valor_unitario, pf.valor_unitario, 0
             )::numeric                                   AS valor,
             (pv.valor_unitario IS NULL AND pf.valor_unitario IS NULL) AS sem_preco
        FROM public.sup_pedido pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.contratos ct  ON ct.id = pe.contrato_id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
        LEFT JOIN preco_variante pv
               ON pv.base_id = COALESCE(it.item_pai_id, it.id)
              AND pv.tamanho IS NOT DISTINCT FROM public.sup_tamanho_da_variante(pi.tamanho)
        LEFT JOIN preco_familia pf
               ON pf.base_id = COALESCE(it.item_pai_id, it.id)
       WHERE pe.empresa_id = p_empresa_id
         AND pe.data_solicitacao BETWEEN p_inicio AND p_fim
         AND pe.status <> 'CANCELADO'
         AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
         AND (v_categoria IS NULL OR COALESCE(it.tipo, pi.tipo_item) = v_categoria)
    ),

    -- ------------------------------------------------------------------
    -- Movimento físico do almoxarifado
    -- ------------------------------------------------------------------
    movimento AS (
      SELECT m.tipo,
             m.created_at,
             COALESCE(base.nome, i.nome)                 AS peca,
             COALESCE(base.id, i.id)                     AS base_id,
             COALESCE(
               public.sup_tamanho_da_variante(m.tamanho),
               public.sup_tamanho_da_variante(i.tamanho)
             )                                           AS tamanho,
             abs(m.quantidade)::numeric                   AS quantidade,
             pe.contrato_id
        FROM public.sup_estoque_movimento m
        JOIN public.sup_item i         ON i.id = m.sup_item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(i.item_pai_id, i.id)
        LEFT JOIN public.sup_pedido pe ON pe.id = m.pedido_id
       WHERE m.empresa_id = p_empresa_id
         AND m.created_at >= p_inicio::timestamptz
         AND m.created_at < (p_fim + 1)::timestamptz
         -- 'reserva' e 'liberacao' não movem estoque físico, só travam saldo;
         -- 'correcao'/'ajuste' são acerto de inventário e entrariam como
         -- rotatividade falsa. Ficam de fora dos dois lados.
         AND m.tipo IN ('entrada', 'saida', 'devolucao', 'remocao')
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
         AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
    ),

    -- ------------------------------------------------------------------
    -- Saldo atual — denominador do giro (não depende do período)
    -- ------------------------------------------------------------------
    saldo AS (
      SELECT COALESCE(base.nome, i.nome) AS peca,
             COALESCE(base.id, i.id)     AS base_id,
             COALESCE(
               public.sup_tamanho_da_variante(s.tamanho),
               public.sup_tamanho_da_variante(i.tamanho)
             )                           AS tamanho,
             sum(COALESCE(s.disponivel, 0))::numeric AS disponivel,
             sum(COALESCE(s.fisico, 0))::numeric     AS fisico,
             sum(COALESCE(s.reservado, 0))::numeric  AS reservado
        FROM public.sup_estoque_saldo s
        JOIN public.sup_item i         ON i.id = s.sup_item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(i.item_pai_id, i.id)
       WHERE s.empresa_id = p_empresa_id
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
       GROUP BY 1, 2, 3
    ),

    -- ------------------------------------------------------------------
    -- Grade declarada: última resposta de cada pessoa
    -- ------------------------------------------------------------------
    -- Escopo: respostas da empresa pedida, mais as que ficaram sem contrato
    -- resolvido (texto ambíguo no formulário). Com filtro de contrato ativo,
    -- só as daquele contrato.
    levantamento_escopo AS (
      SELECT l.*
        FROM public.sup_levantamento_uniforme l
       WHERE (p_contrato_id IS NULL OR l.contrato_id = p_contrato_id)
         AND (p_contrato_id IS NOT NULL OR l.empresa_id IS NULL OR l.empresa_id = p_empresa_id)
    ),
    -- Uma linha por pessoa, a mais recente. 109 das 1000 respostas são
    -- repetição da mesma pessoa; sem isto, quem respondeu três vezes pesaria
    -- três vezes na grade declarada.
    levantamento AS (
      SELECT DISTINCT ON (public.sup_norm_nome(l.nome_completo)) l.*
        FROM levantamento_escopo l
       ORDER BY public.sup_norm_nome(l.nome_completo), l.enviado_em DESC
    ),
    declarado AS (
      SELECT v.peca, v.tamanho, count(*)::int AS pessoas
        FROM levantamento l
        CROSS JOIN LATERAL (
          VALUES ('Camisa / camiseta', l.camisa, 'letra'),
                 ('Calça / bermuda',   l.calca,  'letra'),
                 ('Jaleco',            l.jaleco, 'letra'),
                 ('Jaqueta',           l.jaqueta,'letra'),
                 ('Moletom',           l.moletom,'letra'),
                 ('Calçado',           l.calcado,'numero'),
                 ('Luva',              l.luva,   'letra')
        ) AS v(peca, tamanho, escala)
       WHERE v.tamanho IS NOT NULL
       GROUP BY v.peca, v.tamanho
    ),
    -- Quais perguntas do formulário correspondem à categoria analisada.
    --
    -- Isto não é detalhe: comparar a saída de EPI (luva, botina) com a grade
    -- declarada de vestuário compara coisas diferentes e fabrica um
    -- desalinhamento que não existe. Em Insumos e Equipamentos o levantamento
    -- não tem contrapartida nenhuma, então a grade vem vazia em vez de vir
    -- errada.
    pecas_da_categoria AS (
      SELECT unnest(
               CASE
                 WHEN v_categoria = 'uniforme' THEN
                   ARRAY['Camisa / camiseta', 'Calça / bermuda', 'Jaleco', 'Jaqueta', 'Moletom']
                 WHEN v_categoria = 'epi' THEN
                   ARRAY['Luva', 'Calçado']
                 WHEN v_categoria IS NULL THEN
                   ARRAY['Camisa / camiseta', 'Calça / bermuda', 'Jaleco', 'Jaqueta',
                         'Moletom', 'Luva', 'Calçado']
                 ELSE ARRAY[]::text[]
               END
             ) AS peca
    ),
    declarado_categoria AS (
      SELECT d.tamanho, sum(d.pessoas)::int AS pessoas
        FROM declarado d
       WHERE d.peca IN (SELECT peca FROM pecas_da_categoria)
       GROUP BY d.tamanho
    ),

    -- ------------------------------------------------------------------
    -- Consolidação por tamanho
    -- ------------------------------------------------------------------
    tamanhos AS (
      SELECT tamanho FROM pedido_item WHERE tamanho IS NOT NULL
      UNION SELECT tamanho FROM movimento  WHERE tamanho IS NOT NULL
      UNION SELECT tamanho FROM saldo      WHERE tamanho IS NOT NULL
      UNION SELECT tamanho FROM declarado_categoria
    ),
    por_tamanho AS (
      SELECT t.tamanho,
             public.sup_tamanho_ordem(t.tamanho) AS ordem,
             COALESCE((SELECT sum(p.quantidade) FROM pedido_item p WHERE p.tamanho = t.tamanho), 0) AS pedidas,
             COALESCE((SELECT sum(p.valor)      FROM pedido_item p WHERE p.tamanho = t.tamanho), 0) AS valor_pedido,
             COALESCE((SELECT sum(m.quantidade) FROM movimento m WHERE m.tamanho = t.tamanho AND m.tipo = 'entrada'),   0) AS entradas,
             COALESCE((SELECT sum(m.quantidade) FROM movimento m WHERE m.tamanho = t.tamanho AND m.tipo IN ('saida','remocao')), 0) AS saidas,
             COALESCE((SELECT sum(m.quantidade) FROM movimento m WHERE m.tamanho = t.tamanho AND m.tipo = 'devolucao'), 0) AS devolucoes,
             COALESCE((SELECT sum(s.disponivel) FROM saldo s WHERE s.tamanho = t.tamanho), 0) AS saldo_disponivel,
             COALESCE((SELECT sum(s.reservado)  FROM saldo s WHERE s.tamanho = t.tamanho), 0) AS reservado,
             COALESCE((SELECT dl.pessoas FROM declarado_categoria dl WHERE dl.tamanho = t.tamanho), 0) AS declarado_pessoas
        FROM tamanhos t
    ),
    totais AS (
      SELECT sum(pedidas) AS pedidas, sum(saidas) AS saidas, sum(entradas) AS entradas,
             sum(valor_pedido) AS valor_pedido, sum(saldo_disponivel) AS saldo_disponivel,
             sum(declarado_pessoas) AS declarado_pessoas
        FROM por_tamanho
    ),
    por_tamanho_final AS (
      SELECT pt.*,
             CASE WHEN pt.saldo_disponivel > 0
                  THEN round(pt.saidas / pt.saldo_disponivel, 2) END AS giro,
             CASE WHEN pt.saidas > 0
                  THEN round(pt.saldo_disponivel / (pt.saidas / v_dias::numeric), 0) END AS dias_cobertura,
             CASE WHEN tt.pedidas > 0
                  THEN round(100 * pt.pedidas / tt.pedidas, 1) ELSE 0 END AS pct_pedidas,
             CASE WHEN tt.declarado_pessoas > 0
                  THEN round(100 * pt.declarado_pessoas / tt.declarado_pessoas, 1) ELSE 0 END AS pct_declarado
        FROM por_tamanho pt CROSS JOIN totais tt
    ),

    -- ------------------------------------------------------------------
    -- Consolidação por peça (item base do catálogo)
    -- ------------------------------------------------------------------
    pecas AS (
      SELECT base_id, peca FROM pedido_item WHERE base_id IS NOT NULL
      UNION SELECT base_id, peca FROM movimento WHERE base_id IS NOT NULL
    ),
    por_peca AS (
      SELECT pc.peca,
             COALESCE((SELECT sum(p.quantidade) FROM pedido_item p WHERE p.base_id = pc.base_id), 0) AS pedidas,
             COALESCE((SELECT sum(p.valor)      FROM pedido_item p WHERE p.base_id = pc.base_id), 0) AS valor_pedido,
             COALESCE((SELECT sum(m.quantidade) FROM movimento m WHERE m.base_id = pc.base_id AND m.tipo = 'entrada'), 0) AS entradas,
             COALESCE((SELECT sum(m.quantidade) FROM movimento m WHERE m.base_id = pc.base_id AND m.tipo IN ('saida','remocao')), 0) AS saidas,
             COALESCE((SELECT sum(s.disponivel) FROM saldo s WHERE s.base_id = pc.base_id), 0) AS saldo_disponivel,
             (SELECT p.tamanho FROM pedido_item p
               WHERE p.base_id = pc.base_id AND p.tamanho IS NOT NULL
               GROUP BY p.tamanho ORDER BY sum(p.quantidade) DESC, p.tamanho LIMIT 1) AS tamanho_top
        FROM (SELECT DISTINCT base_id, peca FROM pecas) pc
    ),

    -- ------------------------------------------------------------------
    -- Catálogo com nome quase igual — dívida de cadastro, não cálculo
    -- ------------------------------------------------------------------
    -- "(MC)" e "(ML)" são manga curta e manga longa: duas peças de verdade,
    -- não cadastro repetido. Sem isolar a marca de manga, a similaridade
    -- textual acusa todo par MC/ML como duplicado e o alerta vira ruído.
    pecas_manga AS (
      SELECT pc.peca, pc.pedidas, pc.saidas,
             CASE
               WHEN pc.peca ~* '\(\s*ml\s*\)|manga longa' THEN 'ML'
               WHEN pc.peca ~* '\(\s*mc\s*\)|manga curta' THEN 'MC'
               ELSE ''
             END AS manga
        FROM por_peca pc
    ),
    nomes_suspeitos AS (
      SELECT a.peca AS peca_a, b.peca AS peca_b
        FROM pecas_manga a
        JOIN pecas_manga b
          ON a.peca < b.peca
         AND a.manga = b.manga
         AND similarity(
               public.sup_normalizar_descricao_item(a.peca),
               public.sup_normalizar_descricao_item(b.peca)
             ) >= 0.82
       WHERE (a.pedidas + a.saidas) > 0 AND (b.pedidas + b.saidas) > 0
       ORDER BY (a.pedidas + a.saidas + b.pedidas + b.saidas) DESC
       LIMIT 10
    ),

    meses AS (
      SELECT generate_series(
        date_trunc('month', p_inicio::timestamp),
        date_trunc('month', p_fim::timestamp),
        interval '1 month'
      )::date AS mes
    )

    SELECT jsonb_build_object(
      'atualizado_em', now(),
      'categoria', v_categoria,
      'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim, 'dias', v_dias),

      -- Data do primeiro movimento registrado: a tela usa para avisar que o
      -- controle físico do almoxarifado começou depois dos pedidos.
      'movimento_desde', (
        SELECT min(m.created_at)::date FROM public.sup_estoque_movimento m
         WHERE m.empresa_id = p_empresa_id
      ),

      'filtros', jsonb_build_object(
        'contratos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
            FROM public.contratos c WHERE c.empresa_id = p_empresa_id
        ), '[]'::jsonb),
        'categorias', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('valor', x.tipo, 'nome',
            CASE x.tipo WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes'
                        WHEN 'insumo' THEN 'Insumos' WHEN 'equipamento' THEN 'Equipamentos'
                        ELSE initcap(x.tipo) END) ORDER BY x.tipo)
            FROM (SELECT DISTINCT i.tipo FROM public.sup_item i
                   WHERE i.empresa_id = p_empresa_id AND i.ativo AND i.tipo IS NOT NULL) x
        ), '[]'::jsonb)
      ),

      'resumo', jsonb_build_object(
        'pedidos',           (SELECT count(DISTINCT pedido_id) FROM pedido_item),
        'unidades_pedidas',  COALESCE((SELECT sum(quantidade) FROM pedido_item), 0),
        'valor_pedido',      round(COALESCE((SELECT sum(valor) FROM pedido_item), 0), 2),
        'unidades_sem_tamanho', COALESCE((SELECT sum(quantidade) FROM pedido_item WHERE tamanho IS NULL), 0),
        'unidades_sem_preco',   COALESCE((SELECT sum(quantidade) FROM pedido_item WHERE sem_preco), 0),
        'entradas',          COALESCE((SELECT sum(quantidade) FROM movimento WHERE tipo = 'entrada'), 0),
        'saidas',            COALESCE((SELECT sum(quantidade) FROM movimento WHERE tipo IN ('saida','remocao')), 0),
        'devolucoes',        COALESCE((SELECT sum(quantidade) FROM movimento WHERE tipo = 'devolucao'), 0),
        'saldo_disponivel',  COALESCE((SELECT sum(disponivel) FROM saldo), 0),
        'itens_distintos',   (SELECT count(*) FROM por_peca WHERE pedidas > 0 OR saidas > 0),
        'tamanhos_distintos',(SELECT count(*) FROM por_tamanho_final WHERE pedidas > 0 OR saidas > 0),
        'giro', CASE
          WHEN COALESCE((SELECT sum(disponivel) FROM saldo), 0) > 0
          THEN round(COALESCE((SELECT sum(quantidade) FROM movimento WHERE tipo IN ('saida','remocao')), 0)
                     / (SELECT sum(disponivel) FROM saldo), 2)
        END,
        'tamanho_mais_sai', (
          SELECT jsonb_build_object('tamanho', tamanho, 'unidades', pedidas, 'percentual', pct_pedidas)
            FROM por_tamanho_final WHERE pedidas > 0 ORDER BY pedidas DESC, ordem LIMIT 1
        ),
        'tamanho_mais_entra', (
          SELECT jsonb_build_object('tamanho', tamanho, 'unidades', entradas)
            FROM por_tamanho_final WHERE entradas > 0 ORDER BY entradas DESC, ordem LIMIT 1
        ),
        -- O piso de 20 saídas e 10 de saldo não é enfeite: sem ele, um tamanho
        -- com 4 saídas e 1 peça em estoque devolve giro 4,00 e ocupa o cartão
        -- de "maior rotatividade" no lugar dos tamanhos que a operação de fato
        -- movimenta. Se nenhum tamanho atinge o piso, o cartão vem vazio em
        -- vez de mostrar ruído.
        'tamanho_maior_giro', (
          SELECT jsonb_build_object(
                   'tamanho', tamanho, 'giro', giro,
                   'saldo', saldo_disponivel, 'saidas', saidas
                 )
            FROM por_tamanho_final
           WHERE giro IS NOT NULL AND saidas >= 20 AND saldo_disponivel >= 10
           ORDER BY giro DESC, ordem LIMIT 1
        ),
        'peca_mais_sai', (
          SELECT jsonb_build_object('peca', peca, 'unidades', pedidas)
            FROM por_peca WHERE pedidas > 0 ORDER BY pedidas DESC, peca LIMIT 1
        ),
        'tamanhos_zerados', (
          SELECT count(*) FROM por_tamanho_final WHERE pedidas > 0 AND saldo_disponivel = 0
        )
      ),

      'por_tamanho', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tamanho', tamanho, 'ordem', ordem,
                 'pedidas', pedidas, 'valor_pedido', round(valor_pedido, 2),
                 'entradas', entradas, 'saidas', saidas, 'devolucoes', devolucoes,
                 'saldo_disponivel', saldo_disponivel, 'reservado', reservado,
                 'giro', giro, 'dias_cobertura', dias_cobertura,
                 'pct_pedidas', pct_pedidas,
                 'declarado_pessoas', declarado_pessoas, 'pct_declarado', pct_declarado
               ) ORDER BY ordem)
          FROM por_tamanho_final
      ), '[]'::jsonb),

      'por_peca', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'peca', peca, 'pedidas', pedidas, 'valor_pedido', round(valor_pedido, 2),
                 'entradas', entradas, 'saidas', saidas,
                 'saldo_disponivel', saldo_disponivel, 'tamanho_top', tamanho_top,
                 'giro', CASE WHEN saldo_disponivel > 0 THEN round(saidas / saldo_disponivel, 2) END
               ) ORDER BY pedidas DESC, saidas DESC, peca)
          FROM por_peca WHERE pedidas > 0 OR saidas > 0
      ), '[]'::jsonb),

      'por_contrato', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.unidades DESC)
          FROM (
            SELECT p.contrato AS contrato,
                   p.contrato_id,
                   count(DISTINCT p.pedido_id)::int AS pedidos,
                   sum(p.quantidade)                AS unidades,
                   round(sum(p.valor), 2)           AS valor,
                   (SELECT q.tamanho FROM pedido_item q
                     WHERE q.contrato = p.contrato AND q.tamanho IS NOT NULL
                     GROUP BY q.tamanho ORDER BY sum(q.quantidade) DESC, q.tamanho LIMIT 1
                   ) AS tamanho_top
              FROM pedido_item p
             GROUP BY p.contrato, p.contrato_id
             ORDER BY sum(p.quantidade) DESC
             LIMIT 15
          ) x
      ), '[]'::jsonb),

      'evolucao', COALESCE((
        SELECT jsonb_agg(to_jsonb(x) ORDER BY x.mes)
          FROM (
            SELECT to_char(ms.mes, 'YYYY-MM') AS mes,
                   to_char(ms.mes, 'TMMon/YY') AS rotulo,
                   COALESCE((SELECT sum(p.quantidade) FROM pedido_item p
                              WHERE date_trunc('month', p.data_solicitacao) = ms.mes), 0) AS pedidas,
                   round(COALESCE((SELECT sum(p.valor) FROM pedido_item p
                              WHERE date_trunc('month', p.data_solicitacao) = ms.mes), 0), 2) AS valor,
                   COALESCE((SELECT sum(m.quantidade) FROM movimento m
                              WHERE date_trunc('month', m.created_at)::date = ms.mes
                                AND m.tipo = 'entrada'), 0) AS entradas,
                   COALESCE((SELECT sum(m.quantidade) FROM movimento m
                              WHERE date_trunc('month', m.created_at)::date = ms.mes
                                AND m.tipo IN ('saida','remocao')), 0) AS saidas
              FROM meses ms
          ) x
      ), '[]'::jsonb),

      'grade_declarada', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'peca', peca, 'tamanho', tamanho,
                 'ordem', public.sup_tamanho_ordem(tamanho), 'pessoas', pessoas
               ) ORDER BY peca, public.sup_tamanho_ordem(tamanho))
          FROM declarado
      ), '[]'::jsonb),

      'levantamento_resumo', jsonb_build_object(
        'pessoas',       (SELECT count(*) FROM levantamento),
        'respostas',     (SELECT count(*) FROM levantamento_escopo),
        'contratos',     (SELECT count(DISTINCT contrato_id) FROM levantamento WHERE contrato_id IS NOT NULL),
        'sem_contrato',  (SELECT count(*) FROM levantamento WHERE contrato_id IS NULL),
        -- enviado_em é timestamptz e a sessão do PostgREST roda em UTC: sem
        -- converter, uma resposta de 12/10 às 21h vira 13/10 na tela.
        'ultima_resposta', (
          SELECT max(enviado_em AT TIME ZONE 'America/Sao_Paulo')::date
            FROM levantamento_escopo
        )
      ),

      -- Rótulos que existem num lado e não no outro: ou o formulário não
      -- oferece o tamanho que o estoque usa, ou o estoque não tem o tamanho
      -- que a equipe declarou. Os dois casos são achado, não erro de conta.
      'alertas', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) ORDER BY a.ordem)
          FROM (
            SELECT 1 AS ordem, 'grade_sem_declaracao' AS tipo,
                   'Tamanho que sai do estoque e o formulário não oferece' AS titulo,
                   string_agg(tamanho, ', ' ORDER BY ordem) AS detalhe,
                   sum(pedidas)::numeric AS unidades
              FROM por_tamanho_final
             WHERE pedidas > 0 AND declarado_pessoas = 0
               AND public.sup_tamanho_ordem(tamanho) < 1000
            HAVING count(*) > 0
            UNION ALL
            SELECT 2, 'declarado_sem_estoque',
                   'Tamanho que a equipe declarou e não teve saída no período',
                   string_agg(tamanho, ', ' ORDER BY ordem),
                   sum(declarado_pessoas)::numeric
              FROM por_tamanho_final
             WHERE declarado_pessoas > 0 AND pedidas = 0
            HAVING count(*) > 0
            UNION ALL
            SELECT 3, 'sem_preco',
                   'Unidades pedidas sem preço cadastrado no estoque',
                   NULL,
                   COALESCE((SELECT sum(quantidade) FROM pedido_item WHERE sem_preco), 0)
             WHERE COALESCE((SELECT sum(quantidade) FROM pedido_item WHERE sem_preco), 0) > 0
            UNION ALL
            SELECT 4, 'catalogo_duplicado',
                   'Itens do catálogo com nome quase igual (podem ser o mesmo)',
                   (SELECT string_agg(peca_a || ' / ' || peca_b, ' · ') FROM nomes_suspeitos),
                   (SELECT count(*)::numeric FROM nomes_suspeitos)
             WHERE EXISTS (SELECT 1 FROM nomes_suspeitos)
          ) a
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_dashboard_rotatividade_estoque(uuid,date,date,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sup_dashboard_rotatividade_estoque(uuid,date,date,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sup_dashboard_rotatividade_estoque(uuid,date,date,uuid,text) TO authenticated;

COMMENT ON FUNCTION public.sup_dashboard_rotatividade_estoque(uuid,date,date,uuid,text) IS
  'Aba "Rotatividade do Estoque" do dashboard de Suprimentos: tamanho que mais sai, mais entra e mais gira, por contrato, peça, valor e mês, comparado com a grade declarada no levantamento de uniformes.';

NOTIFY pgrst, 'reload schema';
