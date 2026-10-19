import { describe, it, expect } from "vitest";
import { textoChecklistAso } from "@/lib/recrutamento/fichaAso";

describe("textoChecklistAso (SIS-2026-0667)", () => {
  it("sai no formato do CHECKLIST ASO do chamado, com os dados da ficha", () => {
    const t = textoChecklistAso({
      tipo_aso: "Admissional", nome: "MARIA DA SILVA", nascimento: "1990-05-07", nome_mae: "ANA",
      funcao: "SERVENTE", cpf: "123.456.789-09", rg: "1234", pis: "999", posto: "FORO 01",
      local_cidade: "PORTO ALEGRE", celular: "51999990000", empresa: "HAGG", contrato: "TJ", encarregado: "JOÃO",
    });
    const linhas = t.split("\n");
    expect(linhas[0]).toBe("ASO - ATESTADO DE SAÚDE OCUPACIONAL");
    expect(linhas).toContain("Tipo de ASO: Admissional");
    expect(linhas).toContain("Data de Nascimento: 07/05/1990");
    expect(linhas).toContain("Setor/Posto: FORO 01");
    expect(linhas.at(-1)).toBe("Encarregado: JOÃO");
    expect(linhas).toHaveLength(15);
  });

  it("campo que falta sai em branco depois dos dois-pontos", () => {
    const t = textoChecklistAso({ nome: "MARIA", pis: null });
    expect(t.split("\n")).toContain("PIS:");
    expect(t.split("\n")).toContain("Nome: MARIA");
  });
});
