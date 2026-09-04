import { describe, it, expect } from "vitest";
import { ordenarPor } from "@/lib/ordenarTabela";

// SIS-2026-0316: ordenação clicável de coluna (Meus Itens, Aprovação
// Malote, Pagamento Malote) — cobre a função pura de ordenação.

describe("ordenarPor", () => {
  it("ordena números ascendente e descendente", () => {
    const lista = [{ v: 30 }, { v: 10 }, { v: 20 }];
    expect(ordenarPor(lista, (x) => x.v, "asc").map((x) => x.v)).toEqual([10, 20, 30]);
    expect(ordenarPor(lista, (x) => x.v, "desc").map((x) => x.v)).toEqual([30, 20, 10]);
  });

  it("ordena texto respeitando acento/case (pt-BR) e número embutido (Nº 2 antes de Nº 10)", () => {
    const lista = [{ v: "Nº 10" }, { v: "Nº 2" }, { v: "água" }, { v: "Ávido" }];
    expect(ordenarPor(lista, (x) => x.v, "asc").map((x) => x.v)).toEqual(["água", "Ávido", "Nº 2", "Nº 10"]);
  });

  it("valor nulo/vazio sempre fica no fim, nas duas direções", () => {
    const lista = [{ v: "b" }, { v: null }, { v: "a" }, { v: "" }];
    expect(ordenarPor(lista, (x) => x.v, "asc").map((x) => x.v)).toEqual(["a", "b", null, ""]);
    expect(ordenarPor(lista, (x) => x.v, "desc").map((x) => x.v)).toEqual(["b", "a", null, ""]);
  });

  it("booleano vira 0/1 (ex. coluna Exceção)", () => {
    const lista = [{ v: true }, { v: false }, { v: true }];
    expect(ordenarPor(lista, (x) => x.v, "asc").map((x) => x.v)).toEqual([false, true, true]);
  });

  it("sem acessor devolve a lista original sem tocar (coluna sem ordenação ativa)", () => {
    const lista = [{ v: 3 }, { v: 1 }, { v: 2 }];
    expect(ordenarPor(lista, undefined, "asc")).toBe(lista);
  });

  it("não muta a lista original", () => {
    const lista = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const original = [...lista];
    ordenarPor(lista, (x) => x.v, "asc");
    expect(lista).toEqual(original);
  });
});
