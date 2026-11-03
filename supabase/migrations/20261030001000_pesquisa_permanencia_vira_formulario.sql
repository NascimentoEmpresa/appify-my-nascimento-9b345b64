-- =========================================================================
-- PESQUISA DE PERMANÊNCIA SAI DO RH E VIRA UM FORMULÁRIO (30/10/2026)
--
-- Pablo, sobre o módulo da mig 20261028001200: "tem que ficar exatamente
-- igual, não precisa ter um sistema novo de formulário"; "o assistente de
-- i.a ter em todos formulários"; "tira do RH essa pesquisa permanência, vai
-- ficar só no formulários".
--
-- O QUE MUDA
--   1. O Formulários ganha dois tipos de pergunta, para QUALQUER formulário:
--        · local_trabalho      — Contrato → Posto de trabalho → Função, com a
--          mesma fonte da pesquisa (filial da Senior com gente ativa, posto
--          da Hierarquia de Postos, função de quem está lá);
--        · escolha_complemento — até N escolhas + a MAIS importante,
--          alternativa exclusiva e complemento embaixo da alternativa.
--      O config de cada um está em supabase/functions/_shared/
--      pesquisa-permanencia.ts (ConfigEscolha / ValorLocal) e é conferido
--      aqui no INSERT (trigger cs_form_resposta_tipos), como pp_responder
--      fazia. A mig 20261028001200 dizia "POR QUE NÃO É UM FORMULÁRIO" —
--      eram exatamente estas lacunas; agora o Formulários tem as duas.
--   2. CS_FORMULARIOS.sempre_anonimo: o formulário não guarda quem respondeu
--      nem quando a pessoa está logada (o celular do encarregado passa de mão
--      em mão no posto — sem isso a resposta sairia no nome do encarregado).
--   3. A pesquisa vira o formulário 6990cfd5-… (slug pesquisa-permanencia),
--      com as mesmas perguntas, na mesma ordem (perguntasDoFormulario() do
--      _shared — o teste confere o JSON abaixo). As respostas da tabela
--      antiga entram em CS_FORM_RESPOSTAS com o MESMO id (idempotente).
--   4. Rotatividade, Plano de ação e Assistente de I.A viram botões em
--      Formulários. Duas capacidades novas em CS_FORM_ACESSOS (Administração
--      › Acesso por Usuário › Formulários), que nascem só com quem já tinha
--      o menu da pesquisa no RH:
--        · rotatividade  — Rotatividade + Plano de ação (cs_form_rotatividade,
--                          cs_form_plano_vincular, cs_form_planos);
--        · assistente_ia — o Assistente de I.A, em TODOS os formulários
--                          (Edge Function formulario-assistente-ia). Ele só
--                          lê as respostas que a RLS já mostra à pessoa.
--      Quem tinha rh_pesquisa_permanencia/visualizar ganha também ver_tudo
--      SÓ neste formulário (regra própria, mig 20260921000002) para continuar
--      lendo as respostas.
--   5. Sai do RH: app_menu rh_pesquisa_permanencia (e as permissões dele) e as
--      RPCs pp_* (pp_publica/pp_responder eram chamáveis por anon). As
--      tabelas RH_PESQUISA_PERMANENCIA_* FICAM, sem acesso nenhum, como cópia
--      do que foi migrado — apagar depois de conferido.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Resposta sempre anônima ───────────────────────────────────────────
ALTER TABLE public."CS_FORMULARIOS" ADD COLUMN IF NOT EXISTS sempre_anonimo boolean NOT NULL DEFAULT false;

-- ── 2) Contratos, postos e funções (era pp_contratos_ativos) ─────────────
-- Interna (sem GRANT): o seletor público e a trava da resposta chamam.
-- Filtra por um contrato quando recebe empresa/filial.
CREATE OR REPLACE FUNCTION public.cs_form_locais_trabalho(p_empresa bigint DEFAULT NULL, p_filial bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  WITH ativos AS MATERIALIZED (
    SELECT x."Empresa"::bigint AS empresa, x."Filial"::bigint AS filial, btrim(x."Nome Filial") AS nome,
           NULLIF(btrim(CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE x."Posto" END), '') AS posto,
           NULLIF(btrim(x."Nome do Posto"), '') AS posto_senior,
           NULLIF(upper(btrim(regexp_replace(COALESCE(x."Título do Cargo", ''), '\s+', ' ', 'g'))), '') AS funcao
      FROM public."EMPREGADOS" x
      LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = x."ID"
     WHERE public.esp_col_esta_ativo(x."Situação")
       AND COALESCE(btrim(x."Nome"), '') <> '' AND COALESCE(btrim(x."Nome Filial"), '') <> ''
       AND x."Empresa" IS NOT NULL AND x."Filial" IS NOT NULL
       AND (p_empresa IS NULL OR x."Empresa" = p_empresa)
       AND (p_filial IS NULL OR x."Filial" = p_filial)
  ),
  ct AS (
    SELECT empresa, filial, min(nome) AS nome,
           COALESCE(jsonb_agg(DISTINCT funcao) FILTER (WHERE funcao IS NOT NULL), '[]'::jsonb) AS funcoes
      FROM ativos GROUP BY empresa, filial
  ),
  pf AS (
    SELECT empresa, filial, posto, min(posto_senior) AS posto_senior,
           COALESCE(jsonb_agg(DISTINCT funcao) FILTER (WHERE funcao IS NOT NULL), '[]'::jsonb) AS funcoes
      FROM ativos WHERE posto IS NOT NULL GROUP BY empresa, filial, posto
  ),
  po AS (
    SELECT c.empresa, c.filial, p.codigo, COALESCE(NULLIF(btrim(p.titulo), ''), p.descricao) AS nome,
           COALESCE(pf.funcoes, '[]'::jsonb) AS funcoes
      FROM ct c
      JOIN public."RH_POSTO_TRABALHO" p ON p.empresa = c.empresa AND p.filial = c.filial AND p.ativo
      LEFT JOIN pf ON pf.empresa = c.empresa AND pf.filial = c.filial AND pf.posto = p.codigo
     WHERE COALESCE(p.vagas, 0) > 0 OR pf.posto IS NOT NULL
    UNION ALL
    SELECT pf.empresa, pf.filial, pf.posto, COALESCE(pf.posto_senior, pf.posto), pf.funcoes
      FROM pf
     WHERE NOT EXISTS (SELECT 1 FROM public."RH_POSTO_TRABALHO" p
                        WHERE p.codigo = pf.posto AND p.empresa = pf.empresa AND p.filial = pf.filial AND p.ativo)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'empresa', c.empresa, 'filial', c.filial, 'nome', c.nome, 'funcoes', c.funcoes,
           'postos', COALESCE((SELECT jsonb_agg(jsonb_build_object('codigo', po.codigo, 'nome', po.nome, 'funcoes', po.funcoes)
                                                ORDER BY po.nome, po.codigo)
                                 FROM po WHERE po.empresa = c.empresa AND po.filial = c.filial), '[]'::jsonb))
           ORDER BY c.nome), '[]'::jsonb)
    FROM ct c
