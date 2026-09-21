import { describe, expect, it } from "vitest";
import {
  acharColuna,
  alturaColuna,
  alturaTravessa,
  caixoteExiste,
  centroCaixote,
  formatarColunaLinha,
  formatarEndereco,
  linhaOculta,
  localParaMundo,
  parseEndereco,
  pontoDaPlaquinha,
  pontoDeOlhar,
  posicaoDaProximaColuna,
  proximoIndice,
  type ColunaMapa,
  type CorredorMapa,
} from "@/lib/suprimentos/enderecoEstoque";

/**
 * Os casos aqui NÃO são inventados: são os formatos realmente encontrados nas
 * fichas com endereço preenchido, medidos no banco de produção em
 * 21/09/2026, e cada resultado esperado foi conferido rodando a função gêmea
 * `sup_loc_parse` num Postgres 18 (717 válidos / 30 sujos, paridade linha a
 * linha sem divergência). Se este teste e o SQL discordarem, a busca acha um
 * item que o desenho não acende.
 */
describe("parseEndereco — as duas notações do galpão", () => {
  it("lê a notação do legado, com hífen (471 das 747 fichas)", () => {
    expect(parseEndereco("A-03-10")).toEqual({ rua: "A", nivel: 3, coluna: 10 });
    expect(parseEndereco("F-04-08")).toEqual({ rua: "F", nivel: 4, coluna: 8 });
  });

  it("lê a notação digitada com ponto (237 fichas)", () => {
    expect(parseEndereco("A4.14")).toEqual({ rua: "A", nivel: 4, coluna: 14 });
    expect(parseEndereco("E1.02")).toEqual({ rua: "E", nivel: 1, coluna: 2 });
  });

  it("não se importa com caixa nem espaço sobrando", () => {
    expect(parseEndereco("a-3-10")).toEqual({ rua: "A", nivel: 3, coluna: 10 });
    expect(parseEndereco("  f-04-08  ")).toEqual({ rua: "F", nivel: 4, coluna: 8 });
  });

  it("ancora o material que ocupa mais de um vão no primeiro deles", () => {
    expect(parseEndereco("G-04-05-06/02")).toEqual({ rua: "G", nivel: 4, coluna: 5 });
    expect(parseEndereco("G-03-01/02/03")).toEqual({ rua: "G", nivel: 3, coluna: 1 });
  });

  it("trata zero como 'não sei', não como endereço", () => {
    expect(parseEndereco("0-00-00")).toBeNull();
    expect(parseEndereco("00.00")).toBeNull();
  });

  it("devolve null no que é sujo, em vez de estourar", () => {
    for (const sujo of ["TESTE", "N/A", "INS-0004", "EPI-0020", "CX.02", "CHAO", "1", "eeeeeeeeeee", "", "   "]) {
      expect(parseEndereco(sujo), `esperava null para ${JSON.stringify(sujo)}`).toBeNull();
    }
    expect(parseEndereco(null)).toBeNull();
    expect(parseEndereco(undefined)).toBeNull();
  });

  it("grava no formato com hífen, que é o que a RPC escreve", () => {
    expect(formatarEndereco({ rua: "A", nivel: 3, coluna: 10 })).toBe("A-03-10");
    expect(formatarEndereco({ rua: "Z", nivel: 10, coluna: 24 })).toBe("Z-10-24");
  });

  it("vai e volta sem perder nada", () => {
    for (const texto of ["A-03-10", "B-06-11", "Z-10-24"]) {
      expect(formatarEndereco(parseEndereco(texto)!)).toBe(texto);
    }
  });
});

describe("leitura em coluna:linha", () => {
  /**
   * O pedido foi "tudo padrão coluna:linha". O banco continua com 'A-03-10';
   * quem inverte para a leitura é esta função — e a ordem importa: 10:3 é
   * coluna 10, linha 3, NÃO linha 10.
   */
  it("mostra coluna primeiro, linha depois", () => {
    expect(formatarColunaLinha({ rua: "A", nivel: 3, coluna: 10 })).toBe("10:3");
    expect(formatarColunaLinha({ rua: "A", nivel: 3, coluna: 10 }, true)).toBe("A · 10:3");
  });

  it("não confunde os dois números quando são parecidos", () => {
    const e = parseEndereco("B-06-11")!;
    expect(formatarColunaLinha(e)).toBe("11:6");
    expect(formatarEndereco(e)).toBe("B-06-11");
  });
});

const coluna: ColunaMapa = {
  id: "k1", corredor_id: "c1", indice: 10,
  pos_x: 2, pos_z: 0.05, rotacao_graus: 0,
  largura_m: 0.42, profundidade_m: 0.58,
  altura_linha_m: 0.42, altura_base_m: 0.09,
  linhas: 6, linhas_ocultas: [2], ativo: true,
};

