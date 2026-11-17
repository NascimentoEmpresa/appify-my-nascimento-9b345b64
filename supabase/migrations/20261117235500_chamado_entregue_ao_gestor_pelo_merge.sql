-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: o MERGE da PR entrega ao Gestor de
-- Sistemas — não conclui o chamado (17/11/2026)
--
-- ANTES: a PR com SIS-AAAA-NNNN no título concluía o chamado sozinha (status
-- 'concluido') — primeiro na abertura (12 a 17/11), e no merge como reserva.
-- O solicitante recebia "o time de Sistemas concluiu" sem ninguém da gestão
-- conferir (SIS-2026-0909, PR #1302).
--
-- AGORA (revisão da PR #1310): existem duas finalizações diferentes —
--   · concluir o chamado em si (status 'concluido'): é o que o solicitante vê.
--     Quem faz é o GESTOR DE SISTEMAS (Iury), no botão "Concluir chamado";
--   · o merge da PR só ENTREGA o desenvolvimento a ele: marca
--     desenvolvimento_entregue_em/_pr (Edge chamado-concluir-pr) e o gestor
--     recebe no sino "Conclua o chamado #...".
-- Depois da conclusão seguem, sem mudança, a confirmação do solicitante (mig
-- 20261028001300) e a finalização do gestor (mig 20261110009000).
--
-- O status não muda no merge, então Dashboard, Painel do Dev, TV de TI, hora
-- extra, parecer da I.A etc. continuam contando a conclusão pelo clique.
--
-- O DEV CONCLUINDO NA TELA TAMBÉM SÓ ENTREGA (17/11/2026, Pablo, olhando o
-- SIS-2026-0934: "quando eu marcar como concluído, ainda tem que ficar
-- pendente de conclusão do gestor, antes de ficar como concluído pro
-- solicitante"). O "Concluir chamado" do responsável chama a RPC
-- chamado_entregar_ao_gestor — mesma marca do merge. Concluir de vez com o
-- chamado pendente do gestor continua possível para quem age no chamado
-- (Pablo: "tem que dar pra concluir o chamado mesmo pendente de conclusão do
-- gestor, mas aí tem que confirmar"): a tela pede a confirmação; o banco não
-- trava (src/pages/chamados/validacaoPresidencia.ts, acaoAoConcluir).
--
-- REGRAS DA COLUNA
--   1. Toda troca de status zera a entrega (o gestor concluiu, o chamado foi
--      reaberto, cancelado...): a marca vale só até a próxima mudança.
--   2. Marcar a entrega: a Edge do merge (service_role) ou a RPC
--      chamado_entregar_ao_gestor — ninguém marca com UPDATE direto.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS desenvolvimento_entregue_em timestamptz,
  ADD COLUMN IF NOT EXISTS desenvolvimento_entregue_pr text;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".desenvolvimento_entregue_em IS
  'PR do chamado mergeada na main (mig 20261117235500): desenvolvimento entregue ao Gestor de Sistemas, que conclui o chamado. Zera a cada troca de status.';
COMMENT ON COLUMN public."CHAMADO_SISTEMA".desenvolvimento_entregue_pr IS
  'URL da PR mergeada que entregou o desenvolvimento (mig 20261117235500).';

-- Fila do gestor: entregues e ainda não concluídos.
CREATE INDEX IF NOT EXISTS idx_chamado_sistema_entregue_aguardando_gestor
  ON public."CHAMADO_SISTEMA" (desenvolvimento_entregue_em)
  WHERE desenvolvimento_entregue_em IS NOT NULL;

-- ── 2. Gatilho: troca de status zera, só o servidor marca ────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_entrega_merge()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_auto boolean := COALESCE(auth.role() = 'service_role', false)
                    OR COALESCE(current_setting('app.chamado_entrega', true) = 'on', false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.desenvolvimento_entregue_em := NULL;
    NEW.desenvolvimento_entregue_pr := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.desenvolvimento_entregue_em := NULL;
    NEW.desenvolvimento_entregue_pr := NULL;
    RETURN NEW;
  END IF;

  -- Limpar (NULL) não é travado; marcar, só a Edge chamado-concluir-pr ou a
  -- RPC chamado_entregar_ao_gestor (marca app.chamado_entrega).
  IF NOT v_auto AND (
       (NEW.desenvolvimento_entregue_em IS NOT NULL AND NEW.desenvolvimento_entregue_em IS DISTINCT FROM OLD.desenvolvimento_entregue_em)
    OR (NEW.desenvolvimento_entregue_pr IS NOT NULL AND NEW.desenvolvimento_entregue_pr IS DISTINCT FROM OLD.desenvolvimento_entregue_pr)) THEN
    RAISE EXCEPTION 'A entrega do desenvolvimento é marcada só pelo merge da PR ou pelo botão Concluir chamado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_entrega_merge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_entrega_merge ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_entrega_merge
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_entrega_merge();

-- ── 3. Sino: PR mergeada → avisa o Gestor de Sistemas ────────────────────
-- Mesmo desenho de chamado_confirmado_avisa_gestao (mig 20261110009000).
CREATE OR REPLACE FUNCTION public.chamado_entregue_avisa_gestao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT DISTINCT s.user_id,
           'Conclua o chamado #' || NEW.numero,
           left(NEW.assunto, 120) || ' — a PR foi mergeada. Confira a entrega e clique em Concluir chamado.',
           'chamado_concluir_gestao',
           '/app/sistemas/chamados/' || NEW.id
      FROM public.screen_permission_user s
     WHERE s.menu_codigo = 'chamados_sistemas_gestor_sistemas'
       AND s.acao = 'visualizar' AND s.allow
       AND public.has_screen_access(s.user_id, 'chamados_sistemas_gestor_sistemas', 'visualizar'::public.app_acao, NULL);
  EXCEPTION WHEN others THEN
    -- Aviso não pode derrubar a entrega.
    RAISE WARNING 'chamado_entregue_avisa_gestao (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_entregue_avisa_gestao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_entregue_avisa_gestao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_entregue_avisa_gestao
  AFTER UPDATE OF desenvolvimento_entregue_em ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.desenvolvimento_entregue_em IS NOT NULL AND OLD.desenvolvimento_entregue_em IS NULL)
  EXECUTE FUNCTION public.chamado_entregue_avisa_gestao();

-- ── 4. RPC: o dev conclui = entrega ao Gestor de Sistemas ────────────────
-- Mesmo público do card de Ações rápidas (ExecutarChamado: podeAgir =
-- gestão || dev responsável). Não muda o status: o gestor conclui depois.
CREATE OR REPLACE FUNCTION public.chamado_entregar_ao_gestor(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;

  SELECT status, responsavel_id, desenvolvimento_entregue_em INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.responsavel_id IS DISTINCT FROM auth.uid() AND NOT public.chamado_sistema_gestor() THEN
    RAISE EXCEPTION 'Só o responsável pelo chamado (ou a gestão) conclui o desenvolvimento.' USING ERRCODE = '42501';
  END IF;
  IF v.status IN ('concluido', 'cancelado', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado já está encerrado.' USING ERRCODE = '22023';
  END IF;
  IF v.desenvolvimento_entregue_em IS NOT NULL THEN
    RETURN;  -- já entregue (merge da PR, duplo clique)
  END IF;

  PERFORM set_config('app.chamado_entrega', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET desenvolvimento_entregue_em = now(), desenvolvimento_entregue_pr = NULL
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_entrega', 'off', true);

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          'Desenvolvimento concluído — falta o Gestor de Sistemas concluir o chamado',
          jsonb_build_object('acao', 'desenvolvimento_entregue', 'origem', 'tela'));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_entregar_ao_gestor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_entregar_ao_gestor(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_entregar_ao_gestor(uuid);
-- DROP TRIGGER IF EXISTS trg_chamado_entregue_avisa_gestao ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_entregue_avisa_gestao();
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_entrega_merge ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_entrega_merge();
-- DROP INDEX IF EXISTS public.idx_chamado_sistema_entregue_aguardando_gestor;
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS desenvolvimento_entregue_pr,
--                                      DROP COLUMN IF EXISTS desenvolvimento_entregue_em;
-- NOTIFY pgrst, 'reload schema';
