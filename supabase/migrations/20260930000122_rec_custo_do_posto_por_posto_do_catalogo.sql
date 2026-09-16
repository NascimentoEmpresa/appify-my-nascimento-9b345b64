-- =========================================================================
-- Recrutamento: V.A / V.T / insalubridade da vaga vêm do POSTO escolhido
--
-- Pedido do Pablo em 15/09/2026: solicitando vaga pra uma ASG da UFRGS, o
-- V.A e o V.T vieram do "SUP. 5D POA" (supervisor) em vez do "ASG 5D POA".
-- A rec_custo_do_posto (109) ADIVINHAVA o posto por salário/cidade/cargo:
-- o salário do cadastro (1.203,99) não bateu com o da planilha (1.204,00),
-- "SERVENTE DE LIMPEZA" não aparece em "ASG 5D POA", a cidade também não,
-- e o empate foi decidido pelo maior salário — o do supervisor.
--
-- AGORA a vaga escolhe o posto no catálogo de Suprimentos (que é espelho
-- da Planilha de Custo — migration 081: sup_posto.nome = planilha_custo.posto)
-- e a RPC recebe esse nome em `p_posto`. Com p_posto:
--   • casa o posto pelo nome exato (normalizado) dentro do contrato;
--   • pega a vigência mais nova; nada de pontuação nem adivinhação;
--   • não achou o posto na planilha → NULL (a tela avisa; não inventa).
-- Sem p_posto continua a heurística antiga (ninguém da tela de vagas
-- chama assim mais; fica pra compatibilidade).
--
-- Assinatura mudou (parâmetro novo): a anterior é derrubada antes, senão
-- o PostgREST vê duas e recusa por ambiguidade.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP FUNCTION IF EXISTS public.rec_custo_do_posto(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.rec_custo_do_posto(
  p_contrato text,
  p_cargo    text DEFAULT NULL,
  p_salario  numeric DEFAULT NULL,
  p_cidade   text DEFAULT NULL,
  p_posto    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_contrato text := public.rec_norm_txt(regexp_replace(coalesce(p_contrato, ''), '^\s*\d+\s*-\s*', ''));
  v_posto    text := public.rec_norm_txt(p_posto);
  v_cargo    text := public.rec_norm_txt(p_cargo);
  v_cidade   text := public.rec_norm_txt(p_cidade);
  v_tokens   text[];
  melhor     record;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitacoes', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_contrato = '' THEN RETURN NULL; END IF;

  -- ── Caminho certo (15/09/2026): posto escolhido no catálogo ──────────
  IF v_posto <> '' THEN
    SELECT pc.posto, pc.servico, pc.salario, pc.insalubridade, pc.periculosidade, pc.transporte, pc.transporte_desconto,
           pc.aux_alimentacao, pc.aux_alimentacao_desconto, pc.aux_refeicao, pc.aux_lanche, pc.cesta_basica, pc.assistencia_medica,
           pc.data_vigencia,
           (SELECT count(*) FROM public.planilha_custo x
             WHERE coalesce(x.encerrado, false) = false
               AND public.rec_norm_txt(x.contrato) = v_contrato
               AND public.rec_norm_txt(x.posto) = v_posto) AS total
      INTO melhor
      FROM public.planilha_custo pc
     WHERE coalesce(pc.encerrado, false) = false
       AND public.rec_norm_txt(pc.contrato) = v_contrato
       AND public.rec_norm_txt(pc.posto) = v_posto
     ORDER BY pc.data_vigencia DESC NULLS LAST, pc.salario DESC
     LIMIT 1;

    IF melhor.posto IS NULL THEN RETURN NULL; END IF;

    RETURN jsonb_build_object(
      'posto',              melhor.posto,
      'servico',            melhor.servico,
      'salario',            melhor.salario,
      'insalubridade',      melhor.insalubridade,
      'periculosidade',     melhor.periculosidade,
      'vt',                 melhor.transporte,
      'vt_desconto',        melhor.transporte_desconto,
      'va',                 melhor.aux_alimentacao,
      'va_desconto',        melhor.aux_alimentacao_desconto,
      'vr',                 melhor.aux_refeicao,
      'lanche',             melhor.aux_lanche,
      'cesta_basica',       melhor.cesta_basica,
      'assistencia_medica', melhor.assistencia_medica,
      'vigencia',           melhor.data_vigencia,
      'score',              1000,
      'candidatos',         melhor.total,
      'ambiguo',            false,
      'casou_salario',      true,
      'por_posto',          true
    );
  END IF;

  -- ── Heurística antiga (sem posto): mantida só por compatibilidade ─────
  v_cargo := replace(replace(v_cargo, 'AUXILIAR DE SERVICOS GERAIS', 'ASG'), 'AUX SERVICOS GERAIS', 'ASG');
  v_tokens := ARRAY(SELECT t FROM unnest(string_to_array(v_cargo, ' ')) t WHERE length(t) >= 3 AND t NOT IN ('DOS','DAS','DE','DA','DO'));

  WITH base AS (
    SELECT pc.*, public.rec_norm_txt(pc.posto) AS posto_n
      FROM public.planilha_custo pc
     WHERE coalesce(pc.encerrado, false) = false
       AND public.rec_norm_txt(pc.contrato) = v_contrato
  ), pontos AS (
    SELECT b.*,
           (CASE WHEN p_salario IS NOT NULL AND abs(coalesce(b.salario, 0) - p_salario) < 0.01 THEN 100 ELSE 0 END)
         + (CASE WHEN v_cidade <> '' AND b.posto_n LIKE '%' || v_cidade || '%' THEN 20 ELSE 0 END)
         + 5 * (SELECT count(*) FROM unnest(v_tokens) t WHERE b.posto_n LIKE '%' || t || '%')::int AS score
      FROM base b
  ), topo AS (
    SELECT * FROM pontos WHERE score = (SELECT max(score) FROM pontos)
  )
  SELECT t.posto, t.servico, t.salario, t.insalubridade, t.periculosidade, t.transporte, t.transporte_desconto,
         t.aux_alimentacao, t.aux_alimentacao_desconto, t.aux_refeicao, t.aux_lanche, t.cesta_basica, t.assistencia_medica,
         t.data_vigencia, t.score,
         (SELECT count(*) FROM pontos) AS total,
         (SELECT count(DISTINCT (x.insalubridade, x.transporte, x.aux_alimentacao)) FROM topo x) AS variantes_no_topo
    INTO melhor
    FROM topo t
   ORDER BY t.data_vigencia DESC NULLS LAST, t.salario DESC
   LIMIT 1;

  IF melhor.posto IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'posto',              melhor.posto,
    'servico',            melhor.servico,
    'salario',            melhor.salario,
    'insalubridade',      melhor.insalubridade,
    'periculosidade',     melhor.periculosidade,
    'vt',                 melhor.transporte,
    'vt_desconto',        melhor.transporte_desconto,
    'va',                 melhor.aux_alimentacao,
    'va_desconto',        melhor.aux_alimentacao_desconto,
    'vr',                 melhor.aux_refeicao,
    'lanche',             melhor.aux_lanche,
    'cesta_basica',       melhor.cesta_basica,
    'assistencia_medica', melhor.assistencia_medica,
    'vigencia',           melhor.data_vigencia,
    'score',              melhor.score,
    'candidatos',         melhor.total,
    'ambiguo',            coalesce(melhor.variantes_no_topo, 1) > 1,
    'casou_salario',      melhor.score >= 100,
    'por_posto',          false
  );
END $fn$;

REVOKE ALL ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rec_custo_do_posto(text, text, numeric, text, text);
-- e reaplicar o bloco da 20260930000109_rec_custo_do_posto.sql.
