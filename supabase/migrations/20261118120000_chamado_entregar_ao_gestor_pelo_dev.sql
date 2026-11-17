-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: o "Concluir chamado" do DEV também só
-- entrega ao Gestor de Sistemas (17/11/2026)
--
-- O PEDIDO (Pablo, olhando o SIS-2026-0934): "quando eu marcar como
-- concluído, ainda tem que ficar pendente de conclusão do gestor, antes de
-- ficar como concluído pro solicitante". E logo depois: "tem que dar pra
-- concluir o chamado mesmo pendente de conclusão do gestor, mas aí tem que
-- confirmar".
--
-- ANTES: a mig 20261117235500 (PR #1310) fez o MERGE da PR entregar ao
-- Gestor de Sistemas (desenvolvimento_entregue_em) em vez de concluir. Mas o
-- botão "Concluir chamado" do dev ainda punha status 'concluido' direto — o
-- solicitante via "concluído" sem o gestor passar.
--
-- AGORA
--   1. RPC chamado_entregar_ao_gestor(chamado): o "Concluir chamado" do
--      responsável chama esta RPC — mesma marca do merge, sem mudar o
--      status. O gatilho chamado_entregue_avisa_gestao (mig 20261117235500)
--      avisa o gestor no sino.
--   2. chamado_sistema_entrega_merge() passa a aceitar também a marca de
--      transação app.chamado_entrega (posta só pela RPC), além de
--      service_role (a Edge do merge).
--   3. O banco NÃO trava status 'concluido': concluir com o chamado pendente
--      do gestor continua possível para quem age no chamado — a tela pede a
--      confirmação "O chamado está pendente de conclusão do Gestor de
--      Sistemas. Tem certeza que deseja concluir?" (acaoAoConcluir em
--      src/pages/chamados/validacaoPresidencia.ts).
--
-- Por que migration nova e não editar a 20261117235500: ela já foi aplicada
-- no merge da PR #1310 — o aplicador controla por versão, e editar o arquivo
-- não teria efeito nenhum.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

-- ── 1. Gatilho da entrega aceita a marca da RPC ──────────────────────────
-- Corpo da mig 20261117235500 + a marca app.chamado_entrega.
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

-- ── 2. RPC: o dev conclui = entrega ao Gestor de Sistemas ────────────────
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
REVOKE ALL ON FUNCTION public.chamado_entregar_ao_gestor(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_entregar_ao_gestor(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_entregar_ao_gestor(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_entregar_ao_gestor(uuid);
-- Recriar chamado_sistema_entrega_merge() como na mig 20261117235500 (sem a
-- marca app.chamado_entrega e com a mensagem "marcada só pelo merge da PR").
-- NOTIFY pgrst, 'reload schema';
