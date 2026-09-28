import { describe, expect, it } from "vitest";
import { ehAPropriaPessoa } from "@/lib/demissao/solicitacao";

describe("ehAPropriaPessoa — ninguém pede a própria demissão", () => {
  it("mesmo ID do EMPREGADOS", () => {
    expect(ehAPropriaPessoa({ id: 10, cpf: "" }, { id: 10, cpf: "" })).toBe(true);
  });
  it("mesmo CPF em formatos diferentes", () => {
    expect(ehAPropriaPessoa({ id: 1, cpf: "195.830.442-53" }, { id: 2, cpf: "19583044253" })).toBe(true);
  });
  it("outra pessoa, ou sem vínculo/CPF, passa", () => {
    expect(ehAPropriaPessoa({ id: 1, cpf: "195.830.442-53" }, { id: 2, cpf: "111.111.111-11" })).toBe(false);
    expect(ehAPropriaPessoa({ id: 1, cpf: "" }, { id: 2, cpf: "" })).toBe(false);
    expect(ehAPropriaPessoa({ id: 1, cpf: "1" }, null)).toBe(false);
  });
});
