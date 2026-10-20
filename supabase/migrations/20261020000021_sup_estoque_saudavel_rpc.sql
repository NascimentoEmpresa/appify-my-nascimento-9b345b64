-- =========================================================================
-- SUPRIMENTOS › ESTOQUE SAUDÁVEL — a conta (20/10/2026)
--
-- Pedido do gerente de Supply por áudio, sem chamado. O cabeçalho da
-- 20261020000020 tem o pedido transcrito; aqui fica a matemática.
--
-- -------------------------------------------------------------------------
-- A CONTA, E POR QUE CADA PEDAÇO DELA
-- -------------------------------------------------------------------------
--
-- Para cada (item base, tamanho):
--
--   demanda_dia      unidades pedidas na janela ÷ dias em que o item existia
--   dp_mensal        desvio-padrão da demanda entre os meses COMPLETOS
--   dp_leadtime      dp_diário × raiz(prazo de reposição)
--   seguranca        z(nível de serviço) × dp_leadtime
--   ponto_pedido     demanda_dia × prazo + seguranca
--   alvo_saudavel    demanda_dia × (prazo + ciclo de revisão) + seguranca
--   comprar          alvo − disponível − em trânsito        (nunca negativo)
--
-- É reposição por ponto de pedido com estoque de segurança — o modelo de
-- prateleira para item de consumo recorrente. Três escolhas mudam o número e
-- por isso estão explícitas:
--
--   1. A DEMANDA É O PEDIDO, NÃO A SAÍDA FÍSICA.
--      sup_estoque_movimento conta o que o almoxarifado CONSEGUIU entregar.
--      Quem pediu calça M e não tinha calça M não aparece lá — e é
--      exatamente a pessoa que o gerente descreveu "parada em casa, não
--      podendo trabalhar sem uniforme". Dimensionar estoque pela saída física
--      perpetua a falta: falta → não sai → o sistema conclui que não precisa.
--      Então a demanda vem de sup_pedido_item (histórico desde 17/03/2026) e
--      a saída física entra como coluna de conferência, não como base.
--
--   2. SÓ CONTRATO ATIVO ENTRA.
--      "pra atender os colaboradores que a gente já tem hoje, os contratos
--      que a gente já tem hoje. Quando a gente for pegar contrato novo, vai
--      ter que fazer um pedido pra aquele contrato específico". Demanda de
--      contrato encerrado infla o alvo e manda comprar para um quadro que não
--      existe mais. O que foi descartado por isso vem no payload
--      (`demanda_fora_de_escopo`) para a tela poder dizer quanto ficou de
--      fora, em vez de o número encolher sem explicação.
--
--   3. O DENOMINADOR DA MÉDIA É A VIDA DO ITEM, NÃO A JANELA.
--      Item que só começou a ser pedido há dois meses, dividido por seis
--      meses de janela, devolve um terço da demanda real e nasce com alvo
--      baixo — justo o item novo, que é onde falta. Então cada item divide
--      pelos dias em que ele já existia dentro da janela.
--
-- O desvio-padrão sai só dos meses COMPLETOS: o mês corrente está no meio e
-- entraria como queda de demanda, inflando a variabilidade e, com ela, o
-- estoque de segurança. A média, não — ela divide unidades por dias
-- corridos, e nisso o mês parcial é neutro.
--
-- -------------------------------------------------------------------------
-- O QUE A IA FAZ, E O QUE ELA NÃO FAZ
-- -------------------------------------------------------------------------
-- Nada nesta função chama modelo de linguagem. Os números são determinísticos
-- e reproduzíveis — é o que permite levá-los para uma negociação de volume.
-- A Edge Function sup-estoque-ia LÊ este payload e escreve a leitura em
-- português (o que priorizar, o que liquidar, o que mudou no mês). Ela não
-- calcula quantidade.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer);
--   DROP FUNCTION IF EXISTS public.sup_z_nivel_servico(numeric);
-- =========================================================================

-- ── 1) z do nível de serviço ─────────────────────────────────────────────
--
-- Inversa da normal padrão. Postgres não tem, e as aproximações fechadas
-- (Acklam, Moro) são precisas mas ilegíveis — ninguém de Suprimentos
-- conferiria o número. Como o nível de serviço é CHECK 0,500–0,999 e na
-- prática gira em 90/95/98/99%, uma tabela dos valores de referência com
-- interpolação linear entre eles erra menos de 0,02 em z, o que move o
-- estoque de segurança em menos de 1 peça na escala deste estoque.
--
-- Tabela conferível em qualquer livro de estatística: z(95%) = 1,645.
CREATE OR REPLACE FUNCTION public.sup_z_nivel_servico(p_nivel numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  WITH tabela(nivel, z) AS (
    VALUES (0.500, 0.000), (0.600, 0.253), (0.700, 0.524), (0.750, 0.674),
           (0.800, 0.842), (0.850, 1.036), (0.900, 1.282), (0.925, 1.440),
           (0.950, 1.645), (0.960, 1.751), (0.970, 1.881), (0.975, 1.960),
           (0.980, 2.054), (0.985, 2.170), (0.990, 2.326), (0.995, 2.576),
           (0.999, 3.090)
  ),
  alvo AS (SELECT LEAST(GREATEST(COALESCE(p_nivel, 0.95), 0.500), 0.999) AS n),
  -- O ponto da tabela imediatamente abaixo e o imediatamente acima.
  baixo AS (SELECT t.nivel, t.z FROM tabela t, alvo WHERE t.nivel <= alvo.n ORDER BY t.nivel DESC LIMIT 1),
  alto  AS (SELECT t.nivel, t.z FROM tabela t, alvo WHERE t.nivel >= alvo.n ORDER BY t.nivel     LIMIT 1)
  SELECT round(
           CASE WHEN alto.nivel = baixo.nivel THEN baixo.z
                ELSE baixo.z + (alto.z - baixo.z)
                              * ((alvo.n - baixo.nivel) / (alto.nivel - baixo.nivel))
           END, 4)
    FROM alvo, baixo, alto;
$function$;

COMMENT ON FUNCTION public.sup_z_nivel_servico(numeric) IS
  'Fator z da normal padrão para um nível de serviço (0,5–0,999), por interpolação da tabela de referência. Usado no estoque de segurança.';

-- ── 2) A RPC do painel ───────────────────────────────────────────────────
--
-- O DROP da assinatura de 5 argumentos não é enfeite: p_limite_itens entrou
-- durante o desenvolvimento, e CREATE OR REPLACE com aridade diferente cria
-- uma SOBRECARGA em vez de substituir. Com as duas vivas, o PostgREST recusa
-- a chamada por ambiguidade ("could not choose the best candidate function")
-- e a aba abre em erro — num banco onde alguém tenha rodado o rascunho.
DROP FUNCTION IF EXISTS public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid);

