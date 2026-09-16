-- =====================================================================
-- HORA EXTRA — escala de trabalho, cálculo automático do excedente e
-- correção da liberação.
--
-- Três ajustes pedidos pelo Eduardo em 16/09/2026, depois do primeiro
-- teste em produção:
--
-- 1. Aprovar a própria solicitação dava 400 ("Você não pode liberar a
--    própria solicitação"). Quem tem `aprovar` costuma ser a única
--    pessoa com a ação no Gerenciamento de Acesso, então a HE do próprio
--    gestor ficava presa em `aguardando_liberacao` para sempre. A trava
--    de segregação saiu; o autor da liberação continua registrado em
--    `liberado_por` e no HORA_EXTRA_EVENTO.
-- 2. A expectativa de conclusão deixou de ser uma soma que precisa fechar
--    100%. Cada chamado vale de 0 a 100% e o total exibido é a MÉDIA das
--    linhas, que por construção nunca passa de 100%.
-- 3. Hora extra passou a ser calculada: só conta o que exceder a jornada
--    da escala de trabalho (padrão 07:30-12:00-13:00-17:18 = 8h48). As
--    escalas ficam numa tabela própria para atender quem tem jornada
--    diferente.
-- =====================================================================

-- 1) Escalas de trabalho ----------------------------------------------
CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_ESCALA" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome              text NOT NULL UNIQUE,
  entrada           time NOT NULL,
  saida_intervalo   time NOT NULL,
  retorno_intervalo time NOT NULL,
  saida             time NOT NULL,
  minutos_jornada   integer NOT NULL CHECK (minutos_jornada > 0),
  padrao            boolean NOT NULL DEFAULT false,
  ativo             boolean NOT NULL DEFAULT true,
  criado_por        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Só pode existir uma escala padrão de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hora_extra_escala_padrao
  ON public."HORA_EXTRA_ESCALA" (padrao) WHERE padrao;

DROP TRIGGER IF EXISTS trg_hora_extra_escala_updated_at ON public."HORA_EXTRA_ESCALA";
CREATE TRIGGER trg_hora_extra_escala_updated_at
  BEFORE UPDATE ON public."HORA_EXTRA_ESCALA"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Cálculo ----------------------------------------------------------
-- Minutos efetivamente trabalhados no dia: manhã + tarde. Cada trecho
-- que "vira o dia" (saída menor que a entrada) ganha 24h.
CREATE OR REPLACE FUNCTION public.hora_extra_minutos_trabalhados(
  p_entrada time,
  p_saida_intervalo time,
  p_retorno_intervalo time,
  p_saida time
)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT
    ((extract(epoch FROM p_saida_intervalo)::int / 60
      - extract(epoch FROM p_entrada)::int / 60) + 1440) % 1440
  + ((extract(epoch FROM p_saida)::int / 60
      - extract(epoch FROM p_retorno_intervalo)::int / 60) + 1440) % 1440;
$fn$;

-- Hora extra do dia: o que passou da jornada da escala. Nunca negativo.
CREATE OR REPLACE FUNCTION public.hora_extra_excedente(
  p_entrada time,
  p_saida_intervalo time,
  p_retorno_intervalo time,
  p_saida time,
  p_jornada integer
)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT greatest(
    public.hora_extra_minutos_trabalhados(p_entrada, p_saida_intervalo, p_retorno_intervalo, p_saida)
      - greatest(coalesce(p_jornada, 0), 0),
    0
  );
$fn$;

-- Momento em que a hora extra começou: conta para trás a partir da saída.
-- Se o excedente for maior que o turno da tarde, o que sobra veio da
-- manhã e o início cai antes do intervalo.
CREATE OR REPLACE FUNCTION public.hora_extra_inicio(
  p_entrada time,
  p_saida_intervalo time,
  p_retorno_intervalo time,
  p_saida time,
  p_jornada integer
)
RETURNS time LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN base.excedente <= 0 THEN p_saida
    WHEN base.excedente <= base.tarde THEN (p_saida - make_interval(mins => base.excedente))::time
    ELSE (p_saida_intervalo - make_interval(mins => base.excedente - base.tarde))::time
  END
  FROM (
    SELECT
      public.hora_extra_excedente(
        p_entrada, p_saida_intervalo, p_retorno_intervalo, p_saida, p_jornada
      ) AS excedente,
      ((extract(epoch FROM p_saida)::int / 60
        - extract(epoch FROM p_retorno_intervalo)::int / 60) + 1440) % 1440 AS tarde
  ) AS base;
