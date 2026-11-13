-- =====================================================================
-- MONITORAMENTO DE CHAMADOS: NOTA DA I.A DE VERDADE (13/11/2026)
--
-- PEDIDO (Pablo, olhando o ranking de 01/01 a 13/11/2026): "como alguém que
-- abriu DOIS chamados tá em primeiro? e quem abriu 25 tá em segundo? ...
-- essa i.a tá avaliando mal demais todo mundo, tem que avaliar melhor, pegar
-- contexto das ideias, dos chamados e das explicações dos chamados... a
-- Fernanda merecia um 9, ela explica muito bem os chamados dela".
--
-- O QUE HAVIA: nenhuma I.A. O "índice de inteligência" era contagem de
-- palavras-chave no navegador (mig 20261022000180 + lib do front). Média
-- geral 5,2; ninguém passava de ~8.
--
-- O QUE MUDA:
--   1. CHAMADO_SISTEMA_MONITOR_IA guarda, por chamado, a nota da I.A em cada
--      critério + o motivo + um resumo. Quem escreve é a Edge
--      chamado-monitor-ia (service_role), que lê descrição inteira,
--      observações, nomes dos anexos e a conversa (sem nota interna).
--   2. O chamado fica "pendente" ao ser aberto, ao mudar o texto e ao ser
--      concluído (a conversa já terminou). O pg_cron solta 4 por minuto na
--      fila_http — os ~870 chamados atuais levam ~3,5 h, sem rajada na fila
--      (WhatsApp, Ética e novidades dividem o mesmo worker, 25/min) nem na
--      cota da I.A. Mais novo primeiro. A Edge não chama a I.A de novo se o
--      texto não mudou (hash).
--   3. chamados_monitoramento devolve a avaliação ('ia'); o front usa as
--      notas da I.A quando existem e a regra antiga só enquanto não há.
--   4. O ranking passa a ser por média bayesiana (front, lib com teste):
--      quem tem 2 chamados não passa à frente de quem tem 25 bons.
--
-- CUSTO: ~870 chamadas à I.A uma vez (2–4 mil tokens cada) e depois ~2 por
-- chamado novo (abertura e conclusão). Gemini Flash / Groq.
--
-- ROLLBACK:
--   SELECT cron.unschedule('chamado-monitor-ia-lote');
--   DROP TRIGGER IF EXISTS trg_chamado_monitor_ia_marcar ON public."CHAMADO_SISTEMA";
--   DROP FUNCTION IF EXISTS public.chamado_monitor_ia_marcar_trg();
--   DROP FUNCTION IF EXISTS public.chamado_monitor_ia_lote(integer);
--   -- e recriar chamados_monitoramento pela mig 20261022000180.
--   DROP TABLE public."CHAMADO_SISTEMA_MONITOR_IA";
-- =====================================================================
SET lock_timeout = '5s';

-- ── 1) Tabela ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_MONITOR_IA" (
  chamado_id     uuid PRIMARY KEY REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'erro')),
  -- precisa (re)avaliar? A nota pronta anterior continua valendo até a nova chegar.
  pendente       boolean     NOT NULL DEFAULT true,
  pendente_desde timestamptz NOT NULL DEFAULT now(),
  enfileirado_em timestamptz,
  tentativas     integer     NOT NULL DEFAULT 0,
  -- {"clareza_problema":{"nota":9.5,"motivo":"..."}, ...} — chaves = CRITERIOS_IA do _shared.
  criterios      jsonb,
  resumo         text,
  base_hash      text,
  provedor       text,
  modelo         text,
  erro           text,
  avaliado_em    timestamptz,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."CHAMADO_SISTEMA_MONITOR_IA" IS
  'Nota da I.A sobre a qualidade do pedido de cada chamado (Monitoramento de Chamados, mig 20261115000100). Escrita só pela Edge chamado-monitor-ia; lida pela RPC chamados_monitoramento.';
CREATE INDEX IF NOT EXISTS idx_chamado_monitor_ia_pendente
  ON public."CHAMADO_SISTEMA_MONITOR_IA" (pendente_desde) WHERE pendente;

-- Só o banco e a Edge (service_role) mexem; a tela lê pela RPC SECURITY DEFINER.
ALTER TABLE public."CHAMADO_SISTEMA_MONITOR_IA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CHAMADO_SISTEMA_MONITOR_IA" FROM anon, authenticated;

