-- =====================================================================
-- Hora Extra — relatório automático de Pull Requests do GitHub.
--
-- Cada chamado concluído na HE guarda a PR que o realizou e suas métricas.
-- Os valores são consultados pela Edge Function hora-extra-pr-info; esta
-- migration persiste o resultado e impede o envio de linhas sem uma PR.
-- =====================================================================

-- 1) Métricas da PR no chamado da HE ---------------------------------
ALTER TABLE public."HORA_EXTRA_CHAMADO"
  ADD COLUMN IF NOT EXISTS pr_numero integer,
  ADD COLUMN IF NOT EXISTS pr_url text,
  ADD COLUMN IF NOT EXISTS pr_titulo text,
  ADD COLUMN IF NOT EXISTS pr_linhas_adicionadas integer,
  ADD COLUMN IF NOT EXISTS pr_commits integer,
  ADD COLUMN IF NOT EXISTS pr_arquivos_adicionados integer;

ALTER TABLE public."HORA_EXTRA_CHAMADO"
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_pr_numero_check,
  ADD CONSTRAINT hora_extra_chamado_pr_numero_check
    CHECK (pr_numero IS NULL OR pr_numero > 0),
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_pr_linhas_adicionadas_check,
  ADD CONSTRAINT hora_extra_chamado_pr_linhas_adicionadas_check
    CHECK (pr_linhas_adicionadas IS NULL OR pr_linhas_adicionadas >= 0),
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_pr_commits_check,
  ADD CONSTRAINT hora_extra_chamado_pr_commits_check
    CHECK (pr_commits IS NULL OR pr_commits >= 0),
  DROP CONSTRAINT IF EXISTS hora_extra_chamado_pr_arquivos_adicionados_check,
  ADD CONSTRAINT hora_extra_chamado_pr_arquivos_adicionados_check
    CHECK (pr_arquivos_adicionados IS NULL OR pr_arquivos_adicionados >= 0);

-- Uma mesma PR não pode ser usada para justificar dois chamados da mesma HE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hora_extra_chamado_solicitacao_pr
  ON public."HORA_EXTRA_CHAMADO" (solicitacao_id, pr_numero)
  WHERE pr_numero IS NOT NULL;

-- A Edge Function registra aqui a consulta feita com GITHUB_TOKEN. A tabela
-- é temporária: os valores validados são copiados para HORA_EXTRA_CHAMADO na
-- conclusão e removidos no fim da transação. Assim o RPC não confia nas
-- métricas nem no chamado_id recebidos do navegador.
CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_PR_VALIDACAO" (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id          uuid NOT NULL REFERENCES public."HORA_EXTRA_SOLICITACAO"(id) ON DELETE CASCADE,
  pr_numero               integer NOT NULL CHECK (pr_numero > 0),
  pr_url                  text NOT NULL,
  pr_titulo               text NOT NULL,
  chamado_id              uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id),
  pr_linhas_adicionadas   integer NOT NULL CHECK (pr_linhas_adicionadas >= 0),
  pr_commits              integer NOT NULL CHECK (pr_commits >= 0),
  pr_arquivos_adicionados integer NOT NULL CHECK (pr_arquivos_adicionados >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (solicitacao_id, pr_numero)
);
ALTER TABLE public."HORA_EXTRA_PR_VALIDACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."HORA_EXTRA_PR_VALIDACAO" FROM PUBLIC, anon, authenticated;

