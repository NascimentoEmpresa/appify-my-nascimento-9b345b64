-- Lote 9e: reuniao_observador_automatico + pres_caixa_status — últimos 2
-- remanescentes achados na auditoria ao vivo geral (has_role) desta sessão.
--
-- reuniao_observador_automatico: só consumida dentro de ModulosMenusTab.tsx
-- (já gateado por can("alterar", undefined, "administracao") — Lote 8a),
-- puramente liga/desliga uma flag por usuário via toggle admin. Mapeado
-- pro mesmo menu 'administracao' já usado nesse tab.
--
-- pres_caixa_status: já tinha sido parcialmente migrada — o corpo já
-- chamava can_access(v_uid,'presidencia','visualizar') como uma das
-- condições do OR, ao lado de has_role(admin)/has_role(presidencia)
-- redundantes (concede_tudo já cobre admin; Legado: presidencia já deveria
-- ter o grant em 'presidencia'/visualizar). Corpo copiado verbatim da
-- definição viva (pg_get_functiondef via conexão direta), com uma correção:
-- v_is_admin/v_is_presidencia também eram usadas MAIS ABAIXO, no filtro de
-- quais empresas entram no resultado (bypass do user_pode_atuar_empresa por
-- empresa) — não só no gate de entrada. Removê-las sem substituir teria
-- estreitado silenciosamente esse escopo pra admin/presidencia (quem tem
-- concede_tudo veria só as empresas onde tem vínculo direto, não todas).
-- Substituídas por v_bypass_tenant = can_access(...,'presidencia','excluir')
-- (convenção já usada na sessão: 'excluir' = bypass total), usada nos dois
-- lugares onde as duas variáveis antigas apareciam.
--
-- ROLLBACK: recriar a policy/função com has_role() nas combinações
-- originais (ver pg_policies/pg_proc antes desta migration, ou arquivo de
-- origem 20260520033145 pra reuniao_observador_automatico).

DROP POLICY IF EXISTS reuniao_observador_automatico_select ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_select ON public.reuniao_observador_automatico FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'visualizar'));

DROP POLICY IF EXISTS reuniao_observador_automatico_insert ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_insert ON public.reuniao_observador_automatico FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

DROP POLICY IF EXISTS reuniao_observador_automatico_delete ON public.reuniao_observador_automatico;
CREATE POLICY reuniao_observador_automatico_delete ON public.reuniao_observador_automatico FOR DELETE TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'));

