-- =========================================================================
-- Organograma: cor do card (01/10/2026)
--
-- PEDIDO (Pablo): "perfumaria, coloca uma maneira de colocar cor nas
-- caixinhas". Cada nó ganha uma cor opcional (hex #RRGGBB) — o card pinta a
-- faixa do topo, a borda e um fundo bem claro com ela. NULL = card neutro,
-- como era. Na tela dá para pintar a pessoa sozinha ou a equipe inteira
-- abaixo dela (o front faz um UPDATE ... WHERE id IN (...), sem RPC nova).
--
-- organograma_nos() muda o tipo de retorno (coluna cor no fim) → precisa de
-- DROP antes do CREATE; o REVOKE/GRANT vai junto de novo.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS cor text;

ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_cor_hex;
ALTER TABLE public."ORGANOGRAMA_NO"
  ADD CONSTRAINT organograma_no_cor_hex CHECK (cor IS NULL OR cor ~ '^#[0-9a-fA-F]{6}$');

DROP FUNCTION IF EXISTS public.organograma_nos();
CREATE FUNCTION public.organograma_nos()
RETURNS TABLE (
  id uuid, user_id uuid, parent_id uuid, ordem integer, funcao_manual text,
  nome text, email text, avatar_url text, cargo text, setor text, ativo boolean, cor text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'organograma', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.user_id, o.parent_id, o.ordem, nullif(btrim(o.funcao), ''),
         coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário'),
         p.email, p.avatar_url,
         coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(p.cargo), '')),
         coalesce(nullif(btrim(e."Setor_ERP"), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = o.user_id)),
         coalesce(p.ativo, false),
         o.cor
    FROM public."ORGANOGRAMA_NO" o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT x."Título do Cargo", x."Setor_ERP" FROM public."EMPREGADOS" x
       WHERE x.auth_user_id = o.user_id
       ORDER BY (x."Situação" = 'Trabalhando') DESC NULLS LAST, x."ID" DESC LIMIT 1
    ) e ON true
   ORDER BY o.ordem, 6;
END;
$$;
REVOKE ALL ON FUNCTION public.organograma_nos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_nos() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (recriar organograma_nos() sem a coluna cor — corpo da mig 277)
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.organograma_nos();
-- -- (reexecutar o bloco 4 da 20260930000277_organograma.sql)
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_cor_hex;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN IF EXISTS cor;
-- NOTIFY pgrst, 'reload schema';
