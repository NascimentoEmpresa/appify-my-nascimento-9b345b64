-- =========================================================================
-- HORA EXTRA — cada um vê só as suas, e o total do mês vem do ponto da Senior
--
-- PEDIDO (Pablo, 04/11/2026)
--   "deixa apenas cada um ver suas horas extras [...] limite de 48h por mês no
--   MÁXIMO, integrados com o PONTO DA SENIOR, lembrando que se tiver feriado
--   tem que puxar igual também".
--
-- POR QUE TODO MUNDO VIA TUDO
--   A RLS liberava as HEs dos outros para quem tinha 'aprovar' em
--   sistemas_hora_extra. Só que o toggle da tela concede 'aprovar' junto
--   (ACOES_DO_TOGGLE_PADRAO, src/lib/acoesDoToggleAcesso.ts): ligar a tela
--   para alguém pedir a própria HE abria a de todo mundo.
--
-- A REGRA NOVA
--   · Lê a HE de outra pessoa só quem tem as DUAS coisas: o menu da Liberação
--     (sistemas_hora_extra_liberacao/visualizar) e 'aprovar' em
--     sistemas_hora_extra. É o fluxo de aprovação, que continua existindo; sem
--     isso o gestor não teria o que aprovar. Quem aprova precisa ter os dois
--     toggles ligados no Gerenciamento de Acesso.
--   · hora_extra_stats passa a contar só as próprias (é o cartão da tela de
--     Solicitações, que agora só mostra as próprias).
--   · hora_extra_colaboradores (o seletor de "criar HE para outra pessoa")
--     segue a mesma chave: quem não enxerga a HE do outro não cria para ele.
--
-- O QUE FICA DE FORA DE PROPÓSITO
--   · hora_extra_dashboard: menu próprio, liberado um a um, é gestão. Continua
--     como está. Se for para fechar também, é decisão à parte.
--   · hora_extra_salvar/liberar/validar: não mudam. O limite de 48h é
--     confirmação na tela, não bloqueio ("é só pra garantir que tá certo").
--   · Policies de INSERT de anexo: não mudam.
--
-- O PONTO DO MÊS
--   hora_extra_ponto_mes devolve, de UMA pessoa e de UM mês, as batidas e a
--   escala da Senior no mesmo formato de gp_mes (mig 20261007000001) e as HEs
--   do ERP. A conta fica no front, em src/lib/gestaoPonto.ts, a mesma da Gestão
--   de Ponto: é lá que está a leitura do texto da escala e dos feriados.
--   Não abre gp_mes: aquela exige rh_gestao_ponto e devolve a filial inteira.
-- =========================================================================

-- 1) Quem enxerga HE de outra pessoa --------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_ve_de_outros()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra_liberacao', 'visualizar'::public.app_acao)
     AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar'::public.app_acao);
$$;
REVOKE ALL ON FUNCTION public.hora_extra_ve_de_outros() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_ve_de_outros() TO authenticated;

-- 2) RLS de leitura --------------------------------------------------------
DROP POLICY IF EXISTS hora_extra_solicitacao_select ON public."HORA_EXTRA_SOLICITACAO";
CREATE POLICY hora_extra_solicitacao_select ON public."HORA_EXTRA_SOLICITACAO" FOR SELECT TO authenticated
USING (
  "HORA_EXTRA_SOLICITACAO".colaborador_id = (SELECT auth.uid())
  OR (SELECT public.hora_extra_ve_de_outros())
);

DROP POLICY IF EXISTS hora_extra_chamado_select ON public."HORA_EXTRA_CHAMADO";
CREATE POLICY hora_extra_chamado_select ON public."HORA_EXTRA_CHAMADO" FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE s.id = "HORA_EXTRA_CHAMADO".solicitacao_id
     AND (s.colaborador_id = (SELECT auth.uid()) OR (SELECT public.hora_extra_ve_de_outros()))
));

DROP POLICY IF EXISTS hora_extra_anexo_select ON public."HORA_EXTRA_ANEXO";
CREATE POLICY hora_extra_anexo_select ON public."HORA_EXTRA_ANEXO" FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE s.id = "HORA_EXTRA_ANEXO".solicitacao_id
     AND (s.colaborador_id = (SELECT auth.uid()) OR (SELECT public.hora_extra_ve_de_outros()))
));

DROP POLICY IF EXISTS hora_extra_evento_select ON public."HORA_EXTRA_EVENTO";
CREATE POLICY hora_extra_evento_select ON public."HORA_EXTRA_EVENTO" FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE s.id = "HORA_EXTRA_EVENTO".solicitacao_id
     AND (s.colaborador_id = (SELECT auth.uid()) OR (SELECT public.hora_extra_ve_de_outros()))
));

