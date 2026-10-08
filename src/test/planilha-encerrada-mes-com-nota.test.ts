import { describe, expect, it } from "vitest";
import { resolverLinhasPorPeriodo, somarCamposEmLinhas, type PlanilhaCustoRow } from "@/hooks/usePlanilhaCusto";

// SEMAE - 3038/2020: contrato encerrado, todas as linhas da Planilha de Custo marcadas
// "encerrado" — e mesmo assim com NFs Código N emitidas de jan a ago/2026.
const linha = (o: Partial<PlanilhaCustoRow>): PlanilhaCustoRow =>
  ({ contrato_id: "semae", orexec: "EXECUTADO", encerrado: true, posto: "LIMPEZA 220H", data_vigencia: "2026-01-01", qt_postos: 16, total_por_empregado: 6402.76, ...o }) as PlanilhaCustoRow;

const rows = [
  linha({ data_vigencia: "2025-08-22", total_por_empregado: 5985.43 }),
  linha({ data_vigencia: "2026-01-01", total_por_empregado: 6402.76 }),
  linha({ orexec: "ORÇADO", data_vigencia: "2026-01-01" }),
];
const fim = (anoMes: string) => { const [a, m] = anoMes.split("-").map(Number); const d = new Date(a, m, 0); d.setHours(0, 0, 0, 0); return d; };
const exec = (ls: PlanilhaCustoRow[]) => somarCamposEmLinhas(ls, ["total_por_empregado"]);

describe("planilha toda 'encerrada' em mês com nota", () => {
  it("sem o fallback o executável é zero (era o que fazia o contrato sumir)", () => {
    expect(exec(resolverLinhasPorPeriodo(rows, "semae", fim("2026-03")))).toBe(0);
  });
  it("com o fallback pega a vigência do mês: jan/2026 em diante usa 6.402,76 × 16", () => {
    expect(exec(resolverLinhasPorPeriodo(rows, "semae", fim("2026-03"), true))).toBeCloseTo(6402.76 * 16, 2);
  });
  it("antes da vigência nova ainda vale a anterior (dez/2025: 5.985,43 × 16)", () => {
    expect(exec(resolverLinhasPorPeriodo(rows, "semae", fim("2025-12"), true))).toBeCloseTo(5985.43 * 16, 2);
  });
  it("ignora linha ORÇADO mesmo com o fallback", () => {
    const soOrcado = [linha({ orexec: "ORÇADO" })];
    expect(exec(resolverLinhasPorPeriodo(soOrcado, "semae", fim("2026-03"), true))).toBe(0);
  });
  it("o comportamento padrão (sem o 4º parâmetro) não muda para quem já usa", () => {
    const ativa = [linha({ encerrado: false })];
    expect(exec(resolverLinhasPorPeriodo(ativa, "semae", fim("2026-03")))).toBeCloseTo(6402.76 * 16, 2);
  });
});
