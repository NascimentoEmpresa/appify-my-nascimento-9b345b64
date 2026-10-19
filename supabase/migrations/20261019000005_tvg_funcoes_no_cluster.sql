-- =========================================================================
-- TVs gerenciais: recria no cluster as funções tvg_* atuais (19/10/2026)
--
-- Pablo (19/10): o dashboard da TV LICITAÇÃO está "com os números diferentes
-- e zerados, bem errado". Na prévia, os 10 cartões vinham vazios, o quadro
-- "Onde agir agora" dizia "Tudo dentro da meta" e o gráfico grande era
-- "Sessões de licitação por mês: ganhas × disputadas".
--
-- Esse gráfico denuncia a causa: é o caminho ANTIGO de tvg_tendencia, e ele
-- só aparece quando tvg_espelho_tendencia devolve NULL, ou seja, quando a
-- fonte do espelho ('licitacoes' → tvg_espelho_licitacoes, mig
-- 20261014000034) não responde. Sem fonte, tvg_espelho_resultado devolve
-- valor NULL em todos os cartões ("Fonte do espelho indisponível"). Nada
-- fica fora da meta, e por isso aparece o "Tudo dentro da meta".
--
-- Por que só no cluster: a replicação lógica que montou o
-- api.grpnascimento.com.br traz LINHAS, não FUNÇÕES. As migrations
-- 20261014000025–46 (todas as TVs viraram espelho do próprio dashboard)
-- foram aplicadas à mão na Supabase antiga no próprio dia 14/10, e o
-- sincronizar-schema.sh mediu "21 tvg_* faltando" no cluster nesse mesmo
-- dia. Na Supabase antiga, a mesma conta dá os números do Painel Executivo
-- (Grupo) em 16/10: R$ 1.257.534.104 participados, 15% de vitória
-- (16 × 89), 496 editais lidos.
--
-- O que este arquivo faz:
--   1. garante as colunas espelho_* (mig 0030) e a TVG_META_EQUIPE (mig
--      20261015000003);
--   2. recria as 47 funções tvg_* com o corpo de pg_get_functiondef da
--      Supabase antiga (a referência das migs 0010–0046, 20261015000003 e
--      20261015000012) e os mesmos GRANTs. Se o cluster tiver uma
--      assinatura velha (outro nome de parâmetro ou outro retorno), a função
--      é trocada. As funções presas a gatilho ou view nunca são derrubadas;
--   3. só nos painéis em que o cluster ficou sem espelho_fonte, aplica o
--      cadastro de referência (fonte do painel, cartões do espelho, quem vai
--      à TV). Painel que já está certo não é tocado.
-- Conserta as 13 TVs gerenciais de uma vez, não só a de Licitação.
--
-- Idempotente: rodar duas vezes dá o mesmo banco.
-- =========================================================================

SET check_function_bodies = off;  -- a ordem entre as funções não importa (uma chama a outra)

-- ── 1. Estrutura de que as funções dependem ─────────────────────────────
ALTER TABLE public."TVG_PAINEL"
  ADD COLUMN IF NOT EXISTS espelho_fonte  text,
  ADD COLUMN IF NOT EXISTS espelho_series text[];
ALTER TABLE public."TVG_INDICADOR"
  ADD COLUMN IF NOT EXISTS espelho_fonte    text,
  ADD COLUMN IF NOT EXISTS espelho_item     text,
  ADD COLUMN IF NOT EXISTS espelho_grafico  text,
  ADD COLUMN IF NOT EXISTS espelho_destaque integer;

CREATE TABLE IF NOT EXISTS public."TVG_META_EQUIPE" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  painel        text NOT NULL DEFAULT 'ger-licitacoes',
  nome          text NOT NULL,
  nomes_capa    text[] NOT NULL DEFAULT '{}',
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tipo          text NOT NULL DEFAULT 'valor' CHECK (tipo IN ('valor', 'contratos')),
  meta          numeric(16,2) NOT NULL CHECK (meta > 0),
  ganhos_desde  date NOT NULL DEFAULT DATE '2026-09-01',
  cor           text,
  ordem         integer NOT NULL DEFAULT 100,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid
);
ALTER TABLE public."TVG_META_EQUIPE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tvg_meta_equipe_select ON public."TVG_META_EQUIPE";
CREATE POLICY tvg_meta_equipe_select ON public."TVG_META_EQUIPE" FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar'));
REVOKE ALL ON public."TVG_META_EQUIPE" FROM anon;

-- ── 2. As funções tvg_*, como estão na Supabase antiga ──────────────────