$fn$;
REVOKE ALL ON FUNCTION public.cs_form_locais_trabalho(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- Para o seletor da página pública: só entrega a lista para formulário que
-- existe, não está na lixeira e tem uma pergunta local_trabalho (a pesquisa
-- antiga entregava a mesma lista a quem tivesse o link).
CREATE OR REPLACE FUNCTION public.cs_form_locais_trabalho_publico(p_formulario uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" f
                  WHERE f.id = p_formulario AND f.deleted_at IS NULL
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(f.perguntas, '[]'::jsonb)) p
                                 WHERE p ->> 'tipo' = 'local_trabalho')) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN public.cs_form_locais_trabalho();
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_locais_trabalho_publico(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cs_form_locais_trabalho_publico(uuid) TO anon, authenticated;

-- ── 3) Validação da escolha_complemento (era pp_validar, por pergunta) ───
-- Devolve o primeiro erro (texto para a tela) ou NULL. Mesma regra de
-- errosDaPergunta() no _shared: máximo de escolhas, a mais importante entre
-- as marcadas, exclusiva sozinha, complemento obrigatório quando a
-- alternativa dele foi marcada (e só então), texto curto com limite.
CREATE OR REPLACE FUNCTION public.cs_form_valida_escolha(p_cfg jsonb, p_v jsonb, p_titulo text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_max  int := GREATEST(COALESCE(NULLIF(p_cfg ->> 'max', '')::int, 1), 1);
  v_cods jsonb := COALESCE((SELECT jsonb_agg(i ->> 'cod') FROM jsonb_array_elements(COALESCE(p_cfg -> 'itens', '[]'::jsonb)) i), '[]'::jsonb);
  v_tit  text := COALESCE(NULLIF(btrim(p_titulo), ''), 'pergunta');
  marc jsonb; n int; it jsonb; cr jsonb; c jsonb; t text; k text;
BEGIN
  IF p_v IS NULL OR jsonb_typeof(p_v) <> 'object' OR jsonb_typeof(p_v -> 'marcadas') IS DISTINCT FROM 'array' THEN
    RETURN format('Responda "%s".', v_tit);
  END IF;
  marc := p_v -> 'marcadas';
  n := jsonb_array_length(marc);
  IF n = 0 THEN RETURN format('Responda "%s".', v_tit); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(marc) x WHERE jsonb_typeof(x) <> 'string' OR NOT v_cods ? (x #>> '{}'))
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(marc) x) <> n THEN
    RETURN format('"%s": alternativa inválida.', v_tit);
  END IF;
  IF n > v_max THEN RETURN format('"%s": marque no máximo %s.', v_tit, v_max); END IF;
  IF n > 1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_cfg -> 'itens') i
                        WHERE (i ->> 'exclusiva')::boolean IS TRUE AND marc ? (i ->> 'cod')) THEN
    RETURN format('"%s": essa alternativa não pode ser combinada com outras.', v_tit);
  END IF;
  IF v_max > 1 AND NOT (jsonb_typeof(p_v -> 'principal') = 'string' AND marc ? (p_v ->> 'principal')) THEN
    RETURN format('"%s": indique a mais importante entre as que marcou.', v_tit);
  END IF;

  IF p_v ? 'comp' AND jsonb_typeof(p_v -> 'comp') <> 'object' THEN RETURN format('"%s": complemento inválido.', v_tit); END IF;
  IF p_v ? 'texto' AND jsonb_typeof(p_v -> 'texto') <> 'object' THEN RETURN format('"%s": texto inválido.', v_tit); END IF;
  -- Complemento/texto só de alternativa marcada que tem complemento (com texto).
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_v -> 'comp', '{}'::jsonb)) LOOP
    IF NOT marc ? k OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_cfg -> 'itens') i
                                     WHERE i ->> 'cod' = k AND jsonb_typeof(i -> 'complemento') = 'object') THEN
      RETURN format('"%s": complemento inválido.', v_tit);
    END IF;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_v -> 'texto', '{}'::jsonb)) LOOP
    IF NOT marc ? k OR jsonb_typeof(p_v -> 'texto' -> k) <> 'string'
       OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_cfg -> 'itens') i
                       WHERE i ->> 'cod' = k AND jsonb_typeof(i -> 'complemento' -> 'texto') = 'object') THEN
      RETURN format('"%s": texto inválido.', v_tit);
    END IF;
  END LOOP;

  FOR it IN SELECT i FROM jsonb_array_elements(p_cfg -> 'itens') i WHERE jsonb_typeof(i -> 'complemento') = 'object' LOOP
    CONTINUE WHEN NOT marc ? (it ->> 'cod');
    cr := it -> 'complemento';
    c := p_v -> 'comp' -> (it ->> 'cod');
    IF c IS NULL OR jsonb_typeof(c) <> 'array' OR jsonb_array_length(c) = 0 THEN
      RETURN format('"%s": responda "%s".', v_tit, cr ->> 'titulo');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(c) x
                WHERE jsonb_typeof(x) <> 'string'
                   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cr -> 'opcoes') o WHERE o ->> 'cod' = x #>> '{}'))
       OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(c) x) <> jsonb_array_length(c)
       OR (NOT COALESCE((cr ->> 'multipla')::boolean, false) AND jsonb_array_length(c) > 1) THEN
      RETURN format('"%s": complemento inválido.', v_tit);
    END IF;
    IF jsonb_typeof(cr -> 'texto') = 'object' THEN
      t := btrim(COALESCE(p_v -> 'texto' ->> (it ->> 'cod'), ''));
      IF t = '' THEN RETURN format('"%s": responda "%s".', v_tit, cr -> 'texto' ->> 'rotulo'); END IF;
      IF length(t) > COALESCE((cr -> 'texto' ->> 'max')::int, 200) THEN
        RETURN format('"%s": "%s" com no máximo %s letras.', v_tit, cr -> 'texto' ->> 'rotulo', cr -> 'texto' ->> 'max');
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_valida_escolha(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 4) Trava da resposta para os tipos novos + sempre anônimo ────────────
-- BEFORE INSERT, e com nome que vem ANTES de trg_cs_form_resposta_guard na
-- ordem alfabética (o Postgres dispara nessa ordem): o guard é quem apaga a
-- identidade quando anonimo = true, então o "sempre anônimo" tem que ligar a
-- flag antes dele.
-- A validação só roda em requisição da API (request.jwt.claims presente):
-- a migração das respostas antigas, logo abaixo, regrava contratos que podem
-- não estar mais ativos e não pode ser barrada por isso.
CREATE OR REPLACE FUNCTION public.cs_form_resposta_tipos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_form  record;
  v_perg  jsonb;
  v_val   jsonb;
  v_ct    jsonb;
  v_posto jsonb;
  v_fun   text;
  v_erro  text;
  v_tit   text;
  v_alvo  boolean;
