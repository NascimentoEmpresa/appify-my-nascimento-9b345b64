import { describe, expect, it } from "vitest";
import { paginaDigitada, paginasVisiveis } from "@/lib/paginacao";

describe("Ir para a página (paginação numerada)", () => {
  it("aceita um número dentro do intervalo", () => {
    expect(paginaDigitada("7", 21)).toBe(7);
    expect(paginaDigitada(" 12 ", 21)).toBe(12);
  });
  it("limita ao primeiro e ao último", () => {
    expect(paginaDigitada("0", 21)).toBe(1);
    expect(paginaDigitada("999", 21)).toBe(21);
  });
  it("texto vazio ou inválido não navega", () => {
    expect(paginaDigitada("", 21)).toBeNull();
    expect(paginaDigitada("abc", 21)).toBeNull();
  });
  it("a função reexportada continua igual (Rescisões)", () => {
    expect(paginasVisiveis(10, 21)).toEqual([1, null, 9, 10, 11, null, 21]);
  });
});
