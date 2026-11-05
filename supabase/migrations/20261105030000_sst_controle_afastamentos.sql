-- =========================================================================
-- SST › CONTROLE DE AFASTAMENTOS — acompanhamento de quem está afastado
-- (05/11/2026)
--
-- CHAMADO: "Centralizar o acompanhamento dos afastamentos, melhorar a
-- rastreabilidade, facilitar o controle de benefícios, licenças-maternidade,
-- contatos e retornos e permitir identificação rápida dos casos que exigem
-- maior atenção do SST."
--
-- NÃO É a tela Afastamentos e Telemedicina (mig 20261029001750). Aquela mede
-- cada atestado e o impacto financeiro; esta acompanha o caso até o retorno:
-- contato, Comunicação de Benefício, INSS, recursos, ASO de retorno e limbo.
--
-- O QUE ESTA MIGRATION FAZ (aditiva)
--   1. Menu sst_controle_afastamentos (visualizar + alterar), semeado de quem
--      já tem sst_afastamentos: é a mesma equipe e o mesmo tipo de dado.
--   2. SST_CTRL_AFASTAMENTO e os filhos _CONTATO, _RECURSO, _DOC e _EVENTO.
--      Escrita só pelas RPCs; leitura com menu visualizar.
--   3. Regra do ASO no banco (gatilho): com ASO necessário e não concluído, o
--      status é "Aguardando ASO de retorno", venha o UPDATE de onde vier.
--      Concluído apto → "Aguardando retorno"; inapto → "Afastado", e inapto
--      não pode ser marcado como "Retornado".
--   4. Bucket privado sst-controle-afastamentos: atestado e documento do INSS
--      são dado de saúde, nunca link público.
--   5. Captura da Senior de hora em hora: auxílio-doença, acidente, licença e
--      demais afastamentos viram caso. Atestado comum (fica na outra tela),
--      férias e aviso prévio não entram. A captura NÃO marca retorno: a Senior
--      voltar a "Trabalhando" só aparece na tela, porque retorno aqui depende
--      de ASO. Demitido encerra o caso.
--
-- Alertas, limbo e pendências são calculados em src/lib/sst/controleAfastamentos.ts,
-- com teste. Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sst_controle_afastamentos', 'Controle de Afastamentos', '/app/sst/controle-afastamentos',
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1, true
  FROM public.app_modulo m
 WHERE m.codigo = 'sst'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu x WHERE x.codigo = 'sst_controle_afastamentos');

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('sst_controle_afastamentos', 'alterar'::public.app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'sst_controle_afastamentos', pp.acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'sst_afastamentos'
   AND pp.acao IN ('visualizar', 'alterar') AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'sst_controle_afastamentos' AND x.acao = pp.acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'sst_controle_afastamentos', s.acao, true,
       'Migração 20261105030000: já cuidava de Afastamentos e Telemedicina'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'sst_afastamentos'
   AND s.acao IN ('visualizar', 'alterar') AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'sst_controle_afastamentos' AND x.acao = s.acao);

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'sst_controle_afastamentos', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_exige(_acao text DEFAULT 'visualizar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT public.sst_ctrl_afa_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) ao Controle de Afastamentos', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_exige(text) FROM PUBLIC, anon, authenticated;

-- ── 2. Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SST_CTRL_AFASTAMENTO" (
  id                     bigserial PRIMARY KEY,
  empregado_id           bigint NOT NULL,
  nome                   text NOT NULL,
  cpf                    text,
  contrato_id            uuid,
  contrato_nome          text,
  filial_nome            text,
  funcao                 text,
  motivo                 text NOT NULL,
  data_inicio            date NOT NULL,
  data_prevista_retorno  date,
  data_retorno_real      date,
  encerrado_em           date,
  status                 text NOT NULL DEFAULT 'Afastado' CHECK (status IN (
    'Afastado', 'Auxílio-doença', 'Licença-maternidade', 'Aguardando retorno',
    'Aguardando ASO de retorno', 'Retorno agendado', 'Retornado', 'Afastamento encerrado')),
  -- Último contato: repetido aqui para a tela principal; o histórico é _CONTATO.
  ultimo_contato_em      date,
  ultimo_contato_obs     text,
  retorno_informado_em   date,
  comunicacao_beneficio  text NOT NULL DEFAULT 'Aguardando'
    CHECK (comunicacao_beneficio IN ('Aguardando', 'Recebida', 'Não se aplica')),
  -- É o que dispara o alerta de possível limbo previdenciário.
  beneficio_encerrado_em date,
  aposentado_afastado    boolean NOT NULL DEFAULT false,
  aposentado_no_vinculo  boolean NOT NULL DEFAULT false,
  aposentadoria_em       date,
  aso_necessario         boolean NOT NULL DEFAULT false,
  aso_solicitado_em      date,
  aso_agendado_em        date,
  aso_clinica            text,
  aso_realizado          boolean NOT NULL DEFAULT false,
  aso_recebido_em        date,
  aso_resultado          text CHECK (aso_resultado IS NULL OR aso_resultado IN ('apto', 'inapto')),
  observacao             text,
  origem                 text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'senior')),
  senior_situacao        text,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- Encerrar um caso e a Senior seguir mostrando o afastamento não o recria.
  CONSTRAINT sst_ctrl_afa_emp_inicio_uq UNIQUE (empregado_id, data_inicio),
  CONSTRAINT sst_ctrl_afa_datas_ck CHECK (data_prevista_retorno IS NULL OR data_prevista_retorno >= data_inicio)
);
-- Um caso aberto por colaborador.
CREATE UNIQUE INDEX IF NOT EXISTS sst_ctrl_afa_um_aberto_uq ON public."SST_CTRL_AFASTAMENTO" (empregado_id)
  WHERE status NOT IN ('Retornado', 'Afastamento encerrado');
