-- =========================================================================
-- PORTAL DO COLABORADOR (/colaborador) — login por CPF, sem conta no ERP
--
-- PEDIDO (21/09/2026, Pablo): "um painel completo do colaborador, o login e
-- senha vão ser o CPF dele. A rota vai ser /colaborador. Lá ele vê somente o
-- perfil dele, a gestão de ponto, seu salário atual, cursos/treinamentos."
--
-- QUEM ENTRA
--   Qualquer pessoa de EMPREGADOS que não esteja desligada. São ~2.400
--   colaboradores de campo (vigilantes, porteiros, limpeza…), a imensa
--   maioria SEM conta no ERP — e não vai ter: o ERP é por usuário, liberado
--   tela a tela pelo administrador. O portal é outra porta.
--
-- POR QUE NÃO É UMA CONTA DO SUPABASE AUTH
--   Uma sessão do Auth entra no banco como `authenticated`, e este banco tem
--   dezenas de tabelas com policy `TO authenticated USING (true)` (JUR_*,
--   SISTEMA_CONFERENCIA_PONTO, SISTEMA_SOLICITACOES_FERIAS…). Dar 2.400
--   contas com senha = CPF a esse papel escancararia tudo isso pela REST.
--   Foi a mesma conta que o modo externo (sessão anônima) pagou e a razão
--   de ele ter sido aposentado. Aqui a sessão é PRÓPRIA — token opaco em
--   "COL_PORTAL_SESSAO" — e o navegador nunca fala com o PostgREST: fala
--   com a Edge Function `colaborador-portal` (verify_jwt = false), que
--   roda com service_role e chama SÓ as RPCs `col_*` abaixo, cada uma
--   recebendo o `empregado_id` que a sessão resolveu. As RPCs têm EXECUTE
--   revogado de anon e authenticated: nem com a chave anon no F12 dá para
--   chamá-las. Mesmo desenho do Canal de Ética (denuncia_consultar).
--
-- SENHA
--   Nasce igual ao CPF (o pedido). Como CPF é dado semi-público, o portal
--   deixa a pessoa trocar por uma senha própria ("COL_PORTAL_CREDENCIAL",
--   bcrypt) — enquanto não trocar, CPF/CPF continua entrando. Cinco erros em
--   15 minutos travam o CPF por 15 minutos ("COL_PORTAL_TENTATIVA").
--
-- O QUE O PORTAL MOSTRA (tudo só da própria pessoa)
--   • Perfil: ficha de EMPREGADOS sem os campos de terceiros.
--   • Salário: "Valor Salário" e os campos ao redor (tipo, data, adicional,
--     dependentes IR, dados bancários mascarados). Não existe holerite no
--     ERP — a folha é do Senior; o que se mostra é o salário CADASTRADO.
--   • Ponto: não há batida individual em lugar nenhum do ERP (a Conferência
--     de Ponto é por CONTRATO/mês). O portal passa a REGISTRAR: entrada,
--     saída p/ intervalo, retorno e saída, com hora do servidor e GPS
--     opcional, em "COL_PONTO_REGISTRO". Mostra a escala da ficha, o
--     espelho do mês, as horas extras (HORA_EXTRA_SOLICITACAO, p/ quem tem
--     conta) e o andamento do fechamento do contrato no mês.
--   • Treinamentos: a "área do aluno" que a 20260930000190 deixou para a
--     fase 2. O aluno é achado em TRN_ALUNO por empregado_id, CPF
--     (documento) ou e-mail; assiste, conclui aula, responde quiz, comenta
--     e o certificado sai sozinho ao concluir 100% (quando o curso tem
--     modelo).
--   • Histórico: férias, trocas de função e advertências dele.
--
-- Depende da 20260930000190 (tabelas TRN_*). Idempotente. ROLLBACK no fim.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── 1) Tabelas ───────────────────────────────────────────────────────────

-- 1.1 Senha própria (opcional). Sem linha aqui, a senha é o CPF.
CREATE TABLE IF NOT EXISTS public."COL_PORTAL_CREDENCIAL" (
  empregado_id  bigint PRIMARY KEY,
  senha_hash    text NOT NULL,
  alterada_em   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 1.2 Sessão do portal. Guarda o HASH do token: vazar a tabela não vaza
-- sessão nenhuma.
CREATE TABLE IF NOT EXISTS public."COL_PORTAL_SESSAO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empregado_id   bigint NOT NULL,
  token_hash     text NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  ultimo_uso_em  timestamptz,
  revogada_em    timestamptz,
  user_agent     text,
  ip             text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_col_portal_sessao_token ON public."COL_PORTAL_SESSAO"(token_hash);
CREATE INDEX IF NOT EXISTS idx_col_portal_sessao_emp ON public."COL_PORTAL_SESSAO"(empregado_id, criado_em DESC);

-- 1.3 Tentativas de login (rate limit por CPF).
CREATE TABLE IF NOT EXISTS public."COL_PORTAL_TENTATIVA" (
  id         bigserial PRIMARY KEY,
  cpf        text NOT NULL,
  ok         boolean NOT NULL,
  ip         text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_col_portal_tentativa_cpf ON public."COL_PORTAL_TENTATIVA"(cpf, criado_em DESC);

-- 1.4 Registro de ponto pelo portal. Uma batida por tipo por dia.
CREATE TABLE IF NOT EXISTS public."COL_PONTO_REGISTRO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empregado_id   bigint NOT NULL,
  -- Dia em America/Sao_Paulo (a batida de 23h50 não pode cair no dia seguinte).
  data           date NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('entrada','saida_intervalo','retorno_intervalo','saida')),
  registrado_em  timestamptz NOT NULL DEFAULT now(),
  latitude       double precision,
  longitude      double precision,
  precisao_m     double precision,
  observacao     text CHECK (observacao IS NULL OR char_length(observacao) <= 300),
  origem         text NOT NULL DEFAULT 'portal',
  UNIQUE (empregado_id, data, tipo)
);
CREATE INDEX IF NOT EXISTS idx_col_ponto_registro_emp_data ON public."COL_PONTO_REGISTRO"(empregado_id, data DESC);

-- ── 2) RLS: nada disso é lido pelo navegador ─────────────────────────────
-- A Edge Function roda com service_role (passa por cima da RLS). Para
-- anon/authenticated não existe policy nenhuma — as tabelas são invisíveis.
-- A única exceção é o ponto, que o RH enxerga pela tela de Colaboradores.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['COL_PORTAL_CREDENCIAL','COL_PORTAL_SESSAO','COL_PORTAL_TENTATIVA','COL_PONTO_REGISTRO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

GRANT SELECT ON public."COL_PONTO_REGISTRO" TO authenticated;
DROP POLICY IF EXISTS col_ponto_registro_select_rh ON public."COL_PONTO_REGISTRO";
CREATE POLICY col_ponto_registro_select_rh ON public."COL_PONTO_REGISTRO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_colaboradores', 'visualizar'::public.app_acao));

-- ── 3) Helpers ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.col_digitos(_v text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(_v, ''), '\D', '', 'g');
$$;

