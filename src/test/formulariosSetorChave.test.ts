import { describe, expect, it } from "vitest";
import { chaveSetor, mesmoSetor, setoresUnicos } from "@/lib/formularios/setorChave";

// Espelha public.cs_form_chave_setor (mig 20261113003000): o setor carimbado
// na resposta vem com e sem acento, e a leitura "Por setor" tem que casar os dois.
describe("setor de formulário sem acento", () => {
  it("JURIDICO e JURÍDICO têm a mesma chave", () => {
    expect(chaveSetor("JURÍDICO")).toBe("JURIDICO");
    expect(chaveSetor("  licitação ")).toBe("LICITACAO");
    expect(chaveSetor("Diretor   Operacional")).toBe("DIRETOR OPERACIONAL");
    expect(chaveSetor(null)).toBe("");
  });

  it("mesmoSetor ignora acento, caixa e espaço; vazio nunca casa", () => {
    expect(mesmoSetor("LICITACAO", "Licitação")).toBe(true);
    expect(mesmoSetor("RH", "SST")).toBe(false);
    expect(mesmoSetor("", "")).toBe(false);
    expect(mesmoSetor(null, undefined)).toBe(false);
  });

  it("setoresUnicos: uma grafia por setor, a acentuada, sem PADRAO", () => {
    expect(setoresUnicos(["JURIDICO", "JURÍDICO", "LICITAÇÃO", "LICITACAO", " rh ", "PADRAO", null, ""]))
      .toEqual(["JURÍDICO", "LICITAÇÃO", "RH"]);
    // a acentuada vence mesmo vindo depois
    expect(setoresUnicos(["PRESIDENCIA", "presidência"])).toEqual(["PRESIDÊNCIA"]);
  });
});
