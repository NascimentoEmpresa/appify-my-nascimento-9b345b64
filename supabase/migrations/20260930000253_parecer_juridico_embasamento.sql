-- =========================================================================
-- Parecer Jurídico: resposta simples + EMBASAMENTO JURÍDICO em cada dúvida
--
-- Pedido do Pablo (28/09/2026):
--   "Adicionar dois campos de resposta em cada demanda. O primeiro será
--    destinado à resposta do Gustavo, de forma simples, clara e objetiva
--    [...]. O segundo campo será destinado ao embasamento jurídico da
--    resposta, contendo as fundamentações legais, normas, cláusulas
--    contratuais ou demais justificativas [...]."
--   O embasamento fica oculto na tela, atrás de "Visualizar embasamento
--   jurídico". TODOS que veem a resposta veem o embasamento; o que é
--   gerenciado é só QUEM ESCREVE cada um — no Acesso por Usuário que já
--   existe, sem gerenciamento novo.
--
-- DESENHO
--   resposta     (coluna antiga) = resposta simples. Continua mandando no
--                status: gravá-la é o que leva a dúvida a 'Respondida'.
--                Quem escreve: ação `responder` do menu `duvidas` (mig 173).
--   embasamento  (coluna nova)   = fundamentação. Não mexe no status — pode
--                ser escrito antes da resposta simples (já 'Aprovada') ou
--                depois ('Respondida'). Quem escreve: ação `fundamentar` do
--                mesmo menu (valor de enum da mig 252).
--
--   A RLS de UPDATE é por LINHA, não por coluna — então quem só tem
--   `fundamentar` passa na policy e o gatilho jur_duvidas_guarda_embasamento
--   segura o resto: ele só pode mexer nas colunas do embasamento. Do outro
--   lado, só quem tem `fundamentar` muda o embasamento. O gatilho só vale
--   pra escrita direta da tela (current_user authenticated/anon); as RPCs
--   SECURITY DEFINER (avaliar, ocultar, decisão do Operacional) passam.
--
-- Quem já responde ganha `fundamentar` também, pra ninguém ficar sem poder
-- escrever o embasamento no primeiro dia — tira-se no Acesso por Usuário de
-- quem não deve (ex.: deixar só a resposta simples com o Gustavo).
--
-- ⚠ Precisa da mig 252 aplicada ANTES, em execução separada (valor novo de
-- enum não pode ser usado na transação em que foi criado).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── Colunas ──────────────────────────────────────────────────────────────
ALTER TABLE public."JUR_DUVIDAS"
  ADD COLUMN IF NOT EXISTS embasamento     text,
  ADD COLUMN IF NOT EXISTS embasamento_por text,
  ADD COLUMN IF NOT EXISTS embasamento_em  timestamptz;

COMMENT ON COLUMN public."JUR_DUVIDAS".resposta IS
  'Resposta SIMPLES e objetiva (o que fazer). Quem escreve: duvidas/responder. Mig 253, 28/09/2026.';
COMMENT ON COLUMN public."JUR_DUVIDAS".embasamento IS
  'Embasamento jurídico da resposta (leis, normas, cláusulas). Quem escreve: duvidas/fundamentar. Visível a quem vê a resposta. Mig 253.';

