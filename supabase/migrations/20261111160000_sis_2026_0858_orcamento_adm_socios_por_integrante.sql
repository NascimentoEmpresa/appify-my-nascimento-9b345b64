-- SIS-2026-0858 — Orçamento ADM e Sócios (novo) passa a ser POR INTEGRANTE (continuação do SIS-2026-0830; modelo do HTML do Iury)
-- ============================================================================
-- A tela deixa de ter uma linha por Classificação (SIS-2026-0702, tabela orcamento_adm_socios_linha, que fica no banco sem uso) e passa a ter
-- uma linha por PESSOA (usuário do ERP):
--   · orcamento_adm_socios_integrante : 1 linha por usuário configurado ou movido para Sócios. Quem não tem linha está no Administrativo, sem
--     configuração. tipo = aba onde a pessoa está (uma só por vez: PK no usuário). classificacao_malote_id = a ÚNICA classificação de origem;
--     contrato_ids = centros de custo de onde sai o orçamento (um ou mais contratos).
--   · orcamento_adm_socios_pessoas()  : quem aparece na lista. Usuários ATIVOS do ERP e o(s) setor(es) do Gerenciamento de Acesso (user_setor).
--     Parte do USUÁRIO, e não do colaborador (EMPREGADOS.auth_user_id), porque nem todo usuário tem colaborador vinculado (ex.: sócio Antonio Vianei, e 18
--     usuários ativos em 11/11/2026). Fica de fora quem só está no setor "Encarregados" (campo, não escritório). SECURITY DEFINER para ler user_setor;
--     devolve só id, nome e setores, para quem pode visualizar a tela.
-- Policies com (SELECT can_access((SELECT auth.uid()), ...)): o Postgres avalia uma vez, não por linha (guardião de desempenho).
-- Acesso: can_access no menu já existente 'malote_orcamento_adm_socios' (visualizar/incluir/alterar/excluir). Idempotente. NOTIFY no fim.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.orcamento_adm_socios_pessoas();
--   DROP TABLE IF EXISTS public.orcamento_adm_socios_integrante;
--   NOTIFY pgrst, 'reload schema';

-- Banco que já recebeu a 1ª versão desta migration (chave = empregado_id, colaborador): converte para a chave por USUÁRIO sem perder o que já foi
-- gravado (em 11/11/2026 havia 4 sócios). O usuário vem do vínculo EMPREGADOS.auth_user_id; linha sem vínculo não tem como virar usuário e é
-- descartada com aviso. Só roda se a tabela ainda tiver empregado_id e não tiver user_id.
DO $$
DECLARE
  v_sem_vinculo int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamento_adm_socios_integrante' AND column_name = 'empregado_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamento_adm_socios_integrante' AND column_name = 'user_id') THEN
    ALTER TABLE public.orcamento_adm_socios_integrante ADD COLUMN user_id uuid;
    UPDATE public.orcamento_adm_socios_integrante i
       SET user_id = e.auth_user_id
      FROM public."EMPREGADOS" e
     WHERE e."ID" = i.empregado_id AND e.auth_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = e.auth_user_id);
    SELECT count(*) INTO v_sem_vinculo FROM public.orcamento_adm_socios_integrante WHERE user_id IS NULL;
    IF v_sem_vinculo > 0 THEN
      RAISE NOTICE '% linha(s) sem usuário vinculado ao colaborador foram descartadas na conversão.', v_sem_vinculo;
      DELETE FROM public.orcamento_adm_socios_integrante WHERE user_id IS NULL;
    END IF;
    ALTER TABLE public.orcamento_adm_socios_integrante DROP CONSTRAINT IF EXISTS orcamento_adm_socios_integrante_pkey;
    ALTER TABLE public.orcamento_adm_socios_integrante DROP COLUMN empregado_id;
    ALTER TABLE public.orcamento_adm_socios_integrante ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE public.orcamento_adm_socios_integrante ADD PRIMARY KEY (user_id);
    ALTER TABLE public.orcamento_adm_socios_integrante ADD CONSTRAINT orcamento_adm_socios_integrante_user_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.orcamento_adm_socios_integrante (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'administrativo' CHECK (tipo IN ('administrativo', 'socios')),
  classificacao_malote_id uuid,
  contrato_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS orcamento_adm_socios_integrante_set_updated ON public.orcamento_adm_socios_integrante;
CREATE TRIGGER orcamento_adm_socios_integrante_set_updated
  BEFORE UPDATE ON public.orcamento_adm_socios_integrante
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.orcamento_adm_socios_integrante ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_adm_socios_integrante_select ON public.orcamento_adm_socios_integrante;
CREATE POLICY orcamento_adm_socios_integrante_select ON public.orcamento_adm_socios_integrante
  FOR SELECT TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'malote_orcamento_adm_socios', 'visualizar'::public.app_acao)));

DROP POLICY IF EXISTS orcamento_adm_socios_integrante_insert ON public.orcamento_adm_socios_integrante;
CREATE POLICY orcamento_adm_socios_integrante_insert ON public.orcamento_adm_socios_integrante
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.can_access((SELECT auth.uid()), 'malote_orcamento_adm_socios', 'incluir'::public.app_acao)));

DROP POLICY IF EXISTS orcamento_adm_socios_integrante_update ON public.orcamento_adm_socios_integrante;
CREATE POLICY orcamento_adm_socios_integrante_update ON public.orcamento_adm_socios_integrante
  FOR UPDATE TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'malote_orcamento_adm_socios', 'alterar'::public.app_acao)))
  WITH CHECK ((SELECT public.can_access((SELECT auth.uid()), 'malote_orcamento_adm_socios', 'alterar'::public.app_acao)));

DROP POLICY IF EXISTS orcamento_adm_socios_integrante_delete ON public.orcamento_adm_socios_integrante;
CREATE POLICY orcamento_adm_socios_integrante_delete ON public.orcamento_adm_socios_integrante
  FOR DELETE TO authenticated
  USING ((SELECT public.can_access((SELECT auth.uid()), 'malote_orcamento_adm_socios', 'excluir'::public.app_acao)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_adm_socios_integrante TO authenticated;

-- o tipo de retorno mudou (empregado_id bigint → user_id uuid): CREATE OR REPLACE não aceita, então derruba a anterior
DROP FUNCTION IF EXISTS public.orcamento_adm_socios_pessoas();
CREATE OR REPLACE FUNCTION public.orcamento_adm_socios_pessoas()
RETURNS TABLE (user_id uuid, nome text, setores text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'malote_orcamento_adm_socios', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para ver o Orçamento ADM e Sócios.';
  END IF;
  RETURN QUERY
    SELECT p.id, p.display_name::text,
           COALESCE(array_agg(DISTINCT us.setor ORDER BY us.setor) FILTER (WHERE us.setor IS NOT NULL), '{}'::text[])
      FROM public.profiles p
      LEFT JOIN public.user_setor us ON us.user_id = p.id
     WHERE p.ativo
     GROUP BY p.id, p.display_name
    HAVING NOT (count(us.setor) > 0 AND bool_and(us.setor = 'Encarregados'))
     ORDER BY p.display_name;
END;
$$;
REVOKE ALL ON FUNCTION public.orcamento_adm_socios_pessoas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orcamento_adm_socios_pessoas() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
