-- =========================================================================
-- RH › PESQUISA DE PERMANÊNCIA (28/10/2026)
--
-- CHAMADO (RH/Operação): "Precisamos mapear nos contratos os motivos do
-- excesso de rotatividade." Esperado: "obter informações mais claras sobre
-- turnover e gerar plano de ação a partir das respostas. A ideia é que a
-- pesquisa possa selecionar o contrato e o posto de trabalho com a função."
-- Pablo: "preciso que desenvolva completo esse chamado. mesmo que precise de
-- um agente de i.a respondendo sobre".
--
-- ESPECIFICAÇÃO: documento "Pesquisa de Permanência e Ambiente de Trabalho —
-- Relatórios Detalhados" (8 perguntas; nas 1, 2 e 8 até 3 escolhas e depois a
-- MAIS importante; complemento só embaixo da alternativa escolhida; "Manter
-- as condições atuais" exclusiva; sem nome; contrato e função para análise
-- agregada; relatórios por contrato/função/motivo/prioridade/período e resumo
-- gerencial separando empresa × fiscais × estrutura do órgão).
--
-- POR QUE NÃO É UM FORMULÁRIO (CS_FORM_*): o módulo de Formulários não tem
-- "até 3 + a mais importante", complemento condicional, alternativa exclusiva
-- nem seletor de posto/função, e os relatórios precisam saber o que cada
-- alternativa significa. O questionário é fixo, com código por alternativa,
-- em supabase/functions/_shared/pesquisa-permanencia.ts — e pp_regras() aqui
-- embaixo é o MESMO catálogo (o teste src/test/pesquisa-permanencia.test.ts
-- compara os dois; mudou lá, muda aqui numa migration nova).
--
-- DE ONDE VÊM CONTRATO, POSTO E FUNÇÃO (nada digitado):
--   · contrato = filial da Senior (EMPREGADOS."Empresa" + "Filial", nome em
--     "Nome Filial") com gente ativa — o mesmo recorte do Operacional ›
--     Efetividade (mig 20261008000030);
--   · posto = RH_POSTO_TRABALHO daquela filial (Hierarquia de Postos) com vaga
--     ou ocupante, mais o posto atual de quem está lá (ajuste do ERP em
--     RH_POSTO_OCUPANTE_ERP vence o da Senior, como na Efetividade);
--   · função = "Título do Cargo" de quem está ativo no contrato.
--
-- ANONIMATO: a resposta não guarda usuário, IP, nome nem a hora — só o mês
-- sai para os relatórios. Quem responde é anônimo (página pública
-- /pesquisa-permanencia/:token, sem login, como as Campanhas do Treinamentos):
-- anon não lê nenhuma tabela, só chama pp_publica e pp_responder.
--
-- ROTATIVIDADE: pp_turnover é a conta de dir_turnover_variacao_efetivo
-- (Relatórios › Turn-over › Variação de Efetivo, mig 20261025000010) —
-- trabalhando = efetivo no fim do mês (admitido até o fim e não desligado
-- até ele; ativos e demitidos), demissões = Situação Demitido + Data
-- Afastamento no mês — só que recortada por filial × posto × função, que é o
-- recorte da pesquisa (a de lá vai por contrato do ERP).
--
-- PLANO DE AÇÃO: não há plano novo. A tela cria a ação pelo criar_plano_acao
-- de sempre (Plano de Ações, mesma permissão) e RH_PESQUISA_PERMANENCIA_PLANO
-- só guarda de qual contrato/posto/função e motivo ela nasceu.
--
-- ACESSO: menu rh_pesquisa_permanencia (RH). visualizar = relatórios e I.A;
-- alterar = abrir/encerrar aplicações e ligar plano de ação. Nenhuma
-- permissão concedida aqui — a tela nasce sem ninguém.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'rh_pesquisa_permanencia', 'Pesquisa de Permanência', '/app/rh/pesquisa-permanencia', 8, true
  FROM public.app_modulo m WHERE m.codigo = 'rh'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('rh_pesquisa_permanencia', 'visualizar'::public.app_acao),
  ('rh_pesquisa_permanencia', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
-- Uma APLICAÇÃO é uma rodada da pesquisa (o link/QR que vai para os
-- contratos). Comparar aplicações = o relatório "por período" do documento.
CREATE TABLE IF NOT EXISTS public."RH_PESQUISA_PERMANENCIA_APLICACAO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  token       text NOT NULL UNIQUE DEFAULT left(replace(gen_random_uuid()::text, '-', ''), 16),
  inicia_em   date,
  encerra_em  date,
  ativa       boolean NOT NULL DEFAULT true,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_pp_aplicacao_periodo_chk CHECK (encerra_em IS NULL OR inicia_em IS NULL OR encerra_em >= inicia_em)
);

