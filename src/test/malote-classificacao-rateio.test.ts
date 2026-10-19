import { describe, expect, it } from "vitest";
import { classificacaoPorRateio } from "@/pages/malote/classificacaoRateio";

describe("SIS-2026-0682 · despesa com classificação definida pelo rateio", () => {
  it("cabeçalho sem classificação e rateio com classificações: é por rateio (não exige escolher uma)", () => {
    expect(classificacaoPorRateio(null, new Set(["c1", "c2", "c3"]))).toBe(true);
  });

  it("cabeçalho com classificação única: segue exigindo a classificação", () => {
    expect(classificacaoPorRateio("c1", new Set(["c1"]))).toBe(false);
    expect(classificacaoPorRateio("c1", new Set())).toBe(false);
  });

  it("sem classificação no cabeçalho nem no rateio: não é por rateio (continua exigindo)", () => {
    expect(classificacaoPorRateio(null, new Set())).toBe(false);
    expect(classificacaoPorRateio(undefined, [])).toBe(false);
  });
});
