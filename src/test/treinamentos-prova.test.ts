import { describe, expect, it } from "vitest";
import { erroDaProva, novaPergunta, quizParaSalvar } from "@/pages/treinamentos/plataforma/ProvaEditor";
import type { PerguntaQuiz } from "@/pages/treinamentos/plataforma/tipos";

// Regras do editor da prova (22/09/2026). A correção e as tentativas moram no
// banco (trn_prova_*); aqui é o que impede salvar uma prova quebrada.

const unica = (p: Partial<PerguntaQuiz> = {}): PerguntaQuiz => ({ ...novaPergunta("unica"), enunciado: "1+1?", opcoes: ["1", "2"], correta: 1, ...p });

describe("prova — validação do editor", () => {
  it("prova sem pergunta não salva", () => {
    expect(erroDaProva([], {})).toMatch(/pelo menos uma/);
  });
  it("pergunta completa passa", () => {
    expect(erroDaProva([unica()], {})).toBeNull();
  });
  it("enunciado e opção vazios são barrados", () => {
    expect(erroDaProva([unica({ enunciado: " " })], {})).toMatch(/sem enunciado/);
    expect(erroDaProva([unica({ opcoes: ["1", ""] })], {})).toMatch(/opções/);
  });
  it("múltipla escolha exige ao menos uma correta", () => {
    const m = { ...novaPergunta("multipla"), enunciado: "pares", opcoes: ["2", "3"] };
    expect(erroDaProva([m], {})).toMatch(/ao menos uma/);
    expect(erroDaProva([{ ...m, corretas: [0] }], {})).toBeNull();
  });
  it("pontuação zero não vale", () => {
    expect(erroDaProva([unica({ pontos: 0 })], {})).toMatch(/pontuação/);
  });
  it("sortear mais perguntas do que existem é barrado", () => {
    expect(erroDaProva([unica()], { sortear: 2 })).toMatch(/Sortear/);
    expect(erroDaProva([unica(), unica({ id: "b" })], { sortear: 2 })).toBeNull();
  });
  it("V/F nasce com as duas opções prontas", () => {
    const vf = novaPergunta("vf");
    expect(vf.opcoes).toEqual(["Verdadeiro", "Falso"]);
    expect(erroDaProva([{ ...vf, enunciado: "céu é azul" }], {})).toBeNull();
  });
});

describe("prova — o que vai pro banco", () => {
  it("limpa espaços, ordena as corretas e tira campos que não se aplicam", () => {
    const [m] = quizParaSalvar([{ ...novaPergunta("multipla"), enunciado: " pares ", opcoes: [" 4 ", "3", "2"], corretas: [2, 0], explicacao: "  " }]);
    expect(m.enunciado).toBe("pares");
    expect(m.opcoes).toEqual(["4", "3", "2"]);
    expect(m.corretas).toEqual([0, 2]);
    expect(m.correta).toBe(0);
    expect(m).not.toHaveProperty("explicacao");
    const [u] = quizParaSalvar([unica({ corretas: [0] })]);
    expect(u).not.toHaveProperty("corretas");
    expect(u.tipo).toBe("unica");
  });
  it("quiz antigo (sem tipo/pontos) sai como única valendo 1 ponto", () => {
    const [q] = quizParaSalvar([{ id: "x", enunciado: "a", opcoes: ["a", "b"], correta: 0 }]);
    expect(q.tipo).toBe("unica");
    expect(q.pontos).toBe(1);
  });
});