-- Sem usuário, sem IP, sem nome: só o recorte (contrato/posto/função) e as respostas.
CREATE TABLE IF NOT EXISTS public."RH_PESQUISA_PERMANENCIA_RESPOSTA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aplicacao_id  uuid NOT NULL REFERENCES public."RH_PESQUISA_PERMANENCIA_APLICACAO"(id),
  empresa       bigint NOT NULL,
  filial        bigint NOT NULL,
  contrato      text NOT NULL,          -- "Nome Filial" na hora da resposta
  posto_codigo  text,                   -- NULL = "não sei qual é o meu posto"
  posto_nome    text,
  funcao        text NOT NULL,          -- "Título do Cargo", em maiúsculas
  respostas     jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_pp_resposta_aplicacao ON public."RH_PESQUISA_PERMANENCIA_RESPOSTA"(aplicacao_id);
CREATE INDEX IF NOT EXISTS idx_rh_pp_resposta_contrato ON public."RH_PESQUISA_PERMANENCIA_RESPOSTA"(empresa, filial);

-- Ação do Plano de Ações que nasceu da pesquisa, e de onde.
CREATE TABLE IF NOT EXISTS public."RH_PESQUISA_PERMANENCIA_PLANO" (
  plano_acao_id uuid PRIMARY KEY REFERENCES public.plano_acao(id) ON DELETE CASCADE,
  aplicacao_id  uuid REFERENCES public."RH_PESQUISA_PERMANENCIA_APLICACAO"(id) ON DELETE SET NULL,
  empresa       bigint,
  filial        bigint,
  contrato      text,
  posto_codigo  text,
  posto_nome    text,
  funcao        text,
  motivo        text,                   -- o ponto da pesquisa que originou a ação
  criado_por    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_pp_plano_contrato ON public."RH_PESQUISA_PERMANENCIA_PLANO"(empresa, filial);

-- Ninguém lê as tabelas direto: tudo passa pelas RPCs abaixo (que cobram o
-- menu). RLS ligada e sem policy = nega tudo a anon e authenticated.
ALTER TABLE public."RH_PESQUISA_PERMANENCIA_APLICACAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RH_PESQUISA_PERMANENCIA_RESPOSTA"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RH_PESQUISA_PERMANENCIA_PLANO"     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_PESQUISA_PERMANENCIA_APLICACAO", public."RH_PESQUISA_PERMANENCIA_RESPOSTA",
              public."RH_PESQUISA_PERMANENCIA_PLANO" FROM PUBLIC, anon, authenticated;

-- ── 3) Portão do menu ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_exige(p_acao text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_screen_access(auth.uid(), 'rh_pesquisa_permanencia', p_acao::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso à Pesquisa de Permanência (%).', p_acao USING ERRCODE = '42501';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.pp_exige(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_exige(text) TO authenticated;

-- ── 4) As regras do questionário (= regrasParaBanco() do _shared) ────────
-- pp-regras-inicio
CREATE OR REPLACE FUNCTION public.pp_regras()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
SELECT '{"p1":{"max":3,"opcoes":["salario","colegas","lideranca","horario_local","estabilidade","reconhecimento"],"exclusivas":[],"comp":{}},"p2":{"max":3,"opcoes":["salario_fora","lideranca","fiscais","sobrecarga","colegas","pessoais"],"exclusivas":[],"comp":{"lideranca":{"multipla":true,"opcoes":["grosseria","sem_apoio","desigual","cobranca"],"texto_max":0},"fiscais":{"multipla":true,"opcoes":["grosseria","ordens_conflitantes","fora_contrato","pressao"],"texto_max":0}}},"p3":{"max":1,"opcoes":["muito_bom","bom","regular","ruim"],"exclusivas":[],"comp":{"regular":{"multipla":true,"opcoes":["respeito","comunicacao","apoio","tarefas"],"texto_max":0},"ruim":{"multipla":true,"opcoes":["respeito","comunicacao","apoio","tarefas"],"texto_max":0}}},"p4":{"max":1,"opcoes":["positivo","nao_interferem","interferem","negativo"],"exclusivas":[],"comp":{"negativo":{"multipla":true,"opcoes":["grosseria","ordens_diferentes","fora_contrato","cobranca"],"texto_max":0}}},"p5":{"max":1,"opcoes":["boas","regulares","ruins"],"exclusivas":[],"comp":{"regulares":{"multipla":true,"opcoes":["materiais","estrutura","descanso","ambiente","excesso"],"texto_max":0},"ruins":{"multipla":true,"opcoes":["materiais","estrutura","descanso","ambiente","excesso"],"texto_max":0}}},"p6":{"max":1,"opcoes":["grupo_nascimento","outra","nao_conhece"],"exclusivas":[],"comp":{"outra":{"multipla":false,"opcoes":["salario","tratamento","condicoes","horarios"],"texto_max":80}}},"p7":{"max":1,"opcoes":["sim","sim_mas","nao"],"exclusivas":[],"comp":{"nao":{"multipla":false,"opcoes":["salario","tratamento","condicoes","sem_apoio"],"texto_max":0}}},"p8":{"max":3,"opcoes":["salario","comunicacao","liderancas","materiais","fiscais","reconhecimento","manter"],"exclusivas":["manter"],"comp":{}}}'::jsonb
$fn$;
-- pp-regras-fim
REVOKE ALL ON FUNCTION public.pp_regras() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pp_regras() TO anon, authenticated;

-- Devolve o primeiro erro (texto para a tela) ou NULL se está tudo certo.
-- Mesma regra de validarRespostas() no _shared: todas obrigatórias, máximo
-- de escolhas, a mais importante entre as marcadas, exclusiva sozinha,
-- complemento obrigatório quando a alternativa dele foi marcada (e só então).
CREATE OR REPLACE FUNCTION public.pp_validar(p_r jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $fn$
DECLARE
  v_regras jsonb := public.pp_regras();
  k text; reg jsonb; a jsonb; marc jsonb; n int; num text;
  ck text; cr jsonb; c jsonb; t text;
BEGIN
  IF p_r IS NULL OR jsonb_typeof(p_r) <> 'object' THEN RETURN 'Respostas inválidas.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_r) x WHERE NOT v_regras ? x) THEN RETURN 'Pergunta desconhecida.'; END IF;

  FOR k, reg IN SELECT * FROM jsonb_each(v_regras) ORDER BY 1 LOOP
    num := substr(k, 2);
    a := p_r -> k;
    IF a IS NULL OR jsonb_typeof(a) <> 'object' OR jsonb_typeof(a -> 'marcadas') IS DISTINCT FROM 'array' THEN
      RETURN format('Responda a pergunta %s.', num);
    END IF;
    marc := a -> 'marcadas';
    n := jsonb_array_length(marc);
    IF n = 0 THEN RETURN format('Responda a pergunta %s.', num); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(marc) v
                WHERE jsonb_typeof(v) <> 'string' OR NOT (reg -> 'opcoes') ? (v #>> '{}'))
       OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(marc) v) <> n THEN
      RETURN format('Pergunta %s: alternativa inválida.', num);
    END IF;
    IF n > (reg ->> 'max')::int THEN RETURN format('Pergunta %s: marque no máximo %s.', num, reg ->> 'max'); END IF;
    IF n > 1 AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(marc) v WHERE (reg -> 'exclusivas') ? v) THEN
      RETURN format('Pergunta %s: "Manter as condições atuais" não pode ser combinada com outras opções.', num);
    END IF;
    IF (reg ->> 'max')::int > 1
       AND NOT (jsonb_typeof(a -> 'principal') = 'string' AND marc ? (a ->> 'principal')) THEN
      RETURN format('Pergunta %s: indique a mais importante entre as que marcou.', num);
    END IF;

    -- Complemento só de alternativa marcada que tem complemento.
    IF a ? 'comp' AND jsonb_typeof(a -> 'comp') <> 'object' THEN RETURN format('Pergunta %s: complemento inválido.', num); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(a -> 'comp', '{}'::jsonb)) x
                WHERE NOT (reg -> 'comp') ? x OR NOT marc ? x) THEN
      RETURN format('Pergunta %s: complemento inválido.', num);
    END IF;
    IF a ? 'texto' AND jsonb_typeof(a -> 'texto') <> 'object' THEN RETURN format('Pergunta %s: texto inválido.', num); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(COALESCE(a -> 'texto', '{}'::jsonb)) x
                WHERE jsonb_typeof(x.value) <> 'string' OR NOT marc ? x.key
                   OR COALESCE((reg -> 'comp' -> x.key ->> 'texto_max')::int, 0) = 0) THEN
      RETURN format('Pergunta %s: texto inválido.', num);
    END IF;

    FOR ck, cr IN SELECT * FROM jsonb_each(reg -> 'comp') LOOP
      CONTINUE WHEN NOT marc ? ck;
      c := a -> 'comp' -> ck;
      IF c IS NULL OR jsonb_typeof(c) <> 'array' OR jsonb_array_length(c) = 0 THEN
        RETURN format('Pergunta %s: responda o complemento da alternativa escolhida.', num);
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(c) v
                  WHERE jsonb_typeof(v) <> 'string' OR NOT (cr -> 'opcoes') ? (v #>> '{}'))
         OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(c) v) <> jsonb_array_length(c)
         OR (NOT (cr ->> 'multipla')::boolean AND jsonb_array_length(c) > 1) THEN
        RETURN format('Pergunta %s: complemento inválido.', num);
      END IF;
      IF (cr ->> 'texto_max')::int > 0 THEN
        t := btrim(COALESCE(a -> 'texto' ->> ck, ''));
        IF t = '' THEN RETURN format('Pergunta %s: escreva o nome da empresa.', num); END IF;
        IF length(t) > (cr ->> 'texto_max')::int THEN
          RETURN format('Pergunta %s: nome da empresa com no máximo %s letras.', num, cr ->> 'texto_max');
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.pp_validar(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pp_validar(jsonb) TO anon, authenticated;

-- ── 5) Contratos, postos e funções para o seletor ────────────────────────
-- Interna (sem GRANT): pp_publica e pp_responder chamam. Filtra por um
-- contrato quando recebe empresa/filial (pp_responder confere só o dele).
CREATE OR REPLACE FUNCTION public.pp_contratos_ativos(p_empresa bigint DEFAULT NULL, p_filial bigint DEFAULT NULL)
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
  pf AS (   -- postos com gente, e as funções de quem está neles
    SELECT empresa, filial, posto, min(posto_senior) AS posto_senior,
           COALESCE(jsonb_agg(DISTINCT funcao) FILTER (WHERE funcao IS NOT NULL), '[]'::jsonb) AS funcoes
      FROM ativos WHERE posto IS NOT NULL GROUP BY empresa, filial, posto
  ),
  po AS (   -- postos da Hierarquia com vaga ou gente + postos com gente fora dela
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
REVOKE ALL ON FUNCTION public.pp_contratos_ativos(bigint, bigint) FROM PUBLIC, anon, authenticated;

-- ── 6) Página pública: abrir e responder ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_aplicacao_aberta(a public."RH_PESQUISA_PERMANENCIA_APLICACAO")
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT a.ativa AND (a.inicia_em IS NULL OR a.inicia_em <= current_date)
                 AND (a.encerra_em IS NULL OR a.encerra_em >= current_date)
