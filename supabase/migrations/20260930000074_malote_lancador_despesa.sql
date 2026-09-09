-- SIS-2026-0340 (Iury): "Fazer com que caso o item esteja com cotação
-- aprovada seja possível a gente definir quem vai lançar essa despesa no
-- malote e não o solicitante como está hoje." Hoje quem converte uma
-- solicitação já cotada/aprovada (status='cotacao_aprovada') numa Despesa
-- de verdade é decidido 100% pela RLS de malote_despesa_update — só libera
-- created_by (fora dos escapes admin/malote_supervisor_por_cargo). Não
-- existe RPC dedicado (a conversão passa por dois UPDATEs client-side, via
-- useConverterSolicitacaoEmDespesa/useSalvarDespesa), então a mudança tem
-- que ser feita direto na policy.
--
-- Campo novo, mesmo padrão de aprovador1/2/3_user_ids (20260930000004):
-- array de uuids, opcional (vazio = comportamento de hoje, o solicitante
-- continua lançando). Confirmado com o usuário: uma vez configurado, é
-- SUBSTITUIÇÃO, não reforço — só os lançadores configurados podem
-- converter aquela despesa, não mais o solicitante original (ele continua
-- vendo o item em "Meus Itens", só não pode mais agir nele).
ALTER TABLE public.planejamento_orcamentario_classificacao
  ADD COLUMN IF NOT EXISTS lancador_despesa_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lancador_despesa_nomes text[] NOT NULL DEFAULT '{}';

-- Achado técnico importante (por isso o gate NÃO é por status='cotacao_aprovada'):
-- useConverterSolicitacaoEmDespesa faz DOIS updates em sequência na mesma
-- malote_despesa — o 1º grava os dados da despesa + status='pendente_aprovacao',
-- o 2º seta nivel_aprovacao_atual=1. Se a condição do lançador exigisse
-- status='cotacao_aprovada', o 2º update (que já roda com status já
-- trocado pelo 1º) seria rejeitado pra quem não é created_by. Em vez de
-- status, o gate usa um sinal que cobre os dois updates e se fecha sozinho
-- depois: "despesa de origem solicitação que ainda não entrou na fase de
-- aprovação" (nivel_aprovacao_atual ainda NULL — é exatamente isso que o
-- 2º update seta, então depois da conversão o lançador perde a permissão
-- de novo, igual antes).
DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
  USING (
    (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      origem = 'solicitacao'
      AND nivel_aprovacao_atual IS NULL
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = malote_despesa.classificacao_id
          AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    -- Sem a condição de nivel_aprovacao_atual aqui de propósito: o 2º update
    -- da conversão é exatamente o que troca nivel_aprovacao_atual de NULL
    -- pra 1 — WITH CHECK roda contra a linha NOVA, então exigir NULL aqui
    -- rejeitaria a própria transição que este caminho existe pra permitir.
    -- A janela de quando isso pode ocorrer já é controlada pelo USING acima
    -- (linha ANTIGA), que é o que de fato importa pra segurança.
    OR (
      origem = 'solicitacao'
      AND EXISTS (
        SELECT 1 FROM public.planejamento_orcamentario_classificacao c
        WHERE c.id = malote_despesa.classificacao_id
          AND auth.uid() = ANY(c.lancador_despesa_user_ids)
      )
    )
  );

-- Achado técnico complementar: a conversão, quando o solicitante preenche
-- Rateio e/ou Parcelas junto (useSalvarDespesa), faz INSERT direto em
-- malote_despesa_parcela/malote_despesa_rateio_linha DEPOIS do 1º UPDATE em
-- malote_despesa acima (chamadas HTTP separadas, não é uma transação SQL
-- só) — nesse momento, malote_despesa.status já é 'pendente_aprovacao'
-- (setado pelo 1º update), mas nivel_aprovacao_atual ainda é NULL (só o 2º
-- update, que roda por último, seta 1). O WITH CHECK dessas duas tabelas
-- só liberava created_by/admin/supervisor — sem a mesma cláusula do
-- lançador aqui, o INSERT do Rateio/Parcelas pelo lançador falharia mesmo
-- com a malote_despesa já liberada acima.
DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (
             d.origem = 'solicitacao' AND d.nivel_aprovacao_atual IS NULL
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_parcela.despesa_id
         AND (
           d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid())
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           d.created_by = auth.uid()
           OR has_role(auth.uid(), 'admin'::app_role)
           OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id))
           OR (
             d.origem = 'solicitacao' AND d.nivel_aprovacao_atual IS NULL
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
           has_role(auth.uid(), 'admin'::app_role)
           OR (
             (d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
             AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text]))
           )
           OR (
             d.origem = 'solicitacao'
             AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
           )
         )
    )
  );

