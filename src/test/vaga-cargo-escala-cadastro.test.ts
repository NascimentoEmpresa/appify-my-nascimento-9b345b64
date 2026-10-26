import { describe, it, expect } from "vitest";
import { cargoForaDasFuncoes, escalaDiferenteDoCadastro } from "@/lib/recrutamento/vagaRegras";

describe("cargoForaDasFuncoes", () => {
  it("vaga #1376: AUXILIAR ESCRITORIO num posto de jardinagem avisa", () => {
    expect(cargoForaDasFuncoes("AUXILIAR ESCRITORIO", ["JARDINEIRO", "SUPERVISOR", "TRATORISTA"])).toBe(true);
  });
  it("cargo igual a uma função, sem acento/caixa, não avisa", () => {
    expect(cargoForaDasFuncoes("Jardineiro", ["JARDINEIRO", "SUPERVISOR"])).toBe(false);
    expect(cargoForaDasFuncoes("RECEPCIONISTA", ["Recepcionista"])).toBe(false);
    expect(cargoForaDasFuncoes("TÉCNICO", ["TECNICO"])).toBe(false);
  });
  it("um começando com o outro conta como o mesmo", () => {
    expect(cargoForaDasFuncoes("SERVENTE DE LIMPEZA", ["SERVENTE"])).toBe(false);
    expect(cargoForaDasFuncoes("JARDINEIRO", ["JARDINEIRO LIDER"])).toBe(false);
  });
  it("prefixo sem ser palavra inteira não conta", () => {
    expect(cargoForaDasFuncoes("SUPERVISORA", ["SUPERVISOR X"])).toBe(true);
  });
  it("sem funções ou sem cargo não avisa", () => {
    expect(cargoForaDasFuncoes("AUXILIAR ESCRITORIO", [])).toBe(false);
    expect(cargoForaDasFuncoes("", ["JARDINEIRO"])).toBe(false);
  });
});

describe("escalaDiferenteDoCadastro", () => {
  it("vaga #1364: 13:00-22:00 x cadastro 09:00-18:00 avisa", () => {
    expect(escalaDiferenteDoCadastro("13:00-22:00 (1H)(08:00)", "09:00-18:00 (1H)(08:00)")).toBe(true);
  });
  it("mesma escala com espaço/caixa diferentes não avisa", () => {
    expect(escalaDiferenteDoCadastro("09:00-18:00 (1h)(08:00)", "09:00-18:00(1H)(08:00)")).toBe(false);
  });
  it("cadastro sem escala ou vaga vazia não avisa", () => {
    expect(escalaDiferenteDoCadastro("13:00-22:00", null)).toBe(false);
    expect(escalaDiferenteDoCadastro("", "09:00-18:00")).toBe(false);
  });
});
