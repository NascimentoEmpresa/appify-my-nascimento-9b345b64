-- =====================================================================
-- SUPRIMENTOS — aposentadoria do módulo antigo (navegação)
--
-- O fluxo genérico de compras (requisição → cotação → pedido → NF →
-- recebimento) e o estoque por movimento foram substituídos pelo modelo
-- novo: Catálogo de Materiais, Pedidos de Materiais e Estoque & Etiquetas.
--
-- Manter os dois lado a lado confundia — havia DUAS telas de "Estoque" na
-- mesma sidebar.
--
-- Esta migration mexe SÓ na navegação: marca os menus antigos como inativos.
-- Nenhuma tabela é alterada e nenhum dado é apagado. As rotas continuam
-- existindo no código e seguem alcançáveis por URL direta — a remoção dos
-- arquivos fica para quando ninguém sentir falta.
--
-- Estado das tabelas na data desta migration: produto, estoque_movimento,
-- estoque_saldo, estoque_lote, estoque_reserva, requisicao_compra,
-- pedido_compra, cotacao, nf_entrada e recebimento estavam TODAS VAZIAS.
--
-- O QUE FICA, e por quê:
--   almoxarifados  → sup_estoque_item.almoxarifado_id aponta para lá; é onde
--                    o Estoque & Etiquetas guarda cada item. É infraestrutura,
--                    não faz parte do fluxo RC/PC aposentado.
--   sup_*          → o módulo novo.
--
-- REVERTER: basta voltar ativo = true nos códigos abaixo (e recolocar os
-- itens em src/components/layout/Sidebar.tsx).
-- =====================================================================

UPDATE public.app_menu am
   SET ativo = false
  FROM public.app_modulo m
 WHERE m.id = am.modulo_id
   AND m.codigo = 'suprimentos'
   AND am.codigo IN (
     -- cadastros do modelo antigo
     'fornecedores', 'produtos-servicos', 'produtos', 'categorias',
     -- estoque por movimento (substituído por Estoque & Etiquetas)
     'estoque', 'movimentos',
     -- fluxo de compras RC/PC
     'requisicoes', 'cotacoes', 'pedidos', 'nf-entrada', 'recebimentos',
     'suprimentos_aprovacoes'
   );

-- Confere o resultado: só devem sobrar ativos os 4 menus do modelo novo
-- mais "almoxarifados".
SELECT am.codigo, am.nome, am.rota, am.ativo
  FROM public.app_menu am
  JOIN public.app_modulo m ON m.id = am.modulo_id
 WHERE m.codigo = 'suprimentos'
 ORDER BY am.ativo DESC, am.ordem, am.codigo;

NOTIFY pgrst, 'reload schema';
