import { describe, expect, it } from "vitest";
import {
  PARTE_VAZIA, empresaDoGrupo, erroDasPartes, formatarDocumento, partes, posicaoEmpresa, seloOutros,
} from "@/lib/juridico/tipoProcesso";

// SIS-2026-0488 — processo "Outros": Autor × Réu, a empresa pode ser autora.

describe("tipo de processo — partes", () => {
  it("trabalhista continua reclamante × reclamada, empresa sempre ré", () => {
    const p = { tipo_processo: "trabalhista", reclamante: "Fulano", reclamada: "HAGG" };
    expect(partes(p)).toEqual({ rotulo1: "Reclamante", nome1: "Fulano", rotulo2: "Reclamada", nome2: "HAGG" });
    expect(posicaoEmpresa(p)).toBe("re");
    expect(empresaDoGrupo(p)).toBe("HAGG");
  });
  it("processo antigo sem tipo conta como trabalhista", () => {
    expect(partes({ reclamante: "A", reclamada: "SN" }).rotulo1).toBe("Reclamante");
  });
  it("outros: empresa do grupo autora", () => {
    const p = { tipo_processo: "outros", autor_tipo: "grupo", autor_nome: "HAGG", reu_tipo: "pj", reu_nome: "Cliente X Ltda", natureza_acao: "Cobrança" };
    expect(partes(p)).toEqual({ rotulo1: "Autor", nome1: "HAGG", rotulo2: "Réu", nome2: "Cliente X Ltda" });
    expect(posicaoEmpresa(p)).toBe("autora");
    expect(empresaDoGrupo(p)).toBe("HAGG");
    expect(seloOutros(p)).toBe("Cobrança · Empresa autora");
  });
  it("outros: empresa do grupo ré", () => {
    const p = { tipo_processo: "outros", autor_tipo: "pf", autor_nome: "Beltrano", reu_tipo: "grupo", reu_nome: "SN" };
    expect(posicaoEmpresa(p)).toBe("re");
    expect(empresaDoGrupo(p)).toBe("SN");
    expect(seloOutros(p)).toBe("Outros · Empresa ré");
  });
});

describe("tipo de processo — validação das partes", () => {
  const pf = (nome: string, documento = "") => ({ tipo: "pf" as const, nome, documento });
  const grupo = (nome: string) => ({ tipo: "grupo" as const, nome, documento: "" });
  it("exige o tipo e o nome de cada parte", () => {
    expect(erroDasPartes(PARTE_VAZIA(), pf("B"))).toMatch(/autor é pessoa/);
    expect(erroDasPartes(pf("A"), { ...PARTE_VAZIA(), tipo: "pj" })).toMatch(/nome do réu/);
    expect(erroDasPartes(grupo(""), pf("B"))).toMatch(/Escolha a empresa/);
  });
  it("documento é opcional, mas se vier tem que ter o tamanho certo", () => {
    expect(erroDasPartes(pf("A"), pf("B"))).toBeNull();
    expect(erroDasPartes(pf("A", "123"), pf("B"))).toMatch(/CPF do autor/);
    expect(erroDasPartes(pf("A"), { tipo: "pj", nome: "X", documento: "12.345.678/0001-9" })).toMatch(/CNPJ do réu/);
  });
  it("a mesma empresa não pode estar nos dois lados", () => {
    expect(erroDasPartes(grupo("HAGG"), grupo("HAGG"))).toMatch(/mesma empresa/);
    expect(erroDasPartes(grupo("HAGG"), grupo("SN"))).toBeNull();
  });
  it("formata CPF e CNPJ", () => {
    expect(formatarDocumento("12345678901")).toBe("123.456.789-01");
    expect(formatarDocumento("03644009000123")).toBe("03.644.009/0001-23");
    expect(formatarDocumento(" abc ")).toBe("abc");
  });
});
