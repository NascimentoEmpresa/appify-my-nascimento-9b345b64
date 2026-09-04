import type { TiAtivo, TiElemento } from "@/hooks/useTiMapa";
import { GRID_CM, tipoAtivo, tipoElemento } from "../mapa/catalogo";

/**
 * A matemática da cena 3D — tudo que dá para decidir sem WebGL.
 *
 * Fica fora dos componentes porque é aqui que mora a regra que faz o mapa
 * parecer um escritório e não um monte de caixas no chão: um monitor
 * apoiado numa mesa tem que ficar EM CIMA da mesa, e ninguém quer digitar a
 * altura de cada equipamento na mão.
 *
 * Unidades: o banco fala CENTÍMETROS, a cena three.js fala METROS. A
 * conversão acontece só aqui e nos modelos — nunca no meio de um cálculo.
 */

/** cm → metros (a unidade da cena). */
export const M = (cm: number): number => cm / 100;

/** Gruda no grid de 25 cm. `livre` desliga (é o Alt do editor). */
export function snap(valor: number, livre = false, grid = GRID_CM): number {
  return livre ? Math.round(valor) : Math.round(valor / grid) * grid;
}

/** Um retângulo no chão, em cm, já com o giro considerado grosseiramente. */
export interface Caixa {
  x: number;
  y: number;
  largura: number;
  profundidade: number;
}

/**
 * A pegada de um elemento no piso.
 *
 * Rotação de 90°/270° troca largura e profundidade — sem isso, uma mesa
 * girada continuaria "ocupando" o retângulo antigo e o monitor pousaria no
 * ar ao lado dela. Ângulos quebrados (45°) usam o retângulo não girado: é
 * aproximação consciente, porque o custo de um teste de polígono rotacionado
 * não se paga para decidir a altura de um apoio.
 */
export function pegadaDoElemento(el: TiElemento): Caixa {
  const giro = ((Math.round(Number(el.rotacao) / 90) * 90) % 360 + 360) % 360;
  const trocado = giro === 90 || giro === 270;
  return {
    x: Number(el.x),
    y: Number(el.y),
    largura: trocado ? Number(el.altura) : Number(el.largura),
    profundidade: trocado ? Number(el.largura) : Number(el.altura),
  };
}

/** O ponto (cx, cy) está dentro do retângulo? Borda conta como dentro. */
export function dentro(cx: number, cy: number, c: Caixa): boolean {
  return cx >= c.x && cx <= c.x + c.largura && cy >= c.y && cy <= c.y + c.profundidade;
}

/** Altura vertical de um elemento, em cm (a do banco, ou a do catálogo). */
export function alturaDoElemento(el: TiElemento): number {
  const propria = el.altura_z == null ? null : Number(el.altura_z);
  return propria != null && Number.isFinite(propria) ? propria : tipoElemento(el.tipo).alturaZ;
}

/** Móveis que servem de bancada. Parede e piso não sustentam equipamento. */
const APOIOS = new Set(["mesa", "armario", "rack", "sofa", "escada"]);

/**
 * Em que altura (cm) este equipamento se apoia.
 *
 * Ordem: um `pos_z` gravado sempre vence (é o ajuste fino do editor); sem
 * ele, procura o móvel de apoio MAIS ALTO cujo tampo esteja sob o centro do
 * equipamento; sem nenhum, o chão.
 *
 * O "mais alto" importa: mesa dentro de uma área de sala é o caso normal, e
 * pegar o primeiro da lista poria o computador no piso da sala em vez de
 * sobre a mesa.
 */
export function alturaDeApoio(ativo: TiAtivo, elementos: TiElemento[]): number {
  const fixado = ativo.pos_z == null ? null : Number(ativo.pos_z);
  if (fixado != null && Number.isFinite(fixado)) return fixado;

  const cx = Number(ativo.pos_x ?? 0);
  const cy = Number(ativo.pos_y ?? 0);

  let melhor = 0;
  for (const el of elementos) {
    if (!APOIOS.has(el.tipo)) continue;
    if (!dentro(cx, cy, pegadaDoElemento(el))) continue;
    const topo = alturaDoElemento(el);
    if (topo > melhor) melhor = topo;
  }
  return melhor;
}

/** Dimensões 3D de um equipamento em METROS, já com a escala da linha. */
export function dimensoesAtivo(ativo: TiAtivo): { largura: number; profundidade: number; altura: number } {
  const def = tipoAtivo(ativo.tipo);
  const escala = Number(ativo.escala) || 1;
  return {
    largura: M(def.largura * escala),
    profundidade: M(def.altura * escala),
    altura: M(def.alturaZ * escala),
  };
}

/** Graus → radianos, e a cena gira no sentido oposto ao da planta 2D. */
export const rad = (graus: number): number => (-(Number(graus) || 0) * Math.PI) / 180;

/**
 * Converte um traço no chão (do ponto A ao ponto B) no retângulo da peça.
 *
 * É o que faz "arrastar para desenhar uma parede" funcionar: o comprimento
 * vem da distância entre os dois pontos, a espessura é a do catálogo, e o
 * giro é o ângulo do traço.
 *
 * SOBRE O SINAL DO ÂNGULO: na cena, rotação Y positiva leva +X na direção
 * -Z, e `rad()` já inverte o sinal ao converter. Por isso o ângulo aqui é o
 * `atan2` direto, sem negativo — as duas inversões se cancelam. Trocar um
 * sinal só aqui espelha todas as paredes tortas do escritório.
 *
 * Devolve o CENTRO (que é como a cena posiciona) e também o canto, que é o
 * que o banco guarda.
 */
export function retanguloDoTraco(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  espessura: number,
): {
  centroX: number;
  centroY: number;
  x: number;
  y: number;
  largura: number;
  profundidade: number;
  rotacao: number;
} {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const comprimento = Math.round(Math.hypot(dx, dy));
  const rotacao = (Math.atan2(dy, dx) * 180) / Math.PI;
  const centroX = Math.round((x1 + x2) / 2);
  const centroY = Math.round((y1 + y2) / 2);
  return {
    centroX,
    centroY,
    x: Math.round(centroX - comprimento / 2),
    y: Math.round(centroY - espessura / 2),
    largura: comprimento,
    profundidade: espessura,
    rotacao: Math.round(rotacao * 10) / 10,
  };
}

/**
 * Retângulo alinhado aos eixos a partir de dois cantos — para ambientes
 * (sala, copa) e móveis dimensionados no arrasto, que não giram com o traço.
 */
export function retanguloDeCantos(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; largura: number; profundidade: number } {
  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    largura: Math.round(Math.abs(x2 - x1)),
    profundidade: Math.round(Math.abs(y2 - y1)),
  };
}

/**
 * Enquadramento inicial da câmera para uma planta de LxA cm.
 *
 * A distância sai do tamanho do ambiente para que uma sala de 8 m e um andar
 * de 40 m abram os dois com o escritório inteiro na tela — câmera com
 * distância fixa serve a um e perde o outro.
 */
export function camaraInicial(larguraCm: number, alturaCm: number): [number, number, number] {
  const l = M(larguraCm);
  const a = M(alturaCm);
  const d = Math.max(l, a) * 0.85 + 6;
  return [l / 2 + d * 0.55, d * 0.72, a / 2 + d * 0.75];
}
