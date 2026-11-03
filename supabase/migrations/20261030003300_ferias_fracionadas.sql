-- =========================================================================
-- FÉRIAS FRACIONADAS — mais de um pedido para o mesmo colaborador (30/10/2026)
--
-- Pablo: "Ao solicitar 20 dias de férias do carlos augusto bruning o sistema
-- está bloqueando porque já tem solicitação, mas preciso solicitar 20 dias
-- pra janeiro, e o segundo período de 10 dias queria em fevereiro mas o
-- sistema bloqueou. Ajusta essa regrinha."
--
-- A trava era solicitacao_em_aberto('ferias') (mig 20260930000104, refeita
-- na 20261014000043): UM pedido de férias ativo a cada 150 dias. Pela CLT
-- (art. 134 §1º) as férias podem ser divididas em até 3 períodos — um com
-- pelo menos 14 dias corridos e os outros com pelo menos 5 cada.
--
--   1. ferias_periodos_ciclo(colaborador, excluir): os pedidos de férias do
--      "mesmo ciclo" = ativos (fora Reprovada/Cancelada), tipo 'ferias', com
--      saída, criados nos últimos 150 dias (a janela da trava antiga — o ERP
--      não guarda o período aquisitivo, ele está na Senior).
--   2. ferias_valida_fracionamento (BEFORE INSERT/UPDATE): o pedido novo ou
--      refeito passa se
--        · não se sobrepõe a nenhum outro período ativo (de qualquer data);
--        · férias + abono do ciclo + venda avulsa dos 12 meses ≤ 30;
--        · ≤ 3 períodos, cada um ≥ 5 dias, e um deles ≥ 14 — se nenhum
--          chegou a 14 ainda, tem que sobrar espaço para ele.
--      A mensagem diz o que falta ("sobram 10 dia(s)…", "conflita com as
--      férias de 04/01/2027 a 23/01/2027 (#145)").
--   3. solicitacao_em_aberto('ferias'): deixa de barrar "já tem pedido";
--      barra na escolha do colaborador só quando não cabe mais nenhum
--      período (3 pedidos, ou sobra < 5 dias) e lista o que já foi pedido.
--      Os outros tipos ficam iguais.
--   4. ferias_saldo devolve também os períodos do ciclo e a sobra, para a
--      tela mostrar e conferir antes de enviar (pode_tirar = sobra).
--
-- A mesma regra em src/lib/solicitacoes/feriasFracionamento.ts (com teste).
-- =========================================================================

-- ── 1. Os pedidos do mesmo ciclo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_periodos_ciclo(p_colaborador bigint, p_excluir bigint DEFAULT NULL)
RETURNS TABLE (id bigint, status text, criado_em timestamptz, data_saida date, dias integer, abono integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT f.id, f.status, f.criado_em, f.data_saida,
         coalesce(f.dias_ferias, 30)::int, coalesce(f.dias_vendidos, 0)::int
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.colaborador_id = p_colaborador
     AND (p_excluir IS NULL OR f.id <> p_excluir)
     AND coalesce(f.status, 'Pendente') NOT IN ('Reprovada', 'Cancelada')
     AND coalesce(f.tipo, 'ferias') <> 'venda'
     AND f.data_saida IS NOT NULL
     AND f.criado_em >= now() - interval '150 days'
   ORDER BY f.data_saida;
$$;
REVOKE ALL ON FUNCTION public.ferias_periodos_ciclo(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- ── 2. A regra na gravação ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ferias_valida_fracionamento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_dias    int := coalesce(NEW.dias_ferias, 30);
  v_abono   int := coalesce(NEW.dias_vendidos, 0);
  v_fim     date;
  v_avulsos int;
  v_n       int;
  v_usados  int;
  v_tem14   boolean;
  v_sobra   int;
  c         record;
BEGIN
  IF coalesce(NEW.tipo, 'ferias') = 'venda' OR NEW.colaborador_id IS NULL OR NEW.data_saida IS NULL
     OR coalesce(NEW.status, 'Pendente') IN ('Reprovada', 'Cancelada') THEN
    RETURN NEW;
  END IF;
  -- Só confere quando muda o que conta (criação, refazer, reabrir); a decisão do RH passa.
  IF TG_OP = 'UPDATE'
     AND NEW.data_saida IS NOT DISTINCT FROM OLD.data_saida
     AND NEW.dias_ferias IS NOT DISTINCT FROM OLD.dias_ferias
     AND NEW.dias_vendidos IS NOT DISTINCT FROM OLD.dias_vendidos
     AND NEW.tipo IS NOT DISTINCT FROM OLD.tipo
     AND coalesce(OLD.status, 'Pendente') NOT IN ('Reprovada', 'Cancelada') THEN
    RETURN NEW;
  END IF;

  -- Dois pedidos do mesmo colaborador ao mesmo tempo: o segundo espera e vê o primeiro.
  PERFORM pg_advisory_xact_lock(hashtextextended('ferias_fracionamento|' || NEW.colaborador_id, 0));

  IF v_dias < 5 THEN
    RAISE EXCEPTION 'Cada período de férias tem que ter pelo menos 5 dias.' USING ERRCODE = 'check_violation';
  END IF;

  -- Sobreposição: com qualquer período ativo, não só os do ciclo.
  v_fim := NEW.data_saida + v_dias;   -- dia do retorno
  SELECT f.id, f.data_saida, coalesce(f.dias_ferias, 30) AS dias INTO c
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.colaborador_id = NEW.colaborador_id
     AND f.id <> NEW.id
     AND coalesce(f.status, 'Pendente') NOT IN ('Reprovada', 'Cancelada')
     AND coalesce(f.tipo, 'ferias') <> 'venda'
     AND f.data_saida IS NOT NULL
     AND NEW.data_saida < f.data_saida + coalesce(f.dias_ferias, 30)
     AND f.data_saida < v_fim
   ORDER BY f.data_saida LIMIT 1;
  IF c.id IS NOT NULL THEN
    RAISE EXCEPTION 'Conflita com as férias de % a % (#%).',
      to_char(c.data_saida, 'DD/MM/YYYY'), to_char(c.data_saida + greatest(c.dias, 1) - 1, 'DD/MM/YYYY'), c.id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*), coalesce(sum(p.dias + p.abono), 0), coalesce(bool_or(p.dias >= 14), false)
    INTO v_n, v_usados, v_tem14
    FROM public.ferias_periodos_ciclo(NEW.colaborador_id, NEW.id) p;
  SELECT v.avulsos INTO v_avulsos FROM public.ferias_vendas_12m(NEW.colaborador_id, NEW.id) v;
  v_sobra := 30 - coalesce(v_avulsos, 0) - v_usados;

  IF v_n >= 3 THEN
    RAISE EXCEPTION 'Este colaborador já tem 3 períodos de férias pedidos — é o máximo que a CLT permite.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_dias + v_abono > v_sobra THEN
    IF v_sobra <= 0 THEN
      RAISE EXCEPTION 'Este colaborador já tem os 30 dias de férias pedidos.' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'Sobra% % dia(s) de férias para este colaborador (férias + abono) — este pedido tem %.',
      CASE WHEN v_sobra = 1 THEN '' ELSE 'm' END, v_sobra, v_dias + v_abono USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_tem14 AND v_dias < 14 AND (v_n + 1 >= 3 OR v_sobra - v_dias - v_abono < 14) THEN
    RAISE EXCEPTION 'Pela CLT, um dos períodos tem que ter pelo menos 14 dias — com este pedido não sobra espaço para ele. Aumente este período para 14 dias ou mais.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_valida_fracionamento() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_fracionamento ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_fracionamento
  BEFORE INSERT OR UPDATE OF tipo, status, data_saida, dias_ferias, dias_vendidos ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_valida_fracionamento();

-- ── 3. Na escolha do colaborador: barra só quando não cabe mais nada ─────
CREATE OR REPLACE FUNCTION public.solicitacao_em_aberto(p_tipo text, p_colaborador_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  v_n int; v_usados int; v_lista text; v_avulsos int; v_sobra int;
BEGIN
  IF p_colaborador_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_tipo = 'demissao' THEN
    SELECT id, status, criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Cancelada')
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'demissao', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de demissão (#%s, %s, aberta em %s).',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'ferias' THEN
    -- Férias fracionadas (mig 20261030003300): outro pedido pode, desde que caiba.
    -- O detalhe (sobreposição, 14 dias) fica com ferias_valida_fracionamento.
    SELECT count(*), coalesce(sum(p.dias + p.abono), 0),
           string_agg(format('%s a %s, #%s %s', to_char(p.data_saida, 'DD/MM/YYYY'),
                             to_char(p.data_saida + greatest(p.dias, 1) - 1, 'DD/MM/YYYY'), p.id, p.status), '; ' ORDER BY p.data_saida)
      INTO v_n, v_usados, v_lista
      FROM public.ferias_periodos_ciclo(p_colaborador_id) p;
    SELECT v.avulsos INTO v_avulsos FROM public.ferias_vendas_12m(p_colaborador_id) v;
    v_sobra := 30 - coalesce(v_avulsos, 0) - v_usados;
    IF v_n >= 3 OR v_sobra < 5 THEN
      SELECT p.id, p.status, p.criado_em INTO r
        FROM public.ferias_periodos_ciclo(p_colaborador_id) p ORDER BY p.criado_em DESC LIMIT 1;
      RETURN jsonb_build_object(
        'tipo', 'ferias', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', CASE
          WHEN v_n >= 3 THEN format('Este colaborador já tem 3 períodos de férias pedidos (%s) — é o máximo que a CLT permite.', v_lista)
          WHEN v_sobra <= 0 THEN format('Este colaborador já tem os 30 dias de férias pedidos (%s).', v_lista)
          ELSE format('Sobram só %s dia(s) de férias para este colaborador — menos que os 5 de um período (%s).', v_sobra, v_lista)
        END);
    END IF;

  ELSIF p_tipo = 'ferias_venda' THEN
    -- Venda de dias sem tirar (mig 20261014000043): trava só outra VENDA ainda pendente;
    -- o teto de 10 dias em 12 meses fica com ferias_valida_venda.
    SELECT id, status, criado_em, dias_vendidos INTO r
      FROM public."SISTEMA_SOLICITACOES_FERIAS"
     WHERE colaborador_id = p_colaborador_id AND tipo = 'venda' AND status = 'Pendente'
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'ferias_venda', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem uma venda de férias aguardando o RH (#%s, %s dia(s), pedida em %s).',
                           r.id, r.dias_vendidos, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'troca_funcao' THEN
    SELECT id, status, criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Concluída')
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'troca_funcao', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de mudança de função em andamento (#%s, %s, aberta em %s).',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;

  ELSIF p_tipo = 'advertencia' THEN
    SELECT id, status, created_at AS criado_em INTO r
      FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA"
     WHERE colaborador_id = p_colaborador_id
       AND status IN ('Aguardando Aprovação', 'Aguardando Jurídico')
     ORDER BY created_at DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'advertencia', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem advertência aguardando decisão (#%s, %s, aberta em %s). Espere ela ser decidida antes de abrir outra.',
                           r.id, r.status, to_char(r.criado_em, 'DD/MM/YYYY')));
    END IF;
  END IF;

  RETURN NULL;
END $function$;

-- ── 4. Saldo para a tela: + períodos do ciclo e sobra ────────────────────
CREATE OR REPLACE FUNCTION public.ferias_saldo(p_colaborador bigint, p_excluir bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ciclo AS (SELECT * FROM public.ferias_periodos_ciclo(p_colaborador, p_excluir)),
       usados AS (SELECT coalesce(sum(dias + abono), 0)::int AS n FROM ciclo)
  SELECT jsonb_build_object(
    'vendidos_12m', v.vendidos,
    'vendas_avulsas_12m', v.avulsos,
    'pode_vender', greatest(10 - v.avulsos, 0),
    'pode_tirar', greatest(30 - v.avulsos - u.n, 0),
    'sobra', 30 - v.avulsos - u.n,
    'periodos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'saida', c.data_saida,
                                                              'dias', c.dias, 'abono', c.abono) ORDER BY c.data_saida)
                            FROM ciclo c), '[]'::jsonb),
    'vendas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'dias', f.dias_vendidos, 'status', f.status, 'criado_em', f.criado_em, 'tipo', f.tipo) ORDER BY f.criado_em DESC)
                          FROM public."SISTEMA_SOLICITACOES_FERIAS" f
                         WHERE f.colaborador_id = p_colaborador AND coalesce(f.dias_vendidos, 0) > 0
                           AND (p_excluir IS NULL OR f.id <> p_excluir)
                           AND coalesce(f.status, '') NOT IN ('Reprovada', 'Cancelada')
                           AND f.criado_em >= now() - interval '12 months'), '[]'::jsonb))
    FROM public.ferias_vendas_12m(p_colaborador, p_excluir) v, usados u;
$$;
REVOKE ALL ON FUNCTION public.ferias_saldo(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_saldo(bigint, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_ferias_fracionamento ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP FUNCTION IF EXISTS public.ferias_valida_fracionamento();
-- solicitacao_em_aberto e ferias_saldo: reaplicar as versões da mig 20261014000043
-- (a de solicitacao_em_aberto volta a barrar qualquer pedido de férias ativo dos
-- últimos 150 dias); depois DROP FUNCTION IF EXISTS public.ferias_periodos_ciclo(bigint, bigint);
-- NOTIFY pgrst, 'reload schema';
