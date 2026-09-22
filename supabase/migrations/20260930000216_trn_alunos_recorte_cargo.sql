-- =========================================================================
-- Treinamentos › Ações em massa: recorte por CARGO
--
-- Pedido (22/09/2026): "adicionar um curso pra todos os Supervisores" —
-- precisa de um recorte por cargo igual ao que já existe por contrato,
-- olhando só quem está Trabalhando (cargo de quem já saiu não entra: o
-- valor fica gravado no histórico do TRN_ALUNO mas não representa o cargo
-- atual de ninguém).
--
-- trn_alunos_recorte() só ganha o campo `cargo` a mais no jsonb — o filtro
-- por status ativo quem faz é o front (cadastro já traz o status de cada
-- aluno, igual já faz pra contrato).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_alunos_recorte()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'contrato', contrato, 'cargo', cargo, 'status', status)), '[]'::jsonb)
            FROM public."TRN_ALUNO");
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_recorte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_recorte() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- CREATE OR REPLACE FUNCTION public.trn_alunos_recorte()
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
-- BEGIN
--   IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
--     RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
--   END IF;
--   RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'contrato', contrato, 'status', status)), '[]'::jsonb)
--             FROM public."TRN_ALUNO");
-- END $fn$;
-- NOTIFY pgrst, 'reload schema';
