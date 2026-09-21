import { describe, expect, it } from "vitest";
import {
  ALTURA_RODAPE_M,
  alturaModulo,
  caixoteOculto,
  centroCaixote,
  enderecoCabeNoModulo,
  formatarEndereco,
  larguraModulo,
  localParaMundo,
  parseEndereco,
  pontoDeOlhar,
  type ModuloMapa,
} from "@/lib/suprimentos/enderecoEstoque";

/**
 * Os casos aqui NÃO são inventados: são os formatos realmente encontrados nas
 * 747 fichas com endereço preenchido, medidos no banco de produção em
 * 21/09/2026, e cada resultado esperado foi conferido rodando a função gêmea
 * `sup_loc_parse` num Postgres 18 (717 válidos / 30 sujos). Se este teste e o
 * SQL discordarem, a busca acha um item que o desenho não acende.
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
    // 'G-04-05-06/02' e 'G-03-01/02/03' existem de verdade (3 fichas): o
    // material está espalhado por vãos vizinhos. O desenho acende o primeiro,
    // e o texto original continua guardando o resto.
    expect(parseEndereco("G-04-05-06/02")).toEqual({ rua: "G", nivel: 4, coluna: 5 });
    expect(parseEndereco("G-03-01/02/03")).toEqual({ rua: "G", nivel: 3, coluna: 1 });
  });

  it("trata zero como 'não sei', não como endereço", () => {
    // 14 fichas vieram assim do legado.
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

  it("escreve de volta no formato com hífen, que é o que a RPC grava", () => {
    expect(formatarEndereco({ rua: "A", nivel: 3, coluna: 10 })).toBe("A-03-10");
    expect(formatarEndereco({ rua: "Z", nivel: 10, coluna: 24 })).toBe("Z-10-24");
  });

  it("vai e volta sem perder nada", () => {
    for (const texto of ["A-03-10", "B-06-11", "Z-10-24"]) {
      expect(formatarEndereco(parseEndereco(texto)!)).toBe(texto);
    }
  });
});

const estanteA: ModuloMapa = {
  id: "m-a", codigo: "A", nome: "Estante A — parede do fundo",
  pos_x: 2, pos_z: 0.05, rotacao_graus: 0,
  colunas: 15, niveis: 5,
  largura_vao_m: 0.45, altura_nivel_m: 0.48, profundidade_m: 0.55,
  caixotes_ocultos: [{ nivel: 1, coluna: 7 }], ordem: 1, ativo: true,
};

describe("geometria da estante", () => {
  it("mede a estante pela grade de caixotes", () => {
    expect(larguraModulo(estanteA)).toBeCloseTo(6.75, 5);
    expect(alturaModulo(estanteA)).toBeCloseTo(ALTURA_RODAPE_M + 2.4, 5);
  });

  it("põe o caixote (1,1) no canto de baixo à esquerda", () => {
    const p = centroCaixote(estanteA, 1, 1);
    expect(p.x).toBeCloseTo(2 + 0.225, 5);
    expect(p.y).toBeCloseTo(ALTURA_RODAPE_M + 0.24, 5);
    expect(p.z).toBeCloseTo(0.05 + 0.275, 5);
  });

  it("sobe o nível e anda a coluna na direção certa", () => {
    const baixo = centroCaixote(estanteA, 1, 1);
    const cima = centroCaixote(estanteA, 2, 1);
    const direita = centroCaixote(estanteA, 1, 2);
    expect(cima.y - baixo.y).toBeCloseTo(0.48, 5);
    expect(direita.x - baixo.x).toBeCloseTo(0.45, 5);
  });

  it("gira em torno do canto traseiro-esquerdo, como o seed da migration assume", () => {
    // 90° = encostada na parede esquerda olhando para dentro: a largura passa
    // a correr para o fundo (-Z) e a profundidade para dentro do salão (+X).
    const naParede: ModuloMapa = { ...estanteA, rotacao_graus: 90, pos_x: 0.05, pos_z: 10.5 };
    const larguraLocal = localParaMundo(naParede, { x: 1, y: 0, z: 0 });
    expect(larguraLocal.x).toBeCloseTo(0.05, 5);
    expect(larguraLocal.z).toBeCloseTo(9.5, 5);

    const profundidadeLocal = localParaMundo(naParede, { x: 0, y: 0, z: 1 });
    expect(profundidadeLocal.x).toBeCloseTo(1.05, 5);
    expect(profundidadeLocal.z).toBeCloseTo(10.5, 5);
  });

  it("para a câmera na frente do caixote, não dentro dele", () => {
    const olhar = pontoDeOlhar(estanteA, 3, 5, 1.9);
    const centro = centroCaixote(estanteA, 3, 5);
    expect(olhar.y).toBeCloseTo(centro.y, 5);
    // Estante virada para a frente do salão: a câmera fica mais para a frente.
    expect(olhar.z).toBeGreaterThan(centro.z);
    expect(olhar.z - centro.z).toBeCloseTo(0.55 / 2 + 1.9, 5);
  });

  it("sabe qual vão não existe na parede", () => {
    expect(caixoteOculto(estanteA, 1, 7)).toBe(true);
    expect(caixoteOculto(estanteA, 1, 6)).toBe(false);
  });

  it("acusa endereço que não cabe na estante desenhada", () => {
    expect(enderecoCabeNoModulo(estanteA, { rua: "A", nivel: 5, coluna: 15 })).toBe(true);
    // Estante A tem 5 níveis: nível 6 existe no papel, não no desenho ainda.
    expect(enderecoCabeNoModulo(estanteA, { rua: "A", nivel: 6, coluna: 1 })).toBe(false);
    expect(enderecoCabeNoModulo(estanteA, { rua: "A", nivel: 1, coluna: 16 })).toBe(false);
  });
});
