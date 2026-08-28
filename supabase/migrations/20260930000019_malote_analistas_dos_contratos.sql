-- SIS-2026-0261 (Iury): Aprovações do Malote é uma lista GERAL — qualquer
-- um com visibilidade na despesa vê todas, não só o que é responsabilidade
-- dele. Pedido do Iury: quando a coluna nova "Justificativa pendente"
-- acender, mostrar TAMBÉM o nome de quem precisa justificar (Analista do
-- contrato, ou o Solicitante quando a linha é de Classificação
-- administrativa) — sem isso, quem vê a lista sabe que tem pendência mas
-- não quem cobrar.
--
-- O nome do Solicitante já é resolvido no client sem problema (profiles é
-- legível). O nome do Analista não é: malote_analista_contrato só é
-- legível por admin/controladoria/diretor_adm (20260909000001), então um
-- aprovador comum olhando a lista não teria como resolver esse nome
-- direto. Nova RPC, mesmo padrão de malote_meus_contratos_analista —
-- expõe só o mínimo (contrato_id + nome do analista ativo), nunca a linha
-- de vínculo inteira.
CREATE OR REPLACE FUNCTION public.malote_analistas_dos_contratos(_contrato_ids uuid[])
RETURNS TABLE (contrato_id uuid, user_id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ac.contrato_id, ac.analista_user_id, coalesce(p.display_name, p.email, ac.analista_user_id::text)
  FROM public.malote_analista_contrato ac
  JOIN public.profiles p ON p.id = ac.analista_user_id
  WHERE ac.ativo AND ac.contrato_id = ANY(_contrato_ids);
$$;

REVOKE ALL ON FUNCTION public.malote_analistas_dos_contratos(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.malote_analistas_dos_contratos(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.malote_analistas_dos_contratos(uuid[]);
-- =====================================================================
