import { describe, expect, it } from "vitest";
import {
  extrairLinhasBsfListagem, extrairLinhasDoPdf, faixasBsf, identificarLayoutPdf, qtdEsperadaBsf, totalBsfListagem, totalDoPdf,
} from "@/lib/rh/rateioDespesas";

// =====================================================================
// RH › Rateio de Despesas — BSF com listagem de trabalhadores (09/11/2026).
// Mesmo layout das linhas do OCR do PDF real de 10/2026 (inclusive os erros
// que o OCR comete), com nomes, CPFs e quantidades fictícios.
// =====================================================================

const BSF = [
  "Empregador: EMPRESA FICTICIA LTDA",
  "CNPJ/CPF: 11.222.333/0001-81      Data Impressão: 09/11/2026 11:45",
  "(=) Valor cobrado",
  "127,60",
  "LISTAGEM DE TRABALHADORES COM DIREITO AO BENEFÍCIO SOCIAL FAMILIAR",
  "Item  CPF   Nome    Situação   Item  CPF   Nome    Situação",
  "1 — 529.982.247-25    FULANA DE TAL           Normal      2 — 111.444.777-35    BELTRANO SOUZA     Normal",
  "3 — 123456.789-09     CICRANA DA SILVA        Normal      4 — B29.982.247-25    OUTRO NOME         Normal",
  "5 — 987]654.321-00    ULTIMA PESSOA           Normal      Continua..",
  "6 — 714.602.380-01    AFASTADA ANTIGA         Afastado+12m  Fim da listagem de TRABALHADORES, total de 5 TRABALHADORES.",
  "Total de 4 TRABALHADORES NORMAIS x R$25,52 = R$102,08.",
  "Total de 1 TRABALHADORES AFASTADOS ATÉ 12 MESES x R$25,52 = R$25,52.",
  "Total de 1 TRABALHADORES AFASTADOS APÓS 12 MESES x R$0,00 = R$0,00.",
];

describe("BSF — listagem de trabalhadores", () => {
  it("reconhece o layout", () => {
    expect(identificarLayoutPdf(BSF).layout).toBe("bsf_listagem");
  });

  it("lê as duas colunas e dá a cada pessoa o valor da faixa", () => {
    const ls = extrairLinhasDoPdf(BSF, "bsf_listagem");
    expect(ls.map((l) => l.nomePdf)).toEqual(["FULANA DE TAL", "BELTRANO SOUZA", "CICRANA DA SILVA", "OUTRO NOME", "ULTIMA PESSOA"]);
    expect(ls.every((l) => l.valor === 25.52)).toBe(true);
  });

  it("afastado há mais de 12 meses não entra no rateio", () => {
    expect(extrairLinhasBsfListagem(BSF).some((l) => l.nomePdf === "AFASTADA ANTIGA")).toBe(false);
  });

  it("aceita CPF sem ponto e corrige letra lida no lugar de dígito", () => {
    const ls = extrairLinhasBsfListagem(BSF);
    expect(ls[2].cpf).toBe("12345678909");
    expect(ls[4].cpf).toBe("98765432100"); // "]" no lugar do ponto
    expect(ls[3].cpf).toBeNull(); // B→8 não fecha o dígito verificador: fica sem CPF…
    expect(ls[3].valor).toBe(25.52); // …mas a pessoa continua custando.
    const certo = extrairLinhasBsfListagem(BSF.map((l) => l.replace("529.982.247-25    FULANA", "B12.345.678-65    FULANA")));
    expect(certo[0].cpf).toBe("81234567865");
  });

  it("o total é a soma das faixas e fecha com a soma das pessoas", () => {
    expect(totalDoPdf(BSF, "bsf_listagem")).toBe(127.6);
    expect(extrairLinhasBsfListagem(BSF).reduce((a, l) => a + l.valor, 0)).toBeCloseTo(127.6, 2);
    expect(qtdEsperadaBsf(BSF)).toBe(5);
    expect(faixasBsf(BSF)).toHaveLength(3);
  });

  it("faixa em que qtd × unitário não fecha (OCR errou) não vira total", () => {
    expect(totalBsfListagem(BSF.map((l) => l.replace("R$102,08", "R$162,08")))).toBeNull();
  });

  it("BSF antigo, com CPF e valor na linha, continua na leitura genérica", () => {
    const antigo = ["FULANA DE TAL  529.982.247-25  25,52", "TOTAL: 25,52"];
    expect(identificarLayoutPdf(antigo).layout).toBe("generico");
    expect(extrairLinhasDoPdf(antigo, "generico")).toHaveLength(1);
    expect(totalDoPdf(antigo, "generico")).toBe(25.52);
  });

  it("listagem sem rodapé de faixas não é reconhecida (sem valor não há o que ratear)", () => {
    expect(identificarLayoutPdf(BSF.slice(0, 9)).layout).toBe("generico");
  });
});
