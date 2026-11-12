import { describe, expect, it } from "vitest";
import { hrefNaLista, lerLista, MAX_LISTA, posicaoNaLista } from "@/lib/chamados/navegacaoLista";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = id(1), B = id(2), C = id(3);

describe("Chamado — setas anterior/próximo pela lista de origem", () => {
  it("lê só ids válidos, sem repetir, na ordem", () => {
    expect(lerLista(`${A},lixo,${B},${A}, ${C} `)).toEqual([A, B, C]);
    expect(lerLista(null)).toEqual([]);
    expect(lerLista(Array.from({ length: 300 }, (_, i) => id(i + 1)).join(","))).toHaveLength(MAX_LISTA);
  });

  it("posição, anterior e próximo; nas pontas não há para onde ir", () => {
    expect(posicaoNaLista([A, B, C], B)).toEqual({ indice: 1, total: 3, anterior: A, proximo: C });
    expect(posicaoNaLista([A, B, C], A)).toMatchObject({ anterior: null, proximo: B });
    expect(posicaoNaLista([A, B, C], C)).toMatchObject({ anterior: B, proximo: null });
  });

  it("sem setas quando o chamado não está na lista ou a lista tem um só", () => {
    expect(posicaoNaLista([A, B], C)).toBeNull();
    expect(posicaoNaLista([A], A)).toBeNull();
    expect(posicaoNaLista([], undefined)).toBeNull();
  });

  it("o link leva a lista junto (e não leva quando há um só)", () => {
    expect(hrefNaLista(B, [A, B])).toBe(`/app/sistemas/chamados/${B}?lista=${A},${B}`);
    expect(hrefNaLista(A, [A])).toBe(`/app/sistemas/chamados/${A}`);
  });
});
