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

/** Gruda no quadrado de 1 m do piso. `livre` desliga (é o Alt do editor). */
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

// Quem serve de bancada é declarado no catálogo (`apoia`), não numa lista
// aqui: a lista local ficou desatualizada assim que o catálogo cresceu, e o
// sintoma foi silencioso — a impressora simplesmente pousava no chão em vez
// de subir na mesa de reunião.

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
    if (!tipoElemento(el.tipo).apoia) continue;
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

  // O canto guarda DUAS CASAS, não inteiro. Parece exagero num mapa de
  // escritório, mas não é: espessura ímpar (parede de 15 cm) põe o canto em
  // .5, e arredondar aqui fazia a parede andar meio centímetro a cada vez que
  // alguém puxava a ponta — `pontasDaParede` devolvia um centro 0,5 adiante do
  // que entrou. Num editor, deriva silenciosa a cada arrasto é pior do que
  // fração no banco (a coluna é numeric(10,2) e comporta).
  const duasCasas = (v: number) => Math.round(v * 100) / 100;

  return {
    centroX,
    centroY,
    x: duasCasas(centroX - comprimento / 2),
    y: duasCasas(centroY - espessura / 2),
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

// ── Andares ───────────────────────────────────────────────────────────

/**
 * Altura (cm) em que o piso de um andar começa.
 *
 * É a soma dos pés-direitos dos andares ABAIXO dele. Andar sem planta
 * cadastrada (alguém pulou do térreo para o 2º) entra com 300 cm, senão o
 * andar de cima pousaria dentro do de baixo.
 *
 * Subsolo (nível negativo) desce pelo mesmo caminho, com sinal trocado.
 */
export function alturaDoAndar(
  plantas: { nivel: number; pe_direito_cm: number }[],
  nivel: number,
  padrao = 300,
): number {
  if (nivel === 0) return 0;
  const pe = (n: number) => plantas.find((p) => p.nivel === n)?.pe_direito_cm ?? padrao;

  let total = 0;
  if (nivel > 0) {
    for (let n = 0; n < nivel; n++) total += pe(n);
    return total;
  }
  for (let n = nivel; n < 0; n++) total -= pe(n);
  return total;
}

// ── Puxar parede ──────────────────────────────────────────────────────

/** Um ponto no plano do chão, em cm. */
export interface Ponto {
  x: number;
  y: number;
}

/**
 * As duas pontas de uma peça alongada (parede, divisória, janela).
 *
 * O banco guarda canto + largura + giro; para PUXAR a parede o editor precisa
 * das pontas. É o inverso exato de `retanguloDoTraco` — as duas funções são
 * um par, e mexer numa sem a outra desalinha a alça do desenho.
 */
export function pontasDaParede(el: {
  x: number | string;
  y: number | string;
  largura: number | string;
  altura: number | string;
  rotacao: number | string;
}): { a: Ponto; b: Ponto } {
  const largura = Number(el.largura);
  const centroX = Number(el.x) + largura / 2;
  const centroY = Number(el.y) + Number(el.altura) / 2;
  const t = (Number(el.rotacao) * Math.PI) / 180;
  const dx = (Math.cos(t) * largura) / 2;
  const dy = (Math.sin(t) * largura) / 2;
  return {
    a: { x: centroX - dx, y: centroY - dy },
    b: { x: centroX + dx, y: centroY + dy },
  };
}

/**
 * Novo retângulo ao arrastar UM canto de uma peça retangular.
 *
 * O canto oposto fica parado — é o que se espera ao esticar uma sala pela
 * quina. Mínimo de 25 cm para a peça não sumir num arrasto atravessado — é
 * menor que o passo do grid de propósito, porque o mínimo é um limite de
 * segurança, não uma medida que alguém escolhe.
 */
export function redimensionarPorCanto(
  el: { x: number | string; y: number | string; largura: number | string; altura: number | string },
  canto: "nw" | "ne" | "sw" | "se",
  px: number,
  py: number,
): { x: number; y: number; largura: number; altura: number } {
  const x0 = Number(el.x);
  const y0 = Number(el.y);
  const x1 = x0 + Number(el.largura);
  const y1 = y0 + Number(el.altura);

  const oeste = canto === "nw" || canto === "sw";
  const norte = canto === "nw" || canto === "ne";

  const novoX0 = oeste ? Math.min(px, x1 - 25) : x0;
  const novoX1 = oeste ? x1 : Math.max(px, x0 + 25);
  const novoY0 = norte ? Math.min(py, y1 - 25) : y0;
  const novoY1 = norte ? y1 : Math.max(py, y0 + 25);

  return {
    x: Math.round(novoX0),
    y: Math.round(novoY0),
    largura: Math.round(novoX1 - novoX0),
    altura: Math.round(novoY1 - novoY0),
  };
}

// ── Piso por células ──────────────────────────────────────────────────

/** Um quadrado de 1 m² do piso, pelo índice (não em centímetros). */
export interface Celula {
  cx: number;
  cy: number;
}

export const chaveCelula = (cx: number, cy: number): string => `${cx},${cy}`;

/**
 * As células equivalentes a uma planta retangular.
 *
 * É o que a cena desenha para planta que ainda não tem célula nenhuma —
 * todas as de hoje. Assim o modelo novo (piso em L, em T) convive com o
 * antigo sem migração e sem o mapa mudar de forma sozinho.
 */
export function celulasDoRetangulo(larguraCm: number, alturaCm: number): Celula[] {
  const l = Math.max(1, Math.ceil(larguraCm / 100));
  const a = Math.max(1, Math.ceil(alturaCm / 100));
  const saida: Celula[] = [];
  for (let cx = 0; cx < l; cx++) for (let cy = 0; cy < a; cy++) saida.push({ cx, cy });
  return saida;
}

const VIZINHOS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Onde vão os "+": todo quadrado VAZIO encostado num quadrado do piso.
 *
 * É a fronteira de fora. Clicar num deles acrescenta exatamente aquele metro
 * quadrado — é o que transforma um retângulo em L sem mexer no resto.
 *
 * Só os quatro vizinhos ortogonais: diagonal não encosta, e oferecer "+" na
 * quina criaria piso pendurado por um vértice.
 */
export function contornoParaExpandir(celulas: Celula[]): Celula[] {
  const ocupadas = new Set(celulas.map((c) => chaveCelula(c.cx, c.cy)));
  const vistos = new Set<string>();
  const saida: Celula[] = [];

  for (const c of celulas) {
    for (const [dx, dy] of VIZINHOS) {
      const nx = c.cx + dx;
      const ny = c.cy + dy;
      const k = chaveCelula(nx, ny);
      if (ocupadas.has(k) || vistos.has(k)) continue;
      vistos.add(k);
      saida.push({ cx: nx, cy: ny });
    }
  }
  return saida;
}

/**
 * Onde vão os "−": quadrados do piso que fazem borda.
 *
 * Célula cercada por todos os lados não recebe marcador — tirar um quadrado
 * do meio abriria um buraco no piso, que ninguém quer de propósito e é chato
 * de desfazer clicando.
 */
export function bordaParaRemover(celulas: Celula[]): Celula[] {
  const ocupadas = new Set(celulas.map((c) => chaveCelula(c.cx, c.cy)));
  return celulas.filter((c) =>
    VIZINHOS.some(([dx, dy]) => !ocupadas.has(chaveCelula(c.cx + dx, c.cy + dy))),
  );
}

/** A moldura que contém as células, em cm — para a câmera e para a grade. */
export function limitesDasCelulas(celulas: Celula[]): { larguraCm: number; alturaCm: number } {
  if (celulas.length === 0) return { larguraCm: 100, alturaCm: 100 };
  let maxX = 0;
  let maxY = 0;
  for (const c of celulas) {
    if (c.cx > maxX) maxX = c.cx;
    if (c.cy > maxY) maxY = c.cy;
  }
  return { larguraCm: (maxX + 1) * 100, alturaCm: (maxY + 1) * 100 };
}

/** Um trecho reto do contorno do piso, em índices de célula. */
export interface Aresta {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * O contorno do piso — por onde as paredes externas correm.
 *
 * Uma aresta entra no contorno quando a célula tem piso e o vizinho daquele
 * lado não tem. É isso que faz a parede acompanhar o formato: num piso em L,
 * o contorno tem seis trechos, e não os quatro de um retângulo.
 *
 * Os trechos colineares e contíguos são MESCLADOS: sem isso, um andar de 20 m
 * viraria vinte caixinhas de 1 m enfileiradas, cada uma com sua sombra e sua
 * entrada no raycast, e as emendas apareceriam na renderização.
 */
export function arestasDoContorno(celulas: Celula[]): Aresta[] {
  const ocupadas = new Set(celulas.map((c) => chaveCelula(c.cx, c.cy)));
  const tem = (cx: number, cy: number) => ocupadas.has(chaveCelula(cx, cy));

  // Horizontais: agrupadas por linha (y), guardando o x de início.
  const horizontais = new Map<number, number[]>();
  const verticais = new Map<number, number[]>();
  const juntar = (mapa: Map<number, number[]>, chave: number, valor: number) => {
    const lista = mapa.get(chave);
    if (lista) lista.push(valor);
    else mapa.set(chave, [valor]);
  };

  for (const c of celulas) {
    if (!tem(c.cx, c.cy - 1)) juntar(horizontais, c.cy, c.cx);
    if (!tem(c.cx, c.cy + 1)) juntar(horizontais, c.cy + 1, c.cx);
    if (!tem(c.cx - 1, c.cy)) juntar(verticais, c.cx, c.cy);
    if (!tem(c.cx + 1, c.cy)) juntar(verticais, c.cx + 1, c.cy);
  }

  const saida: Aresta[] = [];

  /** Junta números contíguos numa lista ordenada em faixas [inicio, fim]. */
  const faixas = (valores: number[]): [number, number][] => {
    const ordenados = [...new Set(valores)].sort((a, b) => a - b);
    const res: [number, number][] = [];
    let inicio = ordenados[0];
    let anterior = ordenados[0];
    for (let i = 1; i < ordenados.length; i++) {
      if (ordenados[i] === anterior + 1) {
        anterior = ordenados[i];
        continue;
      }
      res.push([inicio, anterior + 1]);
      inicio = ordenados[i];
      anterior = ordenados[i];
    }
    res.push([inicio, anterior + 1]);
    return res;
  };

  for (const [y, xs] of horizontais) {
    for (const [a, b] of faixas(xs)) saida.push({ x1: a, y1: y, x2: b, y2: y });
  }
  for (const [x, ys] of verticais) {
    for (const [a, b] of faixas(ys)) saida.push({ x1: x, y1: a, x2: x, y2: b });
  }
  return saida;
}

// ── Centro × canto ────────────────────────────────────────────────────
//
// A confusão que já causou dois bugs neste editor: o BANCO guarda o canto
// superior esquerdo da peça (x, y), e a CENA posiciona pelo centro. Somar
// meia largura no lugar errado faz a peça saltar — foi o que deixou a mesa
// pular para fora da sala assim que alguém a arrastava.
//
// Sempre que uma posição atravessar a fronteira banco ↔ cena, passe por aqui.

/** Canto (banco) → centro (cena). */
export function centroDaPeca(el: {
  x: number | string;
  y: number | string;
  largura: number | string;
  altura: number | string;
}): Ponto {
  return {
    x: Number(el.x) + Number(el.largura) / 2,
    y: Number(el.y) + Number(el.altura) / 2,
  };
}

/** Centro (cena) → canto (banco). */
export function cantoDaPeca(
  centroX: number,
  centroY: number,
  largura: number | string,
  altura: number | string,
): Ponto {
  return {
    x: centroX - Number(largura) / 2,
    y: centroY - Number(altura) / 2,
  };
}
