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
--
-- O EXCEL (CONTRATOS_VIGENTES.xlsx): um bloco por CONTRATO, colunas
--   NOME · CARGO · CIDADE · DATA ADMISSÃO · 7 DIAS · 30 DIAS · 60 DIAS ·
--   90 DIAS · PERMANECEU APÓS EXPERIÊNCIA? · DATA SAÍDA ·
--   DEMITIDO / DEMISSIONÁRIO · MOTIVO · OBSERVAÇÃO.
--
-- DE ONDE VÊM AS PESSOAS
--   A base é a EMPREGADOS (Senior) — a mesma do cadastro de Colaboradores,
--   com o contrato resolvido pela CONTRATOS (Empresa + Filial), como em
--   rh_colaboradores_lista. O vínculo com o Recrutamento é pelo CPF: o
--   candidato que chegou à etapa ADMISSÃO (WA_CURRICULOS) e a vaga dele
--   (SISTEMA_RECRUTAMENTO). A lista traz a origem ('recrutamento' quando
--   casa) e a tela filtra por ela. Medido em 25/09/2026: 357 admitidos
--   trabalhando nos últimos 90 dias, 6 casando com candidato — por isso a
--   origem é FILTRO, não condição de entrada (senão a tela nasceria vazia).
--
-- O CHECK-IN
--   RECRUTAMENTO_ACOMPANHAMENTO ........ 1 linha por colaborador: permaneceu,
--                                        saída, demitido/demissionário,
--                                        motivo, observação, cidade.
--   RECRUTAMENTO_ACOMPANHAMENTO_CHECK .. 1 linha por marco (7/30/60/90 dias):
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

-- ── Tabelas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO" (
  empregado_id   bigint PRIMARY KEY,
  cpf            text,
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
  'Check-in do colaborador recém-admitido (o Excel CONTRATOS_VIGENTES): permanência, saída, motivo, observação. Chave = EMPREGADOS.ID. Mig 245, 25/09/2026.';

CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empregado_id   bigint NOT NULL,
  marco          smallint NOT NULL CHECK (marco IN (7, 30, 60, 90)),
  resultado      text NOT NULL CHECK (resultado IN ('positivo', 'ressalvas', 'negativo', 'sem_contato')),
  realizado_em   date NOT NULL DEFAULT current_date,
  observacao     text,
  registrado_por text,
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empregado_id, marco)
);
COMMENT ON TABLE public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" IS
  'Os check-ins de 7, 30, 60 e 90 dias da admissão (colunas do Excel). Um por marco; regravar substitui. Mig 245.';
