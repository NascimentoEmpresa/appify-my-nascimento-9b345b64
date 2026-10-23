import { describe, expect, it } from "vitest";
import { parseValorBR, valorConfere } from "@/pages/financeiro/fluxo-caixa/filtroValor";

describe("parseValorBR", () => {
  it("aceita o jeito brasileiro e o simples", () => {
    expect(parseValorBR("1.234,56")).toBe(1234.56);
    expect(parseValorBR("1234,56")).toBe(1234.56);
    expect(parseValorBR("1234.56")).toBe(1234.56);
    expect(parseValorBR("R$ 1.234,56")).toBe(1234.56);
    expect(parseValorBR("89,74")).toBe(89.74);
    expect(parseValorBR("500")).toBe(500);
  });
  it("ponto com 3 casas é milhar, não decimal", () => {
    expect(parseValorBR("1.234")).toBe(1234);
    expect(parseValorBR("1.234.567")).toBe(1234567);
    expect(parseValorBR("12.5")).toBe(12.5);
  });
  it("vazio ou texto inválido não filtra", () => {
    expect(parseValorBR("")).toBeNull();
    expect(parseValorBR("   ")).toBeNull();
    expect(parseValorBR(null)).toBeNull();
    expect(parseValorBR("abc")).toBeNull();
  });
  it("sinal é ignorado", () => {
    expect(parseValorBR("-89,74")).toBe(89.74);
  });
});

describe("valorConfere", () => {
  it("compara em centavos, sem erro de ponto flutuante", () => {
    expect(valorConfere(1066.65, 1066.65)).toBe(true);
    expect(valorConfere("1066.65", 1066.65)).toBe(true);
    expect(valorConfere(0.1 + 0.2, 0.3)).toBe(true);
    expect(valorConfere(1066.66, 1066.65)).toBe(false);
  });
  it("entrada e saída guardadas positivas; sinal do filtro não importa", () => {
    expect(valorConfere(89.74, -89.74)).toBe(true);
  });
  it("sem filtro, tudo passa", () => {
    expect(valorConfere(123, null)).toBe(true);
  });
});

// Filtro por valor: acha a despesa rateada pelo valor de uma fatia do rateio (a linha mostra o total e abre o rateio).
import { valorNaLinha } from "@/pages/financeiro/fluxo-caixa/filtroValor";
describe("valorNaLinha (valor dentro do rateio)", () => {
  const dm0733 = { valor: 821.6, rateioDetalhe: [{ valor: 79 }, { valor: 742.6 }] };
  it("acha pelo total, pela fatia do rateio, e não acha outro valor", () => {
    expect(valorNaLinha(dm0733, 821.6)).toBe("total");
    expect(valorNaLinha(dm0733, 79)).toBe("rateio");
    expect(valorNaLinha(dm0733, 742.6)).toBe("rateio");
    expect(valorNaLinha(dm0733, 80)).toBeNull();
  });
  it("sem filtro devolve o total (a linha entra); sem rateio só confere o total", () => {
    expect(valorNaLinha(dm0733, null)).toBe("total");
    expect(valorNaLinha({ valor: 50 }, 50)).toBe("total");
    expect(valorNaLinha({ valor: 50 }, 20)).toBeNull();
  });
});
