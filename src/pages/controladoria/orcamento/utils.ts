import type { PlanejamentoOrcamentarioRow } from "@/hooks/usePlanejamentoOrcamentario";

export type StatusVigencia = "na_vigencia" | "entrara_em_vigencia" | "historico";

export type OrcamentoComStatus = PlanejamentoOrcamentarioRow & { status: StatusVigencia };

// Comparação em string "YYYY-MM-DD" (formato nativo de <input type="date"> e
// da coluna `date` do Postgres) — evita problemas de fuso horário do Date.
export function getStatusVigencia(
  inicioVigencia: string,
  fimVigencia: string,
  hoje: Date = new Date()
): StatusVigencia {
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (hojeStr < inicioVigencia) return "entrara_em_vigencia";
  if (hojeStr >= fimVigencia) return "historico";
  return "na_vigencia";
}

export const STATUS_LABEL: Record<StatusVigencia, string> = {
  na_vigencia: "Na Vigência",
  entrara_em_vigencia: "Vão entrar em vigência",
  historico: "Histórico",
};

export const STATUS_BADGE_CLASS: Record<StatusVigencia, string> = {
  na_vigencia: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  entrara_em_vigencia: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  historico: "bg-slate-100 text-slate-600 hover:bg-slate-100",
};

export function fmtMoney(n: number | string | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}
