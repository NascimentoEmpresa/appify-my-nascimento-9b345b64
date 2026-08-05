-- =========================================================================
-- NASCIMENTO FORMULÁRIOS — líder de setor conclui plano de ação
--
-- Até aqui só quem tinha 'ver_tudo' (ou 'ver_proprias', nas próprias) conseguia
-- ler/gravar o acompanhamento dos planos (CS_FORM_PLANOS_ACAO). Os LÍDERES de
-- setor (gerente/diretor do setor) não conseguiam marcar um plano como concluído.
--
-- Este ramo CONCEDE, a quem lidera o setor do plano, ler e gravar o
-- acompanhamento daquele plano (concluir + descrição). O setor do plano é:
--   • o setor da RESPOSTA de origem, quando o plano vem do formulário;
--   • o próprio setor da linha, quando é um plano avulso.
--
-- DEPENDÊNCIA: usa public.cs_form_lidera_setor(text) (recorte por liderança,
-- migration 20260801000001). Como esse ramo pode NÃO ter sido aplicado neste
-- banco (é o que gera "function cs_form_lidera_setor(text) does not exist"),
-- esta migration recria a dependência de forma idempotente ANTES de usá-la:
-- as tabelas CS_LIDERES_SETOR / RH_SETOR_DIRETOR e a própria função. Se já
-- existirem, os comandos são no-op.
--
-- Segurança: cs_form_plano_setor é SECURITY DEFINER só para ler o setor da
-- resposta por baixo da RLS; para plano do formulário o setor autoritativo é
-- SEMPRE o da resposta (não o que o cliente mandou na linha). DELETE continua
-- exclusivo de 'ver_tudo'.
--
-- Idempotente. Aplicar no banco do app (traz o NOTIFY do PostgREST no fim).
-- =========================================================================

-- ── Dependência (idempotente): líder por setor ───────────────────────────
CREATE TABLE IF NOT EXISTS public."CS_LIDERES_SETOR" (
  setor              text PRIMARY KEY,
  empregado_id       bigint NOT NULL,
  empregado_nome     text,
  observacao         text,
  definido_por       uuid DEFAULT auth.uid(),
  definido_por_nome  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."CS_LIDERES_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_LIDERES_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_LIDERES_SETOR" TO authenticated;
DROP POLICY IF EXISTS cs_lideres_select ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_select ON public."CS_LIDERES_SETOR"
  FOR SELECT TO authenticated USING (public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias'));
DROP POLICY IF EXISTS cs_lideres_ins ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_ins ON public."CS_LIDERES_SETOR"
  FOR INSERT TO authenticated WITH CHECK (public.cs_form_cap('ver_tudo'));
DROP POLICY IF EXISTS cs_lideres_upd ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_upd ON public."CS_LIDERES_SETOR"
  FOR UPDATE TO authenticated USING (public.cs_form_cap('ver_tudo'));
DROP POLICY IF EXISTS cs_lideres_del ON public."CS_LIDERES_SETOR";
CREATE POLICY cs_lideres_del ON public."CS_LIDERES_SETOR"
  FOR DELETE TO authenticated USING (public.cs_form_cap('ver_tudo'));

CREATE TABLE IF NOT EXISTS public."RH_SETOR_DIRETOR" (
  setor          text PRIMARY KEY,
  diretor_id     bigint NOT NULL,
  diretor_nome   text,
  definido_por   uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."RH_SETOR_DIRETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."RH_SETOR_DIRETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."RH_SETOR_DIRETOR" TO authenticated;
DROP POLICY IF EXISTS rh_setor_diretor_all ON public."RH_SETOR_DIRETOR";
CREATE POLICY rh_setor_diretor_all ON public."RH_SETOR_DIRETOR"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Sou gerente/líder OU diretor do setor? (SECURITY DEFINER lê as tabelas por
-- baixo da RLS; devolve só true/false para a linha em avaliação.)
CREATE OR REPLACE FUNCTION public.cs_form_lidera_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid()
       AND (
         EXISTS (SELECT 1 FROM public."CS_LIDERES_SETOR" l
                  WHERE l.empregado_id = e."ID"
                    AND upper(btrim(l.setor)) = upper(btrim(_setor)))
      OR EXISTS (SELECT 1 FROM public."RH_SETOR_DIRETOR" d
                  WHERE d.diretor_id = e."ID"
                    AND upper(btrim(d.setor)) = upper(btrim(_setor)))
       ));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) TO authenticated;

-- ── Feature: setor efetivo do plano + políticas ──────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_plano_setor(_setor text, _resposta_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT r.setor FROM public."CS_FORM_RESPOSTAS" r WHERE r.id = _resposta_id),
    NULLIF(btrim(_setor), '')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_plano_setor(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_plano_setor(text, uuid) TO authenticated;

-- SELECT: + líder do setor do plano (para ver o status/descrição gravados).
DROP POLICY IF EXISTS cs_planos_select ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_select ON public."CS_FORM_PLANOS_ACAO"
  FOR SELECT TO authenticated USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

-- INSERT: + líder do setor do plano (1ª conclusão de um plano do formulário
-- cria a linha de acompanhamento). O WITH CHECK lê o setor real da resposta.
DROP POLICY IF EXISTS cs_planos_insert ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_insert ON public."CS_FORM_PLANOS_ACAO"
  FOR INSERT TO authenticated WITH CHECK (
    public.cs_form_cap('ver_tudo') OR public.cs_form_cap('ver_proprias')
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

-- UPDATE: + líder do setor do plano (USING e WITH CHECK).
DROP POLICY IF EXISTS cs_planos_update ON public."CS_FORM_PLANOS_ACAO";
CREATE POLICY cs_planos_update ON public."CS_FORM_PLANOS_ACAO"
  FOR UPDATE TO authenticated
  USING (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)))
  WITH CHECK (
    public.cs_form_cap('ver_tudo')
    OR (public.cs_form_cap('ver_proprias') AND criado_por = auth.uid())
    OR public.cs_form_lidera_setor(public.cs_form_plano_setor(setor, resposta_id)));

NOTIFY pgrst, 'reload schema';