$fn$;

CREATE OR REPLACE FUNCTION public.pp_publica(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a public."RH_PESQUISA_PERMANENCIA_APLICACAO";
BEGIN
  SELECT * INTO a FROM public."RH_PESQUISA_PERMANENCIA_APLICACAO" WHERE token = btrim(COALESCE(p_token, ''));
  IF NOT FOUND THEN RETURN jsonb_build_object('encontrada', false); END IF;
  IF NOT public.pp_aplicacao_aberta(a) THEN
    RETURN jsonb_build_object('encontrada', true, 'aberta', false, 'titulo', a.titulo,
                              'inicia_em', a.inicia_em, 'encerra_em', a.encerra_em);
  END IF;
  RETURN jsonb_build_object('encontrada', true, 'aberta', true, 'titulo', a.titulo,
                            'encerra_em', a.encerra_em, 'contratos', public.pp_contratos_ativos());
END $fn$;
REVOKE ALL ON FUNCTION public.pp_publica(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pp_publica(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.pp_responder(
  p_token text, p_empresa bigint, p_filial bigint, p_posto text, p_funcao text, p_respostas jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  a        public."RH_PESQUISA_PERMANENCIA_APLICACAO";
  v_ct     jsonb;
  v_posto  jsonb;
  v_funcao text := NULLIF(upper(btrim(regexp_replace(COALESCE(p_funcao, ''), '\s+', ' ', 'g'))), '');
  v_erro   text;
  v_limpo  jsonb;
BEGIN
  SELECT * INTO a FROM public."RH_PESQUISA_PERMANENCIA_APLICACAO" WHERE token = btrim(COALESCE(p_token, ''));
  IF NOT FOUND THEN RAISE EXCEPTION 'Pesquisa não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.pp_aplicacao_aberta(a) THEN RAISE EXCEPTION 'Esta pesquisa não está recebendo respostas.' USING ERRCODE = '22023'; END IF;
  IF octet_length(COALESCE(p_respostas::text, '')) > 10000 THEN RAISE EXCEPTION 'Respostas grandes demais.' USING ERRCODE = '22023'; END IF;

  v_ct := public.pp_contratos_ativos(p_empresa, p_filial) -> 0;
  IF v_ct IS NULL THEN RAISE EXCEPTION 'Escolha o contrato na lista.' USING ERRCODE = '22023'; END IF;
  IF NULLIF(btrim(COALESCE(p_posto, '')), '') IS NOT NULL THEN
    SELECT p INTO v_posto FROM jsonb_array_elements(v_ct -> 'postos') p WHERE p ->> 'codigo' = btrim(p_posto);
    IF v_posto IS NULL THEN RAISE EXCEPTION 'Escolha o posto na lista.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_funcao IS NULL OR NOT (v_ct -> 'funcoes') ? v_funcao THEN
    RAISE EXCEPTION 'Escolha a função na lista.' USING ERRCODE = '22023';
  END IF;

  v_erro := public.pp_validar(p_respostas);
  IF v_erro IS NOT NULL THEN RAISE EXCEPTION '%', v_erro USING ERRCODE = '22023'; END IF;

  -- Guarda só o que o questionário define (nada além de marcadas/principal/comp/texto).
  SELECT jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
           'marcadas', p_respostas -> k -> 'marcadas',
           'principal', CASE WHEN (r ->> 'max')::int > 1 THEN p_respostas -> k -> 'principal' END,
           'comp', NULLIF(p_respostas -> k -> 'comp', '{}'::jsonb),
           'texto', (SELECT jsonb_object_agg(t.key, btrim(t.value #>> '{}')) FROM jsonb_each(p_respostas -> k -> 'texto') t))))
    INTO v_limpo
    FROM jsonb_each(public.pp_regras()) AS x(k, r);

  INSERT INTO public."RH_PESQUISA_PERMANENCIA_RESPOSTA"
    (aplicacao_id, empresa, filial, contrato, posto_codigo, posto_nome, funcao, respostas)
  VALUES (a.id, p_empresa, p_filial, v_ct ->> 'nome', v_posto ->> 'codigo', v_posto ->> 'nome', v_funcao, v_limpo);
END $fn$;
REVOKE ALL ON FUNCTION public.pp_responder(text, bigint, bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pp_responder(text, bigint, bigint, text, text, jsonb) TO anon, authenticated;

-- ── 7) Aplicações (rodadas) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pp_aplicacoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.pp_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'titulo', a.titulo, 'token', a.token, 'inicia_em', a.inicia_em, 'encerra_em', a.encerra_em,
             'ativa', a.ativa, 'aberta', public.pp_aplicacao_aberta(a), 'created_at', a.created_at,
             'respostas', (SELECT count(*) FROM public."RH_PESQUISA_PERMANENCIA_RESPOSTA" r WHERE r.aplicacao_id = a.id))
             ORDER BY a.created_at DESC)
      FROM public."RH_PESQUISA_PERMANENCIA_APLICACAO" a), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.pp_aplicacoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_aplicacoes() TO authenticated;

-- p_id NULL = nova. Devolve o id.
CREATE OR REPLACE FUNCTION public.pp_aplicacao_salvar(
  p_id uuid, p_titulo text, p_inicia_em date, p_encerra_em date, p_ativa boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM public.pp_exige('alterar');
  IF COALESCE(btrim(p_titulo), '') = '' THEN RAISE EXCEPTION 'Dê um nome para a aplicação.' USING ERRCODE = '22023'; END IF;
  IF p_inicia_em IS NOT NULL AND p_encerra_em IS NOT NULL AND p_encerra_em < p_inicia_em THEN
    RAISE EXCEPTION 'O fim vem antes do início.' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public."RH_PESQUISA_PERMANENCIA_APLICACAO" (titulo, inicia_em, encerra_em, ativa)
    VALUES (btrim(p_titulo), p_inicia_em, p_encerra_em, COALESCE(p_ativa, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."RH_PESQUISA_PERMANENCIA_APLICACAO"
       SET titulo = btrim(p_titulo), inicia_em = p_inicia_em, encerra_em = p_encerra_em, ativa = COALESCE(p_ativa, ativa)
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Aplicação não encontrada.' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.pp_aplicacao_salvar(uuid, text, date, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_aplicacao_salvar(uuid, text, date, date, boolean) TO authenticated;

-- ── 8) Leitura para os relatórios e para a I.A ───────────────────────────
-- As respostas, sem o dia (só o mês) e sem nada de quem respondeu. Os
-- percentuais saem do _shared (indicadores/contarPergunta), que a tela, a
-- Edge Function e os testes usam igual.
CREATE OR REPLACE FUNCTION public.pp_respostas(p_aplicacao uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.pp_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'aplicacao_id', r.aplicacao_id, 'mes', to_char(r.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM'),
             'empresa', r.empresa, 'filial', r.filial, 'contrato', r.contrato,
             'posto', r.posto_codigo, 'posto_nome', r.posto_nome, 'funcao', r.funcao, 'r', r.respostas)
             ORDER BY r.empresa, r.filial, r.posto_codigo, r.funcao)
      FROM public."RH_PESQUISA_PERMANENCIA_RESPOSTA" r
     WHERE p_aplicacao IS NULL OR r.aplicacao_id = p_aplicacao), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.pp_respostas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_respostas(uuid) TO authenticated;

-- Rotatividade dos últimos p_meses (o atual incluso, até hoje), por filial ×
-- posto × função, mês a mês. Regra de dir_turnover_variacao_efetivo.
CREATE OR REPLACE FUNCTION public.pp_turnover(p_meses integer DEFAULT 12)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_n   int := LEAST(GREATEST(COALESCE(p_meses, 12), 1), 24);
  v_out jsonb;
BEGIN
  PERFORM public.pp_exige('visualizar');
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
REVOKE ALL ON FUNCTION public.pp_turnover(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_turnover(integer) TO authenticated;

-- ── 9) Plano de ação nascido da pesquisa ─────────────────────────────────
-- A ação é criada antes, pelo criar_plano_acao (permissão do Plano de Ações);
-- aqui só se registra de onde ela veio. Só quem criou a ação liga.
CREATE OR REPLACE FUNCTION public.pp_vincular_plano(
  p_plano uuid, p_aplicacao uuid, p_empresa bigint, p_filial bigint, p_contrato text,
  p_posto text, p_posto_nome text, p_funcao text, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.pp_exige('alterar');
  IF NOT EXISTS (SELECT 1 FROM public.plano_acao p WHERE p.id = p_plano AND p.criado_por = auth.uid() AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Ação não encontrada ou criada por outra pessoa.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."RH_PESQUISA_PERMANENCIA_PLANO"
    (plano_acao_id, aplicacao_id, empresa, filial, contrato, posto_codigo, posto_nome, funcao, motivo)
  VALUES (p_plano, p_aplicacao, p_empresa, p_filial, NULLIF(btrim(p_contrato), ''), NULLIF(btrim(p_posto), ''),
          NULLIF(btrim(p_posto_nome), ''), NULLIF(upper(btrim(p_funcao)), ''), left(NULLIF(btrim(p_motivo), ''), 500))
  ON CONFLICT (plano_acao_id) DO UPDATE
    SET aplicacao_id = EXCLUDED.aplicacao_id, empresa = EXCLUDED.empresa, filial = EXCLUDED.filial,
        contrato = EXCLUDED.contrato, posto_codigo = EXCLUDED.posto_codigo, posto_nome = EXCLUDED.posto_nome,
        funcao = EXCLUDED.funcao, motivo = EXCLUDED.motivo;
END $fn$;
REVOKE ALL ON FUNCTION public.pp_vincular_plano(uuid, uuid, bigint, bigint, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_vincular_plano(uuid, uuid, bigint, bigint, text, text, text, text, text) TO authenticated;

-- As ações ligadas à pesquisa que a pessoa enxerga no Plano de Ações (a
-- visibilidade da ação continua sendo a de lá).
CREATE OR REPLACE FUNCTION public.pp_planos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.pp_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'titulo', p.titulo, 'status', p.status_normalizado, 'prioridade', p.prioridade_normalizada,
             'prazo', p.data_fim_planejado, 'responsavel', p.responsavel_nome_origem, 'created_at', v.created_at,
             'aplicacao_id', v.aplicacao_id, 'empresa', v.empresa, 'filial', v.filial, 'contrato', v.contrato,
             'posto', v.posto_codigo, 'posto_nome', v.posto_nome, 'funcao', v.funcao, 'motivo', v.motivo)
             ORDER BY v.created_at DESC)
      FROM public."RH_PESQUISA_PERMANENCIA_PLANO" v
      JOIN public.plano_acao p ON p.id = v.plano_acao_id AND p.deleted_at IS NULL
     WHERE public.plano_acao_visible_by_user(auth.uid(), p.id)), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.pp_planos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_planos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.pp_planos();
-- DROP FUNCTION IF EXISTS public.pp_vincular_plano(uuid, uuid, bigint, bigint, text, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.pp_turnover(integer);
-- DROP FUNCTION IF EXISTS public.pp_respostas(uuid);
-- DROP FUNCTION IF EXISTS public.pp_aplicacao_salvar(uuid, text, date, date, boolean);
-- DROP FUNCTION IF EXISTS public.pp_aplicacoes();
-- DROP FUNCTION IF EXISTS public.pp_responder(text, bigint, bigint, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.pp_publica(text);
-- DROP FUNCTION IF EXISTS public.pp_aplicacao_aberta(public."RH_PESQUISA_PERMANENCIA_APLICACAO");
-- DROP FUNCTION IF EXISTS public.pp_contratos_ativos(bigint, bigint);
-- DROP FUNCTION IF EXISTS public.pp_validar(jsonb);
-- DROP FUNCTION IF EXISTS public.pp_regras();
-- DROP FUNCTION IF EXISTS public.pp_exige(text);
-- DROP TABLE IF EXISTS public."RH_PESQUISA_PERMANENCIA_PLANO";
-- DROP TABLE IF EXISTS public."RH_PESQUISA_PERMANENCIA_RESPOSTA";
-- DROP TABLE IF EXISTS public."RH_PESQUISA_PERMANENCIA_APLICACAO";
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'rh_pesquisa_permanencia';
-- DELETE FROM public.app_menu WHERE codigo = 'rh_pesquisa_permanencia';
-- NOTIFY pgrst, 'reload schema';
