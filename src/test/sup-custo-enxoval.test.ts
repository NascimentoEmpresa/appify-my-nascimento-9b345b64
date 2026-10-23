import { describe, expect, it } from "vitest";
import { custosPorItemDoEnxoval, totalDoEnxoval } from "@/lib/suprimentos/custoEnxoval";

describe("custo do enxoval", () => {
  it("soma o custo de cada material do enxoval", () => {
    const custos = custosPorItemDoEnxoval(["luva", "botina"], [
      { sup_item_id: "luva", custo_unitario: 12.5, base: null },
      { sup_item_id: "botina", custo_unitario: 89.9, base: null },
    ]);

    expect(custos.get("luva")).toBe(12.5);
    expect(totalDoEnxoval(custos.values())).toBe(102.4);
  });

  it("usa o maior custo entre almoxarifados e tamanhos do material-base", () => {
    const custos = custosPorItemDoEnxoval(["jaqueta"], [
      { sup_item_id: "jaqueta-m", custo_unitario: 70, base: { id: "jaqueta" } },
      { sup_item_id: "jaqueta-g", custo_unitario: 75, base: { id: "jaqueta" } },
      { sup_item_id: "jaqueta", custo_unitario: 68, base: null },
    ]);

    expect(custos.get("jaqueta")).toBe(75);
  });

  it("mantém o total atualizado quando um material deixa o enxoval", () => {
    const custos = custosPorItemDoEnxoval(["luva"], [
      { sup_item_id: "luva", custo_unitario: 12.5, base: null },
      { sup_item_id: "botina", custo_unitario: 89.9, base: null },
    ]);

    expect(totalDoEnxoval(custos.values())).toBe(12.5);
  });
});
