-- SIS-2026-0785 — responsável automático, reabertura e permissões de ação.

-- Registros antigos sem responsável passam a identificar quem os criou.
UPDATE public."LIC_PRAZO_RECURSO"
   SET responsavel_id = coalesce(criado_por, solicitante_id)
 WHERE responsavel_id IS NULL;

-- O responsável não é uma escolha do formulário: é sempre quem criou a demanda.
CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_definir_responsavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.solicitante_id := coalesce(auth.uid(), NEW.solicitante_id);
    NEW.responsavel_id := coalesce(auth.uid(), NEW.solicitante_id);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_definir_responsavel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_aaa_lic_prazo_recurso_definir_responsavel ON public."LIC_PRAZO_RECURSO";
CREATE TRIGGER trg_aaa_lic_prazo_recurso_definir_responsavel
  BEFORE INSERT ON public."LIC_PRAZO_RECURSO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_prazo_recurso_definir_responsavel();

-- Otniel é o destinatário operacional fixo e pode agir mesmo sem o flag;
-- os demais usuários dependem dos flags do Gerenciamento de Acesso.
CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_eh_otniel(p_usuario uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_usuario IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.id = p_usuario
          AND upper(coalesce(p.display_name, '')) LIKE '%OTNIEL%'
     )
$$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_eh_otniel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_prazo_recurso_eh_otniel(uuid) TO authenticated;

UPDATE public.app_menu
   SET nome = 'Marcar ou reabrir demandas de prazos'
 WHERE codigo = 'licitacoes_prazos_recursos_pronto';

CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_controlar_pronto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'concluido' OR OLD.status = 'concluido')
     AND NOT (
       public.lic_prazo_recurso_eh_otniel(auth.uid())
       OR public.has_screen_access(auth.uid(), 'licitacoes_prazos_recursos_pronto', 'alterar'::public.app_acao)
     ) THEN
    RAISE EXCEPTION 'Você não tem permissão para marcar ou reabrir demandas.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_controlar_pronto() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO" FOR DELETE TO authenticated
  USING (
    (SELECT public.lic_prazo_recurso_eh_otniel((SELECT auth.uid())))
    OR (SELECT public.has_screen_access(
      (SELECT auth.uid()),
      'licitacoes_prazos_recursos_excluir',
      'excluir'::public.app_acao
    ))
  );

-- A demanda pronta retorna a quem a criou/solicitou. A lista distinta cobre
-- registros antigos, em que criador, solicitante e responsável podem divergir.
CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_notificar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_otniel uuid;
  v_destinatario uuid;
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

  IF TG_OP = 'UPDATE' AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido' THEN
    FOR v_destinatario IN
      SELECT DISTINCT destino.id
        FROM unnest(ARRAY[NEW.responsavel_id, NEW.solicitante_id, NEW.criado_por]) AS destino(id)
       WHERE destino.id IS NOT NULL
    LOOP
      IF v_destinatario IS DISTINCT FROM auth.uid()
         AND public.has_screen_access(v_destinatario, 'licitacoes_prazos_recursos_notificacao_pronta', 'visualizar'::public.app_acao) THEN
        INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
        VALUES (v_destinatario, 'Demanda pronta', 'O material de ' || NEW.processo || ' está pronto.', 'success',
                '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_notificar() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TRIGGER IF EXISTS trg_aaa_lic_prazo_recurso_definir_responsavel ON public."LIC_PRAZO_RECURSO";
-- DROP FUNCTION IF EXISTS public.lic_prazo_recurso_definir_responsavel();
-- DROP FUNCTION IF EXISTS public.lic_prazo_recurso_eh_otniel(uuid);
-- UPDATE public.app_menu SET nome = 'Marcar demandas de prazos como prontas'
--   WHERE codigo = 'licitacoes_prazos_recursos_pronto';
