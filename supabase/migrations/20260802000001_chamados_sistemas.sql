-- =====================================================================
-- CHAMADOS DE SISTEMAS — help desk leve do módulo Sistemas.
-- Qualquer usuário logado abre um chamado (setor/nome puxados de EMPREGADOS
-- via meu_empregado). O Gerente de Sistemas distribui para um Desenvolvedor
-- com fila de tarefas priorizadas; o dev executa e conclui. Histórico + push.
--
-- Permissão por usuário (mesma base de Solicitações ERP): app_menu +
-- screen_permission_user + tem_acesso_menu(). Abrir/ver os PRÓPRIOS chamados
-- é aberto a todos (menu com rota mas sem permissão configurada = visível);
-- a GESTÃO é restrita pelos códigos de rota, que também valem como capacidade:
--   chamados_sistemas_painel → Gerente de Sistemas (coordena/distribui/reprova)
--   chamados_sistemas_dev    → Desenvolvedor (executa tarefas)
-- Esses dois entram em MENUS_SEMPRE_RESTRITOS (front) p/ ficarem ocultos até
-- serem liberados em "Acesso por Usuário".
-- =====================================================================

-- 1) Menus / permissões -------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('chamados_sistemas',        'Chamados de Sistemas',                 '/app/sistemas/chamados',        15),
    ('chamados_sistemas_painel', 'Chamados — Painel de Distribuição',    '/app/sistemas/chamados/painel', 16),
    ('chamados_sistemas_dev',    'Chamados — Painel do Desenvolvedor',   '/app/sistemas/chamados/dev',    17)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Mirror do "abrir/meus chamados" no menu da Central de Serviços (mesma tela).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'central_servicos_chamados', 'Chamados de Sistemas', '/app/central-servicos/chamados', 60
  FROM public.app_modulo m WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) Tabelas ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chamado_sistema (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero               text,
  assunto              text NOT NULL,
  categorias           text[] NOT NULL DEFAULT '{}',
  tipo_solicitacao     text,      -- ajuste | correcao | melhoria | duvida | outro
  prioridade           text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  descricao            text,
  impacto_trabalho     text,      -- impede | atraso_significativo | atraso_leve | nao_impacta
  urgencia             text,      -- ate_1h | ate_1d | ate_3d | ate_5d | mais_5d
  modulo_sistema       text,      -- código do módulo do ERP ou 'outro'
  modulo_sistema_outro text,
  ambiente             text NOT NULL DEFAULT 'producao',  -- producao | homologacao | teste
  afeta_usuarios       integer,
  solicitante_id       uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  solicitante_nome     text,
  setor                text,
  status               text NOT NULL DEFAULT 'aberto'
                         CHECK (status IN ('aberto','em_andamento','aguardando_retorno','concluido','reprovado')),
  responsavel_id       uuid REFERENCES auth.users(id),
  prazo_previsto       date,
  observacao_gerente   text,
  comentario_gerente   text,
  motivo_reprovacao    text,
  concluido_em         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_solicitante ON public.chamado_sistema(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_responsavel ON public.chamado_sistema(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_status      ON public.chamado_sistema(status);

CREATE TABLE IF NOT EXISTS public.chamado_sistema_tarefa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id     uuid NOT NULL REFERENCES public.chamado_sistema(id) ON DELETE CASCADE,
  ordem          integer NOT NULL DEFAULT 1,
  titulo         text NOT NULL,
  descricao      text,
  prioridade     text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  status         text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','em_andamento','aguardando_informacoes','concluida')),
  responsavel_id uuid REFERENCES auth.users(id),
  prazo          date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_tarefa_chamado     ON public.chamado_sistema_tarefa(chamado_id);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_tarefa_responsavel ON public.chamado_sistema_tarefa(responsavel_id);

CREATE TABLE IF NOT EXISTS public.chamado_sistema_anexo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id    uuid NOT NULL REFERENCES public.chamado_sistema(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  nome_arquivo  text NOT NULL,
  mime_type     text,
  tamanho_bytes bigint,
  campo         text NOT NULL DEFAULT 'abertura',  -- abertura | interno
  autor_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_anexo_chamado ON public.chamado_sistema_anexo(chamado_id);

CREATE TABLE IF NOT EXISTS public.chamado_sistema_evento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id  uuid NOT NULL REFERENCES public.chamado_sistema(id) ON DELETE CASCADE,
  autor_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  tipo        text NOT NULL DEFAULT 'evento',  -- evento | comentario | observacao_interna | solicitar_info
  texto       text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_evento_chamado ON public.chamado_sistema_evento(chamado_id);

-- 3) Numeração automática (SIS-AAAA-0000) -------------------------------
CREATE SEQUENCE IF NOT EXISTS public.chamado_sistema_numero_seq;

CREATE OR REPLACE FUNCTION public.gerar_numero_chamado_sistema()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'SIS-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.chamado_sistema_numero_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_numero ON public.chamado_sistema;
CREATE TRIGGER trg_chamado_sistema_numero
  BEFORE INSERT ON public.chamado_sistema
  FOR EACH ROW EXECUTE FUNCTION public.gerar_numero_chamado_sistema();

-- Evento de abertura gravado por trigger (SECURITY DEFINER): a RLS de
-- chamado_sistema_evento não deixa o solicitante inserir tipo 'evento', então
-- o registro de "Chamado aberto" é criado aqui, no servidor.
CREATE OR REPLACE FUNCTION public.chamado_sistema_evento_abertura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.chamado_sistema_evento (chamado_id, autor_id, tipo, texto)
  VALUES (NEW.id, NEW.solicitante_id, 'evento', 'Chamado aberto');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_abertura ON public.chamado_sistema;
CREATE TRIGGER trg_chamado_sistema_abertura
  AFTER INSERT ON public.chamado_sistema
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_evento_abertura();

-- 4) Guard de UPDATE: quem NÃO é gerente (o dev responsável) só mexe em
--    status/prazo/motivo; nunca em campos de abertura ou de gestão. -------
CREATE OR REPLACE FUNCTION public.chamado_sistema_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_gerente boolean := public.tem_acesso_menu('chamados_sistemas_painel');
BEGIN
  IF NOT v_gerente THEN
    IF NEW.assunto              IS DISTINCT FROM OLD.assunto
    OR NEW.categorias           IS DISTINCT FROM OLD.categorias
    OR NEW.tipo_solicitacao     IS DISTINCT FROM OLD.tipo_solicitacao
    OR NEW.prioridade           IS DISTINCT FROM OLD.prioridade
    OR NEW.descricao            IS DISTINCT FROM OLD.descricao
    OR NEW.impacto_trabalho     IS DISTINCT FROM OLD.impacto_trabalho
    OR NEW.urgencia             IS DISTINCT FROM OLD.urgencia
    OR NEW.modulo_sistema       IS DISTINCT FROM OLD.modulo_sistema
    OR NEW.modulo_sistema_outro IS DISTINCT FROM OLD.modulo_sistema_outro
    OR NEW.afeta_usuarios       IS DISTINCT FROM OLD.afeta_usuarios
    OR NEW.solicitante_id       IS DISTINCT FROM OLD.solicitante_id
    OR NEW.solicitante_nome     IS DISTINCT FROM OLD.solicitante_nome
    OR NEW.setor                IS DISTINCT FROM OLD.setor
    OR NEW.responsavel_id       IS DISTINCT FROM OLD.responsavel_id
    OR NEW.observacao_gerente   IS DISTINCT FROM OLD.observacao_gerente
    OR NEW.comentario_gerente   IS DISTINCT FROM OLD.comentario_gerente THEN
      RAISE EXCEPTION 'Sem permissão para alterar estes campos do chamado.';
    END IF;
  END IF;

  -- concluido_em coerente com o status.
  IF NEW.status = 'concluido' AND NEW.concluido_em IS NULL THEN NEW.concluido_em := now(); END IF;
  IF NEW.status <> 'concluido' THEN NEW.concluido_em := NULL; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_guard ON public.chamado_sistema;
CREATE TRIGGER trg_chamado_sistema_guard
  BEFORE UPDATE ON public.chamado_sistema
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_guard();

DROP TRIGGER IF EXISTS trg_chamado_sistema_updated ON public.chamado_sistema;
CREATE TRIGGER trg_chamado_sistema_updated
  BEFORE UPDATE ON public.chamado_sistema
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tarefa: dev só muda o status da própria; gerente muda tudo.
CREATE OR REPLACE FUNCTION public.chamado_sistema_tarefa_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_gerente boolean := public.tem_acesso_menu('chamados_sistemas_painel');
BEGIN
  IF NOT v_gerente THEN
    IF NEW.titulo      IS DISTINCT FROM OLD.titulo
    OR NEW.descricao   IS DISTINCT FROM OLD.descricao
    OR NEW.prioridade  IS DISTINCT FROM OLD.prioridade
    OR NEW.ordem       IS DISTINCT FROM OLD.ordem
    OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
    OR NEW.prazo       IS DISTINCT FROM OLD.prazo THEN
      RAISE EXCEPTION 'Sem permissão para alterar esta tarefa (apenas o status).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_sistema_tarefa_guard ON public.chamado_sistema_tarefa;
CREATE TRIGGER trg_chamado_sistema_tarefa_guard
  BEFORE UPDATE ON public.chamado_sistema_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_tarefa_guard();

DROP TRIGGER IF EXISTS trg_chamado_sistema_tarefa_updated ON public.chamado_sistema_tarefa;
CREATE TRIGGER trg_chamado_sistema_tarefa_updated
  BEFORE UPDATE ON public.chamado_sistema_tarefa
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) RLS ----------------------------------------------------------------
ALTER TABLE public.chamado_sistema        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_sistema_tarefa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_sistema_anexo  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chamado_sistema_evento ENABLE ROW LEVEL SECURITY;

-- chamado_sistema
DROP POLICY IF EXISTS chamado_sistema_select ON public.chamado_sistema;
CREATE POLICY chamado_sistema_select ON public.chamado_sistema
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR responsavel_id = auth.uid()
    OR public.tem_acesso_menu('chamados_sistemas_painel')
    OR EXISTS (SELECT 1 FROM public.chamado_sistema_tarefa t
               WHERE t.chamado_id = chamado_sistema.id AND t.responsavel_id = auth.uid())
  );

