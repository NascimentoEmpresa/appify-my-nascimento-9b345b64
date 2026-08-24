-- =========================================================================
-- URGENTE: "permission denied for table CANAL_DENUNCIA" em TODO o ERP
--
-- SINTOMA
-- Lançar despesa no Malote — módulo que não tem nada a ver com denúncias —
-- falhava com `permission denied for table CANAL_DENUNCIA`.
--
-- CAUSA (minha, na 20260914000005)
-- Duas decisões corretas que, juntas, se mordem:
--
--   1. a 20260914000002 REVOGOU o SELECT de `authenticated` em
--      CANAL_DENUNCIA — a leitura passou a ser pela visão v_canal_denuncia,
--      que mascara a identidade do denunciante;
--   2. a 20260914000005 escreveu as policies das tabelas filhas e do
--      STORAGE assim:
--
--          USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
--                          WHERE d.id = ... AND canal_denuncia_visivel(...)))
--
-- Policy roda com os privilégios de QUEM CONSULTA. Como `authenticated` não
-- tem mais SELECT na tabela, avaliar a policy levanta permission denied — e
-- não adianta a condição ser falsa: o privilégio é conferido antes.
--
-- POR QUE VAZOU PARA O MALOTE
-- `storage.objects` é uma tabela só para o ERP inteiro. Toda operação de
-- arquivo de QUALQUER módulo avalia TODAS as policies dela, inclusive as
-- duas do bucket de evidências. O `bucket_id = 'denuncia-evidencias'` não
-- protege: AND não garante ordem de avaliação, e a checagem de privilégio
-- da tabela referenciada acontece de todo jeito.
--
-- CORREÇÃO
-- A consulta a CANAL_DENUNCIA sai de dentro das policies e vai para uma
-- função SECURITY DEFINER, que lê a tabela com os privilégios do dono. As
-- policies passam a chamar a função — nenhuma delas toca a tabela direto.
--
-- Idempotente.
-- =========================================================================

-- ── 1. A função que as policies passam a chamar ──────────────────────
-- SECURITY DEFINER: é ela que tem o direito de ler CANAL_DENUNCIA, para
-- quem consulta não precisar tê-lo. A regra de quem enxerga o quê continua
-- sendo a mesma da 20260914000005 (canal_denuncia_visivel).
CREATE OR REPLACE FUNCTION public.canal_denuncia_visivel_por_id(_denuncia uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CANAL_DENUNCIA" d
     WHERE d.id = _denuncia
       AND public.canal_denuncia_visivel(d.empresa_id)
  );
$$;

COMMENT ON FUNCTION public.canal_denuncia_visivel_por_id(uuid) IS
  'Usada pelas policies das tabelas filhas e do storage. DEFINER de proposito: authenticated nao tem SELECT em CANAL_DENUNCIA, e policy que consulta a tabela direto estoura permission denied.';

REVOKE ALL ON FUNCTION public.canal_denuncia_visivel_por_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_visivel_por_id(uuid) TO authenticated;

-- Mesma coisa para o storage, onde o dono do arquivo vem do CAMINHO
-- (`<denuncia_id>/...`) e pode não ser um uuid válido — arquivo de outro
-- bucket cai aqui também.
CREATE OR REPLACE FUNCTION public.canal_denuncia_visivel_por_caminho(_nome text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    v_id := split_part(COALESCE(_nome, ''), '/', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;   -- caminho que não começa por uuid não é do canal
  END;
  RETURN public.canal_denuncia_visivel_por_id(v_id);
END $$;

REVOKE ALL ON FUNCTION public.canal_denuncia_visivel_por_caminho(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_visivel_por_caminho(text) TO authenticated;

-- ── 2. STORAGE — o que estava derrubando o resto do ERP ──────────────
DROP POLICY IF EXISTS denuncia_evid_select ON storage.objects;
CREATE POLICY denuncia_evid_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'denuncia-evidencias'
         AND public.canal_denuncia_visivel_por_caminho(name));

DROP POLICY IF EXISTS denuncia_evid_insert ON storage.objects;
CREATE POLICY denuncia_evid_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'denuncia-evidencias'
              AND public.canal_denuncia_visivel_por_caminho(name));

-- ── 3. Tabelas filhas ────────────────────────────────────────────────
DROP POLICY IF EXISTS canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR INSERT TO authenticated
  WITH CHECK (autor = 'comite'
              AND autor_user_id = auth.uid()
              AND public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id))
  WITH CHECK (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO"
  FOR SELECT TO authenticated
  USING ((NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo'))
         AND public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (origem <> 'denunciante'
              AND public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id))
  WITH CHECK (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA";
CREATE POLICY canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA"
  FOR ALL TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id))
  WITH CHECK (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_visivel_por_id(denuncia_id))
  WITH CHECK (public.canal_denuncia_visivel_por_id(denuncia_id));

NOTIFY pgrst, 'reload schema';

-- ── 4. Conferência: nenhuma policy pode citar CANAL_DENUNCIA direto ──
-- Se esta consulta devolver linha, o defeito voltou.
SELECT schemaname, tablename, policyname
  FROM pg_policies
 WHERE (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%CANAL_DENUNCIA"%'
   AND policyname NOT LIKE 'canal_denuncia_select%'
   AND policyname NOT LIKE 'canal_denuncia_update%';

-- =========================================================================
-- ROLLBACK
--   Recriar as policies da 20260914000005 (com EXISTS SELECT direto) e
--   devolver o SELECT: GRANT SELECT ON public."CANAL_DENUNCIA" TO authenticated;
--   — mas isso derruba a máscara de identidade e volta a quebrar o Malote.
-- =========================================================================