const corredor: CorredorMapa = {
  id: "c1", codigo: "A", nome: "Corredor A", ordem: 1, ativo: true,
  colunas: [coluna, { ...coluna, id: "k2", indice: 11, pos_x: 2.42 }],
};

describe("geometria da coluna", () => {
  it("mede a coluna pelas linhas que ela tem", () => {
    expect(alturaColuna(coluna)).toBeCloseTo(0.09 + 6 * 0.42, 5);
  });

  it("dá à travessa um terço da altura da linha — é o que faz o vão ser mais largo que alto", () => {
    expect(alturaTravessa(coluna)).toBeCloseTo(0.42 * 0.33, 5);
    // O vão que sobra tem de ser menor que a largura, como nas fotos.
    const vaoLivre = coluna.altura_linha_m - alturaTravessa(coluna);
    expect(vaoLivre).toBeLessThan(coluna.largura_m);
  });

  it("põe a linha 1 embaixo e sobe a partir dela", () => {
    const baixo = centroCaixote(coluna, 1);
    const cima = centroCaixote(coluna, 2);
    expect(baixo.y).toBeCloseTo(0.09 + 0.21, 5);
    expect(cima.y - baixo.y).toBeCloseTo(0.42, 5);
    expect(baixo.x).toBeCloseTo(2 + 0.21, 5);
  });

  it("gira em torno do canto traseiro-esquerdo", () => {
    const naParede: ColunaMapa = { ...coluna, rotacao_graus: 90, pos_x: 0.05, pos_z: 10.5 };
    const larg = localParaMundo(naParede, { x: 1, y: 0, z: 0 });
    expect(larg.x).toBeCloseTo(0.05, 5);
    expect(larg.z).toBeCloseTo(9.5, 5);
    const prof = localParaMundo(naParede, { x: 0, y: 0, z: 1 });
    expect(prof.x).toBeCloseTo(1.05, 5);
    expect(prof.z).toBeCloseTo(10.5, 5);
  });

  it("para a câmera na frente do caixote, não dentro dele", () => {
    const olhar = pontoDeOlhar(coluna, 3, 1.05);
    const centro = centroCaixote(coluna, 3);
    expect(olhar.y).toBeCloseTo(centro.y, 5);
    expect(olhar.z - centro.z).toBeCloseTo(0.58 / 2 + 1.05, 5);
  });

  it("recua pouco, porque o corredor é estreito", () => {
    // Corredor de ~1,10 m: recuar mais enfiaria a câmera na prateleira de trás.
    const centro = centroCaixote(coluna, 3);
    const padrao = pontoDeOlhar(coluna, 3);
    expect(padrao.z - centro.z).toBeLessThan(1.4);
  });

  it("põe a plaquinha na travessa, embaixo do vão", () => {
    const pl = pontoDaPlaquinha(coluna, 1);
    const centro = centroCaixote(coluna, 1);
    expect(pl.y).toBeLessThan(centro.y);
    expect(pl.z).toBeGreaterThan(centro.z);
  });
});

describe("vãos que não existem", () => {
  it("sabe qual linha está tapada", () => {
    expect(linhaOculta(coluna, 2)).toBe(true);
    expect(linhaOculta(coluna, 3)).toBe(false);
  });

  it("tapar uma linha do meio não mexe na numeração das outras", () => {
    expect(caixoteExiste(coluna, 1)).toBe(true);
    expect(caixoteExiste(coluna, 2)).toBe(false);
    expect(caixoteExiste(coluna, 3)).toBe(true);
    expect(caixoteExiste(coluna, 7)).toBe(false); // passa das 6 linhas
  });
});

describe("montar a prateleira", () => {
  it("acha a coluna do endereço pelo índice, não pela ordem", () => {
    expect(acharColuna(corredor, { rua: "A", nivel: 3, coluna: 11 })?.id).toBe("k2");
    expect(acharColuna(corredor, { rua: "A", nivel: 3, coluna: 99 })).toBeNull();
    expect(acharColuna(undefined, { rua: "A", nivel: 1, coluna: 1 })).toBeNull();
  });

  it("numera a coluna nova depois da maior, sem reaproveitar buraco", () => {
    // Reaproveitar o índice de uma coluna apagada daria à nova o endereço dos
    // itens que estavam na antiga.
    expect(proximoIndice(corredor)).toBe(12);
    const comBuraco: CorredorMapa = { ...corredor, colunas: [corredor.colunas[1]] };
    expect(proximoIndice(comBuraco)).toBe(12);
  });

  it("encosta a coluna nova na última, na direção em que ela aponta", () => {
    expect(posicaoDaProximaColuna(coluna)).toEqual({ pos_x: 2.42, pos_z: 0.05 });
    // Virada para a parede direita, a prateleira cresce no outro eixo.
    expect(posicaoDaProximaColuna({ ...coluna, rotacao_graus: 270, pos_x: 11.95, pos_z: 1.2 }))
      .toEqual({ pos_x: 11.95, pos_z: 1.62 });
  });
});
