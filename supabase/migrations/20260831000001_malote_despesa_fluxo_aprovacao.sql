-- SIS-2026-0104: Malote — Acompanhamento dos Meus Itens
--
-- Expande malote_despesa pra suportar o fluxo completo descrito no anexo
-- "Regras Gerais" do chamado: sub-fluxo de cotação da Solicitação, N
-- níveis de aprovação (N1/N2/N3), motivo de ajuste, exceção, numeração
-- exibível (DM-2025-XXXX / SD-2025-XXXX) e histórico/timeline de eventos
-- (usado pelo painel "Fluxo de Aprovação").
--
-- Fluxo de status final, combinando o documento original com o parecer
-- do chefe (editável em todo status ativo; Cancelar despesa e Mandar
-- para aprovação novamente disponíveis em qualquer status ativo; sem
-- "Salvar alterações" separado — editar e reenviar é uma ação só):
--   rascunho -> aguardando_cotacao -> cotacao_realizada
--     -> solicitacao_reprovada (terminal)
--     -> pendente_aprovacao (N1/N2/N3, "solicitacao_aprovada"/"despesa_criada"
--        viram eventos de histórico, não status persistidos)
--   pendente_aprovacao <-> necessidade_de_ajuste (mandar p/ aprovação de novo -> reinicia em N1)
--   pendente_aprovacao -> aguardando_pagamento (todos os níveis aprovaram)
--   aguardando_pagamento -> despesa_paga (terminal) | -> pendente_aprovacao (editou e reenviou)
--   qualquer status ativo -> cancelada (terminal) | -> despesa_reprovada (terminal, reprovado por um aprovador)
--
-- Escopo deste chamado: telas de ACOMPANHAMENTO (Meus Itens + visualização
-- da Despesa/Solicitação) do lado de quem CRIOU o item. As ações do
-- aprovador (aprovar/pedir ajuste/reprovar um nível) ficam pra tela
-- "Aprovações do Malote" (placeholder já existente da SIS-2026-0081).

ALTER TABLE public.malote_despesa DROP CONSTRAINT malote_despesa_status_check;
ALTER TABLE public.malote_despesa ADD CONSTRAINT malote_despesa_status_check CHECK (status IN (
  'rascunho',
  'aguardando_cotacao',
  'cotacao_realizada',
  'solicitacao_reprovada',
  'pendente_aprovacao',
  'necessidade_de_ajuste',
  'aguardando_pagamento',
  'despesa_paga',
  'despesa_reprovada',
  'cancelada'
));
ALTER TABLE public.malote_despesa ALTER COLUMN status SET DEFAULT 'rascunho';

-- Numeração exibível (DM-2025-0785 / SD-2025-0342), gerada na criação.
CREATE SEQUENCE IF NOT EXISTS public.malote_despesa_numero_seq;
CREATE SEQUENCE IF NOT EXISTS public.malote_solicitacao_numero_seq;

ALTER TABLE public.malote_despesa ADD COLUMN numero text UNIQUE;

CREATE OR REPLACE FUNCTION public.malote_despesa_gerar_numero()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    IF NEW.origem = 'solicitacao' THEN
      NEW.numero := 'SD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.malote_solicitacao_numero_seq')::text, 4, '0');
    ELSE
      NEW.numero := 'DM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.malote_despesa_numero_seq')::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER malote_despesa_set_numero BEFORE INSERT ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_gerar_numero();

-- Backfill dos registros já existentes (criados antes desta migration).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, origem FROM public.malote_despesa WHERE numero IS NULL ORDER BY created_at LOOP
    IF r.origem = 'solicitacao' THEN
      UPDATE public.malote_despesa SET numero = 'SD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.malote_solicitacao_numero_seq')::text, 4, '0') WHERE id = r.id;
    ELSE
      UPDATE public.malote_despesa SET numero = 'DM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.malote_despesa_numero_seq')::text, 4, '0') WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.malote_despesa ALTER COLUMN numero SET NOT NULL;

-- Campos novos do fluxo de aprovação / cotação / exceção.
ALTER TABLE public.malote_despesa
  ADD COLUMN tipo text CHECK (tipo IS NULL OR tipo IN ('despesa', 'compra', 'manutencao')),
  ADD COLUMN nivel_aprovacao_atual smallint CHECK (nivel_aprovacao_atual IS NULL OR nivel_aprovacao_atual IN (1, 2, 3)),
  ADD COLUMN valor_aprovado_cotacao numeric(14,2),
  ADD COLUMN valor_aprovado numeric(14,2),
  ADD COLUMN justificativa_aprovacao text,
  ADD COLUMN motivo_ajuste text,
  ADD COLUMN excecao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.malote_despesa.tipo IS 'Categoria da solicitação (Despesa/Compra/Manutenção) — distinto de classificacao_id (orçamento) e do antigo tipo_movimento (entrada/saída), que segue existindo.';

-- ============================================================================
-- Histórico/timeline (painel "Fluxo de Aprovação")
-- ============================================================================
CREATE TABLE public.malote_despesa_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  despesa_id uuid NOT NULL REFERENCES public.malote_despesa(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL CHECK (tipo_evento IN (
    'criacao', 'aguardando_cotacao', 'cotacao_realizada', 'solicitacao_aprovada',
    'solicitacao_reprovada', 'despesa_criada', 'aprovacao_nivel', 'necessidade_de_ajuste',
    'reenvio_aprovacao', 'aguardando_pagamento', 'despesa_paga', 'despesa_reprovada', 'cancelamento'
  )),
  nivel smallint CHECK (nivel IS NULL OR nivel IN (1, 2, 3)),
  ator_user_id uuid REFERENCES auth.users(id),
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_malote_evento_despesa ON public.malote_despesa_evento(despesa_id, created_at);

ALTER TABLE public.malote_despesa_evento ENABLE ROW LEVEL SECURITY;

CREATE POLICY malote_evento_select ON public.malote_despesa_evento FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR d.empresa_id = get_user_empresa(auth.uid())
  )));

CREATE POLICY malote_evento_insert ON public.malote_despesa_evento FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )));

-- Evento de criação, pra toda despesa nova já nascer com o primeiro item da timeline.
CREATE OR REPLACE FUNCTION public.malote_despesa_evento_criacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.malote_despesa_evento (despesa_id, tipo_evento, ator_user_id, descricao)
  VALUES (NEW.id, 'criacao', NEW.created_by, NEW.nome);
  RETURN NEW;
END;
$$;

CREATE TRIGGER malote_despesa_evento_criacao_trg AFTER INSERT ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_evento_criacao();

-- Atualiza a policy de UPDATE: editável em qualquer status ativo (não só
-- rascunho), conforme parecer do chefe — só trava nos status terminais.
DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  )
  WITH CHECK (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
  );

NOTIFY pgrst, 'reload schema';
