-- =====================================================================
-- RH › Cadastro da Senior SEM ROBÔ — o banco atualiza o EMPREGADOS a partir
-- do espelho (20/10/2026).
--
-- O PROBLEMA: o robô integracao-senior (Discloud) lia a Senior por SSH e
-- chamava rh_sync_senior_situacoes / rh_sync_senior_empregados pela API. Ele
-- continuou apontando para a Supabase antiga depois da virada para o cluster
-- (16/10): a situação, o cargo e a admissão de todo mundo congelaram na
-- produção — ex.: VERA ELAINE seguia "Atestado (dias)" depois de voltar dia
-- 18, com ponto batido. O Pablo: "depender do Discloud não rola mais".
--
-- A SAÍDA: o espelho (GitHub Actions → cluster, espelho_mysql.yml) JÁ copia
-- hagg.BiEmpregados e hagg.BiSituacoes para o schema espelho — as mesmas
-- duas tabelas que o robô lia. Então o próprio banco faz a conta, de 15 em
-- 15 minutos (pg_cron), e o robô sai de cena:
--
--   rh_sync_senior_pelo_espelho():
--     1. SITUACOES  ← espelho."BiSituacoes"   (rh_sync_senior_situacoes)
--     2. EMPREGADOS ← espelho."BiEmpregados"  (rh_sync_senior_empregados,
--        mesma montagem do payload que a mig 20260930000275 já usou e que
--        reproduz o robô: tipcol = 1, datas DD/MM/AAAA, 1901 = sem data,
--        salário em texto pt-BR; o CPF com zero à esquerda é o gatilho
--        trg_rh_empregados_cpf_padrao que acerta)
--     3. Escala do colaborador (rh_sync_escala_espelho, mig 20261015000004):
--        o espelho chamava no fim da carga diária, mas no cluster o papel
--        espelho_carga não enxerga public e a chamada falhava (só aviso) —
--        aqui ela volta a rodar.
--
--   A regra de quem insere/atualiza continua UMA SÓ, nas funções de sempre.
--   Trava (advisory lock) para duas rodadas não se sobreporem — a função de
--   empregados gera "ID" por max()+1 e não aguenta concorrência.
--   Cada rodada deixa uma linha em RH_SENIOR_SYNC_RODADA (as 500 últimas):
--   é por ali que se confere que está rodando.
--
-- O frescor vem do espelho: a rodada rápida (10 em 10 min) passa a trazer
-- BiSituacoes e BiEmpregados junto com as batidas (espelho_mysql.yml).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."RH_SENIOR_SYNC_RODADA" (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rodada_em  timestamptz NOT NULL DEFAULT now(),
  duracao_ms integer,
  resultado  jsonb
);
-- Sem policy: só o banco (cron) e quem administra o servidor leem.
ALTER TABLE public."RH_SENIOR_SYNC_RODADA" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rh_sync_senior_pelo_espelho()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_sit jsonb;
  v_emp jsonb;
  v_esc jsonb := NULL;
  v_out jsonb;
  v_qtd int;
