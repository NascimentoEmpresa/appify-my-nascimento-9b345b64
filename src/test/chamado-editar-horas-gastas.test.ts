import { describe, expect, it } from "vitest";
import { lerHorasGastas, podeEditarHorasGastas } from "@/lib/chamados/horasGastas";

// Pedido do Pablo (10/11/2026, mig 20261110004000): os desenvolvedores
// corrigem as horas gastas de um chamado concluído e o parecer da I.A é
// refeito. Mesmo portão do banco: responsável ou gestão, só concluído.

const concluido = { status: "concluido", responsavel_id: "joao" };

describe("quem pode corrigir as horas gastas", () => {
  it("o responsável pelo chamado pode", () => {
    expect(podeEditarHorasGastas(concluido, "joao", false)).toBe(true);
  });
  it("a gestão de chamados pode, mesmo sem ser o responsável", () => {
    expect(podeEditarHorasGastas(concluido, "pablo", true)).toBe(true);
  });
  it("outro usuário não pode", () => {
    expect(podeEditarHorasGastas(concluido, "maria", false)).toBe(false);
  });
  it("sem login não pode", () => {
    expect(podeEditarHorasGastas(concluido, null, true)).toBe(false);
  });
  it("chamado que não está concluído não tem horas para corrigir", () => {
    for (const status of ["em_andamento", "reaberto", "aberto", null]) {
      expect(podeEditarHorasGastas({ status, responsavel_id: "joao" }, "joao", true)).toBe(false);
    }
  });
});

describe("o número corrigido passa pela mesma régua", () => {
  it("aceita meia hora com vírgula", () => {
    expect(lerHorasGastas("12,5")).toBe(12.5);
  });
  it("zero, vazio e texto não gravam", () => {
    expect(lerHorasGastas("0")).toBeNull();
    expect(lerHorasGastas("")).toBeNull();
    expect(lerHorasGastas("oito")).toBeNull();
  });
});