CREATE OR REPLACE FUNCTION public.sup_estoque_saudavel(
  p_empresa_id      uuid,
  p_janela_meses    integer DEFAULT NULL,   -- NULL = o parâmetro da empresa
  p_contrato_id     uuid    DEFAULT NULL,
  p_categoria       text    DEFAULT 'uniforme',
  p_almoxarifado_id uuid    DEFAULT NULL,
  -- Teto da lista `itens`. A tela usa o padrão (os totais são sobre tudo, e
  -- 500 linhas já é mais do que alguém lê). O fechamento mensal
  -- (sup_estoque_snapshot_gravar) passa um teto alto, porque snapshot
  -- truncado deixaria item sem histórico exatamente no mês em que ele
  -- começou a importar.
  p_limite_itens    integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid        uuid    := auth.uid();
  v_categoria  text    := NULLIF(btrim(lower(COALESCE(p_categoria, ''))), '');
  v_hoje       date    := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_par        record;
  v_janela     integer;
  v_inicio     date;
  v_fim_comp   date;      -- último dia do último mês COMPLETO
  v_dias       integer;
  v_pode_editar boolean;
  -- Data em que o almoxarifado passou a registrar consumo/baixa por item.
  -- Antes dela NÃO HÁ como saber se um pedido foi atendido pelo estoque:
  -- nenhum pedido antigo tem linha em sup_estoque_consumo nem etiqueta
  -- marcada, então TODOS pareceriam "faltou". Sem este corte o ranking de
  -- falta seria 100% ruído do período legado — e é justamente o ranking que
  -- o gerente usa para decidir compra urgente.
  v_corte_at   timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para visualizar o planejamento de estoque.'
      USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  -- Mesma validação de empresa das outras abas do dashboard (20261007000001).
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

  -- Aprovar alvo é a ação 'alterar' do menu fantasma. A tela usa isto para
  -- mostrar ou esconder os botões — a RPC de gravar confere de novo, por
  -- conta própria.
  v_pode_editar := public.can_access(
    v_uid, 'sup_estoque_saudavel', 'alterar'::public.app_acao
  );

  -- Parâmetros: o do tipo filtrado, senão o padrão da empresa, senão o
  -- default do código (empresa sem linha em sup_estoque_parametro).
  SELECT COALESCE(t.lead_time_dias,       d.lead_time_dias,       10)   AS lead_time_dias,
         COALESCE(t.nivel_servico,        d.nivel_servico,        0.95) AS nivel_servico,
         COALESCE(t.ciclo_revisao_dias,   d.ciclo_revisao_dias,   30)   AS ciclo_revisao_dias,
         COALESCE(t.janela_meses,         d.janela_meses,         6)    AS janela_meses,
         COALESCE(t.meses_sem_giro_morto, d.meses_sem_giro_morto, 6)    AS meses_sem_giro_morto,
         COALESCE(t.tolerancia_excesso,   d.tolerancia_excesso,   0.20) AS tolerancia_excesso
    INTO v_par
    FROM (SELECT 1) x
    LEFT JOIN public.sup_estoque_parametro d
           ON d.empresa_id = p_empresa_id AND d.tipo_item IS NULL
    LEFT JOIN public.sup_estoque_parametro t
           ON t.empresa_id = p_empresa_id AND t.tipo_item = v_categoria;

  v_janela   := LEAST(GREATEST(COALESCE(p_janela_meses, v_par.janela_meses), 2), 60);
  v_inicio   := (date_trunc('month', v_hoje) - make_interval(months => v_janela - 1))::date;
  v_fim_comp := (date_trunc('month', v_hoje) - interval '1 day')::date;
  v_dias     := GREATEST((v_hoje - v_inicio) + 1, 1);

  -- O primeiro movimento de almoxarifado da empresa marca quando o controle
  -- físico entrou em operação (04/08/2026 na matriz). Vira o piso do ranking
  -- de falta. Empresa sem movimento nenhum devolve NULL e o ranking sai
  -- vazio, em vez de sair errado.
  SELECT min(m.created_at) INTO v_corte_at
    FROM public.sup_estoque_movimento m
   WHERE m.empresa_id = p_empresa_id;

  RETURN (
    WITH
    -- ------------------------------------------------------------------
    -- Preço unitário: família + tamanho, com média da família como rede.
    -- Mesma cadeia da RPC de rotatividade (20261013000012) e pelo mesmo
    -- motivo: o preço mora no item FILHO ("JAQUETA M") e o pedido aponta
    -- para o BASE ("JAQUETA"). Casar por item_id devolve quase zero.
    -- ------------------------------------------------------------------
    preco_variante AS (
      SELECT COALESCE(i.item_pai_id, i.id)             AS base_id,
             public.sup_tamanho_da_variante(i.tamanho) AS tamanho,
             avg(NULLIF(ei.valor_unitario, 0))         AS valor_unitario,
             sum(ei.estoque_minimo)                    AS minimo_cadastrado
        FROM public.sup_item i
        JOIN public.sup_estoque_item ei
          ON ei.sup_item_id = i.id AND ei.arquivado_em IS NULL
       WHERE i.empresa_id = p_empresa_id
         AND (p_almoxarifado_id IS NULL OR ei.almoxarifado_id = p_almoxarifado_id)
       GROUP BY 1, 2
    ),
    preco_familia AS (
      SELECT base_id, avg(valor_unitario) AS valor_unitario
        FROM preco_variante GROUP BY 1
    ),

    -- ------------------------------------------------------------------
    -- Escopo de contrato: só o que está em operação hoje
    -- ------------------------------------------------------------------
    -- Pedido sem contrato resolvido (contrato_id NULL) CONTA: é demanda real
    -- da operação, só não se sabe de qual contrato. Descartá-lo subestimaria
    -- o alvo por um defeito de cadastro.
    pedido_escopo AS (
      SELECT pe.id, pe.data_solicitacao, pe.contrato_id,
             (pe.contrato_id IS NULL OR ct.status = 'ativo') AS no_escopo
        FROM public.sup_pedido pe
        LEFT JOIN public.contratos ct ON ct.id = pe.contrato_id
       WHERE pe.empresa_id = p_empresa_id
         AND pe.status <> 'CANCELADO'
         AND pe.data_solicitacao BETWEEN v_inicio AND v_hoje
         AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
    ),

    -- ------------------------------------------------------------------
    -- Demanda: item de pedido na janela
    -- ------------------------------------------------------------------
    demanda_item AS (
      SELECT COALESCE(base.id, pi.item_id)                AS base_id,
             COALESCE(base.nome, pi.nome_item)            AS item_nome,
             COALESCE(it.tipo, pi.tipo_item, 'insumo')    AS tipo_item,
             public.sup_tamanho_da_variante(pi.tamanho)   AS tamanho,
             pe.data_solicitacao,
             date_trunc('month', pe.data_solicitacao)::date AS mes,
             pi.quantidade::numeric                       AS quantidade,
             pe.no_escopo
        FROM pedido_escopo pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
       WHERE (v_categoria IS NULL OR COALESCE(it.tipo, pi.tipo_item) = v_categoria)
    ),
    demanda AS (SELECT * FROM demanda_item WHERE no_escopo),

    -- Série mensal só dos meses completos — base do desvio-padrão.
    demanda_mes AS (
      SELECT base_id, tamanho, mes, sum(quantidade) AS unidades
        FROM demanda
       WHERE mes <= date_trunc('month', v_fim_comp)::date
       GROUP BY 1, 2, 3
    ),

    -- ------------------------------------------------------------------
    -- Primeira vez que o item foi pedido — denominador honesto da média
    -- ------------------------------------------------------------------
    -- Lido do histórico INTEIRO, não da janela: um item pedido pela primeira
    -- vez em abril já tem vida longa quando a janela começa em maio, e deve
    -- dividir pela janela cheia.
    nascimento AS (
      SELECT COALESCE(base.id, pi.item_id)              AS base_id,
             public.sup_tamanho_da_variante(pi.tamanho) AS tamanho,
             min(pe.data_solicitacao)                   AS primeiro_pedido
        FROM public.sup_pedido pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
       WHERE pe.empresa_id = p_empresa_id AND pe.status <> 'CANCELADO'
       GROUP BY 1, 2
    ),

    -- ------------------------------------------------------------------
    -- Saída física e última movimentação (conferência e item morto)
    -- ------------------------------------------------------------------
    -- sup_item_id foi acrescentado em 20260907000003 e nasceu NULL nos
    -- movimentos anteriores (o backfill cobriu os que ainda tinham
    -- item_estoque_id vivo). Resolver pelos dois lados recupera o movimento
    -- antigo que um JOIN direto em sup_item_id jogaria fora — e é justamente
    -- o movimento mais velho que diz se um item está morto.
    movimento AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(
               public.sup_tamanho_da_variante(m.tamanho),
               public.sup_tamanho_da_variante(i.tamanho)
             )                             AS tamanho,
             m.tipo,
             m.created_at,
             abs(m.quantidade)::numeric    AS quantidade
        FROM public.sup_estoque_movimento m
        LEFT JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id
        JOIN public.sup_item i ON i.id = COALESCE(m.sup_item_id, ei.sup_item_id)
       WHERE m.empresa_id = p_empresa_id
         -- 'ajuste'/'correcao' são acerto de inventário e viriam como giro
         -- falso; 'reserva'/'liberacao' não movem peça física.
         AND m.tipo IN ('entrada', 'saida', 'devolucao', 'remocao')
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
    ),
    saida_janela AS (
      SELECT base_id, tamanho, sum(quantidade) AS unidades
        FROM movimento
       WHERE tipo IN ('saida', 'remocao')
         AND created_at >= v_inicio::timestamptz
       GROUP BY 1, 2
    ),
    -- Quantas vezes o item foi REPOSTO de fato na janela.
    --
    -- Responde "qual item eu devo comprar reposição mais seguidamente" com
    -- evidência, e não com modelo. A conta teórica (consumo anual ÷ alvo) não
    -- serve para ranking: como o alvo É consumo × (prazo + ciclo), ela
    -- devolve 365/(prazo+ciclo) — o MESMO número para todo item sem estoque
    -- de segurança, 9,1 vezes por ano com os parâmetros padrão. Daria um
    -- ranking plano, que pareceria resposta e não era.
    --
    -- Entradas no mesmo dia contam como UMA reposição: receber um pedido em
    -- três caixas bipadas em sequência é um reabastecimento, não três.
    reposicao AS (
      SELECT base_id, tamanho,
             count(DISTINCT (created_at AT TIME ZONE 'America/Sao_Paulo')::date)::integer AS reposicoes,
             max(created_at)::date AS ultima_reposicao
        FROM movimento
       WHERE tipo = 'entrada'
         AND created_at >= v_inicio::timestamptz
       GROUP BY 1, 2
    ),
    ultima_saida AS (
      SELECT base_id, tamanho, max(created_at)::date AS data
        FROM movimento WHERE tipo IN ('saida', 'remocao')
       GROUP BY 1, 2
    ),
    ultimo_pedido AS (
      SELECT COALESCE(base.id, pi.item_id)              AS base_id,
             public.sup_tamanho_da_variante(pi.tamanho) AS tamanho,
             max(pe.data_solicitacao)                   AS data
        FROM public.sup_pedido pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
       WHERE pe.empresa_id = p_empresa_id AND pe.status <> 'CANCELADO'
       GROUP BY 1, 2
    ),

    -- ------------------------------------------------------------------
    -- Saldo em casa
    -- ------------------------------------------------------------------
    saldo AS (
      SELECT s.sup_item_base_id AS base_id,
             COALESCE(
               public.sup_tamanho_da_variante(s.tamanho),
               public.sup_tamanho_da_variante(i.tamanho)
             )                 AS tamanho,
             sum(COALESCE(s.disponivel, 0))::numeric AS disponivel,
             sum(COALESCE(s.reservado, 0))::numeric  AS reservado,
             sum(COALESCE(s.fisico, 0))::numeric     AS fisico
        FROM public.sup_estoque_saldo s
        JOIN public.sup_item i ON i.id = s.sup_item_id
       WHERE s.empresa_id = p_empresa_id
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
         AND (p_almoxarifado_id IS NULL OR s.almoxarifado_id = p_almoxarifado_id)
       GROUP BY 1, 2
    ),

    -- ------------------------------------------------------------------
    -- Em trânsito: comprado e ainda não recebido
    -- ------------------------------------------------------------------
    -- Sem isto a tela manda comprar de novo o que já está vindo, e o alvo
    -- viraria compra em dobro a cada revisão mensal.
    em_transito AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(
               public.sup_tamanho_da_variante(ci.tamanho),
               public.sup_tamanho_da_variante(i.tamanho)
             )                             AS tamanho,
             -- quantidade é numeric(14,3) (insumo se compra em litro). Peça de
             -- vestuário sai como 5.000 no JSON sem este round, e a tela
             -- mostraria "5,000 em trânsito".
             round(sum(ci.quantidade), 2)  AS quantidade
        FROM public.sup_compra_pedido cp
        JOIN public.sup_compra_pedido_item ci ON ci.pedido_id = cp.id
        JOIN public.sup_item i ON i.id = ci.sup_item_id
       WHERE cp.empresa_id = p_empresa_id
         AND cp.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial')
         AND (v_categoria IS NULL OR i.tipo = v_categoria)
       GROUP BY 1, 2
    ),

    -- ------------------------------------------------------------------
    -- Atendimento: quantas vezes o item foi pedido e NÃO pôde ser entregue
    -- ------------------------------------------------------------------
    -- Responde "qual item tem faltado muito nos pedidos solicitados e
    -- precisamos comprar urgentemente" — a pergunta que a situação atual
    -- (`falta`) não responde, porque ela só vê o estoque de HOJE. Um tamanho
    -- que faltou em quinze pedidos ao longo do semestre e foi reposto ontem
    -- aparece como "saudável" e é, historicamente, o maior problema do
    -- almoxarifado.
    --
    -- O teste de "foi atendido" é COPIADO da view sup_pedido_situacao
    -- (20260930000077): saiu = tem linha em sup_estoque_consumo OU tem
    -- etiqueta única marcada como usada. Copiado de propósito, e não
    -- reinventado, para este número concordar com o que a tela de Separação
    -- mostra — dois jeitos de contar atendimento divergiriam e ninguém
    -- saberia qual acreditar.
    --
    -- Só pedido que JÁ PASSOU PELA SEPARAÇÃO entra. Pedido em preparação
    -- ainda não teve a chance de ser atendido, e contá-lo como falta
    -- acusaria falta em tudo que acabou de ser digitado.
    atendimento AS (
      SELECT COALESCE(base.id, pi.item_id)              AS base_id,
             public.sup_tamanho_da_variante(pi.tamanho)  AS tamanho,
             count(*)::integer                           AS vezes_pedido,
             count(*) FILTER (WHERE NOT s.saiu)::integer AS vezes_faltou,
             sum(pi.quantidade) FILTER (WHERE NOT s.saiu)::numeric AS unidades_faltaram,
             max(pe.data_solicitacao) FILTER (WHERE NOT s.saiu) AS ultima_falta
        FROM public.sup_pedido pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.contratos ct  ON ct.id = pe.contrato_id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
        CROSS JOIN LATERAL (
          SELECT (EXISTS (SELECT 1 FROM public.sup_estoque_consumo cc
                           WHERE cc.pedido_item_id = pi.id)
               OR EXISTS (SELECT 1 FROM public.sup_estoque_tag tg
                           WHERE tg.pedido_item_id = pi.id
                             AND tg.tipo = 'unico' AND tg.usado)) AS saiu
        ) s
       WHERE pe.empresa_id = p_empresa_id
         AND v_corte_at IS NOT NULL
         AND pe.created_at >= v_corte_at
         AND pe.status IN ('AGUARDANDO ENVIO', 'AGUARDANDO COMPRA', 'DESPACHADO',
                           'RETIRADO PARA ENTREGA')
         AND (p_contrato_id IS NULL OR pe.contrato_id = p_contrato_id)
         AND (pe.contrato_id IS NULL OR ct.status = 'ativo')
         AND (v_categoria IS NULL OR COALESCE(it.tipo, pi.tipo_item) = v_categoria)
       GROUP BY 1, 2
    ),

    -- ------------------------------------------------------------------
    -- Política aprovada
    -- ------------------------------------------------------------------
    politica AS (
      SELECT pl.sup_item_base_id AS base_id, pl.tamanho,
             pl.alvo_aprovado, pl.minimo_aprovado, pl.lead_time_dias,
             pl.liquidar, pl.liquidar_motivo, pl.fora_do_plano,
             pl.observacao, pl.aprovado_por_nome, pl.aprovado_em
        FROM public.sup_estoque_politica pl
       WHERE pl.empresa_id = p_empresa_id
    ),

    -- ------------------------------------------------------------------
    -- Uma linha por (item, tamanho) — tudo que apareceu em qualquer fonte
    -- ------------------------------------------------------------------
    chaves AS (
      SELECT base_id, tamanho FROM demanda      WHERE base_id IS NOT NULL
      UNION SELECT base_id, tamanho FROM saldo       WHERE base_id IS NOT NULL
      UNION SELECT base_id, tamanho FROM saida_janela WHERE base_id IS NOT NULL
      UNION SELECT base_id, tamanho FROM em_transito WHERE base_id IS NOT NULL
      UNION SELECT base_id, tamanho FROM politica    WHERE base_id IS NOT NULL
      -- Item que faltou mas caiu fora da janela de demanda (janela curta +
      -- falta antiga) continua tendo de aparecer: é informação de compra.
      UNION SELECT base_id, tamanho FROM atendimento WHERE base_id IS NOT NULL
    ),

    base AS (
      SELECT k.base_id,
             k.tamanho,
             COALESCE(it.nome, (SELECT d.item_nome FROM demanda d
                                 WHERE d.base_id = k.base_id LIMIT 1), 'Item sem nome') AS item_nome,
             COALESCE(it.tipo, (SELECT d.tipo_item FROM demanda d
                                 WHERE d.base_id = k.base_id LIMIT 1)) AS tipo_item,
             public.sup_tamanho_ordem(k.tamanho) AS ordem,

             COALESCE(sl.disponivel, 0) AS disponivel,
             COALESCE(sl.reservado, 0)  AS reservado,
             COALESCE(sl.fisico, 0)     AS fisico,
             COALESCE(tr.quantidade, 0) AS em_transito,

             COALESCE((SELECT sum(d.quantidade) FROM demanda d
                        WHERE d.base_id = k.base_id
                          AND d.tamanho IS NOT DISTINCT FROM k.tamanho), 0) AS demanda_janela,
             COALESCE(sj.unidades, 0) AS saida_janela,

             -- Dias em que o item já existia dentro da janela (ver nota 3).
             GREATEST(
               (v_hoje - GREATEST(COALESCE(nc.primeiro_pedido, v_inicio), v_inicio)) + 1,
               1
             )::numeric AS dias_ativos,

             -- Desvio-padrão da demanda entre os meses completos. stddev_samp
             -- de uma única observação é NULL — item com um mês só de vida
             -- não tem variabilidade medida, e entra como 0 (o estoque de
             -- segurança dele fica zerado até haver série). Melhor zero
             -- declarado do que um desvio inventado.
             -- Quantos meses COMPLETOS de histórico este item tem dentro da
             -- janela. Separado do desvio-padrão de propósito: desvio zero
             -- pode ser item novo (um mês só, sem série) OU item
             -- perfeitamente regular (30 peças todo mês, cinco meses
             -- seguidos). São situações opostas — no primeiro o alvo é
             -- provisório, no segundo é o alvo mais confiável que existe — e
             -- o alerta da tela precisa distinguir as duas.
             (
               SELECT count(*)::integer
                 FROM generate_series(
                        GREATEST(date_trunc('month', COALESCE(nc.primeiro_pedido, v_inicio)),
                                 date_trunc('month', v_inicio::timestamp)),
                        date_trunc('month', v_fim_comp::timestamp),
                        interval '1 month'
                      ) g(mes)
             ) AS meses_completos,

             COALESCE((
               SELECT stddev_samp(m.unidades) FROM (
                 -- Meses completos da janela em que o item já existia,
                 -- COM OS ZEROS: mês sem pedido é informação de
                 -- variabilidade, e omiti-lo faria um item que vende em
                 -- um mês e some em cinco parecer regularíssimo.
                 SELECT gs.mes, COALESCE(dm.unidades, 0) AS unidades
                   FROM generate_series(
                          GREATEST(date_trunc('month', COALESCE(nc.primeiro_pedido, v_inicio)),
                                   date_trunc('month', v_inicio::timestamp)),
                          date_trunc('month', v_fim_comp::timestamp),
                          interval '1 month'
                        ) gs(mes)
                   LEFT JOIN demanda_mes dm
                          ON dm.base_id = k.base_id
                         AND dm.tamanho IS NOT DISTINCT FROM k.tamanho
                         AND dm.mes = gs.mes::date
               ) m
             ), 0) AS dp_mensal,

             -- Prazo de reposição: o do item, senão o do tipo/empresa.
             COALESCE(pl.lead_time_dias, v_par.lead_time_dias) AS lead_time_dias,

             COALESCE(pv.valor_unitario, pf.valor_unitario) AS valor_unitario,
             COALESCE(pv.minimo_cadastrado, 0)              AS minimo_cadastrado,

             GREATEST(COALESCE(us.data, '1900-01-01'::date),
                      COALESCE(up.data, '1900-01-01'::date)) AS ultimo_giro,
             us.data AS ultima_saida,
             up.data AS ultimo_pedido,

             COALESCE(rp.reposicoes, 0)        AS reposicoes,
             rp.ultima_reposicao,

             COALESCE(at.vezes_pedido, 0)      AS vezes_pedido,
             COALESCE(at.vezes_faltou, 0)      AS vezes_faltou,
             COALESCE(at.unidades_faltaram, 0) AS unidades_faltaram,
             at.ultima_falta,

             pl.alvo_aprovado, pl.minimo_aprovado,
             COALESCE(pl.liquidar, false)      AS liquidar,
             pl.liquidar_motivo,
             COALESCE(pl.fora_do_plano, false) AS fora_do_plano,
             pl.observacao AS politica_observacao,
             pl.aprovado_por_nome, pl.aprovado_em
        FROM chaves k
        LEFT JOIN public.sup_item it ON it.id = k.base_id
        LEFT JOIN saldo sl        ON sl.base_id = k.base_id AND sl.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN saida_janela sj ON sj.base_id = k.base_id AND sj.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN em_transito tr  ON tr.base_id = k.base_id AND tr.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN nascimento nc   ON nc.base_id = k.base_id AND nc.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN ultima_saida us ON us.base_id = k.base_id AND us.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN ultimo_pedido up ON up.base_id = k.base_id AND up.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN preco_variante pv ON pv.base_id = k.base_id AND pv.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN preco_familia pf  ON pf.base_id = k.base_id
        LEFT JOIN politica pl       ON pl.base_id = k.base_id AND pl.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN atendimento at    ON at.base_id = k.base_id AND at.tamanho IS NOT DISTINCT FROM k.tamanho
        LEFT JOIN reposicao rp      ON rp.base_id = k.base_id AND rp.tamanho IS NOT DISTINCT FROM k.tamanho
    ),

    -- ------------------------------------------------------------------
    -- A conta
    -- ------------------------------------------------------------------
    calculo AS (
      SELECT b.*,
             round(b.demanda_janela / b.dias_ativos, 4) AS demanda_dia,
             round(b.demanda_janela / b.dias_ativos * 30.44, 2) AS demanda_mensal,
             -- dp mensal → diário: um mês tem 30,44 dias em média, e o desvio
             -- escala com a raiz do tempo.
             round(b.dp_mensal / sqrt(30.44::numeric), 4) AS dp_diario,
             public.sup_z_nivel_servico(v_par.nivel_servico) AS z
        FROM base b
    ),
    conta AS (
      -- sqrt() sobre numeric, não sobre integer: sqrt(int) devolve double
      -- precision e contamina a conta inteira de ponto flutuante, fazendo o
      -- mesmo item alternar entre 47 e 48 peças entre execuções.
      SELECT c.*,
             ceil(c.z * c.dp_diario * sqrt(GREATEST(c.lead_time_dias, 1)::numeric))::numeric AS seguranca,
             ceil(c.demanda_dia * c.lead_time_dias
                  + c.z * c.dp_diario * sqrt(GREATEST(c.lead_time_dias, 1)::numeric))::integer AS ponto_pedido_calc,
             ceil(c.demanda_dia * (c.lead_time_dias + v_par.ciclo_revisao_dias)
                  + c.z * c.dp_diario * sqrt(GREATEST(c.lead_time_dias, 1)::numeric))::integer AS alvo_calc,
             CASE WHEN c.demanda_dia > 0
                  THEN round(c.disponivel / c.demanda_dia, 0) END AS cobertura_dias,
             -- Meses desde o último giro (saída física ou pedido). Item que
             -- nunca girou recebe a idade da janela, não "infinito".
             CASE WHEN c.ultimo_giro > '1900-01-01'::date
                  THEN floor((v_hoje - c.ultimo_giro) / 30.44)::integer END AS meses_sem_giro
        FROM calculo c
    ),
    linha AS (
      SELECT t.*,
             -- O alvo que vale: o aprovado manda sobre o calculado.
             COALESCE(t.alvo_aprovado, t.alvo_calc)             AS alvo,
             COALESCE(t.minimo_aprovado, t.ponto_pedido_calc)   AS minimo,
             (t.alvo_aprovado IS NOT NULL)                      AS alvo_e_aprovado
        FROM conta t
    ),
    final AS (
      -- ceil e não cast direto: com insumo em quantidade fracionada,
      -- (alvo − disponível − trânsito) = 9,5 e `::integer` arredonda para 10
      -- em um caso e para 9 em 8,5 (meio para o par). Comprar arredonda para
      -- cima sempre — faltar meia unidade é a falta que esta tela existe para
      -- evitar.
      SELECT l.*,
             ceil(GREATEST(l.alvo - l.disponivel - l.em_transito, 0))::integer AS comprar,
             GREATEST(l.disponivel - round(l.alvo * (1 + v_par.tolerancia_excesso)), 0)::numeric AS excesso,
             -- SITUAÇÃO — a ordem das perguntas é a ordem da urgência:
             --   1. tem gente esperando e não tem peça      → falta
             --   2. não tem giro há meses e tem peça parada  → morto
             --   3. abaixo do mínimo                         → repor
             --   4. acima do alvo + tolerância               → excesso
             --   5. resto                                    → saudável
             -- "morto" vem antes de "repor" de propósito: item sem giro há
             -- seis meses com saldo baixo não é para comprar, é para decidir
             -- se continua no catálogo.
             CASE
               WHEN l.fora_do_plano                                   THEN 'fora_do_plano'
               WHEN l.liquidar                                        THEN 'liquidar'
               WHEN l.disponivel <= 0 AND l.demanda_dia > 0           THEN 'falta'
               WHEN l.disponivel > 0 AND l.demanda_dia = 0
                    AND COALESCE(l.meses_sem_giro, 999) >= v_par.meses_sem_giro_morto THEN 'morto'
               WHEN l.demanda_dia = 0 AND l.disponivel = 0            THEN 'sem_movimento'
               WHEN l.disponivel < COALESCE(l.minimo_aprovado, l.ponto_pedido_calc) THEN 'repor'
               WHEN l.disponivel > round(COALESCE(l.alvo_aprovado, l.alvo_calc) * (1 + v_par.tolerancia_excesso))
                                                                      THEN 'excesso'
               ELSE 'saudavel'
             END AS situacao
        FROM linha l
    ),
    -- Valor: sem preço cadastrado não dá para dizer quanto é dinheiro
    -- parado. A linha continua aparecendo (a quantidade importa), mas o
    -- valor dela fica fora dos totais e o payload conta quantas são.
    valorado AS (
      SELECT f.*,
             -- GIRO ANUAL — "qual item mais roda no meu estoque?"
             -- Quantas vezes o estoque deste item se renova por ano. É o
             -- turnover de livro: consumo anual ÷ o que está em casa.
             -- Compara com o que se TEM.
             CASE WHEN f.disponivel > 0 AND f.demanda_dia > 0
                  THEN round(f.demanda_dia * 365 / f.disponivel, 2) END AS giro_anual,

             -- CICLOS POR ANO — "qual item eu devo comprar reposição mais
             -- seguidamente?" Quantas compras por ano o item exige para se
             -- manter no alvo. Compara com o que se DEVERIA ter, e por isso é
             -- um número diferente do giro: giro alto pode ser só estoque
             -- baixo, enquanto ciclos alto é trabalho de compra recorrente.
             CASE WHEN f.alvo > 0 AND f.demanda_dia > 0
                  THEN round(f.demanda_dia * 365 / f.alvo, 2) END AS ciclos_por_ano,

             -- Com que frequência o pedido deste item não pôde ser atendido.
             CASE WHEN f.vezes_pedido > 0
                  THEN round(100.0 * f.vezes_faltou / f.vezes_pedido, 1) END AS pct_falta,

             round(f.disponivel * COALESCE(f.valor_unitario, 0), 2) AS valor_em_estoque,
             round(f.excesso    * COALESCE(f.valor_unitario, 0), 2) AS valor_excesso,
             round(f.comprar    * COALESCE(f.valor_unitario, 0), 2) AS valor_comprar,
             round(f.demanda_janela * COALESCE(f.valor_unitario, 0), 2) AS valor_consumo,
             (f.valor_unitario IS NULL) AS sem_preco
        FROM final f
    ),

    -- ------------------------------------------------------------------
    -- Curva ABC (valor de consumo) e XYZ (previsibilidade)
    -- ------------------------------------------------------------------
    -- ABC diz onde está o dinheiro; XYZ, se dá para confiar na previsão.
    -- Juntos, dizem onde o estoque de segurança compensa: item AX protege
    -- com pouco, item CZ não vale segurar.
    total_consumo AS (SELECT NULLIF(sum(valor_consumo), 0) AS v FROM valorado),
    abc AS (
      SELECT v.base_id, v.tamanho,
             CASE WHEN v.valor_consumo <= 0 THEN 'C'
                  WHEN acumulado <= 0.80 THEN 'A'
                  WHEN acumulado <= 0.95 THEN 'B'
                  ELSE 'C' END AS classe_abc,
             CASE WHEN v.demanda_mensal <= 0 THEN NULL
                  ELSE round(v.dp_mensal / (v.demanda_janela / GREATEST(v.dias_ativos / 30.44, 1)), 2)
             END AS coef_variacao
        FROM (
          SELECT x.*,
                 sum(x.valor_consumo) OVER (ORDER BY x.valor_consumo DESC,
                                                     x.base_id, x.tamanho)
                   / (SELECT v FROM total_consumo) AS acumulado
            FROM valorado x
        ) v
    ),
    completo AS (
      SELECT v.*, a.classe_abc,
             a.coef_variacao,
             CASE WHEN a.coef_variacao IS NULL THEN NULL
                  WHEN a.coef_variacao <= 0.50 THEN 'X'
                  WHEN a.coef_variacao <= 1.00 THEN 'Y'
                  ELSE 'Z' END AS classe_xyz
        FROM valorado v
        LEFT JOIN abc a ON a.base_id = v.base_id AND a.tamanho IS NOT DISTINCT FROM v.tamanho
    ),

    -- ------------------------------------------------------------------
    -- Consolidação por família — o volume que dá para negociar
    -- ------------------------------------------------------------------
    -- "poder barganhar preço pra pedir uma quantidade, um volume maior": o
    -- fornecedor não negocia 14 calças M, negocia 300 calças. Então a compra
    -- sugerida também vai somada por item base, com a grade por tamanho ao
    -- lado, que é como o pedido sai para a confecção.
    familia AS (
      SELECT c.base_id, c.item_nome, c.tipo_item,
             sum(c.comprar)::integer                  AS comprar,
             round(sum(c.valor_comprar), 2)           AS valor_comprar,
             sum(c.disponivel)                        AS disponivel,
             sum(c.alvo)                              AS alvo,
             round(sum(c.demanda_mensal), 1)          AS demanda_mensal,
             count(*) FILTER (WHERE c.situacao = 'falta')   AS tamanhos_em_falta,
             count(*) FILTER (WHERE c.comprar > 0)          AS tamanhos_a_comprar,
             jsonb_agg(jsonb_build_object(
               'tamanho', c.tamanho, 'ordem', c.ordem,
               'comprar', c.comprar, 'disponivel', c.disponivel, 'alvo', c.alvo
             ) ORDER BY c.ordem) FILTER (WHERE c.comprar > 0) AS grade
        FROM completo c
       WHERE NOT c.fora_do_plano AND NOT c.liquidar
       GROUP BY 1, 2, 3
      HAVING sum(c.comprar) > 0
    ),

    -- ------------------------------------------------------------------
    -- Evolução mês a mês, do snapshot
    -- ------------------------------------------------------------------
    -- Vem da tabela de snapshot, não de recálculo: o alvo de agosto depende
    -- dos parâmetros e da política de agosto. Até o primeiro fechamento a
    -- lista vem vazia e a tela diz isso.
    evolucao AS (
      SELECT to_char(s.competencia, 'YYYY-MM')  AS mes,
             to_char(s.competencia, 'TMMon/YY') AS rotulo,
             sum(s.saldo_disponivel)            AS saldo,
             sum(s.demanda_mes)                 AS demanda,
             sum(s.alvo_calculado)              AS alvo,
             round(sum(s.valor_em_estoque), 2)  AS valor
        FROM public.sup_estoque_snapshot s
       WHERE s.empresa_id = p_empresa_id
         AND (v_categoria IS NULL OR s.tipo_item = v_categoria)
         AND s.competencia >= (date_trunc('month', v_hoje) - interval '13 months')::date
       GROUP BY s.competencia
    )

    SELECT jsonb_build_object(
      'atualizado_em', now(),
      'categoria', v_categoria,
      'pode_editar', v_pode_editar,

      'premissas', jsonb_build_object(
        'lead_time_dias',       v_par.lead_time_dias,
        'nivel_servico',        v_par.nivel_servico,
        'z',                    public.sup_z_nivel_servico(v_par.nivel_servico),
        'ciclo_revisao_dias',   v_par.ciclo_revisao_dias,
        'janela_meses',         v_janela,
        'meses_sem_giro_morto', v_par.meses_sem_giro_morto,
        'tolerancia_excesso',   v_par.tolerancia_excesso,
        'janela_inicio',        v_inicio,
        'janela_fim',           v_hoje,
        'ultimo_mes_completo',  v_fim_comp,
        'dias_janela',          v_dias
      ),

      'filtros', jsonb_build_object(
        'contratos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
            FROM public.contratos c
           WHERE c.empresa_id = p_empresa_id AND c.status = 'ativo'
        ), '[]'::jsonb),
        'categorias', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('valor', x.tipo, 'nome',
            CASE x.tipo WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes'
                        WHEN 'insumo' THEN 'Insumos' WHEN 'equipamento' THEN 'Equipamentos'
                        ELSE initcap(x.tipo) END) ORDER BY x.tipo)
            FROM (SELECT DISTINCT i.tipo FROM public.sup_item i
                   WHERE i.empresa_id = p_empresa_id AND i.ativo AND i.tipo IS NOT NULL) x
        ), '[]'::jsonb),
        'almoxarifados', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome) ORDER BY a.nome)
            FROM public.almoxarifado a WHERE a.empresa_id = p_empresa_id
        ), '[]'::jsonb)
      ),

      'resumo', jsonb_build_object(
        'itens_planejados',  (SELECT count(*) FROM completo WHERE NOT fora_do_plano),
        'valor_em_estoque',  round(COALESCE((SELECT sum(valor_em_estoque) FROM completo), 0), 2),
        'unidades_em_estoque', COALESCE((SELECT sum(disponivel) FROM completo), 0),

        -- "o que a gente tem de dinheiro parado": excesso sobre o alvo +
        -- o que está morto. São dois dinheiros diferentes e vêm separados —
        -- excesso é peça que gira e sobrou, morto é peça que não gira.
        --
        -- O filtro é situacao = 'excesso', não "<> 'morto'". Item morto,
        -- marcado para liquidar ou fora do plano tem alvo zero, logo TODO o
        -- saldo dele aparece como excesso — somá-lo aqui contava o mesmo
        -- dinheiro duas vezes, em `dinheiro_parado` e em `valor_morto`, e
        -- punha o estoque deliberadamente fora do plano na conta de
        -- desperdício. Como item 'saudavel', 'repor' e 'falta' têm excesso
        -- zero por definição, filtrar por 'excesso' não perde nada.
        'dinheiro_parado',   round(COALESCE((SELECT sum(valor_excesso) FROM completo
                                              WHERE situacao = 'excesso'), 0), 2),
        'valor_morto',       round(COALESCE((SELECT sum(valor_em_estoque) FROM completo
                                              WHERE situacao IN ('morto', 'liquidar')), 0), 2),
        'unidades_mortas',   COALESCE((SELECT sum(disponivel) FROM completo
                                         WHERE situacao IN ('morto', 'liquidar')), 0),

        'itens_em_falta',    (SELECT count(*) FROM completo WHERE situacao = 'falta'),
        'itens_a_repor',     (SELECT count(*) FROM completo WHERE situacao = 'repor'),
        'itens_em_excesso',  (SELECT count(*) FROM completo WHERE situacao = 'excesso'),
        'itens_saudaveis',   (SELECT count(*) FROM completo WHERE situacao = 'saudavel'),
        'itens_mortos',      (SELECT count(*) FROM completo WHERE situacao IN ('morto', 'liquidar')),

        -- Mesmo recorte da consolidação por família: item fora do plano ou
        -- marcado para liquidar não entra na compra, senão o total da tela
        -- não fecha com a lista que a pessoa vai mandar para o fornecedor.
        'unidades_a_comprar', COALESCE((SELECT sum(comprar) FROM completo
                                          WHERE NOT fora_do_plano AND NOT liquidar), 0),
        'valor_a_comprar',    round(COALESCE((SELECT sum(valor_comprar) FROM completo
                                          WHERE NOT fora_do_plano AND NOT liquidar), 0), 2),
        -- Histórico de falta: itens que já deixaram pedido sem atendimento.
        -- Diferente de `itens_em_falta`, que é a foto de hoje.
        'itens_que_faltaram', (SELECT count(*) FROM completo WHERE vezes_faltou > 0),
        'pedidos_nao_atendidos', COALESCE((SELECT sum(vezes_faltou) FROM completo), 0),

        'itens_sem_preco',    (SELECT count(*) FROM completo WHERE sem_preco AND disponivel > 0),
        'alvos_aprovados',    (SELECT count(*) FROM completo WHERE alvo_e_aprovado),

        -- Cobertura da operação: quantos dias o estoque de hoje aguenta no
        -- consumo de hoje. É a "previsibilidade" que ele pediu, num número.
        'cobertura_media_dias', (
          SELECT CASE WHEN sum(demanda_dia) > 0
                      THEN round(sum(disponivel) / sum(demanda_dia), 0) END
            FROM completo WHERE NOT fora_do_plano
        ),
        'demanda_mensal_total', round(COALESCE((SELECT sum(demanda_mensal) FROM completo), 0), 1),

        -- Demanda deixada de fora por ser de contrato encerrado. Explícita
        -- para ninguém procurar um número que sumiu.
        'demanda_fora_de_escopo', COALESCE((
          SELECT sum(quantidade) FROM demanda_item WHERE NOT no_escopo
        ), 0),
        'primeiro_movimento', (
          SELECT min(m.created_at)::date FROM public.sup_estoque_movimento m
           WHERE m.empresa_id = p_empresa_id
        )
      ),

      -- A tabela principal. O teto vem de p_limite_itens: os totais acima são sobre
      -- tudo, e 500 linhas já é mais do que alguém lê numa tela — a ordem
      -- põe falta e dinheiro na frente.
      -- DOIS jsonb_build_object concatenados por `||`, e não um só: o Postgres
      -- recusa mais de 100 argumentos numa chamada de função, o que dá 50
      -- pares chave/valor. A linha de item passou disso ao ganhar o histórico
      -- de falta e de reposição, e a RPC inteira falhava com "cannot pass more
      -- than 100 arguments to a function". O `||` mantém o JSON ACHATADO —
      -- aninhar mudaria o tipo no frontend inteiro. Ao acrescentar campo aqui,
      -- ponha no segundo bloco.
      'itens', COALESCE((
        SELECT jsonb_agg(
               jsonb_build_object(
                 'base_id', base_id, 'item', item_nome, 'tamanho', tamanho,
                 'ordem', ordem, 'tipo', tipo_item,
                 'disponivel', disponivel, 'reservado', reservado,
                 'em_transito', em_transito,
                 'demanda_janela', demanda_janela, 'demanda_mensal', demanda_mensal,
                 'demanda_dia', demanda_dia, 'saida_janela', saida_janela,
                 'dp_mensal', round(dp_mensal, 2),
                 'meses_completos', meses_completos,
                 'lead_time_dias', lead_time_dias,
                 'seguranca', seguranca,
                 'ponto_pedido', ponto_pedido_calc, 'alvo_calculado', alvo_calc,
                 'alvo', alvo, 'minimo', minimo, 'alvo_aprovado', alvo_aprovado,
                 'minimo_aprovado', minimo_aprovado,
                 'minimo_cadastrado', minimo_cadastrado,
                 'comprar', comprar, 'excesso', excesso
               )
               || jsonb_build_object(
                 'cobertura_dias', cobertura_dias, 'meses_sem_giro', meses_sem_giro,
                 'giro_anual', giro_anual, 'ciclos_por_ano', ciclos_por_ano,
                 'reposicoes', reposicoes, 'ultima_reposicao', ultima_reposicao,
                 'vezes_pedido', vezes_pedido, 'vezes_faltou', vezes_faltou,
                 'unidades_faltaram', unidades_faltaram,
                 'pct_falta', pct_falta, 'ultima_falta', ultima_falta,
                 'ultima_saida', ultima_saida, 'ultimo_pedido', ultimo_pedido,
                 'valor_unitario', valor_unitario, 'sem_preco', sem_preco,
                 'valor_em_estoque', valor_em_estoque, 'valor_excesso', valor_excesso,
                 'valor_comprar', valor_comprar, 'valor_consumo', valor_consumo,
                 'classe_abc', classe_abc, 'classe_xyz', classe_xyz,
                 'coef_variacao', coef_variacao,
                 'situacao', situacao,
                 'liquidar', liquidar, 'liquidar_motivo', liquidar_motivo,
                 'fora_do_plano', fora_do_plano,
                 'politica_observacao', politica_observacao,
                 'aprovado_por', aprovado_por_nome, 'aprovado_em', aprovado_em
               ) ORDER BY
                 CASE situacao WHEN 'falta' THEN 1 WHEN 'repor' THEN 2
                               WHEN 'morto' THEN 3 WHEN 'liquidar' THEN 4
                               WHEN 'excesso' THEN 5 WHEN 'saudavel' THEN 6
                               ELSE 7 END,
                 valor_comprar DESC, valor_em_estoque DESC, item_nome, ordem)
          FROM (SELECT * FROM completo
                 ORDER BY CASE situacao WHEN 'falta' THEN 1 WHEN 'repor' THEN 2
                                        WHEN 'morto' THEN 3 WHEN 'liquidar' THEN 4
                                        WHEN 'excesso' THEN 5 WHEN 'saudavel' THEN 6
                                        ELSE 7 END,
                          valor_comprar DESC, valor_em_estoque DESC
                 LIMIT GREATEST(COALESCE(p_limite_itens, 500), 1)) c
      ), '[]'::jsonb),

      -- ------------------------------------------------------------------
      -- RANKINGS — as respostas que o assistente da tela precisa ter
      -- ------------------------------------------------------------------
      -- Existem porque a lista `itens` vai TRUNCADA para a IA (o catálogo
      -- inteiro não cabe no prompt), e "qual item mais roda" respondido sobre
      -- uma amostra é uma resposta errada com cara de certa. Estes topos são
      -- calculados sobre o catálogo TODO, no banco, e vão inteiros no prompt
      -- por serem dez linhas cada.
      --
      -- Cada ranking tem um piso de relevância. Sem piso, o primeiro lugar de
      -- "mais roda" é sempre um item com 1 peça em casa e 2 saídas — giro
      -- 730 e nenhuma importância. O piso é a diferença entre um ranking que
      -- orienta compra e um que mostra ruído.
      'rankings', jsonb_build_object(

        -- "Qual item mais roda no meu estoque?"
        'mais_roda', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'item', item_nome, 'tamanho', tamanho,
                   'giro_anual', giro_anual, 'demanda_mensal', demanda_mensal,
                   'disponivel', disponivel, 'cobertura_dias', cobertura_dias,
                   'situacao', situacao
                 ) ORDER BY giro_anual DESC)
            FROM (SELECT * FROM completo
                   WHERE giro_anual IS NOT NULL
                     AND NOT fora_do_plano
                     -- Piso: pelo menos 5 peças em casa e 3 por mês saindo.
                     AND disponivel >= 5 AND demanda_mensal >= 3
                   ORDER BY giro_anual DESC LIMIT 10) x
        ), '[]'::jsonb),

        -- "Qual item eu devo comprar reposição mais seguidamente?"
        -- Ordenado pelas reposições QUE ACONTECERAM, com o consumo como
        -- desempate (e como resposta para quem ainda não tem histórico de
        -- entrada). `ciclos_por_ano` vai ao lado como referência do modelo,
        -- não como critério — ver a nota na CTE `reposicao`.
        'repor_mais_seguido', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'item', item_nome, 'tamanho', tamanho,
                   'reposicoes_na_janela', reposicoes,
                   'dias_entre_reposicoes', CASE WHEN reposicoes > 1
                                                 THEN round(v_dias::numeric / reposicoes) END,
                   'ultima_reposicao', ultima_reposicao,
                   'demanda_mensal', demanda_mensal,
                   'ciclos_por_ano_modelo', ciclos_por_ano,
                   'alvo', alvo, 'disponivel', disponivel, 'comprar', comprar
                 ) ORDER BY reposicoes DESC, demanda_mensal DESC)
            FROM (SELECT * FROM completo
                   WHERE NOT fora_do_plano AND NOT liquidar
                     AND (reposicoes > 0 OR demanda_mensal >= 3)
                   ORDER BY reposicoes DESC, demanda_mensal DESC LIMIT 10) x
        ), '[]'::jsonb),

        -- "Qual item tem faltado muito nos pedidos e precisamos comprar
        --  urgentemente?" Histórico de falta, não a foto de hoje.
        'mais_faltou', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'item', item_nome, 'tamanho', tamanho,
                   'vezes_faltou', vezes_faltou, 'vezes_pedido', vezes_pedido,
                   'pct_falta', pct_falta,
                   'unidades_faltaram', unidades_faltaram,
                   'ultima_falta', ultima_falta,
                   'disponivel', disponivel, 'comprar', comprar,
                   'situacao', situacao
                 ) ORDER BY vezes_faltou DESC, unidades_faltaram DESC)
            FROM (SELECT * FROM completo
                   WHERE vezes_faltou > 0
                   ORDER BY vezes_faltou DESC, unidades_faltaram DESC LIMIT 10) x
        ), '[]'::jsonb),

        -- "Qual item não sai muito, ficando acumulado no estoque?"
        'mais_acumulado', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'item', item_nome, 'tamanho', tamanho,
                   'disponivel', disponivel, 'alvo', alvo,
                   'excesso', excesso,
                   'valor_excesso', valor_excesso,
                   'valor_em_estoque', valor_em_estoque,
                   'demanda_mensal', demanda_mensal,
                   'cobertura_dias', cobertura_dias,
                   'meses_sem_giro', meses_sem_giro,
                   'sem_preco', sem_preco, 'situacao', situacao
                 -- A MESMA ordem do subselect abaixo. Ordens diferentes dentro
                 -- e fora do LIMIT fariam o corte dos 10 seguir um critério e
                 -- a exibição outro — o que já aconteceu aqui: o subselect
                 -- punha item morto na frente e o jsonb_agg reordenava por
                 -- valor, então a lista saía por valor mas escolhida por
                 -- "morto primeiro". Dinheiro parado é o critério único.
                 ) ORDER BY valor_em_estoque DESC NULLS LAST)
            FROM (SELECT * FROM completo
                   WHERE situacao IN ('excesso', 'morto', 'liquidar')
                     AND disponivel > 0
                   ORDER BY valor_em_estoque DESC NULLS LAST LIMIT 10) x
        ), '[]'::jsonb),

        -- O que comprar primeiro: quem já está sem peça, do maior consumo
        -- para o menor, com o histórico de falta ao lado. É a fila de
        -- urgência que junta "está faltando agora" com "já faltou antes".
        'comprar_urgente', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                   'item', item_nome, 'tamanho', tamanho,
                   'disponivel', disponivel, 'em_transito', em_transito,
                   'demanda_mensal', demanda_mensal,
                   'cobertura_dias', cobertura_dias,
                   'comprar', comprar, 'valor_comprar', valor_comprar,
                   'vezes_faltou', vezes_faltou,
                   'lead_time_dias', lead_time_dias,
                   'situacao', situacao
                 ) ORDER BY CASE situacao WHEN 'falta' THEN 0 ELSE 1 END,
                            demanda_mensal DESC)
            FROM (SELECT * FROM completo
                   WHERE situacao IN ('falta', 'repor') AND NOT fora_do_plano
                   ORDER BY CASE situacao WHEN 'falta' THEN 0 ELSE 1 END,
                            demanda_mensal DESC LIMIT 10) x
        ), '[]'::jsonb),

        -- Desde quando dá para afirmar que um pedido "faltou". A tela e a IA
        -- citam esta data junto do ranking de falta.
        'falta_contada_desde', v_corte_at::date,
        'pedidos_avaliados', COALESCE((SELECT sum(vezes_pedido) FROM completo), 0)
      ),

      -- Compra consolidada por família: o volume de negociação.
      'compra_por_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'base_id', base_id, 'item', item_nome, 'tipo', tipo_item,
                 'comprar', comprar, 'valor_comprar', valor_comprar,
                 'disponivel', disponivel, 'alvo', alvo,
                 'demanda_mensal', demanda_mensal,
                 'tamanhos_em_falta', tamanhos_em_falta,
                 'tamanhos_a_comprar', tamanhos_a_comprar,
                 'grade', COALESCE(grade, '[]'::jsonb)
               ) ORDER BY valor_comprar DESC NULLS LAST, comprar DESC)
          FROM familia
      ), '[]'::jsonb),

      -- A lista de liquidação: "elimina do estoque, faz venda".
      'liquidar', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'base_id', base_id, 'item', item_nome, 'tamanho', tamanho,
                 'disponivel', disponivel,
                 'valor_em_estoque', valor_em_estoque,
                 'meses_sem_giro', meses_sem_giro,
                 'ultima_saida', ultima_saida, 'ultimo_pedido', ultimo_pedido,
                 'ja_marcado', liquidar, 'motivo', liquidar_motivo,
                 'sem_preco', sem_preco
               ) ORDER BY valor_em_estoque DESC NULLS LAST, disponivel DESC)
          FROM completo
         WHERE situacao IN ('morto', 'liquidar') AND disponivel > 0
      ), '[]'::jsonb),

      'evolucao', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'mes', mes, 'rotulo', rotulo, 'saldo', saldo,
                 'demanda', demanda, 'alvo', alvo, 'valor', valor
               ) ORDER BY mes)
          FROM evolucao
      ), '[]'::jsonb),

      -- O que trava a confiança no número, dito em vez de escondido.
      'alertas', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) ORDER BY a.ordem)
          FROM (
            SELECT 1 AS ordem, 'falta_agora' AS tipo,
                   'Tamanho com pedido e sem nenhuma peça em casa' AS titulo,
                   (SELECT string_agg(DISTINCT item_nome || ' ' || COALESCE(tamanho, ''), ', ')
                      FROM (SELECT item_nome, tamanho FROM completo
                             WHERE situacao = 'falta'
                             ORDER BY demanda_mensal DESC LIMIT 8) t) AS detalhe,
                   (SELECT count(*)::numeric FROM completo WHERE situacao = 'falta') AS valor
             WHERE EXISTS (SELECT 1 FROM completo WHERE situacao = 'falta')

            UNION ALL
            -- Falta HISTÓRICA, que a situação de hoje esconde: tamanho que
            -- deixou pedido sem atendimento várias vezes e hoje está reposto
            -- aparece como "saudável" na tabela, e é o que mais trava a
            -- operação ao longo do ano.
            SELECT 2 AS ordem, 'faltou_no_passado' AS tipo,
                   'Tamanhos que já deixaram pedido sem atendimento — reveja o alvo deles' AS titulo,
                   (SELECT string_agg(DISTINCT item_nome || ' ' || COALESCE(tamanho, '')
                                      || ' (' || vezes_faltou || 'x)', ', ')
                      FROM (SELECT item_nome, tamanho, vezes_faltou FROM completo
                             WHERE vezes_faltou > 0
                             ORDER BY vezes_faltou DESC LIMIT 8) t) AS detalhe,
                   (SELECT count(*)::numeric FROM completo WHERE vezes_faltou > 0) AS valor
             WHERE EXISTS (SELECT 1 FROM completo WHERE vezes_faltou > 0)

            UNION ALL
            SELECT 2, 'sem_preco',
                   'Itens com saldo e sem preço cadastrado — ficam fora do valor',
                   NULL,
                   (SELECT count(*)::numeric FROM completo WHERE sem_preco AND disponivel > 0)
             WHERE EXISTS (SELECT 1 FROM completo WHERE sem_preco AND disponivel > 0)

            UNION ALL
            SELECT 3, 'historico_curto',
                   'Itens com menos de dois meses completos de histórico — alvo provisório',
                   (SELECT string_agg(DISTINCT item_nome || ' ' || COALESCE(tamanho, ''), ', ')
                      FROM (SELECT item_nome, tamanho FROM completo
                             WHERE meses_completos < 2 AND demanda_janela > 0
                             ORDER BY demanda_janela DESC LIMIT 8) t),
                   (SELECT count(*)::numeric FROM completo
                     WHERE meses_completos < 2 AND demanda_janela > 0)
             WHERE EXISTS (SELECT 1 FROM completo
                            WHERE meses_completos < 2 AND demanda_janela > 0)

            UNION ALL
            SELECT 4, 'sem_snapshot',
                   'Ainda não há fechamento mensal gravado — a comparação mês a mês começa no próximo dia 1º',
                   NULL, 0
             WHERE NOT EXISTS (SELECT 1 FROM evolucao)

            UNION ALL
            SELECT 5, 'minimo_cadastrado_divergente',
                   'Itens cujo mínimo cadastrado no estoque está abaixo do ponto de pedido calculado',
                   NULL,
                   (SELECT count(*)::numeric FROM completo
                     WHERE minimo_cadastrado < ponto_pedido_calc AND demanda_dia > 0)
             WHERE EXISTS (SELECT 1 FROM completo
                            WHERE minimo_cadastrado < ponto_pedido_calc AND demanda_dia > 0)

            UNION ALL
            -- Classe Z = demanda irregular (coeficiente de variação > 1).
            -- Nesses itens o estoque de segurança domina o alvo: uma CALÇA G
            -- com 60 unidades num mês e zero nos outros cinco pede 33 peças
            -- de segurança para um consumo médio de 16/mês. A conta está
            -- certa — irregular exige colchão —, mas é exatamente aqui que
            -- vale alguém olhar antes de aprovar, porque às vezes o pico foi
            -- uma admissão em bloco que não repete.
            SELECT 7, 'demanda_irregular',
                   'Itens de demanda irregular (classe Z) — o alvo é puxado pelo estoque de segurança',
                   (SELECT string_agg(DISTINCT item_nome || ' ' || COALESCE(tamanho, ''), ', ')
                      FROM (SELECT item_nome, tamanho FROM completo
                             WHERE classe_xyz = 'Z'
                             ORDER BY valor_comprar DESC LIMIT 8) t),
                   (SELECT count(*)::numeric FROM completo WHERE classe_xyz = 'Z')
             WHERE EXISTS (SELECT 1 FROM completo WHERE classe_xyz = 'Z')

            UNION ALL
            SELECT 6, 'fora_de_escopo',
                   'Unidades pedidas por contrato já encerrado, deixadas fora do alvo',
                   NULL,
                   COALESCE((SELECT sum(quantidade) FROM demanda_item WHERE NOT no_escopo), 0)
             WHERE COALESCE((SELECT sum(quantidade) FROM demanda_item WHERE NOT no_escopo), 0) > 0
          ) a
      ), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer) TO authenticated;

COMMENT ON FUNCTION public.sup_estoque_saudavel(uuid,integer,uuid,text,uuid,integer) IS
  'Planejamento de estoque por item+tamanho: demanda, estoque de segurança, ponto de pedido, alvo saudável, compra sugerida, dinheiro parado e lista de liquidação. Conta determinística — a IA só lê este resultado.';

NOTIFY pgrst, 'reload schema';