-- "Valor Salário" é texto: vem '1518.00' do sync do Senior e '1.518,00' de
-- planilha importada. Devolve NULL para o que não é número.
CREATE OR REPLACE FUNCTION public.col_num(_v text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE s text := btrim(coalesce(_v, ''));
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  s := regexp_replace(s, '[R$\s]', '', 'g');
  IF s ~ ',' THEN s := replace(replace(s, '.', ''), ',', '.'); END IF;
  IF s !~ '^-?\d+(\.\d+)?$' THEN RETURN NULL; END IF;
  RETURN s::numeric;
END $$;

CREATE OR REPLACE FUNCTION public.col_hoje() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

CREATE OR REPLACE FUNCTION public.col_desligado(_situacao text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(coalesce(_situacao, '')) = ANY (ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','RESCISAO','DESLIGADO','DESLIGADA']);
$$;

-- O cadastro de um CPF. Mesma escolha da vincular_meu_empregado: quem não
-- está desligado primeiro, depois a admissão mais recente — a pessoa
-- readmitida tem várias linhas e a que vale é a atual.
CREATE OR REPLACE FUNCTION public.col_empregado_por_cpf(p_cpf text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpf text := public.col_digitos(p_cpf); v_fmt text; v_id bigint;
BEGIN
  IF length(v_cpf) <> 11 THEN RETURN NULL; END IF;
  v_fmt := substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2);
  SELECT e."ID" INTO v_id
    FROM public."EMPREGADOS" e
   WHERE e."CPF" IN (v_cpf, v_fmt)
   ORDER BY public.col_desligado(e."Situação") ASC,
            public.rh_data(e."Admissão"::text) DESC NULLS LAST,
            e."ID" DESC
   LIMIT 1;
  RETURN v_id;
END $$;

-- ── 4) Login, sessão e senha ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.col_login(p_cpf text, p_senha text, p_user_agent text DEFAULT NULL, p_ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_cpf    text := public.col_digitos(p_cpf);
  v_id     bigint;
  v_emp    record;
  v_hash   text;
  v_ok     boolean := false;
  v_token  text;
  v_exp    timestamptz;
  v_erros  int;
BEGIN
  IF length(v_cpf) <> 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe um CPF válido (11 dígitos).');
  END IF;

  SELECT count(*) INTO v_erros FROM public."COL_PORTAL_TENTATIVA"
   WHERE cpf = v_cpf AND NOT ok AND criado_em > now() - interval '15 minutes';
  IF v_erros >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  END IF;

  v_id := public.col_empregado_por_cpf(v_cpf);
  IF v_id IS NOT NULL THEN
    SELECT e."ID", e."Nome", e."Situação" INTO v_emp FROM public."EMPREGADOS" e WHERE e."ID" = v_id;
    IF public.col_desligado(v_emp."Situação") THEN
      INSERT INTO public."COL_PORTAL_TENTATIVA"(cpf, ok, ip) VALUES (v_cpf, false, p_ip);
      RETURN jsonb_build_object('ok', false, 'error', 'Seu cadastro consta como desligado. Procure o RH.');
    END IF;
    SELECT senha_hash INTO v_hash FROM public."COL_PORTAL_CREDENCIAL" WHERE empregado_id = v_id;
    IF v_hash IS NOT NULL THEN
      v_ok := v_hash = crypt(coalesce(p_senha, ''), v_hash);
    ELSE
      -- Senha inicial = CPF. Aceita com ou sem pontuação.
      v_ok := public.col_digitos(p_senha) = v_cpf AND length(public.col_digitos(p_senha)) = 11;
    END IF;
  END IF;

  INSERT INTO public."COL_PORTAL_TENTATIVA"(cpf, ok, ip) VALUES (v_cpf, v_ok, p_ip);
  IF NOT v_ok THEN
    -- Mesma mensagem para CPF inexistente e senha errada.
    RETURN jsonb_build_object('ok', false, 'error', 'CPF ou senha inválidos.');
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_exp   := now() + interval '30 days';
  INSERT INTO public."COL_PORTAL_SESSAO"(empregado_id, token_hash, expira_em, ultimo_uso_em, user_agent, ip)
  VALUES (v_id, encode(digest(v_token, 'sha256'), 'hex'), v_exp, now(), left(p_user_agent, 300), p_ip);

  RETURN jsonb_build_object(
    'ok', true, 'token', v_token, 'expira_em', v_exp,
    'nome', v_emp."Nome", 'empregado_id', v_id,
    'senha_propria', v_hash IS NOT NULL);
END $$;

-- Resolve a sessão → empregado. Renova o prazo a cada uso (30 dias corridos
-- sem entrar = cai). NULL para token inválido, vencido ou revogado.
CREATE OR REPLACE FUNCTION public.col_sessao(p_token text)
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_id uuid; v_emp bigint;
BEGIN
  IF coalesce(p_token, '') = '' THEN RETURN NULL; END IF;
  UPDATE public."COL_PORTAL_SESSAO"
     SET ultimo_uso_em = now(), expira_em = now() + interval '30 days'
   WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
     AND revogada_em IS NULL AND expira_em > now()
  RETURNING id, empregado_id INTO v_id, v_emp;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  -- Desligado depois de logar: a sessão morre na hora.
  IF EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e."ID" = v_emp AND public.col_desligado(e."Situação")) THEN
    UPDATE public."COL_PORTAL_SESSAO" SET revogada_em = now() WHERE id = v_id;
    RETURN NULL;
  END IF;
  RETURN v_emp;
END $$;

CREATE OR REPLACE FUNCTION public.col_logout(p_token text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  UPDATE public."COL_PORTAL_SESSAO" SET revogada_em = now()
   WHERE token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') AND revogada_em IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.col_alterar_senha(p_emp bigint, p_atual text, p_nova text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_hash text; v_cpf text; v_ok boolean;
BEGIN
  SELECT public.col_digitos(e."CPF") INTO v_cpf FROM public."EMPREGADOS" e WHERE e."ID" = p_emp;
  SELECT senha_hash INTO v_hash FROM public."COL_PORTAL_CREDENCIAL" WHERE empregado_id = p_emp;
  IF v_hash IS NOT NULL THEN v_ok := v_hash = crypt(coalesce(p_atual,''), v_hash);
  ELSE v_ok := public.col_digitos(p_atual) = v_cpf; END IF;
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'A senha atual não confere.'); END IF;
  IF length(coalesce(p_nova,'')) < 6 THEN RETURN jsonb_build_object('ok', false, 'error', 'A nova senha precisa ter pelo menos 6 caracteres.'); END IF;
  IF public.col_digitos(p_nova) = v_cpf THEN RETURN jsonb_build_object('ok', false, 'error', 'A nova senha não pode ser o seu CPF.'); END IF;
  INSERT INTO public."COL_PORTAL_CREDENCIAL"(empregado_id, senha_hash)
  VALUES (p_emp, crypt(p_nova, gen_salt('bf')))
  ON CONFLICT (empregado_id) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, alterada_em = now();
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── 5) Perfil e salário ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.col_perfil(p_emp bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record; r jsonb; v_cpf text;
BEGIN
  SELECT * INTO e FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_cpf := public.col_digitos(e."CPF");
  r := jsonb_build_object(
    'empregado_id',   e."ID",
    'nome',           e."Nome",
    'matricula',      nullif(btrim(e."Cadastro"::text), ''),
    'cpf',            CASE WHEN length(v_cpf) = 11
                        THEN substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2)
                        ELSE e."CPF" END,
    'nascimento',     public.rh_data(e."Nascimento"::text),
    'sexo',           e."Descrição (Sexo)",
    'estado_civil',   e."Descrição (Estado Civil)",
    'instrucao',      e."Descrição (Instrução)",
    'nacionalidade',  e."Descrição (Nacionalidade)",
    'email',          e."email",
    'pis',            e."PIS",
    'ctps',           CASE WHEN e."CTPS" IS NOT NULL THEN e."CTPS"::text || coalesce('-' || e."Dígito Carteira Trabalho", '') END,
    'cargo',          e."Título do Cargo",
    'setor',          e."Setor_ERP",
    'posto',          e."Nome do Posto",
    'local',          e."Descrição do Local",
    'filial',         e."Nome Filial",
    'empresa',        e."Nome da Empresa",
    'centro_custo',   e."Titulo C.Custo",
    'situacao',       e."Situação",
    'admissao',       public.rh_data(e."Admissão"::text),
    'data_cargo',     public.rh_data(e."Data Cargo"::text),
    'data_afastamento', public.rh_data(e."Data Afastamento"::text),
    'escala',         e."Escala",
    'escala_codigo',  e."Escala_1",
    'tipo_contrato',  coalesce(e."Descrição (T. Contrato)", e."TIPO DE CONTRATO"),
    'categoria',      e."Descrição (Cat. eSocial)",
    'lider',          e."LIDER",
    'tem_conta_erp',  e.auth_user_id IS NOT NULL,
    'senha_propria',  EXISTS (SELECT 1 FROM public."COL_PORTAL_CREDENCIAL" c WHERE c.empregado_id = e."ID")
  );
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.col_salario(p_emp bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record; v_conta text; v_pix text;
BEGIN
  SELECT * INTO e FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Conta e PIX mascarados: é a tela dele, mas um celular emprestado não
  -- precisa mostrar o número inteiro.
  v_conta := CASE WHEN e."Conta" IS NOT NULL
               THEN '•••' || right(e."Conta"::text, 3) || coalesce('-' || e."Dígito Conta", '') END;
  v_pix := CASE WHEN coalesce(e."Chave Pix", '') = '' THEN NULL
                WHEN length(e."Chave Pix") <= 6 THEN e."Chave Pix"
                ELSE left(e."Chave Pix", 3) || repeat('•', greatest(length(e."Chave Pix") - 6, 3)) || right(e."Chave Pix", 3) END;
  RETURN jsonb_build_object(
    'valor',              public.col_num(e."Valor Salário"),
    'valor_texto',        e."Valor Salário",
    'tipo',               e."Descrição (Tipo Salário)",
    'data_salario',       public.rh_data(e."Data Salário"::text),
    'motivo_alteracao',   e."Descrição (Motivo Alt. Salário)",
    'complemento',        public.col_num(e."Complemento Salário"),
    'suplementar',        public.col_num(e."Valor Suplementar"),
    'adiantamento',       e."Descrição (Adto Salário)",
    'periodo_pagto',      e."Descrição (Período Pagto)",
    'modo_pagto',         e."Descrição (Modo Pagto)",
    'recebe_13',          e."Descrição (Recebe 13° Salário)",
    'dependentes_ir',     e."Dependentes IR",
    'insalubridade_pct',  public.col_num(e."% Insalubridade"),
    'periculosidade_pct', public.col_num(e."% Periculosidade"),
    'desconta_inss',      e."Descrição (Desconta INSS)",
    'opcao_fgts',         e."Opção FGTS",
    'banco',              coalesce(e."Banco (Banco)", e."Banco"),
    'agencia',            e."Agência",
    'conta',              v_conta,
    'tipo_conta',         e."Descrição (Tipo Conta)",
    'pix_tipo',           e."Descrição (Tipo Chave Pix)",
    'pix',                v_pix,
    'cargo',              e."Título do Cargo",
    'data_cargo',         public.rh_data(e."Data Cargo"::text)
  );
END $$;

-- ── 6) Ponto ─────────────────────────────────────────────────────────────

-- Minutos trabalhados num dia a partir das quatro batidas. Sem saída,
-- conta até a última batida que houve (o card "hoje" no front mostra o
-- tempo correndo a partir dos horários).
CREATE OR REPLACE FUNCTION public.col_ponto_minutos(_ent timestamptz, _si timestamptz, _ri timestamptz, _sai timestamptz)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN _ent IS NULL THEN 0
         ELSE greatest(0, floor(extract(epoch FROM (coalesce(_sai, _ri, _si, _ent) - _ent))/60)::int
                       - CASE WHEN _si IS NOT NULL AND _ri IS NOT NULL
                              THEN floor(extract(epoch FROM (_ri - _si))/60)::int ELSE 0 END)
         END;
$$;

CREATE OR REPLACE FUNCTION public.col_ponto(p_emp bigint, p_mes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mes   text := coalesce(nullif(p_mes,''), to_char(public.col_hoje(), 'YYYY-MM'));
  v_ini   date;
  v_fim   date;
  v_hoje  date := public.col_hoje();
  e       record;
  v_dias  jsonb;
  v_hoje_j jsonb;
  v_fech  jsonb;
  v_he    jsonb;
  v_hor   jsonb;
  v_total int;
  v_ndias int;
BEGIN
  IF v_mes !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'Mês inválido.'; END IF;
  v_ini := to_date(v_mes || '-01', 'YYYY-MM-DD');
  v_fim := (v_ini + interval '1 month')::date - 1;

  SELECT * INTO e FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;

  -- Espelho do mês: um objeto por dia com batida.
  WITH b AS (
    SELECT r.data,
           max(r.registrado_em) FILTER (WHERE r.tipo = 'entrada')           AS ent,
           max(r.registrado_em) FILTER (WHERE r.tipo = 'saida_intervalo')   AS si,
           max(r.registrado_em) FILTER (WHERE r.tipo = 'retorno_intervalo') AS ri,
           max(r.registrado_em) FILTER (WHERE r.tipo = 'saida')             AS sai,
           jsonb_agg(jsonb_build_object('tipo', r.tipo, 'em', r.registrado_em,
                     'lat', r.latitude, 'lng', r.longitude, 'obs', r.observacao) ORDER BY r.registrado_em) AS regs
      FROM public."COL_PONTO_REGISTRO" r
     WHERE r.empregado_id = p_emp AND r.data BETWEEN v_ini AND v_fim
     GROUP BY r.data)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'data', b.data, 'entrada', b.ent, 'saida_intervalo', b.si, 'retorno_intervalo', b.ri, 'saida', b.sai,
           'minutos', public.col_ponto_minutos(b.ent, b.si, b.ri, b.sai),
           'incompleto', b.sai IS NULL,
           'registros', b.regs) ORDER BY b.data DESC), '[]'::jsonb),
         coalesce(sum(public.col_ponto_minutos(b.ent, b.si, b.ri, b.sai)), 0)::int,
         count(*)::int
    INTO v_dias, v_total, v_ndias
    FROM b;

  -- Hoje, com o próximo tipo a bater.
  WITH h AS (
    SELECT max(registrado_em) FILTER (WHERE tipo='entrada') ent,
           max(registrado_em) FILTER (WHERE tipo='saida_intervalo') si,
           max(registrado_em) FILTER (WHERE tipo='retorno_intervalo') ri,
           max(registrado_em) FILTER (WHERE tipo='saida') sai
      FROM public."COL_PONTO_REGISTRO" WHERE empregado_id = p_emp AND data = v_hoje)
  SELECT jsonb_build_object(
           'data', v_hoje, 'entrada', h.ent, 'saida_intervalo', h.si, 'retorno_intervalo', h.ri, 'saida', h.sai,
           'minutos', public.col_ponto_minutos(h.ent, h.si, h.ri, h.sai),
           'proximo', CASE WHEN h.ent IS NULL THEN 'entrada'
                           WHEN h.sai IS NOT NULL THEN NULL
                           WHEN h.si IS NULL THEN 'saida_intervalo'
                           WHEN h.ri IS NULL THEN 'retorno_intervalo'
                           ELSE 'saida' END,
           'pode_sair', h.ent IS NOT NULL AND h.sai IS NULL AND (h.si IS NULL OR h.ri IS NOT NULL))
    INTO v_hoje_j FROM h;

  -- Fechamento do contrato no mês (Conferência de Ponto). O contrato do
  -- colaborador é (Empresa, Filial), a mesma chave da conferência.
  SELECT jsonb_build_object('status', c.status, 'contrato', c.contrato_nome,
                            'aprovado_em', c.aprovado_em, 'confirmado_em', c.confirmado_em, 'pago_em', c.pago_em)
    INTO v_fech
    FROM public."SISTEMA_CONFERENCIA_PONTO" c
   WHERE c.mes_referencia = v_mes
     AND c.contrato_empresa = e."Empresa"
     AND btrim(e."Filial") ~ '^\d+$' AND c.contrato_filial = btrim(e."Filial")::bigint
   LIMIT 1;

  -- Horas extras do módulo (só quem tem conta no ERP aparece lá).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'numero', s.numero, 'data', s.data_he, 'tipo', s.tipo, 'status', s.status,
           'inicio', s.he_inicio_previsto, 'fim', s.he_fim_previsto,
           'previsto_min', s.total_previsto_min, 'real_min', s.total_real_min,
           'justificativa', s.justificativa) ORDER BY s.data_he DESC), '[]'::jsonb)
    INTO v_he
    FROM public."HORA_EXTRA_SOLICITACAO" s
   WHERE e.auth_user_id IS NOT NULL AND s.colaborador_id = e.auth_user_id
     AND s.data_he BETWEEN v_ini AND v_fim;

  -- A jornada da escala, quando o código bate com HORARIOS.
  SELECT jsonb_build_object('descricao', h."Descrição", 'tipo_jornada', h."Tipo Jornada", 'turno', h."Turno")
    INTO v_hor
    FROM public."HORARIOS" h
   WHERE btrim(coalesce(e."Escala_1",'')) ~ '^\d+$' AND h."Horário" = btrim(e."Escala_1")::bigint
   LIMIT 1;

  RETURN jsonb_build_object(
    'mes', v_mes, 'hoje', v_hoje_j, 'dias', v_dias,
    'total_min', v_total, 'dias_trabalhados', v_ndias,
    'escala', jsonb_build_object('nome', e."Escala", 'codigo', e."Escala_1", 'horario', v_hor),
    'fechamento', v_fech, 'horas_extras', v_he);
