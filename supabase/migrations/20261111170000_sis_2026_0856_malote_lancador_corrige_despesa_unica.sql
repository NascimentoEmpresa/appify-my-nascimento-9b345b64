-- SIS-2026-0856 — Malote: o LANÇADOR da Classificação corrige a despesa devolvida (necessidade de ajuste / ajuste de pagamento) em qualquer origem
-- ============================================================================
-- A tela já trata o lançador configurado na Classificação como o responsável por corrigir a despesa devolvida (SIS-2026-0378 e 0511): ele vê os
-- campos editáveis. Mas as policies de gravação só reconheciam o lançador para despesas de origem 'solicitacao'. Para as 'despesa_unica' criadas por
-- OUTRA pessoa (ex.: Anita, Treinamentos, classificação DESPESA TREINAMENTO, lançadora Juliana) o salvamento era recusado pelo banco: nome, data de
-- vencimento, rateio, empresa e reenvio para aprovação não gravavam.
--
-- Esta migration ACRESCENTA policies (permissivas, somam às existentes; nenhuma policy atual é alterada):
--   · malote_despesa_update_lancador_ajuste : UPDATE na despesa, SÓ enquanto está em necessidade_de_ajuste ou ajuste_pagamento e a pessoa é lançadora
--                                              da classificação da despesa (o WITH CHECK só exige que continue sendo lançadora da classificação).
--   · malote_rateio_linha_lancador / malote_parcela_lancador : o rateio e as parcelas da despesa são regravados DEPOIS do UPDATE da despesa (que já
--                                              mudou o status), então o lançador precisa gravar também fora dos dois status de ajuste. Mesma régua do
--                                              criador: despesa não terminal e, se parcelada, fora da fase de pagamento.
--   · malote_evento_insert_lancador          : o histórico ("Reenviada para aprovação", "Editada") é gravado pelo mesmo usuário.
-- Escopo: só as classificações em que a pessoa é lançadora (planejamento_orcamentario_classificacao.lancador_despesa_user_ids); não abre acesso a mais nada.
-- (SELECT auth.uid()) em todas, para o Postgres não reavaliar por linha (guardião de desempenho). Idempotente. NOTIFY ao final.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS malote_despesa_update_lancador_ajuste ON public.malote_despesa;
--   DROP POLICY IF EXISTS malote_rateio_linha_lancador ON public.malote_despesa_rateio_linha;
--   DROP POLICY IF EXISTS malote_parcela_lancador ON public.malote_despesa_parcela;
--   DROP POLICY IF EXISTS malote_evento_insert_lancador ON public.malote_despesa_evento;
--   NOTIFY pgrst, 'reload schema';

DROP POLICY IF EXISTS malote_despesa_update_lancador_ajuste ON public.malote_despesa;
CREATE POLICY malote_despesa_update_lancador_ajuste ON public.malote_despesa
  FOR UPDATE TO authenticated
  USING (
    status IN ('necessidade_de_ajuste', 'ajuste_pagamento')
    AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c
                 WHERE c.id = malote_despesa.classificacao_id AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c
             WHERE c.id = malote_despesa.classificacao_id AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids))
  );

DROP POLICY IF EXISTS malote_rateio_linha_lancador ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_lancador ON public.malote_despesa_rateio_linha
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.malote_despesa d
              JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
             WHERE d.id = malote_despesa_rateio_linha.despesa_id
               AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids)
               AND d.status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada')
               AND NOT (d.parcelado AND d.status IN ('aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento')))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.malote_despesa d
              JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
             WHERE d.id = malote_despesa_rateio_linha.despesa_id
               AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids)
               AND d.status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada')
               AND NOT (d.parcelado AND d.status IN ('aguardando_pagamento', 'pronto_para_pagar', 'ajuste_pagamento')))
  );

DROP POLICY IF EXISTS malote_parcela_lancador ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_lancador ON public.malote_despesa_parcela
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.malote_despesa d
              JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
             WHERE d.id = malote_despesa_parcela.despesa_id
               AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids)
               AND d.status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.malote_despesa d
              JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
             WHERE d.id = malote_despesa_parcela.despesa_id
               AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids)
               AND d.status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
  );

DROP POLICY IF EXISTS malote_evento_insert_lancador ON public.malote_despesa_evento;
CREATE POLICY malote_evento_insert_lancador ON public.malote_despesa_evento
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.malote_despesa d
              JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
             WHERE d.id = malote_despesa_evento.despesa_id
               AND (SELECT auth.uid()) = ANY (c.lancador_despesa_user_ids))
  );

NOTIFY pgrst, 'reload schema';
