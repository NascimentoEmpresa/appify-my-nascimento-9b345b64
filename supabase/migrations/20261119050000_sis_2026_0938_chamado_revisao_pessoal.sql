-- SIS-2026-0938 — Marcação pessoal de revisão do chamado (18/11/2026)
--
-- O solicitante quer separar, na lista "Meus chamados", o que ainda quer
-- revisar com calma: botão Revisar (amarelo = marcado) e, no detalhe, uma
-- observação privada + botão "Revisado" (verde = revisão finalizada).
--
-- É um lembrete PESSOAL, totalmente fora do fluxo do chamado:
--   * tabela própria — nada de coluna em "CHAMADO_SISTEMA", cujos gatilhos de
--     status/fila/monitoramento disparariam a cada clique;
--   * não altera status, responsável, fila, prazo, avaliação, Monitoramento,
--     nota da I.A nem efetividade; não reabre; não vira mensagem no chat;
--   * não entra na trava de 3 pendências (confirmar/avaliar) para abrir chamado;
--   * RLS por dono: só user_id = auth.uid() lê e escreve. O time de Sistemas
--     (nem o gestor) não vê a marcação nem a observação.

CREATE TABLE IF NOT EXISTS public."CHAMADO_SISTEMA_REVISAO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chamado_id   uuid NOT NULL REFERENCES public."CHAMADO_SISTEMA"(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  estado       text NOT NULL DEFAULT 'revisar' CHECK (estado IN ('revisar', 'revisado')),
  observacao   text,
  marcado_em   timestamptz NOT NULL DEFAULT now(),
  revisado_em  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chamado_sistema_revisao_unica UNIQUE (chamado_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chamado_sistema_revisao_user
  ON public."CHAMADO_SISTEMA_REVISAO" (user_id);

-- Datas coerentes com o estado, sem depender do front.
CREATE OR REPLACE FUNCTION public.chamado_revisao_datas()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.estado = 'revisado' THEN
    IF TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'revisado' THEN
      NEW.revisado_em := now();
    END IF;
  ELSE
    NEW.revisado_em := NULL;
    IF TG_OP = 'UPDATE' AND OLD.estado = 'revisado' THEN
      NEW.marcado_em := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chamado_revisao_datas ON public."CHAMADO_SISTEMA_REVISAO";
CREATE TRIGGER trg_chamado_revisao_datas
  BEFORE INSERT OR UPDATE ON public."CHAMADO_SISTEMA_REVISAO"
  FOR EACH ROW EXECUTE FUNCTION public.chamado_revisao_datas();

ALTER TABLE public."CHAMADO_SISTEMA_REVISAO" ENABLE ROW LEVEL SECURITY;

-- Só o dono. Não há bypass de gestor/admin de propósito: é anotação privada.
-- Marcar exige enxergar o chamado (RLS de "CHAMADO_SISTEMA" no EXISTS).
DROP POLICY IF EXISTS chamado_revisao_dono_select ON public."CHAMADO_SISTEMA_REVISAO";
CREATE POLICY chamado_revisao_dono_select ON public."CHAMADO_SISTEMA_REVISAO"
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chamado_revisao_dono_insert ON public."CHAMADO_SISTEMA_REVISAO";
CREATE POLICY chamado_revisao_dono_insert ON public."CHAMADO_SISTEMA_REVISAO"
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public."CHAMADO_SISTEMA" c WHERE c.id = chamado_id)
  );

DROP POLICY IF EXISTS chamado_revisao_dono_update ON public."CHAMADO_SISTEMA_REVISAO";
CREATE POLICY chamado_revisao_dono_update ON public."CHAMADO_SISTEMA_REVISAO"
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chamado_revisao_dono_delete ON public."CHAMADO_SISTEMA_REVISAO";
CREATE POLICY chamado_revisao_dono_delete ON public."CHAMADO_SISTEMA_REVISAO"
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public."CHAMADO_SISTEMA_REVISAO" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CHAMADO_SISTEMA_REVISAO" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."CHAMADO_SISTEMA_REVISAO";
-- DROP FUNCTION IF EXISTS public.chamado_revisao_datas();
-- NOTIFY pgrst, 'reload schema';