-- Mesmo motivo das duas acima: useConverterSolicitacaoEmDespesa termina
-- chamando registrarEventoDespesa (INSERT direto em malote_despesa_evento,
-- não RPC) pra logar "despesa_criada". Sem a mesma cláusula aqui, os dois
-- UPDATEs da conversão já teriam sido feitos com sucesso (a despesa já
-- existe), mas a mutation inteira lançaria erro na última etapa — usuário
-- veria "erro" mesmo com o lançamento já efetivamente concluído.
DROP POLICY IF EXISTS malote_evento_insert ON public.malote_despesa_evento;
CREATE POLICY malote_evento_insert ON public.malote_despesa_evento FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
    d.created_by = auth.uid()
    OR has_role(auth.uid(), 'admin')
    OR public.malote_supervisor_por_cargo(auth.uid())
    OR (
      d.origem = 'solicitacao'
      AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c WHERE c.id = d.classificacao_id AND auth.uid() = ANY(c.lancador_despesa_user_ids))
    )
  )));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP POLICY IF EXISTS malote_despesa_update ON public.malote_despesa;
-- CREATE POLICY malote_despesa_update ON public.malote_despesa FOR UPDATE TO authenticated
--   USING (
--     (created_by = auth.uid() AND status NOT IN ('despesa_paga', 'despesa_reprovada', 'solicitacao_reprovada', 'cancelada'))
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--   )
--   WITH CHECK (
--     created_by = auth.uid()
--     OR has_role(auth.uid(), 'admin')
--     OR public.malote_supervisor_por_cargo(auth.uid())
--   );
-- DROP POLICY IF EXISTS malote_parcela_all ON public.malote_despesa_parcela;
-- CREATE POLICY malote_parcela_all ON public.malote_despesa_parcela
--   FOR ALL TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--     OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id)))))
--   WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_parcela.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR malote_supervisor_por_cargo(auth.uid()))));
-- DROP POLICY IF EXISTS malote_rateio_linha_all ON public.malote_despesa_rateio_linha;
-- CREATE POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
--   FOR ALL TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--     AND (d.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
--     OR (public.user_pode_ver_empresa(auth.uid(), d.empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), d.classificacao_id)))))
--   WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = malote_despesa_rateio_linha.despesa_id
--     AND (has_role(auth.uid(), 'admin'::app_role)
--     OR ((d.created_by = auth.uid() OR malote_supervisor_por_cargo(auth.uid()))
--     AND NOT (d.parcelado AND d.status = ANY (ARRAY['aguardando_pagamento'::text, 'pronto_para_pagar'::text, 'ajuste_pagamento'::text, 'despesa_paga'::text]))))));
-- DROP POLICY IF EXISTS malote_evento_insert ON public.malote_despesa_evento;
-- CREATE POLICY malote_evento_insert ON public.malote_despesa_evento FOR INSERT TO authenticated
--   WITH CHECK (EXISTS (SELECT 1 FROM public.malote_despesa d WHERE d.id = despesa_id AND (
--     d.created_by = auth.uid() OR has_role(auth.uid(), 'admin') OR public.malote_supervisor_por_cargo(auth.uid())
--   )));
-- ALTER TABLE public.planejamento_orcamentario_classificacao
--   DROP COLUMN IF EXISTS lancador_despesa_user_ids,
--   DROP COLUMN IF EXISTS lancador_despesa_nomes;
-- NOTIFY pgrst, 'reload schema';
-- =====================================================================
