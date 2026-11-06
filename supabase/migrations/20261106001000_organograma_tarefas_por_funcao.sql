-- =========================================================================
-- ORGANOGRAMA › TAREFAS POR FUNÇÃO (SIS-2026-0771, 05/11/2026)
--
-- CHAMADO: "Vincular a árvore do Organograma à Estrutura de Processos, gerando
-- tarefas automáticas por perfil de usuário (Login) com controle de prazos
-- (Vencidas / A Vencer)". A Estrutura de Processos e os POPs eram módulos
-- estáticos, sem ligação com cargo nem login.
--
-- O CRUZAMENTO
--   TAREFA_FUNCAO_MODELO   a atividade do POP: título, periodicidade, prazo,
--                          setor, ligação opcional com ORG_PROC_PROCESSO.
--   TAREFA_FUNCAO_ALVO     para quem vale: um CARGO (título do cadastro ou função
--                          escrita no organograma) ou uma PESSOA da árvore.
--   ORGANOGRAMA_NO         quem é quem: o nó liga pessoa, cargo e login.
--   TAREFA_FUNCAO_INSTANCIA o checklist de cada login em cada período. Nunca é
--                          copiado à mão: nasce de tarefa_gerar_dia.
--
-- AS DATAS (tarefa_periodo). A tarefa aparece no começo do período e vence:
--   diária ....... no próprio dia, de segunda a sexta;
--   semanal ...... no dia da semana escolhido (padrão sexta);
--   quinzenal .... no dia 15 e no último dia do mês;
--   mensal ....... no dia escolhido (padrão último dia).
-- Vencimento em fim de semana recua para a sexta. Feriado NÃO é considerado.
--
-- AS REGRAS DE QUEM RECEBE
--   · só quem tem login e está "Trabalhando": férias e afastamento não acumulam
--     tarefa nova. O que já estava pendente continua lá;
--   · nunca nasce já vencida: tarefa cadastrada dia 20 com prazo dia 5 começa no
--     mês seguinte;
--   · saiu da empresa, trocou de cargo ou a tarefa foi desativada: as pendentes
--     viram 'cancelada', para não cobrar o que não é mais da pessoa;
--   · cargo sem ninguém com login não gera nada, e a tela mostra isso.
--
-- GERAÇÃO: pg_cron às 06:05 de Brasília e, como garantia, a primeira leitura do
-- dia (tarefa_garantir_hoje). Dias perdidos são recuperados, até 7.
--
-- ACESSO
--   organograma_tarefas: visualizar = acompanhar todos; alterar = cadastrar.
--   Nasce só para o Pablo, como o organograma_gestao.
--   Cada um vê as próprias tarefas em /app/minhas-tarefas, sem menu; líder vê
--   quem está abaixo dele na árvore (mesma regra do histórico do organograma).
--
-- Escrita só pelas RPCs. Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'organograma_tarefas', 'Tarefas por Função', '/app/organograma/tarefas', 16, true
  FROM public.app_modulo m WHERE m.codigo = 'organograma'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'organograma_tarefas', a::public.app_acao FROM unnest(ARRAY['visualizar', 'alterar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT p.id, 'organograma_tarefas', a.acao::public.app_acao, true, NULL, 'Tarefas por Função: primeiro acesso, libera para os demais'
  FROM public.profiles p
 CROSS JOIN (VALUES ('visualizar'), ('alterar')) AS a(acao)
 WHERE p.ativo AND upper(btrim(p.display_name)) = 'PABLO FLORES SANTAREM'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.tarefa_pode(_acao text DEFAULT 'visualizar')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'organograma_tarefas', _acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.tarefa_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_pode(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.tarefa_exige(_acao text DEFAULT 'alterar')
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.tarefa_pode(_acao) THEN
    RAISE EXCEPTION 'Sem acesso (%) a Tarefas por Função.', _acao USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.tarefa_exige(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tarefa_hoje()
RETURNS date LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date
$$;
GRANT EXECUTE ON FUNCTION public.tarefa_hoje() TO authenticated;

-- ── 2) Tabelas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."TAREFA_FUNCAO_MODELO" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL,
  descricao       text,
  area            text,
  setor           text,
  processo_id     uuid REFERENCES public."ORG_PROC_PROCESSO"(id) ON DELETE SET NULL,
  periodicidade   text NOT NULL CHECK (periodicidade IN ('diaria', 'semanal', 'quinzenal', 'mensal')),
  dia_semana      smallint CHECK (dia_semana BETWEEN 1 AND 5),   -- 1 = segunda … 5 = sexta
  dia_mes         smallint CHECK (dia_mes BETWEEN 1 AND 31),
  criticidade     text,
  link            text CHECK (link IS NULL OR link LIKE '/app%'),
  origem          text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'planilha', 'estrutura')),
  chave_importacao text UNIQUE,
  ativo           boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tarefa_modelo_processo_idx ON public."TAREFA_FUNCAO_MODELO" (processo_id);

CREATE TABLE IF NOT EXISTS public."TAREFA_FUNCAO_ALVO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id  uuid NOT NULL REFERENCES public."TAREFA_FUNCAO_MODELO"(id) ON DELETE CASCADE,
  cargo      text,
  cargo_norm text,
  no_id      uuid REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE CASCADE,
  CONSTRAINT tarefa_alvo_um_tipo CHECK ((cargo_norm IS NOT NULL) <> (no_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tarefa_alvo_cargo_uq ON public."TAREFA_FUNCAO_ALVO" (modelo_id, cargo_norm) WHERE cargo_norm IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tarefa_alvo_no_uq ON public."TAREFA_FUNCAO_ALVO" (modelo_id, no_id) WHERE no_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tarefa_alvo_no_idx ON public."TAREFA_FUNCAO_ALVO" (no_id);
CREATE INDEX IF NOT EXISTS tarefa_alvo_cargo_idx ON public."TAREFA_FUNCAO_ALVO" (cargo_norm);

CREATE TABLE IF NOT EXISTS public."TAREFA_FUNCAO_INSTANCIA" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id       uuid NOT NULL REFERENCES public."TAREFA_FUNCAO_MODELO"(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  no_id           uuid REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE SET NULL,
  responsavel_nome text,
  periodo_inicio  date NOT NULL,
  vencimento      date NOT NULL,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida', 'nao_aplicavel', 'cancelada')),
  observacao      text,
  concluida_em    timestamptz,
  concluida_por   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- O mesmo período não nasce duas vezes, rode a geração quantas vezes rodar.
  CONSTRAINT tarefa_instancia_uma_por_periodo UNIQUE (modelo_id, user_id, vencimento)
);
CREATE INDEX IF NOT EXISTS tarefa_instancia_minhas_idx ON public."TAREFA_FUNCAO_INSTANCIA" (user_id, status, vencimento);
CREATE INDEX IF NOT EXISTS tarefa_instancia_no_idx ON public."TAREFA_FUNCAO_INSTANCIA" (no_id);
CREATE INDEX IF NOT EXISTS tarefa_instancia_status_idx ON public."TAREFA_FUNCAO_INSTANCIA" (status, vencimento);

CREATE TABLE IF NOT EXISTS public."TAREFA_FUNCAO_GERACAO" (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  ultima_data  date NOT NULL
);

ALTER TABLE public."TAREFA_FUNCAO_MODELO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TAREFA_FUNCAO_ALVO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TAREFA_FUNCAO_INSTANCIA" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TAREFA_FUNCAO_GERACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."TAREFA_FUNCAO_MODELO", public."TAREFA_FUNCAO_ALVO", public."TAREFA_FUNCAO_INSTANCIA", public."TAREFA_FUNCAO_GERACAO" FROM anon;
GRANT SELECT ON public."TAREFA_FUNCAO_MODELO", public."TAREFA_FUNCAO_ALVO", public."TAREFA_FUNCAO_INSTANCIA" TO authenticated;

DROP POLICY IF EXISTS tarefa_modelo_sel ON public."TAREFA_FUNCAO_MODELO";
CREATE POLICY tarefa_modelo_sel ON public."TAREFA_FUNCAO_MODELO" FOR SELECT TO authenticated
  USING ((select public.tarefa_pode('visualizar')));
DROP POLICY IF EXISTS tarefa_alvo_sel ON public."TAREFA_FUNCAO_ALVO";
CREATE POLICY tarefa_alvo_sel ON public."TAREFA_FUNCAO_ALVO" FOR SELECT TO authenticated
  USING ((select public.tarefa_pode('visualizar')));
DROP POLICY IF EXISTS tarefa_instancia_sel ON public."TAREFA_FUNCAO_INSTANCIA";
CREATE POLICY tarefa_instancia_sel ON public."TAREFA_FUNCAO_INSTANCIA" FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select public.tarefa_pode('visualizar')) OR public.organograma_sou_superior(no_id));

-- ── 3) As datas ──────────────────────────────────────────────────────────
-- Fim de semana recua para a sexta; se cair antes do início do período, avança
-- para a segunda (dia 1º num sábado, por exemplo).
CREATE OR REPLACE FUNCTION public.tarefa_dia_util(_d date, _inicio date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v date := _d;
BEGIN
  WHILE extract(isodow FROM v) > 5 LOOP v := v - 1; END LOOP;
  IF v < _inicio THEN
    v := _d;
    WHILE extract(isodow FROM v) > 5 LOOP v := v + 1; END LOOP;
  END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.tarefa_periodo(_periodicidade text, _dia_semana smallint, _dia_mes smallint, _d date,
  OUT inicio date, OUT vencimento date)
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_mes date := date_trunc('month', _d)::date;
  v_ult date := (date_trunc('month', _d) + interval '1 month - 1 day')::date;
BEGIN
  IF _periodicidade = 'diaria' THEN
    IF extract(isodow FROM _d) > 5 THEN RETURN; END IF;
    inicio := _d; vencimento := _d;
  ELSIF _periodicidade = 'semanal' THEN
    inicio := date_trunc('week', _d)::date;
    vencimento := inicio + (coalesce(_dia_semana, 5) - 1);
  ELSIF _periodicidade = 'quinzenal' THEN
    IF extract(day FROM _d) <= 15 THEN
      inicio := v_mes; vencimento := public.tarefa_dia_util(v_mes + 14, v_mes);
    ELSE
      inicio := v_mes + 15; vencimento := public.tarefa_dia_util(v_ult, v_mes + 15);
    END IF;
  ELSIF _periodicidade = 'mensal' THEN
    inicio := v_mes;
    vencimento := public.tarefa_dia_util(CASE WHEN _dia_mes IS NULL THEN v_ult ELSE least(v_mes + (_dia_mes - 1), v_ult) END, v_mes);
  END IF;
END $$;

-- ── 4) Quem é quem: a árvore com cargo e login ───────────────────────────
CREATE OR REPLACE FUNCTION public.tarefa_pessoas()
RETURNS TABLE (no_id uuid, user_id uuid, nome text, cargo text, funcao text, setor text, contrato text, no_quadro boolean, trabalhando boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id,
         coalesce(o.user_id, e.auth_user_id),
         coalesce(nullif(btrim(e."Nome"::text), ''), nullif(btrim(p.display_name), ''), p.email, 'Pessoa'),
         coalesce(nullif(btrim(e."Título do Cargo"::text), ''), nullif(btrim(p.cargo), '')),
         nullif(btrim(o.funcao), ''),
         coalesce(nullif(btrim(e."Setor_ERP"::text), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = o.user_id)),
         CASE WHEN e."Filial" IS NOT NULL THEN public.organograma_contrato_rotulo(e."Filial"::bigint, e."Nome Filial"::text) END,
         CASE WHEN e."ID" IS NOT NULL THEN public.organograma_ativo(e."Situação"::text) ELSE coalesce(p.ativo, false) END,
         CASE WHEN e."ID" IS NOT NULL THEN btrim(coalesce(e."Situação"::text, '')) = 'Trabalhando' ELSE coalesce(p.ativo, false) END
    FROM public."ORGANOGRAMA_NO" o
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
    LEFT JOIN public.profiles p ON p.id = o.user_id
$$;
REVOKE ALL ON FUNCTION public.tarefa_pessoas() FROM PUBLIC, anon, authenticated;

-- Para quem cada tarefa vale hoje (uma linha por tarefa e pessoa da árvore).
CREATE OR REPLACE FUNCTION public.tarefa_destinos(_modelo uuid DEFAULT NULL)
RETURNS TABLE (modelo_id uuid, no_id uuid, user_id uuid, nome text, no_quadro boolean, trabalhando boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT a.modelo_id, p.no_id, p.user_id, p.nome, p.no_quadro, p.trabalhando
    FROM public."TAREFA_FUNCAO_ALVO" a
    JOIN public.tarefa_pessoas() p
      ON a.no_id = p.no_id
      OR a.cargo_norm = public.rh_norm_nome(p.cargo)
      OR a.cargo_norm = public.rh_norm_nome(p.funcao)
   WHERE _modelo IS NULL OR a.modelo_id = _modelo
$$;
REVOKE ALL ON FUNCTION public.tarefa_destinos(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5) Geração ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tarefa_gerar_dia(_d date, _modelo uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  INSERT INTO public."TAREFA_FUNCAO_INSTANCIA" (modelo_id, user_id, no_id, responsavel_nome, periodo_inicio, vencimento)
  SELECT m.id, d.user_id, d.no_id, d.nome, per.inicio, per.vencimento
    FROM public."TAREFA_FUNCAO_MODELO" m
    JOIN public.tarefa_destinos(_modelo) d ON d.modelo_id = m.id
   CROSS JOIN LATERAL public.tarefa_periodo(m.periodicidade, m.dia_semana, m.dia_mes, _d) per
   WHERE m.ativo
     AND d.user_id IS NOT NULL AND d.trabalhando
     AND per.vencimento IS NOT NULL
     -- Nunca nasce já vencida.
     AND per.vencimento >= _d
  ON CONFLICT (modelo_id, user_id, vencimento) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_gerar_dia(date, uuid) FROM PUBLIC, anon, authenticated;

-- Pendente de quem não tem mais a tarefa: não cobra. Férias não entra aqui
-- (no_quadro continua verdadeiro): a pendência espera a pessoa voltar.
CREATE OR REPLACE FUNCTION public.tarefa_cancelar_sem_destino()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_n integer;
BEGIN
  UPDATE public."TAREFA_FUNCAO_INSTANCIA" i
     SET status = 'cancelada', observacao = 'Cancelada: a tarefa não é mais desta pessoa, ou foi desativada.'
   WHERE i.status = 'pendente'
     AND NOT EXISTS (
       SELECT 1 FROM public.tarefa_destinos() d
         JOIN public."TAREFA_FUNCAO_MODELO" m ON m.id = d.modelo_id AND m.ativo
        WHERE d.modelo_id = i.modelo_id AND d.user_id = i.user_id AND d.no_quadro);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_cancelar_sem_destino() FROM PUBLIC, anon, authenticated;

-- Do último dia gerado até hoje, no máximo 7 dias para trás. O pg_cron chama;
-- a primeira leitura do dia também, caso o job não tenha rodado.
CREATE OR REPLACE FUNCTION public.tarefa_garantir_hoje()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_hoje date := public.tarefa_hoje();
  v_ult date;
  v_d date;
  v_n integer := 0;
BEGIN
  SELECT g.ultima_data INTO v_ult FROM public."TAREFA_FUNCAO_GERACAO" g;
  IF v_ult >= v_hoje THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('tarefa_garantir_hoje'));
  SELECT g.ultima_data INTO v_ult FROM public."TAREFA_FUNCAO_GERACAO" g;
  IF v_ult >= v_hoje THEN RETURN 0; END IF;
  v_d := greatest(coalesce(v_ult + 1, v_hoje), v_hoje - 7);
  WHILE v_d <= v_hoje LOOP
    v_n := v_n + public.tarefa_gerar_dia(v_d);
    v_d := v_d + 1;
  END LOOP;
  PERFORM public.tarefa_cancelar_sem_destino();
  INSERT INTO public."TAREFA_FUNCAO_GERACAO" (id, ultima_data) VALUES (true, v_hoje)
  ON CONFLICT (id) DO UPDATE SET ultima_data = EXCLUDED.ultima_data;
  RETURN v_n;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_garantir_hoje() FROM PUBLIC, anon, authenticated;

-- ── 6) Minhas tarefas ────────────────────────────────────────────────────
-- Pendentes (qualquer data que já começou, e as próximas) + concluídas recentes.
CREATE OR REPLACE FUNCTION public.tarefa_json(i public."TAREFA_FUNCAO_INSTANCIA", m public."TAREFA_FUNCAO_MODELO")
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'modelo_id', m.id, 'titulo', m.titulo, 'descricao', m.descricao, 'setor', m.setor, 'area', m.area,
    'periodicidade', m.periodicidade, 'criticidade', m.criticidade, 'link', m.link,
    'processo', (SELECT p.nome FROM public."ORG_PROC_PROCESSO" p WHERE p.id = m.processo_id),
    'periodo_inicio', i.periodo_inicio, 'vencimento', i.vencimento, 'status', i.status,
    'observacao', i.observacao, 'concluida_em', i.concluida_em, 'responsavel_nome', i.responsavel_nome, 'no_id', i.no_id)
