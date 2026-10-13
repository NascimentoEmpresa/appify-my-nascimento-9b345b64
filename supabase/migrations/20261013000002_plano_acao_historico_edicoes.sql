-- =========================================================================
-- PLANO DE AÇÕES: EDIÇÃO REGISTRADA NO HISTÓRICO (13/10/2026)
--
-- PEDIDO (Pablo): "coloca opção pra EDITAR os encaminhamentos, e os detalhes
-- como problema, título, ação etc, mas tem que ficar no histórico que foi
-- editado — botãozinho HISTÓRICO lá em cima do lado de Lista".
--
-- ANTES: plano_acao_log_history só gravava status, responsável e exclusão.
-- Título/Problema/Ação já eram editáveis pelo Salvar, mas a troca não deixava
-- rastro nenhum; encaminhamento (plano_acao_comentario) não tinha edição.
--
-- AGORA
--   1) Toda troca dos campos de conteúdo da ação vira uma linha
--      'campo_editado' em plano_acao_historico, com o texto antes/depois.
--   2) Encaminhamento editável por quem escreveu, por quem tem "editar" no
--      Plano de Ações ou por admin; cada edição/exclusão grava
--      'encaminhamento_editado'/'encaminhamento_excluido' com antes/depois
--      (metadata.comentario_id liga a linha ao encaminhamento).
--   3) Autor, ação e data de criação do encaminhamento ficam travados no
--      UPDATE — editar muda só o texto; editado_em/editado_por marcam a edição.
--   Autor da linha de histórico: atualizado_por (a tela manda) e, sem ele,
--   auth.uid() — gravação pelo cron continua saindo como "Sistema".
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- ── 1) Campos de conteúdo da ação no histórico ───────────────────────────
CREATE OR REPLACE FUNCTION public.plano_acao_log_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_autor uuid := COALESCE(NEW.atualizado_por, auth.uid());
  v_antes jsonb;
  v_depois jsonb;
  v_campo text;
  -- Campos de conteúdo: status/responsável/exclusão têm evento próprio abaixo.
  c_campos text[] := ARRAY['tipo_acao','titulo','problema','acao','comite','tipo_reuniao','area','setor',
                           'prioridade_normalizada','data_inicio_planejado','data_fim_planejado',
                           'lider_comite_profile_id','comentarios','visibilidade'];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status_normalizado IS DISTINCT FROM OLD.status_normalizado THEN
      INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, criado_por)
      VALUES (NEW.empresa_id, NEW.id, 'status_alterado', 'status_normalizado', OLD.status_normalizado, NEW.status_normalizado, NEW.atualizado_por);
    END IF;
    IF NEW.responsavel_profile_id IS DISTINCT FROM OLD.responsavel_profile_id THEN
      INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, criado_por)
      VALUES (NEW.empresa_id, NEW.id, 'responsavel_alterado', 'responsavel_profile_id', OLD.responsavel_profile_id::text, NEW.responsavel_profile_id::text, NEW.atualizado_por);
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
      INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, criado_por)
      VALUES (NEW.empresa_id, NEW.id, 'excluida_logicamente', 'deleted_at', NULL, NEW.deleted_at::text, NEW.atualizado_por);
    END IF;

    v_antes := to_jsonb(OLD);
    v_depois := to_jsonb(NEW);
    FOREACH v_campo IN ARRAY c_campos LOOP
      -- '' e NULL contam como a mesma coisa: a tela grava "" em campo limpo.
      IF NULLIF(v_antes->>v_campo, '') IS DISTINCT FROM NULLIF(v_depois->>v_campo, '') THEN
        INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, criado_por)
        VALUES (NEW.empresa_id, NEW.id, 'campo_editado', v_campo,
                NULLIF(v_antes->>v_campo, ''), NULLIF(v_depois->>v_campo, ''), v_autor);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $fn$;

-- ── 2) Encaminhamento: marca de edição ───────────────────────────────────
ALTER TABLE public.plano_acao_comentario ADD COLUMN IF NOT EXISTS editado_em timestamptz;
ALTER TABLE public.plano_acao_comentario ADD COLUMN IF NOT EXISTS editado_por uuid;

