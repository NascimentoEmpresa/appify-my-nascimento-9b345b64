-- =========================================================================
-- Recrutamento: V.A/V.T da vaga não eram puxados quando o posto do
-- catálogo tem nome diferente do posto da Planilha de Custo.
--
-- Caso de 24/09/2026: Solicitação #1252 — contrato POLÍCIA CIVIL RS
-- LIMPEZA, posto do catálogo "1ª DP NOVO HAMBURGO", escala
-- "8:00-12:00 (4H) SEG A SEX". A planilha desse contrato chama os postos
-- por jornada + cidade ("LIMPEZA 20H 5X2 NOVO HAMBURGO"), então a busca
-- exata (mig 122) não achava nada e devolvia NULL — Benefícios em branco.
-- 36 das 78 vagas nativas dos últimos 10 dias estavam assim.
--
-- Correção: quando o nome exato não existe na planilha, em vez de NULL a
-- função pontua os postos do MESMO contrato por:
--   cidade no nome do posto (+100) · carga semanal tirada da escala (+50)
--   · padrão 5X2/6X1/12X36 (+20) · palavras do cargo (+5 cada)
--   · palavras do posto do catálogo (+3 cada) · salário igual (+10)
-- Cidade pesa mais que salário de propósito: #1252 tem R$ 802,66, que é o
-- valor novo de Porto Alegre/Gravataí — pelo salário ia para outra cidade
-- (V.T errado). O resultado sai com por_posto=false e ambiguo=true quando
-- o topo empata com valores diferentes, e a tela avisa para conferir.
--
--   rec_horas_semanais(escala) → int[]  cargas possíveis (ex. {20}; {40,48}
--       quando a escala não diz os dias). 12X36 → NULL (casa pelo padrão).
--   rec_padrao_escala(escala)  → '5X2' | '6X1' | '12X36' | NULL
--   rec_custo_do_posto ganha p_escala (6º parâmetro, DEFAULT NULL — chamada
--       antiga com 5 parâmetros nomeados continua funcionando). A versão de
--       5 parâmetros é removida para não ficar ambígua.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rec_padrao_escala(_escala text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN upper(coalesce(_escala, '')) ~ '12\s*X\s*36' THEN '12X36'
    WHEN upper(coalesce(_escala, '')) ~ '(6\s*X\s*1|SEG\w*\s*(A|-|À)\s*SAB)' THEN '6X1'
    WHEN upper(coalesce(_escala, '')) ~ '(5\s*X\s*2|SEG\w*\s*(A|-|À)\s*SEX)' THEN '5X2'
  END
$$;

CREATE OR REPLACE FUNCTION public.rec_horas_semanais(_escala text)
RETURNS int[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  s        text := upper(coalesce(_escala, ''));
  padrao   text := public.rec_padrao_escala(_escala);
  m        text[];
  v        numeric;
  diaria   numeric;
  maior_p  numeric := 0;   -- maior duração entre parênteses
  interv   numeric := 0;   -- intervalo (parêntese de até 2h, ou "15MIN")
  ini      numeric;
  fim      numeric;
BEGIN
  IF padrao = '12X36' OR s = '' THEN RETURN NULL; END IF;

  -- Durações entre parênteses: (8H) (8:48H) (08:48) (1:30H) (00:15) (1H)
  FOR m IN SELECT regexp_matches(s, '\((\d{1,2})(?::(\d{2}))?\s*H?\s*(?:IND)?\)', 'g') LOOP
    v := m[1]::numeric + coalesce(m[2]::numeric, 0) / 60;
    IF v >= 3 THEN maior_p := greatest(maior_p, v);
    ELSIF v > 0 THEN interv := greatest(interv, v);
    END IF;
  END LOOP;
  m := regexp_match(s, '\((\d{1,3})\s*MIN');
  IF m IS NOT NULL THEN interv := greatest(interv, m[1]::numeric / 60); END IF;

  IF maior_p > 0 THEN
    diaria := maior_p;                        -- a escala já diz a jornada do dia
  ELSE
    m := regexp_match(s, '(\d{1,2}):(\d{2})\s*(?:-|ÀS|AS|A)\s*(\d{1,2}):(\d{2})');
    IF m IS NULL THEN diaria := NULL;
    ELSE
      ini := m[1]::numeric + m[2]::numeric / 60;
      fim := m[3]::numeric + m[4]::numeric / 60;
      IF fim <= ini THEN fim := fim + 24; END IF;
      diaria := fim - ini;
      IF diaria > 6 OR interv > 0 THEN diaria := diaria - interv; END IF;
    END IF;
  END IF;

  IF diaria IS NULL OR diaria <= 0 THEN
    RETURN NULL;
  ELSIF padrao = '5X2' THEN RETURN ARRAY[round(diaria * 5)::int];
  ELSIF padrao = '6X1' THEN RETURN ARRAY[round(diaria * 6)::int];
  ELSE RETURN ARRAY[round(diaria * 5)::int, round(diaria * 6)::int];   -- dias não informados
  END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.rec_padrao_escala(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_horas_semanais(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_padrao_escala(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rec_horas_semanais(text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.rec_custo_do_posto(text, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.rec_custo_do_posto(
  p_contrato text,
  p_cargo    text    DEFAULT NULL,
  p_salario  numeric DEFAULT NULL,
  p_cidade   text    DEFAULT NULL,
  p_posto    text    DEFAULT NULL,
  p_escala   text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_contrato text := public.rec_norm_txt(regexp_replace(coalesce(p_contrato, ''), '^\s*\d+\s*-\s*', ''));
  v_posto    text := public.rec_norm_txt(p_posto);
  v_cargo    text := public.rec_norm_txt(p_cargo);
  v_cidade   text := public.rec_norm_txt(p_cidade);
  v_horas    int[] := public.rec_horas_semanais(p_escala);
  v_padrao   text := public.rec_padrao_escala(p_escala);
  v_tokens   text[];
  v_tk_posto text[];
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

    IF melhor.posto IS NOT NULL THEN
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
    -- 24/09/2026: nome do catálogo ≠ nome da planilha → segue para a
    -- pontuação abaixo (antes: RETURN NULL e benefícios em branco).
  END IF;

  -- ── Pontuação: cidade, carga da escala, padrão, cargo, posto, salário ─
  v_cargo := replace(replace(v_cargo, 'AUXILIAR DE SERVICOS GERAIS', 'ASG'), 'AUX SERVICOS GERAIS', 'ASG');
  v_tokens := ARRAY(SELECT t FROM unnest(string_to_array(v_cargo, ' ')) t WHERE length(t) >= 3 AND t NOT IN ('DOS','DAS','DE','DA','DO'));
  v_tk_posto := ARRAY(SELECT t FROM unnest(string_to_array(regexp_replace(v_posto, '[^A-Z0-9 ]', ' ', 'g'), ' ')) t
                       WHERE length(t) >= 4 AND t !~ '^\d+$');

  WITH base AS (
    SELECT pc.*, public.rec_norm_txt(pc.posto) AS posto_n
      FROM public.planilha_custo pc
     WHERE coalesce(pc.encerrado, false) = false
       AND public.rec_norm_txt(pc.contrato) = v_contrato
  ), pontos AS (
    SELECT b.*,
           (CASE WHEN v_cidade <> '' AND b.posto_n LIKE '%' || v_cidade || '%' THEN 100 ELSE 0 END)
         + (CASE WHEN v_horas IS NOT NULL AND EXISTS (
                   SELECT 1 FROM unnest(v_horas) h WHERE b.posto_n ~ ('(^|[^0-9])' || h || '\s*H')) THEN 50 ELSE 0 END)
         + (CASE WHEN v_padrao IS NOT NULL AND replace(b.posto_n, ' ', '') LIKE '%' || v_padrao || '%' THEN 20 ELSE 0 END)
         + 5 * (SELECT count(*) FROM unnest(v_tokens) t WHERE b.posto_n LIKE '%' || t || '%')::int
         + 3 * (SELECT count(*) FROM unnest(v_tk_posto) t WHERE b.posto_n LIKE '%' || t || '%')::int
         + (CASE WHEN p_salario IS NOT NULL AND abs(coalesce(b.salario, 0) - p_salario) < 0.01 THEN 10 ELSE 0 END) AS score
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

  IF melhor.posto IS NULL OR melhor.score = 0 THEN RETURN NULL; END IF;

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
    'casou_salario',      p_salario IS NOT NULL AND abs(coalesce(melhor.salario, 0) - p_salario) < 0.01,
    'por_posto',          false
  );
END $function$;

REVOKE ALL ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_custo_do_posto(text, text, numeric, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência:
-- SELECT e, public.rec_horas_semanais(e), public.rec_padrao_escala(e) FROM (VALUES
--   ('8:00-12:00 (4H) SEG A SEX'), ('07:30-17:18 (1H)(08:48)'), ('07:30-16:20 (1:30H)SEG A SAB'),
--   ('8:30-14:45 (15MIN)'), ('12X36'), ('5X2')) t(e);

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.rec_custo_do_posto(text, text, numeric, text, text, text);
-- Reaplicar public.rec_custo_do_posto de 5 parâmetros da 20260930000122
-- (posto sem casamento exato → NULL) e o GRANT para authenticated.
-- DROP FUNCTION IF EXISTS public.rec_horas_semanais(text);
-- DROP FUNCTION IF EXISTS public.rec_padrao_escala(text);
-- NOTIFY pgrst, 'reload schema';
