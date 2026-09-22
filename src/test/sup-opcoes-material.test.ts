import { describe, it, expect } from "vitest";
import {
  OPCOES_PREDEFINIDAS,
  TAMANHOS_LETRA,
  TAMANHO_NUMERO_MAX,
  chipsDeOpcao,
} from "@/lib/suprimentos/opcoesMaterial";

/**
 * SIS-2026-0482 — "não aparece para selecionar".
 *
 * Duas queixas, a mesma causa: a grade de chips do Catálogo era a única
 * fonte de tamanho do select do pedido, e o estoque cadastra tamanho por
 * texto livre. O que o almoxarifado tinha e a grade não previa ficava
 * impossível de pedir.
 */

describe("grade de tamanhos", () => {
  it("cobre a numeração que o estoque já tem (50, 52, 54)", () => {
    for (const n of ["50", "52", "54"]) {
      expect(OPCOES_PREDEFINIDAS.tamanho).toContain(n);
    }
    expect(OPCOES_PREDEFINIDAS.tamanho).toContain(String(TAMANHO_NUMERO_MAX));
    expect(OPCOES_PREDEFINIDAS.tamanho).not.toContain(String(TAMANHO_NUMERO_MAX + 1));
  });

  it("tem o EXG do chamado e o XGG que veio do sistema antigo", () => {
    expect(TAMANHOS_LETRA).toContain("EXG");
    expect(TAMANHOS_LETRA).toContain("XGG");
  });

  it("EXG e EXGG são tamanhos diferentes — nenhum substitui o outro", () => {
    expect(OPCOES_PREDEFINIDAS.tamanho).toContain("EXG");
    expect(OPCOES_PREDEFINIDAS.tamanho).toContain("EXGG");
  });

  it("letra antes de número, sem repetir", () => {
    const t = OPCOES_PREDEFINIDAS.tamanho;
    expect(t.slice(0, TAMANHOS_LETRA.length)).toEqual([...TAMANHOS_LETRA]);
    expect(new Set(t).size).toBe(t.length);
  });
});

describe("chipsDeOpcao", () => {
  it("sem nada gravado, é a grade e só", () => {
    expect(chipsDeOpcao("tamanho")).toEqual(OPCOES_PREDEFINIDAS.tamanho);
    expect(chipsDeOpcao("quantidade")).toEqual(OPCOES_PREDEFINIDAS.quantidade);
  });

  it("tamanho que só existe no estoque vira chip", () => {
    const chips = chipsDeOpcao("tamanho", ["P", "M"], ["M", "38 LONGO"]);
    expect(chips).toContain("38 LONGO");
  });

  it("o que está fora da grade vai para o fim, nunca no meio", () => {
    const chips = chipsDeOpcao("tamanho", ["TAM UNICO"]);
    expect(chips.slice(0, -1)).toEqual(OPCOES_PREDEFINIDAS.tamanho);
    expect(chips.at(-1)).toBe("TAM UNICO");
  });

  it("não duplica o que a grade já tem, mesmo com caixa e espaço diferentes", () => {
    expect(chipsDeOpcao("tamanho", [" exgg ", "GG"])).toEqual(OPCOES_PREDEFINIDAS.tamanho);
  });

  it("gravado e estoque apontando o mesmo tamanho dão um chip só", () => {
    const chips = chipsDeOpcao("tamanho", ["ESPECIAL"], ["especial"]);
    expect(chips.filter((c) => c.toUpperCase() === "ESPECIAL")).toEqual(["ESPECIAL"]);
  });

  it("o chip fora da grade mantém o texto gravado — é ele que a tela marca", () => {
    // Se o rótulo fosse normalizado, o chip "EXG" nunca apareceria marcado
    // para um item que tem "exg" gravado, e clicar gravaria os dois.
    expect(chipsDeOpcao("tamanho", ["tam especial"]).at(-1)).toBe("tam especial");
  });

  it("extras ordenados: letra antes de número, número por valor", () => {
    const chips = chipsDeOpcao("tamanho", ["72", "ZZ", "64", "AA"]);
    expect(chips.slice(OPCOES_PREDEFINIDAS.tamanho.length)).toEqual(["AA", "ZZ", "64", "72"]);
  });

  it("vazio e espaço em branco não viram chip", () => {
    expect(chipsDeOpcao("tamanho", ["", "   "])).toEqual(OPCOES_PREDEFINIDAS.tamanho);
  });

  it("tipo desconhecido não quebra", () => {
    expect(chipsDeOpcao("cor", ["AZUL"])).toEqual(["AZUL"]);
  });
});
