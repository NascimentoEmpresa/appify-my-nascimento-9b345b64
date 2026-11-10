-- =========================================================================
-- Chamados de Sistemas: o GESTOR DE SISTEMAS finaliza (10/11/2026)
--
-- Pedido do Pablo: "mais uma etapa antes de todos chamados serem concluídos,
-- após o SOLICITANTE dar o CONCLUÍDO, e o DESENVOLVEDOR marcar como
-- CONCLUÍDO, o Gestor de Sistemas (iury atualmente) precisa marcar como
-- CONCLUÍDO também, pra só assim ficar de fato concluído. Também deixa quem
-- é gestor de sistemas ver todos chats de todos chamados e participar deles,
-- intermediar e fazer o que quiser."
--
-- ORDEM: dev conclui (status 'concluido') → solicitante confirma
-- (conclusao_confirmada_em, mig 20261028001300) → gestor de sistemas
-- finaliza (gestao_finalizada_em, AQUI). Só com as três o chamado está
-- "de fato concluído".
--
-- DESENHO — igual à confirmação do solicitante: o status NÃO muda, é uma
-- camada por cima do 'concluido'. Pelo mesmo motivo da mig 20261028001300:
-- 'concluido' é lido por Dashboard, Painel/Dashboard do Dev, TV de TI, hora
-- extra, novidade da I.A, Presidência, parecer da I.A... um status a mais
-- mudaria todas essas contas (e o tempo de entrega do dev passaria a contar
-- quanto o gestor demorou para clicar).
--
-- QUEM É O GESTOR DE SISTEMAS: menu fantasma novo
-- 'chamados_sistemas_gestor_sistemas' (módulo sistemas), dado por usuário em
-- Administração › Acesso por Usuário. NÃO é o chamado_sistema_gestor() —
-- esse vale para quem tem Painel/Coordenar/Aprovar (5 pessoas hoje, Pablo e
-- Eduardo inclusive); a finalização é de UMA cadeira. O Iury recebe o menu
-- aqui (tela nova nasce sem ninguém desde 08/10/2026).
--
-- "FAZER O QUE QUISER": quem tem o menu novo passa a contar também como
-- chamado_sistema_gestor() — vê todos os chamados, todos os chats (inclusive
-- as observações internas), escreve neles, coordena, aprova. Como a RLS de
-- CHAMADO_SISTEMA / _EVENTO / _ANEXO e a RPC chamado_enviar_mensagem já
-- perguntam a chamado_sistema_gestor(), basta estendê-la.
--
-- O QUE MUDA
--   1. CHAMADO_SISTEMA.gestao_finalizada_em / _por. NULL com status
--      'concluido' = aguardando o gestor de sistemas.
--   2. Gatilho chamado_sistema_finalizacao: troca de status zera (reabrir,
--      concluir de novo); marcar só pela RPC (marca app.chamado_finalizacao)
--      ou service_role. Solicitante "desconfirmar" (não existe hoje) também
--      não deixaria finalizado sem confirmação: a RPC exige a confirmação.
--   3. RPC chamado_finalizar_gestao(chamado): só o gestor de sistemas, só
--      concluído E confirmado pelo solicitante. Evento no histórico.
--   4. Sino: quando o solicitante confirma, os gestores de sistemas recebem
--      "Finalize o chamado #...".
--
-- LEGADO: o que já está concluído E confirmado entra finalizado
-- (gestao_finalizada_em = conclusao_confirmada_em) — o Iury não amanhece com
-- 741 chamados para clicar. Os 11 concluídos ainda aguardando o solicitante
-- (10/11) passam pela etapa nova. O pg_cron que confirma os antigos (mig
-- 20261029001100) NÃO finaliza: confirmado automático continua esperando o
-- gestor.
-- =========================================================================

-- ── 1. Menu fantasma do gestor de sistemas + o Iury ──────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'chamados_sistemas_gestor_sistemas',
       'Chamados — Gestor de Sistemas (finaliza e participa de todos os chats)', NULL, 95, true
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT p.id, 'chamados_sistemas_gestor_sistemas', 'visualizar', true,
       'Gestor de Sistemas — pedido do Pablo em 10/11/2026 (mig 20261110009000)'
  FROM public.profiles p
 WHERE p.id = 'd1dbc8d4-bf9b-4125-a6b1-11b6195155a4'  -- IURY DE JESUS SILVA
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s
                    WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_gestor_sistemas'
                      AND s.acao = 'visualizar' AND s.empresa_id IS NULL);

