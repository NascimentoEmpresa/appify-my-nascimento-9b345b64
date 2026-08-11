import { describe, it, expect } from "vitest";
import { sugerirContrato, cidadeDoContrato } from "@/pages/juridico/Processos";

// Nomes reais da CONTRATOS (coluna "NOME CONTRATO"): quase sempre começam
// pela cidade, mas nem sempre — daí a necessidade de pontuar em vez de só
// procurar substring.
const CONTRATOS = [
  "ADM E ESTAGIARIOS - NH",
  "BENTO GONÇALVES - AUX ADM - 002/2021",
  "BENTO GONÇALVES - LIMPEZA - 048.2026",
  "CAMARA DE RIO GRANDE-LIMPEZA - 001/2023",
  "CAMARA DE RIO GRANDE-PORTARIA - 002/2023",
  "CAXIAS DO SUL - 95.2026",
  "CHARQUEADAS - 005.2021",
  "CHARQUEADAS - 168/2021",
  "DMAE - 895/0",
  "EMBRAPA - 2021/93",
  // As 10 linhas reais da UFRGS: é onde o desempate importa de verdade.
  "FURG JARDINAGEM  - 049/2022",
  "UFRGS - AUX DE SAÚDE BUCAL - 033/2021",
  "UFRGS - CARREGADORES - 095/2024",
  "UFRGS - COPA E COZINHA - 025/2025",
  "UFRGS - INTERPRETE DE LIBRAS - 009.2026",
  "UFRGS - JARDINAGEM - 062/2025",
  "UFRGS - LIMPEZA - 020/2022",
  "UFRGS - LIMPEZA GERAL - 047/2022",
  "UFRGS - MOTORISTAS - 034/2022",
  "UFRGS ALMOXARIFES",
];

describe("sugerirContrato", () => {
  it("casa a cidade que abre o nome do contrato", () => {
    expect(sugerirContrato("CAXIAS DO SUL", CONTRATOS)).toBe("CAXIAS DO SUL - 95.2026");
  });

  // Acento e caixa vêm de jeitos diferentes na base; não podem atrapalhar.
  it("ignora acento e caixa", () => {
    expect(sugerirContrato("bento goncalves", CONTRATOS)).toBe("BENTO GONÇALVES - AUX ADM - 002/2021");
  });

  // Empate real: duas linhas de Charqueadas. Escolhe uma (a mais curta) e o
  // usuário troca se for outra — por isso o campo continua editável.
  it("com varios contratos da mesma cidade, sugere o de nome mais curto", () => {
    expect(sugerirContrato("CHARQUEADAS", CONTRATOS)).toBe("CHARQUEADAS - 005.2021");
  });

  it("acha a cidade citada no meio do nome", () => {
    expect(sugerirContrato("RIO GRANDE", CONTRATOS)).toBe("CAMARA DE RIO GRANDE-LIMPEZA - 001/2023");
  });

  // O que NÃO pode acontecer: sugerir contrato errado por coincidência de uma
  // palavra. "SANTA MARIA" não tem contrato aqui — melhor vazio que errado.
  it("municipio sem contrato correspondente nao sugere nada", () => {
    expect(sugerirContrato("SANTA MARIA", CONTRATOS)).toBe("");
    expect(sugerirContrato("FLORIANOPOLIS", CONTRATOS)).toBe("");
  });

  it("municipio vazio nao sugere nada", () => {
    expect(sugerirContrato("", CONTRATOS)).toBe("");
    expect(sugerirContrato("   ", CONTRATOS)).toBe("");
  });

  it("lista de contratos vazia nao quebra", () => {
    expect(sugerirContrato("PORTO ALEGRE", [])).toBe("");
  });

  // Palavra curta sozinha não pode virar match ("DE" casaria com "CAMARA DE...").
  it("palavra curta nao dispara sugestao", () => {
    expect(sugerirContrato("DE", CONTRATOS)).toBe("");
  });
});

