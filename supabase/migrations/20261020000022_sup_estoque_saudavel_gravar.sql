-- =========================================================================
-- SUPRIMENTOS › ESTOQUE SAUDÁVEL — gravação (20/10/2026)
--
-- Três RPCs, porque as tabelas de 20261020000020 não têm policy de escrita:
--
--   sup_estoque_politica_salvar    aprovar alvo/mínimo, marcar liquidação,
--                                  tirar item do plano. Grava histórico no
--                                  mesmo comando.
--   sup_estoque_parametro_salvar   mudar as premissas (prazo de reposição,
--                                  nível de serviço, ciclo, janela).
--   sup_estoque_snapshot_gravar    o fechamento mensal. É o que torna
--                                  possível o "mês a mês a IA analisando".
--
-- POR QUE NADA ESCREVE EM sup_estoque_item.estoque_minimo AUTOMATICAMENTE
--
-- O mínimo cadastrado em sup_estoque_item é o que dispara aviso de reposição
-- na operação do almoxarifado. Sobrescrevê-lo pela conta faria a tela de
-- planejamento mexer, sozinha, no comportamento de uma tela que não é dela —
-- e um erro de parâmetro (janela de 2 meses num mês de férias coletivas)
-- viraria mínimo errado em todo o catálogo, sem ninguém ter clicado em nada.
-- Então: a política guarda o alvo aprovado, e a tela mostra lado a lado o
-- mínimo cadastrado e o ponto de pedido calculado. Levar um para o outro é
-- clique explícito, item por item, em `p_aplicar_minimo_no_estoque`.
--
-- Idempotente. NÃO SE AUTO-APLICA: rodar no SQL Editor do projeto remoto.
-- =========================================================================