END $$;

CREATE OR REPLACE FUNCTION public.col_bater_ponto(p_emp bigint, p_tipo text, p_lat double precision DEFAULT NULL,
                                                  p_lng double precision DEFAULT NULL, p_precisao double precision DEFAULT NULL,
                                                  p_obs text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hoje date := public.col_hoje(); h record; v_ultima timestamptz;
BEGIN
  IF p_tipo NOT IN ('entrada','saida_intervalo','retorno_intervalo','saida') THEN
    RAISE EXCEPTION 'Tipo de batida inválido.';
  END IF;
  SELECT max(registrado_em) FILTER (WHERE tipo='entrada') ent,
         max(registrado_em) FILTER (WHERE tipo='saida_intervalo') si,
         max(registrado_em) FILTER (WHERE tipo='retorno_intervalo') ri,
         max(registrado_em) FILTER (WHERE tipo='saida') sai,
         max(registrado_em) ultima
    INTO h FROM public."COL_PONTO_REGISTRO" WHERE empregado_id = p_emp AND data = v_hoje;

  IF h.ultima IS NOT NULL AND h.ultima > now() - interval '1 minute' THEN
    RAISE EXCEPTION 'Aguarde um minuto entre uma batida e outra.';
  END IF;
  IF p_tipo = 'entrada' AND h.ent IS NOT NULL THEN RAISE EXCEPTION 'A entrada de hoje já foi registrada.'; END IF;
  IF p_tipo <> 'entrada' AND h.ent IS NULL THEN RAISE EXCEPTION 'Registre a entrada primeiro.'; END IF;
  IF h.sai IS NOT NULL THEN RAISE EXCEPTION 'A saída de hoje já foi registrada.'; END IF;
  IF p_tipo = 'saida_intervalo' AND h.si IS NOT NULL THEN RAISE EXCEPTION 'A saída para o intervalo já foi registrada.'; END IF;
  IF p_tipo = 'retorno_intervalo' AND h.si IS NULL THEN RAISE EXCEPTION 'Registre a saída para o intervalo primeiro.'; END IF;
  IF p_tipo = 'retorno_intervalo' AND h.ri IS NOT NULL THEN RAISE EXCEPTION 'O retorno do intervalo já foi registrado.'; END IF;
  IF p_tipo = 'saida' AND h.si IS NOT NULL AND h.ri IS NULL THEN RAISE EXCEPTION 'Registre o retorno do intervalo antes da saída.'; END IF;

  INSERT INTO public."COL_PONTO_REGISTRO"(empregado_id, data, tipo, latitude, longitude, precisao_m, observacao)
  VALUES (p_emp, v_hoje, p_tipo, p_lat, p_lng, p_precisao, nullif(btrim(p_obs), ''));

  RETURN public.col_ponto(p_emp, to_char(v_hoje, 'YYYY-MM'));
END $$;

-- ── 7) Histórico (férias, trocas de função, advertências) ────────────────