$$;
REVOKE ALL ON FUNCTION public.tarefa_json(public."TAREFA_FUNCAO_INSTANCIA", public."TAREFA_FUNCAO_MODELO") FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tarefa_minhas()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_hoje date := public.tarefa_hoje();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501'; END IF;
  PERFORM public.tarefa_garantir_hoje();
  RETURN jsonb_build_object('hoje', v_hoje, 'itens', coalesce((
    SELECT jsonb_agg(public.tarefa_json(i, m) ORDER BY i.vencimento, m.titulo)
      FROM public."TAREFA_FUNCAO_INSTANCIA" i
      JOIN public."TAREFA_FUNCAO_MODELO" m ON m.id = i.modelo_id
     WHERE i.user_id = auth.uid()
       AND (i.status = 'pendente' OR (i.status IN ('concluida', 'nao_aplicavel') AND i.vencimento >= v_hoje - 30))), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_minhas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_minhas() TO authenticated;

-- Quem resolve: o dono ou quem tem 'alterar'. Líder acompanha, não marca pelo liderado.
CREATE OR REPLACE FUNCTION public.tarefa_resolver(p_id uuid, p_status text, p_obs text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TAREFA_FUNCAO_INSTANCIA"%ROWTYPE;
  v_obs text := nullif(btrim(coalesce(p_obs, '')), '');
BEGIN
  IF p_status NOT IN ('concluida', 'nao_aplicavel', 'pendente') THEN RAISE EXCEPTION 'Situação inválida.'; END IF;
  SELECT * INTO i FROM public."TAREFA_FUNCAO_INSTANCIA" WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;
  IF i.user_id IS DISTINCT FROM auth.uid() AND NOT public.tarefa_pode('alterar') THEN
    RAISE EXCEPTION 'Só a própria pessoa ou quem gerencia as tarefas pode alterar esta tarefa.' USING ERRCODE = '42501';
  END IF;
  IF i.status = 'cancelada' THEN RAISE EXCEPTION 'Esta tarefa foi cancelada.'; END IF;
  IF p_status = 'nao_aplicavel' AND length(coalesce(v_obs, '')) < 5 THEN
    RAISE EXCEPTION 'Explique por que a tarefa não se aplica (mín. 5 caracteres).';
  END IF;
  UPDATE public."TAREFA_FUNCAO_INSTANCIA" SET
    status = p_status,
    observacao = CASE WHEN p_status = 'pendente' THEN NULL ELSE v_obs END,
    concluida_em = CASE WHEN p_status = 'pendente' THEN NULL ELSE now() END,
    concluida_por = CASE WHEN p_status = 'pendente' THEN NULL ELSE auth.uid() END
  WHERE id = p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_resolver(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_resolver(uuid, text, text) TO authenticated;

-- ── 7) Acompanhamento ────────────────────────────────────────────────────
-- Com o menu: todos. Sem o menu: quem está abaixo de mim na árvore. Sem ninguém: vazio.
CREATE OR REPLACE FUNCTION public.tarefa_acompanhamento(p_ini date DEFAULT NULL, p_fim date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_hoje date := public.tarefa_hoje();
  v_ini date := coalesce(p_ini, date_trunc('month', public.tarefa_hoje())::date);
  v_fim date := coalesce(p_fim, public.tarefa_hoje() + 30);
  v_todos boolean := public.tarefa_pode('visualizar');
  v_eu uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501'; END IF;
  PERFORM public.tarefa_garantir_hoje();
  SELECT o.id INTO v_eu FROM public."ORGANOGRAMA_NO" o WHERE o.user_id = auth.uid();
  RETURN (
    WITH RECURSIVE equipe AS (
      SELECT o.id, 1 AS nivel FROM public."ORGANOGRAMA_NO" o WHERE o.parent_id = v_eu AND NOT v_todos
      UNION ALL
      SELECT o.id, e.nivel + 1 FROM public."ORGANOGRAMA_NO" o JOIN equipe e ON o.parent_id = e.id WHERE e.nivel < 50
    ),
    visiveis AS (
      SELECT i.*, m.titulo, m.periodicidade, m.setor AS m_setor
        FROM public."TAREFA_FUNCAO_INSTANCIA" i
        JOIN public."TAREFA_FUNCAO_MODELO" m ON m.id = i.modelo_id
       WHERE i.status <> 'cancelada'
         AND (i.periodo_inicio <= v_hoje)
         AND ((i.vencimento BETWEEN v_ini AND v_fim) OR (i.status = 'pendente' AND i.vencimento < v_ini))
         AND (v_todos OR i.no_id IN (SELECT id FROM equipe))
    )
    SELECT jsonb_build_object('hoje', v_hoje, 've_todos', v_todos, 'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'no_id', v.no_id, 'user_id', v.user_id, 'responsavel_nome', v.responsavel_nome, 'titulo', v.titulo,
          'periodicidade', v.periodicidade, 'setor', v.m_setor, 'vencimento', v.vencimento, 'status', v.status,
          'concluida_em', v.concluida_em, 'observacao', v.observacao)
          ORDER BY v.responsavel_nome, v.vencimento)
        FROM visiveis v), '[]'::jsonb)));
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_acompanhamento(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_acompanhamento(date, date) TO authenticated;

-- ── 8) Cadastro ──────────────────────────────────────────────────────────
-- Cargos do organograma, com quantos têm login: é o que evita cadastrar tarefa
-- para um cargo que não vai gerar nada.
CREATE OR REPLACE FUNCTION public.tarefa_cargos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.tarefa_exige('visualizar');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('cargo', c.cargo, 'pessoas', c.pessoas, 'com_login', c.com_login) ORDER BY c.cargo)
      FROM (
        SELECT min(x.txt) AS cargo, count(DISTINCT x.no_id) AS pessoas,
               count(DISTINCT x.no_id) FILTER (WHERE x.user_id IS NOT NULL) AS com_login
          FROM (
            SELECT p.no_id, p.user_id, p.cargo AS txt FROM public.tarefa_pessoas() p WHERE p.no_quadro AND p.cargo IS NOT NULL
            UNION
            SELECT p.no_id, p.user_id, p.funcao FROM public.tarefa_pessoas() p WHERE p.no_quadro AND p.funcao IS NOT NULL
          ) x
         GROUP BY public.rh_norm_nome(x.txt)) c), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_cargos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_cargos() TO authenticated;

