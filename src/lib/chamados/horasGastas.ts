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

/**
 * Quem pode informar OU corrigir as horas de um chamado concluído — o mesmo
 * portão de chamado_informar_horas_gastas no banco: o responsável ou a gestão
 * de chamados. Desde a mig 20261110004000 (pedido do Pablo, 10/11/2026) as
 * horas já informadas também se corrigem, e o parecer da I.A é refeito com o
 * número novo.
 */
export function podeEditarHorasGastas(
  chamado: { status: string | null | undefined; responsavel_id: string | null | undefined },
  usuarioId: string | null | undefined,
  gestor: boolean,
): boolean {
  if (chamado.status !== "concluido" || !usuarioId) return false;
  return gestor || chamado.responsavel_id === usuarioId;
}

/** 12.5 → "12,5"; 3 → "3"; null → "—". */
export function fmtHorasGastas(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
}
