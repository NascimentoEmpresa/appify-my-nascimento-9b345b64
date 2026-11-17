import { describe, expect, it } from "vitest";
import {
  hrefNaLista, lerLista, MAX_LISTA, ordemFilaResponsavel, posicaoNaLista, type ItemFila,
} from "@/lib/chamados/navegacaoLista";

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

describe("Chamado — setas sem lista de origem: fila do responsável", () => {
  const ativo = (s: string) => !["concluido", "reprovado", "cancelado"].includes(s);
  const D = id(4), E = id(5);
  const item = (i: string, o: Partial<ItemFila> = {}): ItemFila =>
    ({ id: i, status: "em_andamento", responsavel_id: "dev1", posicao_dev: null, created_at: "2026-11-01T10:00:00Z", ...o });

  it("só ativos do mesmo responsável, pela posição na fila dele; sem posição → mais antigo antes", () => {
    const itens = [
      item(A, { posicao_dev: 2 }),
      item(B, { posicao_dev: 1 }),
      item(C, { created_at: "2026-10-01T10:00:00Z" }), // sem posição, mais antigo
      item(D),                                          // sem posição, mais novo
      item(E, { posicao_dev: 3, status: "concluido" }),  // encerrado: fora
      item(id(6), { posicao_dev: 1, responsavel_id: "dev2" }), // outro dev: fora
    ];
    expect(ordemFilaResponsavel(itens, "dev1", ativo)).toEqual([B, A, C, D]);
  });

  it("sem responsável, não há fila; com fila, anterior/próximo saem dela", () => {
    expect(ordemFilaResponsavel([item(A)], null, ativo)).toEqual([]);
    const ordem = ordemFilaResponsavel([item(A, { posicao_dev: 1 }), item(B, { posicao_dev: 2 })], "dev1", ativo);
    expect(posicaoNaLista(ordem, B)).toEqual({ indice: 1, total: 2, anterior: A, proximo: null });
  });
});
