import { describe, it, expect } from "vitest";
import { sugerirContrato } from "@/pages/juridico/Processos";

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