BEGIN
  IF to_regclass('espelho."BiEmpregados"') IS NULL OR to_regclass('espelho."BiSituacoes"') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'espelho sem BiEmpregados/BiSituacoes');
  END IF;
  -- Uma rodada por vez (a próxima do cron espera a vez seguinte).
  IF NOT pg_try_advisory_xact_lock(hashtext('rh_sync_senior_pelo_espelho')) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'outra rodada em andamento');
  END IF;
  SELECT count(*) INTO v_qtd FROM espelho."BiEmpregados" WHERE tipcol = 1;
  -- Espelho vazio não é "todo mundo saiu": não mexe em nada.
  IF v_qtd = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'espelho."BiEmpregados" vazio');
  END IF;

  -- 1. Situações (a dimensão vai antes: o código gravado no empregado aponta para ela).
  v_sit := public.rh_sync_senior_situacoes(coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'codigo', nullif(regexp_replace(s.situacao::text, '\D', '', 'g'), '')::int,
             'descricao', btrim(coalesce(s.descricao::text, '')),
             'abreviatura', nullif(btrim(coalesce(s.abreviatura::text, '')), ''),
             'tipo', nullif(btrim(coalesce(s.tipo::text, '')), ''),
             'tipo_descricao', nullif(btrim(coalesce(s.tipo_descricao::text, '')), '')))
      FROM espelho."BiSituacoes" s), '[]'::jsonb));

  -- 2. Empregados (mesma montagem da mig 20260930000275).
  v_emp := public.rh_sync_senior_empregados(coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'empresa', b.numemp, 'cadastro', b.numcad, 'nome', btrim(b.nomfun),
             'admissao',   CASE WHEN b.datadm IS NULL OR extract(year FROM b.datadm) <= 1901 THEN NULL ELSE to_char(b.datadm, 'DD/MM/YYYY') END,
             'data_afastamento', CASE WHEN b.datafa IS NULL OR extract(year FROM b.datafa) <= 1901 THEN NULL ELSE to_char(b.datafa, 'DD/MM/YYYY') END,
             'nascimento', CASE WHEN b.datnas IS NULL OR extract(year FROM b.datnas) <= 1901 THEN NULL ELSE to_char(b.datnas, 'DD/MM/YYYY') END,
             'situacao', nullif(btrim(coalesce(s.descricao, '')), ''),
             'cod_situacao', b.sitafa,
             'filial', b.codfil,
             'sexo', nullif(btrim(coalesce(b.tipsex, '')), ''),
             'cpf', nullif(b.numcpf::text, ''),
             'pis', nullif(b.numpis::text, ''),
             'salario', CASE WHEN b.valsal IS NULL THEN NULL
                             ELSE replace(replace(replace(to_char(b.valsal, 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.') END))
      FROM espelho."BiEmpregados" b
      LEFT JOIN espelho."BiSituacoes" s
             ON nullif(regexp_replace(s.situacao::text, '\D', '', 'g'), '')::int = b.sitafa
     WHERE b.tipcol = 1), '[]'::jsonb));

  -- 3. Escala (se a função existir neste banco).
  IF to_regprocedure('public.rh_sync_escala_espelho()') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(public.rh_sync_escala_espelho())' INTO v_esc;
  END IF;

  v_out := jsonb_build_object('ok', true, 'situacoes', v_sit, 'empregados', v_emp, 'escala', v_esc);
  INSERT INTO public."RH_SENIOR_SYNC_RODADA" (duracao_ms, resultado)
  VALUES ((extract(epoch FROM clock_timestamp() - t0) * 1000)::int, v_out);
  DELETE FROM public."RH_SENIOR_SYNC_RODADA"
   WHERE id < (SELECT min(id) FROM (SELECT id FROM public."RH_SENIOR_SYNC_RODADA" ORDER BY id DESC LIMIT 500) x);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_sync_senior_pelo_espelho() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_pelo_espelho() TO service_role;

-- ── Agenda: de 15 em 15 minutos, dentro do banco ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - agendamento nao criado (esperado na replica)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rh-sync-senior-espelho') THEN
    PERFORM cron.unschedule('rh-sync-senior-espelho');
  END IF;
  PERFORM cron.schedule('rh-sync-senior-espelho', '5,20,35,50 * * * *',
                        'SELECT public.rh_sync_senior_pelo_espelho()');
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT rodada_em, duracao_ms, resultado FROM public."RH_SENIOR_SYNC_RODADA" ORDER BY id DESC LIMIT 5;
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'rh-sync-senior-espelho') ORDER BY start_time DESC LIMIT 5;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('rh-sync-senior-espelho');
-- DROP FUNCTION IF EXISTS public.rh_sync_senior_pelo_espelho();
-- DROP TABLE IF EXISTS public."RH_SENIOR_SYNC_RODADA";
-- (e religar o robô integracao-senior apontando para o cluster)