-- ── 2) Marcar pendente (abertura, texto alterado, conclusão) ────────────
CREATE OR REPLACE FUNCTION public.chamado_monitor_ia_marcar_trg()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.assunto IS NOT DISTINCT FROM OLD.assunto
     AND NEW.descricao IS NOT DISTINCT FROM OLD.descricao
     AND NEW.observacoes_solicitante IS NOT DISTINCT FROM OLD.observacoes_solicitante
     AND NOT (NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido') THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public."CHAMADO_SISTEMA_MONITOR_IA" (chamado_id) VALUES (NEW.id)
    ON CONFLICT (chamado_id) DO UPDATE
      SET pendente = true, pendente_desde = now(), enfileirado_em = NULL, tentativas = 0;
  EXCEPTION WHEN OTHERS THEN
    -- Abrir/editar/concluir chamado nunca pode falhar por causa do monitoramento.
    RAISE WARNING 'chamado-monitor-ia não marcado para %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.chamado_monitor_ia_marcar_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_monitor_ia_marcar ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_monitor_ia_marcar
  AFTER INSERT OR UPDATE OF assunto, descricao, observacoes_solicitante, status ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_monitor_ia_marcar_trg();

-- ── 3) Lote: poucos por minuto na fila_http ─────────────────────────────
-- Pendente nunca enfileirado (ou enfileirado há 30 min sem resposta) e erro
-- com menos de 3 tentativas, 30 min depois da última. Mais novo primeiro.
CREATE OR REPLACE FUNCTION public.chamado_monitor_ia_lote(p_qtd integer DEFAULT 4)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT m.chamado_id
      FROM public."CHAMADO_SISTEMA_MONITOR_IA" m
      JOIN public."CHAMADO_SISTEMA" c ON c.id = m.chamado_id AND c.status <> 'cancelado'
     WHERE (m.enfileirado_em IS NULL OR m.enfileirado_em < now() - interval '30 minutes')
       AND (m.pendente OR (m.status = 'erro' AND m.tentativas BETWEEN 1 AND 2))
     ORDER BY c.created_at DESC
     LIMIT greatest(coalesce(p_qtd, 4), 1)
       FOR UPDATE OF m SKIP LOCKED
  LOOP
    PERFORM public.enfileirar_http('chamado-monitor-ia', jsonb_build_object('chamado_id', v_id));
    UPDATE public."CHAMADO_SISTEMA_MONITOR_IA" SET enfileirado_em = now() WHERE chamado_id = v_id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.chamado_monitor_ia_lote(integer) FROM PUBLIC, anon, authenticated;

-- ── 4) Todos os chamados atuais entram na fila (cancelados não) ─────────
INSERT INTO public."CHAMADO_SISTEMA_MONITOR_IA" (chamado_id)
SELECT c.id FROM public."CHAMADO_SISTEMA" c WHERE c.status <> 'cancelado'
ON CONFLICT (chamado_id) DO NOTHING;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('chamado-monitor-ia-lote')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamado-monitor-ia-lote');
    PERFORM cron.schedule('chamado-monitor-ia-lote', '* * * * *',
      $job$SELECT public.chamado_monitor_ia_lote(4);$job$);
  ELSE
    RAISE NOTICE 'pg_cron ausente: rode SELECT public.chamado_monitor_ia_lote(4) a cada minuto.';
  END IF;
END
$cron$;

