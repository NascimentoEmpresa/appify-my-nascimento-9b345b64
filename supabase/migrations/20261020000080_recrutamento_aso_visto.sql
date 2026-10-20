-- =====================================================================
-- Gestão Recrutamento › ASOs Agendados — "MARCAR COMO VISTO" (20/10/2026).
--
-- Pedido do Pablo: na janela de ASOs Agendados, um jeito de marcar o ASO
-- como já visualizado, e os novos ficarem pendentes até alguém clicar.
--
-- O "visto" é da EQUIPE, não de cada pessoa: a recrutadora que já tratou o
-- agendamento (avisou o candidato) marca, e as outras veem "Visto por Fulana
-- às 09:12" — é isso que evita dois avisos para o mesmo candidato.
--
-- A chave inclui O AGENDAMENTO (data|hora|local, montado pela tela em
-- chaveAgendamentoAso): se o SST REAGENDA, a chave muda e o ASO volta a ser
-- novo — o candidato precisa ser avisado de novo. Linha antiga fica como
-- histórico.
--
-- Acesso: quem vê a Gestão Recrutamento ('recrutamento_gestao' visualizar)
-- lê e marca; desmarcar também (engano de clique).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public."RECRUTAMENTO_ASO_VISTO" (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidato_id  bigint NOT NULL,
  agendamento   text NOT NULL,
  visto_por     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  visto_por_nome text,
  visto_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidato_id, agendamento)
);
CREATE INDEX IF NOT EXISTS idx_recrutamento_aso_visto_em ON public."RECRUTAMENTO_ASO_VISTO"(visto_em DESC);

ALTER TABLE public."RECRUTAMENTO_ASO_VISTO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recrutamento_aso_visto_select ON public."RECRUTAMENTO_ASO_VISTO";
CREATE POLICY recrutamento_aso_visto_select ON public."RECRUTAMENTO_ASO_VISTO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS recrutamento_aso_visto_insert ON public."RECRUTAMENTO_ASO_VISTO";
CREATE POLICY recrutamento_aso_visto_insert ON public."RECRUTAMENTO_ASO_VISTO"
  FOR INSERT TO authenticated
  WITH CHECK (visto_por = auth.uid()
              AND public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS recrutamento_aso_visto_delete ON public."RECRUTAMENTO_ASO_VISTO";
CREATE POLICY recrutamento_aso_visto_delete ON public."RECRUTAMENTO_ASO_VISTO"
  FOR DELETE TO authenticated
  USING (public.has_screen_access(auth.uid(), 'recrutamento_gestao', 'visualizar'::public.app_acao));

GRANT SELECT, INSERT, DELETE ON public."RECRUTAMENTO_ASO_VISTO" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS recrutamento_aso_visto_delete ON public."RECRUTAMENTO_ASO_VISTO";
-- DROP POLICY IF EXISTS recrutamento_aso_visto_insert ON public."RECRUTAMENTO_ASO_VISTO";
-- DROP POLICY IF EXISTS recrutamento_aso_visto_select ON public."RECRUTAMENTO_ASO_VISTO";
-- DROP TABLE IF EXISTS public."RECRUTAMENTO_ASO_VISTO";