-- 2) Resolve o chamado extraído do título da PR -----------------------
-- A Edge Function chama esta RPC com o JWT do usuário. Assim o serviço que
-- tem GITHUB_TOKEN não precisa confiar em um chamado_id enviado pelo browser.
CREATE OR REPLACE FUNCTION public.hora_extra_pr_chamado(
  p_solicitacao_id uuid,
  p_numero text
)
RETURNS TABLE (
  id uuid,
  numero text,
  assunto text,
  prioridade text,
  setor text,
  responsavel_id uuid,
  responsavel_nome text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_solicitacao record;
  v_chamado record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;

  SELECT s.id, s.colaborador_id, s.data_he
  INTO v_solicitacao
  FROM public."HORA_EXTRA_SOLICITACAO" s
  WHERE s.id = p_solicitacao_id
    AND s.colaborador_id = v_uid
    AND s.status = 'aprovada';

  IF v_solicitacao.id IS NULL THEN
    RAISE EXCEPTION 'Esta solicitação de HE não está disponível para preenchimento.';
  END IF;

  SELECT
    c.id,
    c.numero,
    c.assunto,
    c.prioridade,
    c.setor,
    c.responsavel_id,
    p.display_name AS responsavel_nome
  INTO v_chamado
  FROM public."CHAMADO_SISTEMA" c
  LEFT JOIN public.profiles p ON p.id = c.responsavel_id
  WHERE c.numero = upper(btrim(p_numero));

  IF v_chamado.id IS NULL THEN
    RAISE EXCEPTION 'O chamado % não foi encontrado.', upper(btrim(p_numero));
  END IF;

  PERFORM public.hora_extra_checar_chamado(
    v_chamado.id,
    v_solicitacao.colaborador_id,
    v_solicitacao.data_he
  );

  RETURN QUERY SELECT
    v_chamado.id,
    v_chamado.numero,
    v_chamado.assunto,
    v_chamado.prioridade,
    v_chamado.setor,
    v_chamado.responsavel_id,
    v_chamado.responsavel_nome;
END;
$fn$;

-- 3) Conclusão com PR obrigatória -------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_concluir(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid;
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_item jsonb;
  v_chamado record;
  v_jornada int;
  v_entrada time;
  v_saida_intervalo time;
  v_retorno_intervalo time;
  v_saida time;
  v_trabalhado int;
  v_total int;
  v_inicio time;
  v_pr public."HORA_EXTRA_PR_VALIDACAO"%ROWTYPE;
  v_linhas_adicionadas integer;
  v_commits integer;
  v_arquivos_adicionados integer;
  v_linhas jsonb := coalesce(p->'chamados', '[]'::jsonb) || coalesce(p->'adicionais', '[]'::jsonb);
BEGIN
  SELECT *
  INTO v_s
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = v_id
  FOR UPDATE;

  IF v_s.id IS NULL
  OR v_s.colaborador_id <> v_uid
  OR v_s.status <> 'aprovada' THEN
    RAISE EXCEPTION 'Esta HE não pode ser concluída por você.';
  END IF;

  IF v_s.data_he > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A HE só pode ser concluída na data prevista ou depois dela.';
  END IF;

  IF jsonb_array_length(coalesce(p->'chamados', '[]'::jsonb)) <> (
    SELECT count(*)
    FROM public."HORA_EXTRA_CHAMADO" c
    WHERE c.solicitacao_id = v_id
      AND c.adicional = false
  ) THEN
    RAISE EXCEPTION 'Informe o resultado de todos os chamados originais.';
  END IF;

  IF nullif(btrim(p->>'resumo_conclusao'), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha o resumo e observações.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_linhas) x
    WHERE coalesce(x->>'pr_numero', '') !~ '^[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'Informe e valide uma PR do GitHub para cada chamado realizado na HE.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT x->>'pr_numero' AS pr_numero
      FROM jsonb_array_elements(v_linhas) x
    ) prs
    GROUP BY pr_numero
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A mesma PR não pode ser vinculada a mais de um chamado nesta HE.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_linhas) x
    WHERE nullif(x->>'percentual_concluido', '') IS NULL
       OR (x->>'percentual_concluido')::numeric < 0
       OR (x->>'percentual_concluido')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'O percentual concluído de cada chamado deve ficar entre 0%% e 100%%.';
  END IF;

  v_jornada := coalesce(
    v_s.jornada_minutos,
    (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1)
  );

  v_entrada := (p->>'ponto_entrada_real')::time;
  v_saida_intervalo := (p->>'ponto_saida_intervalo_real')::time;
  v_retorno_intervalo := (p->>'ponto_retorno_intervalo_real')::time;
  v_saida := (p->>'ponto_saida_real')::time;

  v_trabalhado := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  v_total := public.hora_extra_excedente(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );
  v_inicio := public.hora_extra_inicio(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );

  IF v_total <= 0 THEN
    RAISE EXCEPTION
      'Os horários informados somam %, dentro da jornada de %. Não há hora extra a registrar.',
      public.hora_extra_formatar_minutos(v_trabalhado),
      public.hora_extra_formatar_minutos(v_jornada);
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    ponto_entrada_real = v_entrada,
    ponto_saida_intervalo_real = v_saida_intervalo,
    ponto_retorno_intervalo_real = v_retorno_intervalo,
    ponto_saida_real = v_saida,
    trabalhado_real_min = v_trabalhado,
    he_inicio_real = v_inicio,
    he_fim_real = v_saida,
    total_real_min = v_total,
    resumo_conclusao = btrim(p->>'resumo_conclusao'),
    status = 'aguardando_validacao',
    conclusao_enviada_em = now(),
    motivo_devolucao = NULL
  WHERE id = v_id;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb))
  LOOP
    SELECT *
    INTO v_pr
    FROM public."HORA_EXTRA_PR_VALIDACAO"
    WHERE solicitacao_id = v_id
      AND pr_numero = (v_item->>'pr_numero')::integer;

    IF v_pr.id IS NULL THEN
      RAISE EXCEPTION 'A PR #% precisa ser consultada novamente antes do envio.', v_item->>'pr_numero';
    END IF;

    UPDATE public."HORA_EXTRA_CHAMADO"
    SET
      percentual_concluido = 100,
      status_execucao = 'concluido',
      observacao = nullif(btrim(v_item->>'observacao'), ''),
      pr_numero = v_pr.pr_numero,
      pr_url = v_pr.pr_url,
      pr_titulo = v_pr.pr_titulo,
      pr_linhas_adicionadas = v_pr.pr_linhas_adicionadas,
      pr_commits = v_pr.pr_commits,
      pr_arquivos_adicionados = v_pr.pr_arquivos_adicionados
    WHERE id = (v_item->>'id')::uuid
      AND solicitacao_id = v_id
      AND adicional = false
      AND chamado_id = v_pr.chamado_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A PR #% não pertence ao chamado original informado nesta HE.', v_pr.pr_numero;
    END IF;
  END LOOP;

  DELETE FROM public."HORA_EXTRA_CHAMADO"
  WHERE solicitacao_id = v_id
    AND adicional = true;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'adicionais', '[]'::jsonb))
  LOOP
    SELECT *
    INTO v_pr
    FROM public."HORA_EXTRA_PR_VALIDACAO"
    WHERE solicitacao_id = v_id
      AND pr_numero = (v_item->>'pr_numero')::integer;

    IF v_pr.id IS NULL THEN
      RAISE EXCEPTION 'A PR #% precisa ser consultada novamente antes do envio.', v_item->>'pr_numero';
    END IF;

    PERFORM public.hora_extra_checar_chamado(
      v_pr.chamado_id,
      v_uid,
      v_s.data_he
    );

    SELECT
      c.id,
      c.numero,
      c.assunto,
      c.setor,
      c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = v_pr.chamado_id;

    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id,
      chamado_id,
      chamado_numero,
      chamado_assunto,
      chamado_setor,
      prioridade,
      adicional,
      percentual_previsto,
      percentual_concluido,
      status_execucao,
      observacao,
      pr_numero,
      pr_url,
      pr_titulo,
      pr_linhas_adicionadas,
      pr_commits,
      pr_arquivos_adicionados
    )
    VALUES (
      v_id,
      v_chamado.id,
      v_chamado.numero,
      v_chamado.assunto,
      v_chamado.setor,
      v_chamado.prioridade,
      true,
      NULL,
      100,
      'concluido',
      nullif(btrim(v_item->>'observacao'), ''),
      v_pr.pr_numero,
      v_pr.pr_url,
      v_pr.pr_titulo,
      v_pr.pr_linhas_adicionadas,
      v_pr.pr_commits,
      v_pr.pr_arquivos_adicionados
    );
  END LOOP;

  SELECT
    coalesce(sum(c.pr_linhas_adicionadas), 0),
    coalesce(sum(c.pr_commits), 0),
    coalesce(sum(c.pr_arquivos_adicionados), 0)
  INTO v_linhas_adicionadas, v_commits, v_arquivos_adicionados
  FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.pr_numero IS NOT NULL;

  INSERT INTO public."HORA_EXTRA_EVENTO" (
    solicitacao_id,
    autor_id,
    acao,
    texto,
    meta
  )
  VALUES (
    v_id,
    v_uid,
    'concluida',
    'Conclusão enviada para validação',
    jsonb_build_object(
      'prs', (SELECT count(*) FROM jsonb_array_elements(v_linhas)),
      'linhas_adicionadas', v_linhas_adicionadas,
      'commits', v_commits,
      'arquivos_adicionados', v_arquivos_adicionados
    )
  );

  DELETE FROM public."HORA_EXTRA_PR_VALIDACAO"
  WHERE solicitacao_id = v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_pr_chamado(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_pr_chamado(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_concluir(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_concluir(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP INDEX IF EXISTS public.idx_hora_extra_chamado_solicitacao_pr;
-- DROP FUNCTION IF EXISTS public.hora_extra_pr_chamado(uuid, text);
-- DROP TABLE IF EXISTS public."HORA_EXTRA_PR_VALIDACAO";
-- ALTER TABLE public."HORA_EXTRA_CHAMADO"
--   DROP COLUMN IF EXISTS pr_numero,
--   DROP COLUMN IF EXISTS pr_url,
--   DROP COLUMN IF EXISTS pr_titulo,
--   DROP COLUMN IF EXISTS pr_linhas_adicionadas,
--   DROP COLUMN IF EXISTS pr_commits,
--   DROP COLUMN IF EXISTS pr_arquivos_adicionados;
-- A versão anterior de hora_extra_concluir está em
-- supabase/migrations/20260930000166_hora_extra_escala_e_calculo.sql.
