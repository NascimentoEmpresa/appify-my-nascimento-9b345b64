import { describe, expect, it } from "vitest";
import { afetaUsuariosParaBanco, somenteDigitos } from "@/pages/chamados/afetaUsuarios";

describe("Abrir chamado — Afeta quantos usuários (coluna integer)", () => {
  it("o caso do Ismael (22/10/2026) não manda fração ao banco", () => {
    expect(afetaUsuariosParaBanco("2.3")).toBe(2);
    expect(afetaUsuariosParaBanco("2,3")).toBe(2);
  });

  it("vazio, texto ou negativo vira null (campo é opcional)", () => {
    expect(afetaUsuariosParaBanco("")).toBeNull();
    expect(afetaUsuariosParaBanco("  ")).toBeNull();
    expect(afetaUsuariosParaBanco("todos")).toBeNull();
    expect(afetaUsuariosParaBanco("-4")).toBeNull();
  });

  it("inteiro passa como está", () => {
    expect(afetaUsuariosParaBanco("0")).toBe(0);
    expect(afetaUsuariosParaBanco("15")).toBe(15);
  });

  it("o campo só guarda dígitos enquanto se digita", () => {
    expect(somenteDigitos("2,3")).toBe("23");
    expect(somenteDigitos("12 pessoas")).toBe("12");
    expect(somenteDigitos("-5")).toBe("5");
  });
});
