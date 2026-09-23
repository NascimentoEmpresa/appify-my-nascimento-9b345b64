import { describe, expect, it } from "vitest";
import { honorariosEmReais, pctHonorarios, totalDaProposta } from "@/lib/juridico/proposta";

// Proposta de acordo + honorários advocatícios (22/09/2026): o exemplo do
// Pablo — 22 mil com 10% de honorários fecha em 24.200.

describe("proposta — honorários e total", () => {
  it("o caso pedido: 22.000 + 10% = 24.200", () => {
    expect(honorariosEmReais(22000, 10)).toBe(2200);
    expect(totalDaProposta(22000, 10)).toBe(24200);
  });
  it("sem porcentagem, o total é o próprio valor", () => {
    expect(totalDaProposta(22000, 0)).toBe(22000);
    expect(totalDaProposta(22000, null)).toBe(22000);
    expect(totalDaProposta(22000, undefined)).toBe(22000);
    expect(honorariosEmReais(22000, 0)).toBe(0);
  });
  it("valor zerado não gera honorários", () => {
    expect(totalDaProposta(0, 10)).toBe(0);
    expect(honorariosEmReais(0, 10)).toBe(0);
  });
  it("arredonda em centavos, sem sobra de ponto flutuante", () => {
    expect(honorariosEmReais(1234.56, 7.5)).toBe(92.59);
    expect(totalDaProposta(1234.56, 7.5)).toBe(1327.15);
    expect(totalDaProposta(0.1 + 0.2, 0)).toBe(0.3);
  });
  it("porcentagem com vírgula, negativa ou acima de 100", () => {
    expect(pctHonorarios("12,5")).toBe(12.5);
    expect(pctHonorarios("abc")).toBe(0);
    expect(pctHonorarios(-5)).toBe(0);
    expect(pctHonorarios(180)).toBe(100);
    expect(totalDaProposta(1000, pctHonorarios("20,00"))).toBe(1200);
  });
});
