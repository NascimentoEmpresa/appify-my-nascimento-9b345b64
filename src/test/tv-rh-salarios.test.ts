import { describe, expect, it } from "vitest";
import { acimaDoOrcamento, contratosDoGrafico, desvioTotal, rotuloCompetencias, tomDesvio, type DadosRhSalariosTv } from "@/lib/tv/rhSalariosTv";
import { paginasDoRelatorio } from "@/lib/tv/relatorioTv";

// TV › RH — salários e benefícios × orçamento (11/11/2026). Dados fictícios.

const c = (contrato: string, desvio: number) => ({ contrato, pessoas: 10, orc_sal: 1000, real_sal: 1000 * (1 + desvio / 100), orc_ben: 0, real_ben: 0, desvio });
const d: DadosRhSalariosTv = {
  competencias: { vale_transporte: "2026-09", bsf: "2026-10" },
  orcado: 3000, realizado: 3240,
  contratos: [c("A", -4), c("B", 22), c("C", 6)],
};

describe("TV RH — salários e benefícios × orçamento", () => {
  it("folga de 5%: só acusa acima dela", () => {
    expect(tomDesvio(4.9)).toBe("bom");
    expect(tomDesvio(5)).toBe("bom");
    expect(tomDesvio(8)).toBe("atencao");
    expect(tomDesvio(10.1)).toBe("critico");
    expect(acimaDoOrcamento(d)).toBe(2);
  });

  it("o gráfico vem do que mais passou do orçado", () => {
    expect(contratosDoGrafico(d).map((x) => x.contrato)).toEqual(["B", "C", "A"]);
  });

  it("desvio total e de onde veio cada rateio", () => {
    expect(desvioTotal(d)).toBe(8);
    expect(desvioTotal({ ...d, orcado: 0 })).toBeNull();
    expect(rotuloCompetencias(d.competencias)).toBe("VT set/26 · BSF out/26");
  });

  it("uma página só no item", () => {
    expect(paginasDoRelatorio({ ...d, tipo: "rh-salarios", contrato: null })).toHaveLength(1);
  });
});