-- ── 1) Aprovar política ──────────────────────────────────────────────────
--
-- p_linhas é um array de objetos:
--   { base_id, tamanho, alvo_aprovado, minimo_aprovado, lead_time_dias,
--     liquidar, liquidar_motivo, fora_do_plano, observacao, alvo_sugerido }
--
-- Campo ausente = "não mexe neste". Campo presente com null = limpa. A
-- distinção importa: a tela aprova o alvo de uma linha sem querer apagar o
-- motivo de liquidação que alguém escreveu ontem.
CREATE OR REPLACE FUNCTION public.sup_estoque_politica_salvar(
  p_empresa_id uuid,
  p_linhas     jsonb,
  p_aplicar_minimo_no_estoque boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_nome      text;
  v_linha     jsonb;
  v_pol       public.sup_estoque_politica;
  v_base      uuid;
  v_tam       text;
  v_item_nome text;
  v_tipo      text;
  v_gravadas  integer := 0;
  v_minimos   integer := 0;
  -- Guardados ANTES de gravar: no caminho do INSERT, `RETURNING *` sobrescreve
  -- v_pol com a linha nova, e o histórico registraria "de 40 para 40".
  v_alvo_ant  integer;
  v_min_ant   integer;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_estoque_saudavel', 'alterar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar alvo de estoque.' USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa é obrigatória.' USING ERRCODE = '22023';
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

  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' OR jsonb_array_length(p_linhas) = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha para gravar.' USING ERRCODE = '22023';
  END IF;

  -- Teto de lote: a tela aprova a página visível, não o catálogo inteiro de
  -- uma vez. Lote gigante tornaria o histórico ilegível e deixaria a
  -- transação longa segurando lock na política.
  IF jsonb_array_length(p_linhas) > 500 THEN
    RAISE EXCEPTION 'Aprove no máximo 500 itens por vez (recebidos %).',
      jsonb_array_length(p_linhas) USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pr.display_name, pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = v_uid;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_base := NULLIF(v_linha->>'base_id', '')::uuid;
    -- Normaliza o tamanho pela mesma função do resto do módulo: "m" digitado
    -- na tela e "M" do catálogo têm de cair na MESMA linha de política,
    -- senão o índice único deixa entrar as duas e o alvo passa a depender de
    -- qual delas a RPC de leitura encontrar primeiro.
    v_tam  := public.sup_tamanho_da_variante(v_linha->>'tamanho');

    IF v_base IS NULL THEN
      RAISE EXCEPTION 'Linha sem base_id: %', v_linha USING ERRCODE = '22023';
    END IF;

    SELECT i.nome, i.tipo INTO v_item_nome, v_tipo
      FROM public.sup_item i
     WHERE i.id = v_base AND i.empresa_id = p_empresa_id;

    IF v_item_nome IS NULL THEN
      RAISE EXCEPTION 'Item % não pertence a esta empresa.', v_base USING ERRCODE = '42501';
    END IF;

    v_pol := NULL;
    SELECT * INTO v_pol FROM public.sup_estoque_politica pl
     WHERE pl.empresa_id = p_empresa_id
       AND pl.sup_item_base_id = v_base
       AND pl.tamanho IS NOT DISTINCT FROM v_tam;

    v_alvo_ant := v_pol.alvo_aprovado;
    v_min_ant  := v_pol.minimo_aprovado;

    IF v_pol.id IS NULL THEN
      INSERT INTO public.sup_estoque_politica
        (empresa_id, sup_item_base_id, tamanho,
         alvo_aprovado, minimo_aprovado, lead_time_dias,
         liquidar, liquidar_motivo, fora_do_plano, observacao,
         aprovado_por, aprovado_por_nome, aprovado_em)
      VALUES
        (p_empresa_id, v_base, v_tam,
         NULLIF(v_linha->>'alvo_aprovado', '')::integer,
         NULLIF(v_linha->>'minimo_aprovado', '')::integer,
         NULLIF(v_linha->>'lead_time_dias', '')::integer,
         COALESCE((v_linha->>'liquidar')::boolean, false),
         NULLIF(v_linha->>'liquidar_motivo', ''),
         COALESCE((v_linha->>'fora_do_plano')::boolean, false),
         NULLIF(v_linha->>'observacao', ''),
         v_uid, v_nome, now())
      RETURNING * INTO v_pol;
    ELSE
      UPDATE public.sup_estoque_politica pl
         SET alvo_aprovado   = CASE WHEN v_linha ? 'alvo_aprovado'
                                    THEN NULLIF(v_linha->>'alvo_aprovado', '')::integer
                                    ELSE pl.alvo_aprovado END,
             minimo_aprovado = CASE WHEN v_linha ? 'minimo_aprovado'
                                    THEN NULLIF(v_linha->>'minimo_aprovado', '')::integer
                                    ELSE pl.minimo_aprovado END,
             lead_time_dias  = CASE WHEN v_linha ? 'lead_time_dias'
                                    THEN NULLIF(v_linha->>'lead_time_dias', '')::integer
                                    ELSE pl.lead_time_dias END,
             liquidar        = CASE WHEN v_linha ? 'liquidar'
                                    THEN COALESCE((v_linha->>'liquidar')::boolean, false)
                                    ELSE pl.liquidar END,
             liquidar_motivo = CASE WHEN v_linha ? 'liquidar_motivo'
                                    THEN NULLIF(v_linha->>'liquidar_motivo', '')
                                    ELSE pl.liquidar_motivo END,
             fora_do_plano   = CASE WHEN v_linha ? 'fora_do_plano'
                                    THEN COALESCE((v_linha->>'fora_do_plano')::boolean, false)
                                    ELSE pl.fora_do_plano END,
             observacao      = CASE WHEN v_linha ? 'observacao'
                                    THEN NULLIF(v_linha->>'observacao', '')
                                    ELSE pl.observacao END,
             aprovado_por      = v_uid,
             aprovado_por_nome = v_nome,
             aprovado_em       = now()
       WHERE pl.id = v_pol.id;
    END IF;

    -- Histórico: uma linha por aprovação, com o que a conta sugeria na hora.
    INSERT INTO public.sup_estoque_politica_historico
      (politica_id, empresa_id, sup_item_base_id, item_nome, tamanho, acao,
       alvo_anterior, alvo_novo, minimo_anterior, minimo_novo, alvo_sugerido,
       observacao, alterado_por, alterado_por_nome)
    VALUES
      (v_pol.id, p_empresa_id, v_base, v_item_nome, v_tam,
       CASE WHEN COALESCE((v_linha->>'liquidar')::boolean, false)      THEN 'liquidar'
            WHEN COALESCE((v_linha->>'fora_do_plano')::boolean, false) THEN 'fora_do_plano'
            ELSE 'alvo' END,
       v_alvo_ant,
       NULLIF(v_linha->>'alvo_aprovado', '')::integer,
       v_min_ant,
       NULLIF(v_linha->>'minimo_aprovado', '')::integer,
       NULLIF(v_linha->>'alvo_sugerido', '')::integer,
       NULLIF(v_linha->>'observacao', ''),
       v_uid, v_nome);

    v_gravadas := v_gravadas + 1;

    -- Levar o mínimo aprovado para o estoque, só quando pedido explicitamente.
    -- Atinge o item FILHO daquele tamanho (é nele que o almoxarifado olha).
    IF p_aplicar_minimo_no_estoque
       AND NULLIF(v_linha->>'minimo_aprovado', '') IS NOT NULL THEN
      UPDATE public.sup_estoque_item ei
         SET estoque_minimo = (v_linha->>'minimo_aprovado')::integer,
             updated_at     = now()
       WHERE ei.empresa_id = p_empresa_id
         AND ei.arquivado_em IS NULL
         AND ei.sup_item_id IN (
           SELECT f.id FROM public.sup_item f
            WHERE f.empresa_id = p_empresa_id
              AND COALESCE(f.item_pai_id, f.id) = v_base
              AND public.sup_tamanho_da_variante(f.tamanho) IS NOT DISTINCT FROM v_tam
         );
      v_minimos := v_minimos + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'gravadas', v_gravadas,
    'minimos_aplicados', v_minimos,
    'por', v_nome,
    'em', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_estoque_politica_salvar(uuid,jsonb,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sup_estoque_politica_salvar(uuid,jsonb,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.sup_estoque_politica_salvar(uuid,jsonb,boolean) TO authenticated;

-- ── 2) Mudar as premissas ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sup_estoque_parametro_salvar(
  p_empresa_id uuid,
  p_payload    jsonb,
  p_tipo_item  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_ant  public.sup_estoque_parametro;
BEGIN
  IF v_uid IS NULL OR NOT public.can_access(
    v_uid, 'sup_estoque_saudavel', 'alterar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para mudar as premissas do estoque.' USING ERRCODE = '42501';
  END IF;

  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Empresa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  IF p_tipo_item IS NOT NULL
     AND p_tipo_item NOT IN ('uniforme', 'epi', 'insumo', 'equipamento') THEN
    RAISE EXCEPTION 'Tipo de item inválido: %', p_tipo_item USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(pr.display_name, pr.email) INTO v_nome
    FROM public.profiles pr WHERE pr.id = v_uid;

  SELECT * INTO v_ant FROM public.sup_estoque_parametro pa
   WHERE pa.empresa_id = p_empresa_id AND pa.tipo_item IS NOT DISTINCT FROM p_tipo_item;

  IF v_ant.id IS NULL THEN
    INSERT INTO public.sup_estoque_parametro (empresa_id, tipo_item) VALUES (p_empresa_id, p_tipo_item)
      RETURNING * INTO v_ant;
  END IF;

  -- Os CHECK da tabela são a validação: nível de serviço 1,5 ou janela de 1
  -- mês são recusados pelo banco com mensagem própria, e não há caminho que
  -- os contorne.
  UPDATE public.sup_estoque_parametro pa
     SET lead_time_dias       = COALESCE(NULLIF(p_payload->>'lead_time_dias', '')::integer, pa.lead_time_dias),
         nivel_servico        = COALESCE(NULLIF(p_payload->>'nivel_servico', '')::numeric, pa.nivel_servico),
         ciclo_revisao_dias   = COALESCE(NULLIF(p_payload->>'ciclo_revisao_dias', '')::integer, pa.ciclo_revisao_dias),
         janela_meses         = COALESCE(NULLIF(p_payload->>'janela_meses', '')::integer, pa.janela_meses),
         meses_sem_giro_morto = COALESCE(NULLIF(p_payload->>'meses_sem_giro_morto', '')::integer, pa.meses_sem_giro_morto),
         tolerancia_excesso   = COALESCE(NULLIF(p_payload->>'tolerancia_excesso', '')::numeric, pa.tolerancia_excesso),
         atualizado_por       = v_uid,
         atualizado_por_nome  = v_nome
   WHERE pa.id = v_ant.id;

  INSERT INTO public.sup_estoque_politica_historico
    (empresa_id, item_nome, acao, observacao, alterado_por, alterado_por_nome)
  VALUES
    (p_empresa_id,
     'Premissas ' || COALESCE(p_tipo_item, 'padrão da empresa'),
     'parametro',
     format('prazo %s→%s dias · nível %s→%s · ciclo %s→%s dias · janela %s→%s meses',
            v_ant.lead_time_dias,     COALESCE(NULLIF(p_payload->>'lead_time_dias', '')::integer, v_ant.lead_time_dias),
            v_ant.nivel_servico,      COALESCE(NULLIF(p_payload->>'nivel_servico', '')::numeric, v_ant.nivel_servico),
            v_ant.ciclo_revisao_dias, COALESCE(NULLIF(p_payload->>'ciclo_revisao_dias', '')::integer, v_ant.ciclo_revisao_dias),
            v_ant.janela_meses,       COALESCE(NULLIF(p_payload->>'janela_meses', '')::integer, v_ant.janela_meses)),
     v_uid, v_nome);

  RETURN to_jsonb((SELECT pa FROM public.sup_estoque_parametro pa WHERE pa.id = v_ant.id));
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_estoque_parametro_salvar(uuid,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sup_estoque_parametro_salvar(uuid,jsonb,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sup_estoque_parametro_salvar(uuid,jsonb,text) TO authenticated;

-- ── 3) Fechamento mensal ─────────────────────────────────────────────────
--
-- Grava uma linha por (competência, item, tamanho) com o retrato do mês.
-- Roda por pg_cron no dia 1º, e pode ser disparada à mão pela tela.
--
-- AUTENTICAÇÃO EM DOIS MODOS, de propósito:
--   · chamada pela tela  → auth.uid() preenchido, cobra a ação 'alterar';
--   · chamada pelo cron  → auth.uid() nulo, e aí passa.
-- O modo 2 não é um buraco: `anon` não tem EXECUTE nesta função (REVOKE
-- abaixo), então uid nulo só acontece em sessão do próprio banco — que é o
-- cron. Sem isso, o job mensal falharia todo dia 1º às 3h com "sem
-- permissão", em silêncio, e o histórico nunca começaria.
--
-- A demanda e a saída DO MÊS não vêm da RPC de leitura (ela devolve a janela
-- inteira) — são recontadas aqui para a competência. O resto (alvo, ponto de
-- pedido, demanda/dia) vem da RPC, para o snapshot guardar exatamente o
-- número que a tela mostrava.
CREATE OR REPLACE FUNCTION public.sup_estoque_snapshot_gravar(
  p_empresa_id  uuid DEFAULT NULL,
  p_competencia date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_comp   date;
  v_fim    date;
  v_emp    uuid;
  v_total  integer := 0;
  v_linhas integer;
  v_emps   integer := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.can_access(
    v_uid, 'sup_estoque_saudavel', 'alterar'::public.app_acao
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gravar o fechamento de estoque.' USING ERRCODE = '42501';
  END IF;

  -- Sem competência = o mês anterior fechado. É o que o cron do dia 1º quer.
  v_comp := date_trunc('month',
              COALESCE(p_competencia,
                       ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '1 month')))::date;
  v_fim  := (v_comp + interval '1 month')::date;

  FOR v_emp IN
    SELECT e.id FROM public.empresas e
     WHERE p_empresa_id IS NULL OR e.id = p_empresa_id
     ORDER BY e.id
  LOOP
    -- Reexecutar o mesmo mês sobrescreve, não duplica: o fechamento pode ter
    -- de ser refeito depois de um acerto de inventário.
    DELETE FROM public.sup_estoque_snapshot s
     WHERE s.empresa_id = v_emp AND s.competencia = v_comp;

    WITH painel AS (
      SELECT public.sup_estoque_saudavel(v_emp, NULL, NULL, NULL, NULL, 100000) AS j
    ),
    item AS (
      SELECT (i->>'base_id')::uuid               AS base_id,
             i->>'item'                          AS item_nome,
             public.sup_tamanho_da_variante(i->>'tamanho') AS tamanho,
             i->>'tipo'                          AS tipo_item,
             COALESCE((i->>'disponivel')::numeric, 0)     AS disponivel,
             COALESCE((i->>'reservado')::numeric, 0)      AS reservado,
             COALESCE((i->>'demanda_dia')::numeric, 0)    AS demanda_dia,
             NULLIF(i->>'alvo_calculado', '')::integer    AS alvo_calculado,
             NULLIF(i->>'ponto_pedido', '')::integer      AS ponto_pedido,
             NULLIF(i->>'alvo_aprovado', '')::integer     AS alvo_aprovado,
             NULLIF(i->>'valor_unitario', '')::numeric    AS valor_unitario,
             COALESCE((i->>'valor_em_estoque')::numeric, 0) AS valor_em_estoque,
             i->>'situacao'                      AS situacao
        FROM painel, jsonb_array_elements(painel.j->'itens') i
    ),
    -- Demanda da competência, recontada. Mesmo recorte de escopo da RPC:
    -- pedido cancelado fora, contrato encerrado fora.
    demanda_comp AS (
      SELECT COALESCE(base.id, pi.item_id)              AS base_id,
             public.sup_tamanho_da_variante(pi.tamanho) AS tamanho,
             sum(pi.quantidade)::numeric                AS unidades
        FROM public.sup_pedido pe
        JOIN public.sup_pedido_item pi ON pi.pedido_id = pe.id
        LEFT JOIN public.contratos ct  ON ct.id = pe.contrato_id
        LEFT JOIN public.sup_item it   ON it.id = pi.item_id
        LEFT JOIN public.sup_item base ON base.id = COALESCE(it.item_pai_id, it.id)
       WHERE pe.empresa_id = v_emp
         AND pe.status <> 'CANCELADO'
         AND pe.data_solicitacao >= v_comp AND pe.data_solicitacao < v_fim
         AND (pe.contrato_id IS NULL OR ct.status = 'ativo')
       GROUP BY 1, 2
    ),
    saida_comp AS (
      SELECT COALESCE(i.item_pai_id, i.id) AS base_id,
             COALESCE(public.sup_tamanho_da_variante(m.tamanho),
                      public.sup_tamanho_da_variante(i.tamanho)) AS tamanho,
             sum(abs(m.quantidade))::numeric AS unidades
        FROM public.sup_estoque_movimento m
        LEFT JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id
        JOIN public.sup_item i ON i.id = COALESCE(m.sup_item_id, ei.sup_item_id)
       WHERE m.empresa_id = v_emp
         AND m.tipo IN ('saida', 'remocao')
         AND m.created_at >= v_comp::timestamptz
         AND m.created_at <  v_fim::timestamptz
       GROUP BY 1, 2
    )
    INSERT INTO public.sup_estoque_snapshot
      (empresa_id, competencia, sup_item_base_id, item_nome, tamanho, tipo_item,
       saldo_disponivel, saldo_reservado, demanda_mes, saida_mes, demanda_dia,
       alvo_calculado, ponto_pedido, alvo_aprovado, valor_unitario,
       valor_em_estoque, situacao)
    SELECT v_emp, v_comp, it.base_id, it.item_nome, it.tamanho, it.tipo_item,
           it.disponivel, it.reservado,
           COALESCE(dc.unidades, 0), COALESCE(sc.unidades, 0), it.demanda_dia,
           it.alvo_calculado, it.ponto_pedido, it.alvo_aprovado, it.valor_unitario,
           it.valor_em_estoque, it.situacao
      FROM item it
      LEFT JOIN demanda_comp dc ON dc.base_id = it.base_id
                               AND dc.tamanho IS NOT DISTINCT FROM it.tamanho
      LEFT JOIN saida_comp sc   ON sc.base_id = it.base_id
                               AND sc.tamanho IS NOT DISTINCT FROM it.tamanho;

    GET DIAGNOSTICS v_linhas = ROW_COUNT;
    v_total := v_total + v_linhas;
    v_emps  := v_emps + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'competencia', v_comp, 'empresas', v_emps, 'linhas', v_total, 'em', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sup_estoque_snapshot_gravar(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sup_estoque_snapshot_gravar(uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.sup_estoque_snapshot_gravar(uuid,date) TO authenticated;

-- ── 4) O cron do dia 1º ──────────────────────────────────────────────────
--
-- Dentro de um bloco com checagem de extensão porque pg_cron existe no
-- Supabase mas NÃO vem num dump/restore (cron.job é tabela de extensão) — o
-- cluster de contingência não tem os jobs. Sem o guard, esta migration
-- quebraria lá, e um fechamento mensal que não roda é um histórico que não
-- existe, descoberto meses depois.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('sup_estoque_fechamento_mensal')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sup_estoque_fechamento_mensal');

    -- 03:10 UTC do dia 1º = 00:10 em Brasília. Depois da virada e antes de
    -- qualquer movimento do dia, para o saldo gravado ser o de fechamento.
    PERFORM cron.schedule(
      'sup_estoque_fechamento_mensal',
      '10 3 1 * *',
      $job$SELECT public.sup_estoque_snapshot_gravar();$job$
    );
    RAISE NOTICE 'pg_cron: job sup_estoque_fechamento_mensal agendado (10 3 1 * *).';
  ELSE
    RAISE NOTICE 'pg_cron ausente — agendar o fechamento mensal à mão neste banco.';
  END IF;
END
$cron$;

COMMENT ON FUNCTION public.sup_estoque_politica_salvar(uuid,jsonb,boolean) IS
  'Aprova alvo/mínimo por item+tamanho, marca liquidação e itens fora do plano, gravando histórico. Só escreve em sup_estoque_item.estoque_minimo quando p_aplicar_minimo_no_estoque é verdadeiro.';
COMMENT ON FUNCTION public.sup_estoque_snapshot_gravar(uuid,date) IS
  'Fechamento mensal do estoque: uma linha por item+tamanho com saldo, demanda e alvo da competência. Agendada no pg_cron para o dia 1º.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       PERFORM cron.unschedule('sup_estoque_fechamento_mensal')
--         WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sup_estoque_fechamento_mensal');
--     END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.sup_estoque_snapshot_gravar(uuid,date);
--   DROP FUNCTION IF EXISTS public.sup_estoque_parametro_salvar(uuid,jsonb,text);
--   DROP FUNCTION IF EXISTS public.sup_estoque_politica_salvar(uuid,jsonb,boolean);
--   NOTIFY pgrst, 'reload schema';
