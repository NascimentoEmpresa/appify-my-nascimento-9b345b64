-- =========================================================================
-- Orientações Jurídicas: a pergunta do ENCARREGADO passa primeiro pelo
-- Operacional, e a pergunta pode ser OCULTADA da biblioteca
--
-- CHAMADO (25/09/2026, Pablo)
--   • "Opção para poder selecionar e ocultar uma pergunta e somente os
--     responsáveis poderem visualizar."
--   • "Quando a solicitação de orientação vier por parte do encarregado, a
--     orientação deverá ser direcionada primeiro para o supervisor do
--     contrato; caso ele não souber orientar, ele redireciona a solicitação
--     para o setor jurídico." — no Operacional, submódulo Orientações
--     Jurídicas: o Operacional RESPONDE direto ao encarregado ou APROVA e
--     ENCAMINHA ao Jurídico.
--
-- FLUXO
--   Encarregados › Orientações Jurídicas (origem 'encarregados')
--     → 'Pendente Operacional' ─┬─ Operacional responde → 'Respondida'
--                               │    (respondido_etapa 'operacional'; NÃO
--                               │    entra na biblioteca do Jurídico)
--                               └─ Operacional encaminha → 'Aprovada'
--                                    (fila do Jurídico responder, como hoje)
--   Central de Serviços (origem 'central') continua 'Aberta' → aprovação →
--   Jurídico, sem mudança.
--   O status inicial é do BANCO (gatilho), não da tela: pela origem.
--
-- OCULTAR
--   publicada = false (a coluna já existia: "aparece na biblioteca") +
--   carimbo ocultada_por/ocultada_em. Oculta, a pergunta some da biblioteca
--   e só a veem os RESPONSÁVEIS: quem perguntou, o Jurídico (duvidas:
--   aprovar/responder/alterar, ou setor JURIDICO) e — nas que vieram de
--   encarregado — o Operacional. Quem oculta: esses mesmos responsáveis
--   (RPC jur_duvida_ocultar); quem pergunta também pode marcar a pergunta
--   como reservada ao enviar.
--
-- MENU NOVO operacional_orientacoes (/app/operacional/orientacoes-juridicas),
--   módulo Operacional. J2: nasce com dono — quem já vê as Solicitações de
--   Demissão do Operacional (os supervisores) ganha visualizar, pelo mesmo
--   caminho (perfil ou exceção individual).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public."JUR_DUVIDAS"
  ADD COLUMN IF NOT EXISTS origem            text NOT NULL DEFAULT 'central',
  ADD COLUMN IF NOT EXISTS operacional_por   text,
  ADD COLUMN IF NOT EXISTS operacional_em    timestamptz,
  ADD COLUMN IF NOT EXISTS operacional_acao  text,
  ADD COLUMN IF NOT EXISTS operacional_obs   text,
  ADD COLUMN IF NOT EXISTS respondido_etapa  text,
  ADD COLUMN IF NOT EXISTS ocultada_por      text,
  ADD COLUMN IF NOT EXISTS ocultada_em       timestamptz;

COMMENT ON COLUMN public."JUR_DUVIDAS".origem IS
  'De onde veio a pergunta: encarregados (passa pelo Operacional) | central (aprovação → Jurídico). Mig 244, 25/09/2026.';
COMMENT ON COLUMN public."JUR_DUVIDAS".respondido_etapa IS
  'Quem deu a resposta principal: juridico | operacional (mig 244).';

-- ── Menu do Operacional ──────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'operacional_orientacoes', 'Orientações Jurídicas', '/app/operacional/orientacoes-juridicas', 60
  FROM public.app_modulo m WHERE m.codigo = 'operacional'
ON CONFLICT (modulo_id, codigo) DO NOTHING;
UPDATE public.app_menu SET ativo = true WHERE codigo = 'operacional_orientacoes';