-- ── 2. Quem é o gestor de sistemas ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_gestor_sistemas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_gestor_sistemas');
$$;
REVOKE ALL ON FUNCTION public.chamado_gestor_sistemas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_gestor_sistemas() TO authenticated;

-- Gestor de sistemas conta como gestão de chamados: vê e escreve em todos
-- os chats (RLS de _EVENTO/_ANEXO e chamado_enviar_mensagem já perguntam
-- a esta função). Corpo da mig 20260802000002 + a linha nova.
CREATE OR REPLACE FUNCTION public.chamado_sistema_gestor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('chamados_sistemas_painel')
      OR public.tem_acesso_menu('chamados_sistemas_coordenar')
      OR public.tem_acesso_menu('chamados_sistemas_aprovar')
      OR public.tem_acesso_menu('chamados_sistemas_gestor_sistemas');
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_gestor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_sistema_gestor() TO authenticated;

-- ── 3. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE public."CHAMADO_SISTEMA"
  ADD COLUMN IF NOT EXISTS gestao_finalizada_em  timestamptz,
  ADD COLUMN IF NOT EXISTS gestao_finalizada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public."CHAMADO_SISTEMA".gestao_finalizada_em IS
  'Gestor de Sistemas finalizou (mig 20261110009000), depois da confirmação do solicitante. NULL com status concluido = ainda não está de fato concluído; zera a cada troca de status.';

-- Legado: concluído e confirmado conta como finalizado. Sem gatilhos para não
-- mexer em updated_at (bolinha de Chamados acenderia para todo mundo).
SET LOCAL session_replication_role = replica;
UPDATE public."CHAMADO_SISTEMA"
   SET gestao_finalizada_em = conclusao_confirmada_em
 WHERE status = 'concluido'
   AND conclusao_confirmada_em IS NOT NULL
   AND gestao_finalizada_em IS NULL;
SET LOCAL session_replication_role = origin;

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_aguardando_gestao
  ON public."CHAMADO_SISTEMA"(conclusao_confirmada_em)
  WHERE status = 'concluido' AND gestao_finalizada_em IS NULL;

