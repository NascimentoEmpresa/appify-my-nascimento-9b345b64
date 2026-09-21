/**
 * Endereço físico do item no galpão, e a geometria que transforma esse
 * endereço em um lugar no desenho 3D (SIS-2026-0442).
 *
 * O endereço NÃO é campo novo: é o texto livre de `sup_estoque_item.localizacao`,
 * que existe desde a carga do legado e tem 747 fichas preenchidas. Medindo
 * esses 747 valores em 21/09/2026, ele já é tridimensional:
 *
 *     letra = estante (baia)   2º número = nível   3º número = coluna do caixote
 *     'A-03-10'  →  estante A, nível 3, coluna 10     (471 casos, notação do legado)
 *     'A4.14'    →  estante A, nível 4, coluna 14     (237 casos, digitação recente)
 *
 * `parseEndereco` é o gêmeo em TypeScript da função `sup_loc_parse` da
 * migration 20260930000197. Os dois PRECISAM concordar: o banco decide o que
 * a lista mostra e o navegador decide o que o desenho destaca, e se eles
 * discordarem a busca acha um item que o mapa não acende. Há teste de
 * paridade em src/test/enderecoEstoque.test.ts com os casos reais medidos.
 */

export interface EnderecoEstoque {
  /** A letra da estante — o `codigo` de sup_estoque_modulo. */
  rua: string;
  /** Prateleira, contando de baixo para cima a partir de 1. */
  nivel: number;
  /** Vão dentro do nível, da esquerda para a direita a partir de 1. */
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
 * Escreve no formato com hífen — o do legado, que é a maioria e o que a RPC
 * `sup_mapa_enderecar_item` grava. Não normaliza o que já está no banco:
 * só formata o que está sendo escrito agora.
 */
export function formatarEndereco(e: EnderecoEstoque): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${e.rua}-${pad(e.nivel)}-${pad(e.coluna)}`;
}

/** Mesma chave usada para agrupar ficha por caixote. */
export function chaveCaixote(e: EnderecoEstoque): string {
  return `${e.rua}|${e.nivel}|${e.coluna}`;
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/**
 * Uma estante no desenho. Espelha `sup_estoque_modulo`.
 *
 * CONVENÇÃO DE POSIÇÃO (a mesma do seed da migration, e é preciso mudar os
 * dois juntos): `pos_x`/`pos_z` é o canto TRASEIRO-ESQUERDO do módulo no
 * piso. No espaço local a largura corre em +X, a altura em +Y e a
 * profundidade em +Z — então a FRENTE da estante (onde ficam as plaquinhas)
 * é a face +Z. `rotacao_graus` gira em torno desse canto:
 *
 *     0   frente virada para a frente do salão
 *     90  encostada na parede esquerda, olhando para dentro
 *     180 frente virada para o fundo
 *     270 encostada na parede direita, olhando para dentro
 */
export interface ModuloMapa {
  id: string;
  codigo: string;
  nome: string | null;
  pos_x: number;
  pos_z: number;
  rotacao_graus: number;
  colunas: number;
  niveis: number;
  largura_vao_m: number;
  altura_nivel_m: number;
  profundidade_m: number;
  caixotes_ocultos: { nivel: number; coluna: number }[];
  ordem: number;
  ativo: boolean;
}

export interface Ponto3D {
  x: number;
  y: number;
  z: number;
}

/** Rodapé da estante: o primeiro nível não começa no chão cru. */
export const ALTURA_RODAPE_M = 0.09;

/** Espessura das tábuas — a estante do vídeo é de madeira, não de aço fino. */
export const ESPESSURA_TABUA_M = 0.035;

export function larguraModulo(m: ModuloMapa): number {
  return m.colunas * m.largura_vao_m;
}

export function alturaModulo(m: ModuloMapa): number {
  return ALTURA_RODAPE_M + m.niveis * m.altura_nivel_m;
}

/** Converte um ponto do espaço local da estante para o espaço do galpão. */
export function localParaMundo(m: ModuloMapa, local: Ponto3D): Ponto3D {
  const t = (m.rotacao_graus * Math.PI) / 180;
  const cos = Math.cos(t);
  const sen = Math.sin(t);
  return {
    x: m.pos_x + local.x * cos + local.z * sen,
    y: local.y,
    z: m.pos_z - local.x * sen + local.z * cos,
  };
}

/**
 * Centro do caixote (nivel, coluna) dentro da estante, em espaço local.
 * Nível conta de baixo para cima e coluna da esquerda para a direita, ambos
 * a partir de 1 — que é como o endereço é escrito e como a pessoa lê a
 * prateleira.
 */
export function centroCaixoteLocal(m: ModuloMapa, nivel: number, coluna: number): Ponto3D {
  return {
    x: (coluna - 0.5) * m.largura_vao_m,
    y: ALTURA_RODAPE_M + (nivel - 0.5) * m.altura_nivel_m,
    z: m.profundidade_m * 0.5,
  };
}

/** O mesmo centro, já no espaço do galpão. */
export function centroCaixote(m: ModuloMapa, nivel: number, coluna: number): Ponto3D {
  return localParaMundo(m, centroCaixoteLocal(m, nivel, coluna));
}

/**
 * Onde a câmera para quando voa até um caixote: na frente dele, na altura
 * dele, a `recuo` metros da boca do vão. É o fim do zoom do pedido.
 */
export function pontoDeOlhar(m: ModuloMapa, nivel: number, coluna: number, recuo = 1.9): Ponto3D {
  const c = centroCaixoteLocal(m, nivel, coluna);
  return localParaMundo(m, { x: c.x, y: c.y, z: m.profundidade_m + recuo });
}

/** Centro do módulo no piso — serve para rotular a estante e enquadrá-la. */
export function centroModulo(m: ModuloMapa): Ponto3D {
  return localParaMundo(m, {
    x: larguraModulo(m) / 2,
    y: alturaModulo(m) / 2,
    z: m.profundidade_m / 2,
  });
}

export function caixoteOculto(m: ModuloMapa, nivel: number, coluna: number): boolean {
  return (m.caixotes_ocultos ?? []).some((c) => c.nivel === nivel && c.coluna === coluna);
}

/**
 * O endereço cabe na estante desenhada? Endereço apontando para um nível ou
 * coluna que não existe é real (o desenho começou menor que a prateleira) e
 * a tela precisa dizer isso em vez de sumir com a ficha.
 */
export function enderecoCabeNoModulo(m: ModuloMapa, e: EnderecoEstoque): boolean {
  return e.nivel >= 1 && e.nivel <= m.niveis && e.coluna >= 1 && e.coluna <= m.colunas;
}
