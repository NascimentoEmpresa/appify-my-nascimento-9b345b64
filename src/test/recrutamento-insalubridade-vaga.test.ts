import { describe, expect, it } from "vitest";
import { insalubridadeDoCusto, notaDoCusto, type CustoPosto } from "@/lib/recrutamento/custoPosto";

// Solicitar Nova Vaga › Insalubridade (20/10/2026). Caso real: MONICA DOS
// SANTOS MEDEIROS, 20% de insalubridade no cadastro (Senior), posto "AE VILA
// DOS COMERCIARIOS" com a Planilha de Custo sem o valor — a vaga saía "Não".
const custo = (insalubridade: number | null): CustoPosto =>
  ({ posto: "AE VILA DOS COMERCIARIOS", salario: 1814.94, insalubridade } as unknown as CustoPosto);

describe("insalubridade da vaga", () => {
  it("planilha do posto sem insalubridade + cadastro com 20% → Sim, 20% (do cadastro)", () => {
    expect(insalubridadeDoCusto(custo(0), "20,00", "1.814,94")).toEqual({ recebe: "Sim", quanto: "20%", origem: "cadastro" });
    expect(insalubridadeDoCusto(custo(null), "20,00")).toMatchObject({ recebe: "Sim", origem: "cadastro" });
  });

  // 26/10/2026 — vaga #1388, CARLA THAINA DE SOUZA MORAIS: 40,00 na Senior,
  // a planilha do posto dizia R$ 385,15 (20%) e a vaga saiu com 20%.
  it("cadastro (Senior) manda mesmo com a planilha dizendo outra coisa", () => {
    expect(insalubridadeDoCusto(custo(385.15), "40,00", "1.765,86")).toEqual({ recebe: "Sim", quanto: "40%", origem: "cadastro" });
  });

  it("cadastro com 0 → Não, mesmo com valor na planilha", () => {
    expect(insalubridadeDoCusto(custo(362.99), "0,00", "1.814,94")).toEqual({ recebe: "Não", quanto: "", origem: "cadastro" });
  });

  it("cadastro vazio → a planilha entra", () => {
    const r = insalubridadeDoCusto(custo(362.99), null, "1.814,94");
    expect(r.origem).toBe("planilha");
    expect(r.recebe).toBe("Sim");
    expect(r.quanto).toContain("(20%)");
    expect(insalubridadeDoCusto(custo(362.99), "", "1.814,94").origem).toBe("planilha");
  });

  it("nem planilha nem cadastro → Não", () => {
    expect(insalubridadeDoCusto(custo(0), "0,00")).toEqual({ recebe: "Não", quanto: "", origem: "cadastro" });
    expect(insalubridadeDoCusto(custo(0), undefined)).toEqual({ recebe: "Não", quanto: "", origem: "planilha" });
  });

  it("sem planilha: cadastro como antes", () => {
    expect(insalubridadeDoCusto(null, "40")).toEqual({ recebe: "Sim", quanto: "40%", origem: "cadastro" });
    expect(insalubridadeDoCusto(null, "20,5")).toMatchObject({ quanto: "20,5%" });
  });

  it("o aviso diz que a insalubridade veio do cadastro", () => {
    expect(notaDoCusto({ ...custo(0), casou_salario: true } as CustoPosto, "cadastro", "AE VILA DOS COMERCIARIOS"))
      .toContain("cadastro do colaborador na Senior");
  });
});
