-- =========================================================================
-- RH — POSTO do colaborador vem da Senior SOZINHO (de 15 em 15 min) +
-- relatório de SANEAMENTO dos postos (Senior × ERP)          (13/11/2026)
--
-- PEDIDO (chamado da Operação): "Temos colaboradores ativos 'sem vínculo de
-- postos' no sistema. Isso impede que os supervisores validem o efetivo real
-- diário [...] O comportamento esperado é que a associação do colaborador ao
-- seu posto ocorra em tempo real e de forma automatizada [...] precisamos
-- garantir que essa base seja saneada antes da migração [da folha]."
--
-- CAUSA (a parte que é do sistema)
--   EMPREGADOS."Posto" / "Nome do Posto" NINGUÉM atualiza:
--     · rh_sync_senior_pelo_espelho (mig 20261020000110) traz nome, datas,
--       situação, filial, CPF, PIS e salário;
--     · rh_completar_ficha_do_senior (mig 20261019000004) traz cargo, local e
--       escala; rh_sync_adicionais_do_senior (mig 20261026000900),
--       insalubridade e periculosidade.
--   O posto só entrou UMA vez, à mão, pela planilha exportada da Senior (mig
--   20261002000007, 02/10/2026 — 253 corrigidos, 181 ativos estavam SEM
--   posto). De lá para cá, todo admitido chega sem posto e toda troca de
--   posto feita na Senior não chega: a pessoa cai em "Definir o posto" no
--   Ativos/Contratos (ou fica no posto antigo) até alguém mover à mão.
--
-- O QUE MUDA
--   1. rh_sync_posto_do_senior(): reescreve "Posto" pelo espelho
--      (BiEmpregados.postra, tipcol = 1, linha mais recente da pessoa) quando
--      difere. Senior sem posto nunca apaga o que o ERP tem. Toda linha
--      alterada vai para EMPREGADOS_SYNC_SENIOR_LOG (antes/depois).
--      "Nome do Posto" só muda quando o CÓDIGO mudou (ou o nome está vazio /
--      é o próprio código): o RH_POSTO_DEPARA liga o posto da Senior ao da
--      planilha pelo NOME — trocar só a grafia desligaria gente que já está
--      no posto certo (mesmo cuidado do "Título do Cargo" na mig 20261019000004).
--      Pelo mesmo motivo o nome novo é, de preferência, o texto que os
--      colegas do mesmo código já têm no EMPREGADOS; sem colega, a descrição
--      da BiPostos; sem ela, o próprio código (a rodada seguinte troca
--      quando a BiPostos chegar — ela só vem na carga diária do espelho).
--      CERCA: se mais de 25% dos ativos fossem trocar de código numa rodada
--      só, não é rotina, é formato diferente no espelho — a função NÃO grava
--      nada e deixa o aviso em RH_SENIOR_SYNC_RODADA. p_simular = true só
--      conta; p_forcar = true passa pela cerca (decisão de gente, não do cron).
--   2. Posto novo criado na Senior entra sozinho em RH_POSTO_TRABALHO (antes
--      só pelo botão da Hierarquia de Postos, rh_hier_sincronizar_postos).
--   3. pg_cron próprio, 'rh-sync-posto-senior' (8, 23, 38, 53 — 3 min depois
--      do rh-sync-senior-espelho, para pegar o admitido que acabou de entrar).
--      Job separado de propósito: a rh_sync_senior_pelo_espelho já é
--      remendada por trecho em outras migrations (20261113000100) e reescrevê-
--      la inteira aqui apagaria o que entrou nela.
--   4. rh_ac_saneamento_postos(): leitura para o relatório de saneamento em
--      Operacional › Ativos/Contratos — cada posto da Senior (código + nome)
--      em uso por contrato, quanta gente, a que posto(s) da Planilha de Custo
--      (a fonte da verdade) está ligado; e cada posto da planilha com quem o
--      ocupa. É a lista do que renomear/recodificar na Senior — e a carga do
--      de-para para o sistema de folha novo. Mesmo gate do painel
--      (rh_ac_exige); nada de menu ou permissão nova.
--
-- NÃO roda na aplicação: a primeira rodada é a do cron. Para ver antes o que
-- ela faria:  SELECT public.rh_sync_posto_do_senior(true);
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Posto do colaborador pela Senior ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_sync_posto_do_senior(
  p_simular boolean DEFAULT false,
  p_forcar  boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  t0            timestamptz := clock_timestamp();
  v_ativos      int;
  v_ativos_cod  int;
  v_mudam       int;
  v_n           int := 0;
  v_postos      int := 0;
  v_out         jsonb;
BEGIN
  IF to_regclass('espelho."BiEmpregados"') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'espelho sem BiEmpregados');
  END IF;
  -- Uma rodada por vez.
  IF NOT pg_try_advisory_xact_lock(hashtext('rh_sync_posto_do_senior')) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'outra rodada em andamento');
  END IF;

  -- Descrição de cada posto na Senior. A BiPostos pode não existir neste
  -- banco (ou vir sem a coluna): aí o nome sai dos colegas ou do código.
  DROP TABLE IF EXISTS pg_temp._rh_posto_cat;
  CREATE TEMP TABLE _rh_posto_cat (codigo text PRIMARY KEY, descricao text) ON COMMIT DROP;
  IF to_regclass('espelho."BiPostos"') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        INSERT INTO pg_temp._rh_posto_cat (codigo, descricao)
        SELECT DISTINCT ON (x.codigo) x.codigo, x.descricao
          FROM (SELECT btrim(to_jsonb(p)->>'codigo_posto') AS codigo,
                       nullif(btrim(to_jsonb(p)->>'descricao'), '') AS descricao
                  FROM espelho."BiPostos" p) x
         WHERE COALESCE(x.codigo, '') <> '' AND x.descricao IS NOT NULL
         ORDER BY x.codigo, x.descricao $q$;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- sem catálogo: segue com o nome dos colegas / o código
    END;
  END IF;

  DROP TABLE IF EXISTS pg_temp._rh_posto_calc;
  CREATE TEMP TABLE _rh_posto_calc ON COMMIT DROP AS
  WITH bi AS (
    -- Uma linha por (empresa, cadastro) de EMPREGADO (tipcol = 1); o espelho
    -- repete a pessoa quando ela mudou de situação: fica a mais recente.
    -- to_jsonb: coluna que não existir vira NULL em vez de derrubar a rodada.
    SELECT DISTINCT ON (b.numemp, b.numcad)
           b.numemp, b.numcad, nullif(btrim(to_jsonb(b)->>'postra'), '') AS postra
      FROM espelho."BiEmpregados" b
     WHERE b.tipcol = 1
     ORDER BY b.numemp, b.numcad, b.datadm DESC NULLS LAST
  ),
  casa AS (
    -- O nome que o ERP já usa para cada código (o mais comum) — é por ele
    -- que o RH_POSTO_DEPARA liga o posto ao da planilha.
    SELECT DISTINCT ON (t.posto) t.posto, t.nome
      FROM (SELECT btrim(e."Posto"::text) AS posto, btrim(e."Nome do Posto"::text) AS nome, count(*) AS n
              FROM public."EMPREGADOS" e
             WHERE COALESCE(btrim(e."Posto"::text), '') <> ''
               AND COALESCE(btrim(e."Nome do Posto"::text), '') <> ''
               AND btrim(e."Nome do Posto"::text) <> btrim(e."Posto"::text)
             GROUP BY 1, 2) t
     ORDER BY t.posto, t.n DESC, t.nome
  )
  SELECT e."ID" AS id, e."Empresa" AS empresa, e."Cadastro" AS cadastro,
         public.esp_col_esta_ativo(e."Situação") AS ativo,
         e."Posto"::text AS posto_antes, e."Nome do Posto"::text AS nome_antes,
         bi.postra AS posto_novo,
         bi.postra IS DISTINCT FROM nullif(btrim(e."Posto"::text), '') AS codigo_mudou,
         CASE WHEN bi.postra IS DISTINCT FROM nullif(btrim(e."Posto"::text), '')
                OR nullif(btrim(e."Nome do Posto"::text), '') IS NULL
                OR btrim(e."Nome do Posto"::text) = bi.postra
              THEN COALESCE(casa.nome, cat.descricao, bi.postra)
              ELSE e."Nome do Posto"::text END AS nome_novo
    FROM public."EMPREGADOS" e
    JOIN bi ON bi.numemp = e."Empresa" AND bi.numcad = e."Cadastro"
    LEFT JOIN casa ON casa.posto = bi.postra
    LEFT JOIN pg_temp._rh_posto_cat cat ON cat.codigo = bi.postra
   WHERE bi.postra IS NOT NULL;   -- Senior sem posto nunca apaga o do ERP

  SELECT count(*) FILTER (WHERE ativo),
         count(*) FILTER (WHERE ativo AND codigo_mudou),
         count(*) FILTER (WHERE codigo_mudou OR nome_novo IS DISTINCT FROM nome_antes)
    INTO v_ativos, v_ativos_cod, v_mudam
    FROM pg_temp._rh_posto_calc;

  v_out := jsonb_build_object(
    'ativos_com_posto_na_senior', v_ativos,
    'ativos_que_trocam_de_codigo', v_ativos_cod,
    'linhas_que_mudam', v_mudam);

  -- CERCA: troca em massa não é rotina. Não grava; avisa.
  IF NOT p_forcar AND v_ativos_cod > GREATEST(50, (v_ativos * 0.25)::int) THEN
    v_out := v_out || jsonb_build_object('ok', false, 'posto', true,
      'motivo', 'mais de 25% dos ativos trocariam de posto de uma vez — nada gravado. '
             || 'Confira com SELECT public.rh_sync_posto_do_senior(true); se estiver certo, '
             || 'rode SELECT public.rh_sync_posto_do_senior(false, true);');
    IF NOT p_simular THEN
      INSERT INTO public."RH_SENIOR_SYNC_RODADA" (duracao_ms, resultado)
      VALUES ((extract(epoch FROM clock_timestamp() - t0) * 1000)::int, v_out);
    END IF;
    RETURN v_out;
  END IF;

  IF p_simular THEN
    RETURN v_out || jsonb_build_object('ok', true, 'simulado', true, 'amostra', COALESCE((
      SELECT jsonb_agg(to_jsonb(a)) FROM (
        SELECT c.id, c.ativo, c.posto_antes, c.nome_antes, c.posto_novo, c.nome_novo
          FROM pg_temp._rh_posto_calc c
         WHERE c.codigo_mudou OR c.nome_novo IS DISTINCT FROM c.nome_antes
         ORDER BY c.ativo DESC, c.id DESC LIMIT 30) a), '[]'::jsonb));
  END IF;

  WITH upd AS (
    UPDATE public."EMPREGADOS" e
       SET "Posto" = c.posto_novo, "Nome do Posto" = c.nome_novo
      FROM pg_temp._rh_posto_calc c
     WHERE e."ID" = c.id
       AND (c.codigo_mudou OR c.nome_novo IS DISTINCT FROM c.nome_antes)
    RETURNING c.id, c.empresa, c.cadastro,
              jsonb_build_object('Posto', c.posto_antes, 'Nome do Posto', c.nome_antes) AS antes,
              jsonb_build_object('Posto', c.posto_novo, 'Nome do Posto', c.nome_novo) AS depois
  )
  INSERT INTO public."EMPREGADOS_SYNC_SENIOR_LOG" (empregado_id, empresa, cadastro, pessoa_trocada, antes, depois)
  SELECT id, empresa, cadastro, false, antes, depois FROM upd;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- 2. Posto novo da Senior entra no cadastro de postos do ERP (mesma carga
  --    do rh_hier_sincronizar_postos, sem depender de alguém apertar o botão).
  IF to_regclass('espelho."BiPostos"') IS NOT NULL AND to_regclass('public."RH_POSTO_TRABALHO"') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        WITH novos AS (
          INSERT INTO public."RH_POSTO_TRABALHO" (codigo, descricao, empresa, filial, local_cod, cargo_cod, sindicato_cod, titulo, criado_senior)
          SELECT b.codigo_posto, btrim(b.descricao),
                 CASE WHEN split_part(b.descricao, '-', 1) ~ '^\d+$' THEN split_part(b.descricao, '-', 1)::int END,
                 CASE WHEN split_part(b.descricao, '-', 2) ~ '^\d+$' THEN split_part(b.descricao, '-', 2)::int END,
                 split_part(b.descricao, '-', 3), split_part(b.descricao, '-', 4), split_part(b.descricao, '-', 5),
                 NULLIF(btrim(regexp_replace(btrim(b.descricao), '^([^-]*-){5}', '')), ''), b.data_criacao::date
            FROM espelho."BiPostos" b
           WHERE b.codigo_posto LIKE 'PO-%' AND COALESCE(btrim(b.descricao), '') <> ''
          ON CONFLICT (codigo) DO NOTHING
          RETURNING 1)
        SELECT count(*) FROM novos $q$ INTO v_postos;
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object('postos_novos_erro', SQLERRM);
    END;
  END IF;

  v_out := v_out || jsonb_build_object('ok', true, 'posto', true, 'postos_corrigidos', v_n, 'postos_novos', v_postos);
  -- Só deixa rastro quando fez alguma coisa (o job roda 96 vezes por dia).
  IF v_n > 0 OR v_postos > 0 THEN
    INSERT INTO public."RH_SENIOR_SYNC_RODADA" (duracao_ms, resultado)
    VALUES ((extract(epoch FROM clock_timestamp() - t0) * 1000)::int, v_out);
  END IF;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.rh_sync_posto_do_senior(boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_posto_do_senior(boolean, boolean) TO service_role;

-- ── 3. Agenda ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: rh-sync-posto-senior não agendado.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rh-sync-posto-senior') THEN
    PERFORM cron.unschedule('rh-sync-posto-senior');
  END IF;
  PERFORM cron.schedule('rh-sync-posto-senior', '8,23,38,53 * * * *',
                        'SELECT public.rh_sync_posto_do_senior()');
END $$;

-- ── 4. Saneamento: postos da Senior × postos do ERP ──────────────────────
-- Só leitura. "Quem ocupa qual posto" sai de rh_ac_pessoas_posto() — a mesma
-- regra do Ativos/Contratos e da Efetividade, para o relatório nunca
-- discordar da tela onde o supervisor trabalha.
CREATE OR REPLACE FUNCTION public.rh_ac_saneamento_postos()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.rh_ac_exige();

  WITH pes AS MATERIALIZED (
    SELECT a.contrato_id, a.posto_senior, a.posto, a.fora, a.rt,
           COALESCE(btrim(e."Posto"::text), '') AS codigo
      FROM public.rh_ac_pessoas_posto() a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
     WHERE a.contrato_id IS NOT NULL
  ),
  grp AS (
    SELECT p.contrato_id, p.codigo, p.posto_senior,
           count(*)::int AS pessoas,
           (count(*) FILTER (WHERE NOT p.fora AND p.posto IS NULL))::int AS sem_posto,
           (count(*) FILTER (WHERE p.fora))::int AS fora,
           (count(*) FILTER (WHERE p.rt AND NOT p.fora))::int AS rt,
           COALESCE(array_agg(DISTINCT p.posto) FILTER (WHERE p.posto IS NOT NULL AND NOT p.rt AND NOT p.fora), '{}') AS postos_erp
      FROM pes p
     GROUP BY 1, 2, 3
  ),
  base AS MATERIALIZED (
    SELECT b.contrato_id, b.posto, b.previsto, b.implantado
      FROM public.contrato_postos_base(current_date) b
     WHERE NOT b.rt
  ),
  ocup AS (
    SELECT p.contrato_id, p.posto, count(*)::int AS pessoas,
           array_agg(DISTINCT NULLIF(p.codigo, '')) FILTER (WHERE p.codigo <> '') AS codigos
      FROM pes p
     WHERE p.posto IS NOT NULL AND NOT p.fora AND NOT p.rt
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'gerado_em', now(),
    'senior', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'contrato_id', c.id, 'contrato', c.nome, 'codigo', g.codigo, 'posto_senior', g.posto_senior,
                'pessoas', g.pessoas, 'sem_posto', g.sem_posto, 'fora', g.fora, 'rt', g.rt,
                'postos_erp', to_jsonb(g.postos_erp))
                ORDER BY c.nome, g.posto_senior, g.codigo)
         FROM grp g JOIN public.contratos c ON c.id = g.contrato_id), '[]'::jsonb),
    'erp', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'contrato_id', c.id, 'contrato', c.nome, 'posto', b.posto,
                'previsto', b.previsto, 'implantado', b.implantado,
                'pessoas', COALESCE(o.pessoas, 0), 'codigos_senior', COALESCE(to_jsonb(o.codigos), '[]'::jsonb))
                ORDER BY c.nome, b.posto)
         FROM base b
         JOIN public.contratos c ON c.id = b.contrato_id
         LEFT JOIN ocup o ON o.contrato_id = b.contrato_id AND o.posto = b.posto
        WHERE COALESCE(c.status, 'ativo') <> 'encerrado'), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.rh_ac_saneamento_postos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_ac_saneamento_postos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT public.rh_sync_posto_do_senior(true);                       -- o que mudaria
