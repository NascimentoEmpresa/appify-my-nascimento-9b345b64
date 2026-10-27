-- =========================================================================
-- RH › Insalubridade e periculosidade IGUAIS à Senior + ficha completa do
-- colaborador (26/10/2026)
--
-- SINTOMA (Pablo, 26/10): Solicitação de vaga #1388 (UFRGS LIMPEZA,
-- substituição de CARLA THAINA DE SOUZA MORAIS, 1/10531) saiu com
-- "Insalubridade: Sim — R$ 385,15/mês (20%)". Na Senior (BiEmpregados.perins)
-- ela tem 40,00. "Tem que puxar correto todas as informações dos
-- colaboradores."
--
-- CAUSA — duas:
--   1. EMPREGADOS."% Insalubridade" / "% Periculosidade" vieram da importação
--      antiga e NINGUÉM os atualiza: rh_sync_senior_pelo_espelho (mig
--      20261020000110) traz nome, datas, situação, filial, CPF, PIS e salário;
--      rh_completar_ficha_do_senior (mig 20261019000004) traz cargo, local e
--      escala. perins/perper nunca entraram.
--   2. A tela da vaga (ModalNovaVaga + custoPosto.ts) dava preferência à
--      Planilha de Custo do posto: com valor na planilha, a do cadastro era
--      ignorada (a planilha do posto dizia 20%). Corrigido no front: com
--      colaborador escolhido, vale o cadastro dele (Senior); a planilha só
--      entra quando o cadastro não diz nada.
--
-- O QUE MUDA AQUI
--   a) rh_sync_adicionais_do_senior(): reescreve "% Insalubridade" e
--      "% Periculosidade" pela Senior (espelho, tipcol = 1, linha mais
--      recente da pessoa) quando o número difere — formato "40,00", como a
--      importação gravava. Senior sem valor nunca apaga o que o ERP tem.
--      Toda linha alterada vai para EMPREGADOS_SYNC_SENIOR_LOG.
--      Lê o espelho por to_jsonb(linha): coluna que não existir vira NULL em
--      vez de derrubar o sync inteiro.
--   b) rh_sync_senior_pelo_espelho() passa a chamá-la (passo 2b), de 15 em
--      15 min. Corpo igual ao da mig 20261020000110 + o passo novo.
--   c) Roda uma vez agora e corrige as vagas EM ABERTO de substituição cuja
--      insalubridade gravada não bate com a Senior do substituído (a #1388
--      entre elas). Vaga concluída/reprovada/contratada fica como está.
--   d) rh_colaborador_ficha_senior(p_id): a ficha da Senior para o modal de
--      RH › Colaboradores — adicionais, horas, posto, local, escala, centro
--      de custo, dados pessoais e bancários. Gate: rh_pode_ver_colaboradores();
--      remuneração e banco só com rh_pode_ver_salario().
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── a) Adicionais da Senior no EMPREGADOS ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_sync_adicionais_do_senior()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_n int := 0;
BEGIN
  IF to_regclass('espelho."BiEmpregados"') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'espelho sem BiEmpregados');
  END IF;

  WITH bi AS (
    SELECT DISTINCT ON (b.numemp, b.numcad)
           b.numemp, b.numcad,
           public.col_num(to_jsonb(b)->>'perins') AS perins,
           public.col_num(to_jsonb(b)->>'perper') AS perper
      FROM espelho."BiEmpregados" b
     WHERE b.tipcol = 1
     ORDER BY b.numemp, b.numcad, b.datadm DESC NULLS LAST
  ),
  calc AS (
    SELECT e."ID", e."Empresa", e."Cadastro",
           CASE WHEN bi.perins IS NOT NULL AND bi.perins IS DISTINCT FROM public.col_num(e."% Insalubridade")
                THEN replace(to_char(bi.perins, 'FM990.00'), '.', ',') ELSE e."% Insalubridade" END AS insal_nova,
           CASE WHEN bi.perper IS NOT NULL AND bi.perper IS DISTINCT FROM public.col_num(e."% Periculosidade")
                THEN replace(to_char(bi.perper, 'FM990.00'), '.', ',') ELSE e."% Periculosidade" END AS peric_nova,
           jsonb_build_object('% Insalubridade', e."% Insalubridade", '% Periculosidade', e."% Periculosidade") AS antes
      FROM public."EMPREGADOS" e
      JOIN bi ON bi.numemp = e."Empresa" AND bi.numcad = e."Cadastro"
  ),
  mudou AS (
    SELECT c.* FROM calc c JOIN public."EMPREGADOS" e ON e."ID" = c."ID"
     WHERE e."% Insalubridade"  IS DISTINCT FROM c.insal_nova
        OR e."% Periculosidade" IS DISTINCT FROM c.peric_nova
  ),
  upd AS (
    UPDATE public."EMPREGADOS" e
       SET "% Insalubridade"  = m.insal_nova,
           "% Periculosidade" = m.peric_nova
      FROM mudou m
     WHERE e."ID" = m."ID"
    RETURNING e."ID", m."Empresa", m."Cadastro", m.antes,
              jsonb_build_object('% Insalubridade', e."% Insalubridade", '% Periculosidade', e."% Periculosidade") AS depois
  )
  INSERT INTO public."EMPREGADOS_SYNC_SENIOR_LOG"(empregado_id, empresa, cadastro, pessoa_trocada, antes, depois)
  SELECT "ID", "Empresa", "Cadastro", false, antes, depois FROM upd;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('adicionais_corrigidos', v_n);
