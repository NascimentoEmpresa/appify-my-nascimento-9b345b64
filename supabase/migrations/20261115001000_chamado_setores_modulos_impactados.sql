-- =====================================================================
-- CHAMADOS — Setores impactados e Módulos impactados (13/11/2026)
--
-- POR QUE
-- Pedido de chamado: na abertura (Central de Serviços › Chamados de Sistemas
-- › Abrir Novo Chamado) dava para dizer impacto, urgência, prazo, ambiente e
-- quantos usuários, mas não QUAIS setores e QUAIS módulos do ERP a mudança
-- atinge. Sem isso o time de Sistemas só descobre o alcance real durante o
-- desenvolvimento/teste. Agora são duas seleções múltiplas (opcionais) na
-- abertura, gravadas no chamado e devolvidas ao Monitoramento de Chamados
-- para filtrar/analisar por setor e por módulo.
--
--   1. CHAMADO_SISTEMA.setores_impactados / modulos_impactados (text[]).
--      Setor = mesmo texto do dropdown de setores da empresa
--      (useSetoresEmpresa: SETORES + EMPREGADOS."Setor_ERP"); módulo = o
--      `value` de MODULOS_ERP (src/pages/chamados/types.tsx), como já é o
--      modulo_sistema. Sem FK de propósito: o catálogo de setores é texto.
--   2. chamados_monitoramento(): mesmo corpo da mig 20261115000100, só com
--      as duas chaves novas no JSON.
--
-- Idempotente. ROLLBACK no fim.
-- =====================================================================

-- ── 1. Colunas ───────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS setores_impactados text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS modulos_impactados text[] DEFAULT '{}'::text[];

COMMENT ON COLUMN public."CHAMADO_SISTEMA".setores_impactados IS
  'Setores que a solicitação atinge, escolhidos por quem abriu (texto do catálogo de setores da empresa).';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".modulos_impactados IS
  'Módulos do ERP que a solicitação atinge (value de MODULOS_ERP no front).';

-- ── 2. Monitoramento devolve os dois campos ─────────────────────────
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
           'setores_impactados', COALESCE(ch.setores_impactados, '{}'::text[]),
           'modulos_impactados', COALESCE(ch.modulos_impactados, '{}'::text[]),
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

-- =====================================================================
-- ROLLBACK
--   -- recriar chamados_monitoramento pela mig 20261115000100
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS setores_impactados;
--   ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS modulos_impactados;
-- =====================================================================
