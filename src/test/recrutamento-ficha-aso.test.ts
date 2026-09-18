import { describe, it, expect } from "vitest";
import { CAMPOS_ASO, EDITAVEIS_ASO, dataBrDaFicha, faltandoNaFicha, fichaCompleta, rotuloAso } from "@/lib/recrutamento/fichaAso";

// Chamado do SST (18/09/2026): a ficha do ASO admissional tem 15 dados, na
// ordem do chamado, e o que faltar é apontado pro Recrutamento preencher.
describe("ficha do ASO", () => {
  it("são exatamente os 15 dados do chamado, na ordem", () => {
    expect(CAMPOS_ASO.map(c => c.label)).toEqual([
      "Tipo de ASO", "Nome", "Data de nascimento", "Nome da mãe", "Função", "CPF", "RG", "PIS",
      "Setor / Posto de trabalho", "Local / Cidade", "Celular", "E-mail", "Empresa", "Contrato", "Encarregado responsável",
    ]);
  });
  it("aponta o que falta, sem contar o tipo (que é sempre Admissional)", () => {
    const f = { tipo_aso: "Admissional", nome: "KIMBERLLY", nascimento: "2001-07-06", nome_mae: "Katya", funcao: "AUX", cpf: "1", rg: "2",
      pis: null, posto: "", local_cidade: "Porto Alegre", celular: "51", email: "k@x", empresa: "HAGG", contrato: "1109", encarregado: null };
    expect(faltandoNaFicha(f)).toEqual(["pis", "posto", "encarregado"]);
    expect(fichaCompleta(f)).toBe(false);
    expect(fichaCompleta({ ...f, pis: "160", posto: "DERCC", encarregado: "Carla" })).toBe(true);
    expect(faltandoNaFicha(null)).toEqual([]);
  });
  it("todo campo editável grava numa coluna de WA_CURRICULOS e tem rótulo", () => {
    for (const e of EDITAVEIS_ASO) { expect(e.coluna).toBeTruthy(); expect(rotuloAso(e.key)).not.toBe(e.key); }
    // Função, contrato e cidade vêm da vaga: não se editam na ficha.
    expect(EDITAVEIS_ASO.map(e => e.key)).not.toContain("funcao");
    expect(EDITAVEIS_ASO.map(e => e.key)).not.toContain("contrato");
  });
  it("data de nascimento em dd/mm/aaaa sem fuso", () => {
    expect(dataBrDaFicha("2001-07-06")).toBe("06/07/2001");
    expect(dataBrDaFicha("2001-07-06T00:00:00")).toBe("06/07/2001");
    expect(dataBrDaFicha(null)).toBe("");
  });
});