END $function$;
REVOKE ALL ON FUNCTION public.rh_sync_adicionais_do_senior() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_adicionais_do_senior() TO service_role;

-- ── b) O sync de 15 em 15 min passa a chamar o passo 2b ──────────────────
CREATE OR REPLACE FUNCTION public.rh_sync_senior_pelo_espelho()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_sit jsonb;
  v_emp jsonb;
  v_adic jsonb;
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

  -- 2b. Insalubridade e periculosidade (mig 20261026000900). Falha aqui não
  --     derruba o resto da rodada.
  BEGIN
    v_adic := public.rh_sync_adicionais_do_senior();
  EXCEPTION WHEN OTHERS THEN
    v_adic := jsonb_build_object('erro', SQLERRM);
  END;

  -- 3. Escala (se a função existir neste banco).
  IF to_regprocedure('public.rh_sync_escala_espelho()') IS NOT NULL THEN
    EXECUTE 'SELECT to_jsonb(public.rh_sync_escala_espelho())' INTO v_esc;
  END IF;

  v_out := jsonb_build_object('ok', true, 'situacoes', v_sit, 'empregados', v_emp, 'adicionais', v_adic, 'escala', v_esc);
  INSERT INTO public."RH_SENIOR_SYNC_RODADA" (duracao_ms, resultado)
  VALUES ((extract(epoch FROM clock_timestamp() - t0) * 1000)::int, v_out);
  DELETE FROM public."RH_SENIOR_SYNC_RODADA"
   WHERE id < (SELECT min(id) FROM (SELECT id FROM public."RH_SENIOR_SYNC_RODADA" ORDER BY id DESC LIMIT 500) x);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.rh_sync_senior_pelo_espelho() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_pelo_espelho() TO service_role;

-- ── c) Corrige agora: cadastro e vagas em aberto ─────────────────────────
SELECT public.rh_sync_adicionais_do_senior();

