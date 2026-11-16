import { describe, expect, it } from "vitest";
import { nascimentoMudou, nascimentoParaIso, validarNascimento } from "@/lib/rh/dataNascimento";

describe("nascimentoParaIso — os dois formatos do EMPREGADOS", () => {
  it("ISO fica ISO", () => {
    expect(nascimentoParaIso("1990-06-11")).toBe("1990-06-11");
    expect(nascimentoParaIso("1990-06-11T00:00:00")).toBe("1990-06-11");
  });
  it("DD/MM/AAAA (o que a Senior manda) vira ISO", () => {
    expect(nascimentoParaIso("21/11/1990")).toBe("1990-11-21");
    expect(nascimentoParaIso("1/6/1990")).toBe("1990-06-01");
  });
  it("vazio, lixo e data inexistente viram null (nunca outra data)", () => {
    expect(nascimentoParaIso(null)).toBeNull();
    expect(nascimentoParaIso("")).toBeNull();
    expect(nascimentoParaIso("abc")).toBeNull();
    expect(nascimentoParaIso("31/02/1990")).toBeNull();
    expect(nascimentoParaIso("1990-13-01")).toBeNull();
  });
});

describe("nascimentoMudou — compara como data", () => {
  it("mesma data em formatos diferentes não é mudança", () => {
    expect(nascimentoMudou("11/06/1990", "1990-06-11")).toBe(false);
  });
  it("trocar só dia e mês, mantendo o ano, é mudança", () => {
    expect(nascimentoMudou("21/11/1990", "1990-06-11")).toBe(true);
  });
  it("apagar a data é mudança; vazio para vazio não", () => {
    expect(nascimentoMudou("1990-06-11", "")).toBe(true);
    expect(nascimentoMudou(null, "")).toBe(false);
  });
});

describe("validarNascimento", () => {
  const hoje = new Date(2026, 10, 16);
  it("aceita data passada e vazio", () => {
    expect(validarNascimento("1990-06-11", hoje)).toBeNull();
    expect(validarNascimento("", hoje)).toBeNull();
  });
  it("recusa futuro, antes de 1900 e inválida", () => {
    expect(validarNascimento("2026-11-17", hoje)).toMatch(/futuro/);
    expect(validarNascimento("1899-12-31", hoje)).toMatch(/1900/);
    expect(validarNascimento("1990-02-30", hoje)).toMatch(/inválida/);
  });
});