-- ── A ação no menu que já existe (vira switch no Acesso por Usuário) ─────
INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES ('duvidas', 'fundamentar'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.pode_fundamentar_duvida()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.has_screen_access(auth.uid(), 'duvidas', 'fundamentar'::app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.pode_fundamentar_duvida() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_fundamentar_duvida() TO authenticated;

-- ── Quem fundamenta também é "Jurídico das dúvidas" (vê as ocultas) ──────
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
      OR public.has_screen_access(auth.uid(), 'duvidas', 'fundamentar'::public.app_acao)
      OR public.has_screen_access(auth.uid(), 'duvidas', 'alterar'::public.app_acao);
$fn$;
REVOKE ALL ON FUNCTION public.e_juridico_das_duvidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e_juridico_das_duvidas() TO authenticated;

-- ── UPDATE: quem fundamenta passa na policy (o gatilho recorta as colunas) ─
DROP POLICY IF EXISTS jur_duvidas_update ON public."JUR_DUVIDAS";
CREATE POLICY jur_duvidas_update ON public."JUR_DUVIDAS" FOR UPDATE TO authenticated
  USING (public.pode_responder_duvida() OR public.pode_aprovar_duvida() OR public.pode_fundamentar_duvida())
  WITH CHECK (public.pode_responder_duvida() OR public.pode_aprovar_duvida() OR public.pode_fundamentar_duvida());

-- ── Gatilho: cada um escreve o seu campo ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.jur_duvidas_guarda_embasamento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cols_emb text[] := ARRAY['embasamento', 'embasamento_por', 'embasamento_em', 'updated_at'];
BEGIN
  -- RPCs SECURITY DEFINER (avaliar, ocultar, Operacional) não passam por aqui.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF NEW.embasamento IS DISTINCT FROM OLD.embasamento THEN
    IF NOT public.pode_fundamentar_duvida() THEN
      RAISE EXCEPTION 'Sem permissão para escrever o embasamento jurídico (Acesso por Usuário › Parecer Jurídico › Fundamentar).'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status NOT IN ('Aprovada', 'Respondida') THEN
      RAISE EXCEPTION 'O embasamento jurídico só pode ser escrito em dúvida aprovada ou respondida.';
    END IF;
    NEW.embasamento    := nullif(btrim(NEW.embasamento), '');
    NEW.embasamento_em := CASE WHEN NEW.embasamento IS NULL THEN NULL ELSE now() END;
    IF NEW.embasamento IS NULL THEN NEW.embasamento_por := NULL; END IF;
  END IF;

  -- Só `fundamentar` (sem responder/aprovar): mexe apenas no embasamento.
  IF NOT (public.pode_responder_duvida() OR public.pode_aprovar_duvida())
     AND (to_jsonb(NEW) - v_cols_emb) IS DISTINCT FROM (to_jsonb(OLD) - v_cols_emb) THEN
    RAISE EXCEPTION 'Você só pode alterar o embasamento jurídico desta dúvida.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_jur_duvidas_guarda_embasamento ON public."JUR_DUVIDAS";
CREATE TRIGGER trg_jur_duvidas_guarda_embasamento
  BEFORE UPDATE ON public."JUR_DUVIDAS"
  FOR EACH ROW EXECUTE FUNCTION public.jur_duvidas_guarda_embasamento();

-- ── Quem já responde ganha fundamentar (tira-se no Acesso por Usuário) ───
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'duvidas', 'fundamentar'::app_acao, true,
       'Migração 20260930000253: já respondia as dúvidas (duvidas/responder)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'duvidas' AND s.acao = 'responder'::app_acao AND s.allow
   AND NOT EXISTS (
     SELECT 1 FROM public.screen_permission_user x
      WHERE x.user_id = s.user_id AND x.menu_codigo = 'duvidas' AND x.acao = 'fundamentar'::app_acao);

-- ── Sino: dúvida aprovada avisa quem responde E quem fundamenta ──────────
-- Cópia da jur_duvidas_notificar da mig 244; só muda o destinatário de 'Aprovada'.
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
      PERFORM public.jur_notificar(
        ARRAY(SELECT DISTINCT u FROM unnest(public.jur_quem_tem('duvidas', 'responder')
                                         || public.jur_quem_tem('duvidas', 'fundamentar')) AS u),
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

NOTIFY pgrst, 'reload schema';

-- Conferência
-- SELECT p.email, s.acao FROM public.screen_permission_user s JOIN public.profiles p ON p.id = s.user_id
--  WHERE s.menu_codigo = 'duvidas' AND s.acao IN ('responder', 'fundamentar') AND s.allow ORDER BY 1, 2;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_jur_duvidas_guarda_embasamento ON public."JUR_DUVIDAS";
-- DROP FUNCTION IF EXISTS public.jur_duvidas_guarda_embasamento();
-- DROP POLICY IF EXISTS jur_duvidas_update ON public."JUR_DUVIDAS";
-- CREATE POLICY jur_duvidas_update ON public."JUR_DUVIDAS" FOR UPDATE TO authenticated
--   USING (public.pode_responder_duvida() OR public.pode_aprovar_duvida())
--   WITH CHECK (public.pode_responder_duvida() OR public.pode_aprovar_duvida());
-- Reaplicar e_juridico_das_duvidas() e jur_duvidas_notificar() da 20260930000244;
-- DROP FUNCTION IF EXISTS public.pode_fundamentar_duvida();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'duvidas' AND acao = 'fundamentar';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'duvidas' AND acao = 'fundamentar';
-- (as colunas embasamento* ficam — sem uso)
-- NOTIFY pgrst, 'reload schema';