-- Quem vê as demissões do Operacional (supervisores) vê as orientações.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'operacional_orientacoes', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'operacional_demissoes' AND pp.acao = 'visualizar'::public.app_acao AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'operacional_orientacoes' AND x.acao = 'visualizar'::public.app_acao);

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'operacional_orientacoes', 'visualizar'::public.app_acao, true,
       'Migração 20260930000244: já via as Solicitações de Demissão do Operacional'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'operacional_demissoes' AND s.acao = 'visualizar'::public.app_acao AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'operacional_orientacoes' AND x.acao = 'visualizar'::public.app_acao);

-- ── Quem é "responsável" ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pode_orientar_operacional()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'operacional_orientacoes', 'visualizar'::public.app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.pode_orientar_operacional() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_orientar_operacional() TO authenticated;

-- Jurídico = quem trata dúvidas no Parecer Jurídico.
CREATE OR REPLACE FUNCTION public.e_juridico_das_duvidas()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.is_juridico_ativo()
      OR public.has_screen_access(auth.uid(), 'duvidas', 'aprovar'::public.app_acao)
      OR public.has_screen_access(auth.uid(), 'duvidas', 'responder'::public.app_acao)
      OR public.has_screen_access(auth.uid(), 'duvidas', 'alterar'::public.app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.e_juridico_das_duvidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e_juridico_das_duvidas() TO authenticated;

-- ── Leitura: público só o publicado; o resto, só os responsáveis ─────────
DROP POLICY IF EXISTS jur_duvidas_select ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_select ON public."JUR_DUVIDAS" FOR SELECT TO authenticated
  USING (
    publicada = true
    OR autor_id = auth.uid()
    OR public.e_juridico_das_duvidas()
    OR (origem = 'encarregados' AND public.pode_orientar_operacional())
  );

-- Complementos: o Operacional responde o fio das dúvidas que ELE respondeu.
DROP POLICY IF EXISTS jur_duvidas_compl_insert ON public."JUR_DUVIDAS_COMPLEMENTOS";
CREATE POLICY jur_duvidas_compl_insert ON public."JUR_DUVIDAS_COMPLEMENTOS" FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = auth.uid()
    AND (
      (tipo = 'pergunta' AND EXISTS (
         SELECT 1 FROM public."JUR_DUVIDAS" d
          WHERE d.id = "JUR_DUVIDAS_COMPLEMENTOS".duvida_id AND d.autor_id = auth.uid() AND d.status = 'Respondida'))
      OR (tipo = 'resposta' AND public.pode_responder_duvida())
      OR (tipo = 'resposta' AND public.pode_orientar_operacional() AND EXISTS (
         SELECT 1 FROM public."JUR_DUVIDAS" d
          WHERE d.id = "JUR_DUVIDAS_COMPLEMENTOS".duvida_id AND d.respondido_etapa = 'operacional'))
    )
  );

-- ── Status inicial pela origem ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvidas_status_inicial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.origem := CASE WHEN NEW.origem = 'encarregados' THEN 'encarregados' ELSE 'central' END;
  NEW.status := CASE WHEN NEW.origem = 'encarregados' THEN 'Pendente Operacional' ELSE 'Aberta' END;
  IF coalesce(NEW.publicada, true) = false THEN
    NEW.ocultada_por := coalesce(NEW.ocultada_por, NEW.autor_nome, 'quem perguntou');
    NEW.ocultada_em  := coalesce(NEW.ocultada_em, now());
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_duvidas_status_inicial ON public."JUR_DUVIDAS";
CREATE TRIGGER trg_jur_duvidas_status_inicial
  BEFORE INSERT ON public."JUR_DUVIDAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_duvidas_status_inicial();

