import { describe, it, expect } from "vitest";
import { COLS_TIPO_CONTRATO, COLS_TIPO_CONTRATO_EMPREGADOS, ehMEI } from "@/lib/rh/mei";

// MEI fica fora do Exportar Dados (18/09/2026) e continua intocado no
// Importar — a mesma detecção nos dois lugares.
describe("ehMEI", () => {
  it("reconhece MEI pelo TIPO DE CONTRATO da EMPREGADOS (CLT | MEI)", () => {
    expect(ehMEI({ "TIPO DE CONTRATO": "MEI" })).toBe(true);
    expect(ehMEI({ "TIPO DE CONTRATO": "CLT" })).toBe(false);
    expect(ehMEI({ "TIPO DE CONTRATO": null })).toBe(false);
    expect(ehMEI(null)).toBe(false);
  });
  it("reconhece pelas outras colunas de tipo/categoria, inclusive por extenso", () => {
    expect(ehMEI({ "Descrição (T. Contrato)": "Microempreendedor Individual" })).toBe(true);
    expect(ehMEI({ "Descrição (Cat. eSocial)": "Contribuinte individual - MEI" })).toBe(true);
    // "MEI" dentro de outra palavra não conta.
    expect(ehMEI({ "Descrição (Tipo)": "PRIMEIRO EMPREGO" })).toBe(false);
  });
  it("o SELECT do exportar só pede colunas que existem em EMPREGADOS", () => {
    expect(COLS_TIPO_CONTRATO_EMPREGADOS).not.toContain("Descrição (Categoria Contribuinte)");
    expect(COLS_TIPO_CONTRATO_EMPREGADOS).toContain("TIPO DE CONTRATO");
    expect(COLS_TIPO_CONTRATO.length).toBe(COLS_TIPO_CONTRATO_EMPREGADOS.length + 1);
  });
});
