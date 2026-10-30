-- SIS-2026-0712: o histórico do Fluxo mostrava "aprovacao nivel" sem dizer qual nível aprovou. O evento do Malote guarda o nível na coluna
-- `nivel` (1, 2 ou 3), mas fluxo_caixa_historico_linha() não o devolvia. Agora vai em `detalhe` ({"nivel": N}) e a tela escreve
-- "Aprovação — Nível N". Só recria a função (mesma assinatura e colunas); o resto da 20261030002000 não muda.

CREATE OR REPLACE FUNCTION public.fluxo_caixa_historico_linha(_origem text, _despesa_id uuid, _numero_parcela int DEFAULT NULL)
RETURNS TABLE (quando timestamptz, fonte text, tipo text, descricao text, usuario text, detalhe jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'financeiro-fluxo-caixa-gestao', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver o Fluxo de Caixa.';
  END IF;

  RETURN QUERY
  SELECT x.quando, x.fonte, x.tipo, x.descricao, x.usuario, x.detalhe FROM (
    -- 1. Origem
    SELECT ev.created_at AS quando, 'Malote'::text AS fonte, ev.tipo_evento::text AS tipo, ev.descricao::text AS descricao,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id)::text AS usuario,
           CASE WHEN ev.nivel IS NOT NULL THEN jsonb_build_object('nivel', ev.nivel) END AS detalhe
      FROM public.malote_despesa_evento ev
     WHERE _origem = 'malote' AND ev.despesa_id = _despesa_id
    UNION ALL
    SELECT ev.created_at, 'Débito Automático', ev.tipo_evento, ev.descricao,
           (SELECT p.display_name FROM public.profiles p WHERE p.id = ev.ator_user_id), NULL::jsonb
      FROM public."DEBITO_AUTOMATICO_EVENTO" ev
     WHERE _origem = 'debito_automatico' AND ev.debito_id = _despesa_id
    UNION ALL
    SELECT min(fi.created_at), 'Planilha', 'importado',
           'Importado da planilha (linha ' || min(fi.planilha_linha) FILTER (WHERE fi.planilha_linha < 800000001) || ')'
             || COALESCE(' — ' || min(fi.observacao_importacao) FILTER (WHERE fi.planilha_linha < 800000001), ''),
           NULL::text, NULL::jsonb
      FROM public.fluxo_caixa_importado fi
     WHERE _origem = 'importacao_historica' AND COALESCE(fi.rateio_grupo_id, fi.id) = _despesa_id
    HAVING count(*) > 0
    UNION ALL
    -- 2. Ajustes feitos no Fluxo (SIS-2026-0733)
    SELECT h.created_at, 'Fluxo de Caixa', 'ajuste_' || h.operacao,
           CASE h.operacao WHEN 'criado' THEN 'Ajuste criado' WHEN 'alterado' THEN 'Ajuste alterado' ELSE 'Ajuste desfeito' END,
           COALESCE(h.usuario_nome, 'banco de dados (' || h.usuario_banco || ')'),
           jsonb_build_object('campos', h.campos, 'antes', h.antes, 'depois', h.depois)
      FROM public.financeiro_fluxo_caixa_ajuste_historico h
     WHERE h.origem = _origem AND h.despesa_id = _despesa_id AND h.numero_parcela IS NOT DISTINCT FROM _numero_parcela
    UNION ALL
    -- 3. Rateio, exclusão e restauração
    SELECT e.created_at, 'Fluxo de Caixa', e.tipo, e.descricao,
           COALESCE(e.usuario_nome, 'banco de dados (' || e.usuario_banco || ')'), e.detalhe
      FROM public.financeiro_fluxo_caixa_evento e
     WHERE e.origem = _origem AND e.despesa_id = _despesa_id AND e.numero_parcela IS NOT DISTINCT FROM _numero_parcela
  ) x
  ORDER BY x.quando DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.fluxo_caixa_historico_linha(text, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fluxo_caixa_historico_linha(text, uuid, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   Reaplicar fluxo_caixa_historico_linha de 20261030002000_sis_2026_0712_fluxo_caixa_permissoes_e_historico.sql (detalhe NULL nos eventos do Malote).
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
