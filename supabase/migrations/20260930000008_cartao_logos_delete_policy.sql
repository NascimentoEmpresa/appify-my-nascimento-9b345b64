-- Ajuste na 20260930000007: bucket cartao-logos tinha só policy de
-- INSERT/UPDATE em storage.objects, sem DELETE — precisei trocar o logo
-- do Visa (fundo preto no arquivo original) e o `storage rm` falhava
-- silenciosamente (RLS nega, sem erro visível). Mesmo menu já usado pro
-- resto do bucket, sem inventar has_role novo.

CREATE POLICY cartao_logos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'cartao-logos' AND public.can_access(auth.uid(), 'financeiro-cartao-credito', 'alterar'::public.app_acao));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP POLICY IF EXISTS cartao_logos_delete ON storage.objects;
-- =====================================================================
