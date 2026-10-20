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

  it("planilha com valor continua mandando, mesmo com o cadastro diferente", () => {
    const r = insalubridadeDoCusto(custo(362.99), "40,00", "1.814,94");
    expect(r.origem).toBe("planilha");
    expect(r.recebe).toBe("Sim");
    expect(r.quanto).toContain("(20%)");
  });

  it("nem planilha nem cadastro → Não", () => {
    expect(insalubridadeDoCusto(custo(0), "0,00")).toEqual({ recebe: "Não", quanto: "", origem: "planilha" });
    expect(insalubridadeDoCusto(custo(0), undefined)).toEqual({ recebe: "Não", quanto: "", origem: "planilha" });
  });

  it("sem planilha: cadastro como antes", () => {
    expect(insalubridadeDoCusto(null, "40")).toEqual({ recebe: "Sim", quanto: "40%", origem: "cadastro" });
    expect(insalubridadeDoCusto(null, "20,5")).toMatchObject({ quanto: "20,5%" });
  });

  it("o aviso diz que a insalubridade veio do cadastro", () => {
    expect(notaDoCusto({ ...custo(0), casou_salario: true } as CustoPosto, "cadastro", "AE VILA DOS COMERCIARIOS"))
      .toContain("veio a do cadastro do colaborador");
  });
});
