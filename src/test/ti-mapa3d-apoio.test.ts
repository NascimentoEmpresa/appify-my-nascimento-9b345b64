import { describe, expect, it } from "vitest";
import {
  M,
  alturaDeApoio,
  alturaDoAndar,
  arestasDoContorno,
  bordaParaRemover,
  celulasDoRetangulo,
  contornoParaExpandir,
  limitesDasCelulas,
  alturaDoElemento,
  camaraInicial,
  cantoDaPeca,
  centroDaPeca,
  dentro,
  pegadaDoElemento,
  pontasDaParede,
  rad,
  redimensionarPorCanto,
  retanguloDeCantos,
  retanguloDoTraco,
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

  it("aceita um passo próprio, menor que o quadrado do piso", () => {
    // O piso cresce de metro em metro, mas encostar um monitor na quina da
    // mesa pede centímetros: são duas grandezas diferentes, e o passo do
    // movimento é escolhido na barra do editor.
    expect(snap(137, false, 25)).toBe(125);
    expect(snap(137, false, 10)).toBe(140);
    expect(snap(137, false, 5)).toBe(135);
  });

  it("gruda no quadrado de 1 m, e solta quando pedido", () => {
    // O passo é o quadrado que se vê no piso: quem monta escritório pensa em
    // "essa sala tem 6 por 4", não em múltiplos de 25 cm.
    expect(snap(137)).toBe(100);
    expect(snap(151)).toBe(200);
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

describe("retanguloDoTraco — desenhar parede arrastando", () => {
  it("uma parede horizontal tem o comprimento do traço e giro zero", () => {
    const r = retanguloDoTraco(100, 200, 500, 200, 15);
    expect(r.largura).toBe(400);
    expect(r.profundidade).toBe(15);
    expect(r.rotacao).toBe(0);
    // O banco guarda o canto; a cena posiciona pelo centro.
    expect(r.centroX).toBe(300);
    expect(r.x).toBe(100);
    // Duas casas: com espessura ímpar o canto cai em .5, e arredondar fazia a
    // parede derivar meio centímetro por arrasto.
    expect(r.y).toBe(192.5);
  });

  it("uma parede vertical sai com 90°", () => {
    const r = retanguloDoTraco(100, 100, 100, 400, 15);
    expect(r.largura).toBe(300);
    expect(r.rotacao).toBe(90);
  });

  it("mede a diagonal pela distância, não pela soma dos lados", () => {
    const r = retanguloDoTraco(0, 0, 300, 400, 15);
    expect(r.largura).toBe(500);
    expect(r.rotacao).toBeCloseTo(53.1, 0);
  });

  it("aceita o traço desenhado de trás para frente", () => {
    const ida = retanguloDoTraco(100, 200, 500, 200, 15);
    const volta = retanguloDoTraco(500, 200, 100, 200, 15);
    expect(volta.largura).toBe(ida.largura);
    expect(volta.centroX).toBe(ida.centroX);
    // 180° desenha a mesma parede — o retângulo é simétrico.
    expect(Math.abs(volta.rotacao)).toBe(180);
  });
});

describe("retanguloDeCantos — ambientes e móveis dimensionados", () => {
  it("normaliza os cantos, arrastando em qualquer direção", () => {
    const a = retanguloDeCantos(500, 400, 100, 100);
    expect(a).toEqual({ x: 100, y: 100, largura: 400, profundidade: 300 });
    expect(retanguloDeCantos(100, 100, 500, 400)).toEqual(a);
  });
});

describe("andares empilhados", () => {
  const plantas = [
    { nivel: 0, pe_direito_cm: 300 },
    { nivel: 1, pe_direito_cm: 280 },
    { nivel: 2, pe_direito_cm: 280 },
  ];

  it("térreo fica no chão", () => {
    expect(alturaDoAndar(plantas, 0)).toBe(0);
  });

  it("cada andar sobe a altura dos que estão abaixo", () => {
    expect(alturaDoAndar(plantas, 1)).toBe(300);
    expect(alturaDoAndar(plantas, 2)).toBe(580);
  });

  it("andar sem planta cadastrada não faz o de cima afundar", () => {
    // Alguém cadastrou térreo e 2º, pulando o 1º: sem o padrão, o 2º pousaria
    // dentro do térreo.
    expect(alturaDoAndar([{ nivel: 0, pe_direito_cm: 300 }], 2, 300)).toBe(600);
  });

  it("subsolo desce", () => {
    expect(alturaDoAndar([{ nivel: -1, pe_direito_cm: 250 }], -1)).toBe(-250);
  });
});

describe("pontasDaParede — é o inverso de retanguloDoTraco", () => {
  it("devolve as pontas do traço que criou a parede", () => {
    const r = retanguloDoTraco(100, 200, 500, 200, 15);
    const { a, b } = pontasDaParede({ ...r, altura: r.profundidade });
    expect(a.x).toBeCloseTo(100, 0);
    expect(b.x).toBeCloseTo(500, 0);
    expect(a.y).toBeCloseTo(200, 0);
  });

  it("fecha o ciclo em parede na diagonal", () => {
    // Puxar a ponta e soltar não pode deslocar a parede: se as duas funções
    // discordarem, cada arrasto move a peça um pouco.
    const r = retanguloDoTraco(0, 0, 300, 400, 20);
    const { a, b } = pontasDaParede({ ...r, altura: r.profundidade });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(500, 0);
  });
});

describe("redimensionarPorCanto — esticar sala pela quina", () => {
  const sala = { x: 100, y: 100, largura: 400, altura: 300 };

  it("puxando a quina sudeste, o canto noroeste fica parado", () => {
    const r = redimensionarPorCanto(sala, "se", 700, 600);
    expect(r).toEqual({ x: 100, y: 100, largura: 600, altura: 500 });
  });

  it("puxando a noroeste, o canto sudeste fica parado", () => {
    const r = redimensionarPorCanto(sala, "nw", 50, 50);
    expect(r).toEqual({ x: 50, y: 50, largura: 450, altura: 350 });
  });

  it("não deixa a peça inverter nem sumir ao atravessar o canto oposto", () => {
    const r = redimensionarPorCanto(sala, "se", 0, 0);
    expect(r.largura).toBe(25);
    expect(r.altura).toBe(25);
  });
});

describe("piso por células — o retângulo que vira L", () => {
  it("planta antiga (sem célula) equivale ao retângulo inteiro", () => {
    // 2×2 m = quatro quadrados. É o que a cena desenha para toda planta que
    // ainda não foi editada célula a célula.
    expect(celulasDoRetangulo(200, 200)).toHaveLength(4);
    expect(celulasDoRetangulo(200, 200)).toContainEqual({ cx: 1, cy: 1 });
  });

  it("arredonda para cima: 2,5 m ocupam três quadrados", () => {
    expect(celulasDoRetangulo(250, 100)).toHaveLength(3);
  });

  it("oferece '+' em todo quadrado vazio encostado no piso", () => {
    // Um quadrado só: quatro vizinhos ortogonais, e nenhuma diagonal.
    const fora = contornoParaExpandir([{ cx: 0, cy: 0 }]);
    expect(fora).toHaveLength(4);
    expect(fora).toContainEqual({ cx: -1, cy: 0 });
    expect(fora).toContainEqual({ cx: 0, cy: -1 });
    expect(fora).not.toContainEqual({ cx: 1, cy: 1 });
  });

  it("não repete o '+' quando dois quadrados dividem o mesmo vizinho", () => {
    const fora = contornoParaExpandir([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    const chaves = fora.map((c) => `${c.cx},${c.cy}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("é isto que transforma 2 quadrados retos num L", () => {
    // Dois quadrados lado a lado; clicar no "+" de baixo do da direita
    // acrescenta SÓ aquele metro quadrado.
    const antes = [
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ];
    expect(contornoParaExpandir(antes)).toContainEqual({ cx: 1, cy: 1 });
    const depois = [...antes, { cx: 1, cy: 1 }];
    expect(depois).toHaveLength(3);
    // O da esquerda não cresceu junto: o piso agora é um L.
    expect(depois).not.toContainEqual({ cx: 0, cy: 1 });
  });

  it("só oferece '−' em quadrado de borda, nunca no meio do piso", () => {
    // Cruz: o centro está cercado pelos quatro lados.
    const cruz = [
      { cx: 1, cy: 1 },
      { cx: 0, cy: 1 },
      { cx: 2, cy: 1 },
      { cx: 1, cy: 0 },
      { cx: 1, cy: 2 },
    ];
    const borda = bordaParaRemover(cruz);
    expect(borda).not.toContainEqual({ cx: 1, cy: 1 });
    expect(borda).toHaveLength(4);
  });

  it("a moldura acompanha o quadrado mais distante", () => {
    expect(limitesDasCelulas([{ cx: 0, cy: 0 }, { cx: 3, cy: 1 }])).toEqual({
      larguraCm: 400,
      alturaCm: 200,
    });
  });
});

describe("arestasDoContorno — a parede segue o formato do piso", () => {
  it("um quadrado sozinho tem quatro paredes", () => {
    expect(arestasDoContorno([{ cx: 0, cy: 0 }])).toHaveLength(4);
  });

  it("dois quadrados lado a lado dão quatro paredes, não oito", () => {
    // A parede entre eles não existe (é piso dos dois lados), e as duas
    // horizontais viram um trecho de 2 m cada — não quatro de 1 m.
    const a = arestasDoContorno([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    expect(a).toHaveLength(4);
    const superior = a.find((x) => x.y1 === 0 && x.y2 === 0);
    expect(superior).toEqual({ x1: 0, y1: 0, x2: 2, y2: 0 });
  });

  it("um piso em L tem seis trechos de parede", () => {
    // Este é o caso que a parede retangular anterior desenhava errado: ela
    // cortava o vazio e deixava o recorte do L aberto.
    const emL = [
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 1, cy: 1 },
    ];
    expect(arestasDoContorno(emL)).toHaveLength(6);
  });

  it("não desenha parede entre dois quadrados vizinhos", () => {
    const a = arestasDoContorno([
      { cx: 0, cy: 0 },
      { cx: 0, cy: 1 },
    ]);
    // A aresta horizontal em y=1 seria a divisa interna: não pode existir.
    expect(a.some((x) => x.y1 === 1 && x.y2 === 1)).toBe(false);
  });

  it("mescla um corredor longo num trecho só por lado", () => {
    const corredor = [0, 1, 2, 3, 4].map((cx) => ({ cx, cy: 0 }));
    const a = arestasDoContorno(corredor);
    // Duas paredes de 5 m (norte e sul) e duas de 1 m (as pontas).
    expect(a).toHaveLength(4);
    expect(a.filter((x) => x.x2 - x.x1 === 5)).toHaveLength(2);
  });

  it("um buraco no meio do piso vira parede interna", () => {
    // Anel 3×3 com o centro vazio: 4 paredes externas + 4 do buraco.
    const anel = [];
    for (let cx = 0; cx < 3; cx++)
      for (let cy = 0; cy < 3; cy++) if (!(cx === 1 && cy === 1)) anel.push({ cx, cy });
    expect(arestasDoContorno(anel)).toHaveLength(8);
  });
});

describe("centro × canto — a conversão que já quebrou o arrasto duas vezes", () => {
  const mesa = { x: 100, y: 200, largura: 140, altura: 70 };

  it("o centro fica a meia peça do canto", () => {
    expect(centroDaPeca(mesa)).toEqual({ x: 170, y: 235 });
  });

  it("voltar do centro devolve o canto original", () => {
    const c = centroDaPeca(mesa);
    expect(cantoDaPeca(c.x, c.y, mesa.largura, mesa.altura)).toEqual({ x: 100, y: 200 });
  });

  it("aceita numeric vindo como string do PostgREST", () => {
    // As colunas são numeric, e o PostgREST devolve "100.00" — sem o Number()
    // a soma vira concatenação e a peça vai parar no infinito.
    expect(centroDaPeca({ x: "100", y: "200", largura: "140", altura: "70" })).toEqual({
      x: 170,
      y: 235,
    });
  });
});
