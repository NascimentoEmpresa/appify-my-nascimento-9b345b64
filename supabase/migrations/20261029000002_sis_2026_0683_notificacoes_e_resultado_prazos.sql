-- SIS-2026-0683 — destino fixo Otniel, notificações controladas e resultado.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, NULL, x.ordem, true
  FROM public.app_modulo m
 CROSS JOIN (VALUES
   ('licitacoes_prazos_recursos_pronto', 'Marcar demandas de prazos como prontas', 286),
   ('licitacoes_prazos_recursos_notificacao_criada', 'Notificação de demanda criada', 287),
   ('licitacoes_prazos_recursos_notificacao_pronta', 'Notificação de demanda pronta', 288)
 ) AS x(codigo, nome, ordem)
 WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = NULL, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, x.codigo, x.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('licitacoes_prazos_recursos_pronto', 'alterar'::public.app_acao),
   ('licitacoes_prazos_recursos_notificacao_criada', 'visualizar'::public.app_acao),
   ('licitacoes_prazos_recursos_notificacao_pronta', 'visualizar'::public.app_acao)
 ) AS x(codigo, acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_controlar_pronto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido'
     AND NOT public.has_screen_access(auth.uid(), 'licitacoes_prazos_recursos_pronto', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Você não tem permissão para marcar demandas como prontas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_controlar_pronto() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lic_prazo_recurso_controlar_pronto ON public."LIC_PRAZO_RECURSO";
CREATE TRIGGER trg_lic_prazo_recurso_controlar_pronto
  BEFORE UPDATE OF status ON public."LIC_PRAZO_RECURSO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_prazo_recurso_controlar_pronto();

-- Substitui o gatilho inicial: "Para" é sempre Otniel e "De" é o responsável.
CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_notificar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_otniel uuid;
BEGIN
  SELECT id INTO v_otniel FROM public.profiles
   WHERE upper(coalesce(display_name, '')) LIKE '%OTNIEL%'
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;

  IF TG_OP = 'INSERT' AND v_otniel IS NOT NULL
     AND public.has_screen_access(v_otniel, 'licitacoes_prazos_recursos_notificacao_criada', 'visualizar'::public.app_acao) THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (v_otniel, 'Nova demanda de prazo', 'Você recebeu a demanda ' || NEW.processo || '.', 'info',
            '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.responsavel_id IS NOT NULL
     AND public.has_screen_access(NEW.responsavel_id, 'licitacoes_prazos_recursos_notificacao_pronta', 'visualizar'::public.app_acao) THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (NEW.responsavel_id, 'Demanda pronta', 'O material de ' || NEW.processo || ' está pronto.', 'success',
            '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_notificar() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