CREATE OR REPLACE FUNCTION public.tarefa_modelos()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  PERFORM public.tarefa_exige('visualizar');
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(m) - 'chave_importacao' - 'created_by' || jsonb_build_object(
      'processo', (SELECT p.nome FROM public."ORG_PROC_PROCESSO" p WHERE p.id = m.processo_id),
      'cargos', coalesce((SELECT jsonb_agg(a.cargo ORDER BY a.cargo) FROM public."TAREFA_FUNCAO_ALVO" a WHERE a.modelo_id = m.id AND a.cargo IS NOT NULL), '[]'::jsonb),
      'pessoas', coalesce((SELECT jsonb_agg(public.organograma_nome_no(a.no_id)) FROM public."TAREFA_FUNCAO_ALVO" a WHERE a.modelo_id = m.id AND a.no_id IS NOT NULL), '[]'::jsonb),
      'com_login', (SELECT count(DISTINCT d.user_id) FROM public.tarefa_destinos(m.id) d WHERE d.no_quadro AND d.user_id IS NOT NULL),
      'sem_login', (SELECT count(DISTINCT d.no_id) FROM public.tarefa_destinos(m.id) d WHERE d.no_quadro AND d.user_id IS NULL))
      ORDER BY m.ativo DESC, m.setor NULLS LAST, m.titulo)
      FROM public."TAREFA_FUNCAO_MODELO" m), '[]'::jsonb);
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_modelos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_modelos() TO authenticated;

