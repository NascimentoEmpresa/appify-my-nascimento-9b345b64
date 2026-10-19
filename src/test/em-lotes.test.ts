import { describe, expect, it } from "vitest";
import { emLotes, fatiar } from "@/lib/emLotes";

describe("fatiar", () => {
  it("divide em lotes do tamanho pedido, o último com a sobra", () => {
    expect(fatiar([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(fatiar([], 40)).toEqual([]);
  });
});

describe("emLotes", () => {
  it("consulta um lote por vez e junta as linhas", async () => {
    const vistos: string[][] = [];
    const linhas = await emLotes(["a", "b", "c"], 2, async (lote) => {
      vistos.push(lote);
      return { data: lote.map((id) => ({ id })), error: null };
    });
    expect(vistos).toEqual([["a", "b"], ["c"]]);
    expect(linhas).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("lista vazia não consulta", async () => {
    let chamadas = 0;
    expect(await emLotes([], 40, async () => { chamadas++; return { data: [], error: null }; })).toEqual([]);
    expect(chamadas).toBe(0);
  });

  // Fila de Pedidos de Materiais: ~70 lotes não podem sair todos de uma vez.
  it("respeita o limite de lotes simultâneos e mantém a ordem dos lotes", async () => {
    let abertos = 0;
    let pico = 0;
    const ids = Array.from({ length: 10 }, (_, i) => String(i));
    const linhas = await emLotes(ids, 1, async (lote) => {
      abertos++;
      pico = Math.max(pico, abertos);
      await new Promise((ok) => setTimeout(ok, 10 - Number(lote[0])));
      abertos--;
      return { data: lote, error: null };
    }, 3);
    expect(pico).toBe(3);
    expect(linhas).toEqual(ids);
  });

  // Lista pela metade parece completa — melhor a tela mostrar o erro.
  it("erro em qualquer lote derruba a consulta inteira", async () => {
    await expect(emLotes(["a", "b"], 1, async (lote) =>
      lote[0] === "b" ? { data: null, error: new Error("502") } : { data: [{ id: "a" }], error: null },
    )).rejects.toThrow("502");
  });
});