CREATE OR REPLACE FUNCTION public.col_historico(p_emp bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cpf text; v_fer jsonb; v_tro jsonb; v_adv jsonb;
BEGIN
  SELECT public.col_digitos(e."CPF") INTO v_cpf FROM public."EMPREGADOS" e WHERE e."ID" = p_emp;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'saida', f.data_saida, 'retorno', f.data_retorno, 'dias', f.dias_ferias,
           'vendidos', f.dias_vendidos, 'status', f.status, 'criado_em', f.criado_em,
           'motivo_reprovacao', f.motivo_reprovacao) ORDER BY f.criado_em DESC), '[]'::jsonb)
    INTO v_fer
    FROM public."SISTEMA_SOLICITACOES_FERIAS" f
   WHERE f.colaborador_id = p_emp OR (v_cpf <> '' AND public.col_digitos(f.colaborador_cpf) = v_cpf);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'cargo_atual', t.cargo_atual, 'cargo_novo', t.cargo_novo, 'posto', t.posto,
           'data_pretendida', t.data_pretendida, 'status', t.status, 'criado_em', t.criado_em) ORDER BY t.criado_em DESC), '[]'::jsonb)
    INTO v_tro
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
   WHERE t.colaborador_id = p_emp;

  -- Só o que já foi decidido: uma solicitação ainda em análise não é
  -- advertência, e o texto livre do encarregado fica de fora.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'tipo', a.tipo_advertencia, 'grau', a.grau, 'data', a.data_ocorrido,
           'status', a.status, 'resultado', a.resultado, 'criado_em', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
    INTO v_adv
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
   WHERE (a.colaborador_id = p_emp OR (v_cpf <> '' AND public.col_digitos(a.colaborador_cpf) = v_cpf))
     AND a.resultado IS NOT NULL;

  RETURN jsonb_build_object('ferias', v_fer, 'trocas_funcao', v_tro, 'advertencias', v_adv);
