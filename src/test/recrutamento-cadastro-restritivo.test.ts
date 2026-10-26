import { describe, expect, it } from "vitest";
import {
  cpfMascarado, cpfValido, errosRestricao, filtrarRestricoes, formatarCpf, soDigitos, type Restricao,
} from "@/lib/recrutamento/cadastroRestritivo";

const r = (cpf: string, nome: string, motivo: string, origem: "recrutamento" | "juridico" | null, em: string): Restricao => ({
  cpf_digits: cpf, cpf_fmt: formatarCpf(cpf), nome, motivo, origem, criado_por: null, criado_em: em, atualizado_por: null, atualizado_em: null,
});
const L = [
  r("52998224725", "JOÃO DA SILVA", "Processo trabalhista contra a empresa", "juridico", "2026-10-01T10:00:00Z"),
  r("11144477735", "MARIA SOUZA", "Abandono de posto em 2025", "recrutamento", "2026-10-20T10:00:00Z"),
  r("39053344705", "PEDRO ANTIGO", "Furto comprovado", null, "2026-09-01T10:00:00Z"),
];

describe("CPF", () => {
  it("formata enquanto digita", () => {
    expect(formatarCpf("529")).toBe("529");
    expect(formatarCpf("5299822")).toBe("529.982.2");
    expect(formatarCpf("529.982.247-25")).toBe("529.982.247-25");
    expect(formatarCpf("5299822472599")).toBe("529.982.247-25");
  });
  it("valida os dígitos verificadores", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.444.777-35")).toBe(true);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("só dígitos e máscara de listagem", () => {
    expect(soDigitos("529.982.247-25")).toBe("52998224725");
    expect(cpfMascarado("52998224725")).toBe("***.982.247-**");
  });
});

describe("formulário e lista", () => {
  it("exige nome, CPF de 11 dígitos e motivo", () => {
    expect(errosRestricao({ nome: "", cpf: "123", motivo: " " })).toEqual(["Informe o nome.", "Informe o CPF com 11 dígitos.", "Informe o motivo da restrição."]);
    expect(errosRestricao({ nome: "Ana", cpf: "529.982.247-25", motivo: "x" })).toEqual([]);
  });
  it("busca por nome sem acento, CPF parcial ou motivo; mais recentes primeiro", () => {
    expect(filtrarRestricoes(L, "joao").map((x) => x.nome)).toEqual(["JOÃO DA SILVA"]);
    expect(filtrarRestricoes(L, "444.777").map((x) => x.nome)).toEqual(["MARIA SOUZA"]);
    expect(filtrarRestricoes(L, "furto").map((x) => x.nome)).toEqual(["PEDRO ANTIGO"]);
    expect(filtrarRestricoes(L, "").map((x) => x.nome)).toEqual(["MARIA SOUZA", "JOÃO DA SILVA", "PEDRO ANTIGO"]);
  });
  it("filtro por origem (sem origem = Jurídico, as antigas)", () => {
    expect(filtrarRestricoes(L, "", "juridico").map((x) => x.nome)).toEqual(["JOÃO DA SILVA", "PEDRO ANTIGO"]);
    expect(filtrarRestricoes(L, "", "recrutamento").map((x) => x.nome)).toEqual(["MARIA SOUZA"]);
  });
});
