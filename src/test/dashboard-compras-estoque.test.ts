import { describe, expect, it } from "vitest";
import {
  classeSituacaoEstoque,
  formatarMoeda,
  percentual,
  rotuloCategoria,
} from "@/lib/suprimentos/dashboardComprasEstoque";

describe("dashboard de compras, estoque e saving", () => {
  it("calcula percentuais sem propagar divisão por zero", () => {
    expect(percentual(18, 100)).toBe(18);
    expect(percentual(1, 3)).toBe(33.3);
    expect(percentual(10, 0)).toBe(0);
  });

  it("formata moeda e categorias no padrão do dashboard", () => {
    expect(formatarMoeda(326400.5)).toContain("326.400,50");
    expect(rotuloCategoria("epi")).toBe("EPI");
    expect(rotuloCategoria("insumo")).toBe("Insumos");
  });

  it("mantém uma classe visual distinta para cada faixa de estoque", () => {
    expect(classeSituacaoEstoque("Adequado")).toContain("emerald");
    expect(classeSituacaoEstoque("Atenção")).toContain("amber");
    expect(classeSituacaoEstoque("Baixo")).toContain("rose");
    expect(classeSituacaoEstoque("Sem estoque")).toContain("slate");
  });
});
