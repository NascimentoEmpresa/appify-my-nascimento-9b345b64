-- [SEM-CHAMADO] (Ruan, financeiro): relatório de TODAS as despesas do
-- Malote, exportável a qualquer momento — hoje não existe nenhuma tela que
-- mostre isso. Meus Itens é recortado por criador/setor
-- (malote_setor_visivel_usuario), Aprovações só mostra pendentes, Pagamento
-- Malote só mostra o que está pronto/pago. `malote_despesa` tem RLS
-- defense-in-depth de propósito (só criador/aprovador da linha/admin por
-- cargo enxerga) — não dá pra simplesmente abrir um SELECT * pelo client.
--
-- Solução: menu fantasma dedicado (rota=NULL, mesmo padrão de
-- 'caixa-export-consolidado' em 20260809000009) + RPC SECURITY DEFINER que
-- ignora o recorte normal só pra quem tiver essa permissão nova — acesso é
-- 100% por usuário (Gerenciamento de Acesso), não por cargo/perfil.
--
-- SIS-2026-0464 (Ruan, financeiro, 2ª rodada): o relatório agora sai 1 LINHA
-- POR LINHA DE RATEIO da despesa, não mais 1 linha por despesa — quem
-- confere quer ver contrato/fornecedor/integrante/valor de cada rateio
-- individualmente, não um resumo agregado ("Rateio" escondia o detalhe).
-- `id`/`numero` repetem em todas as linhas da mesma despesa (LEFT JOIN, não
-- agregação); despesa sem nenhuma linha de rateio ainda aparece 1 vez (as
-- colunas de rateio vêm nulas). Contrato passa a vir da própria linha
-- (fallback pro d.contrato_id da despesa quando a linha não tem um).
--
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.malote_despesa_relatorio_exportar() FROM authenticated;
--   DROP FUNCTION IF EXISTS public.malote_despesa_relatorio_exportar();
--   DELETE FROM public.app_menu WHERE codigo = 'malote_relatorio_despesas';
--   NOTIFY pgrst, 'reload schema';

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_relatorio_despesas', 'Malote — Relatório de Despesas (exportação)', NULL, 6
FROM public.app_modulo m
WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- DROP em vez de CREATE OR REPLACE: mudar o tipo/colunas do retorno
-- (RETURNS TABLE) não é permitido via REPLACE, Postgres exige recriar do
-- zero (42P13). Idempotente pra reexecução.
DROP FUNCTION IF EXISTS public.malote_despesa_relatorio_exportar();

CREATE FUNCTION public.malote_despesa_relatorio_exportar()
RETURNS TABLE (
  id uuid,
  numero text,
  origem text,
  status text,
  nome text,
  empresa text,
  classificacao text,
  contrato text,
  rateio_ordem integer,
  rateio_fornecedor text,
  rateio_integrante text,
  rateio_valor numeric,
  valor_total numeric,
  valor_aprovado numeric,
  forma_pagamento text,
  banco text,
  data_pagamento date,
  competencia date,
  parcelado boolean,
  numero_parcelas integer,
  nivel_aprovacao_atual smallint,
  excecao boolean,
  justificativa_excecao text,
  motivo_ajuste text,
  pago_em timestamptz,
  pago_por text,
  conferido_em timestamptz,
  conferido_por text,
  created_at timestamptz,
  criado_por text,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'malote_relatorio_despesas', 'exportar'::app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para exportar o relatório de despesas do Malote.';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.numero,
    d.origem::text,
    d.status::text,
    d.nome,
    COALESCE(e.nome_fantasia, e.razao_social),
    COALESCE(rcl.nome, c.nome),
    COALESCE(rct.nome, ct.nome),
    rl.ordem,
    COALESCE(rf.nome_fantasia, rf.razao_social),
    remp."Nome",
    rl.valor,
    d.valor_total,
    d.valor_aprovado,
    d.forma_pagamento,
    b.nome,
    d.data_pagamento,
    d.competencia,
    d.parcelado,
    d.numero_parcelas,
    d.nivel_aprovacao_atual,
    d.excecao,
    d.justificativa_excecao,
    d.motivo_ajuste,
    d.pago_em,
    COALESCE(pp.display_name, pp.email),
    d.conferido_em,
    COALESCE(cf.display_name, cf.email),
    d.created_at,
    COALESCE(cr.display_name, cr.email),
    d.updated_at
  FROM public.malote_despesa d
  LEFT JOIN public.empresas e ON e.id = d.empresa_id
  LEFT JOIN public.planejamento_orcamentario_classificacao c ON c.id = d.classificacao_id
  LEFT JOIN public.contratos ct ON ct.id = d.contrato_id
  LEFT JOIN public.malote_cartao_banco b ON b.id = d.banco_id
  LEFT JOIN public.profiles pp ON pp.id = d.pago_por
  LEFT JOIN public.profiles cf ON cf.id = d.conferido_por
  LEFT JOIN public.profiles cr ON cr.id = d.created_by
  LEFT JOIN public.malote_despesa_rateio_linha rl ON rl.despesa_id = d.id
  LEFT JOIN public.planejamento_orcamentario_classificacao rcl ON rcl.id = rl.classificacao_id
  LEFT JOIN public.contratos rct ON rct.id = rl.contrato_id
  LEFT JOIN public.fornecedor rf ON rf.id = rl.fornecedor_id
  LEFT JOIN public."EMPREGADOS" remp ON remp."ID" = rl.integrante_empregado_id
  WHERE d.deleted_at IS NULL
  ORDER BY d.created_at DESC, rl.ordem;
END;
$$;

REVOKE ALL ON FUNCTION public.malote_despesa_relatorio_exportar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.malote_despesa_relatorio_exportar() TO authenticated;

NOTIFY pgrst, 'reload schema';
