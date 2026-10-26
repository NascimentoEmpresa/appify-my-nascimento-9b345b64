-- =========================================================================
-- FÉRIAS — VENDER DIAS SEM TIRAR AS FÉRIAS (só pela Central de Serviços) (14/10/2026)
--
-- Pablo: "TEM QUE SER POSSÍVEL SOLICITAR A VENDA DE FÉRIAS sem tirar os dias
-- de férias, mas só se for pelo módulo CENTRAL DE SERVIÇOS — os encarregados
-- não podem fazer no módulo Encarregados. Tipo: eu quero vender 10 dias de
-- férias sem tirar minhas férias; fica no sistema vinculado ao meu perfil e
-- histórico que eu vendi 10 dias, agora tenho 20 pra tirar."
--
--   · tipo = 'ferias' (o de sempre: sai, volta, abono opcional) ou 'venda'
--     (só vende: sem data de saída/retorno, dias_ferias = 0);
--   · 'venda' só por quem tem a Central de Serviços › Solicitações
--     (central_servicos_solicitacoes) — o Encarregados não oferece e o banco
--     recusa de quem só tem o Encarregados;
--   · limite: no máximo 10 dias vendidos AVULSOS em 12 meses (o abono da CLT
--     é 1/3 dos 30 dias); quem vendeu avulso só pode tirar 30 − o que vendeu
--     (vendeu 10 → tira até 20) e vender no abono 10 − o que vendeu. O abono
--     de férias anteriores NÃO entra na conta: quem tira férias com abono todo
--     ano, em datas próximas, seria barrado à toa;
--   · "12 meses" porque o ERP não guarda o período aquisitivo de cada um (ele
--     está na Senior): é o recorte que dá para conferir aqui;
--   · contam Pendente e Aprovada (Reprovada/Cancelada liberam o saldo);
--   · ferias_saldo(colaborador) devolve o que já foi vendido e o que sobra,
--     para a tela mostrar e limitar as opções.
-- Histórico e aviso do sino passam a descrever a venda (não tem saída).
-- A regra dos 150 dias (solicitacao_em_aberto) era "um pedido de FÉRIAS":
-- a venda não conta para ela — senão quem vendeu 10 não pediria os 20 —, e
-- uma venda só trava outra venda ainda pendente (tipo 'ferias_venda').
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS"
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'ferias';
ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP CONSTRAINT IF EXISTS ferias_tipo_valido;
ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" ADD CONSTRAINT ferias_tipo_valido CHECK (tipo IN ('ferias', 'venda'));

-- Dias vendidos (venda avulsa + abono) e só os avulsos, nos últimos 12 meses, fora uma solicitação.
CREATE OR REPLACE FUNCTION public.ferias_vendas_12m(p_colaborador bigint, p_excluir bigint DEFAULT NULL)
RETURNS TABLE (vendidos integer, avulsos integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(sum(coalesce(f.dias_vendidos, 0)), 0)::int,
         coalesce(sum(coalesce(f.dias_vendidos, 0)) FILTER (WHERE f.tipo = 'venda'), 0)::int
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.colaborador_id = p_colaborador
     AND (p_excluir IS NULL OR f.id <> p_excluir)
     AND coalesce(f.status, '') NOT IN ('Reprovada', 'Cancelada')
     AND f.criado_em >= now() - interval '12 months';
$$;
REVOKE ALL ON FUNCTION public.ferias_vendas_12m(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- Para a tela: quanto já vendeu e quanto ainda pode vender / tirar.
CREATE OR REPLACE FUNCTION public.ferias_saldo(p_colaborador bigint, p_excluir bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'vendidos_12m', v.vendidos,
    'vendas_avulsas_12m', v.avulsos,
    'pode_vender', greatest(10 - v.avulsos, 0),
    'pode_tirar', greatest(30 - v.avulsos, 0),
    'vendas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'dias', f.dias_vendidos, 'status', f.status, 'criado_em', f.criado_em, 'tipo', f.tipo) ORDER BY f.criado_em DESC)
                          FROM public."SISTEMA_SOLICITACOES_FERIAS" f
                         WHERE f.colaborador_id = p_colaborador AND coalesce(f.dias_vendidos, 0) > 0
                           AND (p_excluir IS NULL OR f.id <> p_excluir)
                           AND coalesce(f.status, '') NOT IN ('Reprovada', 'Cancelada')
                           AND f.criado_em >= now() - interval '12 months'), '[]'::jsonb))
    FROM public.ferias_vendas_12m(p_colaborador, p_excluir) v;