// O campo "Município de origem" guarda, na prática, descrição de posto —
// "UFRGS - JARDINAGEM CAMPUS SAUDE TRI". Achar o contrato certo aqui é achar a
// ÚNICA linha da UFRGS cujo nome inteiro aparece nesse texto.
describe("sugerirContrato — municipio que na verdade descreve o posto", () => {
  it("acha a linha certa entre as 10 da UFRGS", () => {
    expect(sugerirContrato("UFRGS - JARDINAGEM CAMPUS SAUDE TRI", CONTRATOS))
      .toBe("UFRGS - JARDINAGEM - 062/2025");
  });

  it("nao confunde com a outra jardinagem, que e de outro cliente", () => {
    // FURG também tem jardinagem: quem decide é o UFRGS junto.
    expect(sugerirContrato("FURG JARDINAGEM PREDIO 3", CONTRATOS))
      .toBe("FURG JARDINAGEM  - 049/2022");
  });

  it("distingue LIMPEZA de LIMPEZA GERAL na mesma instituicao", () => {
    expect(sugerirContrato("UFRGS LIMPEZA GERAL BLOCO B", CONTRATOS))
      .toBe("UFRGS - LIMPEZA GERAL - 047/2022");
  });

  // Texto que só diz a instituição não escolhe entre 10 contratos: melhor
  // deixar em branco para a pessoa decidir do que chutar.
  it("texto ambiguo demais nao sugere nada", () => {
    expect(sugerirContrato("UFRGS - CAMPUS SAUDE 5D TRI", CONTRATOS)).toBe("");
  });
});

// Caminho inverso: escolhido o contrato, o Município de origem é a cidade DELE.
// A CONTRATOS não tem coluna de cidade, então ela sai do nome do contrato.
//
// `noInicio` é o que separa preencher sozinho de só sugerir: nomes reais da
// base, tirados dos 57 contratos ativos.
describe("cidadeDoContrato", () => {
  it("cidade que abre o nome do contrato preenche sozinha", () => {
    for (const [contrato, cidade] of [
      ["CAXIAS DO SUL - 2026/95", "Caxias do Sul"],
      ["BENTO GONÇALVES LIMPEZA - 048/2026", "Bento Gonçalves"],
      ["CHARQUEADAS - 249 /2020", "Charqueadas"],
      ["GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026", "Guaporé"],
      ["TRIUNFO OP. MÁQUINA - 19.2026", "Triunfo"],
      ["PENHA LIMPEZA - 039/2025", "Penha"],
    ] as const) {
      expect(cidadeDoContrato(contrato)).toEqual({ cidade, noInicio: true });
    }
  });

  // O nome mais longo ganha: "SALTO" e "VERANO" sozinhos dariam outra coisa.
  it("pega o trecho mais longo, e acento/caixa nao atrapalham", () => {
    expect(cidadeDoContrato("SALTO DO JACUI - 722/2021")).toEqual({ cidade: "Salto do Jacuí", noInicio: true });
    expect(cidadeDoContrato("VERANOPOLIS   -  001/2021")).toEqual({ cidade: "Veranópolis", noInicio: true });
  });

  // Casou no meio do nome: continua valendo, mas só como sugestão de um clique.
  it("cidade no meio do nome nao preenche sozinha", () => {
    expect(cidadeDoContrato("UFFS CHAPECO - 041/2021")).toEqual({ cidade: "Chapecó", noInicio: false });
    expect(cidadeDoContrato("HUSM SANTA MARIA - LAVANDERIA   -  020/2021")).toEqual({ cidade: "Santa Maria", noInicio: false });
    expect(cidadeDoContrato("CAMARA DE RIO GRANDE - LIMPEZA 001/2023")).toEqual({ cidade: "Rio Grande", noInicio: false });
  });

  // O falso positivo que a regra do `noInicio` existe para conter: "Saúde" é
  // município de SC e apareceria em "AUXILIAR DE SAÚDE BUCAL". Preenchido
  // sozinho viraria erro silencioso; como sugestão, é só um botão ignorado.
  it("palavra comum que por acaso e municipio nunca preenche sozinha", () => {
    expect(cidadeDoContrato("UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021")).toEqual({ cidade: "Saúde", noInicio: false });
  });

  it("contrato sem cidade no nome fica em branco", () => {
    for (const c of ["UFRGS - JARDINAGEM - 062/2025", "SEMAE - 3038/2020", "HCPA - MENSAGEIROS - 1249781/2024", "TJRS - 023/2025", ""]) {
      expect(cidadeDoContrato(c).cidade).toBe("");
    }
  });

  // Nomes de 3 letras ("Ipê", "Iuiú") ficam fora do índice: casariam com
  // qualquer sigla solta no nome do contrato.
  it("nome curto demais nao entra no indice", () => {
    expect(cidadeDoContrato("LIMPEZA IPE - 001/2020").cidade).toBe("");
  });
});
