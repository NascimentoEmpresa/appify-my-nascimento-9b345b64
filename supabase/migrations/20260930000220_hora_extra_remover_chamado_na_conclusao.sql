-- =====================================================================
-- HORA EXTRA — remover chamado do relatório no momento da conclusão.
--
-- A solicitação é feita ANTES da hora extra: a pessoa lista o que pretende
-- fazer. Na hora de concluir, a mig 194 passou a exigir uma PR do GitHub
-- para cada linha do relatório e, junto, manteve a trava
--
--     jsonb_array_length(p->'chamados') = (nº de chamados originais no banco)
--     -> 'Informe o resultado de todos os chamados originais.'
--
-- As duas regras juntas fecharam o fluxo: chamado planejado que NÃO foi
-- realizado na HE (o solicitante não respondeu, a análise mudou, a pessoa
-- atacou outro chamado mais urgente) não tem PR para informar e, como a
-- linha não podia sair da tabela, a conclusão inteira ficava presa — foi o
-- que aconteceu na HE de 22/09/2026 com SIS-2026-0496 e SIS-2026-0490.
--
-- Agora o relatório manda: o que ficou na tabela é o que foi feito. O
-- chamado retirado some de HORA_EXTRA_CHAMADO — ele mesmo continua aberto
-- em CHAMADO_SISTEMA e reaparece normalmente em hora_extra_chamados_
-- disponiveis para entrar em outra HE — e fica registrado nominalmente no
-- meta do evento 'concluida'. Esse rastro não é enfeite: sem ele o gestor
-- valida a HE sem saber que ela entregou menos do que prometeu.
--
-- Continua valendo: toda linha que PERMANECE exige PR validada, e a HE não
-- pode ser concluída com o relatório vazio.
-- =====================================================================

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
  v_removidos jsonb;
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

  -- No lugar da antiga igualdade com o total de chamados originais: o
  -- relatório pode ser menor do que o planejado, mas nunca vazio.
  IF jsonb_array_length(v_linhas) = 0 THEN
    RAISE EXCEPTION 'Informe pelo menos um chamado realizado nesta hora extra.';
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

  -- Chamados originais que a pessoa tirou da tabela antes de enviar.
  -- A comparação é por texto de propósito: id vazio ou com lixo vindo do
  -- navegador não pode derrubar a transação num cast de uuid — a linha
  -- simplesmente não casa com nenhuma e é tratada como removida.
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'chamado', c.chamado_numero,
               'assunto', c.chamado_assunto
             )
             ORDER BY c.chamado_numero
           ),
           '[]'::jsonb
         )
  INTO v_removidos
  FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.adicional = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb)) x
      WHERE btrim(coalesce(x->>'id', '')) = c.id::text
    );

  DELETE FROM public."HORA_EXTRA_CHAMADO" c
  WHERE c.solicitacao_id = v_id
    AND c.adicional = false
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb)) x
      WHERE btrim(coalesce(x->>'id', '')) = c.id::text
    );

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
      'arquivos_adicionados', v_arquivos_adicionados,
      'chamados_removidos', v_removidos
    )
  );

  DELETE FROM public."HORA_EXTRA_PR_VALIDACAO"
  WHERE solicitacao_id = v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hora_extra_concluir(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_concluir(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Reaplique o corpo de public.hora_extra_concluir(jsonb) como está na
-- migration 20260930000194_hora_extra_pr_github.sql (seção 3). Voltar a
-- versão anterior devolve a trava 'Informe o resultado de todos os chamados
-- originais.' e o relatório volta a não aceitar linha removida.
-- NOTIFY pgrst, 'reload schema';