END $$;

-- ── 8) Treinamentos — a área do aluno ────────────────────────────────────

-- O aluno deste colaborador. Acha por empregado_id, depois por CPF no
-- `documento`, depois por e-mail — e grava o empregado_id quando achou pelos
-- outros dois, para a próxima ser direta. Primeiro acesso: pendente → ativo.
CREATE OR REPLACE FUNCTION public.col_trn_aluno(p_emp bigint)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e record; a record;
BEGIN
  SELECT x."ID", public.col_digitos(x."CPF") cpf, lower(btrim(x."email")) email INTO e
    FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF NOT FOUND AND e.cpf <> '' THEN
    SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id IS NULL AND public.col_digitos(documento) = e.cpf ORDER BY created_at LIMIT 1;
  END IF;
  IF NOT FOUND AND coalesce(e.email,'') <> '' THEN
    SELECT * INTO a FROM public."TRN_ALUNO" WHERE empregado_id IS NULL AND email = e.email ORDER BY created_at LIMIT 1;
  END IF;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  IF a.empregado_id IS NULL THEN
    UPDATE public."TRN_ALUNO" SET empregado_id = p_emp WHERE id = a.id;
  END IF;
  IF a.status = 'pendente' THEN
    UPDATE public."TRN_ALUNO" SET status = 'ativo', ultimo_acesso_em = now() WHERE id = a.id;
    INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
    VALUES (a.id, 'Primeiro acesso', 'Pelo Portal do Colaborador', 'plataforma', a.nome);
  ELSE
    UPDATE public."TRN_ALUNO" SET ultimo_acesso_em = now() WHERE id = a.id;
  END IF;
  RETURN a.id;
END $$;

-- O aluno vê os avisos/eventos "todos" e os das tags dele.
CREATE OR REPLACE FUNCTION public.col_trn_publico_ok(_publico text, _tags uuid[], _aluno uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _publico = 'todos'
      OR EXISTS (SELECT 1 FROM public."TRN_ALUNO_TAG" at WHERE at.aluno_id = _aluno AND at.tag_id = ANY (_tags));
$$;

CREATE OR REPLACE FUNCTION public.col_cursos(p_emp bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; a record; v_hoje date := public.col_hoje(); v_cursos jsonb; v_avisos jsonb; v_notif jsonb; v_ev jsonb; v_expirado boolean;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN
    RETURN jsonb_build_object('aluno', NULL, 'cursos', '[]'::jsonb, 'avisos', '[]'::jsonb, 'notificacoes', '[]'::jsonb, 'eventos', '[]'::jsonb);
  END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  v_expirado := a.expira_em IS NOT NULL AND a.expira_em < v_hoje;

  WITH meus AS (
    SELECT c.*, m.inscrito_em
      FROM public."TRN_CURSO" c
      LEFT JOIN public."TRN_MATRICULA" m ON m.curso_id = c.id AND m.aluno_id = v_aluno
     WHERE c.publicado AND (m.id IS NOT NULL OR a.acesso_completo)
  ), aulas AS (
    SELECT mo.curso_id, count(au.id) total,
           count(p.id) FILTER (WHERE p.concluida) concluidas
      FROM public."TRN_MODULO" mo
      JOIN public."TRN_AULA" au ON au.modulo_id = mo.id AND au.publicada
      LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
     GROUP BY mo.curso_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', c.nome, 'descricao', c.descricao, 'capa_path', c.capa_path, 'capa_formato', c.capa_formato,
           'categoria', cat.nome, 'carga_horaria_min', c.carga_horaria_min, 'em_breve', c.em_breve,
           'inscrito_em', c.inscrito_em,
           'aulas', coalesce(au.total, 0), 'concluidas', coalesce(au.concluidas, 0),
           'pct', CASE WHEN coalesce(au.total,0) = 0 THEN 0 ELSE round(100.0 * coalesce(au.concluidas,0) / au.total) END,
           'certificado', ce.codigo_validacao,
           'libera_em', greatest(c.liberar_em, CASE WHEN c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.liberar_dias END),
           'expira_em', CASE WHEN c.prazo_acesso_dias IS NOT NULL AND c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.prazo_acesso_dias END,
           'bloqueado', a.status = 'bloqueado' OR v_expirado OR c.em_breve
                        OR coalesce(greatest(c.liberar_em, CASE WHEN c.inscrito_em IS NOT NULL THEN c.inscrito_em + c.liberar_dias END) > v_hoje, false)
                        OR (c.prazo_acesso_dias IS NOT NULL AND c.inscrito_em IS NOT NULL AND c.inscrito_em + c.prazo_acesso_dias < v_hoje)
         ) ORDER BY coalesce(c.ordem_vitrine, 9999), c.nome), '[]'::jsonb)
    INTO v_cursos
    FROM meus c
    LEFT JOIN public."TRN_CATEGORIA" cat ON cat.id = c.categoria_id
    LEFT JOIN aulas au ON au.curso_id = c.id
    LEFT JOIN public."TRN_CERTIFICADO" ce ON ce.curso_id = c.id AND ce.aluno_id = v_aluno;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'titulo', v.titulo, 'url', v.url, 'tipo', v.tipo_conteudo, 'mensagem', v.mensagem,
           'imagem_path', v.imagem_path, 'video_url', v.video_url, 'criado_em', v.created_at) ORDER BY v.created_at DESC), '[]'::jsonb)
    INTO v_avisos
    FROM public."TRN_AVISO" v
   WHERE v.publicado AND (v.inicio_em IS NULL OR v.inicio_em <= v_hoje) AND (v.fim_em IS NULL OR v.fim_em >= v_hoje)
     AND public.col_trn_publico_ok(v.publico, ARRAY(SELECT tag_id FROM public."TRN_AVISO_TAG" WHERE aviso_id = v.id), v_aluno);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'titulo', x.titulo, 'mensagem', x.mensagem, 'url', x.url,
           'enviada_em', x.enviada_em, 'lida', x.lida_em IS NOT NULL) ORDER BY x.enviada_em DESC), '[]'::jsonb)
    INTO v_notif
    FROM (SELECT n.id, n.titulo, n.mensagem, n.url, n.enviada_em, na.lida_em
            FROM public."TRN_NOTIFICACAO_ALUNO" na
            JOIN public."TRN_NOTIFICACAO" n ON n.id = na.notificacao_id
           WHERE na.aluno_id = v_aluno
           ORDER BY n.enviada_em DESC LIMIT 30) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', ev.id, 'titulo', ev.titulo, 'descricao', ev.descricao, 'inicio_em', ev.inicio_em, 'fim_em', ev.fim_em,
           'dia_inteiro', ev.dia_inteiro, 'local', ev.local, 'url', ev.url, 'cor', ev.cor) ORDER BY ev.inicio_em), '[]'::jsonb)
    INTO v_ev
    FROM public."TRN_EVENTO" ev
   WHERE ev.inicio_em >= v_hoje::timestamptz - interval '1 day' AND ev.inicio_em < v_hoje::timestamptz + interval '60 days'
     AND public.col_trn_publico_ok(ev.publico, ARRAY(SELECT tag_id FROM public."TRN_EVENTO_TAG" WHERE evento_id = ev.id), v_aluno);

  RETURN jsonb_build_object(
    'aluno', jsonb_build_object('id', a.id, 'nome', a.nome, 'status', a.status, 'expira_em', a.expira_em,
                                'acesso_completo', a.acesso_completo, 'expirado', v_expirado),
    'cursos', v_cursos, 'avisos', v_avisos, 'notificacoes', v_notif, 'eventos', v_ev);
