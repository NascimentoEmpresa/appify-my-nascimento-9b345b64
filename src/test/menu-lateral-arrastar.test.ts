import { describe, expect, it } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { criarColisaoMenu, destinoDoArrasto } from "@/lib/menuLateral/arrastar";
import type { EstruturaMenu } from "@/lib/menuLateral/estrutura";

const estrutura: EstruturaMenu = {
  rotasConhecidas: [],
  modulos: [
    { id: "origem", rotulo: "Origem", origem: null, categorias: [
      { id: "inicial", rotulo: "Inicial", itens: [{ id: "a", rota: "/app/a" }] },
    ] },
    { id: "destino", rotulo: "Destino", origem: null, categorias: [
      { id: "principal", rotulo: "Principal", itens: [{ id: "b", rota: "/app/b" }] },
      { id: "vazia", rotulo: "Vazia", itens: [] },
    ] },
    { id: "sem-categoria", rotulo: "Sem categoria", origem: null, categorias: [] },
  ],
};

type ParametrosColisao = Parameters<CollisionDetection>[0];
const retangulo = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});
const areas = [
  { id: "mod:origem", retangulo: retangulo(0, 0, 200, 300) },
  { id: "cat:inicial", retangulo: retangulo(10, 50, 180, 100) },
  { id: "item:a", retangulo: retangulo(20, 80, 160, 30) },
  { id: "mod:destino", retangulo: retangulo(220, 0, 200, 300) },
  { id: "cat:principal", retangulo: retangulo(230, 50, 180, 100) },
  { id: "item:b", retangulo: retangulo(240, 80, 160, 30) },
  { id: "cat:vazia", retangulo: retangulo(230, 170, 180, 50) },
  { id: "mod:sem-categoria", retangulo: retangulo(440, 0, 200, 300) },
];

function detectar(cursor: { x: number; y: number } | null, ativo = "item:a") {
  const args: ParametrosColisao = {
    active: { id: ativo, data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    collisionRect: retangulo(240, 80, 160, 30),
    pointerCoordinates: cursor,
    droppableRects: new Map(areas.map((area) => [area.id, area.retangulo])),
    droppableContainers: areas.map((area) => ({
      id: area.id, key: area.id, disabled: false,
      data: { current: {} }, node: { current: null }, rect: { current: area.retangulo },
    })),
  };
  return criarColisaoMenu(estrutura)(args).map((colisao) => colisao.id);
}

describe("destino do submódulo arrastado", () => {
  it("usa a categoria e a posição da linha sob o cursor", () => {
    const destino = destinoDoArrasto(estrutura, "item:b")!;
    expect(destino.modulo.id).toBe("destino");
    expect(destino.categoria.id).toBe("principal");
    expect(destino.indice).toBe(0);
  });

  it("soltar no cabeçalho ou espaço livre acrescenta na primeira categoria", () => {
    const destino = destinoDoArrasto(estrutura, "mod:destino")!;
    expect(destino.categoria.id).toBe("principal");
    expect(destino.indice).toBe(1);
  });

  it("aceita uma categoria vazia como destino", () => {
    const destino = destinoDoArrasto(estrutura, "cat:vazia")!;
    expect(destino.categoria.id).toBe("vazia");
    expect(destino.indice).toBe(0);
  });

  it("recusa módulo sem categoria e destinos inexistentes", () => {
    expect(destinoDoArrasto(estrutura, "mod:sem-categoria")).toBeNull();
    expect(destinoDoArrasto(estrutura, "item:inexistente")).toBeNull();
  });
});

describe("área de soltura do menu", () => {
  it("prioriza a linha sobre a categoria e o módulo que a contêm", () => {
    expect(detectar({ x: 260, y: 90 })).toEqual(["item:b"]);
  });

  it("identifica a categoria vazia sem selecionar a categoria vizinha", () => {
    expect(detectar({ x: 260, y: 190 })).toEqual(["cat:vazia"]);
  });

  it("aceita o cabeçalho e o espaço livre do cartão", () => {
    expect(detectar({ x: 260, y: 20 })).toEqual(["mod:destino"]);
    expect(detectar({ x: 260, y: 270 })).toEqual(["mod:destino"]);
  });

  it("soltar fora dos cartões ou no intervalo entre eles não escolhe um vizinho", () => {
    expect(detectar({ x: 700, y: 90 })).toEqual([]);
    expect(detectar({ x: 210, y: 90 })).toEqual([]);
  });

  it("não sinaliza módulo sem categoria como destino de submódulo", () => {
    expect(detectar({ x: 460, y: 90 })).toEqual([]);
  });

  it("arrastar um módulo só seleciona outros módulos", () => {
    expect(detectar({ x: 260, y: 90 }, "mod:origem")).toEqual(["mod:destino"]);
    expect(detectar({ x: 460, y: 90 }, "mod:origem")).toEqual(["mod:sem-categoria"]);
  });

  it("mantém destinos por proximidade para navegação pelo teclado", () => {
    expect(detectar(null)[0]).toBe("item:b");
  });
});
