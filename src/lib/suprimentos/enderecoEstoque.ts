/**
 * Endereço físico do item no galpão, e a geometria que transforma esse
 * endereço em um lugar no desenho 3D (SIS-2026-0442).
 *
 * O endereço NÃO é campo novo: é o texto livre de `sup_estoque_item.localizacao`,
 * que existe desde a carga do legado. Medindo os valores reais em produção:
 *
 *     'A-03-10'  (471 casos, notação do legado)
 *     'A4.14'    (237 casos, digitação recente)
 *
 * e as duas notações são o mesmo galpão escrito de dois jeitos.
 *
 * O QUE CADA PEDAÇO É — confirmado pelo autor do chamado em 21/09/2026, com o
 * croqui anotado e os vídeos do galpão:
 *
 *     letra = CORREDOR   ·   2º número = LINHA (altura)   ·   3º = COLUNA
 *
 * A letra é o corredor, não a estante: foi a correção da segunda rodada (a
 * primeira versão assumiu estante, e a modelagem toda mudou por causa disso —
 * ver o cabeçalho de 20260930000200).
 *
 * COMO SE LÊ NA TELA — o pedido pediu "tudo padrão 'coluna:linha'", então a
 * tela mostra `A · 10:3` (coluna 10, linha 3). O banco continua gravando
 * 'A-03-10': nenhuma ficha foi reescrita e nenhuma tela antiga mudou. Quem
 * traduz é `formatarColunaLinha`.
 *
 * `parseEndereco` é o gêmeo em TypeScript da função `sup_loc_parse` do banco.
 * Os dois PRECISAM concordar, senão a busca acha um item que o desenho não
 * acende — há teste de paridade em src/test/enderecoEstoque.test.ts com os
 * casos reais medidos.
 */

export interface EnderecoEstoque {
  /** A letra do corredor — o `codigo` de sup_estoque_corredor. */
  rua: string;
  /** Linha: altura dentro da coluna, de baixo para cima a partir de 1. */
  nivel: number;
  /** Coluna: o `indice` de sup_estoque_coluna dentro do corredor. */
  coluna: number;
}

/**
 * Lê as duas notações. Devolve `null` no que não reconhece — endereço sujo
 * não é erro, é ficha que vai para o balde "sem endereço" da tela.
 *
 * Zero em qualquer eixo é "não sei", não endereço: '0-00-00' e '00.00' são 14
 * fichas que vieram assim do legado.
 */
export function parseEndereco(texto?: string | null): EnderecoEstoque | null {
  const v = (texto ?? "").trim().toUpperCase();
  if (!v) return null;

  // 'A-03-10', e também 'G-04-05-06/02' (ancora nos dois primeiros números;
  // o resto é o material ocupando mais de um vão, que o texto original guarda).
  let m = /^([A-Z])[-. ]+0*(\d{1,2})[-. ]+0*(\d{1,2})/.exec(v);
  // 'A4.14'
  if (!m) m = /^([A-Z])0*(\d{1,2})\.0*(\d{1,2})/.exec(v);
  if (!m) return null;

  const nivel = Number(m[2]);
  const coluna = Number(m[3]);
  if (nivel === 0 || coluna === 0) return null;

  return { rua: m[1], nivel, coluna };
}

/**
 * Como o endereço é GRAVADO — formato com hífen, o do legado, que é a maioria
 * e o que a RPC `sup_mapa_enderecar_item` escreve. Não normaliza o que já
 * está no banco: só formata o que está sendo escrito agora.
 */
