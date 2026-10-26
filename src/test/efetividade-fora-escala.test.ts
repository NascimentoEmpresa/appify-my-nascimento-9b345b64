import { describe, expect, it } from "vitest";
import { foraDaEscala, TOLERANCIA_FORA_ESCALA } from "@/lib/efetividade";

// Fora de escala (26/10/2026): presente com a 1ª batida a mais de 1h do
// início da escala. "Minha escala é às 7:30; se marquei depois das 8:30 já
// estou fora da minha escala."
const dia = (entrada: number | null, horarioPrevisto: number | null = 450, situacao: "presente" | "falta" = "presente") =>
  ({ situacao, entrada, horarioPrevisto });
const fixa = { flexivel: false };

describe("fora de escala", () => {
  it("tolerância de 1 hora", () => expect(TOLERANCIA_FORA_ESCALA).toBe(60));

  it("escala 7:30: até 8:30 está na escala; depois, fora", () => {
    expect(foraDaEscala(dia(450), fixa)).toBe(false);        // 07:30
    expect(foraDaEscala(dia(510), fixa)).toBe(false);        // 08:30 em ponto
    expect(foraDaEscala(dia(511), fixa)).toBe(true);         // 08:31
    expect(foraDaEscala(dia(840), fixa)).toBe(true);         // 14:00
  });

  it("muito cedo também é fora (6:00 numa escala das 7:30)", () => {
    expect(foraDaEscala(dia(390), fixa)).toBe(false);        // 06:30
    expect(foraDaEscala(dia(360), fixa)).toBe(true);         // 06:00
  });

  it("noturno que vira a meia-noite compara no relógio", () => {
    // escala 23:30, entrou 00:10 do dia seguinte (minuto ajustado 1450)
    expect(foraDaEscala(dia(1450, 1410), fixa)).toBe(false);
    expect(foraDaEscala(dia(1440 + 100, 1410), fixa)).toBe(true); // 01:40
  });

  it("não entra: falta, flexível, sem horário ou sem batida", () => {
    expect(foraDaEscala(dia(900, 450, "falta"), fixa)).toBe(false);
    expect(foraDaEscala(dia(900), { flexivel: true })).toBe(false);
    expect(foraDaEscala(dia(900, null), fixa)).toBe(false);
    expect(foraDaEscala(dia(null), fixa)).toBe(false);
  });
});
