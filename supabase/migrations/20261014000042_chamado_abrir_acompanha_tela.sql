-- =========================================================================
-- CHAMADOS — quem ganha a TELA de chamados ganha também "Abrir chamado"
-- (se ainda não tiver nada marcado nele) (14/10/2026)
--
-- Pablo, com o print do celular de uma encarregada: "o encarregado mesmo com
-- permissão de abrir chamado não consegue, dá esse erro" — "Você não tem
-- permissão para abrir chamados… Chamados — Abrir chamado (solicitar)". No
-- Acesso por Usuário ela tinha Encarregados › Chamados de Sistemas
-- (encarregados_chamados) ligado; a capacidade de abrir é OUTRA
-- (chamados_sistemas_abrir, no módulo Central de Serviços) e estava sem marca.
--
-- É o mesmo caso da 20260930000020, que corrigiu os DADOS de quem existia em
-- 30/09 — quem foi liberado depois caiu de novo (4 pessoas em 14/10:
-- miriam@, supervisor01.irga@, supervisor02.irga@, teste@).
--
-- A regra não muda: chamado_pode_abrir() continua olhando SÓ a capacidade
-- (a 20260930000019 reverteu a tentativa de olhar a tela — criava um segundo
-- lugar de decisão e o toggle deixava de desligar). Aqui:
--   1. libera a capacidade para quem tem a tela e nenhuma linha dela;
--   2. gatilho em screen_permission_user: ao LIBERAR (visualizar = true) uma
--      das três portas da tela (encarregados_chamados, chamados_sistemas,
--      central_servicos_chamados), grava chamados_sistemas_abrir = true nas
--      5 ações do toggle — SÓ se a pessoa não tem nenhuma linha dela. Quem
--      foi desligado de propósito (linha false) continua desligado: desligar
--      no Acesso por Usuário segue funcionando.
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.chamado_abrir_acompanha_tela()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.menu_codigo IN ('encarregados_chamados', 'chamados_sistemas', 'central_servicos_chamados')
     AND NEW.acao = 'visualizar'::public.app_acao AND NEW.allow
     AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s
                      WHERE s.user_id = NEW.user_id AND s.menu_codigo = 'chamados_sistemas_abrir') THEN
    INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo, created_by)
    SELECT NEW.user_id, 'chamados_sistemas_abrir', a.acao, true, NEW.empresa_id,
           'Automático: liberada a tela de chamados (' || NEW.menu_codigo || ')', NEW.created_by
      FROM (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao),
                   ('aprovar'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.chamado_abrir_acompanha_tela() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chamado_abrir_acompanha_tela ON public.screen_permission_user;
CREATE TRIGGER trg_chamado_abrir_acompanha_tela
  AFTER INSERT OR UPDATE OF allow ON public.screen_permission_user
  FOR EACH ROW EXECUTE FUNCTION public.chamado_abrir_acompanha_tela();

-- ── Quem já tem a tela (resolvida: override > perfil > concede_tudo) e nenhuma linha da capacidade ─
WITH tela AS (
  SELECT p.id AS user_id
    FROM public.profiles p
   WHERE EXISTS (
     SELECT 1 FROM (VALUES ('encarregados_chamados'), ('chamados_sistemas'), ('central_servicos_chamados')) AS t(codigo)
      WHERE COALESCE(
        (SELECT s.allow FROM public.screen_permission_user s
          WHERE s.user_id = p.id AND s.menu_codigo = t.codigo AND s.acao = 'visualizar'::public.app_acao
          ORDER BY s.updated_at DESC LIMIT 1),
        EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                 WHERE u.user_id = p.id AND pf.concede_tudo)
        OR EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                     JOIN public.perfil_acesso_permissao pp ON pp.perfil_id = pf.id AND pp.allow
                      AND pp.menu_codigo = t.codigo AND pp.acao = 'visualizar'::public.app_acao
                    WHERE u.user_id = p.id)))
     AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user s WHERE s.user_id = p.id AND s.menu_codigo = 'chamados_sistemas_abrir')
     -- quem já pode abrir pelo perfil não precisa de linha
     AND NOT EXISTS (SELECT 1 FROM public.usuario_perfil_acesso u JOIN public.perfil_acesso pf ON pf.id = u.perfil_id AND pf.ativo
                       JOIN public.perfil_acesso_permissao pp ON pp.perfil_id = pf.id AND pp.allow
                        AND pp.menu_codigo = 'chamados_sistemas_abrir' AND pp.acao = 'visualizar'::public.app_acao
                      WHERE u.user_id = p.id))
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT tela.user_id, 'chamados_sistemas_abrir', a.acao, true, 'Automático (mig 20261014000042): tinha a tela de chamados e nenhuma marca em Abrir chamado'
  FROM tela
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao),
                    ('aprovar'::public.app_acao), ('exportar'::public.app_acao)) AS a(acao);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_chamado_abrir_acompanha_tela ON public.screen_permission_user;
-- DROP FUNCTION IF EXISTS public.chamado_abrir_acompanha_tela();
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'chamados_sistemas_abrir'
--    AND motivo LIKE 'Automático (mig 20261014000042)%';
-- NOTIFY pgrst, 'reload schema';