DROP POLICY IF EXISTS chamado_sistema_insert ON public.chamado_sistema;
CREATE POLICY chamado_sistema_insert ON public.chamado_sistema
  FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid() AND status = 'aberto' AND responsavel_id IS NULL);

DROP POLICY IF EXISTS chamado_sistema_update ON public.chamado_sistema;
CREATE POLICY chamado_sistema_update ON public.chamado_sistema
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

-- chamado_sistema_tarefa
DROP POLICY IF EXISTS chamado_sistema_tarefa_select ON public.chamado_sistema_tarefa;
CREATE POLICY chamado_sistema_tarefa_select ON public.chamado_sistema_tarefa
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_insert ON public.chamado_sistema_tarefa;
CREATE POLICY chamado_sistema_tarefa_insert ON public.chamado_sistema_tarefa
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel'));

DROP POLICY IF EXISTS chamado_sistema_tarefa_update ON public.chamado_sistema_tarefa;
CREATE POLICY chamado_sistema_tarefa_update ON public.chamado_sistema_tarefa
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid())
  WITH CHECK (public.tem_acesso_menu('chamados_sistemas_painel') OR responsavel_id = auth.uid());

DROP POLICY IF EXISTS chamado_sistema_tarefa_delete ON public.chamado_sistema_tarefa;
CREATE POLICY chamado_sistema_tarefa_delete ON public.chamado_sistema_tarefa
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_painel'));

