import { describe, it, expect } from "vitest";
import { agruparKpi, explicacaoKpi, linhasDoKpi, totalKpi } from "@/pages/financeiro/fluxo-caixa/kpiFluxo";

const HOJE = "2026-10-14";
type L = { tipo: "entrada" | "saida"; valor: number; data_pagamento: string | null; origem: string; situacao_base?: "aberto" | "cancelado" | null };

const linhas: L[] = [
  { tipo: "entrada", valor: 1000, data_pagamento: "2026-09-15", origem: "debito_automatico", situacao_base: "aberto" }, // vencida
  { tipo: "saida", valor: 300, data_pagamento: "2026-10-01", origem: "malote", situacao_base: "aberto" }, // vencida
  { tipo: "saida", valor: 200, data_pagamento: "2026-10-20", origem: "malote", situacao_base: "aberto" },
  { tipo: "saida", valor: 50, data_pagamento: "2026-12-10", origem: "malote" }, // cartão futuro, já no Fluxo
  { tipo: "saida", valor: 100, data_pagamento: "2026-10-10", origem: "debito_automatico", situacao_base: "aberto" }, // vencida
];

describe("Fluxo de Caixa — modal dos KPIs", () => {
  it("cada card soma as linhas certas", () => {
    expect(linhasDoKpi(linhas, "entradas", HOJE)).toHaveLength(1);
    expect(linhasDoKpi(linhas, "saidas", HOJE)).toHaveLength(4);
    expect(linhasDoKpi(linhas, "vencidas", HOJE).map((l) => l.valor)).toEqual([300, 100]);
    expect(linhasDoKpi(linhas, "saldo", HOJE)).toHaveLength(5);
  });

  it("totais batem com o que o card mostra (saldo = entradas − saídas)", () => {
    expect(totalKpi(linhasDoKpi(linhas, "entradas", HOJE), "entradas")).toBe(1000);
    expect(totalKpi(linhasDoKpi(linhas, "saidas", HOJE), "saidas")).toBe(650);
    expect(totalKpi(linhasDoKpi(linhas, "vencidas", HOJE), "vencidas")).toBe(400);
    expect(totalKpi(linhas, "saldo")).toBe(350);
  });

  it("agrupa por origem e a soma dos grupos fecha o total", () => {
    const saidas = linhasDoKpi(linhas, "saidas", HOJE);
    const grupos = agruparKpi(saidas, (l) => l.origem);
    expect(grupos.map((g) => [g.chave, g.qtd, g.saidas])).toEqual([["malote", 3, 550], ["debito_automatico", 1, 100]]);
    expect(grupos.reduce((s, g) => s + g.saidas, 0)).toBe(totalKpi(saidas, "saidas"));
  });

  it("saldo por grupo é entradas − saídas do grupo", () => {
    const g = agruparKpi(linhas, (l) => l.origem);
    expect(g.find((x) => x.chave === "debito_automatico")?.total).toBe(1000 - 100);
    expect(g.find((x) => x.chave === "malote")?.total).toBe(-550);
  });

  it("explicação muda com a aba e avisa o que não entra", () => {
    expect(explicacaoKpi("entradas", "projetado").titulo).toBe("Entradas previstas");
    expect(explicacaoKpi("entradas", "projetado").aviso).toMatch(/contas a receber/);
    expect(explicacaoKpi("entradas", "realizado").aviso).toBeUndefined();
    expect(explicacaoKpi("saldo", "realizado").aviso).toMatch(/saldo bancário/);
  });
});
