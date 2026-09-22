-- [SEM-CHAMADO] (achado do usuário, 22/09/2026 — DM-2026-0895 "COMBUSTIVEL"
-- travada em pendente_aprovacao, sem ninguém reconhecido como aprovador).
--
-- Despesa de rateio (origem despesa_multi_classificacao) não tem
-- classificacao_id na própria linha — cada linha de
-- malote_despesa_rateio_linha tem a sua. malote_e_aprovador_do_nivel e
-- malote_sou_aprovador_configurado (20260930000189, Fluxo Especial) faziam
-- JOIN direto em d.classificacao_id: para despesa de rateio esse JOIN não
-- encontra nada, e ninguém nunca é reconhecido como aprovador — só
-- malote_supervisor_por_cargo/admin conseguiam agir, mesmo com aprovador
-- de verdade cadastrado em cada Classificação do rateio.
--
-- Decisão do Iury: para despesa de rateio, vale QUALQUER aprovador de
-- QUALQUER Classificação das linhas daquele nível — mesma lógica de união
-- já usada no frontend (Aprovações) para exibir os nomes
-- (useClassificacaoIdsPorDespesaRateio + nomesAprovadorNivel), agora
-- também para decidir a permissão de fato no banco.
--
-- ROLLBACK:
--   (recriar as duas funções com o corpo de 20260930000189_malote_fluxo_aprovacao_especial_por_forma_pagamento.sql)
--   NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.malote_e_aprovador_do_nivel(_despesa_id uuid, _nivel smallint, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN fp.fluxo_aprovacao = 'especial' THEN _user_id = fp.aprovador_especial_user_id
    WHEN d.classificacao_id IS NOT NULL THEN (CASE _nivel
      WHEN 1 THEN _user_id = ANY(c.aprovador1_user_ids)
      WHEN 2 THEN _user_id = ANY(c.aprovador2_user_ids)
      WHEN 3 THEN _user_id = ANY(c.aprovador3_user_ids)
      ELSE false
    END)
    ELSE EXISTS (
      SELECT 1
        FROM public.malote_despesa_rateio_linha rl
        JOIN public.planejamento_orcamentario_classificacao rc ON rc.id = rl.classificacao_id
       WHERE rl.despesa_id = d.id
         AND _user_id = ANY(CASE _nivel
               WHEN 1 THEN rc.aprovador1_user_ids
               WHEN 2 THEN rc.aprovador2_user_ids
               WHEN 3 THEN rc.aprovador3_user_ids
               ELSE ARRAY[]::uuid[]
             END)
    )
  END
  FROM public.malote_despesa d
  LEFT JOIN public.malote_forma_pagamento fp ON fp.nome = d.forma_pagamento
  LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  WHERE d.id = _despesa_id;
$$;

CREATE OR REPLACE FUNCTION public.malote_sou_aprovador_configurado(_despesa_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.malote_despesa d
    LEFT JOIN public.malote_forma_pagamento fp ON fp.nome = d.forma_pagamento
    LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
    WHERE d.id = _despesa_id
      AND (
        (fp.fluxo_aprovacao = 'especial' AND _user_id = fp.aprovador_especial_user_id)
        OR (
          fp.fluxo_aprovacao IS DISTINCT FROM 'especial'
          AND d.classificacao_id IS NOT NULL
          AND (
            _user_id = ANY(c.aprovador1_user_ids)
            OR _user_id = ANY(c.aprovador2_user_ids)
            OR _user_id = ANY(c.aprovador3_user_ids)
          )
        )
        OR (
          fp.fluxo_aprovacao IS DISTINCT FROM 'especial'
          AND d.classificacao_id IS NULL
          AND EXISTS (
            SELECT 1
              FROM public.malote_despesa_rateio_linha rl
              JOIN public.planejamento_orcamentario_classificacao rc ON rc.id = rl.classificacao_id
             WHERE rl.despesa_id = d.id
               AND (
                 _user_id = ANY(rc.aprovador1_user_ids)
                 OR _user_id = ANY(rc.aprovador2_user_ids)
                 OR _user_id = ANY(rc.aprovador3_user_ids)
               )
          )
        )
      )
  );
$$;

NOTIFY pgrst, 'reload schema';