-- ── 4. Gatilho: troca de status zera, só a RPC finaliza ──────────────────
CREATE OR REPLACE FUNCTION public.chamado_sistema_finalizacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_marca boolean := COALESCE(current_setting('app.chamado_finalizacao', true) = 'on', false);
  v_auto  boolean := COALESCE(auth.role() = 'service_role', false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.gestao_finalizada_em := NULL;
    NEW.gestao_finalizada_por := NULL;
    RETURN NEW;
  END IF;

  -- Reabriu, concluiu de novo, Presidência devolveu: a entrega é outra.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.gestao_finalizada_em := NULL;
    NEW.gestao_finalizada_por := NULL;
    RETURN NEW;
  END IF;

  IF (NEW.gestao_finalizada_em IS NOT NULL AND NEW.gestao_finalizada_em IS DISTINCT FROM OLD.gestao_finalizada_em
      OR NEW.gestao_finalizada_por IS NOT NULL AND NEW.gestao_finalizada_por IS DISTINCT FROM OLD.gestao_finalizada_por)
     AND NOT (v_marca OR v_auto) THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas finaliza o chamado, no botão Finalizar chamado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_sistema_finalizacao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_sistema_finalizacao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_sistema_finalizacao
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_sistema_finalizacao();

-- ── 5. RPC: o gestor de sistemas finaliza ────────────────────────────────
CREATE OR REPLACE FUNCTION public.chamado_finalizar_gestao(p_chamado_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chamado_gestor_sistemas() THEN
    RAISE EXCEPTION 'Só o Gestor de Sistemas finaliza o chamado.' USING ERRCODE = '42501';
  END IF;

  SELECT status, conclusao_confirmada_em, gestao_finalizada_em INTO v
    FROM public."CHAMADO_SISTEMA" WHERE id = p_chamado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chamado não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v.status IS DISTINCT FROM 'concluido' THEN
    RAISE EXCEPTION 'O desenvolvedor ainda não concluiu este chamado.' USING ERRCODE = '22023';
  END IF;
  IF v.conclusao_confirmada_em IS NULL THEN
    RAISE EXCEPTION 'O solicitante ainda não confirmou a conclusão.' USING ERRCODE = '22023';
  END IF;
  IF v.gestao_finalizada_em IS NOT NULL THEN
    RETURN;  -- duplo clique / duas abas
  END IF;

  PERFORM set_config('app.chamado_finalizacao', 'on', true);
  UPDATE public."CHAMADO_SISTEMA"
     SET gestao_finalizada_em = now(), gestao_finalizada_por = auth.uid()
   WHERE id = p_chamado_id;
  PERFORM set_config('app.chamado_finalizacao', 'off', true);

  INSERT INTO public."CHAMADO_SISTEMA_EVENTO" (chamado_id, autor_id, tipo, texto, meta)
  VALUES (p_chamado_id, auth.uid(), 'evento', 'Chamado finalizado pelo Gestor de Sistemas',
          jsonb_build_object('acao', 'gestao_finalizada'));
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_finalizar_gestao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chamado_finalizar_gestao(uuid) TO authenticated;

-- ── 6. Sino: solicitante confirmou → avisa o gestor de sistemas ──────────
-- Lê screen_permission_user direto (poucas linhas) e confere com
-- has_screen_access, que é quem manda (allow=false explícito, login barrado).
CREATE OR REPLACE FUNCTION public.chamado_confirmado_avisa_gestao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    SELECT DISTINCT s.user_id,
           'Finalize o chamado #' || NEW.numero,
           left(NEW.assunto, 120) || ' — o solicitante confirmou a conclusão. Confira e clique em Finalizar chamado.',
           'chamado_finalizar_gestao',
           '/app/sistemas/chamados/' || NEW.id
      FROM public.screen_permission_user s
     WHERE s.menu_codigo = 'chamados_sistemas_gestor_sistemas'
       AND s.acao = 'visualizar' AND s.allow
       AND s.user_id IS DISTINCT FROM auth.uid()
       AND public.has_screen_access(s.user_id, 'chamados_sistemas_gestor_sistemas', 'visualizar'::public.app_acao, NULL);
  EXCEPTION WHEN others THEN
    -- Aviso não pode derrubar a confirmação.
    RAISE WARNING 'chamado_confirmado_avisa_gestao (%): %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.chamado_confirmado_avisa_gestao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_confirmado_avisa_gestao ON public."CHAMADO_SISTEMA";
CREATE TRIGGER trg_chamado_confirmado_avisa_gestao
  AFTER UPDATE OF conclusao_confirmada_em ON public."CHAMADO_SISTEMA"
  FOR EACH ROW
  WHEN (NEW.status = 'concluido' AND NEW.conclusao_confirmada_em IS NOT NULL AND OLD.conclusao_confirmada_em IS NULL
        AND NEW.gestao_finalizada_em IS NULL)
  EXECUTE FUNCTION public.chamado_confirmado_avisa_gestao();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_chamado_confirmado_avisa_gestao ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_confirmado_avisa_gestao();
-- DROP FUNCTION IF EXISTS public.chamado_finalizar_gestao(uuid);
-- DROP TRIGGER IF EXISTS trg_chamado_sistema_finalizacao ON public."CHAMADO_SISTEMA";
-- DROP FUNCTION IF EXISTS public.chamado_sistema_finalizacao();
-- DROP INDEX IF EXISTS public.idx_chamado_sistema_aguardando_gestao;
-- ALTER TABLE public."CHAMADO_SISTEMA" DROP COLUMN IF EXISTS gestao_finalizada_por,
--                                      DROP COLUMN IF EXISTS gestao_finalizada_em;
-- Recriar chamado_sistema_gestor() sem a linha do gestor_sistemas (mig 20260802000002).
-- DROP FUNCTION IF EXISTS public.chamado_gestor_sistemas();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'chamados_sistemas_gestor_sistemas';
-- DELETE FROM public.app_menu WHERE codigo = 'chamados_sistemas_gestor_sistemas';
-- NOTIFY pgrst, 'reload schema';
