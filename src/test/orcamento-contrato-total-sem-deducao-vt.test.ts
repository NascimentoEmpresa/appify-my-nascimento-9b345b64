import { describe, expect, it } from "vitest";
import { computarGruposContrato, somarOrcadoContratosPorClassificacao } from "@/hooks/useOrcamentoContratos";
import type { PlanilhaCustoRow } from "@/hooks/usePlanilhaCusto";
import type { ContratoERP } from "@/hooks/useContratosERP";

// SAMU: o total do contrato passava do real porque a Dedução VT (que não entra no total do
// posto da Planilha de Custo) estava sendo somada como as demais rubricas.
const contrato = { id: "c1", nome: "SAMU", status: "ativo" } as ContratoERP;
const linha = (o: Partial<PlanilhaCustoRow>): PlanilhaCustoRow =>
  ({ contrato_id: "c1", orexec: "EXECUTADO", encerrado: false, posto: "P", data_vigencia: "2026-01-01", qt_postos: 10, ...o }) as PlanilhaCustoRow;

const planilha = [linha({ salario: 1000, transporte: 200, transporte_desconto: 50, aux_alimentacao: 300, aux_alimentacao_desconto: 20, deducoes: 10 })];
const grupo = computarGruposContrato([contrato], planilha, new Map([["transporte", "cls-vt"], ["transporte_desconto", "cls-vt"]]))[0];
const valor = (campo: string) => grupo.rubricas.find((r) => r.campo === campo)?.valor;

describe("total do contrato no Orçamento de Contratos", () => {
  it("Dedução VT fica listada, mas fora do total", () => {
    expect(valor("transporte_desconto")).toBe(500);
    // salário 10.000 + VT 2.000 + alimentação 3.000 + desc. alimentação 200 − deduções 100 = 15.100 (sem os 500)
    expect(grupo.valorTotal).toBe(10000 + 2000 + 3000 + 200 - 100);
  });
  it("Desc. Auxílio Alimentação continua somando no total (decisão do Iury)", () => {
    expect(valor("aux_alimentacao_desconto")).toBe(200);
    expect(grupo.rubricas.find((r) => r.campo === "aux_alimentacao_desconto")?.somaNoTotal).toBe(true);
  });
  it("a rubrica 'Deduções' continua abatendo do total, como antes", () => {
    expect(valor("deducoes")).toBe(-100);
  });
  it("a Dedução VT continua contando no orçamento da classificação ligada (VT)", () => {
    const porClassificacao = somarOrcadoContratosPorClassificacao([grupo]);
    expect(porClassificacao.get("cls-vt")).toBe(2000 + 500);
  });
});