-- O arquivo do anexo segue a mesma regra: sem isto a linha some, mas o arquivo
-- continuaria abrindo para quem soubesse o caminho.
DROP POLICY IF EXISTS "hora extra anexos select" ON storage.objects;
CREATE POLICY "hora extra anexos select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'hora-extra' AND EXISTS (
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE s.id = (storage.foldername(objects.name))[1]::uuid
     AND (s.colaborador_id = (SELECT auth.uid()) OR (SELECT public.hora_extra_ve_de_outros()))
));

-- 3) Cartões da tela de Solicitações: só as próprias -----------------------
CREATE OR REPLACE FUNCTION public.hora_extra_stats(
  p_inicio date,
  p_fim date
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH parametros AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje_sp
  ),
  periodo AS (
    SELECT s.*
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.data_he BETWEEN p_inicio AND p_fim
      AND s.colaborador_id = auth.uid()
      AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
  ),
  anterior AS (
    SELECT count(*)::numeric AS total
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.data_he BETWEEN (p_inicio - (p_fim - p_inicio + 1)) AND (p_inicio - 1)
      AND s.colaborador_id = auth.uid()
      AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'aguardando_liberacao', count(*) FILTER (
      WHERE status = 'aguardando_liberacao'
    ),
    'aguardando_validacao', count(*) FILTER (
      WHERE status = 'aguardando_validacao'
    ),
    'aprovadas', count(*) FILTER (
      WHERE status = 'aguardando_validacao'
        OR (status = 'aprovada' AND data_he >= parametros.hoje_sp)
    ),
    'liberadas', count(*) FILTER (
      WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
    ),
    'pendentes_conclusao', count(*) FILTER (
      WHERE status = 'aprovada'
        AND data_he < parametros.hoje_sp
    ),
    'concluidas', count(*) FILTER (
      WHERE status = 'concluida'
    ),
    'reprovadas', count(*) FILTER (
      WHERE status = 'reprovada'
    ),
    'total_minutos', coalesce(sum(total_previsto_min), 0),
    'media_minutos', coalesce(round(avg(total_previsto_min)), 0),
    'horas_aprovadas_min', coalesce(
      sum(total_previsto_min) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ),
      0
    ),
    'variacao', CASE
      WHEN (SELECT total FROM anterior) = 0 THEN 0
      ELSE round(
        (count(*) - (SELECT total FROM anterior)) * 100 / (SELECT total FROM anterior),
        1
      )
    END
  )
  FROM periodo
  CROSS JOIN parametros;
$$;