$fn$;

CREATE OR REPLACE FUNCTION public.hora_extra_formatar_minutos(p_minutos integer)
RETURNS text LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT (coalesce(p_minutos, 0) / 60)::text || 'h'
      || lpad((coalesce(p_minutos, 0) % 60)::text, 2, '0');
$fn$;

-- Escala padrão da empresa: 07:30 às 17:18 com 1h de intervalo = 8h48.
INSERT INTO public."HORA_EXTRA_ESCALA" (
  nome, entrada, saida_intervalo, retorno_intervalo, saida, minutos_jornada, padrao
)
SELECT
  'Padrão (07:30 às 17:18)',
  '07:30'::time,
  '12:00'::time,
  '13:00'::time,
  '17:18'::time,
  public.hora_extra_minutos_trabalhados('07:30', '12:00', '13:00', '17:18'),
  true
WHERE NOT EXISTS (SELECT 1 FROM public."HORA_EXTRA_ESCALA");

-- 3) Colunas novas na solicitação -------------------------------------
ALTER TABLE public."HORA_EXTRA_SOLICITACAO"
  ADD COLUMN IF NOT EXISTS escala_id uuid REFERENCES public."HORA_EXTRA_ESCALA"(id),
  ADD COLUMN IF NOT EXISTS escala_nome text,
  ADD COLUMN IF NOT EXISTS jornada_minutos integer,
  ADD COLUMN IF NOT EXISTS trabalhado_previsto_min integer,
  ADD COLUMN IF NOT EXISTS trabalhado_real_min integer;

-- Solicitações criadas antes desta migration guardavam a janela digitada
-- à mão. Recalcula pela escala padrão para a tela não misturar os dois
-- significados de `total_previsto_min`.
UPDATE public."HORA_EXTRA_SOLICITACAO" s
SET
  escala_id = e.id,
  escala_nome = e.nome,
  jornada_minutos = e.minutos_jornada,
  trabalhado_previsto_min = public.hora_extra_minutos_trabalhados(
    s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida
  ),
  total_previsto_min = CASE
    WHEN public.hora_extra_excedente(
      s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida, e.minutos_jornada
    ) > 0
    THEN public.hora_extra_excedente(
      s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida, e.minutos_jornada
    )
    ELSE s.total_previsto_min
  END,
  he_inicio_previsto = CASE
    WHEN public.hora_extra_excedente(
      s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida, e.minutos_jornada
    ) > 0
    THEN public.hora_extra_inicio(
      s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida, e.minutos_jornada
    )
    ELSE s.he_inicio_previsto
  END,
  he_fim_previsto = CASE
    WHEN public.hora_extra_excedente(
      s.ponto_entrada, s.ponto_saida_intervalo, s.ponto_retorno_intervalo, s.ponto_saida, e.minutos_jornada
    ) > 0
    THEN s.ponto_saida
    ELSE s.he_fim_previsto
  END
FROM public."HORA_EXTRA_ESCALA" e
WHERE e.padrao
  AND s.jornada_minutos IS NULL;