-- public.tvg_calc(p_codigo text, p_param numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_calc(p_codigo text, p_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
  v_ano int; v_meses int[]; v_painel jsonb; v_comp date; n int;
BEGIN
  IF p_codigo = 'op_postos' THEN
    WITH q AS (SELECT *, greatest(necessarios - trabalhando, 0) AS falta FROM public.tvg_quadro_contratos() WHERE necessarios > 0),
    x AS (SELECT *, least(falta, afastados) AS p_af, least(falta - least(falta, afastados), ferias) AS p_fe FROM q WHERE falta > 0),
    c AS (SELECT sum(p_af) af, sum(p_fe) fe, sum(falta - p_af - p_fe) va FROM x)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(falta) FROM q), 0),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todos os contratos cobertos'
                         ELSE count(*) || ' contrato' || CASE WHEN count(*) > 1 THEN 's' ELSE '' END || ' · maior falta: '
                              || (SELECT contrato || ' (−' || falta || ')' FROM x ORDER BY falta DESC LIMIT 1) END FROM x),
      'causa', (SELECT CASE WHEN COALESCE(af, 0) + COALESCE(fe, 0) + COALESCE(va, 0) = 0 THEN NULL
                            WHEN af >= fe AND af >= va THEN 'Afastamentos (' || af || ' postos)'
                            WHEN fe >= va THEN 'Férias sem cobertura (' || fe || ' postos)'
                            ELSE 'Quadro incompleto — vagas não preenchidas (' || va || ' postos)' END FROM c),
      'base', (SELECT count(*) || ' contratos com quadro e folha' FROM q),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'a', necessarios, 'b', trabalhando, 'valor', falta, 'rotulo', '−' || falta || ' · ' || trabalhando || ' de ' || necessarios)
                                            ORDER BY falta DESC) FROM (SELECT * FROM x ORDER BY falta DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('op_glosas') THEN
    WITH g AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), 'Sem causa registrada') AS causa,
                      coalesce(n.valor_final, n.valor_original, 0) AS v
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.tipo = 'Glosa' AND coalesce(n.resultado, '') <> 'Revertida'
                  AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(v) FROM g), 0),
      'impacto', COALESCE((SELECT sum(v) FROM g), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(*) || ' glosa(s)' FROM g),
      'causa', (SELECT left(causa, 90) FROM g GROUP BY causa ORDER BY sum(v) DESC, count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s, 'rotulo', n || ' glosa(s)') ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s, count(*) n FROM g GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'op_turnover' THEN
    v_ano := extract(year FROM hoje)::int;
    n := greatest(1, least(12, coalesce(p_param, 3)::int));
    v_meses := ARRAY(SELECT m FROM generate_series(greatest(1, extract(month FROM hoje)::int - n + 1), extract(month FROM hoje)::int) m);
    v_painel := public.dir_turnover_painel_dados(v_ano, NULL, NULL, NULL, v_meses);
    WITH pc AS (SELECT x->>'contrato' AS contrato, (x->>'demissoes')::numeric AS dem, nullif((x->>'efetivo_medio')::numeric, 0) AS ef
                  FROM jsonb_array_elements(v_painel->'por_contrato') x),
    t AS (SELECT contrato, round(dem / ef / cardinality(v_meses) * 100, 1) AS taxa, dem FROM pc WHERE ef >= 10)
    SELECT jsonb_build_object(
      'valor', (SELECT round(avg((m->>'taxa')::numeric), 1) FROM jsonb_array_elements(v_painel->'mensal') m WHERE (m->>'taxa') IS NOT NULL),
      'afetado', (SELECT count(*) || ' contrato(s) acima de 5%/mês' || COALESCE(' · pior: ' || (SELECT contrato || ' (' || replace(taxa::text, '.', ',') || '%)' FROM t ORDER BY taxa DESC LIMIT 1), '') FROM t WHERE taxa > 5),
      'causa', (SELECT c->>'causa' FROM jsonb_array_elements(v_painel->'causas') c WHERE c->>'causa' NOT ILIKE '%não informado%' ORDER BY (c->>'n')::int DESC LIMIT 1),
      'base', 'Média mensal de ' || cardinality(v_meses) || ' mês(es) de ' || v_ano,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', taxa, 'rotulo', replace(taxa::text, '.', ',') || '% · ' || dem || ' saída(s)') ORDER BY taxa DESC)
                             FROM (SELECT * FROM t ORDER BY taxa DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_prazo' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma sessão próxima sem proposta' ELSE count(*) FILTER (WHERE dias = 0) || ' hoje · ' || count(*) FILTER (WHERE dias = 1) || ' amanhã' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Proposta ainda não iniciada/concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' dias' END) ORDER BY dias)
                             FROM (SELECT * FROM g ORDER BY dias LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_propostas' THEN
    WITH g AS (SELECT g.fase::text AS fase, coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 7)::int)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN count(*) = 0 THEN 100 ELSE round(100.0 * count(*) FILTER (WHERE fase = 'Em Andamento') / count(*)) END FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE fase <> 'Em Andamento') || ' em elaboração de ' || count(*) || ' com sessão' FROM g),
      'causa', (SELECT CASE WHEN count(*) FILTER (WHERE fase = 'À Iniciar') > 0 THEN count(*) FILTER (WHERE fase = 'À Iniciar') || ' ainda nem iniciada(s)' END FROM g),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', fase || ' · ' || CASE dias WHEN 0 THEN 'hoje' ELSE 'em ' || dias || ' d' END) ORDER BY dias)
                             FROM g WHERE fase <> 'Em Andamento'), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_implantacao' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, hoje - g.data AS dias, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g
                WHERE g.fase::text = 'Finalizada' AND g.posicao = 1 AND g.data >= hoje - coalesce(p_param, 365)::int
                  AND NOT EXISTS (SELECT 1 FROM public.implantacao_contrato i WHERE g.capa_id IS NOT NULL AND i.capa_id = g.capa_id)
                  AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.grade_id = g.id))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todas encaminhadas' ELSE 'Mais antiga: ' || max(dias) || ' dias da sessão' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Sem implantação aberta no ERP' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', dias || ' dias') ORDER BY dias DESC) FROM g), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_perdidas' THEN
    WITH g AS (SELECT coalesce(nullif(btrim(g.status_obs), ''), 'Motivo não registrado') AS motivo
                 FROM public.grade g WHERE g.fase::text = 'Finalizada' AND g.posicao IS DISTINCT FROM 1
                  AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 90)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g),
      'causa', (SELECT left(motivo, 80) || ' (' || count(*) || ')' FROM g GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', left(motivo, 80), 'valor', n) ORDER BY n DESC)
                             FROM (SELECT motivo, count(*) n FROM g GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'lic_valor' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento'))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM g), 0),
      'afetado', (SELECT count(*) || ' processos em disputa' FROM g),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC) FROM (SELECT * FROM g ORDER BY v DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'sup_compras_vencidas' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p WHERE p.status = 'AGUARDANDO COMPRA' AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' dias', '') FROM p),
      'causa', CASE WHEN (SELECT count(*) FROM p) > 0 THEN 'Aguardando compra além de ' || coalesce(p_param, 15)::int || ' dias' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pedido(s) · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('sup_abaixo_minimo', 'sup_valor_estoque', 'sup_sem_mov') THEN
    WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
    i AS (SELECT ei.id, it.nome, ei.estoque_minimo AS minimo, coalesce(ei.valor_unitario, 0) AS vu,
                 coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis
            FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
            LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL)
    SELECT CASE p_codigo
      WHEN 'sup_abaixo_minimo' THEN (
        SELECT jsonb_build_object('valor', count(*), 'impacto', sum((minimo - disp) * vu),
          'afetado', count(*) FILTER (WHERE disp <= 0) || ' zerado(s)',
          'causa', CASE WHEN count(*) > 0 THEN 'Reposição abaixo do consumo' END,
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', disp, 'rotulo', disp || ' de mín. ' || minimo) ORDER BY disp::numeric / greatest(minimo, 1))
                                 FROM (SELECT * FROM i WHERE minimo > 0 AND disp < minimo ORDER BY disp::numeric / greatest(minimo, 1) LIMIT 15) t), '[]'::jsonb))
          FROM i WHERE minimo > 0 AND disp < minimo)
      WHEN 'sup_valor_estoque' THEN (
        SELECT jsonb_build_object('valor', round(sum(fis * vu), 2), 'afetado', count(*) FILTER (WHERE fis > 0) || ' itens com saldo',
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(fis * vu, 2), 'rotulo', fis || ' un.') ORDER BY fis * vu DESC)
                                 FROM (SELECT * FROM i WHERE fis > 0 ORDER BY fis * vu DESC LIMIT 10) t), '[]'::jsonb))
          FROM i)
      ELSE (
        WITH parado AS (SELECT i.* FROM i WHERE i.fis > 0
                          AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = i.id AND m.created_at >= now() - make_interval(days => coalesce(p_param, 90)::int))
                          AND NOT EXISTS (SELECT 1 FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = i.id AND c.consumido_em >= now() - make_interval(days => coalesce(p_param, 90)::int)))
        SELECT jsonb_build_object('valor', count(*), 'impacto', round(sum(fis * vu), 2),
          'afetado', 'R$ ' || replace(to_char(coalesce(sum(fis * vu), 0), 'FM999G999G990'), ',', '.') || ' parados',
          'causa', CASE WHEN count(*) > 0 THEN 'Sem uso há mais de ' || coalesce(p_param, 90)::int || ' dias' END,
          'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(fis * vu, 2), 'rotulo', fis || ' un.') ORDER BY fis * vu DESC)
                                 FROM (SELECT * FROM parado ORDER BY fis * vu DESC LIMIT 12) t), '[]'::jsonb))
          FROM parado)
      END INTO r;

  ELSIF p_codigo = 'sup_contratos_sem_entrega' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, p.status, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int)
    SELECT jsonb_build_object('valor', (SELECT count(DISTINCT contrato) FROM p),
      'afetado', (SELECT count(*) || ' pedido(s) parado(s)' FROM p),
      'causa', (SELECT initcap(lower(status)) || ' (' || count(*) || ')' FROM p GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pedido(s) · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fro_indisponiveis' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, coalesce(nullif(btrim(p.lotacao), ''), 'Sem lotação') AS lot,
                      coalesce(p.motivo_indisponivel, CASE WHEN p.em_manutencao THEN 'manutencao' END) AS motivo
                 FROM public.sup_patrimonio p WHERE p.categoria = 'veiculo' AND p.ativo AND (p.em_manutencao OR p.motivo_indisponivel IS NOT NULL))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT string_agg(DISTINCT lot, ', ') FROM v),
      'causa', (SELECT CASE motivo WHEN 'manutencao' THEN 'Manutenção' ELSE initcap(motivo) END || ' (' || count(*) || ')' FROM v GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT count(*) || ' veículos ativos' FROM public.sup_patrimonio WHERE categoria = 'veiculo' AND ativo),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', 1, 'rotulo', lot)) FROM v), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fro_manutencoes' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, hoje - p.data_previsao_fim AS dias, p.categoria
                 FROM public.sup_patrimonio p WHERE p.ativo AND p.em_manutencao AND p.data_previsao_fim < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT count(*) FILTER (WHERE categoria = 'veiculo') || ' veículo(s) · ' || count(*) FILTER (WHERE categoria <> 'veiculo') || ' equipamento(s)' FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Previsão de retorno vencida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', dias || ' dias de atraso') ORDER BY dias DESC) FROM v), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fro_sem_responsavel' THEN
    WITH v AS (SELECT initcap(p.categoria) AS cat FROM public.sup_patrimonio p
                WHERE p.ativo AND p.contrato_id IS NULL AND p.posto_id IS NULL AND nullif(btrim(p.lotacao), '') IS NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Sem contrato, posto ou lotação no cadastro' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cat, 'valor', n) ORDER BY n DESC) FROM (SELECT cat, count(*) n FROM v GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('rec_risco', 'rec_abertas', 'rec_prazo') THEN
    WITH a AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      greatest(coalesce(s.quantidade_vagas, 1), 1) AS q, s.status, s.grau_urgencia, (hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date) AS dias
                 FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')),
    f AS (SELECT * FROM a WHERE (p_codigo = 'rec_abertas')
                             OR (p_codigo = 'rec_risco' AND grau_urgencia ILIKE 'Alta%')
                             OR (p_codigo = 'rec_prazo' AND dias > coalesce(p_param, 15)))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT cidade) || ' cidade(s)' FROM f),
      'causa', (SELECT 'Parada em: ' || status || ' (' || sum(q) || ')' FROM f GROUP BY status ORDER BY sum(q) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato || ' · ' || cidade, 'valor', n, 'rotulo', n || ' vaga(s) · mais antiga ' || d || ' d') ORDER BY n DESC, d DESC)
                             FROM (SELECT contrato, cidade, sum(q) n, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rec_admissoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, greatest(coalesce(s.quantidade_vagas, 1), 1) AS q,
                      s.status IN ('Contratado', 'Concluído') AS ok
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status <> 'Reprovada' AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
                  AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN coalesce(sum(q), 0) = 0 THEN 100 ELSE round(100.0 * coalesce(sum(q) FILTER (WHERE ok), 0) / sum(q)) END FROM a),
      'afetado', (SELECT coalesce(sum(q) FILTER (WHERE ok), 0) || ' de ' || coalesce(sum(q), 0) || ' previstas no mês até hoje' FROM a),
      'causa', (SELECT CASE WHEN coalesce(sum(q) FILTER (WHERE NOT ok), 0) > 0 THEN sum(q) FILTER (WHERE NOT ok) || ' admissão(ões) com início vencido' END FROM a),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n, 'rotulo', n || ' pendente(s)') ORDER BY n DESC)
                             FROM (SELECT contrato, sum(q) FILTER (WHERE NOT ok) n FROM a GROUP BY 1 HAVING sum(q) FILTER (WHERE NOT ok) > 0 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rec_desistencias' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      coalesce(substring(h.evento FROM '\(em ([^)]+)\)'), coalesce(h.de_status, 'etapa não informada')) AS etapa
                 FROM public."RECRUTAMENTO_HISTORICO" h LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'afetado', (SELECT count(DISTINCT cidade) || ' cidade(s)' FROM d),
      'causa', (SELECT 'Etapa: ' || initcap(lower(etapa)) || ' (' || count(*) || ')' FROM d GROUP BY etapa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cidade, 'valor', n) ORDER BY n DESC) FROM (SELECT cidade, count(*) n FROM d GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rh_quadro' THEN
    WITH q AS (SELECT contrato, ativos, necessarios, ativos - necessarios AS dif FROM public.tvg_quadro_contratos() WHERE necessarios > 0),
    f AS (SELECT * FROM q WHERE abs(dif) > coalesce(p_param, 2))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dif < 0) || ' com falta · ' || count(*) FILTER (WHERE dif > 0) || ' com excesso' FROM f),
      'causa', (SELECT CASE WHEN dif < 0 THEN 'Maior falta: ' ELSE 'Maior excesso: ' END || contrato || ' (' || CASE WHEN dif > 0 THEN '+' ELSE '' END || dif || ')' FROM f ORDER BY abs(dif) DESC LIMIT 1),
      'base', (SELECT count(*) || ' contratos com quadro e folha' FROM q),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'a', ativos, 'b', necessarios, 'valor', dif, 'rotulo', CASE WHEN dif > 0 THEN '+' || dif || ' excedente' ELSE dif || ' faltando' END) ORDER BY abs(dif) DESC)
                             FROM (SELECT * FROM f ORDER BY abs(dif) DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'rh_ob_rescisoes' THEN
    WITH d AS (SELECT s.status, hoje - coalesce(s.data_solicitacao, s.criado_em::date) AS dias
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                WHERE s.status IN ('Pendente Operacional', 'Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida'))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'afetado', (SELECT count(*) FILTER (WHERE dias > coalesce(p_param, 10)) || ' acima de ' || coalesce(p_param, 10)::int || ' dias' FROM d),
      'causa', (SELECT status || ' (' || count(*) || ')' FROM d GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', status, 'valor', n, 'rotulo', n || ' · até ' || m || ' d') ORDER BY n DESC)
                             FROM (SELECT status, count(*) n, max(dias) m FROM d GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'sst_afastamentos' THEN
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(afastados) FROM public.tvg_quadro_contratos()), 0),
      'afetado', (SELECT count(*) FILTER (WHERE afastados > 0) || ' contrato(s)' FROM public.tvg_quadro_contratos()),
      'causa', (SELECT "Situação" || ' (' || count(*) || ')' FROM public."EMPREGADOS" WHERE "Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias') GROUP BY "Situação" ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', afastados, 'rotulo', afastados || ' de ' || ativos || ' (' || round(100.0 * afastados / greatest(ativos, 1)) || '%)') ORDER BY afastados DESC)
                             FROM (SELECT * FROM public.tvg_quadro_contratos() WHERE afastados > 0 ORDER BY afastados DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'trn_integracoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato
                 FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int)
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM a),
      'causa', CASE WHEN (SELECT count(*) FROM a) > 0 THEN 'Nenhuma aula concluída na plataforma' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC) FROM (SELECT contrato, count(*) n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('fin_notas_pendentes', 'fin_valor_pendente') THEN
    v_comp := CASE WHEN extract(day FROM hoje) > coalesce(p_param, 20) THEN date_trunc('month', hoje - interval '1 month')
                   ELSE date_trunc('month', hoje - interval '2 months') END::date;
    WITH c AS (SELECT c.nome, coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado) AS v
                 FROM public.contratos c
                WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0
                  AND NOT EXISTS (SELECT 1 FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL
                                    AND n.status::text IN ('enviada', 'concluida') AND n.competencia = v_comp))
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'fin_notas_pendentes' THEN (SELECT count(*) FROM c) ELSE COALESCE((SELECT sum(v) FROM c), 0) END,
      'impacto', COALESCE((SELECT sum(v) FROM c), 0),
      'afetado', (SELECT count(*) || ' contrato(s) · competência ' || to_char(v_comp, 'MM/YYYY') FROM c),
      'causa', CASE WHEN (SELECT count(*) FROM c) > 0 THEN 'NF da competência não emitida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC) FROM (SELECT * FROM c ORDER BY v DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fin_recebimentos' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(n.vlr_liquido_total, 0) AS v, n.data_pagamento IS NOT NULL AS pago
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL
                  AND n.data_emissao + coalesce(p_param, 30)::int BETWEEN date_trunc('month', hoje)::date AND hoje)
    SELECT jsonb_build_object(
      'valor', (SELECT CASE WHEN coalesce(sum(v), 0) = 0 THEN 100 ELSE round(100.0 * coalesce(sum(v) FILTER (WHERE pago), 0) / sum(v), 1) END FROM n),
      'impacto', COALESCE((SELECT sum(v) FILTER (WHERE NOT pago) FROM n), 0),
      'afetado', (SELECT 'R$ ' || replace(to_char(coalesce(sum(v) FILTER (WHERE pago), 0), 'FM999G999G990'), ',', '.') || ' de R$ ' || replace(to_char(coalesce(sum(v), 0), 'FM999G999G990'), ',', '.') || ' previstos' FROM n),
      'causa', (SELECT CASE WHEN count(*) FILTER (WHERE NOT pago) > 0 THEN count(*) FILTER (WHERE NOT pago) || ' NF(s) vencida(s) sem baixa' END FROM n),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', coalesce(contrato, 'Sem contrato'), 'valor', s) ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s FROM n WHERE NOT pago GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'fin_inadimplencia' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(n.vlr_liquido_total, 0) AS v, hoje - (n.data_emissao + coalesce(p_param, 30)::int) AS atraso
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_pagamento IS NULL AND n.data_emissao IS NOT NULL),
    a AS (SELECT *, CASE WHEN atraso >= 120 THEN '120 dias ou mais' WHEN atraso >= 90 THEN '90 a 119 dias' WHEN atraso >= 60 THEN '60 a 89 dias'
                         WHEN atraso >= 30 THEN '30 a 59 dias' ELSE '15 a 29 dias' END AS faixa,
                    CASE WHEN atraso >= 120 THEN 5 WHEN atraso >= 90 THEN 4 WHEN atraso >= 60 THEN 3 WHEN atraso >= 30 THEN 2 ELSE 1 END AS ord
            FROM n WHERE atraso >= 15)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM a), 0), 'impacto', COALESCE((SELECT sum(v) FROM a), 0),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · maior: ' || (SELECT contrato FROM a GROUP BY contrato ORDER BY sum(v) DESC LIMIT 1), '') FROM a),
      'causa', (SELECT 'Maior faixa: ' || faixa FROM a GROUP BY faixa ORDER BY sum(v) DESC LIMIT 1),
      'detalhe', (SELECT jsonb_agg(jsonb_build_object('nome', f.faixa, 'valor', coalesce(s.v, 0), 'rotulo', coalesce(s.n, 0) || ' NF(s)') ORDER BY f.ord)
                    FROM (VALUES (1, '15 a 29 dias'), (2, '30 a 59 dias'), (3, '60 a 89 dias'), (4, '90 a 119 dias'), (5, '120 dias ou mais')) f(ord, faixa)
                    LEFT JOIN (SELECT faixa, sum(v) v, count(*) n FROM a GROUP BY 1) s ON s.faixa = f.faixa))
      INTO r;

  ELSIF p_codigo = 'fin_glosas' THEN
    WITH o AS (
      SELECT CASE WHEN n.tipo = 'Glosa' THEN 'Glosas' ELSE 'Multas' END AS origem, coalesce(n.valor_final, n.valor_original, 0) AS v
        FROM public."JUR_NOTIFICACOES" n
       WHERE n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida'
         AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Descontos após a emissão', coalesce(n.descontos_pos_emissao_total, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Conta vinculada (retida)', coalesce(n.desconto_conta_vinculada, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM o), 0), 'impacto', COALESCE((SELECT sum(v) FROM o), 0),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'causa', (SELECT origem FROM o GROUP BY origem HAVING sum(v) > 0 ORDER BY sum(v) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', origem, 'valor', s) ORDER BY s DESC) FROM (SELECT origem, sum(v) s FROM o GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('jur_prazos', 'jur_sem_resposta') THEN
    WITH a AS (SELECT coalesce(n.tipo, 'Notificação') || ' · ' || coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'sem contrato') AS nome,
                      n.prazo_defesa - hoje AS dias, n.etapa
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada'),
    f AS (SELECT * FROM a WHERE (p_codigo = 'jur_prazos' AND dias IS NOT NULL AND dias <= coalesce(p_param, 5))
                             OR (p_codigo = 'jur_sem_resposta' AND etapa IN ('Recebida', 'Em análise')))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dias < 0) || ' vencido(s) · ' || count(*) FILTER (WHERE dias >= 0) || ' no prazo' FROM f),
      'causa', (SELECT 'Etapa: ' || coalesce(etapa, '—') || ' (' || count(*) || ')' FROM f GROUP BY etapa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo',
                                CASE WHEN dias IS NULL THEN coalesce(etapa, '—') WHEN dias < 0 THEN 'vencido há ' || -dias || ' d' WHEN dias = 0 THEN 'vence hoje' ELSE 'em ' || dias || ' d' END)
                                ORDER BY dias NULLS LAST) FROM (SELECT * FROM f ORDER BY dias NULLS LAST LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_audiencias' THEN
    WITH d AS (
      SELECT coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'sem contrato') AS contrato, x.tipo, left(x.dt, 10)::date AS dia
        FROM public."JUR_PROCESSOS" p
        CROSS JOIN LATERAL (VALUES ('Audiência', p.data_audiencia_designada), ('1ª audiência', p.data_primeira_audiencia),
                                   ('Instrução', p.data_audiencia_instrucao), ('Perícia', p.data_pericia)) x(tipo, dt)
       WHERE p.status = 'EM ANDAMENTO' AND x.dt ~ '^\d{4}-\d{2}-\d{2}'),
    f AS (SELECT DISTINCT * FROM d WHERE dia BETWEEN hoje AND hoje + coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) FILTER (WHERE dia <= hoje + 3) || ' nos próximos 3 dias' FROM f),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM f GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo || ' · ' || contrato, 'valor', dia - hoje, 'rotulo', to_char(dia, 'DD/MM')) ORDER BY dia)
                             FROM (SELECT * FROM f ORDER BY dia LIMIT 15) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_reincidentes' THEN
    WITH m AS (SELECT btrim(x) AS motivo FROM public."JUR_PROCESSOS" p, regexp_split_to_table(coalesce(p.motivos, ''), '\s*[,;]\s*') x
                WHERE p.status = 'EM ANDAMENTO' AND btrim(x) <> ''),
    c AS (SELECT motivo, count(*) n FROM m GROUP BY 1)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE n >= coalesce(p_param, 5)),
      'afetado', (SELECT count(*) || ' processos em andamento' FROM public."JUR_PROCESSOS" WHERE status = 'EM ANDAMENTO'),
      'causa', (SELECT motivo || ' (' || n || ')' FROM c ORDER BY n DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', motivo, 'valor', n) ORDER BY n DESC) FROM (SELECT * FROM c WHERE n >= coalesce(p_param, 5) ORDER BY n DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'jur_multas_revertidas' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'sem contrato') AS contrato,
                      greatest(coalesce(n.valor_original, 0) - coalesce(n.valor_final, 0), 0) AS v
                 FROM public."JUR_NOTIFICACOES" n
                WHERE n.resultado ILIKE 'Revertida%' AND coalesce(n.data_desfecho, n.updated_at::date) >= hoje - coalesce(p_param, 365)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM a), 0), 'afetado', (SELECT count(*) || ' reversão(ões)' FROM a),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s) ORDER BY s DESC) FROM (SELECT contrato, sum(v) s FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ctl_planos' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.area), ''), nullif(btrim(p.setor), ''), nullif(btrim(p.comite), ''), 'Sem área') AS area,
                      hoje - p.data_fim_planejado AS dias, coalesce(p.custo_previsto, 0) AS custo
                 FROM public.plano_acao p
                WHERE p.deleted_at IS NULL AND coalesce(p.status_normalizado, '') NOT LIKE 'concluida%' AND p.data_fim_planejado < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p), 'impacto', (SELECT nullif(sum(custo), 0) FROM p),
      'afetado', (SELECT count(DISTINCT area) || ' área(s) · ' || count(*) FILTER (WHERE dias > 30) || ' com mais de 30 dias' FROM p),
      'causa', (SELECT 'Mais atrasos: ' || area || ' (' || count(*) || ')' FROM p GROUP BY area ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT area, count(*) n, max(dias) d FROM p GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ctl_nao_atualizados' THEN
    WITH i AS (SELECT i.codigo, i.nome, pa.titulo AS painel,
                      (SELECT max(l.created_at) FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo) AS ultimo,
                      CASE i.periodicidade WHEN 'diaria' THEN 2 WHEN 'semanal' THEN 8 ELSE 35 END AS tol
                 FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" pa ON pa.slug = i.painel
                WHERE i.ativo AND i.fonte = 'manual'),
    f AS (SELECT * FROM i WHERE ultimo IS NULL OR ultimo < now() - make_interval(days => tol))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT painel) || ' TV(s) · ' || count(*) FILTER (WHERE ultimo IS NULL) || ' nunca lançado(s)' FROM f),
      'causa', (SELECT 'Mais pendências: ' || painel || ' (' || count(*) || ')' FROM f GROUP BY painel ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT count(*) || ' indicadores de lançamento manual' FROM i),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', painel, 'valor', n) ORDER BY n DESC) FROM (SELECT painel, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo IN ('ti_erros', 'ti_demandas') THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo,
                      hoje - (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
                 FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND c.prioridade = 'alta'
                  AND ((p_codigo = 'ti_erros' AND c.tipo_solicitacao = 'correcao')
                    OR (p_codigo = 'ti_demandas' AND (c.prazo_previsto < hoje
                         OR (c.prazo_previsto IS NULL AND c.created_at < now() - make_interval(days => coalesce(p_param, 30)::int))))))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c),
      'afetado', (SELECT count(DISTINCT modulo) || ' módulo(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' d', '') FROM c),
      'causa', (SELECT 'Mais chamados: ' || modulo || ' (' || count(*) || ')' FROM c GROUP BY modulo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n, max(dias) d FROM c GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ti_integracoes' THEN
    WITH f AS (SELECT f.destino FROM public.fila_http f
                WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT destino) || ' integração(ões)' FROM f),
      'causa', (SELECT destino || ' (' || count(*) || ')' FROM f GROUP BY destino ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', destino, 'valor', n) ORDER BY n DESC) FROM (SELECT destino, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSIF p_codigo = 'ti_acessos' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(e."Setor_ERP"), ''), nullif(btrim(e."Nome Filial"), ''), 'Sem setor') AS setor
                 FROM public."EMPREGADOS" e JOIN auth.users u ON u.id = e.auth_user_id
                WHERE e."Situação" = 'Demitido' AND (u.banned_until IS NULL OR u.banned_until < now()))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d),
      'causa', CASE WHEN (SELECT count(*) FROM d) > 0 THEN 'Login não bloqueado após a demissão' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', setor, 'valor', n) ORDER BY n DESC) FROM (SELECT setor, count(*) n FROM d GROUP BY 1) t), '[]'::jsonb))
      INTO r;

  ELSE
    RETURN NULL;
  END IF;

  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_calc(p_codigo text, p_param numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_calc(p_codigo text, p_param numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_calc(p_codigo text, p_param numeric) TO service_role;

-- public.tvg_calc_ajuste(p_codigo text, p_param numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_calc_ajuste(p_codigo text, p_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  ini_ant date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '1 month')::date;
  r jsonb; v_comp text;
BEGIN
  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_codigo = 'ti_erros' THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo, hoje - (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias
                 FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND c.tipo_solicitacao = 'correcao' AND c.urgencia = 'ate_1h')
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhum erro crítico em aberto' ELSE count(DISTINCT modulo) || ' módulo(s) · mais antigo: ' || max(dias) || ' d' END FROM c),
      'causa', (SELECT 'Mais chamados: ' || modulo || ' (' || count(*) || ')' FROM c GROUP BY modulo ORDER BY count(*) DESC LIMIT 1),
      'base', 'Chamados de correção com urgência "até 1 hora" (trabalho parado), ainda abertos',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n, 'rotulo', n || ' · até ' || d || ' d') ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n, max(dias) d FROM c GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_integracoes' THEN
    WITH f AS (SELECT f.destino FROM public.fila_http f
                WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.destino NOT ILIKE 'novidade-ia%'
                  AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Todas as integrações em dia' ELSE count(DISTINCT destino) || ' integração(ões)' END FROM f),
      'causa', (SELECT destino || ' (' || count(*) || ')' FROM f GROUP BY destino ORDER BY count(*) DESC LIMIT 1),
      'base', 'Fila de integrações com erro e não reprocessada (resumos automáticos da I.A não contam)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', destino, 'valor', n) ORDER BY n DESC) FROM (SELECT destino, count(*) n FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_concluidos' THEN
    WITH c AS (SELECT coalesce(nullif(btrim(c.modulo_sistema), ''), 'Outro') AS modulo, (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."CHAMADO_SISTEMA" c WHERE c.status = 'concluido' AND (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT modulo) FILTER (WHERE dia >= ini) || ' módulo(s) atendidos · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM c),
      'base', 'Chamados de Sistemas concluídos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', modulo, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT modulo, count(*) n FROM c WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_tempo_conclusao' THEN
    WITH c AS (SELECT date_trunc('month', c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS mes, extract(epoch FROM c.concluido_em - c.created_at) / 86400 AS dias
                 FROM public."CHAMADO_SISTEMA" c WHERE c.status = 'concluido' AND c.concluido_em >= (ini - interval '5 months'))
    SELECT jsonb_build_object('valor', (SELECT round(avg(dias), 1) FROM c WHERE mes = ini),
      'afetado', (SELECT count(*) FILTER (WHERE mes = ini) || ' concluído(s) no mês · mês anterior inteiro: ' || coalesce(replace(round(avg(dias) FILTER (WHERE mes = ini_ant), 1)::text, '.', ','), '—') || ' d' FROM c),
      'base', 'Média de dias entre a abertura e a conclusão dos chamados concluídos no mês',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', to_char(mes, 'MM/YY'), 'valor', d, 'rotulo', replace(d::text, '.', ',') || ' d') ORDER BY mes)
                             FROM (SELECT mes, round(avg(dias), 1) d FROM c GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Recrutamento ──────────────────────────────────────────────────────
  IF p_codigo = 'rec_risco' THEN
    WITH f AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, coalesce(nullif(btrim(s.cidade), ''), '—') AS cidade,
                      greatest(coalesce(s.quantidade_vagas, 1), 1) AS q, s.status, (hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date) AS dias
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado') AND s.grau_urgencia ILIKE 'Alta%'
                  AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f), 0),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma vaga urgente atrasada' ELSE count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT cidade) || ' cidade(s)' END FROM f),
      'causa', (SELECT 'Parada em: ' || status || ' (' || sum(q) || ')' FROM f GROUP BY status ORDER BY sum(q) DESC LIMIT 1),
      'base', 'Vagas urgentes abertas há mais de ' || coalesce(p_param, 15)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato || ' · ' || cidade, 'valor', n, 'rotulo', n || ' vaga(s) · mais antiga ' || d || ' d') ORDER BY n DESC, d DESC)
                             FROM (SELECT contrato, cidade, sum(q) n, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 15) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'rec_preenchidas' THEN
    WITH f AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, greatest(coalesce(s.quantidade_vagas, 1), 1) AS q,
                      (s.status_changed_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."SISTEMA_RECRUTAMENTO" s
                WHERE s.status IN ('Contratado', 'Concluído') AND (s.status_changed_at AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(q) FROM f WHERE dia >= ini), 0),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) · mês anterior inteiro: ' || coalesce(sum(q) FILTER (WHERE dia < ini), 0) FROM f),
      'base', 'Vagas da Gestão Recrutamento que chegaram a Contratado desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, sum(q) n FROM f WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── RH / SST: só o que é falta de fato ou passou do prazo ─────────────
  IF p_codigo = 'rh_absenteismo' THEN
    -- Atestado e falta (o mesmo de op_faltas); INSS/licenças ficam em SST › Afastamentos.
    RETURN public.tvg_calc_extra('op_faltas', p_param);
  END IF;

  IF p_codigo = 'rh_ob_rescisoes' THEN
    WITH d AS (SELECT s.status, hoje - coalesce(s.data_solicitacao, s.criado_em::date) AS dias
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                WHERE s.status IN ('Pendente Operacional', 'Pendente RH', 'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')),
    f AS (SELECT * FROM d WHERE dias > coalesce(p_param, 10))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' no fluxo · ' || count(*) FILTER (WHERE dias > coalesce(p_param, 10)) || ' acima de ' || coalesce(p_param, 10)::int || ' dias' FROM d),
      'causa', (SELECT status || ' (' || count(*) || ')' FROM f GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'base', 'Solicitações de demissão paradas há mais de ' || coalesce(p_param, 10)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', status, 'valor', n, 'rotulo', n || ' · até ' || m || ' d') ORDER BY n DESC)
                             FROM (SELECT status, count(*) n, max(dias) m FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sst_aso', 'sst_imp_aso') THEN
    WITH a AS (
      SELECT 'Admissional' AS tipo, hoje - coalesce(c.etapa_changed_at, c.created_at)::date AS dias
        FROM public."WA_CURRICULOS" c WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
      UNION ALL
      SELECT 'Demissional', hoje - coalesce(s.data_solicitacao, s.criado_em::date)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE s.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')),
    f AS (SELECT * FROM a WHERE dias > coalesce(p_param, 5))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' no fluxo · ' || count(*) FILTER (WHERE dias > coalesce(p_param, 5)) || ' há mais de ' || coalesce(p_param, 5)::int || ' dias' FROM a),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM f GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'base', 'ASOs aguardando o SST há mais de ' || coalesce(p_param, 5)::int || ' dias',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sst_demissionais' THEN
    WITH d AS (SELECT coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato') AS contrato, (s.sst_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE (s.sst_em AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM d),
      'base', 'Exames demissionais agendados pelo SST desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n FROM d WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamento ───────────────────────────────────────────────────────
  IF p_codigo = 'trn_integracoes' THEN
    WITH a AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato
                 FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int)
                  AND a.created_at < now() - interval '7 days'
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM a),
      'causa', CASE WHEN (SELECT count(*) FROM a) > 0 THEN 'Nenhuma aula concluída depois de 7 dias na plataforma' END,
      'base', 'Alunos criados nos últimos ' || coalesce(p_param, 30)::int || ' dias, com mais de 7 dias de casa e nenhuma aula concluída',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC) FROM (SELECT contrato, count(*) n FROM a GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'trn_programados' THEN
    SELECT jsonb_build_object(
      'valor', (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= ini),
      'afetado', 'Mês anterior inteiro: ' || (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= ini_ant AND c.emitido_em < ini),
      'base', 'Certificados emitidos na plataforma de Treinamentos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YY'), 'valor',
                                   (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month')) ORDER BY g)
                             FROM generate_series(ini - interval '5 months', ini, interval '1 month') g), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Financeiro ────────────────────────────────────────────────────────
  IF p_codigo = 'fin_glosas' THEN
    -- Sem a conta vinculada: depósito retido por lei e devolvido depois, não perda.
    WITH o AS (
      SELECT CASE WHEN n.tipo = 'Glosa' THEN 'Glosas' ELSE 'Multas' END AS origem, coalesce(n.valor_final, n.valor_original, 0) AS v
        FROM public."JUR_NOTIFICACOES" n
       WHERE n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida'
         AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
      UNION ALL
      SELECT 'Descontos após a emissão', coalesce(n.descontos_pos_emissao_total, 0) FROM public.nf_emissao n
       WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM o), 0), 'impacto', COALESCE((SELECT sum(v) FROM o), 0),
      'afetado', 'Últimos ' || coalesce(p_param, 90)::int || ' dias',
      'causa', (SELECT origem FROM o GROUP BY origem HAVING sum(v) > 0 ORDER BY sum(v) DESC LIMIT 1),
      'base', 'Glosas e multas não revertidas + descontos nas NFs depois de emitidas (a conta vinculada é depósito retido por lei, não entra)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', origem, 'valor', s) ORDER BY s DESC) FROM (SELECT origem, sum(v) s FROM o GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fin_recebido_mes' THEN
    WITH n AS (SELECT c.nome AS contrato, coalesce(nullif(n.valor_pago, 0), n.vlr_liquido_total, 0) AS v, n.data_pagamento AS dia
                 FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                WHERE n.deleted_at IS NULL AND n.data_pagamento >= ini_ant)
    SELECT jsonb_build_object('valor', COALESCE((SELECT sum(v) FROM n WHERE dia >= ini), 0),
      'afetado', (SELECT count(*) FILTER (WHERE dia >= ini) || ' NF(s) recebida(s) · mês anterior inteiro: R$ ' || replace(to_char(coalesce(sum(v) FILTER (WHERE dia < ini), 0), 'FM999G999G990'), ',', '.') FROM n),
      'base', 'NFs com pagamento registrado no Faturamento desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', coalesce(contrato, 'Sem contrato'), 'valor', s) ORDER BY s DESC)
                             FROM (SELECT contrato, sum(v) s FROM n WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações, Supply, Controladoria ─────────────────────────────────
  IF p_codigo = 'lic_ganhas' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.posicao, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text = 'Finalizada' AND g.data >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g WHERE posicao = 1), 'impacto', (SELECT sum(v) FROM g WHERE posicao = 1),
      'afetado', (SELECT 'De ' || count(*) || ' finalizada(s) nos últimos ' || coalesce(p_param, 90)::int || ' dias' FROM g),
      'base', 'Licitações finalizadas em 1º lugar (grade de Licitações)',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC NULLS LAST) FROM g WHERE posicao = 1), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sup_despachados' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, (p.data_despachado AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                 FROM public.sup_pedido p WHERE (p.data_despachado AT TIME ZONE 'America/Sao_Paulo')::date >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT contrato) FILTER (WHERE dia >= ini) || ' contrato(s) atendido(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM p),
      'base', 'Pedidos de material/uniforme despachados desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT contrato, count(*) n FROM p WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ctl_planos_concluidos' THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.area), ''), nullif(btrim(p.setor), ''), nullif(btrim(p.comite), ''), 'Sem área') AS area,
                      coalesce(p.data_fim_real, p.updated_at::date) AS dia
                 FROM public.plano_acao p WHERE p.deleted_at IS NULL AND p.status_normalizado LIKE 'concluida%' AND coalesce(p.data_fim_real, p.updated_at::date) >= ini_ant)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p WHERE dia >= ini),
      'afetado', (SELECT count(DISTINCT area) FILTER (WHERE dia >= ini) || ' área(s) · mês anterior inteiro: ' || count(*) FILTER (WHERE dia < ini) FROM p),
      'base', 'Planos de ação concluídos desde ' || to_char(ini, 'DD/MM'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n) ORDER BY n DESC)
                             FROM (SELECT area, count(*) n FROM p WHERE dia >= ini GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── DRE ───────────────────────────────────────────────────────────────
  IF p_codigo = 'op_contratos_saudaveis' THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN NULL; END IF;
    WITH d AS (SELECT contrato, round(100 * (receita - coalesce(custo, 0)) / receita, 1) AS margem
                 FROM public.tvg_dre_contratos() WHERE competencia = v_comp AND receita >= 10000)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE margem >= coalesce(p_param, 10)),
      'afetado', (SELECT 'De ' || count(*) || ' contratos · competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') FROM d),
      'base', 'Contratos com margem de ' || coalesce(p_param, 10)::int || '% ou mais no DRE gerencial',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', margem, 'rotulo', replace(margem::text, '.', ',') || '%') ORDER BY margem DESC)
                             FROM (SELECT * FROM d WHERE margem >= coalesce(p_param, 10) ORDER BY margem DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('op_custo_direto', 'ctl_desvio') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN NULL; END IF;
    -- Só contrato com custo lançado nos 3 meses anteriores: contrato novo ou mês
    -- incompleto no DRE não é "alta de custo".
    WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4),
    d AS (SELECT t.contrato,
                 sum(t.custo) FILTER (WHERE t.competencia = v_comp) AS atual,
                 avg(t.custo) FILTER (WHERE t.competencia < v_comp) AS media,
                 count(DISTINCT t.competencia) FILTER (WHERE t.competencia < v_comp AND t.custo > 0) AS meses
            FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia GROUP BY 1),
    x AS (SELECT contrato, atual, media, round(100 * (atual - media) / media, 1) AS pct FROM d
           WHERE media > 1000 AND atual IS NOT NULL AND meses >= (SELECT count(*) - 1 FROM m)),
    f AS (SELECT * FROM x WHERE pct > coalesce(p_param, 10))
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'op_custo_direto'
                    THEN (SELECT round(100 * (sum(atual) - sum(media)) / nullif(sum(media), 0), 1) FROM x)
                    ELSE (SELECT count(*) FROM f) END,
      'impacto', (SELECT sum(atual - media) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) com custo ' || coalesce(p_param, 10)::int || '%+ acima da média' FROM f),
      'causa', (SELECT 'Maior alta: ' || contrato || ' (+' || replace(pct::text, '.', ',') || '%)' FROM f ORDER BY atual - media DESC LIMIT 1),
      'base', 'Custo da competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' × média dos 3 meses anteriores (DRE) · só contratos com os 3 meses lançados (' || (SELECT count(*) FROM x) || ')',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', pct, 'rotulo', '+' || replace(pct::text, '.', ',') || '%') ORDER BY pct DESC)
                             FROM (SELECT * FROM f ORDER BY pct DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Jurídico: contar PROCESSOS (cada processo tem uma linha por motivo) ─
  IF p_codigo IN ('jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (SELECT p.numero_processo, max(coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato')) AS contrato,
                      coalesce(sum(p.valor_pedidos), max(p.valor_causa), 0)::numeric AS pedidos,
                      coalesce(sum(p.valor_sentenca), 0)::numeric AS sentenca, coalesce(sum(p.valor_acordo), 0) AS acordo
                 FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO' GROUP BY 1),
    f AS (SELECT *, CASE WHEN pedidos >= 200000 THEN 'R$ 200 mil ou mais' WHEN pedidos >= 100000 THEN 'R$ 100 a 200 mil'
                         WHEN pedidos >= 50000 THEN 'R$ 50 a 100 mil' ELSE 'Até R$ 50 mil' END AS faixa FROM p)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo WHEN 'jur_risco' THEN (SELECT count(*) FROM f WHERE pedidos >= coalesce(p_param, 100000))
                             WHEN 'jur_valor_condenacao' THEN (SELECT sum(sentenca) FROM f)
                             ELSE (SELECT sum(acordo) FROM f) END,
      'impacto', (SELECT sum(pedidos) FILTER (WHERE pedidos >= coalesce(p_param, 100000)) FROM f),
      'afetado', (SELECT count(*) || ' processos em andamento · R$ ' || replace(to_char(sum(pedidos), 'FM999G999G990'), ',', '.') || ' em pedidos' FROM f),
      'causa', (SELECT 'Maior exposição: ' || contrato FROM f GROUP BY contrato ORDER BY sum(pedidos) DESC LIMIT 1),
      'detalhe', CASE WHEN p_codigo = 'jur_risco'
                      THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', faixa, 'valor', q) ORDER BY q DESC) FROM (SELECT faixa, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb)
                      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s) ORDER BY s DESC)
                                       FROM (SELECT contrato, sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) s
                                               FROM f GROUP BY 1 HAVING sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) > 0
                                              ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'jur_reincidentes' THEN
    WITH m AS (SELECT DISTINCT p.numero_processo, btrim(x) AS motivo FROM public."JUR_PROCESSOS" p, regexp_split_to_table(coalesce(p.motivos, ''), '\s*[,;]\s*') x
                WHERE p.status = 'EM ANDAMENTO' AND btrim(x) <> ''),
    c AS (SELECT motivo, count(*) n FROM m GROUP BY 1)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM c WHERE n >= coalesce(p_param, 5)),
      'afetado', (SELECT count(DISTINCT numero_processo) || ' processos em andamento' FROM m),
      'causa', (SELECT motivo || ' (' || n || ' processos)' FROM c ORDER BY n DESC LIMIT 1),
      'base', 'Motivos (pedidos) que aparecem em ' || coalesce(p_param, 5)::int || ' ou mais processos em andamento',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', motivo, 'valor', n) ORDER BY n DESC) FROM (SELECT * FROM c WHERE n >= coalesce(p_param, 5) ORDER BY n DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Turnover: a MESMA conta de Relatórios › Turnover (mig 20261014000026) ─
  -- Ano corrente, ano inteiro até hoje, todas as causas: soma das taxas
  -- mensais (demissões ÷ efetivo no fim do mês), meta 41% no ano. Por
  -- contrato: demissões ÷ efetivo médio do contrato no ano ("próprio").
  -- Antes era a média dos últimos 3 meses (3,3%) — com o mês corrente pela
  -- metade puxando para baixo — e não batia com o relatório (42,66%).
  IF p_codigo = 'op_turnover' THEN
    DECLARE
      d jsonb := public.dir_turnover_painel_dados(extract(year FROM hoje)::int, NULL, NULL, NULL, NULL);
      soma numeric; dem numeric;
    BEGIN
      SELECT round(sum((m->>'taxa')::numeric), 2), sum((m->>'demissoes')::numeric) INTO soma, dem FROM jsonb_array_elements(d->'mensal') m;
      SELECT jsonb_build_object(
        'valor', soma,
        'afetado', coalesce(dem, 0) || ' demissões · efetivo médio ' || round((d->>'efetivo_medio')::numeric)
                   || CASE WHEN (d->>'fator_projecao')::numeric > 1.001 THEN ' · projeção do ano ' || replace(round(soma * (d->>'fator_projecao')::numeric, 1)::text, '.', ',') || '%' ELSE '' END,
        'causa', (SELECT c->>'causa' FROM jsonb_array_elements(d->'causas') c WHERE c->>'causa' NOT ILIKE '%não informado%' ORDER BY (c->>'n')::int DESC LIMIT 1),
        'base', 'Igual a Relatórios › Turnover: soma das taxas mensais de ' || extract(year FROM hoje)::int || ' (demissões ÷ efetivo no fim do mês); meta 41% no ano',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(contrato, '^\s*\d+\s*-\s*', ''), 'valor', proprio,
                                     'rotulo', replace(proprio::text, '.', ',') || '% · ' || dem_c || ' demissão(ões)') ORDER BY proprio DESC)
                               FROM (SELECT x->>'contrato' AS contrato, (x->>'demissoes')::int AS dem_c,
                                            round((x->>'demissoes')::numeric * 100 / nullif((x->>'efetivo_medio')::numeric, 0), 2) AS proprio
                                       FROM jsonb_array_elements(d->'por_contrato') x
                                      WHERE (x->>'demissoes')::int > 0 AND (x->>'efetivo_medio')::numeric > 0
                                      ORDER BY 3 DESC LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END;
  END IF;

  -- ── Licitações com prazo próximo: a lista de alertas (mig 20261014000027) ─
  -- Pablo: trocar o gráfico de barras ("0 d / 1 d / 2 d") pela lista do slide
  -- Alertas da TV de Licitações — data, edital · objeto, responsável · fase.
  -- Mesmo filtro de antes (À Iniciar/Iniciado com sessão em até N dias); o
  -- detalhe ganha os campos da lista.
  IF p_codigo = 'lic_prazo' THEN
    WITH g AS (SELECT g.edital, g.cidade, g.uf, g.objeto, g.responsavel, g.fase::text AS fase, g.data, g.horario, g.data - hoje AS dias,
                      public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT CASE WHEN count(*) = 0 THEN 'Nenhuma sessão próxima sem proposta' ELSE count(*) FILTER (WHERE dias = 0) || ' hoje · ' || count(*) FILTER (WHERE dias = 1) || ' amanhã' END FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Proposta ainda não iniciada/concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                               'nome', coalesce(edital, 's/ edital') || coalesce(' · ' || cidade, ''), 'valor', dias,
                               'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' dias' END,
                               'data', data, 'titulo', coalesce(edital, 's/ edital') || ' · ' || coalesce(nullif(btrim(objeto), ''), 'Sem objeto'),
                               'sub', coalesce(nullif(btrim(responsavel), ''), 'Sem responsável') || ' · ' || fase
                                      || coalesce(' · ' || nullif(btrim(cidade), '') || coalesce('/' || uf, ''), '')
                                      || coalesce(' · ' || nullif(btrim(horario), ''), '')) ORDER BY data, horario NULLS LAST)
                             FROM (SELECT * FROM g ORDER BY data, horario NULLS LAST LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_calc_ajuste(p_codigo text, p_param numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_calc_ajuste(p_codigo text, p_param numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_calc_ajuste(p_codigo text, p_param numeric) TO service_role;

-- public.tvg_calc_espelho(p_codigo text, p_param numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_calc_espelho(p_codigo text, p_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  v_emp uuid; r jsonb;
BEGIN
  -- ── Supply = Suprimentos › Dashboard de Compras, aba Visão Geral ───────
  -- As MESMAS regras de sup_dashboard_compras_estoque com o filtro que a tela
  -- abre: empresa HAGG, de 01/01 até hoje, sem contrato/categoria/comprador.
  IF p_codigo IN ('sup_solicitacoes', 'sup_pendentes', 'sup_despachados', 'sup_tempo_atendimento') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH pedidos AS (SELECT p.* FROM public.sup_pedido p WHERE p.empresa_id = v_emp AND p.data_solicitacao BETWEEN ini AND hoje),
    por_contrato AS (SELECT coalesce(contrato_nome, 'Sem contrato') AS nome, count(*) AS q,
                            count(*) FILTER (WHERE status = 'DESPACHADO') AS d,
                            count(*) FILTER (WHERE status NOT IN ('DESPACHADO', 'CANCELADO')) AS pend,
                            round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400) FILTER (WHERE data_despachado IS NOT NULL)::numeric, 1) AS tm
                       FROM pedidos GROUP BY 1)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo
                 WHEN 'sup_solicitacoes' THEN (SELECT count(*) FROM pedidos)
                 WHEN 'sup_pendentes' THEN (SELECT count(*) FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO'))
                 WHEN 'sup_despachados' THEN (SELECT count(*) FROM pedidos WHERE status = 'DESPACHADO')
                 ELSE COALESCE((SELECT round(avg(extract(epoch FROM (data_despachado - created_at)) / 86400)::numeric, 1) FROM pedidos WHERE data_despachado IS NOT NULL), 0) END,
      'afetado', CASE p_codigo
                   WHEN 'sup_despachados' THEN (SELECT CASE WHEN count(*) = 0 THEN '—' ELSE round(100.0 * count(*) FILTER (WHERE status = 'DESPACHADO') / count(*)) || '% das solicitações' END FROM pedidos)
                   WHEN 'sup_pendentes' THEN 'Em preparação, compra ou envio'
                   WHEN 'sup_tempo_atendimento' THEN 'Da solicitação ao despacho'
                   ELSE 'No período (' || to_char(ini, 'DD/MM') || ' a ' || to_char(hoje, 'DD/MM') || ')' END,
      'base', 'Suprimentos › Dashboard de Compras (Visão Geral) · HAGG · ' || to_char(ini, 'DD/MM/YYYY') || ' a ' || to_char(hoje, 'DD/MM/YYYY'),
      'detalhe', CASE p_codigo
        WHEN 'sup_pendentes' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
            FROM (SELECT CASE status WHEN 'AGUARDANDO COMPRA' THEN 'Aguardando compra' WHEN 'AGUARDANDO ENVIO' THEN 'Aguardando envio'
                                     WHEN 'EM PREPARACAO' THEN 'Em preparação' ELSE initcap(lower(status)) END AS nome, count(*) q
                    FROM pedidos WHERE status NOT IN ('DESPACHADO', 'CANCELADO') GROUP BY status) t), '[]'::jsonb)
        WHEN 'sup_tempo_atendimento' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', tm, 'rotulo', replace(tm::text, '.', ',') || ' d') ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato WHERE tm IS NOT NULL ORDER BY q DESC LIMIT 6) t), '[]'::jsonb)
        WHEN 'sup_despachados' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', d) ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato ORDER BY q DESC LIMIT 6) t), '[]'::jsonb)
        ELSE COALESCE((
          -- "Solicitações por Contrato" do dashboard: solicitações × despachadas (pendentes no rótulo).
          SELECT jsonb_agg(jsonb_build_object('nome', nome, 'a', q, 'b', d, 'valor', q, 'rotulo', pend || ' pendente(s)') ORDER BY q DESC)
            FROM (SELECT * FROM por_contrato ORDER BY q DESC LIMIT 6) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sup_cotacoes', 'sup_saving', 'sup_saving_pct') THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH cm AS (SELECT d.*, c.nome AS contrato_nome, GREATEST(COALESCE(d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0), 0) AS saving
                  FROM public.malote_despesa d LEFT JOIN public.contratos c ON c.id = d.contrato_id
                 WHERE d.empresa_id = v_emp AND d.cotacao_enviada_em IS NOT NULL AND d.deleted_at IS NULL
                   AND d.cotacao_enviada_em >= ini::timestamptz AND d.cotacao_enviada_em < (hoje + 1)::timestamptz),
    cl AS (SELECT 1 FROM public.cotacoes_licitacao q
            WHERE q.empresa_id = v_emp AND q.created_at >= ini::timestamptz AND q.created_at < (hoje + 1)::timestamptz),
    sc AS (SELECT COALESCE(contrato_nome, 'Sem contrato') AS contrato, sum(COALESCE(valor_total, 0))::numeric AS inicial, sum(saving)::numeric AS saving
             FROM cm WHERE valor_aprovado_cotacao IS NOT NULL GROUP BY 1)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo
                 WHEN 'sup_cotacoes' THEN (SELECT count(*) FROM cm) + (SELECT count(*) FROM cl)
                 WHEN 'sup_saving' THEN COALESCE((SELECT sum(saving) FROM sc), 0)
                 ELSE COALESCE((SELECT round(100 * sum(saving) / nullif(sum(inicial), 0), 1) FROM sc), 0) END,
      'afetado', CASE p_codigo
                   WHEN 'sup_cotacoes' THEN (SELECT count(*) FROM cm) || ' de compras (Malote) · ' || (SELECT count(*) FROM cl) || ' para licitação'
                   ELSE 'Valor inicial − valor aprovado nas cotações' END,
      'base', 'Suprimentos › Dashboard de Compras (Visão Geral) · HAGG · ' || to_char(ini, 'DD/MM/YYYY') || ' a ' || to_char(hoje, 'DD/MM/YYYY'),
      'detalhe', CASE WHEN p_codigo = 'sup_cotacoes'
                      THEN jsonb_build_array(jsonb_build_object('nome', 'Compras (Malote)', 'valor', (SELECT count(*) FROM cm)),
                                             jsonb_build_object('nome', 'Licitação', 'valor', (SELECT count(*) FROM cl)))
                      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato,
                                       'valor', CASE WHEN p_codigo = 'sup_saving' THEN saving ELSE CASE WHEN inicial > 0 THEN round(100 * saving / inicial, 1) ELSE 0 END END) ORDER BY saving DESC)
                                       FROM (SELECT * FROM sc ORDER BY saving DESC LIMIT 6) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sup_valor_estoque' THEN
    v_emp := (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1);
    WITH estoque AS (
      SELECT i.tipo AS categoria, COALESCE(sum(s.disponivel), 0)::numeric AS disponivel, COALESCE(sum(s.disponivel), 0) * ei.valor_unitario AS valor_total
        FROM public.sup_estoque_item ei JOIN public.sup_item i ON i.id = ei.sup_item_id
        LEFT JOIN public.sup_estoque_saldo s ON s.item_estoque_id = ei.id
       WHERE ei.empresa_id = v_emp AND ei.arquivado_em IS NULL
       GROUP BY ei.id, i.tipo, ei.valor_unitario)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT round(sum(valor_total), 2) FROM estoque), 0),
      'afetado', (SELECT replace(to_char(COALESCE(sum(disponivel), 0), 'FM999G999G990'), ',', '.') || ' itens disponíveis' FROM estoque),
      'base', 'Suprimentos › Dashboard de Compras (Resumo do Estoque) · HAGG: saldo disponível × valor unitário',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', v) ORDER BY v DESC)
                             FROM (SELECT CASE categoria WHEN 'epi' THEN 'EPI' WHEN 'uniforme' THEN 'Uniformes' WHEN 'insumo' THEN 'Insumos'
                                                         WHEN 'equipamento' THEN 'Equipamentos' ELSE initcap(categoria) END AS nome, round(sum(valor_total), 2) v
                                     FROM estoque GROUP BY categoria) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_calc_espelho(p_codigo text, p_param numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_calc_espelho(p_codigo text, p_param numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_calc_espelho(p_codigo text, p_param numeric) TO service_role;

-- public.tvg_calc_extra(p_codigo text, p_param numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_calc_extra(p_codigo text, p_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
  v_comp text;
BEGIN
  -- ── DRE: lucratividade, margem, contratos vermelhos, desvio de custo ──
  IF p_codigo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL THEN RETURN jsonb_build_object('valor', NULL, 'observacao', 'DRE gerencial ainda sem competência com receita'); END IF;

    IF p_codigo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos') THEN
      WITH d AS (SELECT contrato, receita, coalesce(custo, 0) AS custo,
                        round(100 * (receita - coalesce(custo, 0)) / receita, 1) AS margem
                   FROM public.tvg_dre_contratos() WHERE competencia = v_comp AND receita >= 10000),  -- receita residual distorce a margem
      f AS (SELECT * FROM d WHERE (p_codigo = 'op_lucratividade')
                               OR (p_codigo = 'ctl_margem' AND margem < coalesce(p_param, 10))
                               OR (p_codigo = 'ctl_vermelhos' AND margem < 0))
      SELECT jsonb_build_object(
        'valor', CASE WHEN p_codigo = 'op_lucratividade'
                      THEN (SELECT round(100 * (sum(receita) - sum(custo)) / nullif(sum(receita), 0), 1) FROM d)
                      ELSE (SELECT count(*) FROM f) END,
        'impacto', (SELECT sum(least(receita - custo, 0)) FROM f),
        'afetado', (SELECT count(*) FILTER (WHERE margem < 0) || ' no prejuízo · ' || count(*) FILTER (WHERE margem < coalesce(p_param, 10)) || ' abaixo de '
                           || coalesce(p_param, 10)::int || '% de margem' FROM d),
        'causa', (SELECT 'Pior margem: ' || contrato || ' (' || replace(margem::text, '.', ',') || '%)' FROM d ORDER BY margem LIMIT 1),
        'base', 'DRE gerencial · competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' · ' || (SELECT count(*) FROM d) || ' contratos',
        'referencia', v_comp,
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', margem,
                                     'rotulo', replace(margem::text, '.', ',') || '% · receita R$ ' || replace(to_char(receita, 'FM999G999G990'), ',', '.')) ORDER BY margem)
                               FROM (SELECT * FROM f ORDER BY margem LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END IF;

    IF p_codigo IN ('op_custo_direto', 'ctl_desvio') THEN
      -- Custo da competência × a média das 3 anteriores, por contrato.
      WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4),
      d AS (SELECT t.contrato,
                   sum(t.custo) FILTER (WHERE t.competencia = v_comp) AS atual,
                   avg(t.custo) FILTER (WHERE t.competencia < v_comp) AS media
              FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia GROUP BY 1),
      x AS (SELECT contrato, atual, media, round(100 * (atual - media) / media, 1) AS pct FROM d WHERE media > 1000 AND atual IS NOT NULL),
      f AS (SELECT * FROM x WHERE pct > coalesce(p_param, 10))
      SELECT jsonb_build_object(
        'valor', CASE WHEN p_codigo = 'op_custo_direto'
                      THEN (SELECT round(100 * (sum(atual) - sum(media)) / nullif(sum(media), 0), 1) FROM x)
                      ELSE (SELECT count(*) FROM f) END,
        'impacto', (SELECT sum(atual - media) FROM f),
        'afetado', (SELECT count(*) || ' contrato(s) com custo ' || coalesce(p_param, 10)::int || '%+ acima da média' FROM f),
        'causa', (SELECT 'Maior alta: ' || contrato || ' (+' || replace(pct::text, '.', ',') || '%)' FROM f ORDER BY atual - media DESC LIMIT 1),
        'base', 'Custo da competência ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY') || ' × média dos 3 meses anteriores (DRE)',
        'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', pct, 'rotulo', '+' || replace(pct::text, '.', ',') || '%') ORDER BY pct DESC)
                               FROM (SELECT * FROM f ORDER BY pct DESC LIMIT 12) t), '[]'::jsonb))
        INTO r;
      RETURN r;
    END IF;

    -- ctl_reincidentes: abaixo da margem mínima nas 3 últimas competências.
    WITH m AS (SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp AND coalesce(receita, 0) > 0 GROUP BY 1 ORDER BY 1 DESC LIMIT 3),
    d AS (SELECT t.contrato, count(*) FILTER (WHERE 100 * (t.receita - coalesce(t.custo, 0)) / t.receita < coalesce(p_param, 10)) AS ruins,
                 round(avg(100 * (t.receita - coalesce(t.custo, 0)) / t.receita), 1) AS media
            FROM public.tvg_dre_contratos() t JOIN m ON m.competencia = t.competencia WHERE t.receita > 0 GROUP BY 1),
    f AS (SELECT * FROM d WHERE ruins >= 3)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) · 3 competências seguidas abaixo de ' || coalesce(p_param, 10)::int || '%' FROM f),
      'causa', (SELECT 'Mais crítico: ' || contrato || ' (média ' || replace(media::text, '.', ',') || '%)' FROM f ORDER BY media LIMIT 1),
      'base', 'DRE gerencial · 3 últimas competências até ' || to_char(to_date(v_comp, 'YYYY-MM'), 'MM/YYYY'),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', media, 'rotulo', 'margem média ' || replace(media::text, '.', ',') || '%') ORDER BY media)
                             FROM (SELECT * FROM f ORDER BY media LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faltas / absenteísmo (situação na folha, hoje) ────────────────────
  IF p_codigo IN ('op_faltas', 'rh_absenteismo') THEN
    WITH e AS (SELECT public.rh_norm_contrato(e."Nome Filial") AS nn, e."Situação" AS sit
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL),
    c AS (SELECT c.nome, public.dir_rel_contrato_nn(c.id) AS nn FROM public.contratos c WHERE c.status = 'ativo'),
    j AS (SELECT c.nome, count(*) AS ativos,
                 count(*) FILTER (WHERE (p_codigo = 'op_faltas' AND (e.sit ILIKE 'Atestado%' OR e.sit ILIKE 'Falta%'))
                                     OR (p_codigo = 'rh_absenteismo' AND e.sit NOT IN ('Trabalhando', 'Férias'))) AS fora
            FROM c JOIN e ON e.nn = c.nn GROUP BY 1),
    t AS (SELECT nome, ativos, fora, round(100.0 * fora / ativos, 1) AS pct FROM j WHERE ativos >= 5)
    SELECT jsonb_build_object(
      'valor', (SELECT round(100.0 * sum(fora) / nullif(sum(ativos), 0), 1) FROM t),
      'afetado', (SELECT count(*) FILTER (WHERE pct > coalesce(p_param, 3)) || ' contrato(s) acima de ' || coalesce(p_param, 3)::int || '%' FROM t),
      'causa', (SELECT "Situação" || ' (' || count(*) || ')' FROM public."EMPREGADOS"
                 WHERE "Situação" <> 'Demitido' AND ((p_codigo = 'op_faltas' AND ("Situação" ILIKE 'Atestado%' OR "Situação" ILIKE 'Falta%'))
                                                     OR (p_codigo = 'rh_absenteismo' AND "Situação" NOT IN ('Trabalhando', 'Férias')))
                 GROUP BY "Situação" ORDER BY count(*) DESC LIMIT 1),
      'base', (SELECT sum(fora) || ' de ' || sum(ativos) || ' colaboradores ativos, hoje' FROM t),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', pct, 'rotulo', fora || ' de ' || ativos) ORDER BY pct DESC)
                             FROM (SELECT * FROM t WHERE fora > 0 ORDER BY pct DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Reclamações do cliente (notificações que não são glosa/multa) ─────
  IF p_codigo = 'op_reclamacoes' THEN
    WITH n AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(n.causa_raiz), ''), nullif(btrim(n.assunto), ''), n.tipo, 'Sem causa registrada') AS causa
                 FROM public."JUR_NOTIFICACOES" n
                WHERE coalesce(n.tipo, '') NOT IN ('Glosa', 'Multa')
                  AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM n),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · últimos ' || coalesce(p_param, 90)::int || ' dias' FROM n),
      'causa', (SELECT left(causa, 80) || ' (' || count(*) || ')' FROM n GROUP BY causa ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q FROM n GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Salários: folha-base sobre o faturamento do contrato ──────────────
  IF p_codigo = 'rh_salarios' THEN
    WITH e AS (SELECT public.rh_norm_contrato(e."Nome Filial") AS nn, public.tvg_num_br(e."Valor Salário"::text) AS sal
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL),
    c AS (SELECT c.nome, c.valor_mensal_contratado AS fat, public.dir_rel_contrato_nn(c.id) AS nn
            FROM public.contratos c WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0),
    t AS (SELECT c.nome, c.fat, sum(e.sal) AS folha, round(100 * sum(e.sal) / c.fat, 1) AS pct
            FROM c JOIN e ON e.nn = c.nn GROUP BY c.nome, c.fat HAVING sum(e.sal) > 0),
    f AS (SELECT * FROM t WHERE pct > coalesce(p_param, 60))
    SELECT jsonb_build_object(
      'valor', (SELECT round(100 * sum(folha) / nullif(sum(fat), 0), 1) FROM t),
      'impacto', (SELECT sum(folha - fat * coalesce(p_param, 60) / 100) FROM f),
      'afetado', (SELECT count(*) || ' contrato(s) com folha acima de ' || coalesce(p_param, 60)::int || '% do faturamento' FROM f),
      'causa', (SELECT 'Maior peso: ' || nome || ' (' || replace(pct::text, '.', ',') || '%)' FROM t ORDER BY pct DESC LIMIT 1),
      'base', 'Salário-base dos ativos (folha Senior) ÷ valor mensal contratado',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', pct, 'rotulo', replace(pct::text, '.', ',') || '% do faturamento') ORDER BY pct DESC)
                             FROM (SELECT * FROM t ORDER BY pct DESC LIMIT 12) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Contratos de experiência vencendo ─────────────────────────────────
  IF p_codigo = 'rh_ob_experiencia' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato, hoje - public.rh_data(e."Admissão"::text) AS dias
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido'),
    f AS (SELECT contrato, CASE WHEN dias BETWEEN 45 - coalesce(p_param, 15)::int AND 45 THEN '1º período (45 d)' ELSE '2º período (90 d)' END AS marco
            FROM e WHERE dias BETWEEN 45 - coalesce(p_param, 15)::int AND 45 OR dias BETWEEN 90 - coalesce(p_param, 15)::int AND 90)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM f),
      'causa', (SELECT marco || ' (' || count(*) || ')' FROM f GROUP BY marco ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Fluxo de caixa: NF a receber − Malote a pagar, próximos N dias ────
  IF p_codigo = 'fin_fluxo' THEN
    WITH ent AS (SELECT n.data_emissao + 30 AS dia, coalesce(n.vlr_liquido_total, 0) AS v
                   FROM public.nf_emissao n
                  WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_pagamento IS NULL
                    AND n.data_emissao + 30 BETWEEN hoje AND hoje + coalesce(p_param, 30)::int),
    sai AS (SELECT d.data_pagamento AS dia, coalesce(d.valor_aprovado, d.valor_total, 0) AS v
              FROM public.malote_despesa d
             WHERE d.deleted_at IS NULL AND d.pago_em IS NULL AND coalesce(d.status, '') NOT ILIKE ANY (ARRAY['%cancel%', '%reprov%', '%pag%'])
               AND d.data_pagamento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int),
    sem AS (SELECT gs::date AS ini FROM generate_series(date_trunc('week', hoje)::date, hoje + coalesce(p_param, 30)::int, interval '7 days') gs)
    SELECT jsonb_build_object(
      'valor', COALESCE((SELECT sum(v) FROM ent), 0) - COALESCE((SELECT sum(v) FROM sai), 0),
      'impacto', COALESCE((SELECT sum(v) FROM sai), 0),
      'afetado', 'Entra R$ ' || replace(to_char(COALESCE((SELECT sum(v) FROM ent), 0), 'FM999G999G990'), ',', '.')
                 || ' · sai R$ ' || replace(to_char(COALESCE((SELECT sum(v) FROM sai), 0), 'FM999G999G990'), ',', '.'),
      'causa', (SELECT CASE WHEN COALESCE((SELECT sum(v) FROM ent), 0) < COALESCE((SELECT sum(v) FROM sai), 0) THEN 'Saídas previstas maiores que as entradas' END),
      'base', 'Próximos ' || coalesce(p_param, 30)::int || ' dias: NFs emitidas sem baixa (vencimento em 30 d) − despesas do Malote a pagar',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', 'Semana de ' || to_char(s.ini, 'DD/MM'),
                                   'a', COALESCE((SELECT sum(v) FROM ent WHERE dia >= s.ini AND dia < s.ini + 7), 0),
                                   'b', COALESCE((SELECT sum(v) FROM sai WHERE dia >= s.ini AND dia < s.ini + 7), 0),
                                   'valor', COALESCE((SELECT sum(v) FROM ent WHERE dia >= s.ini AND dia < s.ini + 7), 0)
                                            - COALESCE((SELECT sum(v) FROM sai WHERE dia >= s.ini AND dia < s.ini + 7), 0)) ORDER BY s.ini)
                             FROM sem s), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── SST ───────────────────────────────────────────────────────────────
  IF p_codigo IN ('sst_aso', 'sst_imp_aso') THEN
    WITH a AS (
      SELECT 'Admissional' AS tipo, coalesce(nullif(btrim(v.contrato), ''), 'Sem contrato') AS contrato,
             hoje - coalesce(c.etapa_changed_at, c.created_at)::date AS dias
        FROM public."WA_CURRICULOS" c LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
       WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
      UNION ALL
      SELECT 'Demissional', coalesce(nullif(btrim(s.contrato), ''), 'Sem contrato'), hoje - coalesce(s.data_solicitacao, s.criado_em::date)
        FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
       WHERE s.status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida'))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM a),
      'afetado', (SELECT count(*) FILTER (WHERE dias > coalesce(p_param, 5)) || ' há mais de ' || coalesce(p_param, 5)::int || ' dias' FROM a),
      'causa', (SELECT tipo || ' (' || count(*) || ')' FROM a GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM a GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('sst_epi', 'sst_imp_epi') THEN
    -- Pedidos de uniforme/EPI parados além do prazo (o EPI que não chegou ao posto).
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato, p.status, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.tipo_pedido IN ('uniforme', 'ambos')
                  AND p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais antigo: ' || max(dias) || ' d', '') FROM p),
      'causa', (SELECT initcap(lower(status)) || ' (' || count(*) || ')' FROM p GROUP BY status ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', initcap(lower(status)), 'valor', q) ORDER BY q DESC) FROM (SELECT status, count(*) q FROM p GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'sst_acidentes' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato, e."Situação" AS sit
                 FROM public."EMPREGADOS" e
                WHERE e."Situação" ILIKE '%acident%' OR e."Descrição (Causa)" ILIKE '%acident%' AND e."Situação" <> 'Demitido')
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM e),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' FROM e),
      'causa', (SELECT sit || ' (' || count(*) || ')' FROM e GROUP BY sit ORDER BY count(*) DESC LIMIT 1),
      'base', 'Afastados por acidente na folha, hoje',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC) FROM (SELECT contrato, count(*) q FROM e GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamento (plataforma) ──────────────────────────────────────────
  IF p_codigo IN ('trn_contratuais', 'trn_vencidos', 'sst_imp_treinamento') THEN
    WITH m AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato, c.nome AS curso, hoje - m.inscrito_em AS dias, a.expira_em
                 FROM public."TRN_MATRICULA" m
                 JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id AND a.status = 'ativo'
                 JOIN public."TRN_CURSO" c ON c.id = m.curso_id
                WHERE NOT EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = m.aluno_id AND ce.curso_id = m.curso_id)),
    f AS (SELECT * FROM m WHERE (p_codigo = 'trn_contratuais' AND dias > coalesce(p_param, 30))
                             OR (p_codigo IN ('trn_vencidos', 'sst_imp_treinamento') AND expira_em IS NOT NULL AND expira_em <= hoje + coalesce(p_param, 15)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s) · ' || count(DISTINCT curso) || ' curso(s)' FROM f),
      'causa', (SELECT 'Mais pendente: ' || curso || ' (' || count(*) || ')' FROM f GROUP BY curso ORDER BY count(*) DESC LIMIT 1),
      'base', CASE WHEN p_codigo = 'trn_contratuais' THEN 'Matrículas sem certificado há mais de ' || coalesce(p_param, 30)::int || ' dias'
                   ELSE 'Acesso vencido ou vencendo em ' || coalesce(p_param, 15)::int || ' dias, sem certificado' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q) ORDER BY q DESC) FROM (SELECT contrato, count(*) q FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('trn_programados', 'trn_sem_comprovacao') THEN
    WITH mes AS (SELECT date_trunc('month', hoje)::date AS ini),
    mat AS (SELECT count(*) n FROM public."TRN_MATRICULA" m, mes WHERE m.inscrito_em >= mes.ini),
    cer AS (SELECT count(*) n FROM public."TRN_CERTIFICADO" c, mes WHERE c.emitido_em >= mes.ini),
    serie AS (SELECT to_char(g, 'MM/YY') AS nome, g AS ini,
                     (SELECT count(*) FROM public."TRN_MATRICULA" m WHERE m.inscrito_em >= g AND m.inscrito_em < g + interval '1 month') AS a,
                     (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month') AS b
                FROM generate_series(date_trunc('month', hoje) - interval '5 months', date_trunc('month', hoje), interval '1 month') g)
    SELECT jsonb_build_object(
      'valor', CASE WHEN p_codigo = 'trn_programados'
                    THEN (SELECT CASE WHEN mat.n = 0 THEN 100 ELSE round(100.0 * cer.n / mat.n) END FROM mat, cer)
                    ELSE (SELECT count(*) FROM public."TRN_MATRICULA" m
                           WHERE m.inscrito_em < hoje - coalesce(p_param, 60)::int
                             AND NOT EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" c WHERE c.aluno_id = m.aluno_id AND c.curso_id = m.curso_id)) END,
      'afetado', (SELECT cer.n || ' certificado(s) para ' || mat.n || ' matrícula(s) no mês' FROM mat, cer),
      'base', CASE WHEN p_codigo = 'trn_programados' THEN 'Certificados emitidos ÷ matrículas do mês'
                   ELSE 'Matrículas com mais de ' || coalesce(p_param, 60)::int || ' dias sem certificado' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'a', a, 'b', b, 'valor', b) ORDER BY ini) FROM serie), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Frota e patrimônio ────────────────────────────────────────────────
  IF p_codigo = 'fro_documentos' THEN
    WITH v AS (SELECT p.nome || coalesce(' · ' || p.identificador, '') AS nome, coalesce(nullif(btrim(p.lotacao), ''), 'Sem lotação') AS lot
                 FROM public.sup_patrimonio p
                WHERE p.categoria = 'veiculo' AND p.ativo
                  AND NOT EXISTS (SELECT 1 FROM public.sup_patrimonio_arquivo a WHERE a.patrimonio_id = p.id))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM v),
      'afetado', (SELECT count(DISTINCT lot) || ' lotação(ões)' FROM v),
      'causa', CASE WHEN (SELECT count(*) FROM v) > 0 THEN 'Veículo sem CRLV/documento anexado no cadastro' END,
      'base', (SELECT count(*) || ' veículos ativos' FROM public.sup_patrimonio WHERE categoria = 'veiculo' AND ativo),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', lot, 'valor', q) ORDER BY q DESC) FROM (SELECT lot, count(*) q FROM v GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fro_combustivel' THEN
    -- Sem lançamento de combustível no ERP: o controle de km das viagens é o que existe.
    WITH a AS (SELECT coalesce(a.veiculo_nome, 'Veículo') || coalesce(' · ' || a.veiculo_identificador, '') AS veiculo,
                      a.km_inicial, a.km_final, a.data_fim
                 FROM public.cs_veiculo_agendamento a
                WHERE a.controle_km AND coalesce(a.status, '') NOT ILIKE '%cancel%'
                  AND a.data_fim BETWEEN hoje - coalesce(p_param, 60)::int AND hoje - 1),
    f AS (SELECT * FROM a WHERE km_inicial IS NULL OR km_final IS NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(DISTINCT veiculo) || ' veículo(s) · ' || (SELECT count(*) FROM a) || ' viagens no período' FROM f),
      'causa', CASE WHEN (SELECT count(*) FROM f) > 0 THEN 'Viagem encerrada sem km inicial/final registrado' END,
      'base', 'Últimos ' || coalesce(p_param, 60)::int || ' dias · km rodado: ' ||
              (SELECT replace(to_char(coalesce(sum(km_final - km_inicial) FILTER (WHERE km_final >= km_inicial), 0), 'FM999G999G990'), ',', '.') FROM a) || ' km',
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', veiculo, 'valor', km, 'rotulo', km || ' km') ORDER BY km DESC)
                             FROM (SELECT veiculo, sum(km_final - km_inicial) km FROM a WHERE km_final >= km_inicial GROUP BY 1 ORDER BY 2 DESC LIMIT 10) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'fro_nao_localizados' THEN
    -- Patrimônio sem nenhuma movimentação/atualização há N dias = inventário a conferir.
    WITH p AS (SELECT initcap(p.categoria) AS cat, hoje - greatest(p.updated_at, (SELECT max(l.created_at) FROM public.sup_patrimonio_log l WHERE l.patrimonio_id = p.id))::date AS dias
                 FROM public.sup_patrimonio p WHERE p.ativo),
    f AS (SELECT * FROM p WHERE dias > coalesce(p_param, 180))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM f),
      'afetado', (SELECT count(*) || ' de ' || (SELECT count(*) FROM p) || ' patrimônios ativos' FROM f),
      'causa', CASE WHEN (SELECT count(*) FROM f) > 0 THEN 'Sem conferência/movimentação há mais de ' || coalesce(p_param, 180)::int || ' dias' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', cat, 'valor', q) ORDER BY q DESC) FROM (SELECT cat, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Jurídico ──────────────────────────────────────────────────────────
  IF p_codigo = 'jur_contratos_analise' THEN
    WITH n AS (SELECT coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato, hoje - n.medida_prazo AS atraso
                 FROM public."JUR_NOTIFICACOES" n
                WHERE nullif(btrim(n.medida_preventiva), '') IS NOT NULL AND NOT coalesce(n.medida_concluida, false) AND n.medida_prazo < hoje)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM n),
      'afetado', (SELECT count(DISTINCT contrato) || ' contrato(s)' || COALESCE(' · mais atrasada: ' || max(atraso) || ' d', '') FROM n),
      'causa', CASE WHEN (SELECT count(*) FROM n) > 0 THEN 'Medida preventiva vencida, não concluída' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', q, 'rotulo', q || ' · até ' || m || ' d') ORDER BY q DESC)
                             FROM (SELECT contrato, count(*) q, max(atraso) m FROM n GROUP BY 1 ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo IN ('jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (SELECT coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato') AS contrato,
                      coalesce(p.valor_pedidos, p.valor_causa, 0)::numeric AS pedidos,
                      coalesce(p.valor_sentenca, 0)::numeric AS sentenca, coalesce(p.valor_acordo, 0) AS acordo
                 FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO'),
    f AS (SELECT *, CASE WHEN pedidos >= 200000 THEN 'R$ 200 mil ou mais' WHEN pedidos >= 100000 THEN 'R$ 100 a 200 mil'
                         WHEN pedidos >= 50000 THEN 'R$ 50 a 100 mil' ELSE 'Até R$ 50 mil' END AS faixa FROM p)
    SELECT jsonb_build_object(
      'valor', CASE p_codigo WHEN 'jur_risco' THEN (SELECT count(*) FROM f WHERE pedidos >= coalesce(p_param, 100000))
                             WHEN 'jur_valor_condenacao' THEN (SELECT sum(sentenca) FROM f)
                             ELSE (SELECT sum(acordo) FROM f) END,
      'impacto', (SELECT sum(pedidos) FILTER (WHERE pedidos >= coalesce(p_param, 100000)) FROM f),
      'afetado', (SELECT count(*) || ' processos em andamento · R$ ' || replace(to_char(sum(pedidos), 'FM999G999G990'), ',', '.') || ' em pedidos' FROM f),
      'causa', (SELECT 'Maior exposição: ' || contrato FROM f GROUP BY contrato ORDER BY sum(pedidos) DESC LIMIT 1),
      'detalhe', CASE WHEN p_codigo = 'jur_risco'
                      THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', faixa, 'valor', q) ORDER BY q DESC) FROM (SELECT faixa, count(*) q FROM f GROUP BY 1) t), '[]'::jsonb)
                      ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', contrato, 'valor', s) ORDER BY s DESC)
                                       FROM (SELECT contrato, sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) s
                                               FROM f GROUP BY 1 HAVING sum(CASE WHEN p_codigo = 'jur_valor_condenacao' THEN sentenca ELSE acordo END) > 0
                                              ORDER BY 2 DESC LIMIT 12) t), '[]'::jsonb) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações ────────────────────────────────────────────────────────
  IF p_codigo = 'lic_documentos' THEN
    WITH g AS (SELECT coalesce(g.edital, 's/ edital') || coalesce(' · ' || g.cidade, '') AS nome, g.data - hoje AS dias
                 FROM public.grade g
                WHERE g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.capa_id IS NULL
                  AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE dias <= 3) || ' com sessão em até 3 dias' FROM g),
      'causa', CASE WHEN (SELECT count(*) FROM g) > 0 THEN 'Capa do edital (documentação/requisitos) não preenchida' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', dias, 'rotulo', CASE dias WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || dias || ' d' END) ORDER BY dias)
                             FROM (SELECT * FROM g ORDER BY dias LIMIT 12) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'lic_risco' THEN
    WITH g AS (SELECT g.fase::text AS fase, coalesce(nullif(btrim(g.status_obs), ''), 'Sem observação') AS motivo, public.tvg_num_br(g.valor_global) AS v
                 FROM public.grade g WHERE g.fase::text IN ('Suspenso', 'Revogado')
                  AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 180)::int))
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM g), 'impacto', (SELECT sum(v) FROM g),
      'afetado', (SELECT count(*) FILTER (WHERE fase = 'Suspenso') || ' suspensa(s) · ' || count(*) FILTER (WHERE fase = 'Revogado') || ' revogada(s)' FROM g),
      'causa', (SELECT left(motivo, 70) || ' (' || count(*) || ')' FROM g GROUP BY motivo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', fase, 'valor', q) ORDER BY q DESC) FROM (SELECT fase, count(*) q FROM g GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: pedidos em atraso por tipo ────────────────────────────────
  IF p_codigo = 'sup_fornecedor' THEN
    WITH p AS (SELECT initcap(coalesce(p.tipo_pedido, 'outros')) AS tipo, hoje - p.data_solicitacao AS dias
                 FROM public.sup_pedido p
                WHERE p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                  AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM p),
      'afetado', (SELECT 'Mais antigo: ' || max(dias) || ' dias' FROM p),
      'causa', (SELECT 'Mais atrasos: ' || tipo || ' (' || count(*) || ')' FROM p GROUP BY tipo ORDER BY count(*) DESC LIMIT 1),
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', tipo, 'valor', q) ORDER BY q DESC) FROM (SELECT tipo, count(*) q FROM p GROUP BY 1) t), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_codigo = 'ti_indisponiveis' THEN
    WITH d AS (SELECT coalesce(d.nome, d.codigo) AS nome, coalesce(d.local, '—') AS local,
                      round(extract(epoch FROM now() - d.ultimo_ping) / 60) AS min
                 FROM public."TV_DISPOSITIVO" d WHERE d.ativo AND d.pareado_em IS NOT NULL)
    SELECT jsonb_build_object('valor', (SELECT count(*) FROM d WHERE min IS NULL OR min > 3),
      'afetado', (SELECT count(*) || ' telas pareadas' FROM d),
      'causa', CASE WHEN (SELECT count(*) FROM d WHERE min IS NULL OR min > 3) > 0 THEN 'TV sem sinal com o ERP há mais de 3 minutos' END,
      'detalhe', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', coalesce(min, 0),
                                   'rotulo', CASE WHEN min IS NULL THEN 'nunca conectou' WHEN min > 1440 THEN 'há ' || round(min / 1440) || ' d' ELSE 'há ' || min || ' min' END) ORDER BY min DESC NULLS FIRST)
                             FROM d WHERE min IS NULL OR min > 3), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_codigo = 'ti_backups' THEN
    -- O espelho da Senior (ponto) é a integração crítica: quantos dias atrás está.
    SELECT jsonb_build_object(
      'valor', greatest(0, hoje - 1 - coalesce(public.diaria_ponto_sincronizado_ate(), hoje - 99)),
      'afetado', 'Ponto sincronizado até ' || coalesce(to_char(public.diaria_ponto_sincronizado_ate(), 'DD/MM/YYYY'), '—'),
      'causa', CASE WHEN coalesce(public.diaria_ponto_sincronizado_ate(), hoje - 99) < hoje - 1 THEN 'Espelho do relógio de ponto (Senior) parado' END,
      'base', 'O espelho chega até ontem quando está em dia')
      INTO r;
    RETURN r;
  END IF;

  RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_calc_extra(p_codigo text, p_param numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_calc_extra(p_codigo text, p_param numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_calc_extra(p_codigo text, p_param numeric) TO service_role;

-- public.tvg_dre_atualizar()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_dre_atualizar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.tvg_dre_mv;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_dre_atualizar()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_dre_atualizar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_dre_atualizar() TO service_role;

-- public.tvg_dre_competencia()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_dre_competencia()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH t AS (SELECT competencia, sum(receita) AS rec FROM public.tvg_dre_contratos() GROUP BY 1 HAVING sum(receita) > 0),
  m AS (SELECT competencia, rec, avg(rec) OVER (ORDER BY competencia ROWS BETWEEN 6 PRECEDING AND 1 PRECEDING) AS media FROM t)
  SELECT competencia FROM m WHERE media IS NULL OR rec >= media * 0.5 ORDER BY competencia DESC LIMIT 1
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_dre_competencia()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_dre_competencia() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_dre_competencia() TO service_role;

-- public.tvg_dre_contratos()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_dre_contratos()
 RETURNS TABLE(competencia text, contrato text, receita numeric, custo numeric, despesa numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT competencia, contrato, receita, custo, despesa FROM public.tvg_dre_mv
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_dre_contratos()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_dre_contratos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_dre_contratos() TO service_role;

-- public.tvg_equipe_meta(p_painel text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_equipe_meta(p_painel text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ganhos AS (
    SELECT c.id, c.objeto, c.cidade, c.cliente, c.responsavel, public.tvg_nome_norm(c.responsavel) AS resp_norm,
           public.tvg_valor_texto(c.valor_estimado) AS valor,
           public.tvg_prazo_meses(c.prazo_contrato) AS prazo,
           COALESCE(c.data_homologacao::date,
                    (SELECT to_date(left(h->>'ts', 10), 'DD/MM/YYYY') FROM jsonb_array_elements(COALESCE(c.historico, '[]'::jsonb)) h
                      WHERE h->>'campo' = 'Status' AND h->>'para' = 'Ganhamos' ORDER BY to_date(left(h->>'ts', 10), 'DD/MM/YYYY') DESC LIMIT 1),
                    c.updated_at::date) AS ganho_em
      FROM public.capa_edital c
     WHERE c.status::text = 'Ganhamos'
  ),
  pessoa AS (
    SELECT m.*, (SELECT array_agg(public.tvg_nome_norm(x)) FROM unnest(m.nomes_capa || ARRAY[m.nome]) x) AS nomes_norm,
           (SELECT p.avatar_url FROM public.profiles p WHERE p.id = m.user_id) AS foto
      FROM public."TVG_META_EQUIPE" m
     WHERE m.painel = p_painel AND m.ativo
  ),
  conta AS (
    SELECT pe.id,
           COALESCE(jsonb_agg(jsonb_build_object(
             'objeto', coalesce(nullif(btrim(g.objeto), ''), g.cidade, 'Edital'), 'cidade', g.cidade, 'cliente', g.cliente,
             'ganho_em', g.ganho_em, 'valor_estimado', g.valor, 'prazo_meses', coalesce(g.prazo, 12),
             'prazo_assumido', g.prazo IS NULL, 'mensal', round(coalesce(g.valor, 0) / coalesce(g.prazo, 12), 2))
             ORDER BY g.ganho_em DESC) FILTER (WHERE g.id IS NOT NULL), '[]'::jsonb) AS itens,
           count(g.id) AS contratos,
           COALESCE(sum(coalesce(g.valor, 0) / coalesce(g.prazo, 12)), 0) AS valor_mensal
      FROM pessoa pe
      LEFT JOIN ganhos g ON g.resp_norm = ANY (pe.nomes_norm) AND g.ganho_em >= pe.ganhos_desde
     GROUP BY pe.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', pe.id, 'nome', pe.nome, 'foto', pe.foto, 'cor', pe.cor, 'tipo', pe.tipo, 'meta', pe.meta,
           'ganhos_desde', pe.ganhos_desde,
           'realizado', CASE WHEN pe.tipo = 'contratos' THEN c.contratos ELSE round(c.valor_mensal, 2) END,
           'contratos', c.contratos, 'valor_mensal', round(c.valor_mensal, 2),
           'pct', round(100 * (CASE WHEN pe.tipo = 'contratos' THEN c.contratos ELSE c.valor_mensal END) / pe.meta, 1),
           'itens', c.itens) ORDER BY pe.ordem, pe.nome), '[]'::jsonb)
    FROM pessoa pe JOIN conta c ON c.id = pe.id;
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_equipe_meta(p_painel text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_equipe_meta(p_painel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_equipe_meta(p_painel text) TO service_role;

-- public.tvg_espelho_chamados()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_chamados()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  r jsonb;
BEGIN
  WITH c AS (SELECT c.*, c.status NOT IN ('concluido', 'reprovado', 'cancelado') AS ativo,
                    (c.concluido_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia_conc
               FROM public."CHAMADO_SISTEMA" c),
  notas AS (SELECT coalesce(a.qualidade, 0) * 0.30 + coalesce(a.prazo, 0) * 0.20 + coalesce(a.comunicacao, 0) * 0.15
                 + coalesce(a.clareza, 0) * 0.10 + coalesce(a.facilidade, 0) * 0.10 + coalesce(a.satisfacao, 0) * 0.15 AS nota
              FROM public."CHAMADO_SISTEMA_AVALIACAO" a JOIN public."CHAMADO_SISTEMA" s ON s.id = a.chamado_id),
  cat AS (SELECT CASE x WHEN 'power_bi' THEN 'Power BI' WHEN 'relatorios_dashboards' THEN 'Relatórios / Dashboards'
                        WHEN 'ajuste_tela_cadastro' THEN 'Ajuste em Tela / Cadastro' WHEN 'correcao_erro' THEN 'Correção de Erro'
                        WHEN 'integracoes' THEN 'Integrações' WHEN 'dados_informacao' THEN 'Dados / Informação'
                        WHEN 'acesso_permissao' THEN 'Acesso / Permissão' WHEN 'outros' THEN 'Outros' ELSE x END AS nome
            FROM c, unnest(coalesce(c.categorias, ARRAY[]::text[])) x)
  SELECT jsonb_build_object(
    'tela', 'Sistemas › Dashboard de Chamados',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Na fila', 'valor', (SELECT count(*) FROM c WHERE ativo), 'formato', 'n', 'dica', 'Chamados ainda não concluídos, reprovados nem cancelados'),
      jsonb_build_object('rotulo', 'Em andamento', 'valor', (SELECT count(*) FROM c WHERE status = 'em_andamento'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aguardando', 'valor', (SELECT count(*) FROM c WHERE status = 'aguardando_retorno'), 'formato', 'n', 'dica', 'Aguardando retorno do solicitante'),
      jsonb_build_object('rotulo', 'Concluídos/mês', 'valor', (SELECT count(*) FROM c WHERE status = 'concluido' AND dia_conc >= ini), 'formato', 'n', 'dica', 'Desde ' || to_char(ini, 'DD/MM')),
      jsonb_build_object('rotulo', 'Atrasados', 'valor', (SELECT count(*) FROM c WHERE ativo AND prazo_previsto < hoje), 'formato', 'n', 'dica', 'Na fila com o prazo previsto vencido'),
      jsonb_build_object('rotulo', 'Satisfação', 'valor', (SELECT round(avg(nota)::numeric, 1) FROM notas), 'formato', 'n',
                         'dica', (SELECT count(*) || ' avaliação(ões) · nota de 0 a 5' FROM notas))),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'entregas', 'rotulo', 'Entregas'), jsonb_build_object('chave', 'abertos', 'rotulo', 'Abertos')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'entregas', (SELECT count(*) FROM c WHERE dia_conc >= g AND dia_conc < g + interval '1 month'),
                  'abertos', (SELECT count(*) FROM c WHERE (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date >= g AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date < g + interval '1 month')) ORDER BY g)
                  FROM generate_series(ini - interval '5 months', ini, interval '1 month') g)),
    'graficos', jsonb_build_object(
      'categoria', jsonb_build_object('titulo', 'Chamados por categoria', 'tipo', 'colunas', 'itens',
         COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', n) ORDER BY n DESC) FROM (SELECT nome, count(*) n FROM cat GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t), '[]'::jsonb)),
      'entregas', jsonb_build_object('titulo', 'Entregas por mês', 'tipo', 'colunas', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', to_char(g, 'MM/YY'), 'valor', (SELECT count(*) FROM c WHERE dia_conc >= g AND dia_conc < g + interval '1 month')) ORDER BY g)
            FROM generate_series(ini - interval '5 months', ini, interval '1 month') g)),
      'setores', jsonb_build_object('titulo', 'Setores que mais abrem', 'tipo', 'colunas', 'itens',
         COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', setor, 'valor', n) ORDER BY n DESC) FROM (SELECT setor, count(*) n FROM c WHERE nullif(btrim(setor), '') IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t), '[]'::jsonb)),
      'situacao', jsonb_build_object('titulo', 'Situação dos chamados', 'tipo', 'rosca', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', s.rotulo, 'valor', (SELECT count(*) FROM c WHERE c.status = s.st)) ORDER BY s.o)
            FROM (VALUES (1, 'aberto', 'Aberto'), (2, 'em_andamento', 'Em andamento'), (3, 'aguardando_retorno', 'Aguardando retorno'),
                         (4, 'concluido', 'Concluído'), (5, 'reprovado', 'Reprovado'), (6, 'cancelado', 'Cancelado')) s(o, st, rotulo)))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_chamados()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_chamados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_chamados() TO service_role;

-- public.tvg_espelho_financeiro()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_financeiro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb;
BEGIN
  WITH n AS (
    SELECT n.*, c.nome AS contrato_nome,
           CASE WHEN 'CANCELADA' IN (upper(coalesce(n.situacao_site_pmt, '')), upper(coalesce(n.situacao_dominio, ''))) THEN 'CANCELADA'
                WHEN 'SUBSTITUIDA' IN (upper(coalesce(n.situacao_site_pmt, '')), upper(coalesce(n.situacao_dominio, ''))) THEN 'SUBSTITUIDA' END AS esp
      FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
     WHERE n.deleted_at IS NULL AND n.status::text NOT IN ('rascunho', 'enviada')),
  i AS (SELECT it.nf_emissao_id,
               sum(coalesce(it.multas_pos_emissao, 0) + coalesce(it.glosas_pos_emissao, 0) + coalesce(it.outros_descontos_pos_emissao, 0)) AS pos,
               sum(coalesce(it.faltas, 0) + coalesce(it.posto_nao_implementado, 0) + coalesce(it.multas, 0) + coalesce(it.multas_pos_emissao, 0)
                   + coalesce(it.glosas, 0) + coalesce(it.glosas_pos_emissao, 0) + coalesce(it.outros_descontos, 0) + coalesce(it.outros_descontos_pos_emissao, 0)) AS desc_itens
          FROM public.nf_emissao_item it JOIN n ON n.id = it.nf_emissao_id GROUP BY 1),
  s AS (
    SELECT n.*, coalesce(i.pos, 0) AS pos, coalesce(i.desc_itens, 0) AS desc_itens,
           CASE WHEN esp = 'CANCELADA' OR n.status::text = 'cancelada' THEN 'cancelada' WHEN esp = 'SUBSTITUIDA' THEN 'substituida'
                WHEN n.data_pagamento IS NOT NULL THEN 'pago' ELSE 'pendente' END AS st,
           CASE WHEN esp IS NOT NULL THEN 0
                ELSE greatest(0, coalesce(n.vlr_liquido_total, 0) - coalesce(n.valor_pago, 0) - coalesce(n.desconto_conta_vinculada, 0) - coalesce(i.pos, 0)) END AS pendente
      FROM n LEFT JOIN i ON i.nf_emissao_id = n.id),
  k AS (SELECT * FROM s WHERE st NOT IN ('cancelada', 'substituida')),
  comp AS (SELECT competencia, sum(coalesce(valor_contrato_exec_total, 0)) exe, sum(coalesce(vlr_bruto_total, 0)) fat, sum(coalesce(valor_pago, 0)) rec
             FROM k GROUP BY 1 ORDER BY 1 DESC LIMIT 12)
  SELECT jsonb_build_object(
    'tela', 'Financeiro › Relatório de Serviços › Dashboard',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Total de Notas', 'valor', (SELECT count(*) FROM s), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Valor Executado', 'valor', (SELECT round(coalesce(sum(valor_contrato_exec_total), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Faturado', 'valor', (SELECT round(coalesce(sum(vlr_bruto_total), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Recebido', 'valor', (SELECT round(coalesce(sum(valor_pago), 0), 2) FROM k), 'formato', 'brl'),
      jsonb_build_object('rotulo', 'Valor Pendente', 'valor', (SELECT round(coalesce(sum(pendente), 0), 2) FROM k), 'formato', 'brl',
                         'dica', (SELECT replace(round(100.0 * count(*) FILTER (WHERE st = 'pago') / nullif(count(*), 0), 1)::text, '.', ',') || '% das notas pagas' FROM s)),
      jsonb_build_object('rotulo', 'Total de Descontos', 'valor', (SELECT round(coalesce(sum(coalesce(desconto_conta_vinculada, 0) + desc_itens), 0), 2) FROM k), 'formato', 'brl',
                         'dica', (SELECT replace(round(100 * sum(coalesce(desconto_conta_vinculada, 0) + desc_itens) / nullif(sum(valor_contrato_exec_total), 0), 1)::text, '.', ',') || '% do executado' FROM k))),
    'mensal', jsonb_build_object('unidade', 'brl',
      'series', jsonb_build_array(jsonb_build_object('chave', 'faturado', 'rotulo', 'Faturado'), jsonb_build_object('chave', 'recebido', 'rotulo', 'Recebido')),
      'dados', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(competencia, 'YYYY-MM'), 'faturado', round(fat, 2), 'recebido', round(rec, 2), 'executado', round(exe, 2)) ORDER BY competencia) FROM comp), '[]'::jsonb)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação das notas', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', x.rotulo, 'valor', q) ORDER BY x.o)
           FROM (VALUES (1, 'pago', 'Pago'), (2, 'pendente', 'Pendente'), (3, 'substituida', 'Substituída'), (4, 'cancelada', 'Cancelada')) x(o, st, rotulo)
           CROSS JOIN LATERAL (SELECT count(*) q FROM s WHERE s.st = x.st) c WHERE q > 0), '[]'::jsonb)),
      'pendencias', jsonb_build_object('titulo', 'Maiores valores pendentes por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', round(v, 2)) ORDER BY v DESC)
           FROM (SELECT coalesce(contrato_nome, 'Sem contrato') nome, sum(pendente) v FROM s GROUP BY 1 HAVING sum(pendente) > 0 ORDER BY 2 DESC LIMIT 7) t), '[]'::jsonb)),
      'descontos', jsonb_build_object('titulo', 'Composição dos descontos', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', rotulo, 'valor', round(v, 2)) ORDER BY o)
           FROM (SELECT 1 o, 'Faltas' rotulo, (SELECT coalesce(sum(it.faltas), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id) v
                 UNION ALL SELECT 2, 'Posto não implementado', (SELECT coalesce(sum(it.posto_nao_implementado), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 3, 'Multas', (SELECT coalesce(sum(coalesce(it.multas, 0) + coalesce(it.multas_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 4, 'Glosas', (SELECT coalesce(sum(coalesce(it.glosas, 0) + coalesce(it.glosas_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 5, 'Outros descontos', (SELECT coalesce(sum(coalesce(it.outros_descontos, 0) + coalesce(it.outros_descontos_pos_emissao, 0)), 0) FROM public.nf_emissao_item it JOIN k ON k.id = it.nf_emissao_id)
                 UNION ALL SELECT 6, 'Conta vinculada', (SELECT coalesce(sum(desconto_conta_vinculada), 0) FROM k)) z))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_financeiro()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_financeiro() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_financeiro() TO service_role;

-- public.tvg_espelho_fonte(p_fonte text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte(p_fonte text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  k text := 'tvg.esp_' || md5(p_fonte);
  c text := current_setting(k, true);
  d jsonb; r jsonb;
BEGIN
  IF c IS NOT NULL AND c <> '' THEN RETURN c::jsonb; END IF;

  IF p_fonte LIKE 'rel:%' THEN
    -- Relatórios › <relatório padrão>: dir_rel_dados, período padrão da tela (12 meses).
    d := public.dir_rel_dados(substr(p_fonte, 5), NULL, NULL, NULL, NULL);
    r := jsonb_build_object(
      'tela', 'Relatórios › ' || coalesce(d->>'titulo', substr(p_fonte, 5)),
      'periodo', d->'periodo', 'kpis', d->'kpis', 'mensal', d->'mensal',
      'graficos', jsonb_build_object('status', jsonb_build_object('titulo', 'Por status', 'tipo', 'rosca',
                    'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', x->>'nome', 'valor', (x->>'n')::numeric)) FROM jsonb_array_elements(d->'por_status') x), '[]'::jsonb)))
                  || COALESCE((SELECT jsonb_object_agg('ranking:' || (o - 1), jsonb_build_object('titulo', q->>'titulo', 'tipo', 'colunas',
                       'itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', i->>'nome', 'valor', (i->>'n')::numeric)) FROM jsonb_array_elements(q->'itens') i), '[]'::jsonb)))
                     FROM jsonb_array_elements(d->'rankings') WITH ORDINALITY z(q, o)), '{}'::jsonb));
  ELSE
    r := public.tvg_espelho_fonte_extra(p_fonte);
  END IF;

  IF r IS NOT NULL THEN PERFORM set_config(k, r::text, true); END IF;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_fonte(p_fonte text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte(p_fonte text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_fonte(p_fonte text) TO service_role;

-- public.tvg_espelho_fonte_extra(p_fonte text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_fonte_extra(p_fonte text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_fonte = 'vagas' THEN RETURN public.tvg_espelho_vagas(); END IF;
  IF p_fonte = 'chamados' THEN RETURN public.tvg_espelho_chamados(); END IF;
  IF p_fonte = 'treinamentos' THEN RETURN public.tvg_espelho_treinamentos(); END IF;
  IF p_fonte = 'licitacoes' THEN RETURN public.tvg_espelho_licitacoes(); END IF;
  IF p_fonte = 'plano_acoes' THEN RETURN public.tvg_espelho_plano_acoes(); END IF;
  IF p_fonte = 'geral' THEN RETURN public.tvg_espelho_geral(); END IF;
  IF p_fonte = 'turnover' THEN RETURN public.tvg_espelho_turnover(); END IF;
  IF p_fonte = 'frota' THEN RETURN public.tvg_espelho_frota(); END IF;
  IF p_fonte = 'financeiro' THEN RETURN public.tvg_espelho_financeiro(); END IF;
  IF p_fonte = 'sst' THEN RETURN public.tvg_espelho_sst(); END IF;
  RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_fonte_extra(p_fonte text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_fonte_extra(p_fonte text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_fonte_extra(p_fonte text) TO service_role;

-- public.tvg_espelho_frota()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_frota()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini date := date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  fim date := (date_trunc('year', (now() AT TIME ZONE 'America/Sao_Paulo')) + interval '1 year - 1 day')::date;
  r jsonb;
BEGIN
  WITH a AS (
    SELECT a.*, CASE WHEN a.status = 'cancelado' THEN 'Cancelado' WHEN a.data_inicio > hoje THEN 'Agendado'
                     WHEN a.data_fim < hoje THEN 'Realizado' ELSE 'Em andamento' END AS sit,
           CASE WHEN a.data_fim >= a.data_inicio THEN a.data_fim - a.data_inicio + 1 ELSE 1 END AS dias
      FROM public.cs_veiculo_agendamento a
     WHERE a.data_fim >= ini AND a.data_inicio <= fim),
  vivos AS (SELECT * FROM a WHERE status <> 'cancelado'),
  ctr AS (SELECT c.contrato_nome FROM public.cs_veiculo_agendamento_contrato c JOIN vivos v ON v.id = c.agendamento_id),
  meses AS (SELECT generate_series(date_trunc('month', (SELECT min(data_inicio) FROM a)), date_trunc('month', (SELECT max(data_inicio) FROM a)), interval '1 month')::date AS m)
  SELECT jsonb_build_object(
    'tela', 'Agendamento de Veículos › Dashboard',
    'periodo', jsonb_build_object('de', ini, 'ate', fim),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Agendamentos', 'valor', (SELECT count(*) FROM a), 'formato', 'n',
                         'dica', (SELECT count(DISTINCT solicitante_id) || ' solicitante(s)' FROM a)),
      jsonb_build_object('rotulo', 'Realizados', 'valor', (SELECT count(*) FROM a WHERE sit = 'Realizado'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Pela frente', 'valor', (SELECT count(*) FROM a WHERE sit IN ('Agendado', 'Em andamento')), 'formato', 'n',
                         'dica', (SELECT count(*) FROM a WHERE sit = 'Em andamento') || ' em andamento'),
      jsonb_build_object('rotulo', 'Cancelados', 'valor', (SELECT count(*) FROM a WHERE sit = 'Cancelado'), 'formato', 'n',
                         'dica', (SELECT CASE WHEN count(*) > 0 THEN replace(round(100.0 * count(*) FILTER (WHERE sit = 'Cancelado') / count(*), 1)::text, '.', ',') ELSE '0' END || '% do total' FROM a)),
      jsonb_build_object('rotulo', 'Dias de uso', 'valor', (SELECT coalesce(sum(dias), 0) FROM vivos), 'formato', 'n',
                         'dica', (SELECT count(DISTINCT patrimonio_id) || ' veículo(s) usado(s)' FROM vivos)),
      jsonb_build_object('rotulo', 'Contratos atendidos', 'valor', (SELECT count(DISTINCT contrato_nome) FROM ctr), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'total', 'rotulo', 'Agendamentos'), jsonb_build_object('chave', 'realizados', 'rotulo', 'Realizados')),
      'dados', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
                  'total', (SELECT count(*) FROM a WHERE to_char(data_inicio, 'YYYY-MM') = to_char(m, 'YYYY-MM')),
                  'realizados', (SELECT count(*) FROM a WHERE sit = 'Realizado' AND to_char(data_inicio, 'YYYY-MM') = to_char(m, 'YYYY-MM'))) ORDER BY m)
                  FROM meses), '[]'::jsonb)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação', 'tipo', 'rosca', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', s, 'valor', (SELECT count(*) FROM a WHERE sit = s)) ORDER BY o)
           FROM (VALUES (1, 'Realizado'), (2, 'Em andamento'), (3, 'Agendado'), (4, 'Cancelado')) x(o, s))),
      'veiculo', jsonb_build_object('titulo', 'Uso por veículo (dias reservados)', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', d, 'rotulo', nres || ' reserva(s)') ORDER BY d DESC, nres DESC)
           FROM (SELECT veiculo_nome || coalesce(' · ' || nullif(veiculo_identificador, ''), '') nome, sum(dias) d, count(*) nres FROM vivos GROUP BY 1) t), '[]'::jsonb)),
      'contratos', jsonb_build_object('titulo', 'Contratos mais atendidos', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', contrato_nome, 'valor', q) ORDER BY q DESC, contrato_nome)
           FROM (SELECT contrato_nome, count(*) q FROM ctr GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_frota()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_frota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_frota() TO service_role;

-- public.tvg_espelho_geral()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_geral()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sist text[] := ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados', 'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover'];
  tit text[] := ARRAY['Gestão Recrutamento', 'Demissões', 'Materiais', 'Férias', 'Medida Disciplinar', 'Chamados', 'Orientações Jurídicas', 'Mudança de Função', 'Colaboradores', 'Turn-over'];
  solic text[] := ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados', 'orientacoes', 'mudanca-funcao'];
  ds jsonb := '{}'::jsonb; s text; d jsonb; per jsonb;
BEGIN
  FOREACH s IN ARRAY sist LOOP
    d := public.tvg_espelho_fonte('rel:' || s);
    ds := ds || jsonb_build_object(s, d);
    per := coalesce(per, d->'periodo');
  END LOOP;

  RETURN jsonb_build_object(
    'tela', 'Relatórios › Relatório Geral',
    'periodo', per,
    'kpis', (SELECT jsonb_agg(jsonb_build_object(
                'rotulo', tit[i] || ' — ' || coalesce(ds->sist[i]->'kpis'->0->>'rotulo', ''),
                'valor', ds->sist[i]->'kpis'->0->'valor', 'formato', ds->sist[i]->'kpis'->0->>'formato',
                'dica', concat_ws(' · ',
                          CASE WHEN ds->sist[i]->'kpis'->1 IS NOT NULL THEN (ds->sist[i]->'kpis'->1->>'valor') || ' ' || lower(ds->sist[i]->'kpis'->1->>'rotulo') END,
                          CASE WHEN ds->sist[i]->'kpis'->2 IS NOT NULL THEN (ds->sist[i]->'kpis'->2->>'valor') || ' ' || lower(ds->sist[i]->'kpis'->2->>'rotulo') END)) ORDER BY i)
               FROM generate_subscripts(sist, 1) i),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'abertas', 'rotulo', 'Solicitações abertas'), jsonb_build_object('chave', 'concluidas', 'rotulo', 'Concluídas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', m->>'mes',
                  'abertas', (SELECT sum(coalesce((x->>'total')::numeric, 0)) FROM unnest(solic) z(sl), jsonb_array_elements(ds->sl->'mensal'->'dados') x WHERE x->>'mes' = m->>'mes'),
                  'concluidas', (SELECT sum(coalesce((x->>'concluidos')::numeric, 0)) FROM unnest(solic) z(sl), jsonb_array_elements(ds->sl->'mensal'->'dados') x WHERE x->>'mes' = m->>'mes')) ORDER BY m->>'mes')
                  FROM jsonb_array_elements(ds->'recrutamento'->'mensal'->'dados') m)),
    'graficos', jsonb_build_object(
      'sistemas', jsonb_build_object('titulo', 'Solicitações por sistema no período', 'tipo', 'agrupado', 'series', jsonb_build_array('Concluídas', 'Em andamento'),
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', tit[i], 'a', (ds->sist[i]->'kpis'->2->>'valor')::numeric, 'b', (ds->sist[i]->'kpis'->1->>'valor')::numeric,
                                                       'valor', (ds->sist[i]->'kpis'->0->>'valor')::numeric,
                                                       'rotulo', coalesce(ds->sist[i]->'kpis'->3->>'valor', '0') || ' recusada(s)') ORDER BY (ds->sist[i]->'kpis'->0->>'valor')::numeric DESC)
                     FROM generate_subscripts(sist, 1) i WHERE sist[i] = ANY (solic))),
      'tempo', jsonb_build_object('titulo', 'Tempo médio até concluir (dias)', 'tipo', 'colunas',
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', tit[i], 'valor', (ds->sist[i]->'kpis'->4->>'valor')::numeric,
                                                       'rotulo', replace((ds->sist[i]->'kpis'->4->>'valor'), '.', ',') || ' d') ORDER BY (ds->sist[i]->'kpis'->4->>'valor')::numeric DESC)
                     FROM generate_subscripts(sist, 1) i WHERE sist[i] = ANY (solic) AND ds->sist[i]->'kpis'->4->>'valor' IS NOT NULL)),
      'quadro', jsonb_build_object('titulo', 'Quadro de colaboradores (ativos no fim do mês)', 'tipo', 'colunas',
         'itens', (SELECT jsonb_agg(jsonb_build_object('nome', to_char(to_date(x->>'mes', 'YYYY-MM'), 'MM/YY'), 'valor', (x->>'ativos')::numeric) ORDER BY x->>'mes')
                     FROM jsonb_array_elements(ds->'colaboradores'->'mensal'->'dados') x))));
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_geral()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_geral() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_geral() TO service_role;

