-- =========================================================================
-- RELATÓRIOS › CUSTO DAS FALTAS POR CONTRATO (21/10/2026)
--
-- PEDIDO (Pablo): "relatório novo no módulo relatórios: valor que gastamos
-- com faltas POR CONTRATO". De onde vem o valor (confirmado por ele): o campo
-- FALTAS de cada item da nota, preenchido na emissão quando o contrato teve
-- falta no mês — public.nf_emissao_item.faltas, o mesmo que o Relatório de
-- Serviços soma em "Composição dos descontos › Faltas". É o que o cliente
-- descontou da nota por posto não coberto.
--
-- QUAIS NOTAS CONTAM: a regra é a do Relatório de Serviços e mora no front
-- (src/pages/financeiro/nf-emissao/shared.tsx: foraDoRelatorio +
-- naoContabilizaKpi) — rascunho/enviada ainda não são nota do relatório;
-- cancelada/substituída aparece mas não soma. Esta RPC só corta o que nunca
-- conta (lixeira, rascunho, enviada) e o período; o resto do critério é
-- aplicado em src/lib/relatorios/custoFaltas.ts, com a função de lá — para as
-- duas telas nunca darem números diferentes.
--
-- ACESSO: menu próprio diretoria_rel_custo_faltas (o prefixo dos relatórios)
-- OU quem já tem o Relatório de Serviços (já vê esses mesmos valores). NÃO
-- abre para quem tem só o Relatório Geral (diferente dos outros relatórios):
-- é valor de nota fiscal; se for o caso, libera-se o menu em Acesso por
-- Usuário. Tela nova nasce sem ninguém (08/10/2026) — a semente copia quem
-- tem o Relatório de Serviços.
--
-- Leitura via SECURITY DEFINER: nf_emissao/nf_emissao_item têm RLS pelos
-- menus do Financeiro.
-- =========================================================================

-- ── 1) Menu ─────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'diretoria_rel_custo_faltas', 'Custo das Faltas por Contrato', '/app/relatorios/custo-faltas', 13, true
  FROM public.app_modulo m WHERE m.codigo = 'relatorios'
ON CONFLICT (modulo_id, codigo) DO UPDATE SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ativo = true;

-- ── 2) Semente: quem já vê o Relatório de Serviços ──────────────────────
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT DISTINCT pp.perfil_id, 'diretoria_rel_custo_faltas', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao pp
 WHERE pp.menu_codigo = 'relatorio-servicos' AND pp.acao = 'visualizar' AND pp.allow
   AND NOT EXISTS (SELECT 1 FROM public.perfil_acesso_permissao x
                    WHERE x.perfil_id = pp.perfil_id AND x.menu_codigo = 'diretoria_rel_custo_faltas' AND x.acao = 'visualizar');

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
SELECT DISTINCT s.user_id, 'diretoria_rel_custo_faltas', 'visualizar'::public.app_acao, true,
       'Migração 20261021000060: já tinha o Relatório de Serviços (Financeiro)'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'relatorio-servicos' AND s.acao = 'visualizar' AND s.allow
   AND NOT EXISTS (SELECT 1 FROM public.screen_permission_user x
                    WHERE x.user_id = s.user_id AND x.menu_codigo = 'diretoria_rel_custo_faltas' AND x.acao = 'visualizar');

-- ── 3) RPC ──────────────────────────────────────────────────────────────
-- Uma linha por NOTA do período (competência entre _de e _ate, mês inteiro),
-- com ou sem falta: o relatório mostra também quanto a falta pesa sobre o
-- executado do contrato. Os itens vêm só quando têm falta (identificação +
-- valor), e faltas_calculo traz os dias quando a nota usou o cálculo por dias
-- (SIS-2026-0633, Veranópolis).
CREATE OR REPLACE FUNCTION public.dir_rel_custo_faltas(_de date, _ate date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_screen_access(auth.uid(), 'diretoria_rel_custo_faltas', 'visualizar'::public.app_acao)
          OR public.has_screen_access(auth.uid(), 'relatorio-servicos', 'visualizar'::public.app_acao)) THEN
    RAISE EXCEPTION 'Sem acesso a este relatório' USING ERRCODE = '42501';
  END IF;
  IF _de IS NULL OR _ate IS NULL OR _ate < _de THEN RAISE EXCEPTION 'Período inválido.'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id,
           'numero_nf', n.numero_nf,
           'competencia', to_char(n.competencia, 'YYYY-MM'),
           'data_emissao', n.data_emissao,
           'tipo_nota', n.tipo_nota,
           'variacao', n.variacao,
           'status', n.status::text,
           'situacao_site_pmt', n.situacao_site_pmt,
           'situacao_dominio', n.situacao_dominio,
           'data_pagamento', n.data_pagamento,
           'valor_pago', n.valor_pago,
           'contrato_id', n.contrato_id,
           'contrato_nome', coalesce(nullif(btrim(c.nome), ''), 'Sem contrato'),
           'contrato_cliente', c.cliente,
           'empresa_id', n.empresa_id,
           'empresa_nome', coalesce(e.nome_fantasia, e.razao_social),
           'valor_contrato_exec_total', coalesce(n.valor_contrato_exec_total, 0),
           'vlr_bruto_total', coalesce(n.vlr_bruto_total, 0),
           'faltas', coalesce(it.faltas, 0),
           'itens_falta', coalesce(it.itens, '[]'::jsonb),
           'faltas_calculo', n.faltas_calculo)
           ORDER BY n.competencia, c.nome, n.numero_nf), '[]'::jsonb)
    INTO r
    FROM public.nf_emissao n
    LEFT JOIN public.contratos c ON c.id = n.contrato_id
    LEFT JOIN public.empresas e ON e.id = n.empresa_id
    LEFT JOIN LATERAL (
      SELECT sum(coalesce(i.faltas, 0)) AS faltas,
             jsonb_agg(jsonb_build_object('identificacao', coalesce(nullif(btrim(i.identificacao), ''), 'Item ' || i.ordem), 'faltas', i.faltas)
                       ORDER BY i.ordem) FILTER (WHERE coalesce(i.faltas, 0) <> 0) AS itens
        FROM public.nf_emissao_item i WHERE i.nf_emissao_id = n.id
    ) it ON true
   WHERE n.deleted_at IS NULL
     AND n.status::text NOT IN ('rascunho', 'enviada')
     AND n.competencia >= date_trunc('month', _de)::date
     AND n.competencia <= _ate;

  RETURN jsonb_build_object('de', _de, 'ate', _ate, 'gerado_em', now(), 'notas', r);
END $fn$;
REVOKE ALL ON FUNCTION public.dir_rel_custo_faltas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dir_rel_custo_faltas(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Conferência (logado, mês de setembro):
--   SELECT jsonb_array_length(public.dir_rel_custo_faltas('2026-09-01', '2026-09-30')->'notas');
-- O total de faltas deve bater com Financeiro › Relatório de Serviços ›
-- Dashboard › Composição dos descontos › Faltas, na mesma competência.

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.dir_rel_custo_faltas(date, date);
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'diretoria_rel_custo_faltas';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'diretoria_rel_custo_faltas';
-- DELETE FROM public.app_menu WHERE codigo = 'diretoria_rel_custo_faltas';
-- NOTIFY pgrst, 'reload schema';
