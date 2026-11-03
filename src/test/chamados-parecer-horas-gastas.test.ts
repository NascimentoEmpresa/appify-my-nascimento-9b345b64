import { describe, it, expect } from "vitest";
import { precificarPorHorasGastas } from "@/lib/chamados/parecerHorasGastas";

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
    expect(r.valor_medio).toBe(3653.33);
    expect(r.precos[0].perfil).toBe("freelancer"); // o resto do preço fica
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