CREATE OR REPLACE FUNCTION public.pres_caixa_status()
RETURNS TABLE(empresa_id uuid, empresa_codigo text, eh_hagg boolean, saldo_inicial numeric, entradas numeric, saidas numeric, saldo_liquido numeric, mov_com_alias bigint, mov_sem_match bigint, qtd_valores_invalidos bigint, pend_outra_empresa bigint, pend_aplicacao bigint, pend_convenio bigint, pend_revisar_humano bigint, pend_meio_pagamento bigint, status_confiabilidade text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_bypass_tenant boolean := false;
  v_acessa_todas boolean := false;
  v_tem_permissao boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sem_sessao' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(p.acessa_todas_empresas, false) INTO v_acessa_todas
  FROM public.profiles p WHERE p.id = v_uid;
  v_acessa_todas := COALESCE(v_acessa_todas, false);
  -- 'excluir' = tier de bypass total (equivalente ao antigo has_role(admin)
  -- OR has_role(presidencia) que ignorava a checagem de empresa por empresa).
  v_bypass_tenant := public.can_access(v_uid, 'presidencia', 'excluir'::public.app_acao, NULL::uuid, NULL::text);
  v_tem_permissao := v_bypass_tenant
    OR public.can_access(v_uid, 'presidencia', 'visualizar'::public.app_acao, NULL::uuid, NULL::text);
  IF NOT v_tem_permissao THEN
    RAISE EXCEPTION 'permissao_negada_presidencia' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH escopo AS (
    SELECT e.id, e.codigo, (e.codigo = 'HAGG') AS eh_hagg
    FROM public.empresas e
    WHERE e.ativa = true
      AND (v_bypass_tenant OR v_acessa_todas OR public.user_pode_atuar_empresa(v_uid, e.id))
  ),
  saldo AS (
    SELECT cc.empresa_id, SUM(COALESCE(cc.saldo_inicial,0)) AS saldo_inicial
    FROM public.conta_contabil cc
    WHERE cc.tipo = 'analitica' AND cc.ativo = true AND cc.classificacao LIKE '01.1.1%'
    GROUP BY cc.empresa_id
  ),
  mov AS (
    SELECT
      esc.id AS empresa_id,
      COALESCE(SUM(COALESCE(public.parse_mz40_valor(m.valor_entrada),0)),0) AS entradas,
      COALESCE(SUM(COALESCE(public.parse_mz40_valor(m.valor_saida),0)),0) AS saidas,
      COUNT(*) FILTER (WHERE a.id IS NOT NULL) AS mov_com_alias,
      COUNT(*) FILTER (WHERE a.id IS NULL AND m.empresa IS NOT NULL) AS mov_sem_match,
      COUNT(*) FILTER (
        WHERE m.empresa IS NOT NULL
          AND (
            (NULLIF(btrim(COALESCE(m.valor_entrada,'')), '') IS NOT NULL AND public.parse_mz40_valor(m.valor_entrada) IS NULL)
            OR
            (NULLIF(btrim(COALESCE(m.valor_saida,'')), '') IS NOT NULL AND public.parse_mz40_valor(m.valor_saida) IS NULL)
          )
      ) AS qtd_valores_invalidos
    FROM escopo esc
    LEFT JOIN public.mz_40_fato_fluxo_caixa_realizado m
      ON m.empresa = esc.codigo AND m.excluir_do_fluxo = false
    LEFT JOIN public.integration_alias_bancos a
      ON a.empresa_id = esc.id
     AND a.status = 'aprovado'::public.integ_alias_status
     AND a.alias = public.normaliza_alias_banco(COALESCE(m.banco, m.conta_banco_nome))
    GROUP BY esc.id
  ),
  pend AS (
    SELECT a.empresa_id,
      COUNT(*) FILTER (WHERE a.origem = 'pend:banco_de_outra_empresa_em_hagg') AS pend_outra_empresa,
      COUNT(*) FILTER (WHERE a.origem = 'pend:criar_conta_contabil_aplicacao_financeira') AS pend_aplicacao,
      COUNT(*) FILTER (WHERE a.origem = 'pend:conta_vinculada_contrato_convenio') AS pend_convenio,
      COUNT(*) FILTER (WHERE a.origem = 'pend:revisar_humano') AS pend_revisar_humano,
      COUNT(*) FILTER (WHERE a.origem = 'pend:meio_pagamento_nao_banco') AS pend_meio_pagamento
    FROM public.integration_alias_bancos a
    WHERE a.status = 'pendente'::public.integ_alias_status
    GROUP BY a.empresa_id
  )
  SELECT
    esc.id, esc.codigo, esc.eh_hagg,
    COALESCE(s.saldo_inicial,0),
    COALESCE(mv.entradas,0),
    COALESCE(mv.saidas,0),
    COALESCE(mv.entradas,0) - COALESCE(mv.saidas,0),
    COALESCE(mv.mov_com_alias,0),
    COALESCE(mv.mov_sem_match,0),
    COALESCE(mv.qtd_valores_invalidos,0),
    COALESCE(p.pend_outra_empresa,0),
    COALESCE(p.pend_aplicacao,0),
    COALESCE(p.pend_convenio,0),
    COALESCE(p.pend_revisar_humano,0),
    COALESCE(p.pend_meio_pagamento,0),
    CASE
      WHEN COALESCE(mv.qtd_valores_invalidos,0) > 0 THEN 'BLOQUEADO'
      WHEN esc.eh_hagg AND COALESCE(mv.mov_sem_match,0) = 0 THEN 'VALIDADO'
      WHEN esc.eh_hagg THEN 'INFERIDO'
      WHEN COALESCE(mv.mov_com_alias,0) > 0 THEN 'PENDENTE'
      ELSE 'BLOQUEADO'
    END
  FROM escopo esc
  LEFT JOIN saldo s ON s.empresa_id = esc.id
  LEFT JOIN mov mv ON mv.empresa_id = esc.id
  LEFT JOIN pend p ON p.empresa_id = esc.id
  ORDER BY esc.codigo;
END;
$function$;

NOTIFY pgrst, 'reload schema';