-- 4) RPCs das escalas -------------------------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_escala_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_nome text := btrim(coalesce(p->>'nome', ''));
  v_entrada time := (p->>'entrada')::time;
  v_saida_intervalo time := (p->>'saida_intervalo')::time;
  v_retorno_intervalo time := (p->>'retorno_intervalo')::time;
  v_saida time := (p->>'saida')::time;
  v_padrao boolean := coalesce((p->>'padrao')::boolean, false);
  v_minutos integer;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para cadastrar escalas de trabalho.';
  END IF;

  IF v_nome = '' THEN
    RAISE EXCEPTION 'Informe o nome da escala.';
  END IF;

  v_minutos := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );

  IF v_minutos <= 0 THEN
    RAISE EXCEPTION 'Os horários da escala não formam uma jornada válida.';
  END IF;

  IF v_padrao THEN
    UPDATE public."HORA_EXTRA_ESCALA"
    SET padrao = false
    WHERE padrao
      AND (v_id IS NULL OR id <> v_id);
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public."HORA_EXTRA_ESCALA" (
      nome,
      entrada,
      saida_intervalo,
      retorno_intervalo,
      saida,
      minutos_jornada,
      padrao,
      criado_por
    )
    VALUES (
      v_nome,
      v_entrada,
      v_saida_intervalo,
      v_retorno_intervalo,
      v_saida,
      v_minutos,
      v_padrao,
      v_uid
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public."HORA_EXTRA_ESCALA"
    SET
      nome = v_nome,
      entrada = v_entrada,
      saida_intervalo = v_saida_intervalo,
      retorno_intervalo = v_retorno_intervalo,
      saida = v_saida,
      minutos_jornada = v_minutos,
      padrao = v_padrao,
      ativo = true
    WHERE id = v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escala de trabalho não encontrada.';
    END IF;
  END IF;

  RETURN v_id;
END;
$fn$;

-- A escala é desativada, nunca apagada: as solicitações antigas guardam
-- o `escala_id` e precisam continuar apontando para uma linha existente.
CREATE OR REPLACE FUNCTION public.hora_extra_escala_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_padrao boolean;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir escalas de trabalho.';
  END IF;

  SELECT padrao INTO v_padrao
  FROM public."HORA_EXTRA_ESCALA"
  WHERE id = p_id;

  IF v_padrao IS NULL THEN
    RAISE EXCEPTION 'Escala de trabalho não encontrada.';
  END IF;

  IF v_padrao THEN
    RAISE EXCEPTION 'Defina outra escala como padrão antes de excluir esta.';
  END IF;

  UPDATE public."HORA_EXTRA_ESCALA"
  SET ativo = false
  WHERE id = p_id;
END;
$fn$;

-- 5) Solicitação: expectativa por chamado e total calculado -----------
CREATE OR REPLACE FUNCTION public.hora_extra_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_colaborador uuid;
  v_edicao boolean;
  v_aprovar boolean;
  v_incluir boolean;
  v_alterar boolean;
  v_item jsonb;
  v_chamado record;
  v_nome text;
  v_cargo text;
  v_setor text;
  v_empresa text;
  v_escala record;
  v_entrada time;
  v_saida_intervalo time;
  v_retorno_intervalo time;
  v_saida time;
  v_inicio time;
  v_fim time;
  v_inicio_min int;
  v_fim_min int;
  v_trabalhado int;
  v_total int;
  v_numero text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;

  v_edicao := nullif(p->>'id', '') IS NOT NULL;
  v_id := nullif(p->>'id', '')::uuid;
  v_colaborador := coalesce(nullif(p->>'colaborador_id', '')::uuid, v_uid);
  v_aprovar := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar');
  v_incluir := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'incluir');
  v_alterar := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'alterar');

  IF jsonb_array_length(coalesce(p->'chamados', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos um chamado.';
  END IF;

  IF nullif(btrim(p->>'justificativa'), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa da solicitação.';
  END IF;

  -- Cada chamado tem a própria expectativa, de 0 a 100%. O total exibido
  -- na tela é a média das linhas, então não existe mais soma a fechar.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p->'chamados') x
    WHERE nullif(x->>'percentual_previsto', '') IS NULL
       OR (x->>'percentual_previsto')::numeric < 0
       OR (x->>'percentual_previsto')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'A expectativa de conclusão de cada chamado deve ficar entre 0%% e 100%%.';
  END IF;

  -- Escala de trabalho: a informada ou a padrão da empresa.
  SELECT e.id, e.nome, e.minutos_jornada
  INTO v_escala
  FROM public."HORA_EXTRA_ESCALA" e
  WHERE e.id = nullif(p->>'escala_id', '')::uuid
  LIMIT 1;

  IF v_escala.id IS NULL THEN
    SELECT e.id, e.nome, e.minutos_jornada
    INTO v_escala
    FROM public."HORA_EXTRA_ESCALA" e
    WHERE e.padrao
    LIMIT 1;
  END IF;

  IF v_escala.id IS NULL THEN
    RAISE EXCEPTION 'Nenhuma escala de trabalho cadastrada. Cadastre a escala antes de solicitar HE.';
  END IF;

  v_entrada := (p->>'ponto_entrada')::time;
  v_saida_intervalo := (p->>'ponto_saida_intervalo')::time;
  v_retorno_intervalo := (p->>'ponto_retorno_intervalo')::time;
  v_saida := (p->>'ponto_saida')::time;

  v_trabalhado := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  v_total := public.hora_extra_excedente(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_escala.minutos_jornada
  );
  v_inicio := public.hora_extra_inicio(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_escala.minutos_jornada
  );
  v_fim := v_saida;

  IF v_total <= 0 THEN
    RAISE EXCEPTION
      'Os horários informados somam %, dentro da jornada de % da escala %. Não há hora extra a solicitar.',
      public.hora_extra_formatar_minutos(v_trabalhado),
      public.hora_extra_formatar_minutos(v_escala.minutos_jornada),
      v_escala.nome;
  END IF;

  v_inicio_min := extract(epoch FROM v_inicio)::int / 60;
  v_fim_min := extract(epoch FROM v_fim)::int / 60;

  IF v_fim_min <= v_inicio_min THEN
    v_fim_min := v_fim_min + 1440;
  END IF;

  IF v_edicao THEN
    PERFORM 1
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.id = v_id
      AND s.colaborador_id = v_uid
      AND s.status = 'aguardando_liberacao';

    IF NOT FOUND OR NOT v_alterar THEN
      RAISE EXCEPTION 'Você não pode editar esta solicitação.';
    END IF;

    v_colaborador := v_uid;
  ELSE
    IF v_colaborador = v_uid AND NOT v_incluir THEN
      RAISE EXCEPTION 'Você não tem permissão para incluir solicitações.';
    END IF;

    IF v_colaborador <> v_uid AND NOT v_aprovar THEN
      RAISE EXCEPTION 'Você não tem permissão para criar HE para outro colaborador.';
    END IF;
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p->'chamados')
  LOOP
    PERFORM public.hora_extra_checar_chamado(
      (v_item->>'chamado_id')::uuid,
      v_colaborador
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.colaborador_id = v_colaborador
      AND s.data_he = (p->>'data_he')::date
      AND s.status <> 'reprovada'
      AND (NOT v_edicao OR s.id <> v_id)
      AND int4range(
        extract(epoch FROM s.he_inicio_previsto)::int / 60,
        CASE
          WHEN s.he_fim_previsto <= s.he_inicio_previsto
            THEN extract(epoch FROM s.he_fim_previsto)::int / 60 + 1440
          ELSE extract(epoch FROM s.he_fim_previsto)::int / 60
        END,
        '[)'
      ) && int4range(v_inicio_min, v_fim_min, '[)')
  ) THEN
    RAISE EXCEPTION 'Já existe uma solicitação de HE sobreposta para este colaborador e data.';
  END IF;

  SELECT
    coalesce(e."Nome", pr.display_name, 'Colaborador'),
    e."Título do Cargo",
    e."Setor_ERP",
    e."Nome da Empresa"
  INTO
    v_nome,
    v_cargo,
    v_setor,
    v_empresa
  FROM public.profiles pr
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = pr.id
  WHERE pr.id = v_colaborador
  LIMIT 1;

  v_setor := coalesce(nullif(btrim(p->>'setor'), ''), v_setor);

  IF v_edicao THEN
    UPDATE public."HORA_EXTRA_SOLICITACAO"
    SET
      data_he = (p->>'data_he')::date,
      tipo = p->>'tipo',
      ponto_entrada = v_entrada,
      ponto_saida_intervalo = v_saida_intervalo,
      ponto_retorno_intervalo = v_retorno_intervalo,
      ponto_saida = v_saida,
      escala_id = v_escala.id,
      escala_nome = v_escala.nome,
      jornada_minutos = v_escala.minutos_jornada,
      trabalhado_previsto_min = v_trabalhado,
      he_inicio_previsto = v_inicio,
      he_fim_previsto = v_fim,
      total_previsto_min = v_total,
      justificativa = btrim(p->>'justificativa'),
      setor = v_setor,
      colaborador_nome = v_nome,
      colaborador_cargo = v_cargo,
      empresa = v_empresa,
      motivo_reprovacao = NULL
    WHERE id = v_id;

    DELETE FROM public."HORA_EXTRA_CHAMADO"
    WHERE solicitacao_id = v_id;

    INSERT INTO public."HORA_EXTRA_EVENTO" (
      solicitacao_id,
      autor_id,
      acao,
      texto
    )
    VALUES (
      v_id,
      v_uid,
      'editada',
      'Solicitação editada'
    );
  ELSE
    INSERT INTO public."HORA_EXTRA_SOLICITACAO" (
      colaborador_id,
      colaborador_nome,
      colaborador_cargo,
      setor,
      empresa,
      criado_por,
      data_he,
      tipo,
      ponto_entrada,
      ponto_saida_intervalo,
      ponto_retorno_intervalo,
      ponto_saida,
      escala_id,
      escala_nome,
      jornada_minutos,
      trabalhado_previsto_min,
      he_inicio_previsto,
      he_fim_previsto,
      total_previsto_min,
      justificativa,
      status,
      liberado_por,
      liberado_em
    )
    VALUES (
      v_colaborador,
      v_nome,
      v_cargo,
      v_setor,
      v_empresa,
      v_uid,
      (p->>'data_he')::date,
      p->>'tipo',
      v_entrada,
      v_saida_intervalo,
      v_retorno_intervalo,
      v_saida,
      v_escala.id,
      v_escala.nome,
      v_escala.minutos_jornada,
      v_trabalhado,
      v_inicio,
      v_fim,
      v_total,
      btrim(p->>'justificativa'),
      CASE
        WHEN v_colaborador <> v_uid THEN 'aprovada'
        ELSE 'aguardando_liberacao'
      END,
      CASE WHEN v_colaborador <> v_uid THEN v_uid END,
      CASE WHEN v_colaborador <> v_uid THEN now() END
    )
    RETURNING id, numero INTO v_id, v_numero;

    INSERT INTO public."HORA_EXTRA_EVENTO" (
      solicitacao_id,
      autor_id,
      acao,
      texto,
      meta
    )
    VALUES (
      v_id,
      v_uid,
      'criada',
      CASE
        WHEN v_colaborador <> v_uid THEN 'HE criada e liberada pelo gestor'
        ELSE 'Solicitação criada'
      END,
      jsonb_build_object('numero', v_numero)
    );
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p->'chamados')
  LOOP
    SELECT
      c.id,
      c.numero,
      c.assunto,
      c.setor,
      c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = (v_item->>'chamado_id')::uuid;

    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id,
      chamado_id,
      chamado_numero,
      chamado_assunto,
      chamado_setor,
      prioridade,
      percentual_previsto
    )
    VALUES (
      v_id,
      v_chamado.id,
      v_chamado.numero,
      v_chamado.assunto,
      v_chamado.setor,
      coalesce(nullif(v_item->>'prioridade', ''), v_chamado.prioridade),
      (v_item->>'percentual_previsto')::numeric
    );
  END LOOP;

  RETURN v_id;