-- chamado_sistema_anexo
DROP POLICY IF EXISTS chamado_sistema_anexo_select ON public.chamado_sistema_anexo;
CREATE POLICY chamado_sistema_anexo_select ON public.chamado_sistema_anexo
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chamado_sistema c WHERE c.id = chamado_id
                 AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
                      OR public.tem_acesso_menu('chamados_sistemas_painel'))));

DROP POLICY IF EXISTS chamado_sistema_anexo_insert ON public.chamado_sistema_anexo;
CREATE POLICY chamado_sistema_anexo_insert ON public.chamado_sistema_anexo
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.chamado_sistema c WHERE c.id = chamado_id
    AND (c.solicitante_id = auth.uid() OR c.responsavel_id = auth.uid()
         OR public.tem_acesso_menu('chamados_sistemas_painel'))));

-- chamado_sistema_evento
DROP POLICY IF EXISTS chamado_sistema_evento_select ON public.chamado_sistema_evento;
CREATE POLICY chamado_sistema_evento_select ON public.chamado_sistema_evento
  FOR SELECT TO authenticated
  USING (
    public.tem_acesso_menu('chamados_sistemas_painel')
    OR EXISTS (SELECT 1 FROM public.chamado_sistema c WHERE c.id = chamado_id
               AND (c.responsavel_id = auth.uid()
                    OR (c.solicitante_id = auth.uid() AND tipo <> 'observacao_interna')))
  );

