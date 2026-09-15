-- =========================================================================
-- Recrutamento: insalubridade e benefícios da vaga vêm da PLANILHA DE CUSTO
--
-- Pedido do Pablo em 14/09/2026: "a insalubridade do cargo puxa automática
-- nas vagas, o encarregado não preenche — só escolhe o colaborador. Tem
-- tudo na Planilha de Custo, por contrato: VT, VA, insalubridade. Benefícios
-- a mesma coisa: V.T e V.A mensal do contrato. Usuário não seleciona nem
-- edita, só vê."
--
-- A RPC recebe o que a vaga já sabe (contrato, cargo, salário e cidade do
-- colaborador escolhido) e devolve a linha da planilha que melhor casa:
--   contrato  → nome igual ao de CONTRATOS."NOME CONTRATO" (sem acento/pontuação)
--   posto     → pontua: salário igual (peso 100), cidade no nome do posto
--               (20), palavras do cargo no posto (5 cada; ASG ≙ AUXILIAR DE
--               SERVIÇOS GERAIS), e desempata pela vigência mais nova.
-- Devolve também `ambiguo`: true quando os melhores candidatos divergem em
-- insalubridade/VT/VA — aí a tela avisa "confira" em vez de fingir certeza.
--
-- SECURITY DEFINER: planilha_custo é de Licitações; o encarregado não lê a
-- tabela, lê só estes quatro números do posto dele.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_norm_txt(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT btrim(regexp_replace(
           upper(translate(coalesce(p, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN')),
           '[^A-Z0-9]+', ' ', 'g'));
$fn$;

CREATE OR REPLACE FUNCTION public.rec_custo_do_posto(
  p_contrato text,
  p_cargo    text DEFAULT NULL,
  p_salario  numeric DEFAULT NULL,
  p_cidade   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_contrato text := public.rec_norm_txt(regexp_replace(coalesce(p_contrato, ''), '^\s*\d+\s*-\s*', ''));
  v_cargo    text := public.rec_norm_txt(p_cargo);
  v_cidade   text := public.rec_norm_txt(p_cidade);
  v_tokens   text[];
  melhor     record;
  n_cand     int;
  ambiguo    boolean;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'encarregados_minhas_solicitacoes', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'central_servicos_solicitar_vaga', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'licitacoes_analistas_recrutamento', 'visualizar'::app_acao)
          OR public.has_screen_access(auth.uid(), 'operacional_recrutamento', 'visualizar'::app_acao)) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_contrato = '' THEN RETURN NULL; END IF;

  -- ASG é como a planilha chama o Auxiliar de Serviços Gerais.
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
         t.aux_alimentacao, t.aux_alimentacao_desconto, t.aux_refeicao, t.cesta_basica, t.assistencia_medica,
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
    'cesta_basica',       melhor.cesta_basica,
    'assistencia_medica', melhor.assistencia_medica,
    'vigencia',           melhor.data_vigencia,
    'score',              melhor.score,
    'candidatos',         melhor.total,
    'ambiguo',            coalesce(melhor.variantes_no_topo, 1) > 1,
    'casou_salario',      melhor.score >= 100
  );
END $fn$;

REVOKE ALL ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rec_custo_do_posto(text, text, numeric, text);
-- DROP FUNCTION IF EXISTS public.rec_norm_txt(text);
-- NOTIFY pgrst, 'reload schema';
