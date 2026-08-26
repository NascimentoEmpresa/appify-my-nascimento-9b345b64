-- =========================================================================
-- Orçamento comprometido pelo pedido de compra
--
-- O QUE JÁ EXISTIA
-- O módulo de orçamento está pronto há tempos: `planejamento_orcamentario`,
-- as telas do Malote e da Controladoria, e até a barra de 0–100%. O que a
-- alimenta é `v_malote_utilizado_orcamento`, que conta despesa em
-- `aguardando_pagamento` ou `despesa_paga`.
--
-- O BURACO
-- Isso é o FIM do fluxo. O Cassio precisa enxergar o dinheiro no momento em
-- que o pedido vai para o fornecedor — semanas antes. Hoje ele emite R$ 50 mil
-- numa segunda e o orçamento não se move até as notas chegarem no financeiro.
--
-- POR QUE UMA VIEW NOVA E NÃO ALTERAR A EXISTENTE
-- A view atual alimenta Malote e Controladoria. Quem olha aquele painel espera
-- "dinheiro comprometido com pagamento"; mudar o número por baixo pegaria
-- outras pessoas de surpresa, num painel que dirigente usa para decidir.
--
-- A ARMADILHA QUE ESTA VIEW EVITA: DUPLA CONTAGEM
-- Um pedido recebido vira despesa, e a despesa caminha para pagamento. Se as
-- duas views contassem a mesma compra, somar os dois números daria o dobro do
-- gasto real — e alguém tomaria decisão de corte em cima disso. Por isso o
-- filtro `d.status NOT IN (...)`: assim que a despesa entra na fila de
-- pagamento, ela SAI daqui e passa a ser contada pela view antiga. Os dois
-- números são disjuntos e podem ser somados com segurança.
--
-- Idempotente.
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_orcamento_classificacao;
--   DROP VIEW IF EXISTS public.v_sup_comprometido_orcamento;
-- =========================================================================

-- ── O valor orçado, na mesma chave que a despesa usa ─────────────────────
--
-- Sem isto a barra de consumo não tem denominador, e uma barra sem
-- denominador honesto é pior que nenhuma: ela mostraria 100% sempre.
--
-- A cadeia não é óbvia e foi conferida contra o banco, não deduzida:
--
--   planejamento_orcamentario.classificacao_id  →  classificação ADMINISTRATIVA
--        ↓ malote_administrativo_classificacao_link
--   classificacao_malote_id  =  planejamento_orcamentario_classificacao.id
--        =  malote_despesa.classificacao_id
--
-- O nome `classificacao_id` aparece nas duas pontas apontando para tabelas
-- DIFERENTES — é a armadilha aqui. Resolver isso numa view, e não em cada
-- tela, é o que impede Malote e Suprimentos de divergirem no dia em que
-- alguém refizer a conta num dos dois lugares.

CREATE OR REPLACE VIEW public.v_orcamento_classificacao AS
SELECT
  po.id                        AS orcamento_id,
  po.empresa_id,
  lnk.classificacao_malote_id  AS classificacao_id,
  cl.nome                      AS classificacao_nome,
  po.detalhe,
  po.inicio_vigencia,
  po.fim_vigencia,
  po.valor
FROM public.planejamento_orcamentario po
JOIN public.malote_administrativo_classificacao_link lnk
  ON lnk.classificacao_administrativa_id = po.classificacao_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl
  ON cl.id = lnk.classificacao_malote_id;

ALTER VIEW public.v_orcamento_classificacao SET (security_invoker = true);

COMMENT ON VIEW public.v_orcamento_classificacao IS
  'Valor orcado ja resolvido para a classificacao que malote_despesa usa. Evita que cada tela refaca a travessia pela tabela de ligacao.';

GRANT SELECT ON public.v_orcamento_classificacao TO authenticated;

CREATE OR REPLACE VIEW public.v_sup_comprometido_orcamento AS
SELECT
  pc.id                                        AS pedido_id,
  pc.numero                                    AS numero_pedido,
  pc.status                                    AS status_pedido,
  pc.fornecedor_nome,
  pc.enviado_em,
  pc.data_limite_entrega,
  d.id                                         AS despesa_id,
  d.numero                                     AS id_malote,
  d.nome                                       AS descricao,
  -- A competência é da despesa: o pedido não tem uma própria, e é a despesa
  -- que define em qual mês do orçamento a compra pesa.
  d.competencia,
  d.classificacao_id,
  cl.nome                                      AS classificacao_nome,
  COALESCE(pc.contrato_id, d.contrato_id)      AS contrato_id,
  c.nome                                       AS contrato_nome,
  pc.empresa_id,
  COALESCE(e.nome_fantasia, e.razao_social)    AS empresa_nome,
  pc.valor_total                               AS valor
FROM public.sup_compra_pedido pc
JOIN public.malote_despesa d ON d.id = pc.despesa_id
LEFT JOIN public.planejamento_orcamentario_classificacao cl ON cl.id = d.classificacao_id
LEFT JOIN public.contratos c ON c.id = COALESCE(pc.contrato_id, d.contrato_id)
LEFT JOIN public.empresas e ON e.id = pc.empresa_id
WHERE
  -- Rascunho não comprometeu nada: ninguém mandou para o fornecedor ainda.
  -- Cancelado devolve o dinheiro ao orçamento.
  pc.status IN ('enviado', 'aguardando_entrega', 'entrega_parcial', 'recebido')
  -- Ver a nota sobre dupla contagem no cabeçalho.
  AND d.status NOT IN ('aguardando_pagamento', 'despesa_paga');

-- `security_invoker`: a view respeita a RLS de quem consulta, como a irmã dela
-- em 20260908000001. Sem isso ela viraria um vazamento por cima das policies
-- de malote_despesa.
ALTER VIEW public.v_sup_comprometido_orcamento SET (security_invoker = true);

COMMENT ON VIEW public.v_sup_comprometido_orcamento IS
  'Pedidos de compra emitidos e ainda nao pagos, por classificacao orcamentaria. Disjunta de v_malote_utilizado_orcamento: os dois numeros podem ser somados sem contar a mesma compra duas vezes.';

GRANT SELECT ON public.v_sup_comprometido_orcamento TO authenticated;

NOTIFY pgrst, 'reload schema';