DROP POLICY IF EXISTS chamado_sistema_evento_insert ON public.chamado_sistema_evento;
CREATE POLICY chamado_sistema_evento_insert ON public.chamado_sistema_evento
  FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.chamado_sistema c WHERE c.id = chamado_id
    AND (public.tem_acesso_menu('chamados_sistemas_painel')
         OR c.responsavel_id = auth.uid()
         OR (c.solicitante_id = auth.uid() AND tipo IN ('comentario')))));

-- 6) Storage bucket -----------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chamados-sistemas', 'chamados-sistemas', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chamados sistemas anexo select" ON storage.objects;
CREATE POLICY "chamados sistemas anexo select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chamados-sistemas');

DROP POLICY IF EXISTS "chamados sistemas anexo insert" ON storage.objects;
CREATE POLICY "chamados sistemas anexo insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chamados-sistemas');

-- 7) RPCs ---------------------------------------------------------------
-- Estatísticas do solicitante (para os cards de "Meus chamados").
CREATE OR REPLACE FUNCTION public.chamados_meus_stats()
RETURNS TABLE(meus int, concluidos int, em_atendimento int, aguardando_acao int, tempo_medio numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'concluido')::int,
    count(*) FILTER (WHERE status IN ('aberto','em_andamento'))::int,
    count(*) FILTER (WHERE status = 'aguardando_retorno')::int,
    round((avg(extract(epoch FROM (concluido_em - created_at)) / 86400.0)
           FILTER (WHERE concluido_em IS NOT NULL))::numeric, 1)
  FROM public.chamado_sistema
  WHERE solicitante_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.chamados_meus_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_meus_stats() TO authenticated;

-- Estatísticas do painel do gerente (0 se não for gerente).
CREATE OR REPLACE FUNCTION public.chamados_painel_stats()
RETURNS TABLE(total int, abertos int, em_andamento int, concluidos_mes int, atrasados int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE status = 'aberto')::int,
    count(*) FILTER (WHERE status = 'em_andamento')::int,
    count(*) FILTER (WHERE status = 'concluido'
                     AND concluido_em >= date_trunc('month', now()))::int,
    count(*) FILTER (WHERE prazo_previsto < current_date
                     AND status NOT IN ('concluido','reprovado'))::int
  FROM public.chamado_sistema
  WHERE public.tem_acesso_menu('chamados_sistemas_painel');
$$;
REVOKE ALL ON FUNCTION public.chamados_painel_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chamados_painel_stats() TO authenticated;

-- Desenvolvedores (quem tem chamados_sistemas_dev liberado por usuário) +
-- contagem de carga. Só devolve algo para o gerente.
CREATE OR REPLACE FUNCTION public.listar_desenvolvedores_chamados()
RETURNS TABLE(id uuid, display_name text, em_andamento int, abertos int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.display_name,
    (SELECT count(*) FROM public.chamado_sistema c
       WHERE c.responsavel_id = p.id AND c.status = 'em_andamento')::int,
    (SELECT count(*) FROM public.chamado_sistema c
       WHERE c.responsavel_id = p.id
         AND c.status IN ('aberto','em_andamento','aguardando_retorno'))::int
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.tem_acesso_menu('chamados_sistemas_painel')
    AND EXISTS (SELECT 1 FROM public.screen_permission_user s
                WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_dev'
                  AND s.acao = 'visualizar'::public.app_acao AND s.allow = true
                  AND s.empresa_id IS NULL)
  ORDER BY p.display_name;
$$;
REVOKE ALL ON FUNCTION public.listar_desenvolvedores_chamados() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_desenvolvedores_chamados() TO authenticated;

NOTIFY pgrst, 'reload schema';