CREATE INDEX IF NOT EXISTS idx_recrut_acomp_check_emp ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" (empregado_id);

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
-- _modo 'colaboradores': admitidos entre _ini e _fim (qualquer situação).
-- _modo 'experiencia'  : admitidos há até 90 dias e ainda no contrato
--                        (situação sem desligamento) — ignora _ini/_fim.
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
  v_ini := CASE WHEN _modo = 'experiencia' THEN current_date - 90
                ELSE coalesce(_ini, current_date - 180) END;
  IF _modo = 'experiencia' THEN v_fim := current_date; END IF;

  WITH ct AS (
    SELECT DISTINCT ON (btrim(c."Empresa"::text), btrim(c."Filial"::text))
           btrim(c."Empresa"::text) AS empresa_cod, btrim(c."Filial"::text) AS filial,
           btrim(coalesce(c."NOME CONTRATO", '')) AS nome
      FROM public."CONTRATOS" c
     WHERE c."ATIVO" = 'SIM' AND c."Filial" IS NOT NULL
  ),
  e AS (
    SELECT emp."ID" AS id,
           coalesce(emp."Nome", '') AS nome,
           coalesce(emp."CPF", '') AS cpf,
           regexp_replace(coalesce(emp."CPF", ''), '\D', '', 'g') AS cpf_num,
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
  ),
  fil AS (
    SELECT * FROM e
     WHERE e.admissao IS NOT NULL AND e.admissao BETWEEN v_ini AND v_fim
       AND (_modo <> 'experiencia' OR NOT e.saiu)
  ),
  -- Candidato admitido pelo Recrutamento, casado pelo CPF (o mais recente).
  cand AS (
    SELECT DISTINCT ON (regexp_replace(coalesce(c.cpf, c.cpf_cand, ''), '\D', '', 'g'))
           regexp_replace(coalesce(c.cpf, c.cpf_cand, ''), '\D', '', 'g') AS cpf_num,
           c.id AS candidato_id, c.vaga_id, v.status AS vaga_status, v.cidade AS vaga_cidade
      FROM public."WA_CURRICULOS" c
      LEFT JOIN public."SISTEMA_RECRUTAMENTO" v ON v.id = c.vaga_id
     WHERE c.etapa_processo = 'ADMISSÃO'
       AND length(regexp_replace(coalesce(c.cpf, c.cpf_cand, ''), '\D', '', 'g')) = 11
     ORDER BY regexp_replace(coalesce(c.cpf, c.cpf_cand, ''), '\D', '', 'g'), c.created_at DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'empregado_id', f.id, 'nome', f.nome, 'cpf', f.cpf, 'cargo', f.cargo, 'contrato', f.contrato,
           'local', f.local, 'situacao', f.situacao, 'admissao', f.admissao,
           'afastamento', f.afastamento, 'causa', f.causa, 'saiu', f.saiu,
           'dias', (current_date - f.admissao),
           'origem', CASE WHEN cd.candidato_id IS NOT NULL THEN 'recrutamento' ELSE 'senior' END,
           'candidato_id', cd.candidato_id, 'vaga_id', cd.vaga_id, 'vaga_status', cd.vaga_status,
           'cidade', coalesce(a.cidade, cd.vaga_cidade),
           'acomp', CASE WHEN a.empregado_id IS NULL THEN NULL ELSE to_jsonb(a) END,
           'checks', coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.marco)
                                 FROM public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" k
                                WHERE k.empregado_id = f.id), '[]'::jsonb)
         ) ORDER BY f.contrato, f.admissao DESC, f.nome), '[]'::jsonb)
    INTO v_out
    FROM fil f
    LEFT JOIN cand cd ON cd.cpf_num = f.cpf_num AND f.cpf_num <> ''
    LEFT JOIN public."RECRUTAMENTO_ACOMPANHAMENTO" a ON a.empregado_id = f.id;

  RETURN jsonb_build_object('ini', v_ini, 'fim', v_fim, 'linhas', v_out);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acompanhamento_lista(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acompanhamento_lista(text, date, date) TO authenticated;

-- ── Registrar um check-in (7/30/60/90) ───────────────────────────────────
-- p_resultado NULL apaga o check (desfazer um registro errado).
CREATE OR REPLACE FUNCTION public.recrut_acomp_registrar_check(
  p_empregado_id bigint, p_marco smallint, p_resultado text, p_realizado_em date DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome text;
  v_cpf  text;
BEGIN
  IF NOT public.recrut_acomp_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para registrar o acompanhamento (ação Alterar).' USING ERRCODE = '42501';
  END IF;
  SELECT "CPF" INTO v_cpf FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador % não encontrado no cadastro.', p_empregado_id; END IF;
  IF p_marco NOT IN (7, 30, 60, 90) THEN RAISE EXCEPTION 'Marco inválido: %', p_marco; END IF;

  IF p_resultado IS NULL THEN
    DELETE FROM public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" WHERE empregado_id = p_empregado_id AND marco = p_marco;
    RETURN jsonb_build_object('empregado_id', p_empregado_id, 'marco', p_marco, 'apagado', true);
  END IF;
  IF p_resultado NOT IN ('positivo', 'ressalvas', 'negativo', 'sem_contato') THEN
    RAISE EXCEPTION 'Resultado inválido: %', p_resultado;
  END IF;
  IF p_resultado IN ('ressalvas', 'negativo') AND length(btrim(coalesce(p_observacao, ''))) < 5 THEN
    RAISE EXCEPTION 'Descreva o que foi observado (obrigatório quando o resultado não é positivo).';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK" (empregado_id, marco, resultado, realizado_em, observacao, registrado_por, registrado_em)
  VALUES (p_empregado_id, p_marco, p_resultado, coalesce(p_realizado_em, current_date), nullif(btrim(coalesce(p_observacao, '')), ''), v_nome, now())
  ON CONFLICT (empregado_id, marco) DO UPDATE
     SET resultado = EXCLUDED.resultado, realizado_em = EXCLUDED.realizado_em, observacao = EXCLUDED.observacao,
         registrado_por = EXCLUDED.registrado_por, registrado_em = now();
  -- Garante a linha-mãe (a tela lê as duas).
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO" (empregado_id, cpf, atualizado_por)
  VALUES (p_empregado_id, v_cpf, v_nome)
  ON CONFLICT (empregado_id) DO NOTHING;
  RETURN jsonb_build_object('empregado_id', p_empregado_id, 'marco', p_marco, 'resultado', p_resultado);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_registrar_check(bigint, smallint, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acomp_registrar_check(bigint, smallint, text, date, text) TO authenticated;

-- ── Salvar o fim da linha (permaneceu, saída, motivo, observação, cidade) ─
CREATE OR REPLACE FUNCTION public.recrut_acomp_salvar(p_empregado_id bigint, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_nome text;
  v_cpf  text;
  v_perm text := nullif(btrim(coalesce(p_dados->>'permaneceu', '')), '');
  v_tipo text := nullif(btrim(coalesce(p_dados->>'tipo_saida', '')), '');
BEGIN
  IF NOT public.recrut_acomp_pode('alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para registrar o acompanhamento (ação Alterar).' USING ERRCODE = '42501';
  END IF;
  SELECT "CPF" INTO v_cpf FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador % não encontrado no cadastro.', p_empregado_id; END IF;
  IF v_perm = 'Não' AND nullif(p_dados->>'data_saida', '') IS NULL THEN
    RAISE EXCEPTION 'Quem não permaneceu precisa da data de saída.';
  END IF;

  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public."RECRUTAMENTO_ACOMPANHAMENTO"
         (empregado_id, cpf, permaneceu, data_saida, tipo_saida, motivo_saida, observacao, cidade, atualizado_por, atualizado_em)
  VALUES (p_empregado_id, v_cpf, v_perm, nullif(p_dados->>'data_saida', '')::date, v_tipo,
          nullif(btrim(coalesce(p_dados->>'motivo_saida', '')), ''), nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
          nullif(btrim(coalesce(p_dados->>'cidade', '')), ''), v_nome, now())
  ON CONFLICT (empregado_id) DO UPDATE
     SET permaneceu = EXCLUDED.permaneceu, data_saida = EXCLUDED.data_saida, tipo_saida = EXCLUDED.tipo_saida,
         motivo_saida = EXCLUDED.motivo_saida, observacao = EXCLUDED.observacao, cidade = EXCLUDED.cidade,
         atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
  RETURN jsonb_build_object('empregado_id', p_empregado_id, 'ok', true);
END $fn$;
REVOKE ALL ON FUNCTION public.recrut_acomp_salvar(bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrut_acomp_salvar(bigint, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.recrut_acomp_salvar(bigint, jsonb);
-- DROP FUNCTION IF EXISTS public.recrut_acomp_registrar_check(bigint, smallint, text, date, text);
-- DROP FUNCTION IF EXISTS public.recrut_acompanhamento_lista(text, date, date);
-- DROP POLICY IF EXISTS recrut_acomp_check_select ON public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK";
-- DROP POLICY IF EXISTS recrut_acomp_select ON public."RECRUTAMENTO_ACOMPANHAMENTO";
-- DROP FUNCTION IF EXISTS public.recrut_acomp_pode(public.app_acao);
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DELETE FROM public.screen_permission_user WHERE menu_codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DELETE FROM public.app_menu WHERE codigo IN ('recrutamento_acompanhar_colaboradores', 'recrutamento_acompanhar_experiencia');
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO_CHECK";  -- portaria-ok: R2 — rollback de tabela criada nesta migration
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_ACOMPANHAMENTO";        -- portaria-ok: R2 — rollback de tabela criada nesta migration
-- NOTIFY pgrst, 'reload schema';
