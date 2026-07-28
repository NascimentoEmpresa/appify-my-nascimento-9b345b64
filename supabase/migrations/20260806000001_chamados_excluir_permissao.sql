-- =====================================================================
-- CHAMADOS DE SISTEMAS — excluir chamado (capacidade + RLS de DELETE).
--
-- Nova capacidade "chamados_sistemas_excluir" (rota NULL = só permissão),
-- FECHADA por padrão: só apaga quem for liberado em "Acesso por Usuário".
-- A confirmação por senha da conta é feita no front (re-autenticação do
-- próprio usuário antes do DELETE).
--
-- O DELETE do chamado remove em cascata os eventos e anexos (FKs ON DELETE
-- CASCADE). Os arquivos do storage são removidos best-effort pelo front, por
-- isso também liberamos DELETE no bucket para quem tem a capacidade.
-- =====================================================================

-- 1) Capacidade -------------------------------------------------------------
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'chamados_sistemas_excluir', 'Chamados — Excluir chamado (apagar)', NULL, 21
  FROM public.app_modulo m WHERE m.codigo = 'sistemas'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- 2) RLS de DELETE no chamado ----------------------------------------------
DROP POLICY IF EXISTS chamado_sistema_delete ON public."CHAMADO_SISTEMA";
CREATE POLICY chamado_sistema_delete ON public."CHAMADO_SISTEMA"
  FOR DELETE TO authenticated
  USING (public.tem_acesso_menu('chamados_sistemas_excluir'));

-- 3) DELETE no storage do bucket, só para quem tem a capacidade ------------
DROP POLICY IF EXISTS "chamados sistemas anexo delete" ON storage.objects;
CREATE POLICY "chamados sistemas anexo delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chamados-sistemas' AND public.tem_acesso_menu('chamados_sistemas_excluir'));

NOTIFY pgrst, 'reload schema';
