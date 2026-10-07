import { describe, expect, it } from "vitest";
import { camposComPendencia, motivosRevisar } from "@/pages/financeiro/fluxo-caixa/motivosRevisar";

describe("motivos do selo revisar", () => {
  it("sem motivo, lista vazia", () => {
    expect(motivosRevisar(null)).toEqual([]);
    expect(motivosRevisar("")).toEqual([]);
  });
  it("separa os motivos e aponta o campo que resolve cada um", () => {
    const m = motivosRevisar("Contrato não mapeado (planilha: X) · Classificação não mapeada (planilha: —) · Possível duplicidade com Malote DM-2026-0926 (mesma empresa e valor)");
    expect(m.map((x) => x.campo)).toEqual(["contrato", "classificacao", null]);
    expect(m[2].texto).toContain("DM-2026-0926");
    expect(camposComPendencia(m).has("contrato")).toBe(true);
  });
  it("motivo sem campo (rateio sem cotas) não destaca nenhum campo do formulário", () => {
    const m = motivosRevisar("Rateio RH-78 sem cotas na planilha: carregado inteiro até a divisão ser informada");
    expect(m).toHaveLength(1);
    expect(m[0].campo).toBeNull();
  });
});