-- ── 5) RPC da tela: mesmo corpo da mig 20261022000180 + 'ia' ────────────
CREATE OR REPLACE FUNCTION public.chamados_monitoramento(p_de date, p_ate date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(auth.uid(), 'central_servicos_chamados_monitoramento', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Monitoramento de Chamados' USING ERRCODE = '42501';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de THEN RAISE EXCEPTION 'Período inválido.'; END IF;

  WITH ch AS (
    SELECT c.*
      FROM public."CHAMADO_SISTEMA" c
     WHERE (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
  ),
  anx AS (
    SELECT a.chamado_id,
           count(*) FILTER (WHERE a.campo = 'abertura' AND a.evento_id IS NULL)::int AS abertura,
           count(*)::int AS total
      FROM public."CHAMADO_SISTEMA_ANEXO" a JOIN ch ON ch.id = a.chamado_id
     GROUP BY a.chamado_id
  ),
  ev AS (
    SELECT e.chamado_id,
           count(*) FILTER (WHERE e.tipo = 'comentario')::int AS comentarios,
           count(*) FILTER (WHERE e.tipo = 'solicitar_info')::int AS pedidos_info,
           count(*) FILTER (WHERE e.tipo = 'evento' AND e.texto LIKE 'Chamado reaberto%')::int AS reaberturas
      FROM public."CHAMADO_SISTEMA_EVENTO" e JOIN ch ON ch.id = e.chamado_id
     GROUP BY e.chamado_id
  ),
  av AS (
    SELECT a.chamado_id,
           (a.qualidade * 0.30 + a.prazo * 0.20 + a.comunicacao * 0.15
            + a.clareza * 0.10 + a.facilidade * 0.10 + a.satisfacao * 0.15)::numeric(4,2) AS nota
      FROM public."CHAMADO_SISTEMA_AVALIACAO" a JOIN ch ON ch.id = a.chamado_id
  ),
  avd AS (
    SELECT d.chamado_id, d.clareza, d.informacoes
      FROM public."CHAMADO_SISTEMA_AVALIACAO_DEV" d JOIN ch ON ch.id = d.chamado_id
     WHERE d.papel = 'solicitante'
  ),
  aj AS (
    SELECT x.chamado_id, jsonb_object_agg(x.campo, x.valor) AS ajustes
      FROM (SELECT DISTINCT ON (m.chamado_id, m.campo) m.chamado_id, m.campo, m.valor
              FROM public."CHAMADO_SISTEMA_MONITOR_AJUSTE" m JOIN ch ON ch.id = m.chamado_id
             ORDER BY m.chamado_id, m.campo, m.created_at DESC, m.id DESC) x
     GROUP BY x.chamado_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ch.id, 'numero', ch.numero, 'assunto', ch.assunto, 'descricao', ch.descricao,
           'categorias', ch.categorias, 'tipo_solicitacao', ch.tipo_solicitacao, 'prioridade', ch.prioridade,
           'impacto_trabalho', ch.impacto_trabalho, 'urgencia', ch.urgencia,
           'modulo_sistema', ch.modulo_sistema, 'modulo_sistema_outro', ch.modulo_sistema_outro,
           'afeta_usuarios', ch.afeta_usuarios, 'observacoes_solicitante', ch.observacoes_solicitante,
           'solicitante_id', ch.solicitante_id,
           'solicitante_nome', COALESCE(NULLIF(btrim(ch.solicitante_nome), ''), p.display_name),
           'setor', ch.setor, 'status', ch.status, 'prazo_previsto', ch.prazo_previsto,
           'concluido_em', ch.concluido_em, 'created_at', ch.created_at,
           'anexos_abertura', COALESCE(anx.abertura, 0), 'anexos_total', COALESCE(anx.total, 0),
           'comentarios', COALESCE(ev.comentarios, 0), 'pedidos_info', COALESCE(ev.pedidos_info, 0),
           'reaberturas', COALESCE(ev.reaberturas, 0),
           'aval_entrega', av.nota,
           'aval_dev_clareza', avd.clareza, 'aval_dev_informacoes', avd.informacoes,
           'validacao_aprovado', v.presidencia_aprovado, 'validacao_devolucoes', v.devolucoes,
           'ajustes', COALESCE(aj.ajustes, '{}'::jsonb),
           -- Só a avaliação pronta; sem ela o front usa a regra antiga.
           'ia', CASE WHEN mi.criterios IS NOT NULL THEN jsonb_build_object(
                   'criterios', mi.criterios, 'resumo', mi.resumo,
                   'avaliado_em', mi.avaliado_em, 'reavaliando', mi.pendente) END
         ) ORDER BY ch.created_at DESC), '[]'::jsonb)
    INTO r
    FROM ch
    LEFT JOIN public.profiles p ON p.id = ch.solicitante_id
    LEFT JOIN anx ON anx.chamado_id = ch.id
    LEFT JOIN ev  ON ev.chamado_id  = ch.id
    LEFT JOIN av  ON av.chamado_id  = ch.id
    LEFT JOIN avd ON avd.chamado_id = ch.id
    LEFT JOIN public."CHAMADO_SISTEMA_VALIDACAO" v ON v.chamado_id = ch.id
    LEFT JOIN aj  ON aj.chamado_id  = ch.id
    LEFT JOIN public."CHAMADO_SISTEMA_MONITOR_IA" mi ON mi.chamado_id = ch.id;
  RETURN r;
END;
$fn$;
REVOKE ALL ON FUNCTION public.chamados_monitoramento(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamados_monitoramento(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamados_monitoramento(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
