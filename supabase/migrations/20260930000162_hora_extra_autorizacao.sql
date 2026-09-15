-- =====================================================================
-- HORA EXTRA — solicitação, liberação, conclusão e validação.
-- Escrita exclusivamente pelas RPCs desta migration; leitura por dono ou
-- por quem recebeu a ação `aprovar` no Gerenciamento de Acesso.
-- =====================================================================

-- 1) Menus e ações -----------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('sistemas_hora_extra', 'Hora Extra — Solicitações', '/app/sistemas/hora-extra', 30),
    ('sistemas_hora_extra_liberacao', 'Hora Extra — Liberação', '/app/sistemas/hora-extra/liberacao', 31)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('sistemas_hora_extra', 'incluir'),
  ('sistemas_hora_extra', 'alterar'),
  ('sistemas_hora_extra', 'excluir'),
  ('sistemas_hora_extra', 'aprovar')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.menu_codigo, x.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
    ('sistemas_hora_extra', 'visualizar'::public.app_acao),
    ('sistemas_hora_extra', 'incluir'::public.app_acao),
    ('sistemas_hora_extra', 'alterar'::public.app_acao),
    ('sistemas_hora_extra', 'excluir'::public.app_acao),
    ('sistemas_hora_extra', 'aprovar'::public.app_acao),
    ('sistemas_hora_extra_liberacao', 'visualizar'::public.app_acao)
 ) AS x(menu_codigo, acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- 2) Estrutura de dados -----------------------------------------------
CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_SOLICITACAO" (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                     text UNIQUE,
  colaborador_id             uuid NOT NULL REFERENCES auth.users(id),
  colaborador_nome           text NOT NULL,
  colaborador_cargo          text,
  setor                      text,
  empresa                    text,
  criado_por                 uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  data_he                    date NOT NULL,
  tipo                       text NOT NULL DEFAULT 'normal' CHECK (tipo IN ('normal','emergencial')),
  ponto_entrada              time NOT NULL,
  ponto_saida_intervalo      time NOT NULL,
  ponto_retorno_intervalo    time NOT NULL,
  ponto_saida                time NOT NULL,
  he_inicio_previsto         time NOT NULL,
  he_fim_previsto            time NOT NULL,
  total_previsto_min         integer NOT NULL CHECK (total_previsto_min > 0),
  justificativa              text NOT NULL CHECK (char_length(justificativa) <= 500),
  status                     text NOT NULL DEFAULT 'aguardando_liberacao'
                               CHECK (status IN ('aguardando_liberacao','aprovada','aguardando_validacao','concluida','reprovada')),
  liberado_por               uuid REFERENCES auth.users(id),
  liberado_em                timestamptz,
  motivo_reprovacao          text,
  ponto_entrada_real         time,
  ponto_saida_intervalo_real time,
  ponto_retorno_intervalo_real time,
  ponto_saida_real           time,
  he_inicio_real             time,
  he_fim_real                time,
  total_real_min             integer CHECK (total_real_min IS NULL OR total_real_min > 0),
  resumo_conclusao           text CHECK (resumo_conclusao IS NULL OR char_length(resumo_conclusao) <= 1000),
  conclusao_enviada_em       timestamptz,
  validado_por               uuid REFERENCES auth.users(id),
  validado_em                timestamptz,
  motivo_devolucao           text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hora_extra_solicitacao_colaborador ON public."HORA_EXTRA_SOLICITACAO"(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_hora_extra_solicitacao_status ON public."HORA_EXTRA_SOLICITACAO"(status);
CREATE INDEX IF NOT EXISTS idx_hora_extra_solicitacao_data ON public."HORA_EXTRA_SOLICITACAO"(data_he);

CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_CHAMADO" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id        uuid NOT NULL REFERENCES public."HORA_EXTRA_SOLICITACAO"(id) ON DELETE CASCADE,
  chamado_id            uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id),
  chamado_numero        text NOT NULL,
  chamado_assunto       text NOT NULL,
  chamado_setor         text,
  prioridade            text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  adicional             boolean NOT NULL DEFAULT false,
  percentual_previsto   numeric CHECK (percentual_previsto IS NULL OR percentual_previsto BETWEEN 0 AND 100),
  percentual_concluido  numeric CHECK (percentual_concluido IS NULL OR percentual_concluido BETWEEN 0 AND 100),
  status_execucao       text CHECK (status_execucao IS NULL OR status_execucao IN ('concluido','parcial','nao_iniciado')),
  observacao            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (solicitacao_id, chamado_id),
  CHECK ((adicional AND percentual_previsto IS NULL) OR (NOT adicional AND percentual_previsto IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_hora_extra_chamado_solicitacao ON public."HORA_EXTRA_CHAMADO"(solicitacao_id);

CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_ANEXO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."HORA_EXTRA_SOLICITACAO"(id) ON DELETE CASCADE,
  fase           text NOT NULL CHECK (fase IN ('solicitacao','conclusao')),
  storage_path   text NOT NULL,
  nome_arquivo   text NOT NULL,
  mime_type      text,
  tamanho_bytes  bigint,
  autor_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hora_extra_anexo_solicitacao ON public."HORA_EXTRA_ANEXO"(solicitacao_id);

CREATE TABLE IF NOT EXISTS public."HORA_EXTRA_EVENTO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid,
  autor_id       uuid REFERENCES auth.users(id),
  acao           text NOT NULL CHECK (acao IN ('criada','editada','liberada','reprovada','concluida','validada','devolvida','excluida')),
  texto          text,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hora_extra_evento_solicitacao ON public."HORA_EXTRA_EVENTO"(solicitacao_id);

CREATE SEQUENCE IF NOT EXISTS public.hora_extra_numero_seq;

CREATE OR REPLACE FUNCTION public.gerar_numero_hora_extra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'HE-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.hora_extra_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hora_extra_numero ON public."HORA_EXTRA_SOLICITACAO";
CREATE TRIGGER trg_hora_extra_numero
  BEFORE INSERT ON public."HORA_EXTRA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.gerar_numero_hora_extra();

DROP TRIGGER IF EXISTS trg_hora_extra_solicitacao_updated_at ON public."HORA_EXTRA_SOLICITACAO";
CREATE TRIGGER trg_hora_extra_solicitacao_updated_at
  BEFORE UPDATE ON public."HORA_EXTRA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hora_extra_chamado_updated_at ON public."HORA_EXTRA_CHAMADO";
CREATE TRIGGER trg_hora_extra_chamado_updated_at
  BEFORE UPDATE ON public."HORA_EXTRA_CHAMADO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Proteção dos valores previstos -----------------------------------
CREATE OR REPLACE FUNCTION public.hora_extra_chamado_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_status text;
BEGIN
  SELECT s.status INTO v_status
    FROM public."HORA_EXTRA_SOLICITACAO" s WHERE s.id = OLD.solicitacao_id;
  IF v_status <> 'aguardando_liberacao' AND
     (NEW.percentual_previsto IS DISTINCT FROM OLD.percentual_previsto OR
      NEW.chamado_id IS DISTINCT FROM OLD.chamado_id) THEN
    RAISE EXCEPTION 'Os chamados e percentuais previstos não podem ser alterados após a liberação.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hora_extra_chamado_guard ON public."HORA_EXTRA_CHAMADO";
CREATE TRIGGER trg_hora_extra_chamado_guard
  BEFORE UPDATE ON public."HORA_EXTRA_CHAMADO"
  FOR EACH ROW EXECUTE FUNCTION public.hora_extra_chamado_guard();

-- 4) RPCs transacionais de escrita e consulta -------------------------
DROP FUNCTION IF EXISTS public.hora_extra_checar_chamado(uuid, uuid);
CREATE OR REPLACE FUNCTION public.hora_extra_checar_chamado(
  p_chamado uuid,
  p_colaborador uuid,
  p_aceitar_concluido_desde date DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_chamado record;
  v_responsavel text;
BEGIN
  SELECT
    c.id,
    c.numero,
    c.status,
    c.responsavel_id,
    c.concluido_em
  INTO v_chamado
  FROM public."CHAMADO_SISTEMA" c
  WHERE c.id = p_chamado;

  IF v_chamado.id IS NULL
  OR (
    v_chamado.status NOT IN ('aberto', 'em_andamento', 'aguardando_retorno')
    AND NOT (
      p_aceitar_concluido_desde IS NOT NULL
      AND v_chamado.status = 'concluido'
      AND v_chamado.concluido_em >= p_aceitar_concluido_desde
    )
  ) THEN
    RAISE EXCEPTION 'O chamado % não está em aberto.', coalesce(v_chamado.numero, p_chamado::text);
  END IF;

  IF v_chamado.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'O chamado % ainda não foi designado. Designe pelo Painel de Distribuição antes de incluir na HE.', v_chamado.numero;
  END IF;

  IF v_chamado.responsavel_id <> p_colaborador THEN
    SELECT coalesce(p.display_name, 'Usuário não identificado')
    INTO v_responsavel
    FROM public.profiles p
    WHERE p.id = v_chamado.responsavel_id;

    RAISE EXCEPTION 'O chamado % já foi designado a outro usuário: %', v_chamado.numero, v_responsavel;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_salvar(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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
  v_inicio time;
  v_fim time;
  v_inicio_min int;
  v_fim_min int;
  v_total int;
  v_soma numeric;
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

  SELECT coalesce(sum((x->>'percentual_previsto')::numeric), 0)
  INTO v_soma
  FROM jsonb_array_elements(coalesce(p->'chamados', '[]'::jsonb)) x;

  IF v_soma <> 100 THEN
    RAISE EXCEPTION 'A expectativa de conclusão deve totalizar 100%%.';
  END IF;

  v_inicio := (p->>'he_inicio_previsto')::time;
  v_fim := (p->>'he_fim_previsto')::time;

  IF v_inicio = v_fim THEN
    RAISE EXCEPTION 'O início e o término da HE não podem ser iguais.';
  END IF;

  IF NOT (
    v_inicio >= (p->>'ponto_saida')::time
    OR v_fim <= (p->>'ponto_entrada')::time
  ) THEN
    RAISE EXCEPTION 'O horário da HE deve ficar fora da jornada informada.';
  END IF;

  v_inicio_min := extract(epoch FROM v_inicio)::int / 60;
  v_fim_min := extract(epoch FROM v_fim)::int / 60;

  IF v_fim_min < v_inicio_min THEN
    v_fim_min := v_fim_min + 1440;
  END IF;

  v_total := v_fim_min - v_inicio_min;

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
          WHEN s.he_fim_previsto < s.he_inicio_previsto
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
      ponto_entrada = (p->>'ponto_entrada')::time,
      ponto_saida_intervalo = (p->>'ponto_saida_intervalo')::time,
      ponto_retorno_intervalo = (p->>'ponto_retorno_intervalo')::time,
      ponto_saida = (p->>'ponto_saida')::time,
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
      (p->>'ponto_entrada')::time,
      (p->>'ponto_saida_intervalo')::time,
      (p->>'ponto_retorno_intervalo')::time,
      (p->>'ponto_saida')::time,
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
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_liberar(
  p_id uuid,
  p_aprovar boolean,
  p_motivo text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
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

  IF v_s.colaborador_id = v_uid THEN
    RAISE EXCEPTION 'Você não pode liberar a própria solicitação.';
  END IF;

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
    CASE WHEN p_aprovar THEN 'Solicitação liberada' ELSE btrim(p_motivo) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_concluir(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid;
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_item jsonb;
  v_chamado record;
  v_inicio time;
  v_fim time;
  v_i int;
  v_f int;
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

  v_inicio := (p->>'he_inicio_real')::time;
  v_fim := (p->>'he_fim_real')::time;

  IF v_inicio = v_fim THEN
    RAISE EXCEPTION 'O início e o término da HE não podem ser iguais.';
  END IF;

  v_i := extract(epoch FROM v_inicio)::int / 60;
  v_f := extract(epoch FROM v_fim)::int / 60;

  IF v_f < v_i THEN
    v_f := v_f + 1440;
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    ponto_entrada_real = (p->>'ponto_entrada_real')::time,
    ponto_saida_intervalo_real = (p->>'ponto_saida_intervalo_real')::time,
    ponto_retorno_intervalo_real = (p->>'ponto_retorno_intervalo_real')::time,
    ponto_saida_real = (p->>'ponto_saida_real')::time,
    he_inicio_real = v_inicio,
    he_fim_real = v_fim,
    total_real_min = v_f - v_i,
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
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_validar(
  p_id uuid,
  p_aprovar boolean,
  p_motivo text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para validar.';
  END IF;

  SELECT status
  INTO v_status
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL OR v_status <> 'aguardando_validacao' THEN
    RAISE EXCEPTION 'A solicitação não aguarda validação.';
  END IF;

  IF NOT p_aprovar AND nullif(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da devolução.';
  END IF;

  UPDATE public."HORA_EXTRA_SOLICITACAO"
  SET
    status = CASE WHEN p_aprovar THEN 'concluida' ELSE 'aprovada' END,
    validado_por = CASE WHEN p_aprovar THEN v_uid END,
    validado_em = CASE WHEN p_aprovar THEN now() END,
    motivo_devolucao = CASE WHEN p_aprovar THEN NULL ELSE btrim(p_motivo) END
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
    CASE WHEN p_aprovar THEN 'validada' ELSE 'devolvida' END,
    CASE WHEN p_aprovar THEN 'Conclusão validada' ELSE btrim(p_motivo) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s public."HORA_EXTRA_SOLICITACAO"%ROWTYPE;
  v_aprovar boolean;
BEGIN
  SELECT *
  INTO v_s
  FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = p_id
  FOR UPDATE;

  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'Solicitação não encontrada.';
  END IF;

  v_aprovar := public.has_screen_access(v_uid, 'sistemas_hora_extra', 'aprovar');

  IF v_aprovar THEN
    IF v_s.status = 'concluida' THEN
      RAISE EXCEPTION 'Uma HE concluída não pode ser excluída.';
    END IF;
  ELSE
    IF NOT public.has_screen_access(v_uid, 'sistemas_hora_extra', 'excluir')
    OR v_s.colaborador_id <> v_uid
    OR v_s.status NOT IN ('aguardando_liberacao', 'reprovada') THEN
      RAISE EXCEPTION 'Você não pode excluir esta solicitação.';
    END IF;
  END IF;

  INSERT INTO public."HORA_EXTRA_EVENTO" (
    solicitacao_id,
    autor_id,
    acao,
    texto,
    meta
  )
  VALUES (
    p_id,
    v_uid,
    'excluida',
    'Solicitação excluída',
    jsonb_build_object('numero', v_s.numero)
  );

  DELETE FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_colaboradores()
RETURNS TABLE (
  id uuid,
  nome text,
  cargo text,
  setor text,
  empresa text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT
    p.id,
    coalesce(e."Nome", p.display_name),
    e."Título do Cargo",
    e."Setor_ERP",
    e."Nome da Empresa"
  FROM public.profiles p
  LEFT JOIN public."EMPREGADOS" e ON e.auth_user_id = p.id
  WHERE public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar')
    AND p.ativo = true
    AND (
      p.id = auth.uid()
      OR public.has_screen_access(p.id, 'chamados_sistemas_dev', 'visualizar')
      OR public.has_screen_access(p.id, 'sistemas_hora_extra', 'incluir')
    )
  ORDER BY 2;
$$;

DROP FUNCTION IF EXISTS public.hora_extra_chamados_disponiveis(uuid);
CREATE OR REPLACE FUNCTION public.hora_extra_chamados_disponiveis(
  p_colaborador uuid DEFAULT auth.uid(),
  p_concluidos_desde date DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  numero text,
  assunto text,
  prioridade text,
  setor text,
  responsavel_id uuid,
  responsavel_nome text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    c.numero,
    c.assunto,
    c.prioridade,
    c.setor,
    c.responsavel_id,
    p.display_name
  FROM public."CHAMADO_SISTEMA" c
  LEFT JOIN public.profiles p ON p.id = c.responsavel_id
  WHERE (
      c.status IN ('aberto', 'em_andamento', 'aguardando_retorno')
      OR (
        p_concluidos_desde IS NOT NULL
        AND c.status = 'concluido'
        AND c.concluido_em >= p_concluidos_desde
      )
    )
    AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
    AND (
      public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar')
      OR c.responsavel_id = auth.uid()
    )
  ORDER BY
    (c.responsavel_id = p_colaborador) DESC,
    c.numero DESC;
$$;

CREATE OR REPLACE FUNCTION public.hora_extra_stats(
  p_inicio date,
  p_fim date
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH parametros AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje_sp
  ),
  periodo AS (
    SELECT s.*
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.data_he BETWEEN p_inicio AND p_fim
      AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
      AND (
        s.colaborador_id = auth.uid()
        OR public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar')
      )
  ),
  anterior AS (
    SELECT count(*)::numeric AS total
    FROM public."HORA_EXTRA_SOLICITACAO" s
    WHERE s.data_he BETWEEN (p_inicio - (p_fim - p_inicio + 1)) AND (p_inicio - 1)
      AND public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'visualizar')
      AND (
        s.colaborador_id = auth.uid()
        OR public.has_screen_access(auth.uid(), 'sistemas_hora_extra', 'aprovar')
      )
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'aguardando_liberacao', count(*) FILTER (
      WHERE status = 'aguardando_liberacao'
    ),
    'aguardando_validacao', count(*) FILTER (
      WHERE status = 'aguardando_validacao'
    ),
    'aprovadas', count(*) FILTER (
      WHERE status = 'aguardando_validacao'
        OR (status = 'aprovada' AND data_he >= parametros.hoje_sp)
    ),
    'liberadas', count(*) FILTER (
      WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
    ),
    'pendentes_conclusao', count(*) FILTER (
      WHERE status = 'aprovada'
        AND data_he < parametros.hoje_sp
    ),
    'concluidas', count(*) FILTER (
      WHERE status = 'concluida'
    ),
    'reprovadas', count(*) FILTER (
      WHERE status = 'reprovada'
    ),
    'total_minutos', coalesce(sum(total_previsto_min), 0),
    'media_minutos', coalesce(round(avg(total_previsto_min)), 0),
    'horas_aprovadas_min', coalesce(
      sum(total_previsto_min) FILTER (
        WHERE status IN ('aprovada', 'aguardando_validacao', 'concluida')
      ),
      0
    ),
    'variacao', CASE
      WHEN (SELECT total FROM anterior) = 0 THEN 0
      ELSE round(
        (count(*) - (SELECT total FROM anterior)) * 100 / (SELECT total FROM anterior),
        1
      )
    END
  )
  FROM periodo
  CROSS JOIN parametros;
$$;

-- Privilégios das RPCs: nunca ficam disponíveis a anon/PUBLIC.
REVOKE ALL ON FUNCTION public.hora_extra_checar_chamado(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hora_extra_salvar(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_liberar(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_concluir(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_validar(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_excluir(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_colaboradores() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_chamados_disponiveis(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hora_extra_stats(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hora_extra_salvar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_liberar(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_concluir(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_validar(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_excluir(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_colaboradores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_chamados_disponiveis(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hora_extra_stats(date, date) TO authenticated;

-- 5) RLS de leitura ----------------------------------------------------
ALTER TABLE public."HORA_EXTRA_SOLICITACAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HORA_EXTRA_CHAMADO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HORA_EXTRA_ANEXO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HORA_EXTRA_EVENTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hora_extra_solicitacao_select ON public."HORA_EXTRA_SOLICITACAO";
CREATE POLICY hora_extra_solicitacao_select ON public."HORA_EXTRA_SOLICITACAO" FOR SELECT TO authenticated
USING (colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'));

DROP POLICY IF EXISTS hora_extra_chamado_select ON public."HORA_EXTRA_CHAMADO";
CREATE POLICY hora_extra_chamado_select ON public."HORA_EXTRA_CHAMADO" FOR SELECT TO authenticated USING(EXISTS(
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE public."HORA_EXTRA_SOLICITACAO".id="HORA_EXTRA_CHAMADO".solicitacao_id
    AND (public."HORA_EXTRA_SOLICITACAO".colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));

DROP POLICY IF EXISTS hora_extra_anexo_select ON public."HORA_EXTRA_ANEXO";
CREATE POLICY hora_extra_anexo_select ON public."HORA_EXTRA_ANEXO" FOR SELECT TO authenticated USING(EXISTS(
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE public."HORA_EXTRA_SOLICITACAO".id="HORA_EXTRA_ANEXO".solicitacao_id
    AND (public."HORA_EXTRA_SOLICITACAO".colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));
DROP POLICY IF EXISTS hora_extra_anexo_insert ON public."HORA_EXTRA_ANEXO";
CREATE POLICY hora_extra_anexo_insert ON public."HORA_EXTRA_ANEXO" FOR INSERT TO authenticated WITH CHECK(
  autor_id=auth.uid() AND EXISTS(SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE public."HORA_EXTRA_SOLICITACAO".id="HORA_EXTRA_ANEXO".solicitacao_id
    AND (public."HORA_EXTRA_SOLICITACAO".colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));

DROP POLICY IF EXISTS hora_extra_evento_select ON public."HORA_EXTRA_EVENTO";
CREATE POLICY hora_extra_evento_select ON public."HORA_EXTRA_EVENTO" FOR SELECT TO authenticated USING(EXISTS(
  SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO"
  WHERE public."HORA_EXTRA_SOLICITACAO".id="HORA_EXTRA_EVENTO".solicitacao_id
    AND (public."HORA_EXTRA_SOLICITACAO".colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));

-- 6) Storage privado ---------------------------------------------------
INSERT INTO storage.buckets(id,name,public,file_size_limit)
VALUES('hora-extra','hora-extra',false,10485760) -- 10 MB
ON CONFLICT(id) DO NOTHING;

DROP POLICY IF EXISTS "hora extra anexos select" ON storage.objects;
CREATE POLICY "hora extra anexos select" ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='hora-extra' AND EXISTS(SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
  WHERE s.id=(storage.foldername(name))[1]::uuid
    AND (s.colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));
DROP POLICY IF EXISTS "hora extra anexos insert" ON storage.objects;
CREATE POLICY "hora extra anexos insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='hora-extra' AND EXISTS(SELECT 1 FROM public."HORA_EXTRA_SOLICITACAO" s
  WHERE s.id=(storage.foldername(name))[1]::uuid
    AND (s.colaborador_id=auth.uid() OR public.has_screen_access(auth.uid(),'sistemas_hora_extra','aprovar'))));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (executar manualmente, se necessário)
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('sistemas_hora_extra','sistemas_hora_extra_liberacao');
--   DELETE FROM public.app_menu_acao WHERE menu_codigo IN ('sistemas_hora_extra','sistemas_hora_extra_liberacao');
--   DELETE FROM public.app_menu WHERE codigo IN ('sistemas_hora_extra','sistemas_hora_extra_liberacao');
--   DROP POLICY IF EXISTS "hora extra anexos insert" ON storage.objects;
--   DROP POLICY IF EXISTS "hora extra anexos select" ON storage.objects;
--   DELETE FROM storage.buckets WHERE id='hora-extra';
--   DROP TABLE IF EXISTS public."HORA_EXTRA_EVENTO", public."HORA_EXTRA_ANEXO", public."HORA_EXTRA_CHAMADO", public."HORA_EXTRA_SOLICITACAO" CASCADE;
--   DROP FUNCTION IF EXISTS public.hora_extra_stats(date, date),
--     public.hora_extra_chamados_disponiveis(uuid, date),
--     public.hora_extra_colaboradores(),
--     public.hora_extra_excluir(uuid),
--     public.hora_extra_validar(uuid, boolean, text),
--     public.hora_extra_concluir(jsonb),
--     public.hora_extra_liberar(uuid, boolean, text),
--     public.hora_extra_salvar(jsonb),
--     public.hora_extra_checar_chamado(uuid, uuid, date),
--     public.hora_extra_chamado_guard(),
--     public.gerar_numero_hora_extra();
--   DROP SEQUENCE IF EXISTS public.hora_extra_numero_seq;
-- =====================================================================