-- Quem pode editar: autor, quem edita o Plano de Ações, ou admin.
DROP POLICY IF EXISTS pac_update ON public.plano_acao_comentario;
CREATE POLICY pac_update ON public.plano_acao_comentario FOR UPDATE TO authenticated
  USING (
    (criado_por = auth.uid()
     OR public.plano_acao_can_access(auth.uid(), empresa_id, 'editar')
     OR public.can_access(auth.uid(), 'administracao', 'alterar'::public.app_acao))
    AND public.plano_acao_visible_by_user(auth.uid(), plano_acao_id))
  WITH CHECK (
    (criado_por = auth.uid()
     OR public.plano_acao_can_access(auth.uid(), empresa_id, 'editar')
     OR public.can_access(auth.uid(), 'administracao', 'alterar'::public.app_acao))
    AND public.plano_acao_visible_by_user(auth.uid(), plano_acao_id));

-- ── 3) Encaminhamento: trava + histórico ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.plano_acao_comentario_antes_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Editar muda só o texto: autor, ação, empresa e data de criação ficam.
  NEW.criado_por    := OLD.criado_por;
  NEW.plano_acao_id := OLD.plano_acao_id;
  NEW.empresa_id    := OLD.empresa_id;
  NEW.created_at    := OLD.created_at;
  IF NEW.comentario IS DISTINCT FROM OLD.comentario THEN
    NEW.editado_em  := now();
    NEW.editado_por := auth.uid();
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS plano_acao_comentario_antes_update_trg ON public.plano_acao_comentario;
CREATE TRIGGER plano_acao_comentario_antes_update_trg
  BEFORE UPDATE ON public.plano_acao_comentario
  FOR EACH ROW EXECUTE FUNCTION public.plano_acao_comentario_antes_update();

CREATE OR REPLACE FUNCTION public.plano_acao_comentario_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.comentario IS DISTINCT FROM OLD.comentario THEN
    INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, metadata, criado_por)
    VALUES (NEW.empresa_id, NEW.plano_acao_id, 'encaminhamento_editado', 'encaminhamento', OLD.comentario, NEW.comentario,
            jsonb_build_object('comentario_id', NEW.id, 'autor_original', OLD.criado_por), auth.uid());
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.plano_acao_historico(empresa_id, plano_acao_id, evento, campo, valor_anterior, valor_novo, metadata, criado_por)
    VALUES (OLD.empresa_id, OLD.plano_acao_id, 'encaminhamento_excluido', 'encaminhamento', OLD.comentario, NULL,
            jsonb_build_object('comentario_id', OLD.id, 'autor_original', OLD.criado_por), auth.uid());
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.plano_acao_comentario_log() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS plano_acao_comentario_log_trg ON public.plano_acao_comentario;
CREATE TRIGGER plano_acao_comentario_log_trg
  AFTER UPDATE OR DELETE ON public.plano_acao_comentario
  FOR EACH ROW EXECUTE FUNCTION public.plano_acao_comentario_log();

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS plano_acao_comentario_log_trg ON public.plano_acao_comentario;
-- DROP TRIGGER IF EXISTS plano_acao_comentario_antes_update_trg ON public.plano_acao_comentario;
-- DROP FUNCTION IF EXISTS public.plano_acao_comentario_log();
-- DROP FUNCTION IF EXISTS public.plano_acao_comentario_antes_update();
-- DROP POLICY IF EXISTS pac_update ON public.plano_acao_comentario;
-- CREATE POLICY pac_update ON public.plano_acao_comentario FOR UPDATE
--   USING ((criado_por = auth.uid()) OR can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
--   WITH CHECK (((criado_por = auth.uid()) OR can_access(auth.uid(), 'administracao', 'alterar'::app_acao))
--     AND plano_acao_visible_by_user(auth.uid(), plano_acao_id));
-- (plano_acao_log_history: reaplicar a versão de 20260602231345 — só status, responsável e exclusão)
-- ALTER TABLE public.plano_acao_comentario DROP COLUMN IF EXISTS editado_em, DROP COLUMN IF EXISTS editado_por;