END;
$fn$;

-- 6) Liberação: quem tem `aprovar` decide, inclusive a própria HE ------
CREATE OR REPLACE FUNCTION public.hora_extra_liberar(
  p_id uuid,
  p_aprovar boolean,
  p_motivo text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar.';
  END IF;

  SELECT *
  INTO v_s
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = p_id
  FOR UPDATE;

  IF v_s.id IS NULL OR v_s.status <> 'aguardando_liberacao' THEN
    RAISE EXCEPTION 'A solicitação não aguarda liberação.';
  END IF;

  -- A versão anterior recusava liberar a própria solicitação. Em
  -- 16/09/2026 isso travou a única pessoa com a ação `aprovar`: a HE dela
  -- não tinha quem liberasse. Quem libera fica registrado em
  -- `liberado_por` e no evento, que é o controle que sobra.
  IF NOT p_aprovar AND nullif(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da rejeição.';
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    status = CASE WHEN p_aprovar THEN 'aprovada' ELSE 'reprovada' END,
    liberado_por = CASE WHEN p_aprovar THEN v_uid END,
    liberado_em = CASE WHEN p_aprovar THEN now() END,
    motivo_reprovacao = CASE WHEN p_aprovar THEN NULL ELSE btrim(p_motivo) END
  WHERE id = p_id;

  INSERT INTO public."HORA_EXTRA_EVENTO" (
    solicitacao_id,
    autor_id,
    acao,
    texto
  )
  VALUES (
    p_id,
    v_uid,
    CASE WHEN p_aprovar THEN 'liberada' ELSE 'reprovada' END,
    CASE
      WHEN NOT p_aprovar THEN btrim(p_motivo)
      WHEN v_s.colaborador_id = v_uid THEN 'Solicitação liberada pelo próprio gestor'
      ELSE 'Solicitação liberada'
    END
  );
END;
$fn$;

-- 7) Conclusão: a hora extra real também vem do ponto do dia -----------
CREATE OR REPLACE FUNCTION public.hora_extra_concluir(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid;
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_item jsonb;
  v_chamado record;
  v_jornada int;
  v_entrada time;
  v_saida_intervalo time;
  v_retorno_intervalo time;
  v_saida time;
  v_trabalhado int;
  v_total int;
  v_inicio time;
BEGIN
  SELECT *
  INTO v_s
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = v_id
  FOR UPDATE;

  IF v_s.id IS NULL
  OR v_s.colaborador_id <> v_uid
  OR v_s.status <> 'aprovada' THEN
    RAISE EXCEPTION 'Esta HE não pode ser concluída por você.';
  END IF;

  IF v_s.data_he > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A HE só pode ser concluída na data prevista ou depois dela.';
  END IF;

  IF jsonb_array_length(coalesce(p->'chamados', '[]'::jsonb)) <> (
    SELECT count(*)
    FROM public."HORA_EXTRA_CHAMADO" c
    WHERE c.solicitacao_id = v_id
      AND c.adicional = false
  ) THEN
    RAISE EXCEPTION 'Informe o resultado de todos os chamados originais.';
  END IF;

  IF nullif(btrim(p->>'resumo_conclusao'), '') IS NULL THEN
    RAISE EXCEPTION 'Preencha o resumo e observações.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(p->'chamados', '[]'::jsonb) || coalesce(p->'adicionais', '[]'::jsonb)
    ) x
    WHERE nullif(x->>'percentual_concluido', '') IS NULL
       OR (x->>'percentual_concluido')::numeric < 0
       OR (x->>'percentual_concluido')::numeric > 100
  ) THEN
    RAISE EXCEPTION 'O percentual concluído de cada chamado deve ficar entre 0%% e 100%%.';
  END IF;

  v_jornada := coalesce(
    v_s.jornada_minutos,
    (SELECT e.minutos_jornada FROM public."HORA_EXTRA_ESCALA" e WHERE e.padrao LIMIT 1)
  );

  v_entrada := (p->>'ponto_entrada_real')::time;
  v_saida_intervalo := (p->>'ponto_saida_intervalo_real')::time;
  v_retorno_intervalo := (p->>'ponto_retorno_intervalo_real')::time;
  v_saida := (p->>'ponto_saida_real')::time;

  v_trabalhado := public.hora_extra_minutos_trabalhados(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida
  );
  v_total := public.hora_extra_excedente(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );
  v_inicio := public.hora_extra_inicio(
    v_entrada, v_saida_intervalo, v_retorno_intervalo, v_saida, v_jornada
  );

  IF v_total <= 0 THEN
    RAISE EXCEPTION
      'Os horários informados somam %, dentro da jornada de %. Não há hora extra a registrar.',
      public.hora_extra_formatar_minutos(v_trabalhado),
      public.hora_extra_formatar_minutos(v_jornada);
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    ponto_entrada_real = v_entrada,
    ponto_saida_intervalo_real = v_saida_intervalo,
    ponto_retorno_intervalo_real = v_retorno_intervalo,
    ponto_saida_real = v_saida,
    trabalhado_real_min = v_trabalhado,
    he_inicio_real = v_inicio,
    he_fim_real = v_saida,
    total_real_min = v_total,
    resumo_conclusao = btrim(p->>'resumo_conclusao'),
    status = 'aguardando_validacao',
    conclusao_enviada_em = now(),
    motivo_devolucao = NULL
  WHERE id = v_id;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb))
  LOOP
    UPDATE public."HORA_EXTRA_CHAMADO"
    SET
      percentual_concluido = (v_item->>'percentual_concluido')::numeric,
      status_execucao = v_item->>'status_execucao',
      observacao = nullif(btrim(v_item->>'observacao'), '')
    WHERE id = (v_item->>'id')::uuid
      AND solicitacao_id = v_id
      AND adicional = false;
  END LOOP;

  DELETE FROM public."HORA_EXTRA_CHAMADO"
  WHERE solicitacao_id = v_id
    AND adicional = true;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(coalesce(p->'adicionais', '[]'::jsonb))
  LOOP
    PERFORM public.hora_extra_checar_chamado(
      (v_item->>'chamado_id')::uuid,
      v_uid,
      v_s.data_he
    );

    SELECT
      c.id,
      c.numero,
      c.assunto,
      c.setor,
      c.prioridade
    INTO v_chamado
    FROM public."CHAMADO_SISTEMA" c
    WHERE c.id = (v_item->>'chamado_id')::uuid;

    INSERT INTO public."HORA_EXTRA_CHAMADO" (
      solicitacao_id,
      chamado_id,
      chamado_numero,
      chamado_assunto,
      chamado_setor,
      prioridade,
      adicional,
      percentual_previsto,
      percentual_concluido,
      status_execucao,
      observacao
    )
    VALUES (
      v_id,
      v_chamado.id,
      v_chamado.numero,
      v_chamado.assunto,
      v_chamado.setor,
      v_chamado.prioridade,
      true,
      NULL,
      (v_item->>'percentual_concluido')::numeric,
      v_item->>'status_execucao',
      nullif(btrim(v_item->>'observacao'), '')
    );
  END LOOP;

  INSERT INTO public."HORA_EXTRA_EVENTO" (
    solicitacao_id,
    autor_id,
    acao,
    texto
  )
  VALUES (
    v_id,
    v_uid,
    'concluida',
    'Conclusão enviada para validação'
  );
