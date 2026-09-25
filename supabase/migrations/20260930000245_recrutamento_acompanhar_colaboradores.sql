-- =========================================================================
-- Recrutamento e Seleção › ACOMPANHAR COLABORADORES e ACOMPANHAR EXPERIÊNCIA
--
-- PEDIDO (25/09/2026, Pablo)
--   "Após passarem pela ADMISSÃO, quando chegar no status concluído no
--   recrutamento, e estiverem admitidas no sistema Senior, vão aparecer esses
--   novos colaboradores. Se baseia no próprio sistema de colaboradores,
--   filtrar por padrão por data de admissão, mas tem que ser um check-in
--   tipo esse do Excel que usam atualmente. Desenvolve um submódulo de
--   pessoas que ainda estão no contrato, até 90 dias de admissão:
--   Acompanhar Experiência, dentro do Recrutamento e Seleção."
--   Ajuste no mesmo dia: "deve aparecer todos colaboradores que foram
--   admitidos nos últimos 90 dias (contrato de experiência de 30 ou 90
--   dias) — a tabela EMPREGADOS, só os novos. Pode aparecer também os
--   concluídos/admitidos do sistema Gestão Recrutamento, mas se não estiver
--   vindo da EMPREGADOS tem que aparecer: Ainda não admitido no sistema
--   Senior."
--
-- O EXCEL (CONTRATOS_VIGENTES.xlsx): um bloco por CONTRATO, colunas
--   NOME · CARGO · CIDADE · DATA ADMISSÃO · 7 DIAS · 30 DIAS · 60 DIAS ·
--   90 DIAS · PERMANECEU APÓS EXPERIÊNCIA? · DATA SAÍDA ·
--   DEMITIDO / DEMISSIONÁRIO · MOTIVO · OBSERVAÇÃO.
--
-- DE ONDE VÊM AS PESSOAS (duas fontes, uma lista)
--   1. EMPREGADOS (Senior) — admitido na Senior. Contrato pela CONTRATOS
--      (Empresa + Filial), como em rh_colaboradores_lista. Origem
--      'recrutamento' quando o CPF casa com candidato do nosso processo.
--   2. WA_CURRICULOS na etapa ADMISSÃO cujo CPF NÃO está na EMPREGADOS —
--      passou pelo nosso Recrutamento e ainda não foi admitido na Senior
--      ("Ainda não admitido no sistema Senior"). Sem data de admissão os
--      marcos 7/30/60/90 não correm; a data de referência é quando entrou
--      na ADMISSÃO.
--
-- A CHAVE É O CPF (11 dígitos, com os zeros à esquerda devolvidos — 90 dos
-- 398 admitidos dos últimos 90 dias estavam na EMPREGADOS sem eles em
-- 25/09/2026). Assim o que se anota enquanto a pessoa é candidato continua
-- valendo quando ela aparece na Senior.
--
-- O CHECK-IN
--   RECRUTAMENTO_ACOMPANHAMENTO ........ 1 linha por CPF: permaneceu, saída,
--                                        demitido/demissionário, motivo,
--                                        observação, cidade.
--   RECRUTAMENTO_ACOMPANHAMENTO_CHECK .. 1 linha por CPF e marco (7/30/60/90):
--                                        resultado, data, observação, quem.
--   Gravação só por RPC (carimbo de quem/quando no banco).
--
-- MENUS (módulo recrutamento)
--   recrutamento_acompanhar_colaboradores  /app/rh/recrutamento/acompanhar-colaboradores
--   recrutamento_acompanhar_experiencia    /app/rh/recrutamento/acompanhar-experiencia
--   visualizar = ver; alterar = registrar check-in. J2: nascem com dono —
--   quem já tem a Gestão Recrutamento (recrutamento_gestao) ganha as mesmas
--   ações nas duas telas.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── CPF normalizado (11 dígitos) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recrut_cpf11(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE WHEN length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) BETWEEN 8 AND 11
              THEN lpad(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 11, '0') END;
$fn$;

-- ── Tabelas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO" (
  cpf            text PRIMARY KEY CHECK (cpf ~ '^\d{11}$'),
  empregado_id   bigint,
  candidato_id   bigint,
  permaneceu     text CHECK (permaneceu IS NULL OR permaneceu IN ('Sim', 'Não')),
  data_saida     date,
  tipo_saida     text CHECK (tipo_saida IS NULL OR tipo_saida IN ('Demitido', 'Demissionário')),
  motivo_saida   text,
  observacao     text,
  cidade         text,
  atualizado_por text,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public."RECRUTAMENTO_ACOMPANHAMENTO" IS
  'Check-in do colaborador recém-admitido (o Excel CONTRATOS_VIGENTES): permanência, saída, motivo, observação. Chave = CPF (11 dígitos), vale de candidato a admitido. Mig 245, 25/09/2026.';

CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cpf            text NOT NULL CHECK (cpf ~ '^\d{11}$'),
  marco          smallint NOT NULL CHECK (marco IN (7, 30, 60, 90)),
  resultado      text NOT NULL CHECK (resultado IN ('positivo', 'ressalvas', 'negativo', 'sem_contato')),
  realizado_em   date NOT NULL DEFAULT current_date,
  observacao     text,
  registrado_por text,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cpf, marco)
);
COMMENT ON TABLE public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" IS
  'Os check-ins de 7, 30, 60 e 90 dias da admissão (colunas do Excel). Um por CPF e marco; regravar substitui. Mig 245.';

-- ── Menus ────────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('recrutamento_acompanhar_colaboradores', 'Acompanhar Colaboradores', '/app/rh/recrutamento/acompanhar-colaboradores', 16),
    ('recrutamento_acompanhar_experiencia',   'Acompanhar Experiência',   '/app/rh/recrutamento/acompanhar-experiencia',   17)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'recrutamento'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
UPDATE public.app_menu SET ativo = true
 WHERE codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');

-- J2: quem tem a Gestão Recrutamento ganha as mesmas ações (visualizar/alterar).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, novo.codigo, pp.acao, true
  FROM public.perfil_acesso_permissao pp
 CROSS JOIN (VALUES ('recrutamento_acompanhar_colaboradores'), ('recrutamento_acompanhar_experiencia')) AS novo(codigo)
 WHERE pp.menu_codigo = 'recrutamento_gestao' AND pp.allow
   AND pp.acao IN ('visualizar'::public.app_acao, 'alterar'::public.app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = novo.codigo AND x.acao = pp.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, novo.codigo, s.acao, true,
       'Migração 20260930000245: já tinha a Gestão Recrutamento'
  FROM public.screen_permission_user s
 CROSS JOIN (VALUES ('recrutamento_acompanhar_colaboradores'), ('recrutamento_acompanhar_experiencia')) AS novo(codigo)
 WHERE s.menu_codigo = 'recrutamento_gestao' AND s.allow
   AND s.acao IN ('visualizar'::public.app_acao, 'alterar'::public.app_acao)
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = novo.codigo AND x.acao = s.acao);

-- ── Permissão ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recrut_acomp_pode(_acao public.app_acao)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'recrutamento_acompanhar_colaboradores', _acao)
      OR public.has_screen_access(auth.uid(), 'recrutamento_acompanhar_experiencia', _acao);
$fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_pode(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acomp_pode(public.app_acao) TO authenticated;

-- ── RLS (leitura direta; escrita só pelas RPCs) ─────────────────────────
ALTER TABLE public."RECRUTAMENTO_ACOMPANHAMENTO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recrut_acomp_select ON public."RECRUTAMENTO_ACOMPANHAMENTO";
CREATE POLICY recrut_acomp_select ON public."RECRUTAMENTO_ACOMPANHAMENTO" FOR SELECT TO authenticated
  USING (public.recrut_acomp_pode('visualizar'::public.app_acao));

DROP POLICY IF EXISTS recrut_acomp_check_select ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK";
CREATE POLICY recrut_acomp_check_select ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" FOR SELECT TO authenticated
  USING (public.recrut_acomp_pode('visualizar'::public.app_acao));

GRANT SELECT ON public."RECRUTAMENTO_ACOMPANHAMENTO" TO authenticated;
GRANT SELECT ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" TO authenticated;

-- ── Lista (as duas telas) ────────────────────────────────────────────────
-- _modo 'colaboradores': admitidos entre _ini e _fim (padrão: últimos 90
--                        dias), qualquer situação, + os ainda não admitidos.
-- _modo 'experiencia'  : admitidos há até 90 dias e ainda no contrato, + os
--                        ainda não admitidos (vão entrar na experiência).
CREATE OR REPLACE FUNCTION public.recrut_acompanhamento_lista(_modo text, _ini date DEFAULT NULL, _fim date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ini date;
  v_fim date := coalesce(_fim, current_date);
  v_out jsonb;
BEGIN
  IF NOT public.recrut_acomp_pode('visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao acompanhamento de colaboradores.' USING ERRCODE = '42501';
  END IF;
  v_ini := CASE WHEN _modo = 'experiencia' THEN current_date - 90 ELSE coalesce(_ini, current_date - 90) END;
  IF _modo = 'experiencia' THEN v_fim := current_date; END IF;

  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Empresa"::text), btrim(c."Filial"::text))
           btrim(c."Empresa"::text) AS empresa_cod, btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  -- Todo CPF que já está na Senior (pra saber quem ainda NÃO foi admitido).
  senior_cpfs AS (
    SELECT DISTINCT public.recrut_cpf11(emp."CPF") AS cpf FROM public."EMPREGADOS" emp
     WHERE public.recrut_cpf11(emp."CPF") IS NOT NULL
  ),
  -- Candidato do nosso Recrutamento na ADMISSÃO, por CPF (o mais recente).
  cand AS (
    SELECT DISTINCT ON (public.recrut_cpf11(coalesce(c.cpf, c.cpf_cand)))
           public.recrut_cpf11(coalesce(c.cpf, c.cpf_cand)) AS cpf,
           c.id AS candidato_id, c.nome, c.etapa_changed_at, c.cidade_residencia,
           v.id AS vaga_id, v.status AS vaga_status, v.cargo, v.cidade AS vaga_cidade,
           nullif(btrim(regexp_replace(coalesce(v.contrato, ''), '^\d+\s*-\s*', '')), '') AS contrato
      FROM public."WA_CURRICULOS" c
      LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
     WHERE c.etapa_processo = 'ADMISSÃO'
       AND public.recrut_cpf11(coalesce(c.cpf, c.cpf_cand)) IS NOT NULL
     ORDER BY public.recrut_cpf11(coalesce(c.cpf, c.cpf_cand)), c.etapa_changed_at DESC NULLS LAST, c.created_at DESC
  ),
  -- 1) Admitidos na Senior no período.
  adm AS (
    SELECT public.recrut_cpf11(emp."CPF") AS cpf,
           emp."ID" AS empregado_id,
           coalesce(emp."Nome", '') AS nome,
           coalesce(nullif(btrim(coalesce(emp."Título do Cargo", '')), ''), nullif(btrim(coalesce(emp."Nome do Cargo", '')), ''), '—') AS cargo,
           coalesce(nullif(ct.nome, ''), nullif(btrim(regexp_replace(coalesce(emp."Nome Filial", ''), '^\d+\s*-\s*', '')), ''), '—') AS contrato,
           nullif(btrim(coalesce(emp."Descrição do Local", '')), '') AS local,
           btrim(coalesce(emp."Situação", '')) AS situacao,
           public.rh_data(emp."Admissão"::text) AS admissao,
           public.rh_data(emp."Data Afastamento"::text) AS afastamento,
           nullif(btrim(coalesce(emp."Descrição (Causa)", '')), '') AS causa,
           (btrim(coalesce(emp."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS saiu
      FROM public."EMPREGADOS" emp
      LEFT JOIN ct ON ct.filial = btrim(emp."Filial"::text) AND ct.empresa_cod = btrim(coalesce(emp."Empresa"::text, ''))
     WHERE public.recrut_cpf11(emp."CPF") IS NOT NULL
       AND public.rh_data(emp."Admissão"::text) BETWEEN v_ini AND v_fim
  ),
  linhas AS (
    SELECT a.cpf, true AS admitido_senior, a.empregado_id, cd.candidato_id, a.nome, a.cargo, a.contrato, a.local,
           a.situacao, a.admissao, a.afastamento, a.causa, a.saiu,
           (current_date - a.admissao) AS dias, NULL::date AS data_ref,
           cd.vaga_id, cd.vaga_status, cd.vaga_cidade
      FROM adm a
      LEFT JOIN cand cd ON cd.cpf = a.cpf
     WHERE (_modo <> 'experiencia' OR NOT a.saiu)
    UNION ALL
    -- 2) Passou pelo nosso Recrutamento e ainda não está na Senior.
    SELECT cd.cpf, false, NULL, cd.candidato_id, coalesce(cd.nome, ''), coalesce(cd.cargo, '—'), coalesce(cd.contrato, '—'), NULL,
           'Ainda não admitido no sistema Senior', NULL, NULL, NULL, false,
           NULL, cd.etapa_changed_at::date,
           cd.vaga_id, cd.vaga_status, coalesce(cd.vaga_cidade, cd.cidade_residencia)
      FROM cand cd
     WHERE NOT EXISTS (SELECT 1 FROM senior_cpfs s WHERE s.cpf = cd.cpf)
       AND (_modo = 'experiencia' OR cd.etapa_changed_at IS NULL OR cd.etapa_changed_at::date BETWEEN v_ini AND v_fim)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'cpf', l.cpf, 'admitido_senior', l.admitido_senior, 'empregado_id', l.empregado_id,
           'candidato_id', l.candidato_id, 'nome', l.nome, 'cargo', l.cargo, 'contrato', l.contrato,
           'local', l.local, 'situacao', l.situacao, 'admissao', l.admissao, 'afastamento', l.afastamento,
           'causa', l.causa, 'saiu', l.saiu, 'dias', l.dias, 'data_ref', l.data_ref,
           'origem', CASE WHEN l.candidato_id IS NOT NULL THEN 'recrutamento' ELSE 'senior' END,
           'vaga_id', l.vaga_id, 'vaga_status', l.vaga_status,
           'cidade', coalesce(a.cidade, l.vaga_cidade),
           'acomp', CASE WHEN a.cpf IS NULL THEN NULL ELSE to_jsonb(a) END,
           'checks', coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.marco)
                                 FROM public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" k WHERE k.cpf = l.cpf), '[]'::jsonb)
         ) ORDER BY l.contrato, l.admissao DESC NULLS FIRST, l.nome), '[]'::jsonb)
    INTO v_out
    FROM linhas l
    LEFT JOIN public."RECRUTAMENTO_ACOMPANHAMENTO" a ON a.cpf = l.cpf;

  RETURN jsonb_build_object('ini', v_ini, 'fim', v_fim, 'linhas', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acompanhamento_lista(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acompanhamento_lista(text, date, date) TO authenticated;

-- De quem é este CPF (Senior e/ou Recrutamento) — as RPCs de gravação só
-- aceitam CPF que existe em uma das duas fontes.
CREATE OR REPLACE FUNCTION public.recrut_acomp_quem(p_cpf text, OUT empregado_id bigint, OUT candidato_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT (SELECT e."ID" FROM public."EMPREGADOS" e WHERE public.recrut_cpf11(e."CPF") = public.recrut_cpf11(p_cpf)
           ORDER BY public.rh_data(e."Admissão"::text) DESC NULLS LAST LIMIT 1),
         (SELECT c.id FROM public."WA_CURRICULOS" c WHERE public.recrut_cpf11(coalesce(c.cpf, c.cpf_cand)) = public.recrut_cpf11(p_cpf)
           ORDER BY c.created_at DESC LIMIT 1);
$fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_quem(text) FROM PUBLIC, anon;

-- ── Registrar um check-in (7/30/60/90) ───────────────────────────────────
-- p_resultado NULL apaga o check (desfazer um registro errado).
CREATE OR REPLACE FUNCTION public.recrut_acomp_registrar_check(
  p_cpf text, p_marco smallint, p_resultado text, p_realizado_em date DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome text;
  v_cpf  text := public.recrut_cpf11(p_cpf);
  q      record;
BEGIN
  IF NOT public.recrut_acomp_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para registrar o acompanhamento (ação Alterar).' USING ERRCODE = '42501';
  END IF;
  IF v_cpf IS NULL THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  SELECT * INTO q FROM public.recrut_acomp_quem(v_cpf);
  IF q.empregado_id IS NULL THEN
    RAISE EXCEPTION 'Ainda não admitido no sistema Senior — o check-in de % dias conta a partir da admissão.', p_marco;
  END IF;
  IF p_marco NOT IN (7, 30, 60, 90) THEN RAISE EXCEPTION 'Marco inválido: %', p_marco; END IF;

  IF p_resultado IS NULL THEN
    DELETE FROM public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" WHERE cpf = v_cpf AND marco = p_marco;
    RETURN jsonb_build_object('cpf', v_cpf, 'marco', p_marco, 'apagado', true);
  END IF;
  IF p_resultado NOT IN ('positivo', 'ressalvas', 'negativo', 'sem_contato') THEN
    RAISE EXCEPTION 'Resultado inválido: %', p_resultado;
  END IF;
  IF p_resultado IN ('ressalvas', 'negativo') AND length(btrim(coalesce(p_observacao, ''))) < 5 THEN
    RAISE EXCEPTION 'Descreva o que foi observado (obrigatório quando o resultado não é positivo).';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" (cpf, marco, resultado, realizado_em, observacao, registrado_por, registrado_em)
  VALUES (v_cpf, p_marco, p_resultado, coalesce(p_realizado_em, current_date), nullif(btrim(coalesce(p_observacao, '')), ''), v_nome, now())
  ON CONFLICT (cpf, marco) DO UPDATE
     SET resultado = EXCLUDED.resultado, realizado_em = EXCLUDED.realizado_em, observacao = EXCLUDED.observacao,
         registrado_por = EXCLUDED.registrado_por, registrado_em = now();
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO" (cpf, empregado_id, candidato_id, atualizado_por)
  VALUES (v_cpf, q.empregado_id, q.candidato_id, v_nome)
  ON CONFLICT (cpf) DO UPDATE SET empregado_id = coalesce(EXCLUDED.empregado_id, "RECRUTAMENTO_ACOMPANHAMENTO".empregado_id),
                                  candidato_id = coalesce(EXCLUDED.candidato_id, "RECRUTAMENTO_ACOMPANHAMENTO".candidato_id);
  RETURN jsonb_build_object('cpf', v_cpf, 'marco', p_marco, 'resultado', p_resultado);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_registrar_check(text, smallint, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acomp_registrar_check(text, smallint, text, date, text) TO authenticated;

-- ── Salvar o fim da linha (permaneceu, saída, motivo, observação, cidade) ─
CREATE OR REPLACE FUNCTION public.recrut_acomp_salvar(p_cpf text, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome text;
  v_cpf  text := public.recrut_cpf11(p_cpf);
  v_perm text := nullif(btrim(coalesce(p_dados->>'permaneceu', '')), '');
  v_tipo text := nullif(btrim(coalesce(p_dados->>'tipo_saida', '')), '');
  q      record;
BEGIN
  IF NOT public.recrut_acomp_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para registrar o acompanhamento (ação Alterar).' USING ERRCODE = '42501';
  END IF;
  IF v_cpf IS NULL THEN RAISE EXCEPTION 'CPF inválido.'; END IF;
  SELECT * INTO q FROM public.recrut_acomp_quem(v_cpf);
  IF q.empregado_id IS NULL AND q.candidato_id IS NULL THEN
    RAISE EXCEPTION 'CPF não encontrado na Senior nem no Recrutamento.';
  END IF;
  IF v_perm = 'Não' AND nullif(p_dados->>'data_saida', '') IS NULL THEN
    RAISE EXCEPTION 'Quem não permaneceu precisa da data de saída.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO"
         (cpf, empregado_id, candidato_id, permaneceu, data_saida, tipo_saida, motivo_saida, observacao, cidade, atualizado_por, atualizado_em)
  VALUES (v_cpf, q.empregado_id, q.candidato_id, v_perm, nullif(p_dados->>'data_saida', '')::date, v_tipo,
          nullif(btrim(coalesce(p_dados->>'motivo_saida', '')), ''), nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
          nullif(btrim(coalesce(p_dados->>'cidade', '')), ''), v_nome, now())
  ON CONFLICT (cpf) DO UPDATE
     SET empregado_id = coalesce(EXCLUDED.empregado_id, "RECRUTAMENTO_ACOMPANHAMENTO".empregado_id),
         candidato_id = coalesce(EXCLUDED.candidato_id, "RECRUTAMENTO_ACOMPANHAMENTO".candidato_id),
         permaneceu = EXCLUDED.permaneceu, data_saida = EXCLUDED.data_saida, tipo_saida = EXCLUDED.tipo_saida,
         motivo_saida = EXCLUDED.motivo_saida, observacao = EXCLUDED.observacao, cidade = EXCLUDED.cidade,
         atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
  RETURN jsonb_build_object('cpf', v_cpf, 'ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_salvar(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acomp_salvar(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.recrut_acomp_salvar(text, jsonb);
-- DROP FUNCTION IF EXISTS public.recrut_acomp_registrar_check(text, smallint, text, date, text);
-- DROP FUNCTION IF EXISTS public.recrut_acomp_quem(text);
-- DROP FUNCTION IF EXISTS public.recrut_acompanhamento_lista(text, date, date);
-- DROP POLICY IF EXISTS recrut_acomp_check_select ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK";
-- DROP POLICY IF EXISTS recrut_acomp_select ON public."RECRUTAMENTO_ACOMPANHAMENTO";
-- DROP FUNCTION IF EXISTS public.recrut_acomp_pode(public.app_acao);
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DELETE FROM public.app_menu WHERE codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK";  -- portaria-ok: R2 — rollback de tabela criada nesta migration
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO";        -- portaria-ok: R2 — rollback de tabela criada nesta migration
-- DROP FUNCTION IF EXISTS public.recrut_cpf11(text);
-- NOTIFY pgrst, 'reload schema';
