// Fluxo de Caixa: o export para Excel abre o rateio em uma linha por cota.
import { describe, expect, it } from "vitest";
import { linhasDoExport, linhaTemContrato } from "@/pages/financeiro/fluxo-caixa/exportRateio";

const rateio = {
  valor: 100, contrato_id: null, contrato_nome: "Rateio", descricao: "Uniformes", fatura_cartao_id: null,
  rateioDetalhe: [{ id: "c1", nome: "ALFA", valor: 60 }, { id: "c2", nome: "BETA", valor: 40 }],
};

describe("export com rateio", () => {
  it("lançamento sem rateio sai em 1 linha, com o contrato dele", () => {
    const r = linhasDoExport({ valor: "50", contrato_id: "c1", contrato_nome: "ALFA", descricao: "x" });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ valor: 50, contrato: "ALFA", rateado: false, valorLancamento: 50 });
  });

  it("rateio entre contratos sai em 1 linha por cota e a soma fecha o lançamento", () => {
    const r = linhasDoExport(rateio);
    expect(r.map((x) => [x.contrato, x.valor])).toEqual([["ALFA", 60], ["BETA", 40]]);
    expect(r.every((x) => x.rateado && x.valorLancamento === 100 && x.descricao === "Uniformes")).toBe(true);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBe(100);
  });

  it("com filtro de contrato, só a cota daquele contrato", () => {
    const r = linhasDoExport(rateio, "c2");
    expect(r.map((x) => [x.contrato, x.valor])).toEqual([["BETA", 40]]);
  });

  it("fatura do cartão abre por despesa", () => {
    const r = linhasDoExport({
      valor: 30, contrato_id: null, contrato_nome: "Rateio", descricao: "Fatura", fatura_cartao_id: "f1",
      rateioDetalhe: [{ id: "a", nome: "DM-1 · Posto", valor: 10 }, { id: "b", nome: "DM-2 · Hotel", valor: 20 }],
    });
    expect(r.map((x) => [x.descricao, x.valor, x.contrato])).toEqual([["DM-1 · Posto", 10, ""], ["DM-2 · Hotel", 20, ""]]);
  });

  it("filtro de contrato aceita a linha rateada que tenha cota do contrato", () => {
    expect(linhaTemContrato(rateio, "c1")).toBe(true);
    expect(linhaTemContrato(rateio, "c9")).toBe(false);
    expect(linhaTemContrato({ valor: 1, contrato_id: "c9" }, "c9")).toBe(true);
  });
});
