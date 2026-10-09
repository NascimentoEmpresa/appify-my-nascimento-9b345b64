-- =========================================================================
-- RH › GESTÃO DE PONTO — espelho de ponto do mês de cada colaborador, lido
-- das marcações da Senior (espelho."BiMarcacoes")   [branch local gestaoponto]
--
-- PEDIDO (Pablo, 07/10/2026)
--   "No sistema tem um espelho da Senior completo de marcações; tem que ficar
--   vinculado a cada colaborador suas marcações de cada mês completo. Dá pra
--   vincular pela matrícula, que é o código de cadastro do colaborador."
--
-- O QUE O BANCO TEM (medido em 07/10/2026)
--   espelho."BiMarcacoes" (3,8 mi linhas, 18/03/2024 → hoje, carga diária
--   TRUNCATE + COPY pelo espelho-mysql — índice sobrevive à carga):
--     empresa, matricula, numcra, data_hora (só a DATA, hora 00:00),
--     situacao (sempre 1), hora (MINUTO DO DIA: 420 = 07:00; ver
--     src/lib/ponto.ts).
--   Casamento com EMPREGADOS: (matricula % 100000000) = "Cadastro" E
--     empresa = "Empresa" — o relógio grava a matrícula ora pura (3997), ora
--     prefixada (1000009380 → 9380). Mesma regra de esp_col_marcacoes (mig
--     20260930000059).
--   Jornada: EMPREGADOS."Escala_1" = ESCALAS."Escala" (Descricao "08:00-17:00
--     (1h)(8h)", H.Semana "44:00", H.Ms "220:00"). A interpretação fica no
--     front (src/lib/gestaoPonto.ts, com teste).
--   espelho."BiAssinalamentos" NÃO é ponto (é benefício: VA por dia) e fica
--     de fora.
--
-- O QUE ESTA MIGRATION FAZ (tudo ADITIVO — nada existente muda)
--   1. Índice em espelho."BiMarcacoes" (empresa, matricula % 1e8, data_hora):
--      sem ele cada mês de cada pessoa varre 3,8 mi linhas.
--   2. Menu rh_gestao_ponto (/app/rh/gestao-ponto), nasce FECHADO.
--   3. gp_filiais(): filiais com colaboradores, para o seletor.
--   4. gp_mes(mes, filial, empregado): colaboradores + batidas do mês (com o
--      último dia do mês anterior e o primeiro do seguinte, para a jornada
--      noturna que vira o dia) + a escala de cada um. Só nome, cargo,
--      matrícula e escala — nada de CPF/salário.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1. Índice ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bimarcacoes_emp_mat_data
  ON espelho."BiMarcacoes" (empresa, (matricula % 100000000), data_hora);

-- ── 2. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'rh_gestao_ponto', 'Gestão de Ponto', '/app/rh/gestao-ponto', 14, true
  FROM public.app_modulo m WHERE m.codigo = 'rh'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.gp_exige()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(v_uid, 'rh_gestao_ponto', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Gestão de Ponto' USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END $$;
REVOKE ALL ON FUNCTION public.gp_exige() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gp_exige() TO authenticated;

-- ── 3. Filiais ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gp_filiais()
RETURNS TABLE (filial text, ativos int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.gp_exige();
  RETURN QUERY
  SELECT e."Nome Filial", count(*)::int
    FROM public."EMPREGADOS" e
   WHERE public.esp_col_esta_ativo(e."Situação")
     AND coalesce(btrim(e."Nome Filial"), '') <> ''
     AND coalesce(btrim(e."Nome"), '') <> ''
   GROUP BY e."Nome Filial"
   ORDER BY e."Nome Filial";
END $$;
REVOKE ALL ON FUNCTION public.gp_filiais() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gp_filiais() TO authenticated;

-- ── 4. O mês ─────────────────────────────────────────────────────────────
-- p_mes 'AAAA-MM'. Ou a filial inteira (p_filial) ou um colaborador
-- (p_empregado_id) — a empresa toda de uma vez não: seria o mês de 2.400
-- pessoas numa resposta só.
-- Entra quem está ativo OU saiu depois do início do mês (o demitido do meio
-- do mês tem marcações até o desligamento).
CREATE OR REPLACE FUNCTION public.gp_mes(p_mes text, p_filial text DEFAULT NULL, p_empregado_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ini date; v_fim date; v_out jsonb;
BEGIN
  PERFORM public.gp_exige();
  IF coalesce(p_mes, '') !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido (use AAAA-MM).'; END IF;
  IF p_filial IS NULL AND p_empregado_id IS NULL THEN RAISE EXCEPTION 'Escolha a filial ou o colaborador.'; END IF;
  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    RETURN jsonb_build_object('disponivel', false, 'motivo', 'O espelho de marcações da Senior não está no banco.', 'colaboradores', '[]'::jsonb);
  END IF;

  v_ini := to_date(p_mes || '-01', 'YYYY-MM-DD');
  v_fim := (v_ini + interval '1 month')::date;          -- exclusivo

  -- SQL dinâmico pela mesma razão de esp_col_marcacoes: referência tardia a
  -- espelho."BiMarcacoes" deixa a função existir num banco sem o espelho.
  EXECUTE $q$
    WITH col AS (
      SELECT e."ID" AS id, e."Empresa" AS empresa, e."Cadastro" AS cadastro, e."Nome" AS nome,
             e."Título do Cargo" AS cargo, e."Situação" AS situacao,
             -- Datas da EMPREGADOS vêm em mais de um formato (ISO e DD/MM/AAAA);
             -- data_universal (mig 20260930000229) devolve date.
             public.data_universal(e."Admissão"::text) AS admissao,
             CASE WHEN NOT public.esp_col_esta_ativo(e."Situação")
                  THEN public.data_universal(e."Data Afastamento"::text) END AS afastamento,
             e."Nome Filial" AS filial, e."Nome do Posto" AS posto,
             e."Escala" AS escala_txt,
             CASE WHEN btrim(coalesce(e."Escala_1"::text, '')) ~ '^\d+$' THEN btrim(e."Escala_1"::text)::bigint END AS escala_cod,
             CASE WHEN btrim(e."Cadastro"::text) ~ '^\d+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad_num,
             CASE WHEN btrim(e."Empresa"::text) ~ '^\d+$' THEN btrim(e."Empresa"::text)::int END AS emp_num
        FROM public."EMPREGADOS" e
       WHERE coalesce(btrim(e."Nome"), '') <> ''
         AND (($1::bigint IS NOT NULL AND e."ID" = $1)
           OR ($1::bigint IS NULL AND e."Nome Filial" = $2
               AND (public.esp_col_esta_ativo(e."Situação")
                    OR public.data_universal(e."Data Afastamento"::text) >= $3::date)))
    ),
    bat AS (
      SELECT c.id, m.data_hora::date AS dia, m.hora
        FROM col c
        JOIN espelho."BiMarcacoes" m
          ON m.empresa = c.emp_num
         AND (m.matricula % 100000000) = c.cad_num
         AND m.data_hora >= ($3::date - 1) AND m.data_hora < ($4::date + 1)
       WHERE c.cad_num IS NOT NULL AND c.emp_num IS NOT NULL
       GROUP BY c.id, m.data_hora::date, m.hora          -- o relógio repete batida
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'empresa', c.empresa, 'cadastro', c.cadastro, 'nome', c.nome,
             'cargo', c.cargo, 'situacao', c.situacao, 'admissao', c.admissao,
             'afastamento', c.afastamento, 'filial', c.filial, 'posto', c.posto,
             'escala', jsonb_build_object(
               'codigo', c.escala_cod,
               'descricao', coalesce(es."Descricao", c.escala_txt),
               'h_semana', es."H.Semana", 'h_mes', es."H.Ms", 'h_dsr', es."H.DSR"),
             'batidas', coalesce((
               SELECT jsonb_agg(jsonb_build_array(b.dia, b.hora) ORDER BY b.dia, b.hora)
                 FROM bat b WHERE b.id = c.id), '[]'::jsonb))
             ORDER BY c.nome), '[]'::jsonb)
      FROM col c
      LEFT JOIN public."ESCALAS" es ON es."Escala" = c.escala_cod
  $q$
  INTO v_out
  USING p_empregado_id, p_filial, v_ini, v_fim;

  RETURN jsonb_build_object(
    'disponivel', true,
    'mes', p_mes,
    'inicio', v_ini,
    'fim', v_fim - 1,
    'gerado_em', now(),
    'colaboradores', v_out);
END $$;
REVOKE ALL ON FUNCTION public.gp_mes(text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gp_mes(text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.gp_mes(text, text, bigint), public.gp_filiais(), public.gp_exige();
-- UPDATE public.app_menu SET ativo = false WHERE codigo = 'rh_gestao_ponto';
-- DROP INDEX IF EXISTS espelho.idx_bimarcacoes_emp_mat_data;