END $$;

-- Confere se o aluno pode abrir este curso (matrícula/acesso completo,
-- liberação, prazo, status). Levanta exceção com a razão.
CREATE OR REPLACE FUNCTION public.col_trn_exige_curso(p_aluno uuid, p_curso uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; c record; v_insc date; v_hoje date := public.col_hoje(); v_lib date;
BEGIN
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = p_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso AND publicado;
  IF NOT FOUND THEN RAISE EXCEPTION 'Curso não encontrado.'; END IF;
  IF a.status = 'bloqueado' THEN RAISE EXCEPTION 'Seu acesso aos treinamentos está bloqueado. Procure o RH.'; END IF;
  IF a.expira_em IS NOT NULL AND a.expira_em < v_hoje THEN RAISE EXCEPTION 'Seu acesso aos treinamentos expirou em %.', to_char(a.expira_em, 'DD/MM/YYYY'); END IF;
  SELECT inscrito_em INTO v_insc FROM public."TRN_MATRICULA" WHERE aluno_id = p_aluno AND curso_id = p_curso;
  IF v_insc IS NULL AND NOT a.acesso_completo THEN RAISE EXCEPTION 'Você não está matriculado neste curso.'; END IF;
  IF c.em_breve THEN RAISE EXCEPTION 'Este curso ainda não foi liberado.'; END IF;
  v_lib := greatest(c.liberar_em, CASE WHEN v_insc IS NOT NULL THEN v_insc + c.liberar_dias END);
  IF v_lib > v_hoje THEN RAISE EXCEPTION 'Este curso será liberado em %.', to_char(v_lib, 'DD/MM/YYYY'); END IF;
  IF c.prazo_acesso_dias IS NOT NULL AND v_insc IS NOT NULL AND v_insc + c.prazo_acesso_dias < v_hoje THEN
    RAISE EXCEPTION 'O prazo de acesso a este curso terminou em %.', to_char(v_insc + c.prazo_acesso_dias, 'DD/MM/YYYY');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.col_curso(p_emp bigint, p_curso uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; c record; v_insc date; v_hoje date := public.col_hoje(); v_mod jsonb; v_cert text; v_total int; v_conc int;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, p_curso);
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;
  SELECT inscrito_em INTO v_insc FROM public."TRN_MATRICULA" WHERE aluno_id = v_aluno AND curso_id = p_curso;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', mo.id, 'nome', mo.nome, 'posicao', mo.posicao,
           'libera_em', CASE WHEN mo.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + mo.liberar_dias END,
           'bloqueado', coalesce(mo.liberar_dias IS NOT NULL AND v_insc IS NOT NULL AND v_insc + mo.liberar_dias > v_hoje, false),
           'aulas', (
             SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', au.id, 'nome', au.nome, 'tipo_conteudo', au.tipo_conteudo, 'video_url', au.video_url,
               'video_path', au.video_path, 'thumb_path', au.thumb_path, 'descricao', au.descricao, 'posicao', au.posicao,
               'carga_horaria_min', au.carga_horaria_min, 'materiais', au.materiais, 'cta_texto', au.cta_texto, 'cta_url', au.cta_url,
               -- O quiz vai SEM a resposta certa: quem corrige é col_responder_quiz.
               'quiz', CASE WHEN au.quiz IS NULL THEN NULL ELSE (
                          SELECT jsonb_agg(jsonb_build_object('id', q->>'id', 'enunciado', q->>'enunciado', 'opcoes', q->'opcoes'))
                            FROM jsonb_array_elements(au.quiz) q) END,
               'nota_minima', au.nota_minima,
               'libera_em', greatest(au.liberar_em, CASE WHEN au.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + au.liberar_dias END),
               'bloqueado', coalesce(greatest(au.liberar_em, CASE WHEN au.liberar_dias IS NOT NULL AND v_insc IS NOT NULL THEN v_insc + au.liberar_dias END) > v_hoje, false),
               'concluida', coalesce(p.concluida, false), 'concluida_em', p.concluida_em,
               'avaliacao', p.avaliacao, 'tempo_seg', coalesce(p.tempo_seg, 0), 'nota_quiz', p.nota_quiz
             ) ORDER BY au.posicao, au.created_at), '[]'::jsonb)
               FROM public."TRN_AULA" au
               LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
              WHERE au.modulo_id = mo.id AND au.publicada)
         ) ORDER BY mo.posicao, mo.created_at), '[]'::jsonb)
    INTO v_mod
    FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;

  SELECT count(au.id), count(p.id) FILTER (WHERE p.concluida) INTO v_total, v_conc
    FROM public."TRN_MODULO" mo JOIN public."TRN_AULA" au ON au.modulo_id = mo.id AND au.publicada
    LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = v_aluno
   WHERE mo.curso_id = p_curso;
  SELECT codigo_validacao INTO v_cert FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;

  RETURN jsonb_build_object(
    'curso', jsonb_build_object('id', c.id, 'nome', c.nome, 'descricao', c.descricao, 'capa_path', c.capa_path,
                                'carga_horaria_min', c.carga_horaria_min, 'comentarios_habilitados', c.comentarios_habilitados,
                                'emite_certificado', c.certificado_modelo_id IS NOT NULL, 'inscrito_em', v_insc),
    'modulos', v_mod, 'aulas', v_total, 'concluidas', v_conc,
    'pct', CASE WHEN v_total = 0 THEN 0 ELSE round(100.0 * v_conc / v_total) END,
    'certificado', v_cert);
