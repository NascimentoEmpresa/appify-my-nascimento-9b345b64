// SIS-2026-0759: só os sócios aparecem na lista de Responsável pelo Cartão.
import { describe, expect, it } from "vitest";
import { ehSocio } from "@/pages/financeiro/cartao-credito/socios";

describe("ehSocio", () => {
  it("reconhece os cinco sócios, com acento, caixa e nome do meio abreviado", () => {
    ["SENILTON", "CARLOS EDUARDO NASCIMENTO", "Guiomar", "ANTÔNIO VIANEI", "Helena R Nascimento", "helena nascimento"].forEach((n) =>
      expect(ehSocio(n)).toBe(true),
    );
  });

  it("não deixa passar quem não é sócio", () => {
    ["Carlos Silva", "Antonio Souza", "Helena Souza", "Maria Nascimento", "", null, undefined].forEach((n) => expect(ehSocio(n)).toBe(false));
  });
});
