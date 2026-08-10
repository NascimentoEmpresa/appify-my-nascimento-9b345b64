-- SIS-2026-0095 (piloto a pedido do Eduardo/chefe): testar, em pequena
-- escala e só nas tabelas do Malote criadas em
-- 20260829000002_malote_despesa.sql, uma checagem de supervisão baseada
-- em profiles.cargo (texto livre do RH) em vez de has_role('controladoria')
-- / has_role('diretor_adm').
--
-- has_role('admin') é mantido como está — é role de sistema/TI, não
-- corresponde a nenhum cargo do RH. Cargo PRESIDENTE passa a valer como
-- equivalente de admin nessas tabelas, a pedido do chefe.
--
-- Mapeamento combinado (SIS-2026-0095, ajuste de permissões):
--   equivalente de 'controladoria': cargo contém CONTROLADORIA, DIRETOR(A)
--     ou SISTEMAS ("área da controladoria, direção e sistemas")
--   equivalente de 'diretor_adm': cargo contém DIRETOR
--   equivalente de 'admin' (além do has_role): cargo = PRESIDENTE
--
-- IMPORTANTE: profiles.cargo é texto livre digitado no cadastro do RH,
-- sem padronização — ao contrário de has_role()/user_roles, que é um
-- enum curado. Esse é o motivo de termos evitado essa abordagem antes;
-- este piloto serve para validar na prática se a manutenção desses
-- padrões de texto é viável antes de considerar expandir pro resto do
-- sistema (1164 usos de has_role em 136 migrations fora do Malote).
CREATE OR REPLACE FUNCTION public.malote_supervisor_por_cargo(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND (
        p.cargo ILIKE '%CONTROLADORIA%'
        OR p.cargo ILIKE '%DIRETOR%'
        OR p.cargo ILIKE '%SISTEMAS%'
        OR p.cargo = 'PRESIDENTE'
      )
  );
$$;

-- ---------------------------------------------------------------------
-- malote_despesa
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS malote_despesa_select ON public.malote_despesa;
CREATE POLICY malote_despesa_select ON public.malote_despesa FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR empresa_id = get_user_empresa(auth.uid())
  );

DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )
  WITH CHECK (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  );

DROP POLICY IF EXISTS malote_despesa_delete ON public.malote_despesa;
CREATE POLICY malote_despesa_delete ON public.malote_despesa FOR DELETE TO authenticated
  USING (
    (created_by = auth.uid() AND status = 'rascunho')
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  );

-- ---------------------------------------------------------------------
-- malote_despesa_rateio_linha
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR d.empresa_id = get_user_empresa(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

-- ---------------------------------------------------------------------
-- malote_despesa_parcela
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR d.empresa_id = get_user_empresa(auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

-- ---------------------------------------------------------------------
-- storage.objects (anexos do malote-anexos)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "malote_anexos_delete" ON storage.objects;
CREATE POLICY "malote_anexos_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'malote-anexos' AND (
    owner = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