-- 4) Seletor de "criar HE para outra pessoa" -------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_colaboradores()
RETURNS TABLE (
  id uuid,
  nome text,
  cargo text,
  setor text,
  empresa text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
    p.id,
    coalesce(e."Nome", p.display_name),
    e."Título do Cargo",
    e."Setor_ERP",
    e."Nome da Empresa"
  FROM public.profiles p
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = p.id
  WHERE public.hora_extra_ve_de_outros()
    AND p.ativo = true
    AND (
      p.id = auth.uid()
      OR public.has_screen_access(p.id, 'chamados_sistemas_dev', 'visualizar')
      OR public.has_screen_access(p.id, 'sistemas_hora_extra', 'incluir')
    )
  ORDER BY 2;
$$;

-- 5) O ponto da Senior e as HEs de uma pessoa em um mês --------------------
-- p_colaborador NULL = eu. De outra pessoa, só com hora_extra_ve_de_outros().
-- 'solicitacoes' não traz as reprovadas: essas não contam para o limite.
-- Sem vínculo com EMPREGADOS ou sem o espelho no banco a resposta vem sem o
-- colaborador e com o motivo, e não com erro: as HEs do ERP ainda valem.
CREATE OR REPLACE FUNCTION public.hora_extra_ponto_mes(p_mes text, p_colaborador uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_alvo uuid := coalesce(p_colaborador, auth.uid());
  v_ini date;
  v_fim date;
  v_colaborador jsonb;
  v_solicitacoes jsonb;
  v_motivo text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  IF v_alvo = v_uid THEN
    IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'visualizar'::public.app_acao) THEN
      RAISE EXCEPTION 'Sem acesso à Hora Extra' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.hora_extra_ve_de_outros() THEN
    RAISE EXCEPTION 'Sem acesso à Hora Extra de outra pessoa' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_mes, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Mês inválido (use AAAA-MM).';
  END IF;

  v_ini := to_date(p_mes || '-01', 'YYYY-MM-DD');
  v_fim := (v_ini + interval '1 month')::date;          -- exclusivo

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'data_he', s.data_he,
           'minutos', coalesce(s.total_real_min, s.total_previsto_min, 0),
           'feriado', s.feriado,
           'status', s.status) ORDER BY s.data_he), '[]'::jsonb)
    INTO v_solicitacoes
    FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE s.colaborador_id = v_alvo
     AND s.data_he >= v_ini AND s.data_he < v_fim
     AND s.status <> 'reprovada';

  IF to_regclass('espelho."BiMarcacoes"') IS NULL THEN
    v_motivo := 'sem_espelho';
  ELSE
    -- SQL dinâmico pela mesma razão de gp_mes: referência tardia a
    -- espelho."BiMarcacoes" deixa a função existir num banco sem o espelho.
    EXECUTE $q$
      WITH col AS (
        SELECT e."ID" AS id, e."Empresa" AS empresa, e."Cadastro" AS cadastro, e."Nome" AS nome,
               e."Título do Cargo" AS cargo, e."Situação" AS situacao,
               public.data_universal(e."Admissão"::text) AS admissao,
               CASE WHEN NOT public.esp_col_esta_ativo(e."Situação")
                    THEN public.data_universal(e."Data Afastamento"::text) END AS afastamento,
               e."Nome Filial" AS filial, e."Nome do Posto" AS posto,
               e."Escala" AS escala_txt,
               CASE WHEN btrim(coalesce(e."Escala_1"::text, '')) ~ '^\d+$' THEN btrim(e."Escala_1"::text)::bigint END AS escala_cod,
               CASE WHEN btrim(e."Cadastro"::text) ~ '^\d+$' THEN btrim(e."Cadastro"::text)::bigint END AS cad_num,
               CASE WHEN btrim(e."Empresa"::text) ~ '^\d+$' THEN btrim(e."Empresa"::text)::int END AS emp_num
          FROM public."EMPREGADOS" e
         WHERE e.auth_user_id = $1
         ORDER BY public.esp_col_esta_ativo(e."Situação") DESC, e."ID" DESC
         LIMIT 1
      ),
      bat AS (
        SELECT m.data_hora::date AS dia, m.hora
          FROM col c
          JOIN espelho."BiMarcacoes" m
            ON m.empresa = c.emp_num
           AND (m.matricula % 100000000) = c.cad_num
           AND m.data_hora >= ($2::date - 1) AND m.data_hora < ($3::date + 1)
         WHERE c.cad_num IS NOT NULL AND c.emp_num IS NOT NULL
         GROUP BY m.data_hora::date, m.hora              -- o relógio repete batida
      )
      SELECT jsonb_build_object(
               'id', c.id, 'empresa', c.empresa, 'cadastro', c.cadastro, 'nome', c.nome,
               'cargo', c.cargo, 'situacao', c.situacao, 'admissao', c.admissao,
               'afastamento', c.afastamento, 'filial', c.filial, 'posto', c.posto,
               'escala', jsonb_build_object(
                 'codigo', c.escala_cod,
                 'descricao', coalesce(es."Descricao", c.escala_txt),
                 'h_semana', es."H.Semana", 'h_mes', es."H.Ms", 'h_dsr', es."H.DSR"),
               'batidas', coalesce((
                 SELECT jsonb_agg(jsonb_build_array(b.dia, b.hora) ORDER BY b.dia, b.hora)
                   FROM bat b), '[]'::jsonb))
        FROM col c
        LEFT JOIN public."ESCALAS" es ON es."Escala" = c.escala_cod
    $q$
    INTO v_colaborador
    USING v_alvo, v_ini, v_fim;

    IF v_colaborador IS NULL THEN
      v_motivo := 'sem_vinculo';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'mes', p_mes,
    'hoje', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    'ponto_disponivel', v_colaborador IS NOT NULL,
    'motivo', v_motivo,
    'colaborador', v_colaborador,
    'solicitacoes', v_solicitacoes);
END $$;
REVOKE ALL ON FUNCTION public.hora_extra_ponto_mes(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_ponto_mes(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.hora_extra_ponto_mes(text, uuid);
-- Recriar hora_extra_stats e hora_extra_colaboradores como em
-- 20260930000162_hora_extra_autorizacao.sql (a primeira com
-- "colaborador_id = auth.uid() OR has_screen_access(..., 'aprovar')", a segunda
-- com has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar') no WHERE).
-- Nas quatro policies de SELECT acima e em "hora extra anexos select", trocar
-- (SELECT public.hora_extra_ve_de_outros()) por
-- public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar').
-- Depois: DROP FUNCTION IF EXISTS public.hora_extra_ve_de_outros();
