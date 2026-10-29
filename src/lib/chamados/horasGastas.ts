// Horas gastas informadas pelo desenvolvedor ao concluir um chamado
// (mig 20261029002400). O banco recusa concluir sem elas (> 0 e <= 5000);
// aqui é a mesma régua, para o erro aparecer no campo antes de ir ao banco.

export const HORAS_GASTAS_MAX = 5000;

/** "12,5" / "12.5" / "3" → número; vazio, zero, negativo ou lixo → null. */
export function lerHorasGastas(texto: string | null | undefined): number | null {
  const t = String(texto ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= HORAS_GASTAS_MAX ? n : null;
}

/** 12.5 → "12,5"; 3 → "3"; null → "—". */
export function fmtHorasGastas(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
}
