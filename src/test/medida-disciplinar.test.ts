import { describe, expect, it } from "vitest";
import {
  MEDIDAS, dataNoFuturo, erroDaMedida, exigeChecarVerbal, medidaPor, perguntarSemVerbal, statusDaMedida,
} from "@/lib/rh/medidaDisciplinar";

// Medida disciplinar (22/09/2026): verbal é registro; escrita/suspensão/justa
// causa são solicitação e checam se existe verbal antes.

const ok = { colaborador_id: 10, data_ocorrido: "2026-09-20", descricao_ocorrido: "x".repeat(50), grau: "Médio" };

describe("medida disciplinar — opções", () => {
  it("são quatro, e só a verbal é registro", () => {
    expect(MEDIDAS.map((m) => m.chave)).toEqual(["verbal", "escrita", "suspensao", "justa_causa"]);
    expect(MEDIDAS.filter((m) => m.registro).map((m) => m.chave)).toEqual(["verbal"]);
  });
  it("o tipo gravado é o que o Jurídico já lê", () => {
    expect(MEDIDAS.map((m) => m.tipoGravado)).toEqual(["Verbal", "Escrita", "Suspensão", "Justa Causa"]);
    expect(medidaPor("justa_causa")?.tipoGravado).toBe("Justa Causa");
    expect(medidaPor("")).toBeNull();
  });
  it("verbal nasce Registrada; as outras vão para a fila", () => {
    expect(statusDaMedida("verbal")).toBe("Registrada");
    expect(statusDaMedida("escrita")).toBe("Aguardando Aprovação");
    expect(statusDaMedida("justa_causa")).toBe("Aguardando Aprovação");
  });
  it("só as que não são registro checam verbal anterior", () => {
    expect(exigeChecarVerbal("verbal")).toBe(false);
    expect(exigeChecarVerbal("escrita")).toBe(true);
    expect(exigeChecarVerbal("")).toBe(false);
  });
});

describe("medida disciplinar — validação", () => {
  it("sem medida escolhida não grava", () => {
    expect(erroDaMedida("", ok)).toMatch(/Escolha a medida/);
  });
  it("colaborador, data e descrição são obrigatórios", () => {
    expect(erroDaMedida("verbal", { ...ok, colaborador_id: null })).toMatch(/colaborador/);
    expect(erroDaMedida("verbal", { ...ok, data_ocorrido: "" })).toMatch(/data do ocorrido/);
    expect(erroDaMedida("verbal", { ...ok, descricao_ocorrido: "curta" })).toMatch(/50 caracteres/);
  });
  it("grau só é cobrado fora do registro verbal", () => {
    expect(erroDaMedida("verbal", { ...ok, grau: "" })).toBeNull();
    expect(erroDaMedida("escrita", { ...ok, grau: "" })).toMatch(/grau/);
    expect(erroDaMedida("escrita", ok)).toBeNull();
  });
  it("data no futuro é reconhecida", () => {
    const hoje = new Date("2026-09-22T12:00:00");
    expect(dataNoFuturo("2026-09-23", hoje)).toBe(true);
    expect(dataNoFuturo("2026-09-22", hoje)).toBe(false);
    expect(dataNoFuturo("", hoje)).toBe(false);
  });
});

describe("medida disciplinar — aviso de verbal ausente", () => {
  it("pergunta quando não há verbal e a medida é solicitação", () => {
    expect(perguntarSemVerbal("escrita", { total: 0, lista: [] })).toBe(true);
    expect(perguntarSemVerbal("justa_causa", { total: 0, lista: [] })).toBe(true);
  });
  it("não pergunta com verbal encontrada, no registro verbal, nem antes de consultar", () => {
    expect(perguntarSemVerbal("escrita", { total: 2, lista: [] })).toBe(false);
    expect(perguntarSemVerbal("verbal", { total: 0, lista: [] })).toBe(false);
    expect(perguntarSemVerbal("escrita", null)).toBe(false);
  });
});