END $$;

-- Emite o certificado quando 100% das aulas publicadas estão concluídas e o
-- curso tem modelo. Sem checagem de menu: é o próprio aluno concluindo.
CREATE OR REPLACE FUNCTION public.col_trn_certificar(p_aluno uuid, p_curso uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_total int; v_conc int; v_modelo uuid; v_ch int; v_cod text; v_nome text;
BEGIN
  SELECT codigo_validacao INTO v_cod FROM public."TRN_CERTIFICADO" WHERE aluno_id = p_aluno AND curso_id = p_curso;
  IF v_cod IS NOT NULL THEN RETURN v_cod; END IF;
  SELECT certificado_modelo_id, carga_horaria_min, nome INTO v_modelo, v_ch, v_nome FROM public."TRN_CURSO" WHERE id = p_curso;
  IF v_modelo IS NULL THEN RETURN NULL; END IF;
  SELECT count(au.id), count(p.id) FILTER (WHERE p.concluida) INTO v_total, v_conc
    FROM public."TRN_MODULO" mo JOIN public."TRN_AULA" au ON au.modulo_id = mo.id AND au.publicada
    LEFT JOIN public."TRN_PROGRESSO" p ON p.aula_id = au.id AND p.aluno_id = p_aluno
   WHERE mo.curso_id = p_curso;
  IF v_total = 0 OR v_conc < v_total THEN RETURN NULL; END IF;
  v_cod := upper(substr(md5(gen_random_uuid()::text), 1, 15));
  INSERT INTO public."TRN_CERTIFICADO"(aluno_id, curso_id, modelo_id, codigo_validacao, carga_horaria_min, emitido_por)
  VALUES (p_aluno, p_curso, v_modelo, v_cod, v_ch, NULL);
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
  VALUES (p_aluno, 'Certificado emitido', 'Curso: ' || v_nome || ' · ' || v_cod || ' (conclusão pelo portal)', 'plataforma', 'Portal do Colaborador');
  RETURN v_cod;
END $$;

CREATE OR REPLACE FUNCTION public.col_concluir_aula(p_emp bigint, p_aula uuid, p_tempo_seg int DEFAULT 0, p_avaliacao int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_au record; v_curso uuid; v_nota int; v_cert text; v_nome text;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT au.*, mo.curso_id INTO v_au FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE au.id = p_aula AND au.publicada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  v_curso := v_au.curso_id;
  PERFORM public.col_trn_exige_curso(v_aluno, v_curso);
  IF p_avaliacao IS NOT NULL AND p_avaliacao NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Avaliação de 1 a 5.'; END IF;

  -- Aula com quiz só conclui depois de passar nele.
  IF v_au.quiz IS NOT NULL AND jsonb_array_length(v_au.quiz) > 0 THEN
    SELECT nota_quiz INTO v_nota FROM public."TRN_PROGRESSO" WHERE aluno_id = v_aluno AND aula_id = p_aula;
    IF v_nota IS NULL OR v_nota < v_au.nota_minima THEN
      RAISE EXCEPTION 'Responda o quiz da aula (nota mínima %) para concluí-la.', v_au.nota_minima || '%';
    END IF;
  END IF;

  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, concluida, concluida_em, tempo_seg, avaliacao)
  VALUES (v_aluno, p_aula, true, now(), greatest(coalesce(p_tempo_seg,0),0), p_avaliacao)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE
    SET concluida = true,
        concluida_em = coalesce(public."TRN_PROGRESSO".concluida_em, now()),
        tempo_seg = public."TRN_PROGRESSO".tempo_seg + greatest(coalesce(p_tempo_seg,0),0),
        avaliacao = coalesce(EXCLUDED.avaliacao, public."TRN_PROGRESSO".avaliacao);

  SELECT nome INTO v_nome FROM public."TRN_ALUNO" WHERE id = v_aluno;
  INSERT INTO public."TRN_ALUNO_HISTORICO"(aluno_id, acao, detalhes, origem, autor_nome)
  VALUES (v_aluno, 'Aula concluída', v_au.nome, 'plataforma', v_nome);

  v_cert := public.col_trn_certificar(v_aluno, v_curso);
  RETURN jsonb_build_object('ok', true, 'certificado', v_cert);
END $$;

-- Só acumula tempo assistido (sem concluir). Chamado a cada ~60 s de player.
CREATE OR REPLACE FUNCTION public.col_registrar_tempo(p_emp bigint, p_aula uuid, p_tempo_seg int)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL OR coalesce(p_tempo_seg,0) <= 0 OR p_tempo_seg > 3600 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."TRN_AULA" WHERE id = p_aula AND publicada) THEN RETURN; END IF;
  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, tempo_seg)
  VALUES (v_aluno, p_aula, p_tempo_seg)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE SET tempo_seg = public."TRN_PROGRESSO".tempo_seg + EXCLUDED.tempo_seg;
END $$;

-- Corrige o quiz no servidor. `p_respostas[i]` = índice da opção marcada na
-- pergunta i (0-based), NULL = em branco. Passou → conclui a aula também.
CREATE OR REPLACE FUNCTION public.col_responder_quiz(p_emp bigint, p_aula uuid, p_respostas int[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_au record; q jsonb; i int := 0; v_total int; v_acertos int := 0; v_nota int; v_corretas boolean[] := '{}'; v_ok boolean; v_cert text;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT au.*, mo.curso_id INTO v_au FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id WHERE au.id = p_aula AND au.publicada;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, v_au.curso_id);
  IF v_au.quiz IS NULL OR jsonb_array_length(v_au.quiz) = 0 THEN RAISE EXCEPTION 'Esta aula não tem quiz.'; END IF;
  v_total := jsonb_array_length(v_au.quiz);
  IF coalesce(array_length(p_respostas, 1), 0) <> v_total THEN RAISE EXCEPTION 'Responda todas as % perguntas.', v_total; END IF;

  FOR q IN SELECT * FROM jsonb_array_elements(v_au.quiz) LOOP
    i := i + 1;
    v_ok := p_respostas[i] IS NOT NULL AND (q->>'correta')::int = p_respostas[i];
    IF v_ok THEN v_acertos := v_acertos + 1; END IF;
    v_corretas := v_corretas || v_ok;
  END LOOP;
  v_nota := round(100.0 * v_acertos / v_total);

  INSERT INTO public."TRN_PROGRESSO"(aluno_id, aula_id, nota_quiz)
  VALUES (v_aluno, p_aula, v_nota)
  ON CONFLICT (aluno_id, aula_id) DO UPDATE SET nota_quiz = greatest(coalesce(public."TRN_PROGRESSO".nota_quiz, 0), EXCLUDED.nota_quiz);

  IF v_nota >= v_au.nota_minima THEN
    v_cert := (public.col_concluir_aula(p_emp, p_aula, 0, NULL))->>'certificado';
  END IF;
  RETURN jsonb_build_object('nota', v_nota, 'aprovado', v_nota >= v_au.nota_minima, 'nota_minima', v_au.nota_minima,
                            'acertos', v_acertos, 'total', v_total, 'corretas', to_jsonb(v_corretas), 'certificado', v_cert);
END $$;

CREATE OR REPLACE FUNCTION public.col_comentarios(p_emp bigint, p_aula uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  -- Aprovados de todo mundo + os meus (mesmo pendentes, para a pessoa ver que enviou).
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'texto', c.texto, 'status', c.status, 'resposta', c.resposta, 'respondido_em', c.respondido_em,
            'criado_em', c.created_at, 'autor', a.nome, 'meu', c.aluno_id = v_aluno) ORDER BY c.created_at DESC), '[]'::jsonb)
            FROM public."TRN_COMENTARIO" c JOIN public."TRN_ALUNO" a ON a.id = c.aluno_id
           WHERE c.aula_id = p_aula AND (c.status = 'aprovado' OR c.aluno_id = v_aluno));