-- Interna: grava a tarefa e os cargos. Devolve o id.
CREATE OR REPLACE FUNCTION public.tarefa_modelo_gravar(p jsonb, p_origem text, p_chave text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_titulo text := btrim(coalesce(p->>'titulo', ''));
  v_per text := p->>'periodicidade';
  v_link text := nullif(btrim(coalesce(p->>'link', '')), '');
  v_cargo text;
BEGIN
  IF length(v_titulo) < 3 THEN RAISE EXCEPTION 'Informe o título da tarefa.'; END IF;
  IF v_per IS NULL OR v_per NOT IN ('diaria', 'semanal', 'quinzenal', 'mensal') THEN RAISE EXCEPTION 'Escolha a periodicidade.'; END IF;
  IF v_link IS NOT NULL AND v_link NOT LIKE '/app%' THEN RAISE EXCEPTION 'O link precisa ser uma tela do ERP (começa com /app).'; END IF;

  IF v_id IS NULL AND p_chave IS NOT NULL THEN
    SELECT id INTO v_id FROM public."TAREFA_FUNCAO_MODELO" WHERE chave_importacao = p_chave;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."TAREFA_FUNCAO_MODELO" (titulo, periodicidade, origem, chave_importacao, created_by)
    VALUES (v_titulo, v_per, p_origem, p_chave, auth.uid()) RETURNING id INTO v_id;
  END IF;
  UPDATE public."TAREFA_FUNCAO_MODELO" SET
    titulo = v_titulo, descricao = nullif(btrim(coalesce(p->>'descricao', '')), ''),
    area = nullif(btrim(coalesce(p->>'area', '')), ''), setor = nullif(btrim(coalesce(p->>'setor', '')), ''),
    processo_id = nullif(p->>'processo_id', '')::uuid, periodicidade = v_per,
    dia_semana = CASE WHEN v_per = 'semanal' THEN nullif(p->>'dia_semana', '')::smallint END,
    dia_mes = CASE WHEN v_per = 'mensal' THEN nullif(p->>'dia_mes', '')::smallint END,
    criticidade = nullif(btrim(coalesce(p->>'criticidade', '')), ''), link = v_link,
    ativo = coalesce((p->>'ativo')::boolean, true), updated_at = now()
  WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada.'; END IF;

  -- Os cargos são substituídos; pessoa ligada pela Estrutura fica.
  DELETE FROM public."TAREFA_FUNCAO_ALVO" WHERE modelo_id = v_id AND cargo_norm IS NOT NULL;
  FOR v_cargo IN SELECT btrim(x) FROM jsonb_array_elements_text(coalesce(p->'cargos', '[]'::jsonb)) x WHERE btrim(x) <> '' LOOP
    INSERT INTO public."TAREFA_FUNCAO_ALVO" (modelo_id, cargo, cargo_norm) VALUES (v_id, v_cargo, public.rh_norm_nome(v_cargo))
    ON CONFLICT (modelo_id, cargo_norm) WHERE cargo_norm IS NOT NULL DO NOTHING;
  END LOOP;
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_modelo_gravar(jsonb, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tarefa_modelo_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_id uuid;
BEGIN
  PERFORM public.tarefa_exige('alterar');
  IF jsonb_array_length(coalesce(p->'cargos', '[]'::jsonb)) = 0
     AND NOT EXISTS (SELECT 1 FROM public."TAREFA_FUNCAO_ALVO" a WHERE a.modelo_id = nullif(p->>'id', '')::uuid AND a.no_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Escolha pelo menos um cargo.';
  END IF;
  v_id := public.tarefa_modelo_gravar(p, 'manual', NULL);
  -- Vale já: não espera a geração de amanhã.
  PERFORM public.tarefa_gerar_dia(public.tarefa_hoje(), v_id);
  PERFORM public.tarefa_cancelar_sem_destino();
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_modelo_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_modelo_salvar(jsonb) TO authenticated;

-- A planilha do Gerador de POPs: uma linha por atividade. Reimportar atualiza.
CREATE OR REPLACE FUNCTION public.tarefa_importar_planilha(p_linhas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  l jsonb;
  v_chave text;
  v_novos int := 0;
  v_atual int := 0;
  v_id uuid;
BEGIN
  PERFORM public.tarefa_exige('alterar');
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) LOOP
    v_chave := 'pop|' || coalesce(public.rh_norm_nome(l->>'setor'), '') || '|' || coalesce(public.rh_norm_nome(l->>'titulo'), '') || '|'
               || coalesce(public.rh_norm_nome(l->'cargos'->>0), '');
    IF EXISTS (SELECT 1 FROM public."TAREFA_FUNCAO_MODELO" WHERE chave_importacao = v_chave) THEN v_atual := v_atual + 1; ELSE v_novos := v_novos + 1; END IF;
    v_id := public.tarefa_modelo_gravar(l, 'planilha', v_chave);
  END LOOP;
  PERFORM public.tarefa_gerar_dia(public.tarefa_hoje());
  RETURN jsonb_build_object('novos', v_novos, 'atualizados', v_atual);
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_importar_planilha(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_importar_planilha(jsonb) TO authenticated;

-- A Estrutura de Processos: processo ativo com frequência recorrente e responsável
-- vira tarefa. Responsável ligado a uma pessoa da árvore vale para ela; só com
-- cargo escrito, vale para o cargo. "Anual" e "Sob demanda" ficam de fora.
CREATE OR REPLACE FUNCTION public.tarefa_importar_estrutura()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
  v_per text;
  v_chave text;
  v_id uuid;
  v_no uuid;
  v_novos int := 0;
  v_atual int := 0;
  v_ign int := 0;
BEGIN
  PERFORM public.tarefa_exige('alterar');
  FOR r IN
    SELECT p.id, p.nome, p.descricao, p.frequencia, s.nome AS setor, mb.cargo, mb.empregado_id, mb.user_id
      FROM public."ORG_PROC_PROCESSO" p
      LEFT JOIN public."ORG_PROC_SETOR" s ON s.id = p.setor_id
      LEFT JOIN public."ORG_PROC_MEMBRO" mb ON mb.id = p.responsavel_membro_id
     WHERE p.status = 'ativo'
  LOOP
    v_per := CASE WHEN r.frequencia ~* 'di[aá]ri' THEN 'diaria' WHEN r.frequencia ~* 'seman' THEN 'semanal'
                  WHEN r.frequencia ~* 'quinzen' THEN 'quinzenal' WHEN r.frequencia ~* 'mens' THEN 'mensal' END;
    IF v_per IS NULL OR r.cargo IS NULL THEN v_ign := v_ign + 1; CONTINUE; END IF;
    v_no := NULL;
    SELECT o.id INTO v_no FROM public."ORGANOGRAMA_NO" o
     WHERE (r.empregado_id IS NOT NULL AND o.empregado_id = r.empregado_id) OR (r.user_id IS NOT NULL AND o.user_id = r.user_id) LIMIT 1;
    v_chave := 'proc|' || r.id;
    IF EXISTS (SELECT 1 FROM public."TAREFA_FUNCAO_MODELO" WHERE chave_importacao = v_chave) THEN v_atual := v_atual + 1; ELSE v_novos := v_novos + 1; END IF;
    v_id := public.tarefa_modelo_gravar(jsonb_build_object(
      'titulo', r.nome, 'descricao', r.descricao, 'setor', r.setor, 'processo_id', r.id, 'periodicidade', v_per,
      'cargos', CASE WHEN v_no IS NULL THEN jsonb_build_array(r.cargo) ELSE '[]'::jsonb END), 'estrutura', v_chave);
    DELETE FROM public."TAREFA_FUNCAO_ALVO" WHERE modelo_id = v_id AND no_id IS NOT NULL;
    IF v_no IS NOT NULL THEN
      INSERT INTO public."TAREFA_FUNCAO_ALVO" (modelo_id, no_id) VALUES (v_id, v_no);
    END IF;
  END LOOP;
  PERFORM public.tarefa_gerar_dia(public.tarefa_hoje());
  RETURN jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'ignorados', v_ign);
END $fn$;
REVOKE ALL ON FUNCTION public.tarefa_importar_estrutura() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tarefa_importar_estrutura() TO authenticated;

-- ── 9) Agendamento ───────────────────────────────────────────────────────
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('tarefas-por-funcao')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tarefas-por-funcao');
    -- 09:05 UTC = 06:05 em Brasília.
    PERFORM cron.schedule('tarefas-por-funcao', '5 9 * * *', $job$SELECT public.tarefa_garantir_hoje();$job$);
  ELSE
    RAISE NOTICE 'pg_cron ausente: as tarefas nascem na primeira leitura do dia.';
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- SELECT cron.unschedule('tarefas-por-funcao');
-- DROP FUNCTION IF EXISTS public.tarefa_importar_estrutura(), public.tarefa_importar_planilha(jsonb),
--   public.tarefa_modelo_salvar(jsonb), public.tarefa_modelo_gravar(jsonb, text, text), public.tarefa_modelos(), public.tarefa_cargos(),
--   public.tarefa_acompanhamento(date, date), public.tarefa_resolver(uuid, text, text), public.tarefa_minhas(),
--   public.tarefa_json(public."TAREFA_FUNCAO_INSTANCIA", public."TAREFA_FUNCAO_MODELO"), public.tarefa_garantir_hoje(),
--   public.tarefa_cancelar_sem_destino(), public.tarefa_gerar_dia(date, uuid), public.tarefa_destinos(uuid), public.tarefa_pessoas(),
--   public.tarefa_periodo(text, smallint, smallint, date), public.tarefa_dia_util(date, date),
--   public.tarefa_hoje(), public.tarefa_exige(text), public.tarefa_pode(text);
-- DROP TABLE IF EXISTS public."TAREFA_FUNCAO_GERACAO", public."TAREFA_FUNCAO_INSTANCIA", public."TAREFA_FUNCAO_ALVO", public."TAREFA_FUNCAO_MODELO";
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'organograma_tarefas';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'organograma_tarefas';
-- DELETE FROM public.app_menu WHERE codigo = 'organograma_tarefas';
-- NOTIFY pgrst, 'reload schema';
