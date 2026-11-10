import { describe, expect, it } from "vitest";
import { extrairLinhasBulllaTxt, identificarLayoutPdf, layoutPorMatricula, totalBulllaTxt } from "@/lib/rh/rateioDespesas";

// Pedido do Pablo (10/11/2026): ratear também o TXT da Bullla ("Demonstrativo
// Analítico de Compras e Anuidades"). Mesmo layout de colunas fixas dos
// arquivos reais; nomes e valores inventados.
const pad = (s: string, n: number) => s.padEnd(n);
const pessoa = (reg: string, nome: string, resto: string) => pad(reg, 12) + pad(nome, 40) + resto;
const sub = (compra: string, fat: string, desc = "0,00") =>
  `             COMPRAS :  ${compra}          OUTROS DEBITOS :         0,00          DESCONTOS        ${desc}                      ${compra}         ${fat}  `;

const arquivo = (cliente: string, nomeEmpresa: string, corpo: string[], rodape: string) => [
  "-----------------------------------------------------------------------",
  "BULLLA              DEMONSTRATIVO ANALITICO DE COMPRAS E ANUIDADES         Data :    21/10/2026 02:42:33",
  "-----------------------------------------------------------------------",
  `Cliente : ${cliente}          ${nomeEmpresa}                     Filial :  0000`,
  "Registro    Funcionario                             Lancamento Parcela Tipo de Ocorrencia                        Data  Valor Compra Valor Faturado",
  ...corpo,
  "---------------------------------------------------------------------------------------------------------------------------------------------------",
  rodape,
];

const nh = arquivo("606251", "NH PRESTACAO DE SERVICOS LTDA", [
  pessoa("164", "FULANA DE TAL", "  77700459 001/001 SAQUE FACIL DOC                     03/09/2026        300,00         300,00 "),
  sub("300,00", "300,00"),
  pessoa("238", "BELTRANO SEM CORTE", "    575325 001/001 MASTERCARD NACIONAL                 24/09/2026         58,00           0,00 "),
  sub("58,00", "0,00"),
], "COMPRAS :         358,00  OUTROS DEBITOS            0,00  DESCONTOS :           0,00        TOTAL          358,00     TOTAL FATURAD         300,00    ");

const sn = arquivo("606250", "SN SERVICOS DE LIMPEZA E ZELADORIA PREDI", [
  pessoa("2374", "CICLANO ANTECIPADO", "Desconto por Antecipação                               21/10/2026     -1.000,00      -1.000,00 "),
  "                                                      91500246 002/022 SAQUE FACIL DOC                     25/06/2026      1.248,44       1.248,44 ",
  sub("1.248,44", "248,44", "1.000,00"),
], "COMPRAS :       1.248,44  OUTROS DEBITOS            0,00  DESCONTOS :       1.000,00        TOTAL          248,44     TOTAL FATURAD         248,44    ");

describe("Bullla — Demonstrativo Analítico em TXT", () => {
  it("reconhece o layout e vai pelo caminho da matrícula", () => {
    const l = identificarLayoutPdf(nh).layout;
    expect(l).toBe("bullla_txt");
    expect(layoutPorMatricula(l)).toBe(true);
  });

  it("uma linha por colaborador com o VALOR FATURADO; faturado zero fica de fora", () => {
    expect(extrairLinhasBulllaTxt(nh).map((x) => [x.cadastro, x.nomePdf, x.empresa, x.valor])).toEqual([
      ["164", "FULANA DE TAL", 5, 300],
    ]);
  });

  it("desconto por antecipação já vem no faturado; a empresa sai do Cliente", () => {
    expect(extrairLinhasBulllaTxt(sn).map((x) => [x.cadastro, x.empresa, x.valor])).toEqual([["2374", 2, 248.44]]);
  });

  it("os TXT juntos: cada bloco com a sua empresa, total = soma dos TOTAL FATURAD", () => {
    const juntos = [...nh, ...sn];
    expect(extrairLinhasBulllaTxt(juntos).map((x) => x.empresa)).toEqual([5, 2]);
    expect(totalBulllaTxt(juntos)).toBe(548.44);
  });
});
