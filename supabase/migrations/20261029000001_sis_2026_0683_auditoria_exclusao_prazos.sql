-- SIS-2026-0683 — auditoria completa e exclusão controlada de demandas.

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'licitacoes_prazos_recursos_excluir', 'Excluir demandas de prazos',
       NULL, 285, true
  FROM public.app_modulo m WHERE m.codigo = 'licitacoes'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = NULL, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'licitacoes_prazos_recursos_excluir', 'excluir'::public.app_acao, true
  FROM public.perfil_acesso pa WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

ALTER TABLE public."LIC_PRAZO_RECURSO"
  ADD COLUMN IF NOT EXISTS criado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS atualizado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public."LIC_PRAZO_RECURSO_HISTORICO" (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demanda_id uuid NOT NULL,
  acao text NOT NULL CHECK (acao IN ('criado', 'alterado', 'excluido')),
  usuario_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  dados_anteriores jsonb,
  dados_novos jsonb
);
CREATE INDEX IF NOT EXISTS idx_lic_prazo_recurso_historico_demanda
  ON public."LIC_PRAZO_RECURSO_HISTORICO"(demanda_id, ocorrido_em DESC);

CREATE OR REPLACE FUNCTION public.lic_prazo_recurso_auditar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := coalesce(NEW.criado_por, auth.uid());
    NEW.atualizado_por := coalesce(NEW.atualizado_por, auth.uid());
    INSERT INTO public."LIC_PRAZO_RECURSO_HISTORICO"(demanda_id, acao, usuario_id, dados_novos)
    VALUES (NEW.id, 'criado', auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.criado_por := OLD.criado_por;
    NEW.atualizado_por := auth.uid();
    INSERT INTO public."LIC_PRAZO_RECURSO_HISTORICO"(demanda_id, acao, usuario_id, dados_anteriores, dados_novos)
    VALUES (NEW.id, 'alterado', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  INSERT INTO public."LIC_PRAZO_RECURSO_HISTORICO"(demanda_id, acao, usuario_id, dados_anteriores)
  VALUES (OLD.id, 'excluido', auth.uid(), to_jsonb(OLD));
  RETURN OLD;
END $fn$;
REVOKE ALL ON FUNCTION public.lic_prazo_recurso_auditar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lic_prazo_recurso_auditar ON public."LIC_PRAZO_RECURSO";
CREATE TRIGGER trg_lic_prazo_recurso_auditar
  BEFORE INSERT OR UPDATE OR DELETE ON public."LIC_PRAZO_RECURSO"
  FOR EACH ROW EXECUTE FUNCTION public.lic_prazo_recurso_auditar();

ALTER TABLE public."LIC_PRAZO_RECURSO_HISTORICO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."LIC_PRAZO_RECURSO_HISTORICO" TO authenticated;
DROP POLICY IF EXISTS lic_prazo_recurso_historico_select ON public."LIC_PRAZO_RECURSO_HISTORICO";
CREATE POLICY lic_prazo_recurso_historico_select ON public."LIC_PRAZO_RECURSO_HISTORICO" FOR SELECT TO authenticated
  USING (public.lic_prazos_pode('visualizar'));

DROP POLICY IF EXISTS lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO";
CREATE POLICY lic_prazo_recurso_delete ON public."LIC_PRAZO_RECURSO" FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'licitacoes_prazos_recursos_excluir', 'excluir'::public.app_acao));

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."LIC_PRAZO_RECURSO_HISTORICO";
-- DROP TRIGGER IF EXISTS trg_lic_prazo_recurso_auditar ON public."LIC_PRAZO_RECURSO";
-- DROP FUNCTION IF EXISTS public.lic_prazo_recurso_auditar();
-- ALTER TABLE public."LIC_PRAZO_RECURSO" DROP COLUMN IF EXISTS criado_por, DROP COLUMN IF EXISTS atualizado_por;
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'licitacoes_prazos_recursos_excluir';
-- DELETE FROM public.app_menu WHERE codigo = 'licitacoes_prazos_recursos_excluir';
