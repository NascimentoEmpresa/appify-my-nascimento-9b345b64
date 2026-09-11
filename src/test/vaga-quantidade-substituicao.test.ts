import { describe, expect, it } from "vitest";
import {
  MOTIVOS_VAGA, MOTIVO_SUBSTITUICAO, maximoDeVagas, quantidadeValida,
} from "@/lib/recrutamento/vagaRegras";

// Pablo, 10/09/2026, testando a tela: "ao colocar o motivo Substituição, AINDA
// CONSIGO COLOCAR QUANTAS QUANTIDADES DE VAGA EU QUISER. eu falei se for
// substituição, NO MÁXIMO 1 VAGA."
//
// A trava vive na regra, não no componente, porque o formulário não é o único
// caminho até o banco — o mesmo modal grava criação e edição, e um `if` solto
// no JSX vale só para quem passa por ele.

describe("maximoDeVagas", () => {
  it("substituição não passa de 1", () => {
    expect(maximoDeVagas(MOTIVO_SUBSTITUICAO)).toBe(1);
  });

  it("todos os outros motivos continuam livres", () => {
    for (const m of MOTIVOS_VAGA.filter((m) => m !== MOTIVO_SUBSTITUICAO)) {
      expect(maximoDeVagas(m)).toBeGreaterThan(1);
    }
  });

  it("o motivo é comparado sem espaço sobrando — vem de <select>, mas também de banco", () => {
    expect(maximoDeVagas("  Substituição  ")).toBe(1);
  });
});

describe("quantidadeValida", () => {
  it("corta o que a pessoa digitou antes de trocar o motivo para substituição", () => {
    // O caso do relato: digitou 12, depois escolheu Substituição.
    expect(quantidadeValida(MOTIVO_SUBSTITUICAO, "12")).toBe(1);
    expect(quantidadeValida(MOTIVO_SUBSTITUICAO, 12)).toBe(1);
  });

  it("não mexe na quantidade dos outros motivos", () => {
    expect(quantidadeValida("Admissão", "12")).toBe(12);
  });

  it("campo vazio, zero, negativo ou lixo viram 1 — nunca 0 vaga nem NaN no banco", () => {
    for (const entrada of ["", "0", "-3", "abc"]) {
      expect(quantidadeValida("Admissão", entrada)).toBe(1);
    }
  });

  it("decimal digitado à mão não vira 2,5 vagas", () => {
    expect(quantidadeValida("Admissão", "2.9")).toBe(2);
  });
});