END $$;

CREATE OR REPLACE FUNCTION public.col_comentar(p_emp bigint, p_aula uuid, p_texto text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; v_curso uuid; v_hab boolean;
BEGIN
  v_aluno := public.col_trn_aluno(p_emp);
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  IF length(btrim(coalesce(p_texto,''))) < 2 OR length(p_texto) > 1000 THEN RAISE EXCEPTION 'Escreva um comentário de até 1.000 caracteres.'; END IF;
  SELECT mo.curso_id, c.comentarios_habilitados INTO v_curso, v_hab
    FROM public."TRN_AULA" au JOIN public."TRN_MODULO" mo ON mo.id = au.modulo_id JOIN public."TRN_CURSO" c ON c.id = mo.curso_id
   WHERE au.id = p_aula;
  IF NOT FOUND THEN RAISE EXCEPTION 'Aula não encontrada.'; END IF;
  IF NOT v_hab THEN RAISE EXCEPTION 'Este curso não aceita comentários.'; END IF;
  PERFORM public.col_trn_exige_curso(v_aluno, v_curso);
  INSERT INTO public."TRN_COMENTARIO"(aula_id, aluno_id, texto) VALUES (p_aula, v_aluno, btrim(p_texto));
  RETURN public.col_comentarios(p_emp, p_aula);
END $$;

CREATE OR REPLACE FUNCTION public.col_certificado(p_emp bigint, p_curso uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_aluno uuid; ce record; a record; c record; m record; v_mod jsonb;
BEGIN
  SELECT id INTO v_aluno FROM public."TRN_ALUNO" WHERE empregado_id = p_emp ORDER BY created_at LIMIT 1;
  IF v_aluno IS NULL THEN RAISE EXCEPTION 'Você ainda não tem cadastro nos treinamentos.'; END IF;
  SELECT * INTO ce FROM public."TRN_CERTIFICADO" WHERE aluno_id = v_aluno AND curso_id = p_curso;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado ainda não emitido para este curso.'; END IF;
  SELECT * INTO a FROM public."TRN_ALUNO" WHERE id = v_aluno;
  SELECT * INTO c FROM public."TRN_CURSO" WHERE id = p_curso;
  SELECT * INTO m FROM public."TRN_CERTIFICADO_MODELO" WHERE id = ce.modelo_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', mo.nome,
           'aulas', (SELECT coalesce(jsonb_agg(au.nome ORDER BY au.posicao), '[]'::jsonb) FROM public."TRN_AULA" au WHERE au.modulo_id = mo.id AND au.publicada))
           ORDER BY mo.posicao), '[]'::jsonb)
    INTO v_mod FROM public."TRN_MODULO" mo WHERE mo.curso_id = p_curso;
  RETURN jsonb_build_object(
    'codigo', ce.codigo_validacao, 'emitido_em', ce.emitido_em, 'carga_horaria_min', ce.carga_horaria_min,
    'aluno', a.nome, 'documento', a.documento, 'curso', c.nome,
    'modelo', CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END,
    'modulos', v_mod);
END $$;

CREATE OR REPLACE FUNCTION public.col_notificacoes_lidas(p_emp bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public."TRN_NOTIFICACAO_ALUNO" na SET lida_em = now()
   WHERE na.lida_em IS NULL
     AND na.aluno_id IN (SELECT id FROM public."TRN_ALUNO" WHERE empregado_id = p_emp);
$$;

-- ── 9) Grants: só a Edge Function (service_role) chama ───────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'col_empregado_por_cpf(text)',
    'col_login(text,text,text,text)', 'col_sessao(text)', 'col_logout(text)', 'col_alterar_senha(bigint,text,text)',
    'col_perfil(bigint)', 'col_salario(bigint)',
    'col_ponto(bigint,text)', 'col_bater_ponto(bigint,text,double precision,double precision,double precision,text)',
    'col_historico(bigint)',
    'col_trn_aluno(bigint)', 'col_trn_publico_ok(text,uuid[],uuid)', 'col_cursos(bigint)', 'col_trn_exige_curso(uuid,uuid)',
    'col_curso(bigint,uuid)', 'col_trn_certificar(uuid,uuid)', 'col_concluir_aula(bigint,uuid,int,int)',
    'col_registrar_tempo(bigint,uuid,int)', 'col_responder_quiz(bigint,uuid,int[])',
    'col_comentarios(bigint,uuid)', 'col_comentar(bigint,uuid,text)', 'col_certificado(bigint,uuid)',
    'col_notificacoes_lidas(bigint)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR
--   1. Deploy da Edge Function `colaborador-portal` (verify_jwt = false,
--      já no config.toml).
--   2. Nada a liberar em Acesso por Usuário: o portal não é tela do ERP.
--      O RH enxerga as batidas do portal ("COL_PONTO_REGISTRO") por quem
--      tem `rh_colaboradores`.
-- =========================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.col_notificacoes_lidas(bigint), public.col_certificado(bigint,uuid),
--     public.col_comentar(bigint,uuid,text), public.col_comentarios(bigint,uuid),
--     public.col_responder_quiz(bigint,uuid,int[]), public.col_registrar_tempo(bigint,uuid,int),
--     public.col_concluir_aula(bigint,uuid,int,int), public.col_trn_certificar(uuid,uuid),
--     public.col_curso(bigint,uuid), public.col_trn_exige_curso(uuid,uuid), public.col_cursos(bigint),
--     public.col_trn_publico_ok(text,uuid[],uuid), public.col_trn_aluno(bigint), public.col_historico(bigint),
--     public.col_bater_ponto(bigint,text,double precision,double precision,double precision,text),
--     public.col_ponto(bigint,text), public.col_ponto_minutos(timestamptz,timestamptz,timestamptz,timestamptz),
--     public.col_salario(bigint), public.col_perfil(bigint), public.col_alterar_senha(bigint,text,text),
--     public.col_logout(text), public.col_sessao(text), public.col_login(text,text,text,text),
--     public.col_empregado_por_cpf(text), public.col_desligado(text), public.col_hoje(),
--     public.col_num(text), public.col_digitos(text);
--   DROP TABLE IF EXISTS public."COL_PONTO_REGISTRO", public."COL_PORTAL_TENTATIVA",
--     public."COL_PORTAL_SESSAO", public."COL_PORTAL_CREDENCIAL";
