-- SIS-2026-0683 — Controle de prazos, recursos e impugnações.
-- Uma linha representa uma demanda, independentemente da modalidade. Isso
-- permite que o painel consolide as cinco abas da planilha sem duplicar regras.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'licitacoes_prazos_recursos', 'Prazos, Recursos e Impugnações',
       '/app/licitacoes/prazos-recursos', 284, true
  FROM public.app_modulo m WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'licitacoes_prazos_recursos', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                     ('alterar'::public.app_acao), ('excluir'::public.app_acao)) a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lic_prazos_pode(p_acao text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.has_screen_access(auth.uid(), 'licitacoes_prazos_recursos', p_acao::public.app_acao)
$$;
REVOKE ALL ON FUNCTION public.lic_prazos_pode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lic_prazos_pode(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public."LIC_PRAZO_RECURSO" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modalidade text NOT NULL CHECK (modalidade IN ('recurso', 'impugnacao', 'mandado_seguranca', 'denuncia_tce', 'repactuacao')),
  processo text NOT NULL,
  orgao text,
  objeto text,
  prazo date,
  protocolo_em date,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_andamento', 'protocolado', 'concluido', 'cancelado')),
  resultado text CHECK (resultado IN ('favoravel', 'parcial', 'desfavoravel')),
  responsavel_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  solicitante_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  observacoes text,
  concluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lic_prazo_recurso_prazo ON public."LIC_PRAZO_RECURSO"(prazo);
CREATE INDEX IF NOT EXISTS idx_lic_prazo_recurso_responsavel ON public."LIC_PRAZO_RECURSO"(responsavel_id);

CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_carimbar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'concluido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'concluido') THEN
    NEW.concluido_em := now();
  ELSIF NEW.status <> 'concluido' THEN
    NEW.concluido_em := NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_carimbar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lic_prazo_recurso_carimbar ON public."LIC_PRAZO_RECURSO";
CREATE TRIGGER trg_lic_prazo_recurso_carimbar BEFORE INSERT OR UPDATE ON public."LIC_PRAZO_RECURSO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_prazo_recurso_carimbar();

-- O alerta é in-app, visível no sino e abre o lançamento correspondente.
CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_notificar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.responsavel_id IS NOT NULL AND NEW.responsavel_id IS DISTINCT FROM NEW.solicitante_id THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (NEW.responsavel_id, 'Nova demanda de prazo',
            'Você recebeu a demanda ' || NEW.processo || '.', 'info',
            '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
  ELSIF TG_OP = 'UPDATE' AND NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
        AND NEW.responsavel_id IS NOT NULL AND NEW.responsavel_id IS DISTINCT FROM NEW.solicitante_id THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (NEW.responsavel_id, 'Nova demanda de prazo',
            'Você recebeu a demanda ' || NEW.processo || '.', 'info',
            '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'concluido' AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.solicitante_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
    VALUES (NEW.solicitante_id, 'Demanda concluída',
            'O material de ' || NEW.processo || ' está pronto.', 'success',
            '/app/licitacoes/prazos-recursos?demanda=' || NEW.id);
  END IF;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_notificar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lic_prazo_recurso_notificar ON public."LIC_PRAZO_RECURSO";
CREATE TRIGGER trg_lic_prazo_recurso_notificar AFTER INSERT OR UPDATE ON public."LIC_PRAZO_RECURSO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_prazo_recurso_notificar();

ALTER TABLE public."LIC_PRAZO_RECURSO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."LIC_PRAZO_RECURSO" TO authenticated;
DROP POLICY IF EXISTS lic_prazo_recurso_select ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_select ON public."LIC_PRAZO_RECURSO" FOR SELECT TO authenticated USING (public.lic_prazos_pode('visualizar'));
DROP POLICY IF EXISTS lic_prazo_recurso_insert ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_insert ON public."LIC_PRAZO_RECURSO" FOR INSERT TO authenticated WITH CHECK (public.lic_prazos_pode('incluir'));
DROP POLICY IF EXISTS lic_prazo_recurso_update ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_update ON public."LIC_PRAZO_RECURSO" FOR UPDATE TO authenticated USING (public.lic_prazos_pode('alterar')) WITH CHECK (public.lic_prazos_pode('alterar'));
DROP POLICY IF EXISTS lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO" FOR DELETE TO authenticated USING (public.lic_prazos_pode('excluir'));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."LIC_PRAZO_RECURSO";
-- DROP FUNCTION IF EXISTS public.lic_prazos_pode(text);
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'licitacoes_prazos_recursos';
-- DELETE FROM public.app_menu WHERE codigo = 'licitacoes_prazos_recursos';