CREATE INDEX IF NOT EXISTS sst_ctrl_afa_status_idx ON public."SST_CTRL_AFASTAMENTO" (status);

CREATE TABLE IF NOT EXISTS public."SST_CTRL_AFASTAMENTO_CONTATO" (
  id                   bigserial PRIMARY KEY,
  afastamento_id       bigint NOT NULL REFERENCES public."SST_CTRL_AFASTAMENTO"(id) ON DELETE CASCADE,
  data_contato         date NOT NULL,
  observacao           text NOT NULL,
  retorno_informado_em date,
  autor_nome           text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_ctrl_afa_contato_fk_idx ON public."SST_CTRL_AFASTAMENTO_CONTATO" (afastamento_id);

CREATE TABLE IF NOT EXISTS public."SST_CTRL_AFASTAMENTO_RECURSO" (
  id             bigserial PRIMARY KEY,
  afastamento_id bigint NOT NULL REFERENCES public."SST_CTRL_AFASTAMENTO"(id) ON DELETE CASCADE,
  instancia      text NOT NULL CHECK (instancia IN ('inss', 'judicial')),
  tipo           text NOT NULL,
  situacao       text NOT NULL DEFAULT 'em_andamento' CHECK (situacao IN ('em_andamento', 'deferido', 'indeferido', 'encerrado')),
  protocolo      text,
  data_recurso   date,
  observacao     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_ctrl_afa_recurso_fk_idx ON public."SST_CTRL_AFASTAMENTO_RECURSO" (afastamento_id);

CREATE TABLE IF NOT EXISTS public."SST_CTRL_AFASTAMENTO_DOC" (
  id             bigserial PRIMARY KEY,
  afastamento_id bigint NOT NULL REFERENCES public."SST_CTRL_AFASTAMENTO"(id) ON DELETE CASCADE,
  categoria      text NOT NULL CHECK (categoria IN ('atestado', 'inss', 'comunicacao_beneficio', 'aso_retorno',
                                                    'recurso_administrativo', 'judicial', 'aposentadoria')),
  nome           text NOT NULL,
  storage_path   text NOT NULL,
  tamanho        bigint,
  tipo           text,
  enviado_por    text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_ctrl_afa_doc_fk_idx ON public."SST_CTRL_AFASTAMENTO_DOC" (afastamento_id);

CREATE TABLE IF NOT EXISTS public."SST_CTRL_AFASTAMENTO_EVENTO" (
  id             bigserial PRIMARY KEY,
  afastamento_id bigint NOT NULL REFERENCES public."SST_CTRL_AFASTAMENTO"(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  descricao      text,
  autor_nome     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sst_ctrl_afa_evento_fk_idx ON public."SST_CTRL_AFASTAMENTO_EVENTO" (afastamento_id);

-- Leitura pelo menu; sem policy de escrita: só pelas RPCs abaixo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SST_CTRL_AFASTAMENTO', 'SST_CTRL_AFASTAMENTO_CONTATO', 'SST_CTRL_AFASTAMENTO_RECURSO',
                           'SST_CTRL_AFASTAMENTO_DOC', 'SST_CTRL_AFASTAMENTO_EVENTO'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS sst_ctrl_afa_sel ON public.%I', t);
    EXECUTE format('CREATE POLICY sst_ctrl_afa_sel ON public.%I FOR SELECT TO authenticated USING ((select public.sst_ctrl_afa_pode(''visualizar'')))', t);
  END LOOP;
END $$;

-- ── 3. A regra do ASO e as datas de encerramento ─────────────────────────
CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_regras()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  v_concluido boolean;
BEGIN
  -- Quem escolhe "Aguardando ASO de retorno" está dizendo que o ASO é necessário.
  IF NEW.status = 'Aguardando ASO de retorno' AND NOT NEW.aso_necessario THEN
    NEW.aso_necessario := true;
  END IF;
  v_concluido := NEW.aso_realizado AND NEW.aso_resultado IS NOT NULL;

  IF NEW.aso_resultado = 'inapto' AND NEW.status = 'Retornado' THEN
    RAISE EXCEPTION 'ASO de retorno inapto: o colaborador não pode ser marcado como retornado.';
  END IF;

  IF NEW.status <> 'Afastamento encerrado' THEN
    IF NEW.aso_necessario AND NOT v_concluido THEN
      NEW.status := 'Aguardando ASO de retorno';
    ELSIF NEW.aso_necessario AND NEW.status = 'Aguardando ASO de retorno' THEN
      NEW.status := CASE WHEN NEW.aso_resultado = 'apto' THEN 'Aguardando retorno' ELSE 'Afastado' END;
    END IF;
  END IF;

  IF NEW.status = 'Retornado' THEN
    NEW.data_retorno_real := COALESCE(NEW.data_retorno_real, current_date);
  END IF;
  NEW.encerrado_em := CASE WHEN NEW.status = 'Afastamento encerrado'
                           THEN COALESCE(NEW.encerrado_em, current_date) END;
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_regras() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sst_ctrl_afa_regras ON public."SST_CTRL_AFASTAMENTO";
CREATE TRIGGER trg_sst_ctrl_afa_regras
  BEFORE INSERT OR UPDATE ON public."SST_CTRL_AFASTAMENTO"
  FOR EACH ROW EXECUTE FUNCTION public.sst_ctrl_afa_regras();

-- ── 4. Documentos: bucket privado ────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sst-controle-afastamentos', 'sst-controle-afastamentos', false, 26214400) -- 25 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "sst ctrl afa select" ON storage.objects;
CREATE POLICY "sst ctrl afa select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_ctrl_afa_pode('visualizar')));
DROP POLICY IF EXISTS "sst ctrl afa insert" ON storage.objects;
CREATE POLICY "sst ctrl afa insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_ctrl_afa_pode('alterar')));
DROP POLICY IF EXISTS "sst ctrl afa delete" ON storage.objects;
CREATE POLICY "sst ctrl afa delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sst-controle-afastamentos' AND (select public.sst_ctrl_afa_pode('alterar')));

-- ── 5. RPCs ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_evento(p_id bigint, p_tipo text, p_desc text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public."SST_CTRL_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
  VALUES (p_id, p_tipo, p_desc, public.sst_afa_nome_usuario())
$$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_evento(bigint, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_colaboradores(p_busca text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE t text := btrim(COALESCE(p_busca, ''));
BEGIN
  PERFORM public.sst_ctrl_afa_exige('visualizar');
  IF length(t) < 3 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'nome') FROM (
      SELECT jsonb_build_object('id', e."ID", 'nome', btrim(e."Nome"), 'situacao', e."Situação",
                                'filial', e."Nome Filial", 'cargo', e."Título do Cargo") AS x
        FROM public."EMPREGADOS" e
       WHERE (e."Nome" ILIKE '%' || t || '%'
              OR (length(regexp_replace(t, '\D', '', 'g')) = 11
                  AND regexp_replace(COALESCE(e."CPF", ''), '\D', '', 'g') = regexp_replace(t, '\D', '', 'g')))
       ORDER BY (e."Situação" = 'Trabalhando'), e."Nome"
       LIMIT 20) s), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_colaboradores(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_colaboradores(text) TO authenticated;

-- Cria (p sem id) ou altera um caso. Só os campos desta lista são gravados.
CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  a      public."SST_CTRL_AFASTAMENTO"%ROWTYPE;
  n      public."SST_CTRL_AFASTAMENTO"%ROWTYPE;
  e      public."EMPREGADOS"%ROWTYPE;
  l      jsonb;
  v_ini  date := nullif(p->>'data_inicio', '')::date;
  v_mud  text[] := '{}';
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');

  IF v_id IS NULL THEN
    SELECT * INTO e FROM public."EMPREGADOS" WHERE "ID" = nullif(p->>'empregado_id', '')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escolha o colaborador na lista.'; END IF;
    IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe a data de início.'; END IF;
    IF length(btrim(COALESCE(p->>'motivo', ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo do afastamento.'; END IF;
    IF EXISTS (SELECT 1 FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.empregado_id = e."ID"
                AND x.status NOT IN ('Retornado', 'Afastamento encerrado')) THEN
      RAISE EXCEPTION '% já tem um afastamento aberto neste controle.', btrim(e."Nome");
    END IF;
    IF EXISTS (SELECT 1 FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.empregado_id = e."ID" AND x.data_inicio = v_ini) THEN
      RAISE EXCEPTION 'Já existe um afastamento de % com início nessa data.', btrim(e."Nome");
    END IF;
    l := public.sst_afa_lotacao_calc(e."ID", v_ini);
    INSERT INTO public."SST_CTRL_AFASTAMENTO" (empregado_id, nome, cpf, contrato_id, contrato_nome, filial_nome, funcao,
      motivo, data_inicio, data_prevista_retorno, status, comunicacao_beneficio, observacao, senior_situacao, created_by)
    VALUES (e."ID", btrim(e."Nome"), e."CPF", (l->>'contrato_id')::uuid, l->>'contrato_nome', e."Nome Filial",
      COALESCE(l->>'cargo', nullif(btrim(e."Título do Cargo"), '')), btrim(p->>'motivo'), v_ini,
      nullif(p->>'data_prevista_retorno', '')::date, COALESCE(nullif(p->>'status', ''), 'Afastado'),
      COALESCE(nullif(p->>'comunicacao_beneficio', ''), 'Aguardando'), nullif(btrim(p->>'observacao'), ''),
      e."Situação", auth.uid())
    RETURNING id INTO v_id;
    PERFORM public.sst_ctrl_afa_evento(v_id, 'criado', 'Afastamento registrado.');
    RETURN v_id;
  END IF;

  SELECT * INTO a FROM public."SST_CTRL_AFASTAMENTO" WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Afastamento não encontrado.'; END IF;
  IF length(btrim(COALESCE(p->>'motivo', ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo do afastamento.'; END IF;
  IF v_ini IS NULL THEN RAISE EXCEPTION 'Informe a data de início.'; END IF;

  UPDATE public."SST_CTRL_AFASTAMENTO" SET
    motivo = btrim(p->>'motivo'),
    data_inicio = v_ini,
    data_prevista_retorno = nullif(p->>'data_prevista_retorno', '')::date,
    data_retorno_real = nullif(p->>'data_retorno_real', '')::date,
    status = COALESCE(nullif(p->>'status', ''), status),
    comunicacao_beneficio = COALESCE(nullif(p->>'comunicacao_beneficio', ''), comunicacao_beneficio),
    beneficio_encerrado_em = nullif(p->>'beneficio_encerrado_em', '')::date,
    aposentado_afastado = COALESCE((p->>'aposentado_afastado')::boolean, false),
    aposentado_no_vinculo = COALESCE((p->>'aposentado_no_vinculo')::boolean, false),
    aposentadoria_em = nullif(p->>'aposentadoria_em', '')::date,
    aso_necessario = COALESCE((p->>'aso_necessario')::boolean, false),
    aso_solicitado_em = nullif(p->>'aso_solicitado_em', '')::date,
    aso_agendado_em = nullif(p->>'aso_agendado_em', '')::date,
    aso_clinica = nullif(btrim(p->>'aso_clinica'), ''),
    aso_realizado = COALESCE((p->>'aso_realizado')::boolean, false),
    aso_recebido_em = nullif(p->>'aso_recebido_em', '')::date,
    aso_resultado = nullif(p->>'aso_resultado', ''),
    observacao = nullif(btrim(p->>'observacao'), '')
  WHERE id = v_id
  RETURNING * INTO n;

  IF n.status IS DISTINCT FROM a.status THEN v_mud := v_mud || ('Status: ' || a.status || ' → ' || n.status); END IF;
  IF n.data_prevista_retorno IS DISTINCT FROM a.data_prevista_retorno THEN
    v_mud := v_mud || ('Previsão de retorno: ' || COALESCE(to_char(a.data_prevista_retorno, 'DD/MM/YYYY'), '—') || ' → ' || COALESCE(to_char(n.data_prevista_retorno, 'DD/MM/YYYY'), '—'));
  END IF;
  IF n.comunicacao_beneficio IS DISTINCT FROM a.comunicacao_beneficio THEN
    v_mud := v_mud || ('Comunicação de Benefício: ' || a.comunicacao_beneficio || ' → ' || n.comunicacao_beneficio);
  END IF;
  IF n.beneficio_encerrado_em IS DISTINCT FROM a.beneficio_encerrado_em THEN
    v_mud := v_mud || ('Benefício encerrado em: ' || COALESCE(to_char(n.beneficio_encerrado_em, 'DD/MM/YYYY'), '—'));
  END IF;
  IF n.aso_resultado IS DISTINCT FROM a.aso_resultado OR n.aso_realizado IS DISTINCT FROM a.aso_realizado THEN
    v_mud := v_mud || ('ASO de retorno: ' || CASE WHEN n.aso_realizado THEN 'realizado' ELSE 'não realizado' END || COALESCE(' (' || n.aso_resultado || ')', ''));
  END IF;
  IF cardinality(v_mud) > 0 THEN
    PERFORM public.sst_ctrl_afa_evento(v_id, 'alterado', array_to_string(v_mud, '; ') || '.');
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_contato_salvar(p_id bigint, p_data date, p_obs text, p_retorno date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_obs text := btrim(COALESCE(p_obs, ''));
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data do contato.'; END IF;
  IF p_data > current_date THEN RAISE EXCEPTION 'A data do contato não pode ser futura.'; END IF;
  IF length(v_obs) = 0 THEN RAISE EXCEPTION 'Escreva a observação do contato.'; END IF;
  PERFORM 1 FROM public."SST_CTRL_AFASTAMENTO" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Afastamento não encontrado.'; END IF;

  INSERT INTO public."SST_CTRL_AFASTAMENTO_CONTATO" (afastamento_id, data_contato, observacao, retorno_informado_em, autor_nome)
  VALUES (p_id, p_data, v_obs, p_retorno, public.sst_afa_nome_usuario());

  -- A tela principal mostra o contato MAIS RECENTE, mesmo lançando um antigo depois.
  UPDATE public."SST_CTRL_AFASTAMENTO" a SET
    ultimo_contato_em = c.data_contato, ultimo_contato_obs = c.observacao,
    retorno_informado_em = COALESCE(c.retorno_informado_em, a.retorno_informado_em)
    FROM (SELECT data_contato, observacao, retorno_informado_em FROM public."SST_CTRL_AFASTAMENTO_CONTATO"
           WHERE afastamento_id = p_id ORDER BY data_contato DESC, id DESC LIMIT 1) c
   WHERE a.id = p_id;
  PERFORM public.sst_ctrl_afa_evento(p_id, 'contato', 'Contato de ' || to_char(p_data, 'DD/MM/YYYY') || ' registrado.');
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_contato_salvar(bigint, date, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_contato_salvar(bigint, date, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_recurso_salvar(p jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_afa  bigint := nullif(p->>'afastamento_id', '')::bigint;
  v_tipo text := btrim(COALESCE(p->>'tipo', ''));
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');
  IF length(v_tipo) = 0 THEN RAISE EXCEPTION 'Informe o tipo do recurso.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."SST_CTRL_AFASTAMENTO_RECURSO" (afastamento_id, instancia, tipo, situacao, protocolo, data_recurso, observacao)
    VALUES (v_afa, p->>'instancia', v_tipo, COALESCE(nullif(p->>'situacao', ''), 'em_andamento'),
            nullif(btrim(p->>'protocolo'), ''), nullif(p->>'data_recurso', '')::date, nullif(btrim(p->>'observacao'), ''))
    RETURNING id INTO v_id;
    PERFORM public.sst_ctrl_afa_evento(v_afa, 'recurso', 'Recurso ' || CASE p->>'instancia' WHEN 'inss' THEN 'ao INSS' ELSE 'judicial' END || ' registrado: ' || v_tipo || '.');
  ELSE
    UPDATE public."SST_CTRL_AFASTAMENTO_RECURSO" SET
      tipo = v_tipo, situacao = COALESCE(nullif(p->>'situacao', ''), situacao),
      protocolo = nullif(btrim(p->>'protocolo'), ''), data_recurso = nullif(p->>'data_recurso', '')::date,
      observacao = nullif(btrim(p->>'observacao'), ''), updated_at = now()
    WHERE id = v_id RETURNING afastamento_id INTO v_afa;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recurso não encontrado.'; END IF;
    PERFORM public.sst_ctrl_afa_evento(v_afa, 'recurso', 'Recurso alterado: ' || v_tipo || ' (' || replace(COALESCE(p->>'situacao', ''), '_', ' ') || ').');
  END IF;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_recurso_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_recurso_salvar(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_recurso_remover(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r public."SST_CTRL_AFASTAMENTO_RECURSO"%ROWTYPE;
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');
  DELETE FROM public."SST_CTRL_AFASTAMENTO_RECURSO" WHERE id = p_id RETURNING * INTO r;
  IF FOUND THEN PERFORM public.sst_ctrl_afa_evento(r.afastamento_id, 'recurso', 'Recurso removido: ' || r.tipo || '.'); END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_recurso_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_recurso_remover(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_doc_registrar(p_id bigint, p_categoria text, p_nome text, p_path text, p_tamanho bigint, p_tipo text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id bigint;
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');
  -- O caminho tem que estar na pasta deste afastamento.
  IF COALESCE(p_path, '') NOT LIKE p_id::text || '/%' THEN
    RAISE EXCEPTION 'Arquivo fora da pasta do afastamento #%.', p_id;
  END IF;
  INSERT INTO public."SST_CTRL_AFASTAMENTO_DOC" (afastamento_id, categoria, nome, storage_path, tamanho, tipo, enviado_por)
  VALUES (p_id, p_categoria, p_nome, p_path, p_tamanho, p_tipo, public.sst_afa_nome_usuario())
  RETURNING id INTO v_id;
  PERFORM public.sst_ctrl_afa_evento(p_id, 'documento', 'Documento anexado: ' || p_nome || '.');
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_doc_registrar(bigint, text, text, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_doc_registrar(bigint, text, text, text, bigint, text) TO authenticated;

-- Devolve o caminho: a tela apaga o arquivo do bucket depois que o registro saiu.
CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_doc_remover(p_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE d public."SST_CTRL_AFASTAMENTO_DOC"%ROWTYPE;
BEGIN
  PERFORM public.sst_ctrl_afa_exige('alterar');
  DELETE FROM public."SST_CTRL_AFASTAMENTO_DOC" WHERE id = p_id RETURNING * INTO d;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.sst_ctrl_afa_evento(d.afastamento_id, 'documento', 'Documento removido: ' || d.nome || '.');
  RETURN d.storage_path;
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_doc_remover(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_doc_remover(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_lista()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.sst_ctrl_afa_exige('visualizar');
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(a) - 'cpf' - 'created_by'
      || jsonb_build_object(
        'recursos', COALESCE((SELECT jsonb_agg(jsonb_build_object('instancia', r.instancia, 'situacao', r.situacao))
                                FROM public."SST_CTRL_AFASTAMENTO_RECURSO" r WHERE r.afastamento_id = a.id), '[]'::jsonb),
        'doc_categorias', COALESCE((SELECT jsonb_agg(DISTINCT d.categoria)
                                FROM public."SST_CTRL_AFASTAMENTO_DOC" d WHERE d.afastamento_id = a.id), '[]'::jsonb)))
      FROM public."SST_CTRL_AFASTAMENTO" a), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_ficha(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE a public."SST_CTRL_AFASTAMENTO"%ROWTYPE;
BEGIN
  PERFORM public.sst_ctrl_afa_exige('visualizar');
  SELECT * INTO a FROM public."SST_CTRL_AFASTAMENTO" WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(a) - 'cpf' - 'created_by' || jsonb_build_object(
    'recursos', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id DESC) FROM public."SST_CTRL_AFASTAMENTO_RECURSO" r WHERE r.afastamento_id = p_id), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id DESC) FROM public."SST_CTRL_AFASTAMENTO_DOC" d WHERE d.afastamento_id = p_id), '[]'::jsonb),
    'contatos', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.data_contato DESC, c.id DESC) FROM public."SST_CTRL_AFASTAMENTO_CONTATO" c WHERE c.afastamento_id = p_id), '[]'::jsonb),
    'eventos', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id DESC) FROM public."SST_CTRL_AFASTAMENTO_EVENTO" e WHERE e.afastamento_id = p_id), '[]'::jsonb),
    'doc_categorias', COALESCE((SELECT jsonb_agg(DISTINCT d.categoria) FROM public."SST_CTRL_AFASTAMENTO_DOC" d WHERE d.afastamento_id = p_id), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_ficha(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_ficha(bigint) TO authenticated;

-- ── 6. Captura da Senior ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sst_ctrl_afa_capturar_senior()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r       record;
  l       jsonb;
  v_id    bigint;
  v_novos int := 0;
  v_enc   int := 0;
  v_status text;
  v_motivo text;
BEGIN
  -- Do botão, exige alterar; do pg_cron (sem usuário), roda.
  IF auth.uid() IS NOT NULL THEN PERFORM public.sst_ctrl_afa_exige('alterar'); END IF;

  FOR r IN
    SELECT e."ID" AS emp, btrim(e."Nome") AS nome, e."CPF" AS cpf, e."Nome Filial" AS filial, e."Título do Cargo" AS cargo,
           e."Situação" AS sit, public.sst_afa_tipo_da_situacao(e."Situação") AS tipo,
           public.rh_data(e."Data Afastamento"::text) AS ini
      FROM public."EMPREGADOS" e
     WHERE public.sst_afa_tipo_da_situacao(e."Situação") IN ('auxilio_doenca', 'acidente_trabalho', 'licenca', 'afastamento')
       AND public.rh_data(e."Data Afastamento"::text) IS NOT NULL
       AND public.rh_data(e."Data Afastamento"::text) <= current_date
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public."SST_CTRL_AFASTAMENTO" x WHERE x.empregado_id = r.emp
                           AND (x.data_inicio = r.ini OR x.status NOT IN ('Retornado', 'Afastamento encerrado')));
    v_status := CASE WHEN r.tipo = 'auxilio_doenca' THEN 'Auxílio-doença'
                     WHEN r.sit ~* 'MATERN' THEN 'Licença-maternidade' ELSE 'Afastado' END;
    v_motivo := CASE WHEN r.tipo = 'auxilio_doenca' THEN 'Auxílio-doença'
                     WHEN r.tipo = 'acidente_trabalho' THEN 'Acidente de trabalho'
                     WHEN r.sit ~* 'MATERN' THEN 'Licença-maternidade' ELSE btrim(r.sit) END;
    l := public.sst_afa_lotacao_calc(r.emp, r.ini);
    INSERT INTO public."SST_CTRL_AFASTAMENTO" (empregado_id, nome, cpf, contrato_id, contrato_nome, filial_nome, funcao,
      motivo, data_inicio, status, origem, senior_situacao)
    VALUES (r.emp, r.nome, r.cpf, (l->>'contrato_id')::uuid, l->>'contrato_nome', r.filial, nullif(btrim(r.cargo), ''),
      v_motivo, r.ini, v_status, 'senior', r.sit)
    RETURNING id INTO v_id;
    INSERT INTO public."SST_CTRL_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
    VALUES (v_id, 'criado', 'Trazido da Senior (situação "' || r.sit || '").', 'Sistema');
    v_novos := v_novos + 1;
  END LOOP;

  -- Casos abertos: acompanha a situação da Senior. Demitido encerra; voltar a
  -- Trabalhando só registra e aparece na tela (retorno aqui depende de ASO).
  FOR r IN
    SELECT a.id, a.senior_situacao AS antes, e."Situação" AS sit
      FROM public."SST_CTRL_AFASTAMENTO" a
      JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
     WHERE a.status NOT IN ('Retornado', 'Afastamento encerrado')
       AND e."Situação" IS DISTINCT FROM a.senior_situacao
  LOOP
    IF public.sst_afa_tipo_da_situacao(r.sit) = 'desligamento' THEN
      UPDATE public."SST_CTRL_AFASTAMENTO" SET senior_situacao = r.sit, status = 'Afastamento encerrado' WHERE id = r.id;
      v_enc := v_enc + 1;
    ELSE
      UPDATE public."SST_CTRL_AFASTAMENTO" SET senior_situacao = r.sit WHERE id = r.id;
    END IF;
    INSERT INTO public."SST_CTRL_AFASTAMENTO_EVENTO" (afastamento_id, tipo, descricao, autor_nome)
    VALUES (r.id, 'senior', 'Situação na Senior: ' || COALESCE(r.antes, '—') || ' → ' || COALESCE(r.sit, '—') || '.', 'Sistema');
  END LOOP;

  RETURN jsonb_build_object('novos', v_novos, 'encerrados', v_enc);
END $fn$;
REVOKE ALL ON FUNCTION public.sst_ctrl_afa_capturar_senior() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sst_ctrl_afa_capturar_senior() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sst-controle-afastamentos-senior') THEN
      PERFORM cron.unschedule('sst-controle-afastamentos-senior');
    END IF;
    -- Depois do sync da Senior (5,20,35,50) e da captura da outra tela (25).
    PERFORM cron.schedule('sst-controle-afastamentos-senior', '27 * * * *', 'SELECT public.sst_ctrl_afa_capturar_senior()');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('sst-controle-afastamentos-senior');
-- DROP FUNCTION IF EXISTS public.sst_ctrl_afa_capturar_senior(), public.sst_ctrl_afa_ficha(bigint),
--   public.sst_ctrl_afa_lista(), public.sst_ctrl_afa_doc_remover(bigint),
--   public.sst_ctrl_afa_doc_registrar(bigint, text, text, text, bigint, text),
--   public.sst_ctrl_afa_recurso_remover(bigint), public.sst_ctrl_afa_recurso_salvar(jsonb),
--   public.sst_ctrl_afa_contato_salvar(bigint, date, text, date), public.sst_ctrl_afa_salvar(jsonb),
--   public.sst_ctrl_afa_colaboradores(text), public.sst_ctrl_afa_evento(bigint, text, text);
-- DROP POLICY IF EXISTS "sst ctrl afa select" ON storage.objects;
-- DROP POLICY IF EXISTS "sst ctrl afa insert" ON storage.objects;
-- DROP POLICY IF EXISTS "sst ctrl afa delete" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'sst-controle-afastamentos';   -- só vazio
-- DROP TABLE IF EXISTS public."SST_CTRL_AFASTAMENTO_EVENTO", public."SST_CTRL_AFASTAMENTO_DOC",
--   public."SST_CTRL_AFASTAMENTO_RECURSO", public."SST_CTRL_AFASTAMENTO_CONTATO", public."SST_CTRL_AFASTAMENTO";
-- DROP FUNCTION IF EXISTS public.sst_ctrl_afa_regras(), public.sst_ctrl_afa_exige(text), public.sst_ctrl_afa_pode(text);
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'sst_controle_afastamentos';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sst_controle_afastamentos';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sst_controle_afastamentos';
-- DELETE FROM public.app_menu      WHERE codigo      = 'sst_controle_afastamentos';
-- NOTIFY pgrst, 'reload schema';
