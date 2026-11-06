import { describe, expect, it } from "vitest";
import { centroPadraoDaEmpresa, ehMovimentacaoFinanceira, opcoesDeCentroCusto, type ContratoParaCentro } from "@/pages/financeiro/aplicacao-financeira/centroCusto";

// SIS-2026-0813: o centro de custo correto da Aplicação Financeira (aplicação e resgate) é o MOVIMENTAÇÃO FINANCEIRA da empresa.
const C = (id: string, nome: string, empresa_id: string, status = "ativo"): ContratoParaCentro => ({ id, nome, empresa_id, status });
const contratos = [
  C("1", "ADMINISTRATIVO - HAGG", "hagg"),
  C("2", "MOVIMENTAÇÃO FINANCEIRA - HAGG", "hagg"),
  C("3", "MOVIMENTAÇÃO FINANCEIRA - SN", "sn"),
  C("4", "CONTRATO X", "sn"),
  C("5", "Movimentacao Financeira antiga - HAGG", "hagg", "encerrado"),
];

describe("centro de custo da Aplicação Financeira", () => {
  it("reconhece MOVIMENTAÇÃO FINANCEIRA com ou sem acento e em qualquer caixa", () => {
    expect(ehMovimentacaoFinanceira("MOVIMENTAÇÃO FINANCEIRA - HAGG")).toBe(true);
    expect(ehMovimentacaoFinanceira("  movimentacao financeira")).toBe(true);
    expect(ehMovimentacaoFinanceira("ADMINISTRATIVO - HAGG")).toBe(false);
  });
  it("sugere o MOVIMENTAÇÃO FINANCEIRA da empresa escolhida, com o ativo na frente", () => {
    expect(centroPadraoDaEmpresa(contratos, "hagg")).toBe("2");
    expect(centroPadraoDaEmpresa(contratos, "sn")).toBe("3");
  });
  it("empresa sem esse contrato fica sem sugestão", () => {
    expect(centroPadraoDaEmpresa(contratos, "outra")).toBe("");
  });
  it("as opções são os contratos da empresa, com MOVIMENTAÇÃO FINANCEIRA primeiro, e mantêm o contrato já gravado", () => {
    expect(opcoesDeCentroCusto(contratos, "hagg").map((c) => c.id)).toEqual(["2", "5", "1"]);
    expect(opcoesDeCentroCusto(contratos, "sn", "1").map((c) => c.id)).toEqual(["3", "1", "4"]);
  });
});