END;
$fn$;

-- 8) Privilégios e leitura --------------------------------------------
REVOKE ALL ON FUNCTION public.hora_extra_minutos_trabalhados(time, time, time, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_excedente(time, time, time, time, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_inicio(time, time, time, time, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_formatar_minutos(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_escala_salvar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_escala_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_minutos_trabalhados(time, time, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_excedente(time, time, time, time, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_inicio(time, time, time, time, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_formatar_minutos(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_escala_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_escala_excluir(uuid) TO authenticated;

ALTER TABLE public."HORA_EXTRA_ESCALA" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hora_extra_escala_select ON public."HORA_EXTRA_ESCALA";
CREATE POLICY hora_extra_escala_select ON public."HORA_EXTRA_ESCALA" FOR SELECT TO authenticated
USING (public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar'));

GRANT SELECT ON public."HORA_EXTRA_ESCALA" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.hora_extra_escala_excluir(uuid);
-- DROP FUNCTION IF EXISTS public.hora_extra_escala_salvar(jsonb);
-- DROP FUNCTION IF EXISTS public.hora_extra_inicio(time, time, time, time, integer);
-- DROP FUNCTION IF EXISTS public.hora_extra_excedente(time, time, time, time, integer);
-- DROP FUNCTION IF EXISTS public.hora_extra_minutos_trabalhados(time, time, time, time);
-- DROP FUNCTION IF EXISTS public.hora_extra_formatar_minutos(integer);
-- ALTER TABLE public."HORA_EXTRA_SOLICITACAO"
--   DROP COLUMN IF EXISTS escala_id,
--   DROP COLUMN IF EXISTS escala_nome,
--   DROP COLUMN IF EXISTS jornada_minutos,
--   DROP COLUMN IF EXISTS trabalhado_previsto_min,
--   DROP COLUMN IF EXISTS trabalhado_real_min;
-- DROP TABLE IF EXISTS public."HORA_EXTRA_ESCALA";
-- As versões anteriores de hora_extra_salvar, hora_extra_liberar e
-- hora_extra_concluir estão em
-- supabase/migrations/20260930000162_hora_extra_autorizacao.sql.
-- NOTIFY pgrst, 'reload schema';