-- public.tvg_espelho_licitacoes()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_licitacoes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r jsonb;
BEGIN
  WITH g AS (SELECT g.*, g.fase::text AS f, public.tvg_valor_painel_lic(g.valor_global) AS v FROM public.grade g),
  part AS (SELECT * FROM g WHERE f NOT IN ('Não Participado', 'Suspenso', 'Revogado')),
  fin AS (SELECT * FROM g WHERE f = 'Finalizada'),
  ganhas AS (SELECT * FROM fin WHERE posicao = 1),
  alertas AS (SELECT * FROM g WHERE f IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND data BETWEEN hoje AND hoje + 7 ORDER BY data LIMIT 6)
  SELECT jsonb_build_object(
    'tela', 'Licitações › Painel Executivo (Grupo)',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Valor total participado', 'valor', (SELECT coalesce(sum(v), 0) FROM part), 'formato', 'brl', 'dica', 'Editais em andamento'),
      jsonb_build_object('rotulo', 'Taxa de vitória', 'valor', (SELECT CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE posicao = 1) / count(*)) ELSE 0 END FROM fin), 'formato', 'pct',
                         'dica', (SELECT count(*) FILTER (WHERE posicao = 1) || ' ganhos · ' || count(*) FILTER (WHERE posicao IS DISTINCT FROM 1) || ' perdidos' FROM fin)),
      jsonb_build_object('rotulo', 'Contratos ganhos', 'valor', (SELECT coalesce(sum(v), 0) FROM ganhas), 'formato', 'brl',
                         'dica', 'Valor global · Mês: R$ ' || replace(to_char((SELECT coalesce(sum(v), 0) FROM ganhas WHERE to_char(updated_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = to_char(hoje, 'YYYY-MM')), 'FM999G999G990'), ',', '.')),
      jsonb_build_object('rotulo', 'Pessoas nos contratos ganhos', 'valor', (SELECT coalesce(sum(qtd_pessoas), 0) FROM ganhas), 'formato', 'n', 'dica', 'Qtd. pessoas (editais finalizados ganhos)'),
      jsonb_build_object('rotulo', 'Alertas de abertura (7 dias)', 'valor', (SELECT count(*) FROM alertas), 'formato', 'n', 'dica', 'Editais com abertura próxima'),
      jsonb_build_object('rotulo', 'Editais lidos', 'valor', (SELECT count(*) FROM g), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais participados', 'valor', (SELECT count(*) FROM part), 'formato', 'n', 'dica', 'Excluindo: Não Participado, Suspenso e Revogado'),
      jsonb_build_object('rotulo', 'Editais não participados', 'valor', (SELECT count(*) FROM g WHERE f = 'Não Participado'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais suspensos', 'valor', (SELECT count(*) FROM g WHERE f = 'Suspenso'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Editais revogados', 'valor', (SELECT count(*) FROM g WHERE f = 'Revogado'), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'processos', 'rotulo', 'Processos'), jsonb_build_object('chave', 'valor_mi', 'rotulo', 'Valor (R$ mi)')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
                  'processos', (SELECT count(*) FROM g WHERE date_trunc('month', g.created_at AT TIME ZONE 'America/Sao_Paulo') = m),
                  'valor_mi', (SELECT round(coalesce(sum(v), 0) / 1e6, 1) FROM g WHERE date_trunc('month', g.created_at AT TIME ZONE 'America/Sao_Paulo') = m)) ORDER BY m)
                  FROM generate_series(date_trunc('month', hoje::timestamp) - interval '5 months', date_trunc('month', hoje::timestamp), interval '1 month') m)),
    'graficos', jsonb_build_object(
      'alertas', jsonb_build_object('titulo', 'Próximas licitações', 'tipo', 'lista', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(edital, 's/ edital'), 'valor', data - hoje, 'data', data,
                  'titulo', coalesce(edital, '—') || ' · ' || coalesce(nullif(btrim(objeto), ''), 'Sem objeto'),
                  'sub', coalesce(nullif(btrim(responsavel), ''), 'Sem responsável') || ' · ' || f,
                  'rotulo', CASE data - hoje WHEN 0 THEN 'hoje' WHEN 1 THEN 'amanhã' ELSE 'em ' || (data - hoje) || ' dias' END) ORDER BY data)
           FROM alertas), '[]'::jsonb)),
      'fase', jsonb_build_object('titulo', 'Editais por status (participados)', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', n) ORDER BY n DESC)
           FROM (SELECT CASE WHEN f = 'Finalizada' THEN CASE WHEN posicao = 1 THEN 'Finalizada (Ganho)' ELSE 'Finalizada (Perdido)' END ELSE f END AS nome, count(*) n
                   FROM part GROUP BY 1) t), '[]'::jsonb)),
      'faixa', jsonb_build_object('titulo', 'Valor participado por faixa', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', fx.rotulo, 'valor', (SELECT count(*) FROM g WHERE v >= fx.mi AND v < fx.ma),
                                             'rotulo', (SELECT count(*) FROM g WHERE v >= fx.mi AND v < fx.ma) || ' edital(is)') ORDER BY fx.o)
           FROM (VALUES (1, 'Até R$ 1 mi', 0::numeric, 1e6::numeric), (2, 'R$ 1 mi – R$ 10 mi', 1e6, 1e7), (3, 'R$ 10 mi – R$ 50 mi', 1e7, 5e7), (4, 'Acima de R$ 50 mi', 5e7, 1e30)) fx(o, rotulo, mi, ma)))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_licitacoes()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_licitacoes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_licitacoes() TO service_role;

