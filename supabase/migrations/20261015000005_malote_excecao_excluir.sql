-- SIS-2026-0668 (errata): excluir Solicitações de Exceção.
--
-- Exclusão LÓGICA: a solicitação some das telas (a leitura passa a ignorar excluida_em), mas a linha e o histórico
-- ficam no banco para auditoria. Regras:
--   * quem pode: quem pediu ou o aprovador das exceções;
--   * não pode excluir se a senha já foi usada numa despesa (status 'utilizada': a exceção está ligada a ela);
--   * se estava aprovada e a senha ainda não tinha sido usada, a exclusão também a invalida (status vira 'cancelada').
--
-- Depende da 20261015000004. Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 4).

-- BLOCO 1 ─ colunas
ALTER TABLE public.malote_excecao_solicitacao
  ADD COLUMN IF NOT EXISTS excluida_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluida_por uuid REFERENCES auth.users(id);

-- BLOCO 2 ─ o histórico ganha o evento "excluida"
ALTER TABLE public.malote_excecao_solicitacao_evento
  DROP CONSTRAINT IF EXISTS malote_excecao_solicitacao_evento_tipo_evento_check;
ALTER TABLE public.malote_excecao_solicitacao_evento
  ADD CONSTRAINT malote_excecao_solicitacao_evento_tipo_evento_check
  CHECK (tipo_evento IN ('solicitada', 'aprovada', 'reprovada', 'senha_utilizada', 'cancelada', 'excluida'));

-- BLOCO 3 ─ a leitura ignora as excluídas (vale também para o histórico, que lê a solicitação pela RLS)
DROP POLICY IF EXISTS malote_excecao_sol_select ON public.malote_excecao_solicitacao;
CREATE POLICY malote_excecao_sol_select ON public.malote_excecao_solicitacao
  FOR SELECT TO authenticated
  USING (
    excluida_em IS NULL
    AND (
      solicitante_id = auth.uid()
      OR (SELECT public.malote_excecao_pode_decidir(classificacao_id, auth.uid()))
      OR (SELECT public.can_access(auth.uid(), 'malote_excecao_autorizacoes', 'visualizar'))
    )
  );

-- BLOCO 4 ─ excluir
CREATE OR REPLACE FUNCTION public.malote_excecao_excluir(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR s.excluida_em IS NOT NULL THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.solicitante_id <> auth.uid() AND NOT public.malote_excecao_pode_decidir(s.classificacao_id, auth.uid()) THEN
    RAISE EXCEPTION 'Só quem pediu ou o aprovador das exceções pode excluir esta solicitação.';
  END IF;
  IF s.status = 'utilizada' THEN
    RAISE EXCEPTION 'Esta exceção já foi usada na despesa e não pode ser excluída.';
  END IF;

  UPDATE public.malote_excecao_solicitacao
     SET excluida_em = now(),
         excluida_por = auth.uid(),
         status = CASE WHEN status = 'aprovada' THEN 'cancelada' ELSE status END,
         updated_at = now()
   WHERE id = _id;

  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'excluida', auth.uid(),
          CASE WHEN s.status = 'aprovada' THEN 'Solicitação excluída; a senha liberada deixou de valer.' ELSE 'Solicitação excluída.' END);
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_excluir(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.malote_excecao_excluir(uuid);
--   (recriar a policy malote_excecao_sol_select da 20261015000002, sem excluida_em)
--   ALTER TABLE public.malote_excecao_solicitacao_evento DROP CONSTRAINT IF EXISTS malote_excecao_solicitacao_evento_tipo_evento_check;
--   ALTER TABLE public.malote_excecao_solicitacao_evento ADD CONSTRAINT malote_excecao_solicitacao_evento_tipo_evento_check
--     CHECK (tipo_evento IN ('solicitada', 'aprovada', 'reprovada', 'senha_utilizada', 'cancelada'));
--   ALTER TABLE public.malote_excecao_solicitacao DROP COLUMN IF EXISTS excluida_em, DROP COLUMN IF EXISTS excluida_por;
--   NOTIFY pgrst, 'reload schema';
