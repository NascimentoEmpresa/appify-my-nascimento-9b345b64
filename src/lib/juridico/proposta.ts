// =====================================================================
// Proposta de acordo: honorários advocatícios e valor total (22/09/2026).
//
// Pedido do Pablo: "valor total da proposta abaixo / porcentagem dos
// honorários advocatícios. Se for o valor 22 mil e 10% de honorários, valor
// total = 24.200 — tem que puxar automático".
//
// O valor digitado continua sendo o da PROPOSTA (o que vai para a parte); os
// honorários entram por cima, em %. O total é proposta + honorários, e é
// calculado, nunca digitado — não há como os dois discordarem.
// =====================================================================

const arredonda = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Só os honorários, em reais. 22.000 + 10% → 2.200. */
export function honorariosEmReais(valor: number, pct: number | null | undefined): number {
  const v = Number(valor) || 0;
  const p = Number(pct) || 0;
  if (v <= 0 || p <= 0) return 0;
  return arredonda((v * p) / 100);
}

/** Proposta + honorários. 22.000 + 10% → 24.200. Sem % (ou 0) = o próprio valor. */
export function totalDaProposta(valor: number, pct: number | null | undefined): number {
  const v = Number(valor) || 0;
  return arredonda(v + honorariosEmReais(v, pct));
}

/** Percentual normalizado (0 a 100, no máximo 2 casas) ou 0. */
export function pctHonorarios(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(100, arredonda(n));
}