-- public.tvg_espelho_plano_acoes()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_plano_acoes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r jsonb;
BEGIN
  WITH p AS (SELECT * FROM public.plano_acao WHERE deleted_at IS NULL ORDER BY ordem NULLS LAST LIMIT 500),
  st(k, nome) AS (VALUES ('a_definir', 'A definir'), ('nao_iniciada', 'Não iniciada'), ('em_andamento', 'Em andamento'),
                         ('aguardando_validacao', 'Aguardando validação'), ('atrasada', 'Atrasada'),
                         ('concluida_pendente_evidencia', 'Concluída — pend. evidência'), ('concluida_validada', 'Concluída validada'), ('cancelada', 'Cancelada')),
  pr(k, nome) AS (VALUES ('emergencial', 'Emergencial'), ('alta', 'Alta'), ('media', 'Média'), ('baixa', 'Baixa'), ('nao_informada', 'Não informada'))
  SELECT jsonb_build_object(
    'tela', 'Plano de Ações › Dashboard',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Total de ações', 'valor', (SELECT count(*) FROM p), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Em andamento', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'em_andamento'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'A definir / Não iniciadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado IN ('a_definir', 'nao_iniciada')), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Atrasadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'atrasada'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Concluídas validadas', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'concluida_validada'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aguardando validação', 'valor', (SELECT count(*) FROM p WHERE status_normalizado = 'aguardando_validacao'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Pend. evidência (legado)', 'valor', (SELECT count(*) FROM p WHERE pendencia_evidencia), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Sem responsável', 'valor', (SELECT count(*) FROM p WHERE pendencia_responsavel), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Sem datas planejadas', 'valor', (SELECT count(*) FROM p WHERE pendencia_datas), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Comitês ativos', 'valor', (SELECT count(DISTINCT comite) FROM p WHERE coalesce(comite, '') <> ''), 'formato', 'n')),
    'mensal', jsonb_build_object('series', '[]'::jsonb, 'dados', '[]'::jsonb),
    'graficos', jsonb_build_object(
      'status', jsonb_build_object('titulo', 'Ações por status', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(st.nome, p2.k), 'valor', p2.n) ORDER BY p2.n DESC)
           FROM (SELECT status_normalizado k, count(*) n FROM p GROUP BY 1) p2 LEFT JOIN st ON st.k = p2.k), '[]'::jsonb)),
      'prioridade', jsonb_build_object('titulo', 'Ações por prioridade', 'tipo', 'rosca', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', coalesce(pr.nome, p2.k), 'valor', p2.n) ORDER BY p2.n DESC)
           FROM (SELECT coalesce(prioridade_normalizada, 'nao_informada') k, count(*) n FROM p GROUP BY 1) p2 LEFT JOIN pr ON pr.k = p2.k), '[]'::jsonb)),
      'area', jsonb_build_object('titulo', 'Ações por área', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', area, 'valor', n) ORDER BY n DESC) FROM (SELECT area, count(*) n FROM p WHERE coalesce(area, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'comite', jsonb_build_object('titulo', 'Ações por comitê', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', comite, 'valor', n) ORDER BY n DESC) FROM (SELECT comite, count(*) n FROM p WHERE coalesce(comite, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_plano_acoes()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_plano_acoes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_plano_acoes() TO service_role;

-- public.tvg_espelho_resultado(p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_resultado(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public."TVG_INDICADOR"; d jsonb; kp jsonb; g jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF i.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(i.espelho_fonte);
  IF d IS NULL THEN RETURN jsonb_build_object('valor', NULL, 'observacao', 'Fonte do espelho indisponível: ' || i.espelho_fonte); END IF;
  kp := CASE WHEN i.espelho_item LIKE 'kpi:%' THEN d->'kpis'->(substr(i.espelho_item, 5)::int) END;
  g := CASE WHEN i.espelho_grafico IS NOT NULL THEN d->'graficos'->i.espelho_grafico END;
  RETURN jsonb_build_object(
    'valor', kp->'valor',
    'afetado', kp->>'dica',
    'base', (d->>'tela') || CASE WHEN d->'periodo'->>'de' IS NOT NULL
                                 THEN ' · ' || to_char((d->'periodo'->>'de')::date, 'DD/MM/YYYY') || ' a ' || to_char((d->'periodo'->>'ate')::date, 'DD/MM/YYYY') ELSE '' END,
    'detalhe', COALESCE(g->'itens', '[]'::jsonb),
    'grafico', g->>'tipo', 'grafico_titulo', g->>'titulo', 'grafico_series', g->'series', 'destaque', i.espelho_destaque,
    'casas', kp->'casas');
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_resultado(p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_resultado(p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_resultado(p_codigo text) TO service_role;

-- public.tvg_espelho_sst()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_sst()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ini date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')) - interval '5 months')::date;
  r jsonb;
BEGIN
  WITH adm AS (SELECT * FROM public."VW_RECRUTAMENTO_CANDIDATOS" WHERE etapa_processo IN ('SST + COMPRAS', 'EXAME SST') AND sst_ok IS NULL),
  dem AS (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO"
           WHERE status IN ('Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida', 'Agendamento concluído', 'ASO válido', 'Cancelamento solicitado')),
  tro AS (SELECT * FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" WHERE status IN ('Pendente SST', 'Pendente RH', 'Concluída') ORDER BY criado_em DESC LIMIT 500)
  SELECT jsonb_build_object(
    'tela', 'SST › ASO / Admissão · ASO Demissional · Mudança de Função — ASO',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'ASO admissional pendente', 'valor', (SELECT count(*) FROM adm), 'formato', 'n', 'dica', 'SST › ASO / Admissão'),
      jsonb_build_object('rotulo', 'ASO admissional com exame marcado', 'valor', (SELECT count(*) FROM adm WHERE sst_data_exame IS NOT NULL), 'formato', 'n', 'dica', 'dos pendentes, já com data'),
      jsonb_build_object('rotulo', 'Demissional a receber', 'valor', (SELECT count(*) FROM dem WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › ASO Demissional'),
      jsonb_build_object('rotulo', 'Demissional a agendar', 'valor', (SELECT count(*) FROM dem WHERE status = 'Solicitação de agendamento de DEMISSIONAL recebida'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Demissional agendadas', 'valor', (SELECT count(*) FROM dem WHERE status = 'Agendamento concluído'), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Mudança de função aguardando ASO', 'valor', (SELECT count(*) FROM tro WHERE status = 'Pendente SST'), 'formato', 'n', 'dica', 'SST › Mudança de Função — ASO'),
      jsonb_build_object('rotulo', 'Mudança de função concluídas', 'valor', (SELECT count(*) FROM tro WHERE status = 'Concluída'), 'formato', 'n')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'demissional', 'rotulo', 'ASO demissional'), jsonb_build_object('chave', 'admissional', 'rotulo', 'ASO admissional')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'demissional', (SELECT count(*) FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s WHERE date_trunc('month', s.sst_em AT TIME ZONE 'America/Sao_Paulo') = g),
                  'admissional', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE date_trunc('month', c.sst_em AT TIME ZONE 'America/Sao_Paulo') = g)) ORDER BY g)
                  FROM generate_series(ini, date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')), interval '1 month') g)),
    'graficos', jsonb_build_object(
      'admissional', jsonb_build_object('titulo', 'ASO admissional pendente por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(contrato), ''), 'Sem contrato') nome, count(*) q FROM adm GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb)),
      'demissional', jsonb_build_object('titulo', 'ASO demissional por situação', 'tipo', 'rosca', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', x.rotulo, 'valor', (SELECT count(*) FROM dem WHERE dem.status = x.st)) ORDER BY x.o)
           FROM (VALUES (1, 'Pendente SST', 'A receber'), (2, 'Solicitação de agendamento de DEMISSIONAL recebida', 'A agendar'),
                        (3, 'Agendamento concluído', 'Agendadas'), (4, 'ASO válido', 'ASO válido'), (5, 'Cancelamento solicitado', 'Cancelamento solicitado')) x(o, st, rotulo))),
      'troca', jsonb_build_object('titulo', 'Mudança de função na fila do SST, por contrato', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', q) ORDER BY q DESC)
           FROM (SELECT coalesce(nullif(btrim(local), ''), nullif(btrim(filial), ''), 'Sem contrato') nome, count(*) q FROM tro WHERE status = 'Pendente SST' GROUP BY 1 ORDER BY 2 DESC LIMIT 8) t), '[]'::jsonb))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_sst()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_sst() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_sst() TO service_role;

-- public.tvg_espelho_tendencia(p_painel text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_tendencia(p_painel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  p public."TVG_PAINEL"; d jsonb; s1 text; s2 text;
BEGIN
  SELECT * INTO p FROM public."TVG_PAINEL" WHERE slug = p_painel;
  IF p.espelho_fonte IS NULL THEN RETURN NULL; END IF;
  d := public.tvg_espelho_fonte(p.espelho_fonte);
  IF d IS NULL OR jsonb_array_length(coalesce(d->'mensal'->'dados', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('titulo', NULL, 'series', '[]'::jsonb, 'unidade', 'qtd', 'meses', '[]'::jsonb);
  END IF;
  s1 := coalesce(p.espelho_series[1], d->'mensal'->'series'->0->>'chave');
  s2 := coalesce(p.espelho_series[2], d->'mensal'->'series'->1->>'chave');
  RETURN jsonb_build_object(
    'titulo', 'Mês a mês — ' || replace(d->>'tela', 'Relatórios › ', ''),
    'series', jsonb_build_array(
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s1),
                (SELECT x->>'rotulo' FROM jsonb_array_elements(d->'mensal'->'series') x WHERE x->>'chave' = s2)),
    'unidade', coalesce(d->'mensal'->>'unidade', 'qtd'),
    'modo', d->'mensal'->>'modo',
    'meses', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(to_date(m->>'mes', 'YYYY-MM'), 'MM/YY'), 'a', (m->>s1)::numeric, 'b', (m->>s2)::numeric) ORDER BY m->>'mes')
                FROM jsonb_array_elements(d->'mensal'->'dados') m));
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_tendencia(p_painel text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_tendencia(p_painel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_tendencia(p_painel text) TO service_role;

-- public.tvg_espelho_treinamentos()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_treinamentos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d jsonb := public.trn_dashboard_dados(NULL, NULL, NULL);
  ano int := coalesce((d->>'ano')::int, extract(year FROM now())::int);
BEGIN
  RETURN jsonb_build_object(
    'tela', 'Treinamentos › Dashboard de Treinamentos',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Número de alunos', 'valor', d->'alunos', 'formato', 'n', 'dica', 'colaboradores que podem acessar · ' || coalesce(d->>'alunos_afastados', '0') || ' afastado(s)'),
      jsonb_build_object('rotulo', 'Já acessaram (ativos)', 'valor', d->'alunos_ativos', 'formato', 'n',
                         'dica', CASE WHEN (d->>'alunos')::int > 0 THEN round((d->>'alunos_ativos')::numeric * 100 / (d->>'alunos')::numeric) || '% dos alunos' END),
      jsonb_build_object('rotulo', 'Nunca acessaram (inativos)', 'valor', d->'alunos_inativos', 'formato', 'n',
                         'dica', CASE WHEN coalesce((d->>'alunos_bloqueados')::int, 0) > 0 THEN (d->>'alunos_bloqueados') || ' bloqueado(s) à parte' ELSE 'ainda não entraram' END),
      jsonb_build_object('rotulo', 'Acessaram recentemente', 'valor', d->'acessaram_7d', 'formato', 'n', 'dica', 'últimos 7 dias · ' || coalesce(d->>'acessaram_30d', '0') || ' em 30 dias'),
      jsonb_build_object('rotulo', 'Demitidos', 'valor', d->'alunos_demitidos', 'formato', 'n', 'dica', 'no histórico, fora da conta'),
      jsonb_build_object('rotulo', 'Aulas concluídas', 'valor', d->'aulas_concluidas', 'formato', 'n', 'dica', coalesce(d->>'concluidos', '0') || ' aluno(s) concluíram'),
      jsonb_build_object('rotulo', 'Avaliação das aulas', 'valor', round((d->>'avaliacao_media')::numeric, 1), 'formato', 'n', 'dica', coalesce(d->>'avaliacoes', '0') || ' avaliação(ões)'),
      jsonb_build_object('rotulo', 'Provas', 'valor', CASE WHEN coalesce((d->>'provas_enviadas')::int, 0) > 0
                                                            THEN round((d->>'provas_aprovadas')::numeric * 100 / (d->>'provas_enviadas')::numeric) END, 'formato', 'pct',
                         'dica', coalesce(d->>'provas_aprovadas', '0') || ' aprovada(s) de ' || coalesce(d->>'provas_enviadas', '0') || ' enviada(s)'),
      jsonb_build_object('rotulo', 'Comentários nas aulas', 'valor', d->'comentarios', 'formato', 'n',
                         'dica', CASE WHEN coalesce((d->>'comentarios_pendentes')::int, 0) > 0 THEN (d->>'comentarios_pendentes') || ' aguardando moderação' ELSE 'nenhum pendente' END),
      jsonb_build_object('rotulo', 'Certificados emitidos', 'valor', d->'certificados', 'formato', 'n',
                         'dica', coalesce(d->>'cursos_publicados', '0') || ' de ' || coalesce(d->>'cursos_total', '0') || ' curso(s) publicado(s)')),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'acessos', 'rotulo', 'Primeiros acessos'), jsonb_build_object('chave', 'conclusoes', 'rotulo', 'Aulas concluídas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', ano || '-' || lpad(m::text, 2, '0'),
                  'acessos', coalesce((d->'primeiros_acessos_por_mes'->>(m - 1))::numeric, 0),
                  'conclusoes', coalesce((d->'conclusoes_por_mes'->>(m - 1))::numeric, 0)) ORDER BY m)
                  FROM generate_series(1, extract(month FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int) m)),
    'graficos', jsonb_build_object(
      'situacao', jsonb_build_object('titulo', 'Situação dos alunos', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Já acessaram', 'valor', d->'alunos_ativos'),
         jsonb_build_object('nome', 'Nunca acessaram', 'valor', d->'alunos_inativos'),
         jsonb_build_object('nome', 'Bloqueados', 'valor', d->'alunos_bloqueados'))),
      'notas', jsonb_build_object('titulo', 'Notas das aulas', 'tipo', 'colunas', 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', o || ' ★', 'valor', (v)::numeric) ORDER BY o)
            FROM jsonb_array_elements_text(coalesce(d->'avaliacoes_por_nota', '[]'::jsonb)) WITH ORDINALITY z(v, o))),
      'contrato', jsonb_build_object('titulo', 'Acesso por contrato', 'tipo', 'agrupado', 'series', jsonb_build_array('Já acessaram', 'Ainda não'), 'itens',
         (SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(c->>'nome', '^\s*\d+\s*-\s*', ''), 'a', (c->>'ativos')::numeric,
                                              'b', (c->>'alunos')::numeric - (c->>'ativos')::numeric, 'valor', (c->>'alunos')::numeric,
                                              'rotulo', round((c->>'ativos')::numeric * 100 / nullif((c->>'alunos')::numeric, 0)) || '%') ORDER BY o)
            FROM jsonb_array_elements(coalesce(d->'por_contrato', '[]'::jsonb)) WITH ORDINALITY z(c, o) WHERE o <= 8))));
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_treinamentos()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_treinamentos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_treinamentos() TO service_role;

-- public.tvg_espelho_turnover()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_turnover()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ano int := extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int;
  mes_atual text := to_char((now() AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM');
  nomes text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  d jsonb := public.dir_turnover_painel_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL, NULL, NULL);
  rr jsonb := public.dir_turnover_rescisoes_dados(extract(year FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int, NULL, NULL);
  soma numeric; dem numeric; ate3 numeric; tot numeric; ult jsonb; atual jsonb; nome_ult text;
BEGIN
  SELECT round(sum((m->>'taxa')::numeric), 2), sum((m->>'demissoes')::numeric) INTO soma, dem FROM jsonb_array_elements(d->'mensal') m;
  -- Último mês FECHADO; o corrente só entra na dica (ou no lugar, em janeiro).
  SELECT m INTO ult FROM jsonb_array_elements(d->'mensal') m WHERE m->>'mes' < mes_atual ORDER BY m->>'mes' DESC LIMIT 1;
  SELECT m INTO atual FROM jsonb_array_elements(d->'mensal') m WHERE m->>'mes' = mes_atual LIMIT 1;
  IF ult IS NULL THEN ult := atual; atual := NULL; END IF;
  nome_ult := nomes[extract(month FROM to_date(ult->>'mes', 'YYYY-MM'))::int];
  tot := coalesce((rr->>'total')::numeric, 0);
  ate3 := coalesce((SELECT (f->>'n')::numeric FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int = 1), 0);
  RETURN jsonb_build_object(
    'tela', 'Relatórios › Turnover',
    'periodo', NULL,
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Turnover geral ' || ano, 'valor', soma, 'formato', 'pct', 'casas', 2,
                         'dica', coalesce(dem, 0) || ' demissões · efetivo médio ' || round((d->>'efetivo_medio')::numeric) || ' · aceitável no ano: 41%'),
      jsonb_build_object('rotulo', 'Projeção para o ano', 'valor', round(soma * coalesce((d->>'fator_projecao')::numeric, 1), 2), 'formato', 'pct', 'casas', 2,
                         'dica', 'Soma até hoje × dias do ano ÷ dias decorridos · aceitável no ano: 41%'),
      jsonb_build_object('rotulo', 'Turnover de ' || coalesce(nome_ult, '—'), 'valor', round((ult->>'taxa')::numeric, 2), 'formato', 'pct', 'casas', 2,
                         'dica', initcap(coalesce(nome_ult, '—')) || CASE WHEN atual IS NULL THEN ' (mês em andamento)' ELSE ' (fechado)' END
                                 || ' · aceitável no mês: 3,42%'
                                 || CASE WHEN atual IS NOT NULL
                                         THEN ' · ' || nomes[extract(month FROM hoje)::int] || ' até ' || to_char(hoje, 'DD/MM') || ': '
                                              || replace(round((atual->>'taxa')::numeric, 2)::text, '.', ',') || '% (mês em andamento)'
                                         ELSE '' END),
      jsonb_build_object('rotulo', 'Demissões no ano', 'valor', dem, 'formato', 'n', 'dica', 'efetivo médio ' || round((d->>'efetivo_medio')::numeric)),
      jsonb_build_object('rotulo', 'Rescisões no período', 'valor', tot, 'formato', 'n', 'dica', 'Turnover em Valores · ' || ano),
      jsonb_build_object('rotulo', 'Tempo de casa médio', 'valor', round((rr->>'tempo_medio_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_medio_dias')::numeric) || ' · da admissão ao afastamento'),
      jsonb_build_object('rotulo', 'Tempo de casa mediano', 'valor', round((rr->>'tempo_mediano_dias')::numeric), 'formato', 'dias',
                         'dica', public.tvg_tempo_de_casa((rr->>'tempo_mediano_dias')::numeric) || ' · metade saiu antes disso'),
      jsonb_build_object('rotulo', 'Saíram com até 3 meses', 'valor', CASE WHEN tot > 0 THEN round(ate3 * 1000 / tot) / 10 ELSE 0 END, 'formato', 'pct',
                         'dica', ate3 || ' rescisões')),
    'mensal', jsonb_build_object('unidade', 'pct', 'modo', 'meta',
      'series', jsonb_build_array(jsonb_build_object('chave', 'taxa', 'rotulo', 'Turnover do mês'), jsonb_build_object('chave', 'meta', 'rotulo', 'meta 3,42%')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', m->>'mes', 'taxa', round((m->>'taxa')::numeric, 2), 'meta', 3.42) ORDER BY m->>'mes') FROM jsonb_array_elements(d->'mensal') m)),
    'graficos', jsonb_build_object(
      'contrato', jsonb_build_object('titulo', 'Turnover por contrato (em relação ao próprio contrato)', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', regexp_replace(c->>'contrato', '^\s*\d+\s*-\s*', ''), 'valor', round((c->>'demissoes')::numeric * 100 / (c->>'efetivo_medio')::numeric, 2),
                                             'rotulo', (c->>'demissoes') || ' demissões') ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC)
           FROM (SELECT c FROM jsonb_array_elements(d->'por_contrato') c WHERE (c->>'demissoes')::int > 0 AND (c->>'efetivo_medio')::numeric > 0
                  ORDER BY (c->>'demissoes')::numeric / (c->>'efetivo_medio')::numeric DESC LIMIT 12) z), '[]'::jsonb)),
      'faixa', jsonb_build_object('titulo', 'Rescisões por tempo de empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', f->>'faixa', 'valor', (f->>'n')::numeric) ORDER BY (f->>'ordem')::int)
           FROM jsonb_array_elements(rr->'por_faixa') f WHERE (f->>'ordem')::int > 0 OR (f->>'n')::int > 0), '[]'::jsonb)),
      'causa', jsonb_build_object('titulo', 'Por tipo de desligamento', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', c->>'causa', 'valor', (c->>'n')::numeric) ORDER BY (c->>'n')::int DESC)
           FROM (SELECT c FROM jsonb_array_elements(rr->'por_causa') c ORDER BY (c->>'n')::int DESC LIMIT 6) z), '[]'::jsonb)),
      'empresa', jsonb_build_object('titulo', 'Turnover geral por empresa', 'tipo', 'colunas', 'itens', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', e->>'empresa', 'valor', (e->>'taxa')::numeric, 'rotulo', (e->>'demissoes') || ' demissões'))
           FROM jsonb_array_elements(d->'por_empresa') e), '[]'::jsonb))));
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_turnover()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_turnover() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_turnover() TO service_role;

-- public.tvg_espelho_vagas()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_espelho_vagas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d jsonb := public.dir_vagas_painel_dados(NULL, NULL, NULL, NULL);
  agora timestamptz := coalesce((d->>'agora')::timestamptz, now());
  r jsonb;
