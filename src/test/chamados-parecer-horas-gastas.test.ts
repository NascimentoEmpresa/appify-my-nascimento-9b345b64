import { describe, it, expect } from "vitest";
import {
  precificarPorHorasGastas, valorMedioMercado, valorRealGasto, HORAS_MES_CLT, SALARIO_MENSAL_DEV,
} from "@/lib/chamados/parecerHorasGastas";

// O parecer gravado do SIS-2026-0787 antes da regra: complexidade 4 (×2),
// freelancer 14 h, software house 20 h, interno 8 h (as gastas).
const precos0787 = [
  { perfil: "freelancer", valor_hora: 200, horas: 14, fator_complexidade: 2, valor: 5600 },
  { perfil: "software_house", valor_hora: 320, horas: 20, fator_complexidade: 2, valor: 12800 },
  { perfil: "interno", valor_hora: 165, horas: 8, fator_complexidade: 2, valor: 2640 },
];

describe("parecer da I.A pelas horas gastas (30/10/2026)", () => {
  it("SIS-2026-0787: as três modalidades e a média usam só as 8 h gastas", () => {
    const r = precificarPorHorasGastas(precos0787, 7013.33, 14, 8);
    expect(r.pelasHorasGastas).toBe(true);
    expect(r.horas).toBe(8);
    expect(r.precos.map((p) => p.horas)).toEqual([8, 8, 8]);
    expect(r.precos.map((p) => p.valor)).toEqual([3200, 5120, 2640]);
    // Média de mercado sem a equipe interna (vira o card de valor real).
    expect(r.valor_medio).toBe(4160);
    expect(r.precos[0].perfil).toBe("freelancer"); // o resto do preço fica
  });

  it("valor real gasto: hora do salário (R$ 3.138,65 ÷ 220 h) × horas gastas, sem complexidade", () => {
    expect(SALARIO_MENSAL_DEV / HORAS_MES_CLT).toBeCloseTo(14.27, 2);
    expect(valorRealGasto(8)).toEqual({ valor_hora: 14.27, horas: 8, valor: 114.13 });
    expect(valorRealGasto("12.5")?.valor).toBe(178.33);
    expect(valorRealGasto(null)).toBeNull();
    expect(valorRealGasto(0)).toBeNull();
  });

  it("listas: média sem a equipe interna só quando o preço é pelas horas gastas", () => {
    const pelasGastas = precificarPorHorasGastas(precos0787, 7013.33, 14, 8).precos;
    expect(valorMedioMercado(pelasGastas, 3653.33)).toBe(4160);
    expect(valorMedioMercado(precos0787, 7013.33)).toBe(7013.33); // horas diferentes = estimativa
    expect(valorMedioMercado(null, 100)).toBe(100);
  });

  it("aceita as horas como texto (numeric do PostgREST)", () => {
    expect(precificarPorHorasGastas(precos0787, 0, 14, "12.5").precos[1].valor).toBe(8000);
  });

  it("parecer antigo sem fator de complexidade conta ×1", () => {
    const r = precificarPorHorasGastas([{ valor_hora: 200, horas: 10, valor: 2000 }], 2000, 10, 3);
    expect(r.precos[0].valor).toBe(600);
  });

  it("sem horas gastas, mantém a estimativa da I.A", () => {
    for (const h of [null, undefined, 0, "", "0"]) {
      const r = precificarPorHorasGastas(precos0787, 7013.33, 14, h);
      expect(r.pelasHorasGastas).toBe(false);
      expect(r.precos).toBe(precos0787);
      expect(r.valor_medio).toBe(7013.33);
      expect(r.horas).toBe(14);
    }
  });
});
