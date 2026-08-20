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

// SIS-2026-0168: "competencia" do malote_despesa é uma coluna `date`
// (vem como "YYYY-MM-DD"), mas o Ano/Mês do filtro é "YYYY-MM" — comparar
// os dois direto nunca batia, deixando "Utilizado" sempre zerado no
// Orçamento Geral (achado no SIS-2026-0192, ao testar um lançamento real).
export function competenciaNoPeriodo(competencia: string | null | undefined, anoMes: string): boolean {
  return !!competencia && competencia.slice(0, 7) === anoMes;
}

// % Utilizado só faz sentido com Orçado > 0 (regra combinada com o
// usuário: Orçado = 0 mostra "—", não 0% nem Infinity%).
export function fmtPct(utilizado: number, orcado: number): string {
  if (!orcado) return "—";
  return `${((utilizado / orcado) * 100).toFixed(2)}%`;
}