BEGIN
  WITH v AS (
    SELECT x, (x->>'id')::bigint AS id, (x->>'criada')::timestamptz AS criada, btrim(coalesce(x->>'status', '')) AS st,
           (x->>'status_em')::timestamptz AS status_em, coalesce((x->>'legado')::boolean, false) AS legado,
           coalesce((x->>'no_periodo')::boolean, false) AS per, greatest(coalesce((x->>'qtd')::int, 1), 1) AS qtd,
           x->>'cargo' AS cargo, coalesce(x->'log', '[]'::jsonb) AS log, (x->>'aprovada_em')::timestamptz AS aprovada_em,
           coalesce((x->'cand'->>'total')::int, 0) AS cand_total, coalesce((x->'cand'->>'desistiu')::int, 0) AS cand_desistiu
      FROM jsonb_array_elements(coalesce(d->'vagas', '[]'::jsonb)) x),
  v2 AS (
    SELECT v.*,
           CASE WHEN st = 'Reprovada' THEN 'reprovada' WHEN st = 'Cancelada' THEN 'cancelada'
                WHEN st = 'Contratado' OR st LIKE 'Concluído%' THEN 'contratada' ELSE 'andamento' END AS desfecho,
           (SELECT (l->>2)::timestamptz FROM jsonb_array_elements(v.log) WITH ORDINALITY z(l, o) ORDER BY o DESC LIMIT 1) AS ult_log,
           -- Aprovação: a 1ª troca que sai de Pendente Operacional/Analista/Diretoria para outra etapa do fluxo.
           (SELECT (l->>2)::timestamptz FROM jsonb_array_elements(v.log) WITH ORDINALITY z(l, o)
             WHERE btrim(coalesce(l->>0, '')) IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria')
               AND l->>1 IS NOT NULL
               AND btrim(l->>1) NOT IN ('Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria', 'Reprovada', 'Cancelada')
             ORDER BY o LIMIT 1) AS sai_aprovacao
      FROM v),
  v3 AS (
    SELECT v2.*,
           CASE WHEN desfecho <> 'andamento' THEN coalesce(status_em, ult_log) END AS fechada_em,
           CASE WHEN sai_aprovacao IS NOT NULL THEN greatest(extract(epoch FROM sai_aprovacao - criada) / 86400, 0)
                WHEN legado AND jsonb_array_length(log) = 0 AND aprovada_em IS NOT NULL THEN greatest(extract(epoch FROM aprovada_em - criada) / 86400, 0) END AS t_aprov
      FROM v2),
  v4 AS (SELECT v3.*, greatest(extract(epoch FROM coalesce(fechada_em, agora) - criada) / 86400, 0) AS dias_tot FROM v3),
  per AS (SELECT * FROM v4 WHERE per),
  contr AS (SELECT dias_tot FROM per WHERE desfecho = 'contratada'),
  abertas AS (SELECT * FROM v4 WHERE desfecho = 'andamento'),
  antiga AS (SELECT * FROM abertas ORDER BY criada LIMIT 1),
  med AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_tot) AS m FROM contr),
  -- Funil (etapaAlcancada): até onde a vaga chegou no fluxo.
  etapas(chave, i, sts) AS (VALUES
    ('aprovacao', 0, ARRAY['Pendente Operacional', 'Pendente Analista', 'Pendente Diretoria']),
    ('recrutamento', 1, ARRAY['Pendente Recrutamento']),
    ('selecao', 2, ARRAY['Vaga aberta - Seleção de Currículos']),
    ('juridico', 3, ARRAY['Em análise jurídica']),
    ('entrevistas', 4, ARRAY['Entrevista e Avaliação', 'Entrevista com Gestor']),
    ('aprovado', 5, ARRAY['Aprovado - Aguardando SST', 'Compras Confirmou - Aguardando Documentação']),
    ('sst_compras', 6, ARRAY['Aguardando SST e Compras', 'Encaminhado para SST (ASO)', 'ASO Aprovado - Aguardando Informe de EPIs', 'Aguardando Confirmação Compras']),
    ('contratado', 7, ARRAY['Contratado'])),
  alc AS (
    SELECT p.id, p.desfecho,
           CASE WHEN p.desfecho = 'contratada' THEN 7 ELSE greatest(
             coalesce((SELECT max(e.i) FROM etapas e WHERE (p.st = ANY (e.sts) OR (e.i = 7 AND p.st LIKE 'Concluído%')) AND p.st NOT IN ('Reprovada', 'Cancelada')), -1),
             coalesce((SELECT max(e.i) FROM jsonb_array_elements(p.log) l, etapas e
                        WHERE (btrim(coalesce(l->>0, '')) = ANY (e.sts) OR btrim(coalesce(l->>1, '')) = ANY (e.sts))), -1),
             CASE WHEN p.legado AND jsonb_array_length(p.log) = 0 AND p.aprovada_em IS NOT NULL THEN 2 ELSE -1 END,
             CASE WHEN p.cand_total > 0 THEN 2 ELSE -1 END,
             CASE WHEN (p.x->'cand'->>'selecionado_em') IS NOT NULL THEN 5 ELSE -1 END) END AS ate
      FROM per p)
  SELECT jsonb_build_object(
    'tela', 'Relatórios › Vagas — Dashboard',
    'periodo', jsonb_build_object('de', d->>'de', 'ate', d->>'ate'),
    'kpis', jsonb_build_array(
      jsonb_build_object('rotulo', 'Vagas solicitadas', 'valor', (SELECT count(*) FROM per), 'formato', 'n',
                         'dica', replace(to_char((SELECT coalesce(sum(qtd), 0) FROM per), 'FM999G999G990'), ',', '.') || ' posições (soma das quantidades)'),
      jsonb_build_object('rotulo', 'Contratadas', 'valor', (SELECT count(*) FROM contr), 'formato', 'n',
                         'dica', (SELECT round(100.0 * count(*) FILTER (WHERE desfecho = 'contratada') / nullif(count(*) FILTER (WHERE desfecho <> 'andamento'), 0)) || '% das que já fecharam' FROM per)),
      jsonb_build_object('rotulo', 'Reprovadas / canceladas', 'valor', (SELECT count(*) FROM per WHERE desfecho IN ('reprovada', 'cancelada')), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Em aberto agora', 'valor', (SELECT count(*) FROM abertas), 'formato', 'n',
                         'dica', (SELECT coalesce(sum(qtd), 0) FROM abertas) || ' posições · inclui pedidas antes do período'),
      jsonb_build_object('rotulo', 'Tempo médio até contratar', 'valor', (SELECT round(avg(dias_tot)::numeric, 1) FROM contr), 'formato', 'dias',
                         'dica', 'Mediana ' || coalesce((SELECT CASE WHEN m < 1 AND m > 0 THEN round(m * 24) || ' h' ELSE replace(round(m::numeric, 1)::text, '.0', '') || ' d' END FROM med), '—') || ' · pedido → Contratado'),
      jsonb_build_object('rotulo', 'Contratadas em até 15 dias', 'valor', (SELECT round(100.0 * count(*) FILTER (WHERE dias_tot <= 15) / nullif(count(*), 0), 1) FROM contr), 'formato', 'pct'),
      jsonb_build_object('rotulo', 'Tempo médio de aprovação', 'valor', (SELECT round(avg(t_aprov)::numeric, 1) FROM per WHERE t_aprov IS NOT NULL), 'formato', 'dias',
                         'dica', 'Pedido → liberado ao Recrutamento'),
      jsonb_build_object('rotulo', 'Candidatos por vaga', 'valor', (SELECT round(avg(cand_total)::numeric, 1) FROM per WHERE NOT legado), 'formato', 'n',
                         'dica', 'Média, só vagas do sistema novo'),
      jsonb_build_object('rotulo', 'Desistências de candidatos', 'valor', (SELECT coalesce(sum(cand_desistiu), 0) FROM per), 'formato', 'n'),
      jsonb_build_object('rotulo', 'Aberta mais antiga', 'valor', (SELECT floor(greatest(extract(epoch FROM agora - criada) / 86400, 0)) FROM antiga), 'formato', 'dias',
                         'dica', (SELECT '#' || id || coalesce(' · ' || nullif(btrim(cargo), ''), '') FROM antiga))),
    'mensal', jsonb_build_object(
      'series', jsonb_build_array(jsonb_build_object('chave', 'solicitadas', 'rotulo', 'Solicitadas'), jsonb_build_object('chave', 'contratadas', 'rotulo', 'Contratadas')),
      'dados', (SELECT jsonb_agg(jsonb_build_object('mes', to_char(g, 'YYYY-MM'),
                  'solicitadas', (SELECT count(*) FROM per WHERE to_char(criada, 'YYYY-MM') = to_char(g, 'YYYY-MM')),
                  'contratadas', (SELECT count(*) FROM per WHERE desfecho = 'contratada' AND to_char(criada, 'YYYY-MM') = to_char(g, 'YYYY-MM'))) ORDER BY g)
                  FROM generate_series(date_trunc('month', (d->>'de')::date), (d->>'ate')::date, interval '1 month') g)),
    'graficos', jsonb_build_object(
      'funil', jsonb_build_object('titulo', 'Funil das vagas do período', 'tipo', 'colunas', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Solicitadas', 'valor', (SELECT count(*) FROM alc)),
         jsonb_build_object('nome', 'Aprovadas', 'valor', (SELECT count(*) FROM alc WHERE ate >= 1)),
         jsonb_build_object('nome', 'Abertas p/ seleção', 'valor', (SELECT count(*) FROM alc WHERE ate >= 2)),
         jsonb_build_object('nome', 'Em entrevistas', 'valor', (SELECT count(*) FROM alc WHERE ate >= 4)),
         jsonb_build_object('nome', 'Candidato aprovado', 'valor', (SELECT count(*) FROM alc WHERE ate >= 5)),
         jsonb_build_object('nome', 'Contratadas', 'valor', (SELECT count(*) FROM alc WHERE desfecho = 'contratada')))),
      'desfecho', jsonb_build_object('titulo', 'Desfecho das vagas do período', 'tipo', 'rosca', 'itens', jsonb_build_array(
         jsonb_build_object('nome', 'Contratadas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'contratada')),
         jsonb_build_object('nome', 'Em andamento', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'andamento')),
         jsonb_build_object('nome', 'Reprovadas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'reprovada')),
         jsonb_build_object('nome', 'Canceladas', 'valor', (SELECT count(*) FROM per WHERE desfecho = 'cancelada')))),
      'aging', jsonb_build_object('titulo', 'Abertas agora — há quanto tempo', 'tipo', 'colunas', 'itens', (
         SELECT jsonb_agg(jsonb_build_object('nome', f.rotulo, 'valor', (SELECT count(*) FROM abertas a
                  WHERE extract(epoch FROM agora - a.criada) / 86400 > f.de AND extract(epoch FROM agora - a.criada) / 86400 <= f.ate)) ORDER BY f.o)
           FROM (VALUES (1, 'até 7 d', -1, 7), (2, '8–15 d', 7, 15), (3, '16–30 d', 15, 30), (4, '31–60 d', 30, 60), (5, '+60 d', 60, 1e9)) f(o, rotulo, de, ate)))))
    INTO r;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_espelho_vagas()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_espelho_vagas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_espelho_vagas() TO service_role;