$$;
REVOKE ALL ON FUNCTION public.ferias_saldo(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ferias_saldo(bigint, bigint) TO authenticated;

-- Regras na gravação (a tela também limita, mas quem decide é o banco).
CREATE OR REPLACE FUNCTION public.ferias_valida_venda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v record;
BEGIN
  NEW.tipo := coalesce(NEW.tipo, 'ferias');

  IF NEW.tipo = 'venda' THEN
    IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL
       AND NOT public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar') THEN
      RAISE EXCEPTION 'A venda de dias de férias sem tirar as férias só pode ser pedida pela Central de Serviços › Solicitações.'
        USING ERRCODE = '42501';
    END IF;
    NEW.data_saida := NULL; NEW.data_retorno := NULL; NEW.dias_ferias := 0;
    IF coalesce(NEW.dias_vendidos, 0) < 1 OR NEW.dias_vendidos > 10 THEN
      RAISE EXCEPTION 'Informe de 1 a 10 dias para vender.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Só confere quando muda o que conta (criação ou refazer), não na decisão do RH.
  IF TG_OP = 'INSERT' OR NEW.dias_vendidos IS DISTINCT FROM OLD.dias_vendidos OR NEW.dias_ferias IS DISTINCT FROM OLD.dias_ferias
     OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    IF NEW.colaborador_id IS NOT NULL AND coalesce(NEW.status, 'Pendente') NOT IN ('Reprovada', 'Cancelada') THEN
      SELECT * INTO v FROM public.ferias_vendas_12m(NEW.colaborador_id, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id END);
      IF v.avulsos > 0 AND v.avulsos + coalesce(NEW.dias_vendidos, 0) > 10 THEN
        RAISE EXCEPTION 'Este colaborador já vendeu % dia(s) de férias (sem tirar) nos últimos 12 meses — o máximo é 10 (ainda pode vender %).',
          v.avulsos, greatest(10 - v.avulsos, 0) USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.tipo = 'ferias' AND v.avulsos > 0 AND coalesce(NEW.dias_ferias, 30) > 30 - v.avulsos THEN
        RAISE EXCEPTION 'Este colaborador vendeu % dia(s) de férias nos últimos 12 meses — só pode tirar até % dia(s).',
          v.avulsos, 30 - v.avulsos USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.ferias_valida_venda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ferias_valida_venda ON public."SISTEMA_SOLICITACOES_FERIAS";
CREATE TRIGGER trg_ferias_valida_venda
  BEFORE INSERT OR UPDATE OF tipo, dias_ferias, dias_vendidos, data_saida ON public."SISTEMA_SOLICITACOES_FERIAS"
  FOR EACH ROW EXECUTE FUNCTION public.ferias_valida_venda();

-- Histórico: o "Refeita" descreve a venda (não tem saída).
CREATE OR REPLACE FUNCTION public.ferias_registrar_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_nome text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, 'Criada', NULL, NEW.status, NEW.solicitante_nome, auth.uid(),
            CASE WHEN NEW.tipo = 'venda' THEN 'Venda de ' || NEW.dias_vendidos || ' dia(s) de férias, sem tirar as férias' END);
    RETURN NEW;
  END IF;

  -- Refeita pelo encarregado (16/09/2026): um evento só, mesmo que o status
  -- também tenha mudado (Reprovada → Pendente) — a troca de status faz parte
  -- do refazer, não é uma decisão do RH.
  IF NEW.refeita_em IS DISTINCT FROM OLD.refeita_em AND NEW.refeita_em IS NOT NULL THEN
    -- Cancelada PELO RH (24/09/2026) pode ser refeita a qualquer momento:
    -- o cancelamento costuma vir semanas depois da aprovação.
    IF NOT coalesce(OLD.cancelada_pelo_rh, false)
       AND coalesce(OLD.criado_em, now()) < now() - interval '7 days' THEN
      RAISE EXCEPTION 'Já passou uma semana da solicitação — não é mais possível refazê-la.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'Cancelada' AND NOT coalesce(OLD.cancelada_pelo_rh, false) THEN
      RAISE EXCEPTION 'Solicitação cancelada não pode ser refeita.' USING ERRCODE = 'check_violation';
    END IF;
    v_nome := NULLIF(btrim(coalesce(NEW.solicitante_nome, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, 'Refeita', OLD.status, NEW.status, v_nome, auth.uid(),
            CASE WHEN NEW.tipo = 'venda' THEN 'Venda de ' || NEW.dias_vendidos || ' dia(s) de férias, sem tirar as férias'
                 ELSE 'Saída ' || to_char(NEW.data_saida, 'DD/MM/YYYY') || ' · ' || coalesce(NEW.dias_ferias, 30) || ' dias'
                      || CASE WHEN coalesce(NEW.dias_vendidos, 0) > 0 THEN ' · abono ' || NEW.dias_vendidos || ' dias' ELSE '' END END);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Quem decidiu: a tela grava aprovado_por junto com o status; sem ele,
    -- cai no nome do usuário logado (profiles) e por fim no e-mail.
    -- Cancelamento pelo RH grava cancelada_por (aprovado_por continua sendo
    -- quem APROVOU antes).
    v_nome := NULLIF(btrim(coalesce(CASE WHEN NEW.status = 'Cancelada' AND NEW.cancelada_pelo_rh THEN NEW.cancelada_por END,
                                    NEW.aprovado_por, '')), '');
    IF v_nome IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT coalesce(NULLIF(p.display_name, ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
    END IF;
    INSERT INTO public."SISTEMA_SOLICITACOES_FERIAS_HISTORICO" (solicitacao_id, evento, de_status, para_status, por_nome, por_user_id, motivo)
    VALUES (NEW.id, NEW.status, OLD.status, NEW.status, v_nome, auth.uid(),
            CASE WHEN NEW.status = 'Reprovada' THEN NULLIF(btrim(coalesce(NEW.motivo_reprovacao, '')), '')
                 WHEN NEW.status = 'Cancelada' THEN NULLIF(btrim(coalesce(NEW.motivo_cancelamento, '')), '') END);
  END IF;
  RETURN NEW;
END $function$;

-- Sino do RH: venda aparece como venda.
CREATE OR REPLACE FUNCTION public.sino_ferias_notificar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Pendente' THEN
    PERFORM public.jur_notificar(public.jur_quem_tem('rh_ferias', 'alterar'),
      CASE WHEN NEW.tipo = 'venda' THEN CASE WHEN TG_OP = 'UPDATE' THEN 'Venda de férias reenviada' ELSE 'Nova venda de férias (sem tirar)' END
           WHEN TG_OP = 'UPDATE' THEN 'Solicitação de férias reenviada' ELSE 'Nova solicitação de férias' END,
      '#' || NEW.id || ' · ' || coalesce(NEW.colaborador_nome, '—')
        || CASE WHEN NEW.tipo = 'venda' THEN ' — vender ' || NEW.dias_vendidos || ' dia(s), sem tirar as férias'
                ELSE coalesce(' — saída ' || to_char(NEW.data_saida::date, 'DD/MM/YYYY'), '') || coalesce(', ' || NEW.dias_ferias || ' dias', '') END
        || coalesce(' · pedido por ' || nullif(btrim(NEW.solicitante_nome), ''), ''),
      'info', '/app/rh/ferias');
  END IF;
  RETURN NEW;
END $function$;

-- Duplicidade (regra dos 150 dias): a venda sem tirar NÃO trava férias; venda trava só outra venda pendente.
CREATE OR REPLACE FUNCTION public.solicitacao_em_aberto(p_tipo text, p_colaborador_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
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
    SELECT id, status, criado_em, data_saida INTO r
      FROM public."SISTEMA_SOLICITACOES_FERIAS"
     WHERE colaborador_id = p_colaborador_id
       AND status NOT IN ('Reprovada', 'Cancelada')
       AND coalesce(tipo, 'ferias') <> 'venda'   -- venda sem tirar não trava férias (mig 20261014000043)
       AND criado_em >= now() - interval '150 days'
     ORDER BY criado_em DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'tipo', 'ferias', 'id', r.id, 'status', r.status, 'criado_em', r.criado_em,
        'mensagem', format('Este colaborador já tem solicitação de férias nos últimos 150 dias (#%s, %s, saída em %s).',
                           r.id, r.status, to_char(r.data_saida, 'DD/MM/YYYY')));
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

-- O gatilho de duplicidade da tabela de férias olha a venda como "ferias_venda".
CREATE OR REPLACE FUNCTION public.solicitacao_bloqueia_duplicada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  dup jsonb;
  v_tipo text := TG_ARGV[0];
BEGIN
  -- to_jsonb: as outras tabelas não têm a coluna tipo.
  IF v_tipo = 'ferias' AND to_jsonb(NEW)->>'tipo' = 'venda' THEN v_tipo := 'ferias_venda'; END IF;
  dup := public.solicitacao_em_aberto(v_tipo, NEW.colaborador_id);
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION '%', dup->>'mensagem';
  END IF;
  RETURN NEW;
END $function$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_ferias_valida_venda ON public."SISTEMA_SOLICITACOES_FERIAS";
-- DROP FUNCTION IF EXISTS public.ferias_valida_venda(), public.ferias_saldo(bigint, bigint), public.ferias_vendas_12m(bigint, bigint);
-- ALTER TABLE public."SISTEMA_SOLICITACOES_FERIAS" DROP CONSTRAINT IF EXISTS ferias_tipo_valido, DROP COLUMN IF EXISTS tipo;
-- ferias_registrar_historico / sino_ferias_notificar: reaplicar as versões anteriores (sem o ramo 'venda').
-- NOTIFY pgrst, 'reload schema';
