import { describe, it, expect } from "vitest";
import {
  tamanhoDaVariante,
  nomeDaVariante,
  separarTamanhoDoNome,
  destinoDoTamanho,
  normalizarNomeMaterial,
} from "@/lib/suprimentos/tamanhoDoItem";

/**
 * Cada tamanho é um item com código próprio (20260930000163). Estas funções
 * espelham public.sup_tamanho_da_variante e public.sup_est_criar_material:
 * se a tela e o banco discordarem, a prévia da entrada diz "vai para JAQUETA M"
 * e o banco grava em outro lugar.
 */

describe("tamanhoDaVariante", () => {
  it("normaliza como o banco grava", () => {
    expect(tamanhoDaVariante(" m ")).toBe("M");
    expect(tamanhoDaVariante("egg")).toBe("EGG");
    expect(tamanhoDaVariante("42")).toBe("42");
    expect(tamanhoDaVariante("34/35")).toBe("34/35");
    expect(tamanhoDaVariante("20  m")).toBe("20 M");
  });

  it("vazio e o 'sem tamanho' do sistema antigo não viram item", () => {
    for (const t of [null, undefined, "", "   ", "x", "X", "u", "UN", "unico", "único", "ÚNICO", "-"]) {
      expect(tamanhoDaVariante(t)).toBeNull();
    }
  });
});

describe("nomeDaVariante", () => {
  it("é o nome do base + o tamanho", () => {
    expect(nomeDaVariante("jaqueta  azul", "M")).toBe("JAQUETA AZUL M");
  });
});

describe("separarTamanhoDoNome", () => {
  const bases = [
    { id: "1", nome: "JAQUETA" },
    { id: "2", nome: "CAMISA" },
    { id: "3", nome: "CAMISA POLO" },
  ];

  it("reconhece o tamanho de um material que já existe", () => {
    expect(separarTamanhoDoNome("jaqueta m", bases)).toEqual({ base: bases[0], tamanho: "M" });
  });

  it("base mais comprido ganha: CAMISA POLO G é o G de CAMISA POLO", () => {
    expect(separarTamanhoDoNome("CAMISA POLO G", bases)?.base.nome).toBe("CAMISA POLO");
  });

  it("tamanho é uma palavra só", () => {
    expect(separarTamanhoDoNome("CAMISA MANGA LONGA", bases)).toBeNull();
  });

  it("'sem tamanho' e nome sem base não são tamanho", () => {
    expect(separarTamanhoDoNome("JAQUETA X", bases)).toBeNull();
    expect(separarTamanhoDoNome("JAQUETA", bases)).toBeNull();
    expect(separarTamanhoDoNome("LUVA NITRILICA", bases)).toBeNull();
  });
});

describe("destinoDoTamanho", () => {
  const base = { nome: "JAQUETA", codigo: "0001001" };
  const existentes = [{ tamanho: "M", codigo: "0001780" }];

  it("tamanho que já tem item: mostra o código dele", () => {
    expect(destinoDoTamanho(base, "m", existentes))
      .toEqual({ nome: "JAQUETA M", codigo: "0001780", novo: false, semTamanho: false });
  });

  it("tamanho novo: o item nasce na entrada", () => {
    expect(destinoDoTamanho(base, "GG", existentes))
      .toEqual({ nome: "JAQUETA GG", codigo: null, novo: true, semTamanho: false });
  });

  it("sem tamanho: fica no próprio base, com o código dele", () => {
    expect(destinoDoTamanho(base, "x", existentes))
      .toEqual({ nome: "JAQUETA", codigo: "0001001", novo: false, semTamanho: true });
  });
});

describe("normalizarNomeMaterial", () => {
  it("tira espaço sobrando e põe em maiúsculas", () => {
    expect(normalizarNomeMaterial("  jaqueta   teste ")).toBe("JAQUETA TESTE");
  });
});
