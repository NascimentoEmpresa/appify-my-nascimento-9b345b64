import { describe, expect, it, vi } from "vitest";
import { copiarItens, moverItens, rotasDaEstrutura, type EstruturaMenu } from "@/lib/menuLateral/estrutura";

const item = (id: string) => ({ id, rota: `/app/${id}`, rotulo: id, ref: `original:${id}` });
const estrutura: EstruturaMenu = {
  rotasConhecidas: ["a", "b", "c", "d", "e", "f"].map((id) => `/app/${id}`),
  modulos: [
    { id: "m1", rotulo: "Origem", origem: null, categorias: [{ id: "c1", rotulo: "Inicial", itens: ["a", "b", "c", "d"].map(item) }] },
    { id: "m2", rotulo: "Destino", origem: null, categorias: [{ id: "c2", rotulo: "Final", itens: [item("e")] }] },
    { id: "m3", rotulo: "Outro", origem: null, categorias: [{ id: "c3", rotulo: "Outro", itens: [item("f")] }] },
  ],
};
const ids = (e: EstruturaMenu, categoria: number) => e.modulos[categoria].categorias[0].itens.map((it) => it.id);

describe("operações de vários submódulos", () => {
  it("move todos de uma vez na ordem do menu, sem alterar os endereços", () => {
    const nova = moverItens(estrutura, ["b", "a"], "c2", 0);
    expect(ids(nova, 0)).toEqual(["c", "d"]);
    expect(ids(nova, 1)).toEqual(["a", "b", "e"]);
    expect(rotasDaEstrutura(nova).sort()).toEqual(rotasDaEstrutura(estrutura).sort());
    expect(ids(estrutura, 0)).toEqual(["a", "b", "c", "d"]);
    nova.modulos[1].categorias[0].itens[0].rotulo = "Novo nome";
    expect(estrutura.modulos[0].categorias[0].itens[0].rotulo).toBe("a");
  });

  it("aceita um lote com origens em módulos diferentes", () => {
    const nova = moverItens(estrutura, ["f", "b"], "c2", 1);
    expect(ids(nova, 0)).toEqual(["a", "c", "d"]);
    expect(ids(nova, 1)).toEqual(["e", "b", "f"]);
    expect(ids(nova, 2)).toEqual([]);
  });

  it("ajusta o índice ao retirar entradas da própria categoria de destino", () => {
    expect(ids(moverItens(estrutura, ["b", "d"], "c1", 2), 0)).toEqual(["a", "b", "d", "c"]);
    expect(ids(moverItens(estrutura, ["b", "c"], "c1"), 0)).toEqual(["a", "d", "b", "c"]);
    expect(ids(moverItens(estrutura, ["b", "e"], "c2", 1), 1)).toEqual(["b", "e"]);
  });

  it("não registra mudança quando o lote já ocupa a posição solicitada", () => {
    expect(moverItens(estrutura, ["b", "c"], "c1", 3)).toBe(estrutura);
  });

  it("uma seleção repetida não move a mesma entrada duas vezes", () => {
    expect(ids(moverItens(estrutura, ["a", "a", "b"], "c2"), 1)).toEqual(["e", "a", "b"]);
  });

  it("recusa o lote inteiro se uma origem ou o destino não existir", () => {
    const gerarId = vi.fn(() => "novo");
    expect(moverItens(estrutura, ["a", "inexistente"], "c2")).toBe(estrutura);
    expect(copiarItens(estrutura, ["a", "inexistente"], "c2", gerarId)).toBe(estrutura);
    expect(moverItens(estrutura, ["a", "b"], "inexistente")).toBe(estrutura);
    expect(copiarItens(estrutura, ["a", "b"], "inexistente", gerarId)).toBe(estrutura);
    expect(moverItens(estrutura, [], "c2")).toBe(estrutura);
    expect(copiarItens(estrutura, [], "c2", gerarId)).toBe(estrutura);
    expect(gerarId).not.toHaveBeenCalled();
  });

  it("copia o lote em ordem com ids novos e mantém todas as origens", () => {
    let numero = 0;
    const nova = copiarItens(estrutura, ["b", "a"], "c2", () => `cp:${++numero}`, 0);
    expect(ids(nova, 0)).toEqual(ids(estrutura, 0));
    const copias = nova.modulos[1].categorias[0].itens;
    expect(copias.map((it) => it.id)).toEqual(["cp:1", "cp:2", "e"]);
    expect(copias[0]).toMatchObject({ rota: "/app/a", ref: "original:a", copiaDe: "a", rotulo: "a" });
    expect(copias[1]).toMatchObject({ rota: "/app/b", ref: "original:b", copiaDe: "b", rotulo: "b" });
    expect(ids(estrutura, 1)).toEqual(["e"]);
  });

  it("copiar uma cópia preserva a referência à entrada original", () => {
    const anterior = copiarItens(estrutura, ["a", "b"], "c2", (() => { let i = 0; return () => `cp:${++i}`; })());
    const nova = copiarItens(anterior, ["cp:1", "cp:2"], "c3", (() => { let i = 0; return () => `cp2:${++i}`; })());
    expect(nova.modulos[2].categorias[0].itens.slice(1).map((it) => it.copiaDe)).toEqual(["a", "b"]);
  });
});