-- public.tvg_fonte(p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_fonte(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public."TVG_INDICADOR"; alvo text; trecho text; ajudantes jsonb := '[]'::jsonb; h text;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  trecho := coalesce(public.tvg_trecho_calculo('tvg_calc_espelho', alvo), public.tvg_trecho_calculo('tvg_calc_ajuste', alvo),
                     public.tvg_trecho_calculo('tvg_calc', alvo), public.tvg_trecho_calculo('tvg_calc_extra', alvo));

  FOREACH h IN ARRAY ARRAY['tvg_quadro_contratos', 'tvg_dre_contratos', 'tvg_dre_competencia', 'dir_turnover_painel_dados'] LOOP
    IF trecho ~ h THEN
      ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', h, 'definicao',
        left((SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = h AND p.pronamespace = 'public'::regnamespace LIMIT 1), 2500)));
    END IF;
  END LOOP;
  IF trecho ~ 'tvg_dre_contratos' THEN
    ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', 'tvg_dre_mv',
      'definicao', 'Visão materializada (cache, atualizada a cada 6 h) que soma mz_60_view_dre_gerencial_competencia — o DRE gerencial carregado na migração contábil — por competência e contrato: RECEITA, CUSTO e DESPESA.'));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'painel', i.painel, 'fonte', i.fonte, 'regra', i.regra, 'identificar', i.identificar,
    'unidade', i.unidade, 'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'parametro', i.parametro,
    'parametro_rotulo', i.parametro_rotulo, 'responsavel', i.responsavel,
    'espelho_de', i.espelho_de,
    'espelho_regra', (SELECT o.regra FROM public."TVG_INDICADOR" o WHERE o.codigo = i.espelho_de),
    'componentes', (SELECT jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'regra', c.regra))
                      FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[]))),
    'calculo_sql', trecho,
    'funcoes_de_apoio', ajudantes);
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_fonte(p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_fonte(p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_fonte(p_codigo text) TO authenticated, service_role;

-- public.tvg_ia_detalhe(p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public."TVG_INDICADOR"; alvo text; par numeric;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF i.fonte = 'soma' THEN
    RETURN (SELECT jsonb_object_agg(c.nome, public.tvg_ia_detalhe_dados(c.codigo, c.parametro))
              FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[])));
  END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  par := coalesce((SELECT o.parametro FROM public."TVG_INDICADOR" o WHERE o.codigo = alvo), i.parametro);
  RETURN public.tvg_ia_detalhe_dados(alvo, par);
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_ia_detalhe(p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe(p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_ia_detalhe(p_codigo text) TO authenticated, service_role;

-- public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  nomes text[]; v_comp text; comps text[]; v_ano int; v_meses int[]; n int; v_painel jsonb; v_mes date; r jsonb;
BEGIN
  -- Os nomes que o gráfico mostra (detalhe do resultado), na mesma ordem.
  nomes := ARRAY(SELECT x->>'nome' FROM jsonb_array_elements(coalesce(public.tvg_indicador_dados(p_alvo)#>'{indicador,resultado,detalhe}', '[]'::jsonb)) x
                  WHERE x->>'nome' IS NOT NULL LIMIT 15);

  -- ── DRE: custo de cada contrato do gráfico aberto por conta ───────────
  IF p_alvo IN ('op_lucratividade', 'ctl_margem', 'ctl_vermelhos', 'op_custo_direto', 'ctl_desvio', 'ctl_reincidentes') THEN
    v_comp := public.tvg_dre_competencia();
    IF v_comp IS NULL OR cardinality(nomes) = 0 THEN RETURN NULL; END IF;
    comps := ARRAY(SELECT competencia FROM public.tvg_dre_contratos() WHERE competencia <= v_comp GROUP BY 1 ORDER BY 1 DESC LIMIT 4);
    nomes := nomes[1:12];
    WITH l AS (
      SELECT COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') AS contrato, d.periodo_competencia AS comp, d.linha_dre,
             coalesce(NULLIF(btrim(d.conta_debito_nome), ''), '(sem conta)') AS conta, public.tvg_num_ponto(d.valor_dre) AS v
        FROM public.mz_60_view_dre_gerencial_competencia d
       WHERE d.periodo_competencia = ANY (comps)
         AND COALESCE(NULLIF(btrim(d.contrato), ''), 'Sem contrato') = ANY (nomes)
         AND d.linha_dre IN ('CUSTO', 'RECEITA')),
    contas AS (SELECT contrato, conta, comp, round(-sum(v), 2) AS valor, count(*) AS lanc FROM l WHERE linha_dre = 'CUSTO' GROUP BY 1, 2, 3),
    por_conta AS (
      SELECT contrato, conta, jsonb_object_agg(comp, jsonb_build_object('valor', valor, 'lancamentos', lanc)) AS por_competencia,
             coalesce(sum(valor) FILTER (WHERE comp = v_comp), 0) AS atual
        FROM contas GROUP BY 1, 2),
    totais AS (
      SELECT contrato, comp, round(-sum(v) FILTER (WHERE linha_dre = 'CUSTO'), 2) AS custo,
             round(sum(v) FILTER (WHERE linha_dre = 'RECEITA'), 2) AS receita, count(*) FILTER (WHERE linha_dre = 'CUSTO') AS lanc_custo
        FROM l GROUP BY 1, 2)
    SELECT jsonb_build_object(
      'competencia_atual', v_comp, 'competencias_janela', to_jsonb(comps),
      'observacao', 'Valores em R$ do DRE gerencial (mz_60_view_dre_gerencial_competencia), custo por conta de débito. Competência sem linha = nenhum lançamento naquele mês (contrato novo, encerrado ou carga incompleta).',
      'contratos', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'contrato', n.nome,
                 'totais_por_competencia', (SELECT jsonb_object_agg(t.comp, jsonb_build_object('custo', t.custo, 'receita', t.receita, 'lancamentos_custo', t.lanc_custo))
                                              FROM totais t WHERE t.contrato = n.nome),
                 'custo_por_conta', (SELECT jsonb_agg(jsonb_build_object('conta', p.conta, 'por_competencia', p.por_competencia) ORDER BY abs(p.atual) DESC)
                                       FROM (SELECT * FROM por_conta p WHERE p.contrato = n.nome ORDER BY abs(p.atual) DESC LIMIT 12) p))
               ORDER BY n.ord)
          FROM unnest(nomes) WITH ORDINALITY AS n(nome, ord)), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Quadro / postos / afastamentos: folha do contrato por situação e cargo ──
  IF p_alvo IN ('op_postos', 'rh_quadro', 'sst_afastamentos') THEN
    WITH q AS (SELECT q.*, public.dir_rel_contrato_nn(q.contrato_id) AS nn FROM public.tvg_quadro_contratos() q WHERE q.contrato = ANY (nomes)),
    e AS (SELECT q.contrato, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo
            FROM public."EMPREGADOS" e JOIN q ON q.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', 'Por contrato do gráfico: quadro (necessários = estipulado no cadastro do contrato; ativos/trabalhando/férias/afastados = folha Senior hoje), situações da folha, cargos e vagas abertas na Gestão Recrutamento.',
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', q.contrato, 'cidade', q.cidade, 'necessarios', q.necessarios, 'ativos', q.ativos, 'trabalhando', q.trabalhando,
          'ferias', q.ferias, 'afastados', q.afastados,
          'situacoes', (SELECT jsonb_object_agg(sit, c) FROM (SELECT sit, count(*) c FROM e WHERE e.contrato = q.contrato GROUP BY 1) s),
          'cargos', (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'ativos', c, 'trabalhando', t) ORDER BY c DESC)
                       FROM (SELECT cargo, count(*) c, count(*) FILTER (WHERE sit = 'Trabalhando') t FROM e WHERE e.contrato = q.contrato GROUP BY 1 ORDER BY 2 DESC LIMIT 10) z),
          'vagas_abertas', (SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'cargo', v.cargo, 'qtd', coalesce(v.quantidade_vagas, 1), 'status', v.status,
                                     'aberta_ha_dias', hoje - (v.created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'motivo', v.motivo_vaga))
                              FROM (SELECT * FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.contrato_id = q.contrato_id
                                       AND v.status NOT IN ('Concluído', 'Reprovada', 'Contratado') ORDER BY v.created_at LIMIT 10) v))
        ORDER BY array_position(nomes, q.contrato)) FROM q), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faltas / absenteísmo / salários: folha do contrato ────────────────
  IF p_alvo IN ('op_faltas', 'rh_absenteismo', 'rh_salarios') THEN
    WITH c AS (SELECT c.nome, c.cliente, c.valor_mensal_contratado AS fat, c.quant_func_estipulado AS estipulado, public.dir_rel_contrato_nn(c.id) AS nn
                 FROM public.contratos c WHERE c.status = 'ativo' AND c.nome = ANY (nomes)),
    e AS (SELECT c.nome, e."Situação" AS sit, coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(e."Nome do Cargo"), ''), 'Sem cargo') AS cargo,
                 public.tvg_num_br(e."Valor Salário"::text) AS sal, e."Data Afastamento" AS dt_af,
                 CASE WHEN p_alvo IN ('op_faltas', 'rh_absenteismo') THEN (e."Situação" ILIKE 'Atestado%' OR e."Situação" ILIKE 'Falta%')
                      ELSE e."Situação" NOT IN ('Trabalhando', 'Férias') END AS fora
            FROM public."EMPREGADOS" e JOIN c ON c.nn = public.rh_norm_contrato(e."Nome Filial")
           WHERE e."Situação" <> 'Demitido' AND e."Nome Filial" IS NOT NULL)
    SELECT jsonb_build_object(
      'observacao', CASE WHEN p_alvo = 'rh_salarios' THEN 'Por contrato: faturamento = valor mensal contratado (cadastro do contrato); folha = soma do salário-base dos ativos na Senior, aberta por cargo.'
                         ELSE 'Por contrato: situação de cada colaborador ativo na folha Senior hoje; "fora" = os que entram na conta do indicador, abertos por situação e cargo.' END,
      'contratos', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'contrato', c.nome, 'cliente', c.cliente, 'faturamento_mensal', c.fat, 'quadro_estipulado', c.estipulado,
          'ativos', (SELECT count(*) FROM e WHERE e.nome = c.nome),
          'situacoes', (SELECT jsonb_object_agg(sit, q) FROM (SELECT sit, count(*) q FROM e WHERE e.nome = c.nome GROUP BY 1) s),
          'fora_por_cargo', CASE WHEN p_alvo <> 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'situacao', sit, 'qtd', q) ORDER BY q DESC)
                              FROM (SELECT cargo, sit, count(*) q FROM e WHERE e.nome = c.nome AND fora GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12) z) END,
          'folha_total', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT round(sum(sal), 2) FROM e WHERE e.nome = c.nome) END,
          'folha_por_cargo', CASE WHEN p_alvo = 'rh_salarios' THEN (SELECT jsonb_agg(jsonb_build_object('cargo', cargo, 'qtd', q, 'soma_salarios', s, 'salario_medio', round(s / q, 2)) ORDER BY s DESC)
                               FROM (SELECT cargo, count(*) q, round(sum(sal), 2) s FROM e WHERE e.nome = c.nome AND sal > 0 GROUP BY 1 ORDER BY 3 DESC LIMIT 12) z) END)
        ORDER BY array_position(nomes, c.nome)) FROM c), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  -- ── Experiência vencendo / acidentes: os colaboradores (sem nome) ─────
  IF p_alvo = 'rh_ob_experiencia' THEN
    WITH e AS (SELECT coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato') AS contrato,
                      coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo") AS cargo, public.rh_data(e."Admissão"::text) AS adm
                 FROM public."EMPREGADOS" e WHERE e."Situação" <> 'Demitido'),
    f AS (SELECT *, hoje - adm AS dias FROM e WHERE hoje - adm BETWEEN 45 - coalesce(p_param, 15)::int AND 45 OR hoje - adm BETWEEN 90 - coalesce(p_param, 15)::int AND 90)
    SELECT jsonb_build_object('observacao', 'Colaboradores ativos chegando ao fim do 1º (45 d) ou 2º (90 d) período de experiência, pela data de admissão na Senior.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'cargo', cargo, 'admissao', adm, 'dias_de_casa', dias,
                                                                'vence_em', CASE WHEN dias <= 45 THEN adm + 45 ELSE adm + 90 END) ORDER BY contrato, dias DESC)
                               FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 50) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'sst_acidentes' THEN
    SELECT jsonb_build_object('observacao', 'Colaboradores com situação ou causa de acidente na folha Senior, hoje.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', coalesce(nullif(btrim(e."Nome Filial"), ''), 'Sem contrato'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'situacao', e."Situação",
                     'causa', e."Descrição (Causa)", 'data_afastamento', e."Data Afastamento")), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e
             WHERE e."Situação" ILIKE '%acident%' OR e."Descrição (Causa)" ILIKE '%acident%' AND e."Situação" <> 'Demitido' LIMIT 50) e;
    RETURN r;
  END IF;

  -- ── Turnover: o painel de turnover da Diretoria, recortado ────────────
  IF p_alvo = 'op_turnover' THEN
    v_ano := extract(year FROM hoje)::int;
    -- Ano inteiro até hoje, todas as causas: igual a Relatórios › Turnover (mig 20261014000026).
    v_meses := NULL;
    v_painel := public.dir_turnover_painel_dados(v_ano, NULL, NULL, NULL, v_meses);
    SELECT jsonb_build_object(
      'observacao', 'Os mesmos dados de Relatórios › Turnover, ano ' || v_ano || ' inteiro até hoje, todas as causas. Turnover do ano = SOMA das taxas mensais (demissões ÷ efetivo no fim do mês); meta 41% no ano e 3,42% no mês; projeção = soma × fator_projecao. Contrato: demissões ÷ efetivo médio do contrato no ano.',
      'fator_projecao', v_painel->'fator_projecao', 'efetivo_medio_grupo', v_painel->'efetivo_medio',
      'mensal', v_painel->'mensal', 'causas_de_demissao', v_painel->'causas',
      'contratos', (SELECT jsonb_agg(x) FROM jsonb_array_elements(v_painel->'por_contrato') x
                     WHERE regexp_replace(x->>'contrato', '^\s*\d+\s*-\s*', '') = ANY (nomes)))
      INTO r;
    RETURN r;
  END IF;

  -- ── Notificações do Jurídico (glosas, multas, reclamações, prazos) ────
  IF p_alvo IN ('op_glosas', 'fin_glosas', 'op_reclamacoes', 'jur_prazos', 'jur_sem_resposta', 'jur_multas_revertidas', 'jur_contratos_analise') THEN
    WITH f AS (
      SELECT n.*, coalesce(nullif(btrim(n.contrato), ''), n.orgao, 'Sem contrato') AS contrato_ou_orgao
        FROM public."JUR_NOTIFICACOES" n
       WHERE CASE p_alvo
               WHEN 'op_glosas' THEN n.tipo = 'Glosa' AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'fin_glosas' THEN n.tipo IN ('Glosa', 'Multa') AND coalesce(n.resultado, '') <> 'Revertida' AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'op_reclamacoes' THEN coalesce(n.tipo, '') NOT IN ('Glosa', 'Multa') AND coalesce(n.data_recebimento, n.created_at::date) >= hoje - coalesce(p_param, 90)::int
               WHEN 'jur_prazos' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.prazo_defesa - hoje <= coalesce(p_param, 5)
               WHEN 'jur_sem_resposta' THEN n.encerrada_em IS NULL AND coalesce(n.etapa, '') <> 'Encerrada' AND n.etapa IN ('Recebida', 'Em análise')
               WHEN 'jur_multas_revertidas' THEN n.resultado ILIKE 'Revertida%' AND coalesce(n.data_desfecho, n.updated_at::date) >= hoje - coalesce(p_param, 365)::int
               ELSE nullif(btrim(n.medida_preventiva), '') IS NOT NULL AND NOT coalesce(n.medida_concluida, false) AND n.medida_prazo < hoje END)
    SELECT jsonb_build_object(
      'observacao', 'Notificações de Jurídico › Notificações (JUR_NOTIFICACOES) que entram na conta, com o mesmo filtro do indicador. Valores em R$.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_causa', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_orgao, 'causa', causa, 'qtd', q, 'valor', v) ORDER BY v DESC NULLS LAST, q DESC)
                                 FROM (SELECT contrato_ou_orgao, left(coalesce(nullif(btrim(causa_raiz), ''), nullif(btrim(assunto), ''), tipo, 'Sem causa registrada'), 100) AS causa,
                                              count(*) q, sum(coalesce(valor_final, valor_original)) v FROM f GROUP BY 1, 2 ORDER BY 4 DESC NULLS LAST, 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('protocolo', protocolo, 'documento', numero_documento, 'tipo', tipo, 'contrato', contrato_ou_orgao,
                       'posto', local_posto, 'ocorrencia', data_ocorrencia, 'recebida', data_recebimento, 'assunto', left(assunto, 150), 'causa_raiz', left(causa_raiz, 150),
                       'valor_original', valor_original, 'valor_final', valor_final, 'valor_descontado', valor_descontado, 'etapa', etapa, 'resultado', resultado,
                       'prazo_defesa', prazo_defesa, 'setor_responsavel', setor_responsavel,
                       'medida_preventiva', left(medida_preventiva, 120), 'medida_prazo', medida_prazo, 'medida_concluida', medida_concluida))
                      FROM (SELECT * FROM f ORDER BY coalesce(valor_final, valor_original) DESC NULLS LAST, coalesce(prazo_defesa, data_recebimento) LIMIT 40) z),
      'descontos_nas_nfs', CASE WHEN p_alvo = 'fin_glosas' THEN (
          SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao,
                                              'descontos_pos_emissao', descontos_pos_emissao_total, 'conta_vinculada_retida', desconto_conta_vinculada) ORDER BY tot DESC)
            FROM (SELECT n.numero_nf, c.nome AS contrato, n.competencia, n.data_emissao, n.descontos_pos_emissao_total, n.desconto_conta_vinculada,
                         coalesce(n.descontos_pos_emissao_total, 0) AS tot
                    FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
                   WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= hoje - coalesce(p_param, 90)::int
                     AND coalesce(n.descontos_pos_emissao_total, 0) > 0
                   ORDER BY tot DESC LIMIT 25) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Processos do Jurídico (sem o nome do reclamante) ──────────────────
  IF p_alvo IN ('jur_audiencias', 'jur_reincidentes', 'jur_risco', 'jur_valor_condenacao', 'jur_valor_acordo') THEN
    WITH p AS (
      SELECT p.*, coalesce(nullif(btrim(p.contrato), ''), p.comarca, 'Sem contrato') AS contrato_ou_comarca,
             coalesce(p.valor_pedidos, p.valor_causa, 0)::numeric AS pedidos,
             (SELECT min(left(d, 10)::date) FROM unnest(ARRAY[p.data_audiencia_designada, p.data_primeira_audiencia, p.data_audiencia_instrucao, p.data_pericia]) d
               WHERE d ~ '^\d{4}-\d{2}-\d{2}' AND left(d, 10)::date BETWEEN hoje AND hoje + coalesce(p_param, 15)::int) AS proxima
        FROM public."JUR_PROCESSOS" p WHERE p.status = 'EM ANDAMENTO'),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'jur_audiencias' THEN proxima IS NOT NULL
            WHEN 'jur_risco' THEN numero_processo IN (SELECT q.numero_processo FROM public."JUR_PROCESSOS" q WHERE q.status = 'EM ANDAMENTO' GROUP BY 1 HAVING coalesce(sum(q.valor_pedidos), max(q.valor_causa), 0) >= coalesce(p_param, 100000))
            WHEN 'jur_valor_condenacao' THEN coalesce(valor_sentenca, 0) > 0
            WHEN 'jur_valor_acordo' THEN coalesce(valor_acordo, 0) > 0
            ELSE EXISTS (SELECT 1 FROM regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes)) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos em andamento de Jurídico › Processos (JUR_PROCESSOS) que entram na conta. Valores em R$; pedidos = valor dos pedidos (ou da causa).',
      'total_registros', (SELECT count(*) FROM f), 'total_processos', (SELECT count(DISTINCT numero_processo) FROM f), 'obs_linhas', 'Cada processo tem uma linha por motivo (pedido); pedidos/sentença/acordo de cada linha são a parte daquele motivo.',
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato_ou_comarca, 'processos', q, 'pedidos', s1, 'sentencas', s2, 'acordos', s3) ORDER BY s1 DESC)
                         FROM (SELECT contrato_ou_comarca, count(*) q, sum(pedidos) s1, sum(valor_sentenca) s2, sum(valor_acordo) s3 FROM f GROUP BY 1 ORDER BY 3 DESC LIMIT 15) z),
      'por_motivo_e_contrato', CASE WHEN p_alvo = 'jur_reincidentes' THEN (
          SELECT jsonb_agg(jsonb_build_object('motivo', m, 'contrato', contrato_ou_comarca, 'processos', q) ORDER BY array_position(nomes, m), q DESC)
            FROM (SELECT btrim(x) m, contrato_ou_comarca, count(DISTINCT numero_processo) q
                    FROM f, regexp_split_to_table(coalesce(motivos, ''), '\s*[,;]\s*') x WHERE btrim(x) = ANY (nomes) GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 40) z) END,
      'registros', (SELECT jsonb_agg(jsonb_build_object('processo', numero_processo, 'contrato', contrato_ou_comarca, 'comarca', comarca, 'tipo', tipo_processo,
                       'motivos', left(motivos, 200), 'entrada', data_entrada_reclamatoria, 'pedidos', pedidos, 'valor_sentenca', valor_sentenca,
                       'status_sentenca', status_sentenca, 'houve_acordo', houve_acordo, 'valor_acordo', valor_acordo, 'recursos', status_recursos,
                       'proxima_data', proxima, 'audiencia_designada', data_audiencia_designada, 'instrucao', data_audiencia_instrucao, 'pericia', data_pericia))
                      FROM (SELECT * FROM f ORDER BY proxima NULLS LAST, pedidos DESC LIMIT CASE WHEN p_alvo = 'jur_reincidentes' THEN 12 ELSE 35 END) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Licitações: as linhas da grade ────────────────────────────────────
  IF p_alvo IN ('lic_prazo', 'lic_propostas', 'lic_implantacao', 'lic_perdidas', 'lic_valor', 'lic_documentos', 'lic_risco') THEN
    WITH f AS (
      SELECT g.* FROM public.grade g
       WHERE CASE p_alvo
               WHEN 'lic_prazo' THEN g.fase::text IN ('À Iniciar', 'Iniciado') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 3)::int
               WHEN 'lic_propostas' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 7)::int
               WHEN 'lic_implantacao' THEN g.fase::text = 'Finalizada' AND g.posicao = 1 AND g.data >= hoje - coalesce(p_param, 365)::int
                    AND NOT EXISTS (SELECT 1 FROM public.implantacao_contrato i WHERE g.capa_id IS NOT NULL AND i.capa_id = g.capa_id)
                    AND NOT EXISTS (SELECT 1 FROM public.contratos c WHERE c.grade_id = g.id)
               WHEN 'lic_perdidas' THEN g.fase::text = 'Finalizada' AND g.posicao IS DISTINCT FROM 1 AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 90)::int)
               WHEN 'lic_valor' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento')
               WHEN 'lic_documentos' THEN g.fase::text IN ('À Iniciar', 'Iniciado', 'Em Andamento') AND g.capa_id IS NULL AND g.data BETWEEN hoje AND hoje + coalesce(p_param, 15)::int
               ELSE g.fase::text IN ('Suspenso', 'Revogado') AND coalesce(g.updated_at, g.created_at) >= now() - make_interval(days => coalesce(p_param, 180)::int) END)
    SELECT jsonb_build_object(
      'observacao', 'Processos da grade de Licitações que entram na conta. posicao = colocação da empresa (1 = vencedora); status_obs = observação/motivo registrado.',
      'total_registros', (SELECT count(*) FROM f),
      'registros', (SELECT jsonb_agg(jsonb_build_object('edital', edital, 'cidade', cidade, 'uf', uf, 'sessao', data, 'horario', horario, 'fase', fase,
                       'objeto', left(objeto, 150), 'valor_global', public.tvg_num_br(valor_global), 'pessoas', qtd_pessoas, 'posicao', posicao,
                       'status_obs', left(status_obs, 150), 'capa_preenchida', capa_id IS NOT NULL, 'captada_em', data_captacao))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'lic_valor' THEN -public.tvg_num_br(valor_global) END NULLS LAST, data LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: pedidos parados ───────────────────────────────────────────
  IF p_alvo IN ('sup_compras_vencidas', 'sup_contratos_sem_entrega', 'sst_epi', 'sst_imp_epi', 'sup_fornecedor') THEN
    WITH f AS (
      SELECT p.*, hoje - p.data_solicitacao AS dias, coalesce(nullif(btrim(p.contrato_nome), ''), 'Sem contrato') AS contrato
        FROM public.sup_pedido p
       WHERE CASE p_alvo
               WHEN 'sup_compras_vencidas' THEN p.status = 'AGUARDANDO COMPRA' AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               WHEN 'sup_contratos_sem_entrega' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int
               WHEN 'sup_fornecedor' THEN p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO') AND p.data_solicitacao < hoje - coalesce(p_param, 15)::int
               ELSE p.tipo_pedido IN ('uniforme', 'ambos') AND p.status IN ('AGUARDANDO COMPRA', 'AGUARDANDO ENVIO', 'EM PREPARACAO', 'EM SEPARACAO')
                    AND p.data_solicitacao < hoje - coalesce(p_param, 10)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Pedidos de material/uniforme do Supply (sup_pedido) parados, com o mesmo filtro do indicador. dias = desde a solicitação.',
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato_e_status', (SELECT jsonb_agg(jsonb_build_object('contrato', contrato, 'status', status, 'qtd', q, 'mais_antigo_dias', d) ORDER BY q DESC)
                                  FROM (SELECT contrato, status, count(*) q, max(dias) d FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('pedido', pedido_id, 'contrato', contrato, 'posto', posto_nome, 'funcao', funcao_nome, 'tipo', tipo_pedido,
                       'status', status, 'solicitado_em', data_solicitacao, 'dias', dias, 'admissao', admissao, 'origem', origem, 'observacao', left(observacao, 120)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Supply: itens de estoque ──────────────────────────────────────────
  IF p_alvo IN ('sup_abaixo_minimo', 'sup_valor_estoque', 'sup_sem_mov') THEN
    WITH s AS (SELECT item_estoque_id, sum(disponivel) AS disp, sum(fisico) AS fis FROM public.sup_estoque_saldo GROUP BY 1),
    i AS (SELECT ei.id, it.nome, it.tipo, it.tamanho, ei.estoque_minimo AS minimo, coalesce(ei.valor_unitario, 0) AS vu, ei.fornecedor, ei.validade,
                 coalesce(s.disp, 0) AS disp, coalesce(s.fis, 0) AS fis,
                 (SELECT max(m.created_at)::date FROM public.sup_estoque_movimento m WHERE m.item_estoque_id = ei.id) AS ult_mov,
                 (SELECT max(c.consumido_em)::date FROM public.sup_estoque_consumo c WHERE c.item_estoque_id = ei.id) AS ult_consumo
            FROM public.sup_estoque_item ei JOIN public.sup_item it ON it.id = ei.sup_item_id
            LEFT JOIN s ON s.item_estoque_id = ei.id WHERE ei.arquivado_em IS NULL),
    f AS (SELECT * FROM i WHERE CASE p_alvo
            WHEN 'sup_abaixo_minimo' THEN minimo > 0 AND disp < minimo
            WHEN 'sup_valor_estoque' THEN fis > 0
            ELSE fis > 0 AND coalesce(greatest(ult_mov, ult_consumo), '1900-01-01') < hoje - coalesce(p_param, 90)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Itens do estoque do Supply que entram na conta. disp = disponível; fis = físico; vu = valor unitário; ult_mov/ult_consumo = última movimentação/consumo.',
      'total_registros', (SELECT count(*) FROM f), 'valor_total', (SELECT round(sum(fis * vu), 2) FROM f),
      'por_tipo', (SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'itens', q, 'valor', v) ORDER BY v DESC) FROM (SELECT tipo, count(*) q, round(sum(fis * vu), 2) v FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('item', nome, 'tipo', tipo, 'tamanho', tamanho, 'minimo', minimo, 'disp', disp, 'fis', fis, 'vu', vu,
                       'valor', round(fis * vu, 2), 'fornecedor', fornecedor, 'validade', validade, 'ult_mov', ult_mov, 'ult_consumo', ult_consumo))
                      FROM (SELECT * FROM f ORDER BY CASE WHEN p_alvo = 'sup_abaixo_minimo' THEN disp::numeric / greatest(minimo, 1) ELSE -(fis * vu) END LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Frota e patrimônio ────────────────────────────────────────────────
  IF p_alvo IN ('fro_indisponiveis', 'fro_manutencoes', 'fro_sem_responsavel', 'fro_documentos', 'fro_nao_localizados') THEN
    WITH p AS (
      SELECT p.*, c.nome AS contrato,
             greatest(p.updated_at, (SELECT max(l.created_at) FROM public.sup_patrimonio_log l WHERE l.patrimonio_id = p.id))::date AS ult_atualizacao
        FROM public.sup_patrimonio p LEFT JOIN public.contratos c ON c.id = p.contrato_id WHERE p.ativo),
    f AS (SELECT * FROM p WHERE CASE p_alvo
            WHEN 'fro_indisponiveis' THEN categoria = 'veiculo' AND (em_manutencao OR motivo_indisponivel IS NOT NULL)
            WHEN 'fro_manutencoes' THEN em_manutencao AND data_previsao_fim < hoje
            WHEN 'fro_sem_responsavel' THEN contrato_id IS NULL AND posto_id IS NULL AND nullif(btrim(lotacao), '') IS NULL
            WHEN 'fro_documentos' THEN categoria = 'veiculo' AND NOT EXISTS (SELECT 1 FROM public.sup_patrimonio_arquivo a WHERE a.patrimonio_id = p.id)
            ELSE hoje - ult_atualizacao > coalesce(p_param, 180) END)
    SELECT jsonb_build_object(
      'observacao', 'Bens ativos de Patrimônio/Frota (sup_patrimonio) que entram na conta. ult_atualizacao = última alteração ou movimentação registrada.',
      'total_registros', (SELECT count(*) FROM f),
      'por_categoria_e_lotacao', (SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'lotacao', lot, 'qtd', q) ORDER BY q DESC)
                                    FROM (SELECT categoria, coalesce(nullif(btrim(lotacao), ''), contrato, 'Sem lotação') lot, count(*) q FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('bem', nome, 'identificador', identificador, 'categoria', categoria, 'lotacao', lotacao, 'contrato', contrato,
                       'em_manutencao', em_manutencao, 'motivo_indisponivel', motivo_indisponivel, 'motivo_detalhe', left(motivo_detalhe, 150),
                       'inicio_manutencao', data_inicio_manutencao, 'previsao_retorno', data_previsao_fim, 'ult_atualizacao', ult_atualizacao))
                      FROM (SELECT * FROM f ORDER BY data_previsao_fim NULLS LAST, ult_atualizacao LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'fro_combustivel' THEN
    WITH a AS (SELECT * FROM public.cs_veiculo_agendamento a
                WHERE a.controle_km AND coalesce(a.status, '') NOT ILIKE '%cancel%' AND a.data_fim BETWEEN hoje - coalesce(p_param, 60)::int AND hoje - 1)
    SELECT jsonb_build_object(
      'observacao', 'Viagens do agendamento de veículos com controle de km nos últimos ' || coalesce(p_param, 60)::int || ' dias; sem_km = encerrada sem km inicial ou final.',
      'por_veiculo', (SELECT jsonb_agg(jsonb_build_object('veiculo', v, 'viagens', q, 'sem_km', s, 'km_rodado', km) ORDER BY s DESC, km DESC)
                        FROM (SELECT coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, '') v, count(*) q,
                                     count(*) FILTER (WHERE km_inicial IS NULL OR km_final IS NULL) s,
                                     sum(km_final - km_inicial) FILTER (WHERE km_final >= km_inicial) km FROM a GROUP BY 1) z),
      'viagens_sem_km', (SELECT jsonb_agg(jsonb_build_object('agendamento', numero, 'veiculo', coalesce(veiculo_nome, 'Veículo') || coalesce(' · ' || veiculo_identificador, ''),
                            'inicio', data_inicio, 'fim', data_fim, 'destino', left(destino, 80), 'status', status, 'km_inicial', km_inicial, 'km_final', km_final))
                           FROM (SELECT * FROM a WHERE km_inicial IS NULL OR km_final IS NULL ORDER BY data_fim DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Recrutamento: as vagas, com os candidatos por etapa ───────────────
  IF p_alvo IN ('rec_risco', 'rec_abertas', 'rec_prazo', 'rec_admissoes') THEN
    WITH f AS (
      SELECT s.*, hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dias,
             hoje - (coalesce(s.status_changed_at, s.created_at) AT TIME ZONE 'America/Sao_Paulo')::date AS dias_no_status
        FROM public."SISTEMA_RECRUTAMENTO" s
       WHERE CASE WHEN p_alvo = 'rec_admissoes'
                  THEN s.status NOT IN ('Reprovada', 'Contratado', 'Concluído') AND s.data_inicio_prevista ~ '^\d{4}-\d{2}-\d{2}'
                       AND left(s.data_inicio_prevista, 10)::date BETWEEN date_trunc('month', hoje)::date AND hoje
                  ELSE s.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
                       AND (p_alvo = 'rec_abertas' OR (p_alvo = 'rec_risco' AND s.grau_urgencia ILIKE 'Alta%' AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))
                            OR (p_alvo = 'rec_prazo' AND hoje - (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date > coalesce(p_param, 15))) END)
    SELECT jsonb_build_object(
      'observacao', 'Vagas da Gestão Recrutamento (SISTEMA_RECRUTAMENTO) que entram na conta' ||
                    CASE WHEN p_alvo = 'rec_admissoes' THEN ' (só as PENDENTES: início previsto no mês até hoje e ainda não contratadas)' ELSE '' END ||
                    '. candidatos = currículos no kanban da vaga por etapa (sem desistentes).',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(status, q) FROM (SELECT status, sum(greatest(coalesce(quantidade_vagas, 1), 1)) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('vaga', id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo, 'qtd', coalesce(quantidade_vagas, 1),
                       'status', status, 'urgencia', grau_urgencia, 'motivo', motivo_vaga, 'aberta_ha_dias', dias, 'dias_no_status', dias_no_status,
                       'inicio_previsto', data_inicio_prevista, 'alta_rotatividade', alta_rotatividade,
                       'candidatos', (SELECT jsonb_object_agg(coalesce(etapa_processo, '—'), q) FROM (SELECT etapa_processo, count(*) q FROM public."WA_CURRICULOS" c
                                        WHERE c.vaga_id = z.id AND NOT coalesce(c.desistiu, false) GROUP BY 1) w),
                       'desistencias', (SELECT count(*) FROM public."WA_CURRICULOS" c WHERE c.vaga_id = z.id AND c.desistiu)))
                      FROM (SELECT * FROM f ORDER BY dias DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'rec_desistencias' THEN
    WITH d AS (SELECT h.created_at::date AS dia, h.solicitacao_id, s.contrato, s.cidade, s.cargo, h.de_status, h.evento,
                      coalesce(substring(h.evento FROM '\(em ([^)]+)\)'), coalesce(h.de_status, 'etapa não informada')) AS etapa,
                      (SELECT c.desistencia_motivo FROM public."WA_CURRICULOS" c WHERE c.id = h.candidato_id) AS motivo
                 FROM public."RECRUTAMENTO_HISTORICO" h LEFT JOIN public."SISTEMA_RECRUTAMENTO" s ON s.id = h.solicitacao_id
                WHERE h.evento ILIKE '%desist%' AND h.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int))
    SELECT jsonb_build_object(
      'observacao', 'Desistências registradas no histórico das vagas nos últimos ' || coalesce(p_param, 30)::int || ' dias (sem o nome do candidato).',
      'por_etapa', (SELECT jsonb_object_agg(etapa, q) FROM (SELECT etapa, count(*) q FROM d GROUP BY 1) z),
      'por_motivo', (SELECT jsonb_object_agg(m, q) FROM (SELECT coalesce(nullif(btrim(motivo), ''), 'não informado') m, count(*) q FROM d GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('dia', dia, 'vaga', solicitacao_id, 'contrato', contrato, 'cidade', cidade, 'cargo', cargo,
                       'etapa', etapa, 'motivo', left(motivo, 150)) ORDER BY dia DESC) FROM (SELECT * FROM d ORDER BY dia DESC LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Rescisões e ASO (sem nome do colaborador/candidato) ───────────────
  IF p_alvo IN ('rh_ob_rescisoes', 'sst_aso', 'sst_imp_aso') THEN
    SELECT jsonb_build_object(
      'observacao', 'Solicitações de demissão pendentes' || CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN '' ELSE ' no SST e candidatos na etapa SST + COMPRAS (admissional)' END ||
                    '; dias = desde a solicitação / desde que entrou na etapa.',
      'demissionais', (SELECT jsonb_agg(jsonb_build_object('solicitacao', id, 'contrato', contrato, 'cargo', colaborador_cargo, 'posto', colaborador_posto,
                          'motivo', left(coalesce(motivo_solicitacao, motivo_pedido), 120), 'status', status, 'solicitada_em', coalesce(data_solicitacao, criado_em::date),
                          'dias', hoje - coalesce(data_solicitacao, criado_em::date), 'aviso', data_aviso, 'modelo_aviso', modelo_aviso,
                          'exame_agendado', sst_data_exame, 'devolvida', left(devolvido_motivo, 120)) ORDER BY coalesce(data_solicitacao, criado_em::date))
                         FROM (SELECT * FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s
                                WHERE s.status IN (CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente Operacional' END, CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 'Pendente RH' END,
                                                   'Pendente SST', 'Solicitação de agendamento de DEMISSIONAL recebida')
                                AND hoje - coalesce(s.data_solicitacao, s.criado_em::date) > coalesce(p_param, CASE WHEN p_alvo = 'rh_ob_rescisoes' THEN 10 ELSE 5 END)
                                ORDER BY coalesce(s.data_solicitacao, s.criado_em::date) LIMIT 40) z),
      'admissionais', CASE WHEN p_alvo <> 'rh_ob_rescisoes' THEN (
          SELECT jsonb_agg(jsonb_build_object('vaga', v.id, 'contrato', v.contrato, 'cidade', v.cidade, 'cargo', v.cargo,
                   'dias_na_etapa', hoje - coalesce(c.etapa_changed_at, c.created_at)::date, 'exame_agendado', c.sst_data_exame,
                   'sst_ok', c.sst_ok, 'compras_ok', c.compras_ok) ORDER BY coalesce(c.etapa_changed_at, c.created_at))
            FROM (SELECT * FROM public."WA_CURRICULOS" c WHERE c.etapa_processo = 'SST + COMPRAS' AND NOT coalesce(c.desistiu, false)
                     AND hoje - coalesce(c.etapa_changed_at, c.created_at)::date > coalesce(p_param, 5)
                   ORDER BY coalesce(c.etapa_changed_at, c.created_at) LIMIT 40) c
            LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Treinamentos ──────────────────────────────────────────────────────
  IF p_alvo = 'trn_integracoes' THEN
    WITH a AS (SELECT a.*, coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS ctr FROM public."TRN_ALUNO" a
                WHERE a.status = 'ativo' AND a.created_at >= now() - make_interval(days => coalesce(p_param, 30)::int) AND a.created_at < now() - interval '7 days'
                  AND NOT EXISTS (SELECT 1 FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida))
    SELECT jsonb_build_object(
      'observacao', 'Alunos ativos criados nos últimos ' || coalesce(p_param, 30)::int || ' dias sem nenhuma aula concluída na plataforma de Treinamentos.',
      'por_contrato_e_cargo', (SELECT jsonb_agg(jsonb_build_object('contrato', ctr, 'cargo', cargo, 'alunos', q, 'nunca_acessaram', na) ORDER BY q DESC)
                                 FROM (SELECT ctr, cargo, count(*) q, count(*) FILTER (WHERE primeiro_acesso_em IS NULL) na FROM a GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25) z),
      'matriculas_desses_alunos', (SELECT jsonb_object_agg(curso, q) FROM (SELECT c.nome curso, count(*) q FROM a JOIN public."TRN_MATRICULA" m ON m.aluno_id = a.id
                                     JOIN public."TRN_CURSO" c ON c.id = m.curso_id GROUP BY 1 ORDER BY 2 DESC LIMIT 15) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo IN ('trn_contratuais', 'trn_vencidos', 'sst_imp_treinamento', 'trn_programados', 'trn_sem_comprovacao') THEN
    v_mes := date_trunc('month', hoje)::date;
    WITH m AS (SELECT coalesce(nullif(btrim(a.contrato), ''), 'Sem contrato') AS contrato, c.nome AS curso, m.inscrito_em, hoje - m.inscrito_em AS dias, a.expira_em,
                      EXISTS (SELECT 1 FROM public."TRN_CERTIFICADO" ce WHERE ce.aluno_id = m.aluno_id AND ce.curso_id = m.curso_id) AS certificado
                 FROM public."TRN_MATRICULA" m JOIN public."TRN_ALUNO" a ON a.id = m.aluno_id JOIN public."TRN_CURSO" c ON c.id = m.curso_id
                WHERE CASE WHEN p_alvo IN ('trn_programados') THEN m.inscrito_em >= v_mes
                           WHEN p_alvo = 'trn_sem_comprovacao' THEN m.inscrito_em < hoje - coalesce(p_param, 60)::int
                           ELSE a.status = 'ativo' END),
    f AS (SELECT * FROM m WHERE CASE p_alvo
            WHEN 'trn_contratuais' THEN NOT certificado AND dias > coalesce(p_param, 30)
            WHEN 'trn_programados' THEN true
            WHEN 'trn_sem_comprovacao' THEN NOT certificado
            ELSE NOT certificado AND expira_em IS NOT NULL AND expira_em <= hoje + coalesce(p_param, 15)::int END)
    SELECT jsonb_build_object(
      'observacao', 'Matrículas da plataforma de Treinamentos que entram na conta, por curso e contrato do aluno.' ||
                    CASE WHEN p_alvo = 'trn_programados' THEN ' Mês corrente: matrículas e quantas já têm certificado.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_curso', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'matriculas', q, 'com_certificado', ok, 'mais_antiga_dias', d) ORDER BY q DESC)
                      FROM (SELECT curso, count(*) q, count(*) FILTER (WHERE certificado) ok, max(dias) d FROM f GROUP BY 1 ORDER BY 2 DESC LIMIT 20) z),
      'por_curso_e_contrato', (SELECT jsonb_agg(jsonb_build_object('curso', curso, 'contrato', contrato, 'qtd', q, 'vence_ate', v) ORDER BY q DESC)
                                 FROM (SELECT curso, contrato, count(*) q, min(expira_em) v FROM f GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30) z))
      INTO r;
    RETURN r;
  END IF;

  -- ── Faturamento, recebimento, inadimplência, fluxo ────────────────────
  IF p_alvo IN ('fin_notas_pendentes', 'fin_valor_pendente') THEN
    v_mes := CASE WHEN extract(day FROM hoje) > coalesce(p_param, 20) THEN date_trunc('month', hoje - interval '1 month')
                  ELSE date_trunc('month', hoje - interval '2 months') END::date;
    SELECT jsonb_build_object(
      'observacao', 'Contratos ativos sem NF enviada/concluída da competência ' || to_char(v_mes, 'MM/YYYY') || ' no Faturamento (nf_emissao). nf_da_competencia = NF que existe mas ainda não foi enviada/concluída.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('contrato', c.nome, 'cliente', c.cliente, 'valor', coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado),
                     'ultima_competencia_emitida', (SELECT max(n.competencia) FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida')),
                     'nf_da_competencia', (SELECT jsonb_agg(jsonb_build_object('status', n.status, 'numero', n.numero_nf)) FROM public.nf_emissao n
                                             WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.competencia = v_mes))
                     ORDER BY coalesce(nullif(c.valor_executado_mensal, 0), c.valor_mensal_contratado) DESC), '[]'::jsonb))
      INTO r
      FROM public.contratos c
     WHERE c.status = 'ativo' AND coalesce(c.valor_mensal_contratado, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.nf_emissao n WHERE n.contrato_id = c.id AND n.deleted_at IS NULL AND n.status::text IN ('enviada', 'concluida') AND n.competencia = v_mes);
    RETURN r;
  END IF;

  IF p_alvo IN ('fin_recebimentos', 'fin_inadimplencia', 'fin_fluxo') THEN
    WITH n AS (
      SELECT n.*, c.nome AS contrato, n.data_emissao + CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END AS vencimento
        FROM public.nf_emissao n LEFT JOIN public.contratos c ON c.id = n.contrato_id
       WHERE n.deleted_at IS NULL AND n.status::text = 'concluida' AND n.data_emissao IS NOT NULL),
    f AS (SELECT * FROM n WHERE CASE p_alvo
            WHEN 'fin_recebimentos' THEN vencimento BETWEEN date_trunc('month', hoje)::date AND hoje
            WHEN 'fin_inadimplencia' THEN data_pagamento IS NULL AND hoje - vencimento >= 15
            ELSE data_pagamento IS NULL AND vencimento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int END)
    SELECT jsonb_build_object(
      'observacao', 'NFs concluídas do Faturamento (nf_emissao) que entram na conta; vencimento = emissão + ' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN 30 ELSE coalesce(p_param, 30)::int END || ' dias; pago = tem data de pagamento.' ||
                    CASE WHEN p_alvo = 'fin_fluxo' THEN ' Saídas = despesas do Malote a pagar no período.' ELSE '' END,
      'total_registros', (SELECT count(*) FROM f),
      'por_contrato', (SELECT jsonb_agg(jsonb_build_object('contrato', coalesce(contrato, 'Sem contrato'), 'nfs', q, 'valor', v, 'em_aberto', a) ORDER BY a DESC)
                         FROM (SELECT contrato, count(*) q, sum(vlr_liquido_total) v, sum(vlr_liquido_total) FILTER (WHERE data_pagamento IS NULL) a FROM f GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 20) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('nf', numero_nf, 'contrato', contrato, 'competencia', competencia, 'emissao', data_emissao, 'vencimento', vencimento,
                       'dias_atraso', CASE WHEN data_pagamento IS NULL AND vencimento < hoje THEN hoje - vencimento END, 'valor_liquido', vlr_liquido_total,
                       'pago_em', data_pagamento, 'valor_pago', valor_pago, 'falta_receber', falta_receber, 'obs_financeiro', left(observacoes_financeiro, 120)))
                      FROM (SELECT * FROM f ORDER BY (data_pagamento IS NULL) DESC, vlr_liquido_total DESC NULLS LAST LIMIT 40) z),
      'saidas_malote', CASE WHEN p_alvo = 'fin_fluxo' THEN (
          SELECT jsonb_agg(jsonb_build_object('despesa', numero, 'descricao', left(nome, 80), 'tipo', tipo, 'pagar_em', data_pagamento,
                                              'valor', coalesce(valor_aprovado, valor_total), 'status', status) ORDER BY data_pagamento)
            FROM (SELECT * FROM public.malote_despesa d
                   WHERE d.deleted_at IS NULL AND d.pago_em IS NULL AND coalesce(d.status, '') NOT ILIKE ANY (ARRAY['%cancel%', '%reprov%', '%pag%'])  -- igual à tvg_calc_extra (fin_fluxo)
                     AND d.data_pagamento BETWEEN hoje AND hoje + coalesce(p_param, 30)::int
                   ORDER BY coalesce(d.valor_aprovado, d.valor_total) DESC NULLS LAST LIMIT 40) z) END)
      INTO r;
    RETURN r;
  END IF;

  -- ── Controladoria: planos de ação e indicadores manuais ───────────────
  IF p_alvo = 'ctl_planos' THEN
    WITH f AS (SELECT p.* FROM public.plano_acao p
                WHERE p.deleted_at IS NULL AND coalesce(p.status_normalizado, '') NOT LIKE 'concluida%' AND p.data_fim_planejado < hoje)
    SELECT jsonb_build_object(
      'observacao', 'Planos de ação (Plano de Ações) com prazo final vencido e não concluídos.',
      'total_registros', (SELECT count(*) FROM f),
      'por_status', (SELECT jsonb_object_agg(coalesce(status_normalizado, '—'), q) FROM (SELECT status_normalizado, count(*) q FROM f GROUP BY 1) z),
      'registros', (SELECT jsonb_agg(jsonb_build_object('titulo', left(coalesce(titulo, acao), 120), 'area', coalesce(nullif(btrim(area), ''), nullif(btrim(setor), ''), comite),
                       'comite', comite, 'prioridade', prioridade_normalizada, 'prazo', data_fim_planejado, 'dias_atraso', hoje - data_fim_planejado,
                       'status', status_normalizado, 'custo_previsto', custo_previsto, 'tipo', tipo_acao))
                      FROM (SELECT * FROM f ORDER BY data_fim_planejado LIMIT 40) z))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ctl_nao_atualizados' THEN
    SELECT jsonb_build_object('observacao', 'Indicadores de lançamento manual das TVs sem lançamento dentro da periodicidade.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('indicador', i.nome, 'tv', pa.titulo, 'periodicidade', i.periodicidade, 'responsavel_area', i.responsavel,
                     'ultimo_lancamento', (SELECT max(l.created_at)::date FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo)) ORDER BY pa.titulo), '[]'::jsonb))
      INTO r
      FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" pa ON pa.slug = i.painel
     WHERE i.ativo AND i.fonte = 'manual'
       AND coalesce((SELECT max(l.created_at) FROM public."TVG_LANCAMENTO" l WHERE l.indicador = i.codigo), '-infinity')
           < now() - make_interval(days => CASE i.periodicidade WHEN 'diaria' THEN 2 WHEN 'semanal' THEN 8 ELSE 35 END);
    RETURN r;
  END IF;

  -- ── TI ────────────────────────────────────────────────────────────────
  IF p_alvo IN ('ti_erros', 'ti_demandas') THEN
    WITH f AS (SELECT c.* FROM public."CHAMADO_SISTEMA" c
                WHERE c.status IN ('aberto', 'em_andamento', 'aguardando_retorno') AND (p_alvo <> 'ti_erros' OR c.urgencia = 'ate_1h') AND (p_alvo = 'ti_erros' OR c.prioridade = 'alta')
                  AND ((p_alvo = 'ti_erros' AND c.tipo_solicitacao = 'correcao')
                    OR (p_alvo = 'ti_demandas' AND (c.prazo_previsto < hoje
                         OR (c.prazo_previsto IS NULL AND c.created_at < now() - make_interval(days => coalesce(p_param, 30)::int))))))
    SELECT jsonb_build_object('observacao', 'Chamados de Sistemas (CHAMADO_SISTEMA) de prioridade alta que entram na conta.',
      'registros', coalesce((SELECT jsonb_agg(jsonb_build_object('chamado', numero, 'assunto', left(assunto, 120), 'modulo', coalesce(nullif(btrim(modulo_sistema), ''), 'Outro'),
                       'tipo', tipo_solicitacao, 'status', status, 'setor', setor, 'aberto_ha_dias', hoje - (created_at AT TIME ZONE 'America/Sao_Paulo')::date,
                       'prazo', prazo_previsto) ORDER BY created_at) FROM (SELECT * FROM f ORDER BY created_at LIMIT 40) z), '[]'::jsonb))
      INTO r;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_integracoes' THEN
    SELECT jsonb_build_object('observacao', 'Itens da fila de integrações (fila_http) com erro e não processados, agrupados por destino e erro.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('destino', destino, 'erro', erro, 'qtd', q, 'primeiro', p1, 'ultimo', p2, 'tentativas_max', t) ORDER BY q DESC), '[]'::jsonb))
      INTO r
      FROM (SELECT f.destino, left(f.erro, 200) erro, count(*) q, min(f.criado_em) p1, max(f.criado_em) p2, max(f.tentativas) t FROM public.fila_http f
             WHERE f.erro IS NOT NULL AND f.processado_em IS NULL AND f.destino NOT ILIKE 'novidade-ia%' AND f.criado_em >= now() - make_interval(days => coalesce(p_param, 7)::int)
             GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20) z;
    RETURN r;
  END IF;

  IF p_alvo = 'ti_acessos' THEN
    SELECT jsonb_build_object('observacao', 'Logins do ERP ainda ativos de colaboradores demitidos na Senior (sem nome): setor, cargo, data de afastamento e último login.',
      'registros', coalesce(jsonb_agg(jsonb_build_object('setor', coalesce(nullif(btrim(e."Setor_ERP"), ''), nullif(btrim(e."Nome Filial"), ''), 'Sem setor'),
                     'cargo', coalesce(nullif(btrim(e."Título do Cargo"), ''), e."Nome do Cargo"), 'data_afastamento', e."Data Afastamento",
                     'ultimo_login', u.last_sign_in_at::date)), '[]'::jsonb))
      INTO r
      FROM (SELECT * FROM public."EMPREGADOS" e WHERE e."Situação" = 'Demitido' AND e.auth_user_id IS NOT NULL) e
      JOIN auth.users u ON u.id = e.auth_user_id
     WHERE u.banned_until IS NULL OR u.banned_until < now();
    RETURN r;
  END IF;

  RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_ia_detalhe_dados(p_alvo text, p_param numeric) TO service_role;

-- public.tvg_indicador(p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_indicador(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tvg_indicador_dados(p_codigo);
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_indicador(p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_indicador(p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_indicador(p_codigo text) TO authenticated, service_role;

-- public.tvg_indicador_carimbo()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_indicador_carimbo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now(); NEW.updated_by := auth.uid();
  NEW.codigo := OLD.codigo; NEW.painel := OLD.painel; NEW.fonte := OLD.fonte;
  NEW.espelho_de := OLD.espelho_de; NEW.componentes := OLD.componentes; NEW.pai := OLD.pai;
  RETURN NEW;
END $function$$tvgdef$; BEGIN EXECUTE s; END $d$;
REVOKE ALL ON FUNCTION public.tvg_indicador_carimbo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_indicador_carimbo() TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_indicador_dados(p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_indicador_dados(p_codigo text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'painel', jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'diretoria', p.diretoria, 'pergunta', p.pergunta),
    'indicador', public.tvg_resultado(i.codigo),
    'gerado_em', now())
    FROM public."TVG_INDICADOR" i JOIN public."TVG_PAINEL" p ON p.slug = i.painel
   WHERE i.codigo = p_codigo AND i.ativo
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_indicador_dados(p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_indicador_dados(p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_indicador_dados(p_codigo text) TO service_role;

-- public.tvg_js_parsefloat(s text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_js_parsefloat(s text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((regexp_match(btrim(coalesce(s, '')), '^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?'))[1]::numeric, 0);
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_js_parsefloat(s text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_js_parsefloat(s text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_js_parsefloat(s text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_lancamento_autor()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_lancamento_autor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_by := auth.uid();
  NEW.created_by_nome := COALESCE((SELECT coalesce(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid()), NEW.created_by_nome);
  RETURN NEW;
END $function$$tvgdef$; BEGIN EXECUTE s; END $d$;
REVOKE ALL ON FUNCTION public.tvg_lancamento_autor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_lancamento_autor() TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_meta_equipe_excluir(p_id uuid)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_meta_equipe_excluir(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar as metas (Indicadores gerenciais › Alterar).' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."TVG_META_EQUIPE" WHERE id = p_id;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_meta_equipe_excluir(p_id uuid)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_meta_equipe_excluir(p_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_meta_equipe_excluir(p_id uuid) TO authenticated, service_role;

-- public.tvg_meta_equipe_salvar(p jsonb)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_meta_equipe_salvar(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid := nullif(p->>'id', '')::uuid;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão para alterar as metas (Indicadores gerenciais › Alterar).' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p->>'nome'), '') IS NULL THEN RAISE EXCEPTION 'Informe o nome.'; END IF;
  IF coalesce((p->>'meta')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Informe a meta.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."TVG_META_EQUIPE" (painel, nome, nomes_capa, user_id, tipo, meta, ganhos_desde, cor, ordem, updated_by)
    VALUES (coalesce(nullif(p->>'painel', ''), 'ger-licitacoes'), btrim(p->>'nome'),
            coalesce(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'nomes_capa') x WHERE btrim(x) <> ''), '{}'),
            nullif(p->>'user_id', '')::uuid, coalesce(nullif(p->>'tipo', ''), 'valor'), (p->>'meta')::numeric,
            coalesce(nullif(p->>'ganhos_desde', '')::date, DATE '2026-09-01'), nullif(p->>'cor', ''),
            coalesce(nullif(p->>'ordem', '')::int, 100), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."TVG_META_EQUIPE" SET
      nome = btrim(p->>'nome'),
      nomes_capa = coalesce(ARRAY(SELECT btrim(x) FROM jsonb_array_elements_text(p->'nomes_capa') x WHERE btrim(x) <> ''), '{}'),
      user_id = nullif(p->>'user_id', '')::uuid, tipo = coalesce(nullif(p->>'tipo', ''), 'valor'), meta = (p->>'meta')::numeric,
      ganhos_desde = coalesce(nullif(p->>'ganhos_desde', '')::date, DATE '2026-09-01'), cor = nullif(p->>'cor', ''),
      ordem = coalesce(nullif(p->>'ordem', '')::int, ordem), ativo = coalesce((p->>'ativo')::boolean, ativo),
      updated_at = now(), updated_by = auth.uid()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Meta não encontrada.'; END IF;
  END IF;
  RETURN v_id;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_meta_equipe_salvar(p jsonb)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_meta_equipe_salvar(p jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_meta_equipe_salvar(p jsonb) TO authenticated, service_role;

-- public.tvg_nome_norm(p text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_nome_norm(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT nullif(regexp_replace(upper(translate(btrim(coalesce(p, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'), '');
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_nome_norm(p text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_nome_norm(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_nome_norm(p text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_num_br(t text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_num_br(t text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN n ~ '^-?[0-9]+(\.[0-9]+)?$' THEN n::numeric ELSE 0 END
    FROM (SELECT CASE WHEN s LIKE '%,%' THEN replace(replace(s, '.', ''), ',', '.')
                      WHEN length(s) - length(replace(s, '.', '')) > 1 THEN replace(s, '.', '')
                      ELSE s END AS n
            FROM (SELECT regexp_replace(coalesce(t, ''), '[R$[:space:]]', '', 'g') AS s) a) b
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_num_br(t text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_num_br(t text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_num_br(t text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_num_ponto(p text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_num_ponto(p text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN btrim(coalesce(p, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(p)::numeric END
$function$$tvgdef$; BEGIN EXECUTE s; END $d$;
REVOKE ALL ON FUNCTION public.tvg_num_ponto(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_num_ponto(p text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_painel(p_painel text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_painel(p_painel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  RETURN public.tvg_painel_dados(p_painel) || jsonb_build_object('equipe', public.tvg_equipe_meta(p_painel));
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_painel(p_painel text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_painel(p_painel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_painel(p_painel text) TO authenticated, service_role;

-- public.tvg_painel_dados(p_painel text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_painel_dados(p_painel text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'painel', (SELECT jsonb_build_object('slug', p.slug, 'titulo', p.titulo, 'diretoria', p.diretoria, 'pergunta', p.pergunta)
                 FROM public."TVG_PAINEL" p WHERE p.slug = p_painel),
    'indicadores', COALESCE((SELECT jsonb_agg(public.tvg_resultado(i.codigo) ORDER BY i.na_tv DESC, i.ordem)
                               FROM public."TVG_INDICADOR" i WHERE i.painel = p_painel AND i.ativo), '[]'::jsonb),
    'tendencia', public.tvg_tendencia(p_painel),
    'gerado_em', now())
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_painel_dados(p_painel text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_painel_dados(p_painel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_painel_dados(p_painel text) TO service_role;

-- public.tvg_prazo_meses(p text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_prazo_meses(p text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n numeric; t text := lower(coalesce(p, ''));
BEGIN
  n := nullif(substring(t from '(\d+(?:[.,]\d+)?)'), '')::numeric;
  IF n IS NULL OR n <= 0 THEN RETURN NULL; END IF;
  IF t ~ 'ano' THEN n := n * 12; ELSIF t ~ 'dia' THEN n := n / 30.0; END IF;
  RETURN greatest(1, round(n))::int;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_prazo_meses(p text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_prazo_meses(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_prazo_meses(p text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_quadro_contratos()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_quadro_contratos()
 RETURNS TABLE(contrato_id uuid, contrato text, cidade text, necessarios integer, ativos integer, trabalhando integer, ferias integer, afastados integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH f AS (
    SELECT e."Nome Filial" AS filial,
           count(*) FILTER (WHERE e."Situação" <> 'Demitido') AS ativos,
           count(*) FILTER (WHERE e."Situação" = 'Trabalhando') AS trab,
           count(*) FILTER (WHERE e."Situação" = 'Férias') AS ferias,
           count(*) FILTER (WHERE e."Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias')) AS afast
      FROM public."EMPREGADOS" e WHERE e."Nome Filial" IS NOT NULL GROUP BY 1),
  fn AS (SELECT f.*, public.rh_norm_contrato(f.filial) AS nn FROM f),
  c AS (SELECT c.id, c.nome, c.cidade, COALESCE(c.quant_func_estipulado, 0) AS nec, public.dir_rel_contrato_nn(c.id) AS nn
          FROM public.contratos c WHERE c.status = 'ativo')
  SELECT c.id, c.nome, c.cidade, c.nec, sum(fn.ativos)::int, sum(fn.trab)::int, sum(fn.ferias)::int, sum(fn.afast)::int
    FROM c JOIN fn ON fn.nn = c.nn
   GROUP BY c.id, c.nome, c.cidade, c.nec
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_quadro_contratos()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_quadro_contratos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_quadro_contratos() TO service_role;

-- public.tvg_responsaveis_capa()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_responsaveis_capa()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') THEN
    COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', r, 'editais', n, 'ganhos', g) ORDER BY r)
                FROM (SELECT btrim(responsavel) r, count(*) n, count(*) FILTER (WHERE status::text = 'Ganhamos') g
                        FROM public.capa_edital WHERE nullif(btrim(responsavel), '') IS NOT NULL GROUP BY 1) x), '[]'::jsonb)
  ELSE '[]'::jsonb END;
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_responsaveis_capa()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_responsaveis_capa() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_responsaveis_capa() TO authenticated, service_role;

-- public.tvg_resultado(p_codigo text, p_nivel integer)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  i public."TVG_INDICADOR"; l public."TVG_LANCAMENTO"; r jsonb; c text; s numeric := 0; tem boolean := false; sub jsonb;
  partes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND OR p_nivel > 3 THEN RETURN NULL; END IF;

  IF i.fonte = 'auto' THEN
    BEGIN
      r := coalesce(public.tvg_espelho_resultado(i.codigo), public.tvg_calc_espelho(i.codigo, i.parametro), public.tvg_calc_ajuste(i.codigo, i.parametro),
                    public.tvg_calc(i.codigo, i.parametro), public.tvg_calc_extra(i.codigo, i.parametro));
      r := coalesce(r, jsonb_build_object('valor', NULL)) || jsonb_build_object('atualizado_em', now(), 'origem', 'ERP');
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('valor', NULL, 'erro', SQLERRM);
    END;
  ELSIF i.fonte = 'manual' THEN
    SELECT * INTO l FROM public."TVG_LANCAMENTO" WHERE indicador = i.codigo ORDER BY referencia DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      r := jsonb_build_object('valor', l.valor, 'afetado', l.afetado, 'causa', l.causa, 'impacto', l.impacto, 'detalhe', l.detalhe,
                              'responsavel', nullif(btrim(l.responsavel), ''), 'referencia', l.referencia, 'atualizado_em', l.created_at,
                              'origem', 'Lançamento', 'observacao', l.observacao);
    ELSE
      r := jsonb_build_object('valor', NULL, 'origem', 'Lançamento');
    END IF;
  ELSIF i.fonte = 'espelho' THEN
    r := (public.tvg_resultado(i.espelho_de, p_nivel + 1)->'resultado') || jsonb_build_object('origem', 'Espelho');
  ELSE
    FOREACH c IN ARRAY coalesce(i.componentes, ARRAY[]::text[]) LOOP
      sub := public.tvg_resultado(c, p_nivel + 1);
      IF sub IS NOT NULL THEN
        partes := partes || jsonb_build_array(jsonb_build_object('nome', sub->>'nome', 'valor', (sub->'resultado'->>'valor')::numeric,
                                                                  'rotulo', CASE WHEN sub->'resultado'->>'valor' IS NULL THEN 'sem dado' END));
        IF (sub->'resultado'->>'valor') IS NOT NULL THEN s := s + (sub->'resultado'->>'valor')::numeric; tem := true; END IF;
      END IF;
    END LOOP;
    r := jsonb_build_object('valor', CASE WHEN tem THEN s END, 'detalhe', partes, 'origem', 'Soma',
                            'afetado', (SELECT count(*) || ' de ' || jsonb_array_length(partes) || ' com pendência' FROM jsonb_array_elements(partes) x WHERE (x->>'valor')::numeric > 0),
                            'causa', (SELECT 'Maior: ' || (x->>'nome') || ' (' || (x->>'valor') || ')' FROM jsonb_array_elements(partes) x
                                       WHERE (x->>'valor')::numeric > 0 ORDER BY (x->>'valor')::numeric DESC LIMIT 1));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'identificar', i.identificar, 'regra', i.regra, 'fonte', i.fonte, 'unidade', i.unidade,
    'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'periodicidade', i.periodicidade,
    'responsavel', coalesce(r->>'responsavel', i.responsavel), 'pai', i.pai, 'na_tv', i.na_tv, 'ordem', i.ordem,
    'parametro', i.parametro, 'parametro_rotulo', i.parametro_rotulo, 'espelho_de', i.espelho_de,
    'resultado', coalesce(r, '{}'::jsonb) - 'responsavel');
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_resultado(p_codigo text, p_nivel integer)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_resultado(p_codigo text, p_nivel integer) TO service_role;

-- public.tvg_tempo_de_casa(p_dias numeric)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_tempo_de_casa(p_dias numeric)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE d int; mt int; a int; m int; sa text := ''; sm text := '';
BEGIN
  IF p_dias IS NULL THEN RETURN '—'; END IF;
  d := round(p_dias);
  IF d < 60 THEN RETURN d || ' dia' || CASE WHEN d = 1 THEN '' ELSE 's' END; END IF;
  mt := floor(d / 30.4375); a := mt / 12; m := mt % 12;
  IF a > 0 THEN sa := a || ' ano' || CASE WHEN a > 1 THEN 's' ELSE '' END; END IF;
  IF m > 0 THEN sm := m || ' ' || CASE WHEN m > 1 THEN 'meses' ELSE 'mês' END; END IF;
  RETURN coalesce(nullif(concat_ws(' e ', nullif(sa, ''), nullif(sm, '')), ''), '1 ano');
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_tempo_de_casa(p_dias numeric)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_tempo_de_casa(p_dias numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_tempo_de_casa(p_dias numeric) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_tendencia(p_painel text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_tendencia(p_painel text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ini  date := (date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date) - interval '11 months')::date;
  r jsonb;
BEGIN
  -- TV que espelha um relatório: a tendência é o gráfico mês a mês da tela (mig 20261014000030).
  r := public.tvg_espelho_tendencia(p_painel);
  IF r IS NOT NULL THEN RETURN r; END IF;
  BEGIN
    IF p_painel IN ('ger-operacional', 'ger-rh') THEN
      WITH e AS (SELECT public.rh_data(e."Admissão"::text) AS adm,
                        CASE WHEN e."Situação" = 'Demitido' THEN public.rh_data(e."Data Afastamento"::text) END AS dem
                   FROM public."EMPREGADOS" e)
      SELECT jsonb_build_object('titulo', 'Admissões × demissões por mês', 'series', jsonb_build_array('Admissões', 'Demissões'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE adm >= g AND adm < g + interval '1 month'),
                   'b', (SELECT count(*) FROM e WHERE dem >= g AND dem < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-licitacoes' THEN
      SELECT jsonb_build_object('titulo', 'Sessões de licitação por mês: ganhas × disputadas', 'series', jsonb_build_array('Ganhas', 'Disputadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text = 'Finalizada' AND x.posicao = 1),
                   'b', (SELECT count(*) FROM public.grade x WHERE x.data >= g AND x.data < g + interval '1 month' AND x.fase::text NOT IN ('Não Participado', 'Revogado'))) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-supply' THEN
      -- Igual ao Dashboard de Compras, "Movimentação de Estoque (Entradas x Saídas)": HAGG, de janeiro até hoje (mig 20261014000029).
      SELECT jsonb_build_object('titulo', 'Movimentação de estoque: entradas × saídas', 'series', jsonb_build_array('Entradas', 'Saídas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT COALESCE(sum(m.quantidade), 0) FROM public.sup_estoque_movimento m
                           JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id AND ei.arquivado_em IS NULL
                          WHERE m.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                            AND m.tipo IN ('entrada', 'devolucao') AND m.created_at >= g AND m.created_at < g + interval '1 month'),
                   'b', (SELECT COALESCE(sum(abs(m.quantidade)), 0) FROM public.sup_estoque_movimento m
                           JOIN public.sup_estoque_item ei ON ei.id = m.item_estoque_id AND ei.arquivado_em IS NULL
                          WHERE m.empresa_id = (SELECT id FROM public.empresas WHERE nome_fantasia = 'HAGG' LIMIT 1)
                            AND m.tipo IN ('saida', 'remocao') AND m.created_at >= g AND m.created_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(date_trunc('year', hoje)::date, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-frota' THEN
      SELECT jsonb_build_object('titulo', 'Uso da frota por mês: viagens × km rodado (÷ 100)', 'series', jsonb_build_array('Viagens', 'Km ÷ 100'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public.cs_veiculo_agendamento a WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND coalesce(a.status, '') NOT ILIKE '%cancel%'),
                   'b', (SELECT round(coalesce(sum(a.km_final - a.km_inicial), 0) / 100.0) FROM public.cs_veiculo_agendamento a
                          WHERE a.data_inicio >= g AND a.data_inicio < g + interval '1 month' AND a.km_final >= a.km_inicial)) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-recrutamento' THEN
      SELECT jsonb_build_object('titulo', 'Vagas por mês: solicitadas × contratadas', 'series', jsonb_build_array('Solicitadas', 'Contratadas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s WHERE s.created_at >= g AND s.created_at < g + interval '1 month'),
                   'b', (SELECT coalesce(sum(greatest(coalesce(s.quantidade_vagas, 1), 1)), 0) FROM public."SISTEMA_RECRUTAMENTO" s
                          WHERE (s.status IN ('Contratado', 'Concluída') OR s.status LIKE 'Concluído%') AND s.status_changed_at >= g AND s.status_changed_at < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-sst' THEN
      WITH e AS (SELECT public.rh_data(e."Data Afastamento"::text) AS afa FROM public."EMPREGADOS" e WHERE e."Situação" NOT IN ('Demitido', 'Trabalhando', 'Férias')),
      d AS (SELECT coalesce(s.data_solicitacao, s.criado_em::date) AS dia FROM public."SISTEMA_SOLICITACOES_DEMISSAO" s)
      SELECT jsonb_build_object('titulo', 'Por mês: afastamentos iniciados × demissionais solicitados', 'series', jsonb_build_array('Afastamentos', 'Demissionais'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM e WHERE afa >= g AND afa < g + interval '1 month'),
                   'b', (SELECT count(*) FROM d WHERE dia >= g AND dia < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-treinamento' THEN
      SELECT jsonb_build_object('titulo', 'Plataforma por mês: matrículas × certificados', 'series', jsonb_build_array('Matrículas', 'Certificados'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."TRN_MATRICULA" m WHERE m.inscrito_em >= g AND m.inscrito_em < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."TRN_CERTIFICADO" c WHERE c.emitido_em >= g AND c.emitido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-financeiro' THEN
      SELECT jsonb_build_object('titulo', 'Por mês: faturado (NF emitida) × recebido', 'series', jsonb_build_array('Faturado', 'Recebido'), 'unidade', 'brl',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT round(coalesce(sum(n.vlr_liquido_total), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.status::text <> 'cancelada' AND n.data_emissao >= g AND n.data_emissao < g + interval '1 month'),
                   'b', (SELECT round(coalesce(sum(coalesce(n.valor_pago, n.vlr_liquido_total)), 0)) FROM public.nf_emissao n WHERE n.deleted_at IS NULL AND n.data_pagamento >= g AND n.data_pagamento < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel = 'ger-juridico' THEN
      SELECT jsonb_build_object('titulo', 'Notificações do cliente por mês: recebidas × encerradas', 'series', jsonb_build_array('Recebidas', 'Encerradas'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE coalesce(n.data_recebimento, n.created_at::date) >= g AND coalesce(n.data_recebimento, n.created_at::date) < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."JUR_NOTIFICACOES" n WHERE n.encerrada_em >= g AND n.encerrada_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    ELSIF p_painel IN ('ger-controladoria', 'ger-presidencia') THEN
      r := public.tvg_tendencia_dre();  -- mig 20261014000011 (DRE em cache)
    ELSIF p_painel = 'ger-ti' THEN
      SELECT jsonb_build_object('titulo', 'Chamados de sistemas por mês: abertos × concluídos', 'series', jsonb_build_array('Abertos', 'Concluídos'), 'unidade', 'qtd',
        'meses', jsonb_agg(jsonb_build_object('mes', to_char(g, 'MM/YY'),
                   'a', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.created_at >= g AND c.created_at < g + interval '1 month'),
                   'b', (SELECT count(*) FROM public."CHAMADO_SISTEMA" c WHERE c.concluido_em >= g AND c.concluido_em < g + interval '1 month')) ORDER BY g))
        INTO r FROM generate_series(ini, hoje, interval '1 month') g;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    r := jsonb_build_object('erro', SQLERRM);
  END;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_tendencia(p_painel text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_tendencia(p_painel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_tendencia(p_painel text) TO service_role;

-- public.tvg_tendencia_dre()
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_tendencia_dre()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_comp text := public.tvg_dre_competencia(); r jsonb;
BEGIN
  WITH d AS (SELECT competencia, sum(receita) rec, sum(coalesce(custo, 0)) + sum(coalesce(despesa, 0)) cus
               FROM public.tvg_dre_contratos() GROUP BY 1)
  SELECT jsonb_build_object('titulo', 'DRE gerencial por competência: receita × custo + despesa', 'series', jsonb_build_array('Receita', 'Custo + despesa'), 'unidade', 'brl',
    'meses', COALESCE(jsonb_agg(jsonb_build_object('mes', to_char(to_date(competencia, 'YYYY-MM'), 'MM/YY'), 'a', round(coalesce(rec, 0)), 'b', round(coalesce(cus, 0))) ORDER BY competencia), '[]'::jsonb))
    INTO r FROM (SELECT * FROM d WHERE coalesce(rec, 0) > 0 AND competencia <= v_comp ORDER BY competencia DESC LIMIT 12) z;
  RETURN r;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_tendencia_dre()';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_tendencia_dre() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_tendencia_dre() TO service_role;

-- public.tvg_trecho_calculo(p_funcao text, p_codigo text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_trecho_calculo(p_funcao text, p_codigo text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  src text; partes text[]; p text; achado text := '';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
   WHERE p.proname = p_funcao AND p.pronamespace = 'public'::regnamespace LIMIT 1;
  IF src IS NULL THEN RETURN NULL; END IF;
  -- Cada ramo começa em "IF p_codigo" ou "ELSIF p_codigo".
  partes := regexp_split_to_array(src, E'\\n\\s*(?=(ELS)?IF p_codigo )');
  -- Junta todos os ramos que citam o código: o bloco de fora (que prepara
  -- variáveis, ex. a competência do DRE) e o de dentro (que faz a conta).
  FOREACH p IN ARRAY partes LOOP
    IF split_part(p, E'\n', 1) ~ ('''' || p_codigo || '''') THEN
      achado := achado || E'\n' || p;
    END IF;
  END LOOP;
  RETURN nullif(left(btrim(achado), 7000), '');
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_trecho_calculo(p_funcao text, p_codigo text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_trecho_calculo(p_funcao text, p_codigo text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_trecho_calculo(p_funcao text, p_codigo text) TO service_role;

-- public.tvg_valor_painel_lic(v text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_valor_painel_lic(v text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN v IS NULL OR v = '' THEN 0
              WHEN regexp_replace(v, '[R$\s]', '', 'g') LIKE '%,%'
                THEN public.tvg_js_parsefloat(replace(replace(regexp_replace(v, '[R$\s]', '', 'g'), '.', ''), ',', '.'))
              ELSE public.tvg_js_parsefloat(regexp_replace(v, '[R$\s]', '', 'g')) END;
$function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_valor_painel_lic(v text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_valor_painel_lic(v text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_valor_painel_lic(v text) TO PUBLIC, anon, authenticated, service_role;

-- public.tvg_valor_texto(p text)
DO $d$ DECLARE s text := $tvgdef$CREATE OR REPLACE FUNCTION public.tvg_valor_texto(p text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t text := regexp_replace(coalesce(p, ''), '[^0-9,.\-]', '', 'g');
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  IF t ~ ',' THEN t := replace(replace(t, '.', ''), ',', '.');
  ELSIF t ~ '\.\d{3}(\.|$)' AND t !~ '\.\d{1,2}$' THEN t := replace(t, '.', '');
  END IF;
  RETURN t::numeric;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $function$$tvgdef$;
BEGIN
  EXECUTE s;
EXCEPTION WHEN invalid_function_definition OR duplicate_function THEN
  -- Assinatura antiga no cluster (nome de parâmetro / retorno diferente): troca.
  EXECUTE 'DROP FUNCTION IF EXISTS public.tvg_valor_texto(p text)';
  EXECUTE s;
END $d$;
REVOKE ALL ON FUNCTION public.tvg_valor_texto(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvg_valor_texto(p text) TO PUBLIC, anon, authenticated, service_role;

-- ── 3. Cadastro do espelho, só onde o cluster ficou para trás ───────────
-- Referência: TVG_PAINEL (com espelho_fonte) e os seus TVG_INDICADOR na
-- Supabase antiga. Painel que já tem espelho_fonte no cluster fica como está:
-- quem mexeu nele depois da virada não perde nada.
DO $cad$
DECLARE
  ref_p jsonb := '[{"slug":"ger-controladoria","espelho_fonte":"plano_acoes","espelho_series":null},{"slug":"ger-financeiro","espelho_fonte":"financeiro","espelho_series":["faturado","recebido"]},{"slug":"ger-frota","espelho_fonte":"frota","espelho_series":["total","realizados"]},{"slug":"ger-juridico","espelho_fonte":"rel:orientacoes","espelho_series":["total","concluidos"]},{"slug":"ger-licitacoes","espelho_fonte":"licitacoes","espelho_series":["processos","valor_mi"]},{"slug":"ger-operacional","espelho_fonte":"turnover","espelho_series":["taxa","meta"]},{"slug":"ger-presidencia","espelho_fonte":"geral","espelho_series":["abertas","concluidas"]},{"slug":"ger-recrutamento","espelho_fonte":"vagas","espelho_series":["solicitadas","contratadas"]},{"slug":"ger-rh","espelho_fonte":"rel:colaboradores","espelho_series":["admitidos","desligados"]},{"slug":"ger-sst","espelho_fonte":"sst","espelho_series":["demissional","admissional"]},{"slug":"ger-ti","espelho_fonte":"chamados","espelho_series":["abertos","entregas"]},{"slug":"ger-treinamento","espelho_fonte":"treinamentos","espelho_series":["acessos","conclusoes"]}]'::jsonb;
  ref_i jsonb := '[{"codigo":"ctl_margem","painel":"ger-controladoria","ordem":1,"nome":"Contratos abaixo da margem mínima","identificar":"Onde a empresa está operando com resultado insuficiente.","regra":"DRE gerencial, última competência: contratos com margem (receita − custo) abaixo do parâmetro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_total","painel":"ger-controladoria","ordem":1,"nome":"Total de ações","identificar":"Total de ações — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Total de ações.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:0","espelho_grafico":"status","espelho_destaque":1},{"codigo":"ctl_desvio","painel":"ger-controladoria","ordem":2,"nome":"Contratos com custo acima da média","identificar":"Qual contrato gastou acima do orçamento e em qual rubrica.","regra":"Custo dos contratos na última competência do DRE × a média das 3 anteriores. Só entram contratos com custo lançado nos 3 meses anteriores (contrato novo ou mês incompleto no DRE não é alta de custo).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_andamento","painel":"ger-controladoria","ordem":2,"nome":"Em andamento","identificar":"Em andamento — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Em andamento.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_a_definir","painel":"ger-controladoria","ordem":3,"nome":"A definir / Não iniciadas","identificar":"A definir / Não iniciadas — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): A definir / Não iniciadas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_vermelhos","painel":"ger-controladoria","ordem":3,"nome":"Contratos vermelhos (no prejuízo)","identificar":"Riscos financeiros, operacionais ou contratuais combinados.","regra":"DRE gerencial, última competência: contratos com custo maior que a receita.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_atrasadas","painel":"ger-controladoria","ordem":4,"nome":"Atrasadas","identificar":"Atrasadas — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Atrasadas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:3","espelho_grafico":"prioridade","espelho_destaque":2},{"codigo":"ctl_planos","painel":"ger-controladoria","ordem":4,"nome":"Planos de ação vencidos","identificar":"Problemas que ainda não foram corrigidos.","regra":"Planos de ação não concluídos com fim planejado já vencido. Detalhe por área.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"10","periodicidade":"diaria","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_nao_atualizados","painel":"ger-controladoria","ordem":5,"nome":"Indicadores não atualizados","identificar":"Setores que não estão entregando informação confiável.","regra":"Indicadores de lançamento manual (das TVs) sem lançamento dentro da periodicidade (diária 2 dias, semanal 8, mensal 35). Detalhe por TV.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"diaria","responsavel":"Controladoria","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_validadas","painel":"ger-controladoria","ordem":5,"nome":"Concluídas validadas","identificar":"Concluídas validadas — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Concluídas validadas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:4","espelho_grafico":"area","espelho_destaque":3},{"codigo":"ctl_pa_aguardando","painel":"ger-controladoria","ordem":6,"nome":"Aguardando validação","identificar":"Aguardando validação — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Aguardando validação.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:5","espelho_grafico":"comite","espelho_destaque":4},{"codigo":"ctl_reincidentes","painel":"ger-controladoria","ordem":6,"nome":"Margem baixa 3 meses seguidos","identificar":"Situações em que o plano de ação não resolveu o problema.","regra":"DRE gerencial: contratos abaixo da margem mínima nas 3 últimas competências.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_pend_evidencia","painel":"ger-controladoria","ordem":7,"nome":"Pend. evidência (legado)","identificar":"Pend. evidência (legado) — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Pend. evidência (legado).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:6","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_planos_concluidos","painel":"ger-controladoria","ordem":7,"nome":"Planos de ação concluídos no mês","identificar":"Os planos de ação entregues no mês.","regra":"Planos de ação concluídos no mês corrente (data de fim real; sem ela, a última atualização). Detalhe por área.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_sem_resp","painel":"ger-controladoria","ordem":8,"nome":"Sem responsável","identificar":"Sem responsável — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Sem responsável.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:7","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_sem_datas","painel":"ger-controladoria","ordem":9,"nome":"Sem datas planejadas","identificar":"Sem datas planejadas — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Sem datas planejadas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:8","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ctl_pa_comites","painel":"ger-controladoria","ordem":10,"nome":"Comitês ativos","identificar":"Comitês ativos — Dashboard do Plano de Ações.","regra":"Igual a Plano de Ações › Dashboard (sem filtro): Comitês ativos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Controladoria","na_tv":true,"ativo":true,"espelho_fonte":"plano_acoes","espelho_item":"kpi:9","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_notas_pendentes","painel":"ger-financeiro","ordem":1,"nome":"Notas pendentes de emissão","identificar":"Serviços prestados que ainda não se transformaram em cobrança.","regra":"Contratos ativos com valor mensal sem NF emitida (enviada ou concluída) na competência cujo prazo já passou: até o dia limite vale a de dois meses atrás; depois, a do mês anterior.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"Faturamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_rs_notas","painel":"ger-financeiro","ordem":1,"nome":"Total de Notas","identificar":"Total de Notas — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Total de Notas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:0","espelho_grafico":"situacao","espelho_destaque":1},{"codigo":"fin_rs_executado","painel":"ger-financeiro","ordem":2,"nome":"Valor Executado","identificar":"Valor Executado — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Executado.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_valor_pendente","painel":"ger-financeiro","ordem":2,"nome":"Valor pendente de faturamento","identificar":"O valor de receita represada.","regra":"Soma do valor mensal (executado, ou contratado) dos contratos das notas pendentes.","fonte":"auto","unidade":"brl","sentido":"menor","meta":"0","alerta":"50000","periodicidade":"diaria","responsavel":"Faturamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_recebimentos","painel":"ger-financeiro","ordem":3,"nome":"Recebimentos previstos x realizados","identificar":"Quanto deveria ter entrado e ainda não foi recebido.","regra":"NFs concluídas que venceram neste mês até hoje (emissão + prazo): % com pagamento registrado. Impacto: o valor líquido que não entrou.","fonte":"auto","unidade":"pct","sentido":"maior","meta":"100","alerta":"90","periodicidade":"diaria","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_rs_faturado","painel":"ger-financeiro","ordem":3,"nome":"Valor Faturado","identificar":"Valor Faturado — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Faturado.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_inadimplencia","painel":"ger-financeiro","ordem":4,"nome":"Inadimplência por faixa","identificar":"Valores em atraso nas faixas de 15, 30, 60, 90 e 120 dias ou mais.","regra":"NFs concluídas sem pagamento, vencidas (emissão + prazo) há 15 dias ou mais. Detalhe pelas faixas do documento; afetado: contratos.","fonte":"auto","unidade":"brl","sentido":"menor","meta":"0","alerta":"100000","periodicidade":"diaria","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_rs_recebido","painel":"ger-financeiro","ordem":4,"nome":"Valor Recebido","identificar":"Valor Recebido — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Recebido.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_fluxo","painel":"ger-financeiro","ordem":5,"nome":"Fluxo de caixa projetado (30 dias)","identificar":"Risco de insuficiência de caixa nos próximos dias.","regra":"NFs emitidas sem baixa com vencimento (emissão + 30 d) na janela − despesas do Malote a pagar na janela. Negativo = falta caixa.","fonte":"auto","unidade":"brl","sentido":"maior","meta":"0","alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_rs_pendente","painel":"ger-financeiro","ordem":5,"nome":"Valor Pendente","identificar":"Valor Pendente — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Valor Pendente.","fonte":"auto","unidade":"brl","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:4","espelho_grafico":"pendencias","espelho_destaque":2},{"codigo":"fin_glosas","painel":"ger-financeiro","ordem":6,"nome":"Glosas, multas e descontos","identificar":"Valores que o cliente deixou de pagar e suas causas.","regra":"Glosas e multas não revertidas + descontos nas NFs depois de emitidas, na janela. A conta vinculada fica de fora: é depósito retido por lei nos contratos públicos e devolvido depois, não dinheiro perdido.","fonte":"auto","unidade":"brl","sentido":"menor","meta":"0","alerta":"10000","periodicidade":"semanal","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fin_rs_descontos","painel":"ger-financeiro","ordem":6,"nome":"Total de Descontos","identificar":"Total de Descontos — Dashboard do Relatório de Serviços.","regra":"Igual a Financeiro › Relatório de Serviços › Dashboard (todas as empresas, sem filtro): Total de Descontos.","fonte":"auto","unidade":"brl","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":true,"ativo":true,"espelho_fonte":"financeiro","espelho_item":"kpi:5","espelho_grafico":"descontos","espelho_destaque":3},{"codigo":"fin_recebido_mes","painel":"ger-financeiro","ordem":7,"nome":"Recebido no mês","identificar":"O que entrou no caixa pelas NFs no mês.","regra":"NFs com data de pagamento no mês corrente (valor pago; sem ele, o líquido da NF). Detalhe por contrato.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_agendamentos","painel":"ger-frota","ordem":1,"nome":"Agendamentos","identificar":"Agendamentos — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Agendamentos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:0","espelho_grafico":"situacao","espelho_destaque":1},{"codigo":"fro_indisponiveis","painel":"ger-frota","ordem":1,"nome":"Veículos indisponíveis","identificar":"Operações afetadas pela falta de veículo.","regra":"Patrimônio categoria veículo, ativo, em manutenção ou marcado como indisponível. Detalhe: veículo e lotação.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"diaria","responsavel":"Frota","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_realizados","painel":"ger-frota","ordem":2,"nome":"Realizados","identificar":"Realizados — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Realizados.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_manutencoes","painel":"ger-frota","ordem":2,"nome":"Manutenções vencidas","identificar":"Veículos e equipamentos com risco de quebra ou acidente.","regra":"Patrimônios em manutenção com a previsão de fim já vencida. Detalhe: dias de atraso.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"diaria","responsavel":"Frota","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_pela_frente","painel":"ger-frota","ordem":3,"nome":"Pela frente","identificar":"Pela frente — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Pela frente.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_documentos","painel":"ger-frota","ordem":3,"nome":"Veículos sem documento anexado","identificar":"Veículos sujeitos a multa ou impedimento de circulação.","regra":"Veículos ativos do patrimônio sem nenhum arquivo (CRLV, apólice…) no cadastro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"semanal","responsavel":"Frota","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_cancelados","painel":"ger-frota","ordem":4,"nome":"Cancelados","identificar":"Cancelados — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Cancelados.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_combustivel","painel":"ger-frota","ordem":4,"nome":"Viagens sem km registrado","identificar":"Desperdício, uso indevido ou possível problema mecânico.","regra":"Sem lançamento de combustível no ERP: viagens com controle de km encerradas sem km inicial/final. O gráfico traz o km por veículo.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Frota","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_dias_uso","painel":"ger-frota","ordem":5,"nome":"Dias de uso","identificar":"Dias de uso — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Dias de uso.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:4","espelho_grafico":"veiculo","espelho_destaque":2},{"codigo":"fro_nao_localizados","painel":"ger-frota","ordem":5,"nome":"Patrimônios sem conferência (180+ dias)","identificar":"Bens sem confirmação física.","regra":"Patrimônios ativos sem atualização nem movimentação há mais de N dias — inventário a conferir.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Patrimônio","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"fro_ag_contratos","painel":"ger-frota","ordem":6,"nome":"Contratos atendidos","identificar":"Contratos atendidos — Dashboard do Agendamento de Veículos.","regra":"Igual a Agendamento de Veículos › Dashboard (período Este ano): Contratos atendidos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Frota","na_tv":true,"ativo":true,"espelho_fonte":"frota","espelho_item":"kpi:5","espelho_grafico":"contratos","espelho_destaque":3},{"codigo":"fro_sem_responsavel","painel":"ger-frota","ordem":6,"nome":"Patrimônios sem responsável","identificar":"Bens sem responsabilização formal.","regra":"Patrimônios ativos sem contrato, sem posto e sem lotação informados. Detalhe por categoria.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"semanal","responsavel":"Patrimônio","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_or_total","painel":"ger-juridico","ordem":1,"nome":"Total no período","identificar":"Orientações jurídicas pedidas no período.","regra":"Igual a Relatórios › Orientações Jurídicas (12 meses): total de dúvidas enviadas ao Jurídico.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":true,"ativo":true,"espelho_fonte":"rel:orientacoes","espelho_item":"kpi:0","espelho_grafico":"ranking:0","espelho_destaque":2},{"codigo":"jur_prazos","painel":"ger-juridico","ordem":1,"nome":"Prazos jurídicos próximos ou vencidos","identificar":"Risco de perda de prazo.","regra":"Notificações em aberto com prazo de defesa vencido ou nos próximos N dias.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_or_andamento","painel":"ger-juridico","ordem":2,"nome":"Em andamento","identificar":"Orientações ainda não concluídas.","regra":"Igual a Relatórios › Orientações Jurídicas: ainda não concluídas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":true,"ativo":true,"espelho_fonte":"rel:orientacoes","espelho_item":"kpi:1","espelho_grafico":"status","espelho_destaque":1},{"codigo":"jur_sem_resposta","painel":"ger-juridico","ordem":2,"nome":"Notificações sem resposta","identificar":"Clientes ou órgãos que aguardam manifestação.","regra":"Notificações nas etapas \"Recebida\" ou \"Em análise\" (ainda sem defesa protocolada).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_audiencias","painel":"ger-juridico","ordem":3,"nome":"Audiências próximas","identificar":"Providências e documentos que precisam ser preparados.","regra":"Processos em andamento com audiência (designada, primeira ou de instrução) ou perícia nos próximos N dias.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_or_concluidas","painel":"ger-juridico","ordem":3,"nome":"Concluídas","identificar":"Orientações respondidas.","regra":"Igual a Relatórios › Orientações Jurídicas: concluídas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":true,"ativo":true,"espelho_fonte":"rel:orientacoes","espelho_item":"kpi:2","espelho_grafico":"ranking:1","espelho_destaque":3},{"codigo":"jur_contratos_analise","painel":"ger-juridico","ordem":4,"nome":"Medidas preventivas vencidas","identificar":"Operações que aguardam validação jurídica.","regra":"Notificações com medida preventiva definida, prazo vencido e não concluída.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"semanal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_or_recusadas","painel":"ger-juridico","ordem":4,"nome":"Recusadas / canceladas","identificar":"Orientações recusadas ou canceladas.","regra":"Igual a Relatórios › Orientações Jurídicas: recusadas ou canceladas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":true,"ativo":true,"espelho_fonte":"rel:orientacoes","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_or_tempo","painel":"ger-juridico","ordem":5,"nome":"Tempo médio até concluir","identificar":"Da abertura à conclusão.","regra":"Igual a Relatórios › Orientações Jurídicas: média de dias da abertura à conclusão.","fonte":"auto","unidade":"dias","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Jurídico","na_tv":true,"ativo":true,"espelho_fonte":"rel:orientacoes","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_risco","painel":"ger-juridico","ordem":5,"nome":"Processos de alto valor","identificar":"Exposição financeira relevante.","regra":"Processos em andamento com valor dos pedidos (ou da causa) a partir do parâmetro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_reincidentes","painel":"ger-juridico","ordem":6,"nome":"Causas trabalhistas reincidentes","identificar":"Falhas internas que estejam gerando processos repetidos.","regra":"Processos em andamento: motivos (pedidos) que aparecem em N ou mais processos. Causa: o motivo mais repetido.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_valor_condenacao","painel":"ger-juridico","ordem":20,"nome":"Valor de sentenças em andamento","identificar":"Subindicador jurídico.","regra":"Soma do valor de sentença dos processos em andamento.","fonte":"auto","unidade":"brl","sentido":"menor","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_valor_acordo","painel":"ger-juridico","ordem":21,"nome":"Valor de acordos","identificar":"Subindicador jurídico.","regra":"Soma do valor de acordo dos processos em andamento.","fonte":"auto","unidade":"brl","sentido":"menor","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"jur_multas_revertidas","painel":"ger-juridico","ordem":22,"nome":"Multas descontadas e revertidas","identificar":"Multas/glosas descontadas no Financeiro e revertidas pelo Jurídico.","regra":"Notificações com resultado \"Revertida\" (total ou parcial) desfechadas na janela: valor original menos o final.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Jurídico","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_valor_participado","painel":"ger-licitacoes","ordem":1,"nome":"Valor total participado","identificar":"Valor total participado — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Valor total participado.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:0","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_prazo","painel":"ger-licitacoes","ordem":1,"nome":"Licitações estratégicas com prazo próximo","identificar":"Oportunidades que exigem decisão, documentação ou atuação imediata.","regra":"Grade de licitações: processos ainda \"À Iniciar\" ou \"Iniciado\" com sessão de hoje até N dias. Detalhe: edital, cidade e dias até a sessão.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_documentos","painel":"ger-licitacoes","ordem":2,"nome":"Editais sem capa preenchida","identificar":"Risco de impedimento ou desclassificação por documento inválido ou ausente.","regra":"Licitações com sessão nos próximos N dias e sem a capa do edital (documentação e requisitos) no ERP.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"semanal","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_taxa_vitoria","painel":"ger-licitacoes","ordem":2,"nome":"Taxa de vitória","identificar":"Taxa de vitória — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Taxa de vitória.","fonte":"auto","unidade":"pct","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_contratos_ganhos","painel":"ger-licitacoes","ordem":3,"nome":"Contratos ganhos","identificar":"Contratos ganhos — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Contratos ganhos.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_propostas","painel":"ger-licitacoes","ordem":3,"nome":"Propostas em elaboração x concluídas","identificar":"Se todas as propostas programadas serão entregues dentro do prazo.","regra":"Processos ativos com sessão nos próximos N dias: % já \"Em Andamento\" (proposta pronta) sobre o total. \"À Iniciar\" e \"Iniciado\" contam como em elaboração.","fonte":"auto","unidade":"pct","sentido":"maior","meta":"100","alerta":"80","periodicidade":"diaria","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_pessoas_ganhos","painel":"ger-licitacoes","ordem":4,"nome":"Pessoas nos contratos ganhos","identificar":"Pessoas nos contratos ganhos — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Pessoas nos contratos ganhos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_risco","painel":"ger-licitacoes","ordem":4,"nome":"Licitações suspensas ou revogadas","identificar":"Falhas técnicas, documentais, jurídicas ou de preço.","regra":"Grade de licitações: suspensas/revogadas na janela do parâmetro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_implantacao","painel":"ger-licitacoes","ordem":5,"nome":"Licitações vencidas aguardando implantação","identificar":"Novos contratos ainda não formalmente repassados aos setores responsáveis.","regra":"Grade: processos Finalizados em 1º lugar na janela que ainda não têm Implantação de Contrato (pela capa) nem contrato cadastrado ligado à grade.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"diaria","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_alertas","painel":"ger-licitacoes","ordem":5,"nome":"Alertas de abertura (7 dias)","identificar":"Alertas de abertura (7 dias) — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Alertas de abertura (7 dias).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:4","espelho_grafico":"alertas","espelho_destaque":1},{"codigo":"lic_p_lidos","painel":"ger-licitacoes","ordem":6,"nome":"Editais lidos","identificar":"Editais lidos — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais lidos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:5","espelho_grafico":"faixa","espelho_destaque":3},{"codigo":"lic_perdidas","painel":"ger-licitacoes","ordem":6,"nome":"Licitações perdidas e principal motivo","identificar":"Perdas por preço, documentação, requisito técnico, prazo ou decisão de não participar.","regra":"Grade: processos Finalizados fora do 1º lugar atualizados na janela. Motivo: a observação de status da grade (sem observação = \"motivo não registrado\").","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_participados","painel":"ger-licitacoes","ordem":7,"nome":"Editais participados","identificar":"Editais participados — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais participados.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:6","espelho_grafico":"fase","espelho_destaque":2},{"codigo":"lic_valor","painel":"ger-licitacoes","ordem":7,"nome":"Valor potencial das propostas em andamento","identificar":"A receita em disputa e os processos de maior relevância estratégica.","regra":"Soma do valor global da grade dos processos À Iniciar, Iniciado e Em Andamento (mesma leitura do Painel Executivo). Detalhe: os maiores.","fonte":"auto","unidade":"brl","sentido":"maior","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_ganhas","painel":"ger-licitacoes","ordem":8,"nome":"Licitações ganhas","identificar":"Licitações em que a empresa ficou em 1º lugar.","regra":"Licitações finalizadas em 1º lugar na janela (padrão 90 dias), na grade de Licitações. Impacto: o valor global somado.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Licitações","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_nao_participados","painel":"ger-licitacoes","ordem":8,"nome":"Editais não participados","identificar":"Editais não participados — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais não participados.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:7","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_suspensos","painel":"ger-licitacoes","ordem":9,"nome":"Editais suspensos","identificar":"Editais suspensos — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais suspensos.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:8","espelho_grafico":null,"espelho_destaque":null},{"codigo":"lic_p_revogados","painel":"ger-licitacoes","ordem":10,"nome":"Editais revogados","identificar":"Editais revogados — Painel Executivo de Licitações.","regra":"Igual a Licitações › Painel Executivo (Grupo — todas as empresas, sem filtro): Editais revogados.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Licitações","na_tv":true,"ativo":true,"espelho_fonte":"licitacoes","espelho_item":"kpi:9","espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_postos","painel":"ger-operacional","ordem":1,"nome":"Postos contratados x cobertos","identificar":"Contratos nos quais a empresa não está entregando o quantitativo de postos vendido.","regra":"Por contrato ativo: postos contratados (cadastro do contrato, \"funcionários estipulados\") menos colaboradores com situação Trabalhando na folha (Senior). Soma só a falta. Causa: o que explica a falta — afastamentos, férias ou quadro incompleto. Contratos sem vínculo com a folha não entram.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_geral","painel":"ger-operacional","ordem":1,"nome":"Turnover geral do ano","identificar":"Turnover geral do ano — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Turnover geral do ano.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"41","alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:0","espelho_grafico":"contrato","espelho_destaque":1},{"codigo":"op_lucratividade","painel":"ger-operacional","ordem":2,"nome":"Lucratividade por contrato (%)","identificar":"Contratos com prejuízo ou margem abaixo da prevista na licitação.","regra":"DRE gerencial, última competência com receita: (receita − custo) ÷ receita. O gráfico mostra os contratos de menor margem.","fonte":"auto","unidade":"pct","sentido":"maior","meta":"10","alerta":"5","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_projecao","painel":"ger-operacional","ordem":2,"nome":"Projeção para o ano","identificar":"Projeção para o ano — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Projeção para o ano.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"41","alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_custo_direto","painel":"ger-operacional","ordem":3,"nome":"Variação do custo direto (%)","identificar":"Onde mão de obra, benefícios, insumos ou demais custos diretos ultrapassaram o orçamento.","regra":"Custo dos contratos na última competência do DRE × a média das 3 anteriores. Só entram contratos com custo lançado nos 3 meses anteriores (contrato novo ou mês incompleto no DRE não é alta de custo).","fonte":"auto","unidade":"pct","sentido":"menor","meta":"0","alerta":"5","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_mes","painel":"ger-operacional","ordem":3,"nome":"Turnover do último mês fechado","identificar":"Turnover do último mês fechado — Relatórios › Turnover (o mês corrente vai na dica).","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Turnover do mês.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"3.42","alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_glosas","painel":"ger-operacional","ordem":4,"nome":"Glosas por contrato","identificar":"O valor perdido, o contrato afetado e a principal causa.","regra":"Notificações do Jurídico do tipo Glosa recebidas na janela (não revertidas): valor final (ou original, se ainda sem desfecho). Causa: a causa-raiz / assunto de maior valor.","fonte":"auto","unidade":"brl","sentido":"menor","meta":"0","alerta":"5000","periodicidade":"semanal","responsavel":"Operação","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_rescisoes","painel":"ger-operacional","ordem":4,"nome":"Rescisões no período","identificar":"Rescisões no período — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Rescisões no período.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:4","espelho_grafico":"faixa","espelho_destaque":2},{"codigo":"op_faltas","painel":"ger-operacional","ordem":5,"nome":"Atestados e faltas por contrato (%)","identificar":"Onde as ausências comprometem a cobertura e elevam o custo operacional.","regra":"Colaboradores ativos hoje em atestado/falta (situação na folha Senior) ÷ ativos do contrato.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"2","alerta":"4","periodicidade":"semanal","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_casa_medio","painel":"ger-operacional","ordem":5,"nome":"Tempo de casa médio","identificar":"Tempo de casa médio — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Tempo de casa médio.","fonte":"auto","unidade":"dias","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:5","espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_casa_mediano","painel":"ger-operacional","ordem":6,"nome":"Tempo de casa mediano","identificar":"Tempo de casa mediano — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Tempo de casa mediano.","fonte":"auto","unidade":"dias","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:6","espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_turnover","painel":"ger-operacional","ordem":6,"nome":"Turnover no ano (%)","identificar":"Contratos com equipes instáveis e reposições frequentes.","regra":"Igual a Relatórios › Turnover: soma das taxas mensais do ano corrente (demissões ÷ efetivo no fim do mês), todas as causas de desligamento. Meta: 41% no ano (3,42% ao mês). Por contrato: demissões ÷ efetivo médio do contrato no ano.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"41","alerta":null,"periodicidade":"mensal","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_reclamacoes","painel":"ger-operacional","ordem":7,"nome":"Reclamações e notificações do cliente","identificar":"Contratos com risco de desgaste, penalidade ou perda do cliente.","regra":"Notificações do cliente que não são glosa/multa (Jurídico › Notificações), na janela de dias do parâmetro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"semanal","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_t_ate3","painel":"ger-operacional","ordem":7,"nome":"Saíram com até 3 meses","identificar":"Saíram com até 3 meses — Relatórios › Turnover.","regra":"Igual a Relatórios › Turnover (Resumo e Turnover em Valores, ano corrente, todos os meses e causas): Saíram com até 3 meses.","fonte":"auto","unidade":"pct","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":true,"ativo":true,"espelho_fonte":"turnover","espelho_item":"kpi:7","espelho_grafico":"causa","espelho_destaque":3},{"codigo":"op_satisfacao_colab","painel":"ger-operacional","ordem":20,"nome":"Satisfação dos colaboradores","identificar":"Clima das equipes por contrato.","regra":"Subindicador (fica no sistema, não ocupa a TV). Lançado a partir da pesquisa de satisfação.","fonte":"auto","unidade":"pct","sentido":"maior","meta":"80","alerta":"70","periodicidade":"mensal","responsavel":"Gerência Operacional","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_feedbacks","painel":"ger-operacional","ordem":21,"nome":"Feedbacks em atraso","identificar":"Feedbacks combinados e não realizados.","regra":"Subindicador. Lançado pela Operação.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"mensal","responsavel":"Gerência Operacional","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_experiencia","painel":"ger-operacional","ordem":22,"nome":"Contratos de experiência vencendo","identificar":"Cruzamento entre pesquisa de satisfação, feedback e tempo de trabalho.","regra":"Espelho de RH › Contratos de experiência vencendo.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"op_contratos_saudaveis","painel":"ger-operacional","ordem":23,"nome":"Contratos com margem saudável","identificar":"Contratos que estão dando o resultado esperado.","regra":"Contratos com margem igual ou acima do parâmetro (padrão 10%) na última competência do DRE gerencial, entre os com receita de R$ 10 mil ou mais.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_recrutamento","painel":"ger-presidencia","ordem":1,"nome":"Gestão Recrutamento","identificar":"Gestão Recrutamento — cartão do Relatório Geral.","regra":"Igual ao cartão Gestão Recrutamento de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:0","espelho_grafico":"sistemas","espelho_destaque":1},{"codigo":"pre_lucratividade","painel":"ger-presidencia","ordem":1,"nome":"Lucratividade geral e por contrato (%)","identificar":"Onde a empresa ganha e perde dinheiro.","regra":"O mesmo número da Gerência Operacional.","fonte":"espelho","unidade":"pct","sentido":"maior","meta":"10","alerta":"5","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_demissoes","painel":"ger-presidencia","ordem":2,"nome":"Demissões","identificar":"Demissões — cartão do Relatório Geral.","regra":"Igual ao cartão Demissões de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_vermelhos","painel":"ger-presidencia","ordem":2,"nome":"Contratos vermelhos","identificar":"Contratos que exigem decisão da alta liderança.","regra":"O mesmo número da Controladoria.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_materiais","painel":"ger-presidencia","ordem":3,"nome":"Materiais","identificar":"Materiais — cartão do Relatório Geral.","regra":"Igual ao cartão Materiais de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:2","espelho_grafico":"tempo","espelho_destaque":2},{"codigo":"pre_postos","painel":"ger-presidencia","ordem":3,"nome":"Postos contratados x cobertos","identificar":"Se a empresa está entregando o que vendeu.","regra":"O mesmo número da Gerência Operacional.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"diaria","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_ferias","painel":"ger-presidencia","ordem":4,"nome":"Férias","identificar":"Férias — cartão do Relatório Geral.","regra":"Igual ao cartão Férias de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_glosas","painel":"ger-presidencia","ordem":4,"nome":"Glosas, multas e descontos","identificar":"Quanto de receita foi perdido ou bloqueado.","regra":"O mesmo número do Financeiro.","fonte":"espelho","unidade":"brl","sentido":"menor","meta":"0","alerta":"10000","periodicidade":"semanal","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_medida","painel":"ger-presidencia","ordem":5,"nome":"Medida Disciplinar","identificar":"Medida Disciplinar — cartão do Relatório Geral.","regra":"Igual ao cartão Medida Disciplinar de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_salarios","painel":"ger-presidencia","ordem":5,"nome":"Folha sobre o faturamento (%)","identificar":"Onde os custos de pessoas estão consumindo a margem.","regra":"Espelho de RH › Folha sobre o faturamento do contrato.","fonte":"espelho","unidade":"pct","sentido":"menor","meta":"60","alerta":"70","periodicidade":"mensal","responsavel":"RH","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_caixa","painel":"ger-presidencia","ordem":6,"nome":"Notas pendentes e inadimplência","identificar":"Quanto dinheiro deveria estar no caixa e ainda não está.","regra":"Valor pendente de faturamento + inadimplência (TV Financeira).","fonte":"soma","unidade":"brl","sentido":"menor","meta":"0","alerta":"150000","periodicidade":"diaria","responsavel":"Financeiro","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_chamados","painel":"ger-presidencia","ordem":6,"nome":"Chamados","identificar":"Chamados — cartão do Relatório Geral.","regra":"Igual ao cartão Chamados de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:5","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_clientes","painel":"ger-presidencia","ordem":7,"nome":"Reclamações do cliente","identificar":"Contratos sob risco comercial.","regra":"Espelho de Operação › Reclamações e notificações do cliente.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"semanal","responsavel":"Gerência Operacional","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_orientacoes","painel":"ger-presidencia","ordem":7,"nome":"Orientações Jurídicas","identificar":"Orientações Jurídicas — cartão do Relatório Geral.","regra":"Igual ao cartão Orientações Jurídicas de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:6","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_mudanca","painel":"ger-presidencia","ordem":8,"nome":"Mudança de Função","identificar":"Mudança de Função — cartão do Relatório Geral.","regra":"Igual ao cartão Mudança de Função de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:7","espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_planos","painel":"ger-presidencia","ordem":8,"nome":"Planos de ação vencidos","identificar":"Problemas que continuam sem solução.","regra":"O mesmo número da Controladoria.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":"0","alerta":"10","periodicidade":"diaria","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_contratos_saudaveis","painel":"ger-presidencia","ordem":9,"nome":"Contratos com margem saudável","identificar":"Contratos que estão dando o resultado esperado.","regra":null,"fonte":"espelho","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Controladoria","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"pre_g_colaboradores","painel":"ger-presidencia","ordem":9,"nome":"Colaboradores","identificar":"Colaboradores — cartão do Relatório Geral.","regra":"Igual ao cartão Colaboradores de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:8","espelho_grafico":"quadro","espelho_destaque":3},{"codigo":"pre_g_turnover","painel":"ger-presidencia","ordem":10,"nome":"Turn-over","identificar":"Turn-over — cartão do Relatório Geral.","regra":"Igual ao cartão Turn-over de Relatórios › Relatório Geral (12 meses).","fonte":"auto","unidade":"pct","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Presidência","na_tv":true,"ativo":true,"espelho_fonte":"geral","espelho_item":"kpi:9","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_risco","painel":"ger-recrutamento","ordem":1,"nome":"Vagas com risco de posto descoberto","identificar":"Vagas que precisam ser preenchidas imediatamente para evitar falha contratual.","regra":"Vagas com urgência alta abertas há mais tempo que o parâmetro (padrão 15 dias). \"Alta — Urgente\" sozinha não é risco: é o padrão da maioria das vagas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_solicitadas","painel":"ger-recrutamento","ordem":1,"nome":"Vagas solicitadas","identificar":"Vagas pedidas no período.","regra":"Igual a Relatórios › Vagas — Dashboard (12 meses): vagas solicitadas no período.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:0","espelho_grafico":"funil","espelho_destaque":1},{"codigo":"rec_abertas","painel":"ger-recrutamento","ordem":2,"nome":"Vagas abertas por contrato e cidade","identificar":"Onde está concentrado o problema de contratação.","regra":"Total de vagas abertas. Detalhe por contrato e cidade.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_contratadas","painel":"ger-recrutamento","ordem":2,"nome":"Contratadas","identificar":"Vagas do período que chegaram a Contratado.","regra":"Igual a Vagas — Dashboard: vagas do período contratadas (Contratado ou Concluído).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_prazo","painel":"ger-recrutamento","ordem":3,"nome":"Vagas acima do prazo de preenchimento","identificar":"Processos que estão demorando além do prazo aceitável.","regra":"Vagas abertas há mais que o prazo (desde a abertura da solicitação).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_reprovadas","painel":"ger-recrutamento","ordem":3,"nome":"Reprovadas / canceladas","identificar":"Vagas do período reprovadas ou canceladas.","regra":"Igual a Vagas — Dashboard: vagas do período reprovadas ou canceladas.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:2","espelho_grafico":"desfecho","espelho_destaque":2},{"codigo":"rec_admissoes","painel":"ger-recrutamento","ordem":4,"nome":"Admissões previstas x concluídas","identificar":"Se o setor entregará as pessoas necessárias na data combinada.","regra":"Vagas com início previsto no mês até hoje (sem as reprovadas): % já Contratadas ou Concluídas.","fonte":"auto","unidade":"pct","sentido":"maior","meta":"100","alerta":"85","periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_abertas","painel":"ger-recrutamento","ordem":4,"nome":"Em aberto agora","identificar":"Todas as vagas abertas hoje.","regra":"Igual a Vagas — Dashboard: todas as vagas em andamento agora (inclui as pedidas antes do período).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:3","espelho_grafico":"aging","espelho_destaque":3},{"codigo":"rec_desistencias","painel":"ger-recrutamento","ordem":5,"nome":"Desistências antes da admissão","identificar":"Cidades, salários ou etapas do processo que afastam candidatos.","regra":"Histórico do recrutamento: candidatos marcados como \"desistiu\" na janela. Detalhe por cidade; causa: a etapa onde mais desistem.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"semanal","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_tempo","painel":"ger-recrutamento","ordem":5,"nome":"Tempo médio até contratar","identificar":"Do pedido ao Contratado.","regra":"Igual a Vagas — Dashboard: média de dias do pedido até fechar como contratada.","fonte":"auto","unidade":"dias","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_preenchidas","painel":"ger-recrutamento","ordem":6,"nome":"Vagas preenchidas no mês","identificar":"As vagas que o Recrutamento fechou no mês.","regra":"Vagas da Gestão Recrutamento (pela quantidade) que chegaram a Contratado no mês corrente. Detalhe por contrato.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_prazo","painel":"ger-recrutamento","ordem":6,"nome":"Contratadas em até 15 dias","identificar":"Das contratadas, as fechadas em até 15 dias.","regra":"Igual a Vagas — Dashboard: % das contratadas do período fechadas em até 15 dias do pedido.","fonte":"auto","unidade":"pct","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:5","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_aprovacao","painel":"ger-recrutamento","ordem":7,"nome":"Tempo médio de aprovação","identificar":"Pedido → liberado ao Recrutamento.","regra":"Igual a Vagas — Dashboard: média de dias do pedido até sair da aprovação (Operacional/Analista/Diretoria).","fonte":"auto","unidade":"dias","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:6","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_candidatos","painel":"ger-recrutamento","ordem":8,"nome":"Candidatos por vaga","identificar":"Média de currículos por vaga.","regra":"Igual a Vagas — Dashboard: média de candidatos por vaga, só vagas do sistema novo.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:7","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_desistencias","painel":"ger-recrutamento","ordem":9,"nome":"Desistências de candidatos","identificar":"Candidatos que desistiram.","regra":"Igual a Vagas — Dashboard: candidatos que desistiram, nas vagas do período.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:8","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rec_v_antiga","painel":"ger-recrutamento","ordem":10,"nome":"Aberta mais antiga","identificar":"Há quantos dias está aberta a vaga mais antiga.","regra":"Igual a Vagas — Dashboard: dias desde o pedido da vaga aberta mais antiga.","fonte":"auto","unidade":"dias","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":true,"ativo":true,"espelho_fonte":"vagas","espelho_item":"kpi:9","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_col_ativos","painel":"ger-rh","ordem":1,"nome":"Colaboradores ativos","identificar":"O quadro de hoje.","regra":"Igual a Relatórios › Colaboradores: ativos hoje na EMPREGADOS (folha Senior).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":"rel:colaboradores","espelho_item":"kpi:0","espelho_grafico":"ranking:0","espelho_destaque":1},{"codigo":"rh_quadro","painel":"ger-rh","ordem":1,"nome":"Colaboradores ativos x necessários","identificar":"Contratos com excesso ou falta de pessoas.","regra":"Por contrato: colaboradores ativos na folha (todos menos demitidos) menos o quadro contratado. Conta os contratos com diferença acima da tolerância, para mais ou para menos.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"diaria","responsavel":"RH","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_col_trabalhando","painel":"ger-rh","ordem":2,"nome":"Trabalhando","identificar":"Ativos em situação Trabalhando.","regra":"Igual a Relatórios › Colaboradores: ativos com situação Trabalhando.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":"rel:colaboradores","espelho_item":"kpi:1","espelho_grafico":"status","espelho_destaque":2},{"codigo":"rh_salarios","painel":"ger-rh","ordem":2,"nome":"Folha sobre o faturamento do contrato (%)","identificar":"Contratos ou cidades em que o custo de pessoal está consumindo a margem prevista.","regra":"Salário-base dos ativos (folha Senior) ÷ valor mensal contratado. Acima do limite do parâmetro, o contrato entra como afetado.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"60","alerta":"70","periodicidade":"mensal","responsavel":"RH","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_col_afastados","painel":"ger-rh","ordem":3,"nome":"Afastados","identificar":"Auxílio-doença, licença, férias…","regra":"Igual a Relatórios › Colaboradores: ativos fora de Trabalhando (auxílio-doença, licença, férias…).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":"rel:colaboradores","espelho_item":"kpi:2","espelho_grafico":"ranking:1","espelho_destaque":3},{"codigo":"rh_absenteismo","painel":"ger-rh","ordem":4,"nome":"Absenteísmo por contrato (%)","identificar":"Onde faltas e ausências comprometem produtividade, cobertura e custo.","regra":"Colaboradores com atestado ou falta hoje ÷ ativos, por contrato. Auxílio-doença, licença-maternidade e aposentadoria (INSS) são afastamento, não absenteísmo — ficam em SST › Afastamentos.","fonte":"auto","unidade":"pct","sentido":"menor","meta":"3","alerta":"5","periodicidade":"mensal","responsavel":"RH","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_col_admitidos","painel":"ger-rh","ordem":4,"nome":"Admitidos no período","identificar":"Admissões nos 12 meses.","regra":"Igual a Relatórios › Colaboradores: admitidos no período (12 meses).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":"rel:colaboradores","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_col_desligados","painel":"ger-rh","ordem":5,"nome":"Desligados no período","identificar":"Desligamentos nos 12 meses.","regra":"Igual a Relatórios › Colaboradores: desligados no período (12 meses).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":"rel:colaboradores","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_obrigacoes","painel":"ger-rh","ordem":5,"nome":"Obrigações trabalhistas","identificar":"Riscos de pagamento incorreto, multa ou passivo trabalhista.","regra":"Consolidado: soma das pendências dos subindicadores (abrem no detalhe).","fonte":"soma","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"semanal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_turnover","painel":"ger-rh","ordem":6,"nome":"Turnover no ano (%)","identificar":"Contratos com maior perda de colaboradores e necessidade de intervenção.","regra":"O mesmo número da Gerência Operacional.","fonte":"espelho","unidade":"pct","sentido":"menor","meta":"41","alerta":null,"periodicidade":"mensal","responsavel":"RH","na_tv":true,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_folhas","painel":"ger-rh","ordem":10,"nome":"Folhas corrigidas por inconsistência","identificar":"Quantidade, origem do erro e evolução.","regra":"Lançado pelo DP.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"mensal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_rescisoes","painel":"ger-rh","ordem":11,"nome":"Rescisões programadas e pendentes","identificar":"Prazos de conclusão e risco de atraso.","regra":"Solicitações de demissão paradas no fluxo (Operacional, RH ou SST) há mais dias que o parâmetro (padrão 10). As que estão dentro do prazo normal não contam.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"diaria","responsavel":"Departamento Pessoal","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_ferias_vencidas","painel":"ger-rh","ordem":12,"nome":"Férias vencidas","identificar":"Passivo trabalhista já existente.","regra":"Lançado pelo DP (relatório da Senior).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_ferias_vencer","painel":"ger-rh","ordem":13,"nome":"Férias a vencer no próximo mês","identificar":"Necessidade de programação imediata.","regra":"Lançado pelo DP (relatório da Senior).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"10","periodicidade":"mensal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_banco_horas","painel":"ger-rh","ordem":14,"nome":"Banco de horas acima do limite","identificar":"Acúmulo de custo trabalhista.","regra":"Lançado pelo DP.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"mensal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_esocial","painel":"ger-rh","ordem":15,"nome":"Eventos do eSocial rejeitados","identificar":"Pendências que exigem correção, com as que podem gerar multa.","regra":"Lançado pelo DP; marcar na causa os que geram multa.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"semanal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_ob_experiencia","painel":"ger-rh","ordem":16,"nome":"Contratos de experiência vencendo","identificar":"Risco de perda do prazo de avaliação ou desligamento.","regra":"Admitidos que completam 45 ou 90 dias nos próximos dias do parâmetro (folha Senior).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"semanal","responsavel":"Departamento Pessoal","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"rh_preenchidas","painel":"ger-rh","ordem":17,"nome":"Vagas preenchidas no mês","identificar":"As vagas fechadas no mês.","regra":null,"fonte":"espelho","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Recrutamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_adm_pend","painel":"ger-sst","ordem":1,"nome":"ASO admissional pendente","identificar":"ASO admissional pendente — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): ASO admissional pendente.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:0","espelho_grafico":"admissional","espelho_destaque":2},{"codigo":"sst_impedidos","painel":"ger-sst","ordem":1,"nome":"Trabalhadores com impedimento para exercer a função","identificar":"Colaboradores que não podem trabalhar regularmente por falta de requisito legal, médico ou de segurança.","regra":"Definição obrigatória do documento: soma de ASO inapto/vencido, exame pendente, treinamento legal vencido, EPI não entregue, retorno sem liberação e restrição incompatível.","fonte":"soma","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"diaria","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_aso","painel":"ger-sst","ordem":2,"nome":"ASOs pendentes (admissional e demissional)","identificar":"Quem está ou ficará irregular.","regra":"ASOs aguardando o SST (admissional na etapa SST + COMPRAS; demissional pendente) há mais dias que o parâmetro (padrão 5).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_adm_marcado","painel":"ger-sst","ordem":2,"nome":"ASO admissional com exame marcado","identificar":"ASO admissional com exame marcado — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): ASO admissional com exame marcado.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_dem_receber","painel":"ger-sst","ordem":3,"nome":"Demissional a receber","identificar":"Demissional a receber — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional a receber.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:2","espelho_grafico":"demissional","espelho_destaque":1},{"codigo":"sst_treinamentos","painel":"ger-sst","ordem":3,"nome":"Treinamentos obrigatórios vencidos","identificar":"Quem não possui capacitação legal ou contratual válida.","regra":"O mesmo número da TV de Treinamento.","fonte":"espelho","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_epi","painel":"ger-sst","ordem":4,"nome":"Uniformes e EPIs parados no Supply","identificar":"Quem está trabalhando sem proteção adequada.","regra":"Pedidos de uniforme/EPI ainda não despachados além do prazo do parâmetro.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_dem_agendar","painel":"ger-sst","ordem":4,"nome":"Demissional a agendar","identificar":"Demissional a agendar — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional a agendar.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_afastamentos","painel":"ger-sst","ordem":5,"nome":"Afastamentos ativos por contrato","identificar":"Ausências prolongadas que estejam afetando a operação.","regra":"Colaboradores com situação de afastamento na folha (auxílio-doença, licenças, atestados, aposentadoria por invalidez…). Detalhe por contrato; causa: a situação mais comum.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_dem_agendadas","painel":"ger-sst","ordem":5,"nome":"Demissional agendadas","identificar":"Demissional agendadas — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Demissional agendadas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_acidentes","painel":"ger-sst","ordem":6,"nome":"Afastados por acidente","identificar":"Riscos de repetição e necessidade de correção.","regra":"Colaboradores com situação/causa de acidente na folha Senior, hoje.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_f_troca_aguardando","painel":"ger-sst","ordem":6,"nome":"Mudança de função aguardando ASO","identificar":"Mudança de função aguardando ASO — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Mudança de função aguardando ASO.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:5","espelho_grafico":"troca","espelho_destaque":3},{"codigo":"sst_f_troca_concluidas","painel":"ger-sst","ordem":7,"nome":"Mudança de função concluídas","identificar":"Mudança de função concluídas — filas do SST.","regra":"Igual às filas do SST (ASO / Admissão, ASO Demissional, Mudança de Função — ASO): Mudança de função concluídas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":true,"ativo":true,"espelho_fonte":"sst","espelho_item":"kpi:6","espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_aso","painel":"ger-sst","ordem":10,"nome":"ASO pendente","identificar":"Parte do impedimento.","regra":"ASOs aguardando o SST (admissional na etapa SST + COMPRAS; demissional pendente) há mais dias que o parâmetro (padrão 5).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_exame","painel":"ger-sst","ordem":11,"nome":"Exame obrigatório pendente","identificar":"Parte do impedimento.","regra":"Lançado pelo SST.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_treinamento","painel":"ger-sst","ordem":12,"nome":"Treinamento com acesso vencendo","identificar":"Parte do impedimento.","regra":"Igual a Treinamento › Acessos vencendo sem certificado.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_epi","painel":"ger-sst","ordem":13,"nome":"EPI não entregue no prazo","identificar":"Parte do impedimento.","regra":"Igual a SST › Uniformes e EPIs parados.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_retorno","painel":"ger-sst","ordem":14,"nome":"Retorno de afastamento sem liberação","identificar":"Parte do impedimento.","regra":"Lançado pelo SST.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_imp_restricao","painel":"ger-sst","ordem":15,"nome":"Restrição médica incompatível com a função","identificar":"Parte do impedimento.","regra":"Lançado pelo SST.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"semanal","responsavel":"SST","na_tv":false,"ativo":false,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"sst_demissionais","painel":"ger-sst","ordem":16,"nome":"Exames demissionais agendados no mês","identificar":"O que o SST encaminhou no mês.","regra":"Solicitações de demissão em que o SST agendou o exame demissional no mês corrente. Detalhe por contrato.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"SST","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_ch_fila","painel":"ger-ti","ordem":1,"nome":"Na fila","identificar":"Chamados ainda em aberto.","regra":"Igual ao Dashboard de Chamados: chamados não concluídos, reprovados nem cancelados.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:0","espelho_grafico":"categoria","espelho_destaque":1},{"codigo":"ti_indisponiveis","painel":"ger-ti","ordem":1,"nome":"TVs sem sinal","identificar":"Áreas impedidas de trabalhar.","regra":"TVs pareadas sem falar com o ERP há mais de 3 minutos.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"diaria","responsavel":"TI","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_ch_andamento","painel":"ger-ti","ordem":2,"nome":"Em andamento","identificar":"Chamados sendo feitos agora.","regra":"Igual ao Dashboard de Chamados: chamados com status em andamento.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:1","espelho_grafico":"situacao","espelho_destaque":3},{"codigo":"ti_erros","painel":"ger-ti","ordem":2,"nome":"Erros críticos abertos","identificar":"Falhas que comprometem folha, faturamento, operação ou contratação.","regra":"Chamados de Sistemas do tipo correção com urgência \"até 1 hora\" (trabalho parado) que ainda estão abertos, em andamento ou aguardando retorno.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"TI / ERP","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_ch_aguardando","painel":"ger-ti","ordem":3,"nome":"Aguardando","identificar":"Esperando retorno do solicitante.","regra":"Igual ao Dashboard de Chamados: chamados aguardando retorno.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_integracoes","painel":"ger-ti","ordem":3,"nome":"Integrações com falha","identificar":"Onde os dados não estão circulando corretamente.","regra":"Itens da fila de integrações (fila_http) com erro e sem reprocessar na janela. Os resumos automáticos de chamado feitos pela I.A (novidade-ia) não contam: não são integração.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"diaria","responsavel":"TI / ERP","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_backups","painel":"ger-ti","ordem":4,"nome":"Atraso do espelho Senior (dias)","identificar":"Risco de perda de informação.","regra":"Dias de atraso do espelho do relógio de ponto (Senior) — em dia, chega até ontem.","fonte":"auto","unidade":"dias","sentido":"menor","meta":"0","alerta":"2","periodicidade":"diaria","responsavel":"TI","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_ch_concluidos","painel":"ger-ti","ordem":4,"nome":"Concluídos/mês","identificar":"Entregues desde o dia 1º.","regra":"Igual ao Dashboard de Chamados: concluídos com data de conclusão no mês corrente.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:3","espelho_grafico":"entregas","espelho_destaque":2},{"codigo":"ti_ch_atrasados","painel":"ger-ti","ordem":5,"nome":"Atrasados","identificar":"Na fila com prazo vencido.","regra":"Igual ao Dashboard de Chamados: chamados na fila com prazo previsto antes de hoje.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:4","espelho_grafico":"setores","espelho_destaque":null},{"codigo":"ti_demandas","painel":"ger-ti","ordem":5,"nome":"Demandas ERP críticas atrasadas","identificar":"Melhorias relevantes que não foram entregues.","regra":"Chamados de prioridade alta abertos com o prazo previsto vencido (ou, sem prazo, abertos há mais de N dias). Detalhe por módulo.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"5","periodicidade":"diaria","responsavel":"TI / ERP","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_acessos","painel":"ger-ti","ordem":6,"nome":"Usuários com acesso incompatível","identificar":"Risco de fraude ou vazamento de informação.","regra":"Colaboradores demitidos na folha com login do ERP ainda liberado (não bloqueado). Detalhe por setor.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":null,"periodicidade":"diaria","responsavel":"TI","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_ch_satisfacao","painel":"ger-ti","ordem":6,"nome":"Satisfação","identificar":"Nota média das avaliações (0 a 5).","regra":"Igual ao Dashboard de Chamados: média das avaliações, cada uma a média ponderada dos 6 critérios.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":true,"ativo":true,"espelho_fonte":"chamados","espelho_item":"kpi:5","espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_concluidos","painel":"ger-ti","ordem":7,"nome":"Chamados concluídos no mês","identificar":"O que o time de Sistemas entregou no mês.","regra":"Chamados de Sistemas com status concluído e data de conclusão no mês corrente. Detalhe por módulo; o mês anterior vai junto para comparar.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"TI / ERP","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"ti_tempo_conclusao","painel":"ger-ti","ordem":8,"nome":"Tempo médio de conclusão","identificar":"Quantos dias, em média, um chamado leva da abertura à conclusão.","regra":"Média de dias entre a abertura e a conclusão dos chamados concluídos no mês. Detalhe: a média dos últimos 6 meses.","fonte":"auto","unidade":"dias","sentido":"menor","meta":"7","alerta":"10","periodicidade":"diaria","responsavel":"TI / ERP","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_alunos","painel":"ger-treinamento","ordem":1,"nome":"Número de alunos","identificar":"Número de alunos — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Número de alunos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:0","espelho_grafico":"situacao","espelho_destaque":1},{"codigo":"trn_integracoes","painel":"ger-treinamento","ordem":1,"nome":"Integrações pendentes","identificar":"Quem iniciou ou iniciará sem receber as orientações obrigatórias.","regra":"Alunos criados na janela, com mais de 7 dias de casa, sem nenhuma aula concluída na plataforma.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"10","periodicidade":"diaria","responsavel":"Treinamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_contratuais","painel":"ger-treinamento","ordem":2,"nome":"Treinamentos pendentes (30+ dias)","identificar":"Contratos que ainda não cumpriram exigências de capacitação.","regra":"Matrículas da plataforma sem certificado há mais de N dias.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Treinamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_ativos","painel":"ger-treinamento","ordem":2,"nome":"Já acessaram (ativos)","identificar":"Já acessaram (ativos) — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Já acessaram (ativos).","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:1","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_inativos","painel":"ger-treinamento","ordem":3,"nome":"Nunca acessaram (inativos)","identificar":"Nunca acessaram (inativos) — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Nunca acessaram (inativos).","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:2","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_vencidos","painel":"ger-treinamento","ordem":3,"nome":"Acessos vencendo sem certificado","identificar":"Quem precisa de renovação imediata.","regra":"Alunos ativos com acesso vencido ou vencendo em N dias e o curso sem certificado.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"3","periodicidade":"semanal","responsavel":"Treinamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_recentes","painel":"ger-treinamento","ordem":4,"nome":"Acessaram recentemente","identificar":"Acessaram recentemente — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Acessaram recentemente.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:3","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_programados","painel":"ger-treinamento","ordem":4,"nome":"Certificados emitidos no mês","identificar":"O cumprimento do plano mensal de treinamento.","regra":"Certificados emitidos na plataforma de Treinamentos no mês corrente. (Era certificados ÷ matrículas, mas a matrícula em massa — 10 mil no mês — distorcia a conta.)","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"mensal","responsavel":"Treinamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_demitidos","painel":"ger-treinamento","ordem":5,"nome":"Demitidos","identificar":"Demitidos — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Demitidos.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:4","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_sem_comprovacao","painel":"ger-treinamento","ordem":5,"nome":"Matrículas antigas sem certificado","identificar":"Treinamentos sem lista, certificado ou evidência.","regra":"Matrículas com mais de N dias sem certificado emitido.","fonte":"auto","unidade":"qtd","sentido":"menor","meta":"0","alerta":"1","periodicidade":"mensal","responsavel":"Treinamento","na_tv":false,"ativo":true,"espelho_fonte":null,"espelho_item":null,"espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_aulas","painel":"ger-treinamento","ordem":6,"nome":"Aulas concluídas","identificar":"Aulas concluídas — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Aulas concluídas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:5","espelho_grafico":"contrato","espelho_destaque":2},{"codigo":"trn_d_avaliacao","painel":"ger-treinamento","ordem":7,"nome":"Avaliação das aulas","identificar":"Avaliação das aulas — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Avaliação das aulas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:6","espelho_grafico":"notas","espelho_destaque":3},{"codigo":"trn_d_provas","painel":"ger-treinamento","ordem":8,"nome":"Provas","identificar":"Provas — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Provas.","fonte":"auto","unidade":"pct","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:7","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_comentarios","painel":"ger-treinamento","ordem":9,"nome":"Comentários nas aulas","identificar":"Comentários nas aulas — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Comentários nas aulas.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:8","espelho_grafico":null,"espelho_destaque":null},{"codigo":"trn_d_certificados","painel":"ger-treinamento","ordem":10,"nome":"Certificados emitidos","identificar":"Certificados emitidos — Dashboard de Treinamentos.","regra":"Igual a Treinamentos › Dashboard de Treinamentos (sem filtro de curso nem período): Certificados emitidos.","fonte":"auto","unidade":"qtd","sentido":"maior","meta":null,"alerta":null,"periodicidade":"diaria","responsavel":"Treinamentos","na_tv":true,"ativo":true,"espelho_fonte":"treinamentos","espelho_item":"kpi:9","espelho_grafico":null,"espelho_destaque":null}]'::jsonb;
  atrasados text[];
BEGIN
  SELECT coalesce(array_agg(p.slug), '{}') INTO atrasados
    FROM public."TVG_PAINEL" p
    JOIN jsonb_array_elements(ref_p) r ON r->>'slug' = p.slug
   WHERE p.espelho_fonte IS NULL;
  IF cardinality(atrasados) = 0 THEN RETURN; END IF;
  RAISE NOTICE 'Painéis sem espelho no cluster, recebendo o cadastro de referência: %', atrasados;

  UPDATE public."TVG_PAINEL" p
     SET espelho_fonte = r->>'espelho_fonte',
         espelho_series = CASE WHEN jsonb_typeof(r->'espelho_series') = 'array'
                               THEN ARRAY(SELECT jsonb_array_elements_text(r->'espelho_series')) END
    FROM jsonb_array_elements(ref_p) r
   WHERE r->>'slug' = p.slug AND p.slug = ANY (atrasados);

  -- Cartões de espelho que não chegaram ao cluster.
  INSERT INTO public."TVG_INDICADOR"
    (codigo, painel, ordem, nome, identificar, regra, fonte, unidade, sentido, meta, alerta, periodicidade, responsavel,
     na_tv, ativo, espelho_fonte, espelho_item, espelho_grafico, espelho_destaque)
  SELECT x.codigo, x.painel, x.ordem, x.nome, x.identificar, x.regra, x.fonte, x.unidade, x.sentido, x.meta, x.alerta, x.periodicidade, x.responsavel,
         x.na_tv, x.ativo, x.espelho_fonte, x.espelho_item, x.espelho_grafico, x.espelho_destaque
    FROM jsonb_to_recordset(ref_i) x(codigo text, painel text, ordem int, nome text, identificar text, regra text, fonte text, unidade text,
         sentido text, meta numeric, alerta numeric, periodicidade text, responsavel text, na_tv boolean, ativo boolean,
         espelho_fonte text, espelho_item text, espelho_grafico text, espelho_destaque int)
   WHERE x.painel = ANY (atrasados)
  ON CONFLICT (codigo) DO NOTHING;

  -- Os que já existiam: o que vai à TV e de onde vem o número, como na referência.
  UPDATE public."TVG_INDICADOR" i
     SET ordem = x.ordem, nome = x.nome, regra = x.regra, unidade = x.unidade, sentido = x.sentido, na_tv = x.na_tv,
         espelho_fonte = x.espelho_fonte, espelho_item = x.espelho_item, espelho_grafico = x.espelho_grafico, espelho_destaque = x.espelho_destaque
    FROM jsonb_to_recordset(ref_i) x(codigo text, painel text, ordem int, nome text, regra text, unidade text, sentido text, na_tv boolean,
         espelho_fonte text, espelho_item text, espelho_grafico text, espelho_destaque int)
   WHERE x.codigo = i.codigo AND i.painel = ANY (atrasados);
END $cad$;

RESET check_function_bodies;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Não há volta útil: o estado anterior do cluster era o defeito (funções de
-- antes de 14/10). Para desfazer só o cadastro de um painel:
--   UPDATE public."TVG_PAINEL" SET espelho_fonte = NULL, espelho_series = NULL WHERE slug = '<painel>';
