export interface CompraComValorPrevisto {
  valor_previsto_compra?: number | null;
  valor_total?: number | null;
}

/**
 * Referência usada no saving. Linhas anteriores ao SIS-2026-0818 ainda não
 * têm a coluna própria e caem no valor que já existia na solicitação.
 */
export function obterValorPrevistoCompra(compra: CompraComValorPrevisto): number {
  return Number(compra.valor_previsto_compra ?? compra.valor_total ?? 0);
}

/** Saving nunca vira negativo: comprar acima da previsão é zero saving. */
export function calcularSavingCompra(valorPrevisto: number, valorComprado: number): number {
  return Math.max(Number(valorPrevisto || 0) - Number(valorComprado || 0), 0);
}
