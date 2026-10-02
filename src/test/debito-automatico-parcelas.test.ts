import { describe, expect, it } from "vitest";
import {
  diasParaVencer, gerarParcelasAutomaticas, somaParcelas, somarMeses, validarParcelas,
} from "@/pages/financeiro/debito-automatico/parcelas";

describe("somarMeses", () => {
  it("mantém o dia", () => {
    expect(somarMeses("2026-10-10", 1)).toBe("2026-11-10");
    expect(somarMeses("2026-10-10", 3)).toBe("2027-01-10");
  });
  it("dia 31 cai no último dia do mês curto", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-01-31", 2)).toBe("2026-03-31");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
  });
});

describe("gerarParcelasAutomaticas", () => {
  it("divide igual e a soma bate", () => {
    const p = gerarParcelasAutomaticas(300, 3, "2026-10-10");
    expect(p.map((x) => x.valor)).toEqual([100, 100, 100]);
    expect(p.map((x) => x.data_vencimento)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
  });
  it("o centavo que sobra vai pra última parcela", () => {
    const p = gerarParcelasAutomaticas(100, 3, "2026-10-10");
    expect(p.map((x) => x.valor)).toEqual([33.33, 33.33, 33.34]);
    expect(somaParcelas(p)).toBe(100);
  });
  it("entrada inválida devolve vazio", () => {
    expect(gerarParcelasAutomaticas(0, 3, "2026-10-10")).toEqual([]);
    expect(gerarParcelasAutomaticas(100, 1, "2026-10-10")).toEqual([]);
    expect(gerarParcelasAutomaticas(100, 3, "")).toEqual([]);
  });
});

describe("validarParcelas", () => {
  const ok = gerarParcelasAutomaticas(100, 2, "2026-10-10");
  it("aceita grade correta", () => expect(validarParcelas(ok, 100)).toBeNull());
  it("recusa soma diferente do total", () => {
    expect(validarParcelas([{ ...ok[0], valor: 10 }, ok[1]], 100)).toMatch(/soma/);
  });
  it("recusa data vazia e valor zero", () => {
    expect(validarParcelas([{ ...ok[0], data_vencimento: "" }, ok[1]], 100)).toMatch(/data/);
    expect(validarParcelas([{ ...ok[0], valor: 0 }, ok[1]], 100)).toMatch(/valor/);
  });
});

describe("diasParaVencer", () => {
  it("positivo, zero e negativo", () => {
    expect(diasParaVencer("2026-10-10", "2026-10-03")).toBe(7);
    expect(diasParaVencer("2026-10-03", "2026-10-03")).toBe(0);
    expect(diasParaVencer("2026-10-01", "2026-10-03")).toBe(-2);
  });
});
