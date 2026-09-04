import { describe, expect, it } from "vitest";
import {
  M,
  alturaDeApoio,
  alturaDoElemento,
  camaraInicial,
  dentro,
  pegadaDoElemento,
  rad,
  snap,
} from "@/pages/ti/mapa3d/apoio";
import type { TiAtivo, TiElemento } from "@/hooks/useTiMapa";

/**
 * A matemática do mapa 3D — o que decide se o computador aparece EM CIMA da
 * mesa ou atravessando o tampo dela. É a parte que não dá para conferir no
 * type-check e que ninguém percebe errada até olhar a cena de perto.
 */

const elemento = (p: Partial<TiElemento>): TiElemento => ({
  id: p.id ?? "e1",
  planta_id: "p1",
  tipo: p.tipo ?? "mesa",
  rotulo: null,
  x: p.x ?? 0,
  y: p.y ?? 0,
  largura: p.largura ?? 140,
  altura: p.altura ?? 70,
  rotacao: p.rotacao ?? 0,
  altura_z: p.altura_z ?? null,
  cor: null,
  z_index: 0,
  meta: {},
});

const ativo = (p: Partial<TiAtivo>): TiAtivo =>
  ({
    id: "a1",
    tipo: p.tipo ?? "monitor",
    nome: "PC-01",
    status: "em_uso",
    escala: p.escala ?? 1,
    rotacao: 0,
    pos_x: p.pos_x ?? 0,
    pos_y: p.pos_y ?? 0,
    pos_z: p.pos_z ?? null,
    planta_id: "p1",
  }) as TiAtivo;

describe("conversão e grid", () => {
  it("converte centímetros do banco em metros da cena", () => {
    expect(M(100)).toBe(1);
    expect(M(2400)).toBe(24);
    expect(M(45)).toBeCloseTo(0.45);
  });

  it("gruda no grid de 25 cm, e solta quando pedido", () => {
    expect(snap(137)).toBe(125);
    expect(snap(138)).toBe(150);
    expect(snap(137, true)).toBe(137);
  });

  it("gira ao contrário da planta: o eixo Y da cena é espelhado", () => {
    // Sem o sinal negativo, uma mesa girada 90° na tela aparece girada -90°
    // na cena, e o que estava encostado na parede vira para o corredor.
    expect(rad(90)).toBeCloseTo(-Math.PI / 2);
    expect(rad(0)).toBe(-0);
  });
});

describe("pegada do elemento", () => {
  it("troca largura e profundidade quando o móvel está girado 90°", () => {
    const p = pegadaDoElemento(elemento({ largura: 140, altura: 70, rotacao: 90 }));
    expect(p.largura).toBe(70);
    expect(p.profundidade).toBe(140);
  });

  it("mantém as medidas em 0° e em 180°", () => {
    for (const r of [0, 180, 360]) {
      const p = pegadaDoElemento(elemento({ largura: 140, altura: 70, rotacao: r }));
      expect(p.largura).toBe(140);
    }
  });

  it("aceita giro negativo sem inverter a conta", () => {
    // -90 e 270 são o mesmo ângulo; o resto de número negativo em JS não é.
    expect(pegadaDoElemento(elemento({ largura: 140, altura: 70, rotacao: -90 })).largura).toBe(70);
  });

  it("reconhece o ponto dentro e fora, com a borda contando como dentro", () => {
    const c = { x: 100, y: 100, largura: 140, profundidade: 70 };
    expect(dentro(150, 120, c)).toBe(true);
    expect(dentro(100, 100, c)).toBe(true);
    expect(dentro(241, 120, c)).toBe(false);
  });
});

describe("altura do elemento", () => {
  it("usa a altura gravada quando existe", () => {
    expect(alturaDoElemento(elemento({ tipo: "mesa", altura_z: 90 }))).toBe(90);
  });

  it("cai no catálogo quando o banco não tem altura", () => {
    expect(alturaDoElemento(elemento({ tipo: "mesa", altura_z: null }))).toBe(75);
    expect(alturaDoElemento(elemento({ tipo: "parede", altura_z: null }))).toBe(280);
  });
});

describe("alturaDeApoio — o computador em cima da mesa", () => {
  const mesa = elemento({ id: "mesa", tipo: "mesa", x: 100, y: 100, largura: 140, altura: 70 });

  it("pousa no chão quando não há móvel embaixo", () => {
    expect(alturaDeApoio(ativo({ pos_x: 900, pos_y: 900 }), [mesa])).toBe(0);
  });

  it("sobe para o tampo quando o equipamento está sobre a mesa", () => {
    expect(alturaDeApoio(ativo({ pos_x: 170, pos_y: 130 }), [mesa])).toBe(75);
  });

  it("ignora parede e piso: eles não sustentam equipamento", () => {
    const parede = elemento({ id: "w", tipo: "parede", x: 0, y: 0, largura: 500, altura: 15 });
    const sala = elemento({ id: "s", tipo: "sala", x: 0, y: 0, largura: 800, altura: 800 });
    expect(alturaDeApoio(ativo({ pos_x: 100, pos_y: 5 }), [parede, sala])).toBe(0);
  });

  it("escolhe o apoio MAIS ALTO quando há mais de um sob o ponto", () => {
    // Mesa dentro de uma sala é o caso normal; pegar o primeiro da lista
    // poria o computador no piso da sala em vez de sobre a mesa.
    const armario = elemento({ id: "arm", tipo: "armario", x: 100, y: 100, largura: 140, altura: 70, altura_z: 180 });
    expect(alturaDeApoio(ativo({ pos_x: 170, pos_y: 130 }), [mesa, armario])).toBe(180);
  });

  it("respeita o pos_z digitado, mesmo com mesa embaixo", () => {
    // É o ajuste fino do editor — monitor preso na parede, por exemplo.
    expect(alturaDeApoio(ativo({ pos_x: 170, pos_y: 130, pos_z: 140 }), [mesa])).toBe(140);
  });

  it("aceita pos_z zero como 'no chão', e não como 'não informado'", () => {
    expect(alturaDeApoio(ativo({ pos_x: 170, pos_y: 130, pos_z: 0 }), [mesa])).toBe(0);
  });

  it("acompanha a mesa girada: o tampo roda junto", () => {
    // Mesa de 140×70 girada 90° cobre 70 de largura e 140 de profundidade.
    const girada = elemento({ id: "m2", tipo: "mesa", x: 100, y: 100, largura: 140, altura: 70, rotacao: 90 });
    expect(alturaDeApoio(ativo({ pos_x: 150, pos_y: 220 }), [girada])).toBe(75);
    expect(alturaDeApoio(ativo({ pos_x: 220, pos_y: 120 }), [girada])).toBe(0);
  });
});

describe("câmera inicial", () => {
  it("afasta mais em planta grande do que em planta pequena", () => {
    const perto = camaraInicial(800, 600);
    const longe = camaraInicial(4000, 3000);
    expect(longe[1]).toBeGreaterThan(perto[1]);
  });

  it("olha de cima e de fora — nunca de dentro do piso", () => {
    const [, y] = camaraInicial(2400, 1600);
    expect(y).toBeGreaterThan(0);
  });
});
