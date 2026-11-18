-- =========================================================================
-- [SEM-CHAMADO] Chamados de Sistemas: o Gestor de Sistemas DEVOLVE ao dev,
-- com motivo (18/11/2026)
--
-- O PEDIDO (Pablo, olhando a aba "Pendente de conclusão" do Painel de
-- Distribuição): o gestor precisa "ver toda a tarefa, chat, tudo o que o dev
-- vê e conseguir CONCLUIR ela de fato pro solicitante ver OU devolver pro dev
-- continuar desenvolvendo com motivo".
--
-- CONTEXTO: desde a mig 20261117235500 o merge da PR (e, desde a
-- 20261118120000, o "Concluir chamado" do dev) só ENTREGA ao gestor —
-- desenvolvimento_entregue_em preenchido, status sem mudar. Concluir o gestor
-- já conseguia (botão "Concluir chamado"); faltava o caminho de volta.
--
-- AGORA: RPC chamado_devolver_ao_dev(chamado, motivo)
--   · só o Gestor de Sistemas (chamado_gestor_sistemas());
--   · só chamado entregue e não encerrado; motivo obrigatório;
--   · limpa a entrega (o dev volta a ter o "Concluir chamado" verde), grava
--     o motivo no histórico (tipo 'evento' — interno do time, o solicitante
--     só vê 'comentario') e avisa o responsável no sino.
-- O status não muda: o chamado segue "em andamento" com o dev.
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chamado_devolver_ao_dev(p_chamado_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_gestor_sistemas() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas devolve o chamado ao desenvolvedor.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Informe o motivo da devolução.' USING ERRCODE = '22023';
  END IF;

  SELECT numero, assunto, status, responsavel_id, desenvolvimento_entregue_em INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IN ('concluido', 'cancelado', 'reprovado') THEN
    RAISE EXCEPTION 'O chamado já está encerrado — use Reabrir chamado.' USING ERRCODE = '22023';
  END IF;
  IF v.desenvolvimento_entregue_em IS NULL THEN
    RAISE EXCEPTION 'O chamado não está pendente do Gestor de Sistemas.' USING ERRCODE = '22023';
  END IF;

  -- Limpar a entrega não é travado pelo gatilho chamado_sistema_entrega_merge.
  UPDATE public."CHAMADO_SISTEMA"
     SET desenvolvimento_entregue_em = NULL, desenvolvimento_entregue_pr = NULL
   WHERE id = p_chamado_id;

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento',
          'Devolvido ao desenvolvedor pelo Gestor de Sistemas — motivo: ' || v_motivo,
          jsonb_build_object('acao', 'devolvido_ao_dev', 'motivo', v_motivo));

  IF v.responsavel_id IS NOT NULL AND v.responsavel_id IS DISTINCT FROM auth.uid() THEN
    BEGIN
      INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
      VALUES (v.responsavel_id,
              'Chamado #' || v.numero || ' devolvido pelo Gestor de Sistemas',
              left(v_motivo, 200),
              'chamado_devolvido_dev',
              '/app/sistemas/chamados/' || p_chamado_id);
    EXCEPTION WHEN others THEN
      -- Aviso não pode derrubar a devolução.
      RAISE WARNING 'chamado_devolver_ao_dev (%): %', p_chamado_id, SQLERRM;
    END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.chamado_devolver_ao_dev(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.chamado_devolver_ao_dev(uuid, text);
-- NOTIFY pgrst, 'reload schema';
