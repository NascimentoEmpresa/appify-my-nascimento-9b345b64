import { describe, expect, it } from "vitest";
import { erroLoginTransitorio, mensagemErroLogin } from "@/lib/loginErro";

// Login — "Database error querying schema" (16/10/2026, banco reiniciando).
describe("erro de login", () => {
  it("erro do banco é transitório e ganha mensagem de sistema instável", () => {
    const e = { status: 500, message: "Database error querying schema" };
    expect(erroLoginTransitorio(e)).toBe(true);
    expect(mensagemErroLogin(e)).toMatch(/instável/);
  });
  it("rede caída também é transitória", () => {
    expect(erroLoginTransitorio(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("senha errada não é repetida", () => {
    const e = { status: 400, message: "Invalid login credentials" };
    expect(erroLoginTransitorio(e)).toBe(false);
    expect(mensagemErroLogin(e)).toBe("E-mail ou senha incorretos.");
  });
});