--   SELECT rodada_em, resultado FROM public."RH_SENIOR_SYNC_RODADA"
--    WHERE resultado ? 'posto' ORDER BY id DESC LIMIT 5;                -- o que mudou / cerca
--   SELECT empregado_id, antes, depois, criado_em FROM public."EMPREGADOS_SYNC_SENIOR_LOG"
--    WHERE antes ? 'Posto' ORDER BY id DESC LIMIT 50;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('rh-sync-posto-senior');
-- DROP FUNCTION IF EXISTS public.rh_ac_saneamento_postos();
-- DROP FUNCTION IF EXISTS public.rh_sync_posto_do_senior(boolean, boolean);
-- Postos: EMPREGADOS_SYNC_SENIOR_LOG guarda o "antes" de cada linha alterada:
-- UPDATE public."EMPREGADOS" e SET "Posto" = l.antes->>'Posto', "Nome do Posto" = l.antes->>'Nome do Posto'
--   FROM (SELECT DISTINCT ON (empregado_id) empregado_id, antes FROM public."EMPREGADOS_SYNC_SENIOR_LOG"
--          WHERE antes ? 'Posto' AND criado_em >= '<data da aplicação>' ORDER BY empregado_id, id) l
--  WHERE l.empregado_id = e."ID";
-- NOTIFY pgrst, 'reload schema';
