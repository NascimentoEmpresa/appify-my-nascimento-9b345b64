// SIS-2026-0943 — Planilha de Custos aceita quantidade QUEBRADA de pessoas.
//
// Contrato cobrado por hora (Rodeio de Triunfo, vigia e limpeza, 11/2026): a
// Licitação lança 3,2 pessoas no posto pra o Total Posto bater com o contrato.
// A coluna planilha_custo.qt_postos sempre foi `numeric`; quem cortava para
// inteiro era o parseInt do formulário. Estes testes prendem que o custo
// mensal (o número que o Compras usa como orçamento) multiplica pelo valor
// quebrado, sem arredondar.
import { describe, expect, it } from "vitest";
import { somarQuantFuncExecContrato, somarValorExecutadoMensalContrato } from "@/hooks/usePlanilhaCusto";
import type { PlanilhaCustoRow } from "@/hooks/usePlanilhaCusto";

const CONTRATO = "c-rodeio";

const linha = (o: Partial<PlanilhaCustoRow>): PlanilhaCustoRow =>
  ({
    contrato_id: CONTRATO,
    contrato: "RODEIO DE TRIUNFO",
    orexec: "EXECUTADO",
    encerrado: false,
    data_vigencia: "2026-11-01",
    ...o,
  }) as PlanilhaCustoRow;

const planilha: PlanilhaCustoRow[] = [
  linha({ posto: "VIGIA", qt_postos: 3.2, total_por_empregado: 5000 }),
  linha({ posto: "LIMPEZA", qt_postos: 4.8, total_por_empregado: 4000 }),
];

describe("Planilha de Custos: pessoas quebradas (SIS-2026-0943)", () => {
  it("custo mensal = unitário × pessoas quebradas, sem arredondar", () => {
    // 3,2×5000 + 4,8×4000 = 16.000 + 19.200 = 35.200
    expect(somarValorExecutadoMensalContrato(planilha, CONTRATO)).toBeCloseTo(35200, 6);
  });

  it("total de pessoas soma o valor quebrado", () => {
    expect(somarQuantFuncExecContrato(planilha, CONTRATO)).toBeCloseTo(8, 6);
  });
});
