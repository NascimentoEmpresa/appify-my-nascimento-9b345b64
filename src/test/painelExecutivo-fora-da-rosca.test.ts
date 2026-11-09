import { describe, expect, it } from "vitest";
import { textoForaDaRosca } from "@/lib/operacional/painelExecutivo";

describe("textoForaDaRosca", () => {
  it("separa os abaixo do piso dos sem receita", () => {
    expect(textoForaDaRosca(37, { contratos: {}, abaixo_piso: 7, ativos: 64 }))
      .toContain("37 de 64 contratos não encerrados. Fora da conta: 7 com receita abaixo de R$ 10 mil e 20 sem receita");
  });

  it("não fica negativo quando o DRE tem mais contratos que o cadastro", () => {
    expect(textoForaDaRosca(40, { contratos: {}, abaixo_piso: 2, ativos: 30 })).toContain("e 0 sem receita");
  });

  it("sem o detalhe (migration ainda não entrou) não mostra nada", () => {
    expect(textoForaDaRosca(37, undefined)).toBeNull();
  });
});