BEGIN
  SELECT perguntas, sempre_anonimo INTO v_form FROM public."CS_FORMULARIOS" WHERE id = NEW.formulario_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF COALESCE(v_form.sempre_anonimo, false) THEN NEW.anonimo := true; END IF;

  IF COALESCE(current_setting('request.jwt.claims', true), '') = '' THEN RETURN NEW; END IF;
  IF octet_length(COALESCE(NEW.itens::text, '')) > 200000 THEN
    RAISE EXCEPTION 'Resposta grande demais.' USING ERRCODE = '22023';
  END IF;

  FOR v_perg IN SELECT * FROM jsonb_array_elements(COALESCE(v_form.perguntas, '[]'::jsonb)) LOOP
    CONTINUE WHEN COALESCE(v_perg ->> 'tipo', '') NOT IN ('local_trabalho', 'escolha_complemento');
    v_tit := COALESCE(NULLIF(btrim(v_perg ->> 'titulo'), ''), 'pergunta');
    v_val := NEW.itens -> (v_perg ->> 'id');
    -- Pergunta com público-alvo pode não ter aparecido para quem respondeu:
    -- obrigatoriedade só vale para a pergunta que todo mundo vê.
    v_alvo := jsonb_array_length(COALESCE(v_perg -> 'config' -> 'setores', '[]'::jsonb)) > 0
           OR jsonb_array_length(COALESCE(v_perg -> 'config' -> 'pessoas', '[]'::jsonb)) > 0;
    IF v_val IS NULL OR v_val = 'null'::jsonb OR v_val = '""'::jsonb OR v_val = '{}'::jsonb THEN
      IF COALESCE((v_perg ->> 'obrigatoria')::boolean, false) AND NOT v_alvo THEN
        RAISE EXCEPTION 'Responda "%".', v_tit USING ERRCODE = '22023';
      END IF;
      NEW.itens := NEW.itens - (v_perg ->> 'id');
      CONTINUE;
    END IF;

    IF v_perg ->> 'tipo' = 'local_trabalho' THEN
      IF jsonb_typeof(v_val) <> 'object' THEN RAISE EXCEPTION 'Escolha o contrato na lista.' USING ERRCODE = '22023'; END IF;
      v_ct := public.cs_form_locais_trabalho(NULLIF(v_val ->> 'empresa', '')::bigint, NULLIF(v_val ->> 'filial', '')::bigint) -> 0;
      IF v_ct IS NULL OR v_val ->> 'empresa' IS NULL OR v_val ->> 'filial' IS NULL THEN
        RAISE EXCEPTION 'Escolha o contrato na lista.' USING ERRCODE = '22023';
      END IF;
      v_posto := NULL;
      IF NULLIF(btrim(COALESCE(v_val ->> 'posto', '')), '') IS NOT NULL THEN
        SELECT p INTO v_posto FROM jsonb_array_elements(v_ct -> 'postos') p WHERE p ->> 'codigo' = btrim(v_val ->> 'posto');
        IF v_posto IS NULL THEN RAISE EXCEPTION 'Escolha o posto na lista.' USING ERRCODE = '22023'; END IF;
      END IF;
      v_fun := NULLIF(upper(btrim(regexp_replace(COALESCE(v_val ->> 'funcao', ''), '\s+', ' ', 'g'))), '');
      IF v_fun IS NULL OR NOT (v_ct -> 'funcoes') ? v_fun THEN
        RAISE EXCEPTION 'Escolha a função na lista.' USING ERRCODE = '22023';
      END IF;
      -- Grava o que o cadastro diz (nome do contrato/posto), não o que veio.
      NEW.itens := jsonb_set(NEW.itens, ARRAY[v_perg ->> 'id'], jsonb_build_object(
        'empresa', (v_ct ->> 'empresa')::bigint, 'filial', (v_ct ->> 'filial')::bigint, 'contrato', v_ct ->> 'nome',
        'posto', v_posto ->> 'codigo', 'posto_nome', v_posto ->> 'nome', 'funcao', v_fun));
    ELSE
      v_erro := public.cs_form_valida_escolha(v_perg -> 'config', v_val, v_tit);
      IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro USING ERRCODE = '22023'; END IF;
      -- Só o que a pergunta define (nada além de marcadas/principal/comp/texto).
      NEW.itens := jsonb_set(NEW.itens, ARRAY[v_perg ->> 'id'], jsonb_strip_nulls(jsonb_build_object(
        'marcadas', v_val -> 'marcadas',
        'principal', CASE WHEN COALESCE(NULLIF(v_perg -> 'config' ->> 'max', '')::int, 1) > 1 THEN v_val -> 'principal' END,
        'comp', NULLIF(v_val -> 'comp', '{}'::jsonb),
        'texto', (SELECT jsonb_object_agg(t.key, btrim(t.value #>> '{}')) FROM jsonb_each(COALESCE(v_val -> 'texto', '{}'::jsonb)) t))));
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_resposta_tipos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cs_form_resposta_a_tipos ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_resposta_a_tipos
  BEFORE INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_resposta_tipos();

-- ── 5) Rotatividade (era pp_turnover) ────────────────────────────────────
-- Últimos p_meses (o atual incluso, até hoje), por filial × posto × função,
-- mês a mês. Regra de dir_turnover_variacao_efetivo (Relatórios › Turn-over
-- › Variação de Efetivo, mig 20261025000010). Portão: capacidade rotatividade.
CREATE OR REPLACE FUNCTION public.cs_form_rotatividade(p_meses integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_n   int := LEAST(GREATEST(COALESCE(p_meses, 12), 1), 24);
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.cs_form_cap('rotatividade') THEN
    RAISE EXCEPTION 'Sem acesso à Rotatividade dos formulários.' USING ERRCODE = '42501';
  END IF;
  WITH
  mm AS MATERIALIZED (
    SELECT (row_number() OVER (ORDER BY s.ini))::int AS i, s.ini,
           LEAST((s.ini + interval '1 month' - interval '1 day')::date, current_date) AS fim
      FROM (SELECT (date_trunc('month', current_date) - make_interval(months => g))::date AS ini
              FROM generate_series(0, v_n - 1) g) s
  ),
  e AS MATERIALIZED (
    SELECT public.data_universal(x."Admissão"::text) AS adm,
           CASE WHEN x."Situação" = 'Demitido' THEN public.data_universal(x."Data Afastamento"::text) END AS dem,
           (public.esp_col_esta_ativo(x."Situação") OR x."Situação" = 'Demitido') AS conta,
           x."Empresa"::bigint AS empresa, x."Filial"::bigint AS filial,
           NULLIF(btrim(x."Nome Filial"), '') AS nome_filial,
           NULLIF(btrim(CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE x."Posto" END), '') AS posto,
           NULLIF(btrim(x."Nome do Posto"), '') AS posto_senior,
           COALESCE(NULLIF(upper(btrim(regexp_replace(COALESCE(x."Título do Cargo", ''), '\s+', ' ', 'g'))), ''), '(SEM FUNÇÃO)') AS funcao
      FROM public."EMPREGADOS" x
      LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = x."ID"
     WHERE COALESCE(btrim(x."Nome"), '') <> '' AND x."Empresa" IS NOT NULL AND x."Filial" IS NOT NULL
  ),
  ep AS MATERIALIZED (
    SELECT * FROM e
     WHERE (e.adm IS NULL OR e.adm <= (SELECT max(fim) FROM mm))
       AND (e.dem IS NULL OR e.dem >= (SELECT min(ini) FROM mm))
  ),
  mov AS MATERIALIZED (
    SELECT p.empresa, p.filial, p.posto, p.funcao, mm.i,
           count(*) FILTER (WHERE p.conta AND p.adm <= mm.fim AND (p.dem IS NULL OR p.dem > mm.fim)) AS trab,
           count(*) FILTER (WHERE p.dem BETWEEN mm.ini AND mm.fim) AS dem,
           count(*) FILTER (WHERE p.adm BETWEEN mm.ini AND mm.fim) AS adm
      FROM ep p CROSS JOIN mm
     GROUP BY 1, 2, 3, 4, 5
  ),
  g AS MATERIALIZED (
    SELECT DISTINCT empresa, filial, posto, funcao FROM mov WHERE trab > 0 OR dem > 0 OR adm > 0
  ),
  nomes AS MATERIALIZED (
    SELECT empresa, filial, min(nome_filial) AS nome FROM e GROUP BY 1, 2
  ),
  pnome AS MATERIALIZED (
    SELECT posto, min(posto_senior) AS nome FROM e WHERE posto IS NOT NULL GROUP BY 1
  ),
  linhas AS (
    SELECT g.empresa, g.filial, g.posto, g.funcao,
           array_agg(COALESCE(m.trab, 0) ORDER BY mm.i) AS trab,
           array_agg(COALESCE(m.dem, 0)  ORDER BY mm.i) AS dem,
           array_agg(COALESCE(m.adm, 0)  ORDER BY mm.i) AS adm
      FROM g CROSS JOIN mm
      LEFT JOIN mov m ON m.empresa = g.empresa AND m.filial = g.filial AND m.funcao = g.funcao
                     AND m.posto IS NOT DISTINCT FROM g.posto AND m.i = mm.i
     GROUP BY 1, 2, 3, 4
  )
  SELECT jsonb_build_object(
    'meses', (SELECT jsonb_agg(to_char(ini, 'YYYY-MM') ORDER BY ini) FROM mm),
    'gerado_em', now(),
    'linhas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'empresa', l.empresa, 'filial', l.filial,
               'contrato', COALESCE(n.nome, format('Filial %s-%s', l.empresa, l.filial)),
               'posto', l.posto,
               'posto_nome', COALESCE(NULLIF(btrim(pt.titulo), ''), pt.descricao, pn.nome),
               'funcao', l.funcao, 'trab', to_jsonb(l.trab), 'dem', to_jsonb(l.dem), 'adm', to_jsonb(l.adm)))
        FROM linhas l
        LEFT JOIN nomes n ON n.empresa = l.empresa AND n.filial = l.filial
        LEFT JOIN public."RH_POSTO_TRABALHO" pt ON pt.codigo = l.posto
        LEFT JOIN pnome pn ON pn.posto = l.posto), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_rotatividade(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_rotatividade(integer) TO authenticated;

-- ── 6) Plano de ação nascido do formulário ───────────────────────────────
-- Não há plano novo: a ação é criada pelo criar_plano_acao de sempre (Plano
-- de Ações, mesma permissão) e aqui só fica de qual formulário/contrato/
-- posto/função e motivo ela nasceu (era RH_PESQUISA_PERMANENCIA_PLANO).
CREATE TABLE IF NOT EXISTS public."CS_FORM_PLANO_ORIGEM" (
  plano_acao_id uuid PRIMARY KEY REFERENCES public.plano_acao(id) ON DELETE CASCADE,
  formulario_id uuid REFERENCES public."CS_FORMULARIOS"(id) ON DELETE SET NULL,
  empresa       bigint,
  filial        bigint,
  contrato      text,
  posto_codigo  text,
  posto_nome    text,
  funcao        text,
  motivo        text,
  criado_por    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_form_plano_origem_form ON public."CS_FORM_PLANO_ORIGEM"(formulario_id);
-- Ninguém lê direto: só pelas RPCs abaixo.
ALTER TABLE public."CS_FORM_PLANO_ORIGEM" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_FORM_PLANO_ORIGEM" FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cs_form_plano_vincular(
  p_plano uuid, p_formulario uuid, p_empresa bigint, p_filial bigint, p_contrato text,
  p_posto text, p_posto_nome text, p_funcao text, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.cs_form_cap('rotatividade') THEN
    RAISE EXCEPTION 'Sem acesso ao Plano de ação dos formulários.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plano_acao p WHERE p.id = p_plano AND p.criado_por = auth.uid() AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Ação não encontrada ou criada por outra pessoa.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."CS_FORM_PLANO_ORIGEM"
    (plano_acao_id, formulario_id, empresa, filial, contrato, posto_codigo, posto_nome, funcao, motivo)
  VALUES (p_plano, p_formulario, p_empresa, p_filial, NULLIF(btrim(p_contrato), ''), NULLIF(btrim(p_posto), ''),
          NULLIF(btrim(p_posto_nome), ''), NULLIF(upper(btrim(p_funcao)), ''), left(NULLIF(btrim(p_motivo), ''), 500))
  ON CONFLICT (plano_acao_id) DO UPDATE
    SET formulario_id = EXCLUDED.formulario_id, empresa = EXCLUDED.empresa, filial = EXCLUDED.filial,
        contrato = EXCLUDED.contrato, posto_codigo = EXCLUDED.posto_codigo, posto_nome = EXCLUDED.posto_nome,
        funcao = EXCLUDED.funcao, motivo = EXCLUDED.motivo;
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_plano_vincular(uuid, uuid, bigint, bigint, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_plano_vincular(uuid, uuid, bigint, bigint, text, text, text, text, text) TO authenticated;

-- As ações do formulário que a pessoa enxerga no Plano de Ações (a
-- visibilidade da ação continua sendo a de lá).
CREATE OR REPLACE FUNCTION public.cs_form_planos(p_formulario uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.cs_form_cap('rotatividade') THEN
    RAISE EXCEPTION 'Sem acesso ao Plano de ação dos formulários.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'titulo', p.titulo, 'status', p.status_normalizado, 'prioridade', p.prioridade_normalizada,
             'prazo', p.data_fim_planejado, 'responsavel', p.responsavel_nome_origem, 'created_at', v.created_at,
             'formulario_id', v.formulario_id, 'empresa', v.empresa, 'filial', v.filial, 'contrato', v.contrato,
             'posto', v.posto_codigo, 'posto_nome', v.posto_nome, 'funcao', v.funcao, 'motivo', v.motivo)
             ORDER BY v.created_at DESC)
      FROM public."CS_FORM_PLANO_ORIGEM" v
      JOIN public.plano_acao p ON p.id = v.plano_acao_id AND p.deleted_at IS NULL
     WHERE v.formulario_id = p_formulario
       AND public.plano_acao_visible_by_user(auth.uid(), p.id)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.cs_form_planos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_planos(uuid) TO authenticated;

-- ── 7) O formulário ──────────────────────────────────────────────────────
-- Publicado se alguma aplicação antiga ainda recebia resposta. Liberado (sem
-- login), sempre anônimo, sem limite. ON CONFLICT DO NOTHING: re-rodar não
-- desfaz o que for editado depois no Formulários.
-- form-permanencia-inicio
INSERT INTO public."CS_FORMULARIOS"
  (id, titulo, descricao, slug, status, coleta_identificacao, seguranca, permite_anonimo, sempre_anonimo, criado_por_nome, perguntas)
SELECT '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid,
       'Pesquisa de Permanência e Ambiente de Trabalho',
       E'Sua opinião pode melhorar o seu ambiente de trabalho!\n\nQueremos ouvir você e entender o que podemos melhorar. Responda com sinceridade! Suas respostas vão ajudar a construir um ambiente mais respeitoso, organizado e acolhedor. Não existem respostas certas ou erradas.\n\nNão é preciso dizer o seu nome. Todas as perguntas são obrigatórias.',
       'pesquisa-permanencia',
       CASE WHEN EXISTS (SELECT 1 FROM public."RH_PESQUISA_PERMANENCIA_APLICACAO" a
                          WHERE a.ativa AND (a.inicia_em IS NULL OR a.inicia_em <= current_date)
                            AND (a.encerra_em IS NULL OR a.encerra_em >= current_date))
            THEN 'publicado' ELSE 'encerrado' END,
       false, 'liberado', true, true, 'RH (migrado da Pesquisa de Permanência)',
       '[{"id":"65c6c19d-a958-47fb-8b66-1b07bd7a58dc","tipo":"local_trabalho","titulo":"Onde você trabalha","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":[],"config":{}},{"id":"4e5df533-32eb-4940-baff-4d573e864846","tipo":"escolha_complemento","titulo":"Qual é o principal motivo que faz você permanecer no Grupo Nascimento?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Salário e benefícios","Bom relacionamento com os colegas","Boa liderança e respeito","Horário e localização do trabalho","Segurança e estabilidade no emprego","Reconhecimento e valorização"],"config":{"codigo":"p1","max":3,"itens":[{"cod":"salario","rotulo":"Salário e benefícios"},{"cod":"colegas","rotulo":"Bom relacionamento com os colegas"},{"cod":"lideranca","rotulo":"Boa liderança e respeito"},{"cod":"horario_local","rotulo":"Horário e localização do trabalho"},{"cod":"estabilidade","rotulo":"Segurança e estabilidade no emprego"},{"cod":"reconhecimento","rotulo":"Reconhecimento e valorização"}]}},{"id":"2c95e9da-12d2-467b-bdee-f6501cac74f8","tipo":"escolha_complemento","titulo":"Quais situações poderiam levar você a pedir demissão?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Salário ou benefícios melhores em outra empresa","Problemas com a liderança do Grupo Nascimento","Problemas com fiscais ou servidores do órgão público","Sobrecarga ou condições ruins de trabalho","Problemas de relacionamento com colegas","Questões pessoais, familiares ou de transporte"],"config":{"codigo":"p2","max":3,"itens":[{"cod":"salario_fora","rotulo":"Salário ou benefícios melhores em outra empresa"},{"cod":"lideranca","rotulo":"Problemas com a liderança do Grupo Nascimento","complemento":{"titulo":"Quais dificuldades ocorrem?","multipla":true,"opcoes":[{"cod":"grosseria","rotulo":"Grosserias ou falta de respeito"},{"cod":"sem_apoio","rotulo":"Falta de apoio e orientação"},{"cod":"desigual","rotulo":"Tratamento desigual"},{"cod":"cobranca","rotulo":"Cobranças excessivas"}]}},{"cod":"fiscais","rotulo":"Problemas com fiscais ou servidores do órgão público","complemento":{"titulo":"Quais dificuldades ocorrem?","multipla":true,"opcoes":[{"cod":"grosseria","rotulo":"Grosserias ou desrespeito"},{"cod":"ordens_conflitantes","rotulo":"Ordens conflitantes com as do encarregado"},{"cod":"fora_contrato","rotulo":"Exigências fora das atividades contratadas"},{"cod":"pressao","rotulo":"Interferência ou pressão excessiva"}]}},{"cod":"sobrecarga","rotulo":"Sobrecarga ou condições ruins de trabalho"},{"cod":"colegas","rotulo":"Problemas de relacionamento com colegas"},{"cod":"pessoais","rotulo":"Questões pessoais, familiares ou de transporte"}]}},{"id":"88b052b7-3136-4f4e-a8ad-69cf968afe98","tipo":"escolha_complemento","titulo":"Como você avalia seu relacionamento com o encarregado?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Muito bom","Bom","Regular","Ruim"],"config":{"codigo":"p3","max":1,"itens":[{"cod":"muito_bom","rotulo":"Muito bom"},{"cod":"bom","rotulo":"Bom"},{"cod":"regular","rotulo":"Regular","complemento":{"titulo":"O que precisa melhorar?","multipla":true,"opcoes":[{"cod":"respeito","rotulo":"Respeito no tratamento"},{"cod":"comunicacao","rotulo":"Comunicação e orientação"},{"cod":"apoio","rotulo":"Apoio para resolver problemas"},{"cod":"tarefas","rotulo":"Distribuição das tarefas"}]}},{"cod":"ruim","rotulo":"Ruim","complemento":{"titulo":"O que precisa melhorar?","multipla":true,"opcoes":[{"cod":"respeito","rotulo":"Respeito no tratamento"},{"cod":"comunicacao","rotulo":"Comunicação e orientação"},{"cod":"apoio","rotulo":"Apoio para resolver problemas"},{"cod":"tarefas","rotulo":"Distribuição das tarefas"}]}}]}},{"id":"37a1620a-e8cd-4fff-aaba-2ab6e7d4b80e","tipo":"escolha_complemento","titulo":"Como os fiscais do órgão público influenciam seu trabalho?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Positivamente: ajudam e colaboram","Não interferem na minha rotina","Interferem, mas sem prejudicar o trabalho","Negativamente: dificultam meu trabalho"],"config":{"codigo":"p4","max":1,"itens":[{"cod":"positivo","rotulo":"Positivamente: ajudam e colaboram"},{"cod":"nao_interferem","rotulo":"Não interferem na minha rotina"},{"cod":"interferem","rotulo":"Interferem, mas sem prejudicar o trabalho"},{"cod":"negativo","rotulo":"Negativamente: dificultam meu trabalho","complemento":{"titulo":"De que forma?","multipla":true,"opcoes":[{"cod":"grosseria","rotulo":"Tratamento grosseiro ou desrespeitoso"},{"cod":"ordens_diferentes","rotulo":"Ordens diferentes das do encarregado"},{"cod":"fora_contrato","rotulo":"Exigências fora das atividades contratadas"},{"cod":"cobranca","rotulo":"Cobranças excessivas ou injustas"}]}}]}},{"id":"81f8233e-fbba-4069-86bb-66573f72896f","tipo":"escolha_complemento","titulo":"Como você avalia as condições de trabalho dentro do órgão público?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Boas: tenho condições adequadas","Regulares: existem dificuldades","Ruins: prejudicam meu trabalho"],"config":{"codigo":"p5","max":1,"itens":[{"cod":"boas","rotulo":"Boas: tenho condições adequadas"},{"cod":"regulares","rotulo":"Regulares: existem dificuldades","complemento":{"titulo":"Quais dificuldades?","multipla":true,"opcoes":[{"cod":"materiais","rotulo":"Falta de materiais ou equipamentos"},{"cod":"estrutura","rotulo":"Estrutura física inadequada"},{"cod":"descanso","rotulo":"Local inadequado para descanso e refeições"},{"cod":"ambiente","rotulo":"Ambiente desrespeitoso"},{"cod":"excesso","rotulo":"Excesso de tarefas"}]}},{"cod":"ruins","rotulo":"Ruins: prejudicam meu trabalho","complemento":{"titulo":"Quais dificuldades?","multipla":true,"opcoes":[{"cod":"materiais","rotulo":"Falta de materiais ou equipamentos"},{"cod":"estrutura","rotulo":"Estrutura física inadequada"},{"cod":"descanso","rotulo":"Local inadequado para descanso e refeições"},{"cod":"ambiente","rotulo":"Ambiente desrespeitoso"},{"cod":"excesso","rotulo":"Excesso de tarefas"}]}}]}},{"id":"d077e8ec-8b72-4949-80e4-da39a7000cce","tipo":"escolha_complemento","titulo":"Entre as empresas que prestam serviços na universidade, qual você considera a melhor para trabalhar?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Grupo Nascimento","Outra empresa","Não conheço as condições das outras empresas para comparar"],"config":{"codigo":"p6","max":1,"itens":[{"cod":"grupo_nascimento","rotulo":"Grupo Nascimento"},{"cod":"outra","rotulo":"Outra empresa","complemento":{"titulo":"E qual é seu principal diferencial?","multipla":false,"texto":{"rotulo":"Qual empresa?","max":80},"opcoes":[{"cod":"salario","rotulo":"Salário e benefícios"},{"cod":"tratamento","rotulo":"Tratamento dos funcionários"},{"cod":"condicoes","rotulo":"Condições de trabalho"},{"cod":"horarios","rotulo":"Horários e escalas"}]}},{"cod":"nao_conhece","rotulo":"Não conheço as condições das outras empresas para comparar"}]}},{"id":"cdc477b0-f272-491b-bb14-dfa03b5c57be","tipo":"escolha_complemento","titulo":"Você indicaria o Grupo Nascimento para um amigo trabalhar?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Sim, com certeza","Sim, mas há pontos a melhorar","Não indicaria"],"config":{"codigo":"p7","max":1,"itens":[{"cod":"sim","rotulo":"Sim, com certeza"},{"cod":"sim_mas","rotulo":"Sim, mas há pontos a melhorar"},{"cod":"nao","rotulo":"Não indicaria","complemento":{"titulo":"Qual é o principal motivo?","multipla":false,"opcoes":[{"cod":"salario","rotulo":"Salário e benefícios"},{"cod":"tratamento","rotulo":"Tratamento recebido"},{"cod":"condicoes","rotulo":"Condições de trabalho"},{"cod":"sem_apoio","rotulo":"Falta de apoio da empresa"}]}}]}},{"id":"231250a9-8a01-4b26-bf21-536963f38561","tipo":"escolha_complemento","titulo":"Quais devem ser as prioridades do Grupo Nascimento para melhorar o trabalho?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Melhorar salários e benefícios","Melhorar comunicação e apoio","Capacitar e melhorar as lideranças","Melhorar materiais e condições de trabalho","Melhorar relacionamento com os fiscais","Valorizar e reconhecer os funcionários","Manter as condições atuais: estou satisfeito"],"config":{"codigo":"p8","max":3,"itens":[{"cod":"salario","rotulo":"Melhorar salários e benefícios"},{"cod":"comunicacao","rotulo":"Melhorar comunicação e apoio"},{"cod":"liderancas","rotulo":"Capacitar e melhorar as lideranças"},{"cod":"materiais","rotulo":"Melhorar materiais e condições de trabalho"},{"cod":"fiscais","rotulo":"Melhorar relacionamento com os fiscais"},{"cod":"reconhecimento","rotulo":"Valorizar e reconhecer os funcionários"},{"cod":"manter","rotulo":"Manter as condições atuais: estou satisfeito","exclusiva":true}]}}]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public."CS_FORMULARIOS" WHERE id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid);
-- form-permanencia-fim

-- ── 8) As respostas antigas ──────────────────────────────────────────────
-- Mesmo id da resposta antiga (re-rodar não duplica); enviado_em = quando foi
-- respondida; anônima, como era. O local de trabalho vai como gravado na
-- época (o contrato pode não estar mais ativo — por isso a trava da seção 4
-- não roda fora da API).
INSERT INTO public."CS_FORM_RESPOSTAS" (id, formulario_id, enviado_em, anonimo, itens)
SELECT r.id, '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid, r.created_at, true,
       jsonb_build_object('65c6c19d-a958-47fb-8b66-1b07bd7a58dc', jsonb_build_object(
         'empresa', r.empresa, 'filial', r.filial, 'contrato', r.contrato,
         'posto', r.posto_codigo, 'posto_nome', r.posto_nome, 'funcao', r.funcao))
       || COALESCE((SELECT jsonb_object_agg(m.pid, r.respostas -> m.cod)
                      FROM (VALUES ('p1', '4e5df533-32eb-4940-baff-4d573e864846'),
                                   ('p2', '2c95e9da-12d2-467b-bdee-f6501cac74f8'),
                                   ('p3', '88b052b7-3136-4f4e-a8ad-69cf968afe98'),
                                   ('p4', '37a1620a-e8cd-4fff-aaba-2ab6e7d4b80e'),
                                   ('p5', '81f8233e-fbba-4069-86bb-66573f72896f'),
                                   ('p6', 'd077e8ec-8b72-4949-80e4-da39a7000cce'),
                                   ('p7', 'cdc477b0-f272-491b-bb14-dfa03b5c57be'),
                                   ('p8', '231250a9-8a01-4b26-bf21-536963f38561')) AS m(cod, pid)
                     WHERE r.respostas ? m.cod), '{}'::jsonb)
  FROM public."RH_PESQUISA_PERMANENCIA_RESPOSTA" r
ON CONFLICT (id) DO NOTHING;

-- Ações já ligadas à pesquisa passam a ser do formulário.
INSERT INTO public."CS_FORM_PLANO_ORIGEM"
  (plano_acao_id, formulario_id, empresa, filial, contrato, posto_codigo, posto_nome, funcao, motivo, criado_por, created_at)
SELECT v.plano_acao_id, '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid, v.empresa, v.filial, v.contrato,
       v.posto_codigo, v.posto_nome, v.funcao, v.motivo, v.criado_por, v.created_at
  FROM public."RH_PESQUISA_PERMANENCIA_PLANO" v
ON CONFLICT (plano_acao_id) DO NOTHING;

-- ── 9) Quem tinha a pesquisa no RH continua tendo ────────────────────────
-- visualizar → assistente_ia + rotatividade (geral) e ver_tudo SÓ neste
-- formulário. Ninguém mais ganha nada: as capacidades novas nascem vazias.
INSERT INTO public."CS_FORM_ACESSOS" (papel, user_id, formulario_id)
SELECT DISTINCT x.papel, s.user_id, x.form
  FROM public.screen_permission_user s
  CROSS JOIN (VALUES ('assistente_ia', NULL::uuid), ('rotatividade', NULL::uuid),
                     ('ver_tudo', '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid)) AS x(papel, form)
 WHERE s.menu_codigo = 'rh_pesquisa_permanencia' AND s.acao = 'visualizar'::public.app_acao AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                    WHERE a.papel = x.papel AND a.user_id = s.user_id
                      AND a.formulario_id IS NOT DISTINCT FROM x.form);

-- ── 10) Sai do RH ────────────────────────────────────────────────────────
DELETE FROM public.screen_permission_user WHERE menu_codigo = 'rh_pesquisa_permanencia';
DELETE FROM public.app_menu_acao WHERE menu_codigo = 'rh_pesquisa_permanencia';
DELETE FROM public.app_menu WHERE codigo = 'rh_pesquisa_permanencia';

DROP FUNCTION IF EXISTS public.pp_planos();
DROP FUNCTION IF EXISTS public.pp_vincular_plano(uuid, uuid, bigint, bigint, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.pp_turnover(integer);
DROP FUNCTION IF EXISTS public.pp_respostas(uuid);
DROP FUNCTION IF EXISTS public.pp_aplicacao_salvar(uuid, text, date, date, boolean);
DROP FUNCTION IF EXISTS public.pp_aplicacoes();
DROP FUNCTION IF EXISTS public.pp_responder(text, bigint, bigint, text, text, jsonb);
DROP FUNCTION IF EXISTS public.pp_publica(text);
DROP FUNCTION IF EXISTS public.pp_aplicacao_aberta(public."RH_PESQUISA_PERMANENCIA_APLICACAO");
DROP FUNCTION IF EXISTS public.pp_contratos_ativos(bigint, bigint);
DROP FUNCTION IF EXISTS public.pp_validar(jsonb);
DROP FUNCTION IF EXISTS public.pp_regras();
DROP FUNCTION IF EXISTS public.pp_exige(text);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- (as pp_* e o menu voltam reaplicando a mig 20261028001200 por inteiro)
-- DELETE FROM public."CS_FORM_ACESSOS" WHERE papel IN ('assistente_ia', 'rotatividade');
-- DELETE FROM public."CS_FORM_ACESSOS" WHERE formulario_id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb';
-- DELETE FROM public."CS_FORM_RESPOSTAS" WHERE formulario_id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb';
-- DELETE FROM public."CS_FORMULARIOS" WHERE id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb';
-- DROP FUNCTION IF EXISTS public.cs_form_planos(uuid);
-- DROP FUNCTION IF EXISTS public.cs_form_plano_vincular(uuid, uuid, bigint, bigint, text, text, text, text, text);
-- DROP TABLE IF EXISTS public."CS_FORM_PLANO_ORIGEM";
-- DROP FUNCTION IF EXISTS public.cs_form_rotatividade(integer);
-- DROP TRIGGER IF EXISTS trg_cs_form_resposta_a_tipos ON public."CS_FORM_RESPOSTAS";
-- DROP FUNCTION IF EXISTS public.cs_form_resposta_tipos();
-- DROP FUNCTION IF EXISTS public.cs_form_valida_escolha(jsonb, jsonb, text);
-- DROP FUNCTION IF EXISTS public.cs_form_locais_trabalho_publico(uuid);
-- DROP FUNCTION IF EXISTS public.cs_form_locais_trabalho(bigint, bigint);
-- ALTER TABLE public."CS_FORMULARIOS" DROP COLUMN IF EXISTS sempre_anonimo;
-- NOTIFY pgrst, 'reload schema';
