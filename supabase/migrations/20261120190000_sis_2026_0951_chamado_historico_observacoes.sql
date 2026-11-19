-- SIS-2026-0951 — Histórico de observações pessoais do chamado (19/11/2026)
--
-- Complemento do SIS-2026-0938 (mig 20261119050000, marcação Revisar /
-- Revisado). A Observação era UMA coluna em "CHAMADO_SISTEMA_REVISAO": cada
-- gravação substituía a anterior. O pedido: "Salvar observação" grava uma
-- anotação NOVA, com data e hora, sem apagar as anteriores, e o card mostra o
-- "Histórico de observações".
--
-- Mesmas regras da marcação:
--   * tabela própria, ligada ao chamado e ao usuário — nada em
--     "CHAMADO_SISTEMA" (status, fila, prazo, chat, reabertura: nada muda);
--   * RLS por dono, sem bypass de gestor/admin: só quem escreveu lê;
--   * só INSERT e SELECT — não há UPDATE nem DELETE, para nenhuma anotação
--     ser substituída ou perdida. Também independe da marcação: desmarcar ou
--     marcar "Revisado" não apaga o histórico.
--
-- A observação única que já existia vira o primeiro registro do histórico
-- (data = updated_at da marcação).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id  uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  texto       text NOT NULL CHECK (length(btrim(texto)) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chamado_sistema_revisao_observacao_chamado_id_idx
  ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" (chamado_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chamado_sistema_revisao_observacao_user_id_idx
  ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" (user_id);

-- Data e dono são do servidor: o front não escolhe a hora nem o autor.
CREATE OR REPLACE FUNCTION public.chamado_revisao_observacao_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.created_at := now();
  NEW.texto := btrim(NEW.texto);
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_revisao_observacao_carimbo ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO";
CREATE TRIGGER trg_chamado_revisao_observacao_carimbo
  BEFORE INSERT ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_revisao_observacao_carimbo();

ALTER TABLE public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" ENABLE ROW LEVEL SECURITY;

-- Só o dono. Gravar exige enxergar o chamado (RLS de "CHAMADO_SISTEMA" no EXISTS).
DROP POLICY IF EXISTS chamado_revisao_obs_dono_select ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO";
CREATE POLICY chamado_revisao_obs_dono_select ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chamado_revisao_obs_dono_insert ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO";
CREATE POLICY chamado_revisao_obs_dono_insert ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id)
  );

REVOKE ALL ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" FROM anon, authenticated;
GRANT SELECT, INSERT ON public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" TO authenticated;

-- A observação única de antes vira o primeiro item do histórico (uma vez só).
INSERT INTO public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" (chamado_id, user_id, texto, created_at)
SELECT r.chamado_id, r.user_id, btrim(r.observacao), r.updated_at
  FROM public."CHAMADO_SISTEMA_REVISAO" r
 WHERE btrim(COALESCE(r.observacao, '')) <> ''
   AND NOT EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" o
                    WHERE o.chamado_id = r.chamado_id AND o.user_id = r.user_id);

-- O gatilho carimbou now() no backfill: devolve a data original.
UPDATE public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO" o
   SET created_at = r.updated_at
  FROM public."CHAMADO_SISTEMA_REVISAO" r
 WHERE o.chamado_id = r.chamado_id AND o.user_id = r.user_id
   AND o.texto = btrim(r.observacao)
   AND o.created_at > r.updated_at;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_REVISAO_OBSERVACAO";
-- DROP FUNCTION IF EXISTS public.chamado_revisao_observacao_carimbo();
-- NOTIFY pgrst, 'reload schema';
