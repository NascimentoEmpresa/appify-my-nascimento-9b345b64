/**
 * Telas preservadas no ERP, mas retiradas da navegação e do gerenciamento de
 * acesso para não poluir o catálogo usado pelos administradores.
 *
 * Os registros continuam em app_menu: RouteGuard, AcessoGate e as policies do
 * banco ainda dependem dos códigos para proteger acessos por URL ou links
 * internos. Portanto, esconder aqui não transforma as rotas em públicas nem
 * apaga permissões já concedidas.
 */
export const ROTAS_OCULTAS_GERENCIAMENTO: ReadonlySet<string> = new Set([
  "/app/financeiro/capital-giro",
  "/app/financeiro/conciliacao-fluxo-caixa",
  "/app/financeiro/conta-garantida",
  "/app/financeiro/contas-pagar",
  "/app/financeiro/contas-receber",
  "/app/financeiro/contas-bancarias",
  "/app/financeiro/fluxo-caixa",
  "/app/financeiro/fluxo-caixa-diario",
  "/app/financeiro/integracao-bancaria",
  "/app/financeiro/movimentos",
  "/app/financeiro/programacao-pagamentos",
  "/app/financeiro/validacao-pos-pagamento",
  "/app/integracao/aliases",
  "/app/integracao",
  "/app/admin/migracao-zero",
]);

export function rotaVisivelNoGerenciamento(rota: string | null): boolean {
  return rota === null || !ROTAS_OCULTAS_GERENCIAMENTO.has(rota);
}