-- Vaga de substituição ainda em andamento: a insalubridade passa a ser a do
-- substituído na Senior. Só mexe quando o gravado não tem o percentual certo
-- (a #1388 tinha "R$ 385,15/mês (20%)" para quem recebe 40%).
WITH certo AS (
  SELECT r.id,
         public.col_num(e."% Insalubridade") AS pct,
         jsonb_build_object('insalubridade_recebe', r.insalubridade_recebe, 'insalubridade_quanto', r.insalubridade_quanto) AS antes
    FROM public."SISTEMA_RECRUTAMENTO" r
    JOIN public."EMPREGADOS" e ON e."ID" = r.substituido_id
   WHERE r.status NOT IN ('Concluído', 'Reprovada', 'Contratado')
     AND public.col_num(e."% Insalubridade") IS NOT NULL
),
novo AS (
  SELECT c.id, c.antes,
         CASE WHEN c.pct > 0 THEN 'Sim' ELSE 'Não' END AS recebe,
         -- "40%" / "20,5%": o mesmo texto que a tela grava (custoPosto.ts).
         CASE WHEN c.pct > 0 THEN replace(trim_scale(c.pct)::text, '.', ',') || '%' ELSE '' END AS quanto
    FROM certo c
)
UPDATE public."SISTEMA_RECRUTAMENTO" r
   SET insalubridade_recebe = n.recebe,
       insalubridade_quanto = n.quanto
  FROM novo n
 WHERE r.id = n.id
   AND (r.insalubridade_recebe IS DISTINCT FROM n.recebe
        -- Percentual gravado ("... (20%)" ou "20%") diferente do da Senior.
        OR (n.recebe = 'Sim' AND public.col_num(substring(coalesce(r.insalubridade_quanto, '') FROM '([0-9]+(?:[.,][0-9]+)?)%'))
                                 IS DISTINCT FROM (SELECT c.pct FROM certo c WHERE c.id = n.id)));

-- ── d) Ficha da Senior para o modal de RH › Colaboradores ────────────────
CREATE OR REPLACE FUNCTION public.rh_colaborador_ficha_senior(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  e   public."EMPREGADOS"%ROWTYPE;
  b   jsonb;
  v_sal boolean := public.rh_pode_ver_salario();
  v_posto text;
  v_local text;
  v_escala text;
  v_out jsonb;
  dt  text;
BEGIN
  IF NOT public.rh_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public."EMPREGADOS" WHERE "ID" = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF to_regclass('espelho."BiEmpregados"') IS NOT NULL THEN
    SELECT to_jsonb(x) INTO b
      FROM espelho."BiEmpregados" x
     WHERE x.tipcol = 1 AND x.numemp = e."Empresa" AND x.numcad = e."Cadastro"
     ORDER BY x.datadm DESC NULLS LAST
     LIMIT 1;
  END IF;
  IF b IS NULL THEN
    RETURN jsonb_build_object('na_senior', false);
  END IF;

  IF to_regclass('espelho."BiPostos"') IS NOT NULL AND nullif(btrim(b->>'postra'), '') IS NOT NULL THEN
    EXECUTE 'SELECT btrim(descricao::text) FROM espelho."BiPostos" WHERE codigo_posto::text = $1 LIMIT 1'
      INTO v_posto USING btrim(b->>'postra');
  END IF;
  IF to_regclass('espelho."BiOrganogramas"') IS NOT NULL THEN
    EXECUTE 'SELECT btrim(descricao_local::text) FROM espelho."BiOrganogramas" WHERE organograma::text = $1 AND codigo_local::text = $2 LIMIT 1'
      INTO v_local USING b->>'taborg', b->>'numloc';
  END IF;
  SELECT btrim(descricao) INTO v_escala FROM public."RH_ESCALA" WHERE codigo::text = b->>'codesc' LIMIT 1;

  v_out := jsonb_build_object(
    'na_senior', true,
    'insalubridade_pct', public.col_num(b->>'perins'),
    'periculosidade_pct', public.col_num(b->>'perper'),
    'horas_mes', public.col_num(b->>'horbas'),
    'horas_semana', public.col_num(b->>'horsem'),
    'horas_sabado', public.col_num(b->>'horsab'),
    'posto_codigo', nullif(btrim(b->>'postra'), ''),
    'posto', coalesce(v_posto, nullif(btrim(e."Nome do Posto"), '')),
    'local', coalesce(v_local, nullif(btrim(e."Descrição do Local"), '')),
    'escala_codigo', nullif(btrim(b->>'codesc'), ''),
    'escala', coalesce(v_escala, nullif(btrim(e."Escala"), '')),
    'centro_custo', nullif(btrim(b->>'codccu'), ''),
    'centro_custo_nome', nullif(btrim(e."Titulo C.Custo"), ''),
    'filial', nullif(btrim(b->>'codfil'), ''),
    'escala_vt', nullif(btrim(b->>'escvtr'), ''),
    'dependentes_ir', public.col_num(b->>'depirf'),
    'dependentes_sf', public.col_num(b->>'depsaf'),
    'tipo_contrato', nullif(btrim(e."Descrição (T. Contrato)"), ''),
    'estado_civil', nullif(btrim(e."Descrição (Estado Civil)"), ''),
    'instrucao', nullif(btrim(e."Descrição (Instrução)"), ''),
    'nacionalidade', nullif(btrim(e."Descrição (Nacionalidade)"), ''),
    'sexo', nullif(btrim(b->>'tipsex'), ''),
    'ctps', nullif(btrim(concat_ws('/', nullif(b->>'numctp', ''), nullif(b->>'serctp', ''), nullif(b->>'estctp', ''))), ''),
    'nascimento', CASE WHEN left(b->>'datnas', 4) > '1901' THEN to_char((b->>'datnas')::date, 'DD/MM/YYYY') END,
    'data_cargo', CASE WHEN left(b->>'datcar', 4) > '1901' THEN to_char((b->>'datcar')::date, 'DD/MM/YYYY') END,
    'data_posto', CASE WHEN left(b->>'datpos', 4) > '1901' THEN to_char((b->>'datpos')::date, 'DD/MM/YYYY') END,
    'data_escala', CASE WHEN left(b->>'datesc', 4) > '1901' THEN to_char((b->>'datesc')::date, 'DD/MM/YYYY') END
  );

  IF v_sal THEN
    dt := b->>'datsal';
    v_out := v_out || jsonb_build_object(
      'salario', public.col_num(b->>'valsal'),
      'complemento', public.col_num(b->>'cplsal'),
      'data_salario', CASE WHEN left(dt, 4) > '1901' THEN to_char(dt::date, 'DD/MM/YYYY') END,
      'banco', nullif(btrim(coalesce(e."Banco (Banco)", b->>'codban')), ''),
      'agencia', nullif(btrim(b->>'codage'), ''),
      'conta', nullif(btrim(concat_ws('-', nullif(b->>'conban', ''), nullif(b->>'digban', ''))), ''),
      'tipo_conta', nullif(btrim(e."Descrição (Tipo Conta)"), ''),
      'chave_pix', coalesce(nullif(btrim(b->>'chvpix'), ''), nullif(btrim(e."Chave Pix"), ''))
    );
  END IF;
  RETURN v_out;
END $function$;
REVOKE ALL ON FUNCTION public.rh_colaborador_ficha_senior(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_colaborador_ficha_senior(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin):
--   SELECT "ID", "Nome", "% Insalubridade" FROM public."EMPREGADOS" WHERE "Empresa" = 1 AND "Cadastro" = 10531;  -- 40,00
--   SELECT id, insalubridade_recebe, insalubridade_quanto FROM public."SISTEMA_RECRUTAMENTO" WHERE id = 1388;  -- Sim / 40%
--   SELECT resultado->'adicionais' FROM public."RH_SENIOR_SYNC_RODADA" ORDER BY id DESC LIMIT 3;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.rh_colaborador_ficha_senior(bigint);
-- (rh_sync_senior_pelo_espelho: recriar com o corpo da mig 20261020000110)
-- DROP FUNCTION IF EXISTS public.rh_sync_adicionais_do_senior();
-- Os valores antigos de "% Insalubridade"/"% Periculosidade" estão em
-- EMPREGADOS_SYNC_SENIOR_LOG.antes.
