/** Páginas a mostrar: a primeira, a última e uma em volta da atual; null = "…". (Saiu de PlanilhaRescisoes para as outras listas usarem.) */
export function paginasVisiveis(pagina: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const meio = [pagina - 1, pagina, pagina + 1].filter((p) => p > 1 && p < total);
  const out: (number | null)[] = [1];
  if (meio[0] > 2) out.push(null);
  out.push(...meio);
  if (meio[meio.length - 1] < total - 1) out.push(null);
  out.push(total);
  return out;
}

/** Página digitada em "Ir para": inteiro entre 1 e o total; texto vazio ou inválido = null (não navega). */
export function paginaDigitada(texto: string, total: number): number | null {
  const n = Number.parseInt(texto.trim(), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(1, n), Math.max(1, total));
}