-- ── O Operacional decide: responde ou encaminha ao Jurídico ──────────────
CREATE OR REPLACE FUNCTION public.jur_duvida_operacional_decidir(p_id bigint, p_acao text, p_texto text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d       record;
  v_nome  text;
  v_texto text := nullif(btrim(coalesce(p_texto, '')), '');
BEGIN
  IF NOT public.pode_orientar_operacional() THEN
    RAISE EXCEPTION 'Só o Operacional (Orientações Jurídicas) decide esta orientação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public."JUR_DUVIDAS" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Orientação #% não existe.', p_id; END IF;
  IF d.status <> 'Pendente Operacional' THEN
    RAISE EXCEPTION 'Esta orientação já saiu do Operacional (está %).', d.status;
  END IF;
  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();

  IF p_acao = 'responder' THEN
    IF length(coalesce(v_texto, '')) < 5 THEN RAISE EXCEPTION 'Escreva a orientação para o encarregado.'; END IF;
    UPDATE public."JUR_DUVIDAS"
       SET status = 'Respondida', resposta = v_texto, respondido_por = v_nome || ' (Operacional)',
           respondido_em = now(), respondido_etapa = 'operacional',
           -- Resposta do Operacional não é parecer do Jurídico: fica fora da biblioteca.
           publicada = false,
           operacional_por = v_nome, operacional_em = now(), operacional_acao = 'respondeu',
           updated_at = now()
     WHERE id = p_id;
  ELSIF p_acao = 'encaminhar' THEN
    UPDATE public."JUR_DUVIDAS"
       SET status = 'Aprovada', aprovado_por = v_nome || ' (Operacional)', aprovado_em = now(),
           operacional_por = v_nome, operacional_em = now(), operacional_acao = 'encaminhou',
           operacional_obs = v_texto, updated_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', p_acao;
  END IF;
  RETURN jsonb_build_object('id', p_id, 'acao', p_acao);
END $fn$;
REVOKE ALL ON FUNCTION public.jur_duvida_operacional_decidir(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_duvida_operacional_decidir(bigint, text, text) TO authenticated;

-- ── Ocultar / mostrar na biblioteca ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvida_ocultar(p_id bigint, p_ocultar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d      record;
  v_nome text;
BEGIN
  SELECT * INTO d FROM public."JUR_DUVIDAS" WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Dúvida #% não existe.', p_id; END IF;
  IF NOT (d.autor_id = auth.uid()
          OR public.e_juridico_das_duvidas()
          OR (d.origem = 'encarregados' AND public.pode_orientar_operacional())) THEN
    RAISE EXCEPTION 'Só quem perguntou ou os responsáveis pela orientação podem ocultá-la.' USING ERRCODE = '42501';
  END IF;
  -- Resposta do Operacional nunca vai pra biblioteca do Jurídico.
  IF NOT p_ocultar AND d.respondido_etapa = 'operacional' THEN
    RAISE EXCEPTION 'Orientação respondida pelo Operacional não entra na biblioteca do Jurídico.';
  END IF;
  SELECT coalesce(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  UPDATE public."JUR_DUVIDAS"
     SET publicada = NOT p_ocultar,
         ocultada_por = CASE WHEN p_ocultar THEN v_nome ELSE NULL END,
         ocultada_em  = CASE WHEN p_ocultar THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'publicada', NOT p_ocultar);
END $fn$;
REVOKE ALL ON FUNCTION public.jur_duvida_ocultar(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_duvida_ocultar(bigint, boolean) TO authenticated;

-- ── Sino ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvidas_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_link_gestao text := '/app/juridico/duvidas';
  v_link_op     text := '/app/operacional/orientacoes-juridicas';
  v_link_autor  text := CASE WHEN NEW.origem = 'encarregados' THEN '/app/encarregados/orientacoes-juridicas'
                             ELSE '/app/central-servicos/orientacoes-juridicas' END;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Pendente Operacional' THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('operacional_orientacoes', 'visualizar'),
        'Nova orientação jurídica de encarregado',
        coalesce(NEW.titulo, '') || ' — de ' || coalesce(NEW.autor_nome, '—') || coalesce(' · ' || NEW.categoria, ''),
        'info', v_link_op);
    ELSE
      PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'aprovar'),
        'Nova dúvida jurídica para aprovar',
        coalesce(NEW.titulo, '') || ' — de ' || coalesce(NEW.autor_nome, '—') || coalesce(' · ' || NEW.categoria, ''),
        'info', v_link_gestao);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Aprovada' THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'responder'),
        CASE WHEN OLD.status = 'Pendente Operacional' THEN 'Orientação encaminhada pelo Operacional — aguardando o Jurídico'
             ELSE 'Dúvida aprovada — aguardando resposta do Jurídico' END,
        coalesce(NEW.titulo, '') || coalesce(' · ' || NEW.categoria, '') || coalesce(' — obs.: ' || NEW.operacional_obs, ''),
        'warning', v_link_gestao);
    ELSIF NEW.status = 'Respondida' AND OLD.status <> 'Respondida' THEN
      PERFORM public.jur_notificar(ARRAY[NEW.autor_id],
        CASE WHEN NEW.respondido_etapa = 'operacional' THEN 'Sua dúvida foi respondida pelo Operacional'
             ELSE 'Sua dúvida foi respondida pelo Jurídico' END,
        coalesce(NEW.titulo, '') || ' — avalie a resposta em Minhas perguntas.',
        'success', v_link_autor);
    ELSIF NEW.status = 'Reprovada' THEN
      PERFORM public.jur_notificar(ARRAY[NEW.autor_id],
        'Sua dúvida não foi aprovada',
        coalesce(NEW.titulo, '') || coalesce(' — ' || NEW.motivo_reprovacao, ''),
        'error', v_link_autor);
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- Pergunta complementar vai pra quem respondeu (Operacional ou Jurídico).
CREATE OR REPLACE FUNCTION public.jur_duvidas_compl_notificar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  d record;
BEGIN
  SELECT titulo, autor_id, origem, respondido_etapa INTO d FROM public."JUR_DUVIDAS" WHERE id = NEW.duvida_id;
  IF NEW.tipo = 'pergunta' THEN
    IF d.respondido_etapa = 'operacional' THEN
      PERFORM public.jur_notificar(public.jur_quem_tem('operacional_orientacoes', 'visualizar'),
        'Pergunta complementar numa orientação respondida pelo Operacional',
        coalesce(d.titulo, '') || ': ' || NEW.texto,
        'warning', '/app/operacional/orientacoes-juridicas');
    ELSE
      PERFORM public.jur_notificar(public.jur_quem_tem('duvidas', 'responder'),
        'Pergunta complementar numa dúvida já respondida',
        coalesce(d.titulo, '') || ': ' || NEW.texto,
        'warning', '/app/juridico/duvidas');
    END IF;
  ELSE
    PERFORM public.jur_notificar(ARRAY[d.autor_id],
      CASE WHEN d.respondido_etapa = 'operacional' THEN 'O Operacional complementou a resposta da sua dúvida'
           ELSE 'O Jurídico complementou a resposta da sua dúvida' END,
      coalesce(d.titulo, '') || ': ' || NEW.texto,
      'success', CASE WHEN d.origem = 'encarregados' THEN '/app/encarregados/orientacoes-juridicas'
                      ELSE '/app/central-servicos/orientacoes-juridicas' END);
  END IF;
  RETURN NEW;
END $fn$;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- UPDATE public."JUR_DUVIDAS" SET status = 'Aberta' WHERE status = 'Pendente Operacional';
-- DROP TRIGGER IF EXISTS trg_jur_duvidas_status_inicial ON public."JUR_DUVIDAS";
-- DROP FUNCTION IF EXISTS public.jur_duvidas_status_inicial();
-- DROP FUNCTION IF EXISTS public.jur_duvida_operacional_decidir(bigint, text, text);
-- DROP FUNCTION IF EXISTS public.jur_duvida_ocultar(bigint, boolean);
-- Policies: reaplicar jur_duvidas_select da 20260717190004 e jur_duvidas_compl_insert da 20260930000170;
-- funções de notificação: reaplicar da 20260930000185 / 20260930000170.
-- DROP FUNCTION IF EXISTS public.e_juridico_das_duvidas();
-- DROP FUNCTION IF EXISTS public.pode_orientar_operacional();
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'operacional_orientacoes';
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'operacional_orientacoes';
-- DELETE FROM public.app_menu WHERE codigo = 'operacional_orientacoes';
-- NOTIFY pgrst, 'reload schema';