export function formatarEndereco(e: EnderecoEstoque): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${e.rua}-${pad(e.nivel)}-${pad(e.coluna)}`;
}

/**
 * Como o endereço é MOSTRADO — o padrão coluna:linha do pedido.
 * `{rua:'A', nivel:3, coluna:10}` vira `"10:3"`, e com o corredor, `"A · 10:3"`.
 */
export function formatarColunaLinha(e: EnderecoEstoque, comCorredor = false): string {
  const cl = `${e.coluna}:${e.nivel}`;
  return comCorredor ? `${e.rua} · ${cl}` : cl;
}

/** Mesma chave usada para agrupar ficha por caixote. */
export function chaveCaixote(e: EnderecoEstoque): string {
  return `${e.rua}|${e.nivel}|${e.coluna}`;
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/**
 * Uma COLUNA de caixotes — a peça que se monta na tela, e a unidade do
 * desenho desde 20260930000200. Espelha `sup_estoque_coluna`.
 *
 * Por que a coluna, e não um retângulo de estante: no galpão real as pilhas
 * não têm todas a mesma altura nem terminam na mesma linha (as fotos mostram
 * prateleira de 4 níveis encostada em outra de 7). Um retângulo só consegue
 * descrever o galpão ideal; a coluna descreve o galpão que existe.
 *
 * CONVENÇÃO DE POSIÇÃO: `pos_x`/`pos_z` é o canto TRASEIRO-ESQUERDO da coluna
 * no piso. No espaço local a largura corre em +X, a altura em +Y e a
 * profundidade em +Z — então a FRENTE (onde fica a plaquinha) é a face +Z.
 * `rotacao_graus` gira em torno desse canto:
 *
 *     0   frente virada para a frente do salão
 *     90  encostada na parede esquerda, olhando para dentro
 *     180 frente virada para o fundo
 *     270 encostada na parede direita, olhando para dentro
 */
export interface ColunaMapa {
  id: string;
  corredor_id: string;
  /** O número que aparece em coluna:linha. */
  indice: number;
  pos_x: number;
  pos_z: number;
  rotacao_graus: number;
  largura_m: number;
  profundidade_m: number;
  altura_linha_m: number;
  altura_base_m: number;
  /** Quantos caixotes empilhados. */
  linhas: number;
  /** Linhas que existem na numeração mas não na parede (vão, quadro, pilar). */
  linhas_ocultas: number[];
  ativo: boolean;
}

/** Um corredor — a letra do endereço. Espelha `sup_estoque_corredor`. */
export interface CorredorMapa {
  id: string;
  codigo: string;
  nome: string | null;
  ordem: number;
  ativo: boolean;
  colunas: ColunaMapa[];
}

export interface Ponto3D {
  x: number;
  y: number;
  z: number;
}

/** Espessura das tábuas — a prateleira do vídeo é de madeira, não aço fino. */
export const ESPESSURA_TABUA_M = 0.035;

/**
 * A travessa da frente, onde a plaquinha é pregada. Medida nos vídeos: ela
 * come cerca de um TERÇO da altura da linha, o que é bem mais do que parece
 * — é o que faz o vão ser mais largo que alto mesmo quando o módulo é
 * quadrado, e a primeira versão errou isso.
 */
export const FRACAO_TRAVESSA = 0.33;

export function alturaTravessa(c: ColunaMapa): number {
  return c.altura_linha_m * FRACAO_TRAVESSA;
}

export function alturaColuna(c: ColunaMapa): number {
  return c.altura_base_m + c.linhas * c.altura_linha_m;
}

/** Converte um ponto do espaço local da coluna para o espaço do galpão. */
export function localParaMundo(c: ColunaMapa, local: Ponto3D): Ponto3D {
  const t = (c.rotacao_graus * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  return {
    x: c.pos_x + local.x * cos + local.z * sen,
    y: local.y,
    z: c.pos_z - local.x * sen + local.z * cos,
  };
}

/** Centro do caixote da linha `linha` (1 = a de baixo), em espaço local. */
export function centroCaixoteLocal(c: ColunaMapa, linha: number): Ponto3D {
  return {
    x: c.largura_m / 2,
    y: c.altura_base_m + (linha - 0.5) * c.altura_linha_m,
    z: c.profundidade_m / 2,
  };
}

/** O mesmo centro, já no espaço do galpão. */
export function centroCaixote(c: ColunaMapa, linha: number): Ponto3D {
  return localParaMundo(c, centroCaixoteLocal(c, linha));
}

/**
 * Onde a câmera para quando voa até um caixote: na frente dele, na altura
 * dele, a `recuo` metros da boca do vão. É o fim do zoom do pedido.
 *
 * O recuo é menor do que pareceria razoável porque os corredores são
 * ESTREITOS (~1,15 m nos vídeos): afastar mais enfiaria a câmera dentro da
 * prateleira de trás.
 */
export function pontoDeOlhar(c: ColunaMapa, linha: number, recuo = 1.05): Ponto3D {
  const p = centroCaixoteLocal(c, linha);
  return localParaMundo(c, { x: p.x, y: p.y, z: c.profundidade_m + recuo });
}

/**
 * Onde a plaquinha de identificação fica, para escrever coluna:linha nela.
 *
 * `recuo` afasta o ponto da face da travessa. A própria plaquinha usa o
 * padrão; o TEXTO precisa de um recuo maior, senão fica dentro da espessura
 * da plaquinha e não aparece — foi exatamente o que aconteceu na primeira
 * tentativa, com a plaquinha em branco no desenho.
 */
export function pontoDaPlaquinha(c: ColunaMapa, linha: number, recuo = 0.006): Ponto3D {
  return localParaMundo(c, {
    x: c.largura_m / 2,
    y: c.altura_base_m + (linha - 1) * c.altura_linha_m + alturaTravessa(c) / 2,
    z: c.profundidade_m + recuo,
  });
}

export function linhaOculta(c: ColunaMapa, linha: number): boolean {
  return (c.linhas_ocultas ?? []).includes(linha);
}

/** O caixote existe mesmo nesta coluna? */
export function caixoteExiste(c: ColunaMapa, linha: number): boolean {
  return linha >= 1 && linha <= c.linhas && !linhaOculta(c, linha);
}

/**
 * Acha a coluna de um endereço dentro do corredor. Devolve `null` quando o
 * endereço aponta para uma coluna que ninguém desenhou ainda — que é real e a
 * tela precisa dizer, em vez de sumir com a ficha.
 */
export function acharColuna(corredor: CorredorMapa | undefined, e: EnderecoEstoque): ColunaMapa | null {
  if (!corredor) return null;
  return corredor.colunas.find((c) => c.indice === e.coluna) ?? null;
}

/**
 * Próximo índice livre de coluna no corredor. É o que o editor usa quando a
 * pessoa manda "criar mais uma coluna" — numeração não reaproveita buraco, ou
 * a coluna nova herdaria o endereço de itens que estavam na que foi apagada.
 */
export function proximoIndice(corredor: CorredorMapa): number {
  return corredor.colunas.reduce((m, c) => Math.max(m, c.indice), 0) + 1;
}

/**
 * Onde encostar uma coluna nova na última do corredor — o "mais pra frente"
 * do pedido. Ela nasce colada na vizinha, na mesma rotação e com as mesmas
 * medidas, que é como a prateleira cresce de verdade.
 */
export function posicaoDaProximaColuna(ultima: ColunaMapa): { pos_x: number; pos_z: number } {
  const t = (ultima.rotacao_graus * Math.PI) / 180;
  return {
    pos_x: Number((ultima.pos_x + ultima.largura_m * Math.cos(t)).toFixed(2)),
    pos_z: Number((ultima.pos_z - ultima.largura_m * Math.sin(t)).toFixed(2)),
  };
}
