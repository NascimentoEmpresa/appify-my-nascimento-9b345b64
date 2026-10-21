import { describe, expect, it } from "vitest";
import {
  contratoPeloNomeArquivo, extrairLinhasDoPdf, extrairLinhasRelacaoEventos, identificarLayoutPdf, totalDoPdf,
  totalRelacaoEventos, valorDoBoleto, type ContratoRef,
} from "@/lib/rh/rateioDespesas";

// =====================================================================
// RH › Rateio de Despesas — PDFs que não traziam CPF (21/10/2026).
// Os três arquivos reais de 12/2025 que "não rateavam":
//   · SOMA FINANCEIRA (empréstimo consignado): boleto + Relação de Eventos
//     da Senior por MATRÍCULA, sem CPF;
//   · MENSALIDADE SINDICAL (SINDILIMP Caxias): só o boleto de R$ 90,00 — o
//     contrato está no nome do arquivo;
//   · BSF da SAMU: PDF escaneado (sem texto) — idem, nome do arquivo.
// Fixtures com o MESMO layout das linhas que o pdf.js monta (montarLinhas),
// nomes e matrículas trocados.
// =====================================================================

const SOMA = [
  "Valor  Vencimento",
  "R$ 301,45  10/01/2026",
  "Beneficiário",
  "Soma Financeira",
  "CNPJ 35.485.106/0001-07",
  "Uso do Banco  Carteira  Espécie Moeda  Quantidade Moeda  (x) Valor  (=) Valor do Documento",
  "01  R$  301,45",
  "(-) Desconto",
  "(=) Valor Cobrado",
  "Pagador  Hagg Prestação De Serviços - CNPJ 03.644.009/0001-23",
  "Data de emissão: 19/12/2025",
  "0001 - NASCIMENTO SERVICOS DE LIMPEZA LTDA  Pág.:  1",
  "Relação de Eventos",
  "Período:  12/2025 a 12/2025  Tipo:",
  "Evento  Colaborador  SIT  Competência  Pagamento  Referência  Valor",
  "3622 - Emprestimo Consignado",
  "000001111 FULANA DE TAL  001  12/2025  07/01/2026  0,00  125,81",
  "000002222 BELTRANO MENDONÇA DA SILVA  002  12/2025  07/01/2026  0,00  58,24",
  "000003333 CICRANA SOUZA  001  12/2025  07/01/2026  0,00  117,40",
  "Total de Colaboradores:  3  0,00  301,45",
  "FPRF004.OPE - 23/12/2025 - 14:41:29  NASCIMENTO SERVICOS DE LIMPEZA LTDA",
];

const SINDICAL = [
  "Esse é o seu boleto",
  "Nascimento Servicos de Limpeza Ltda - 943",
  "Valor  Vencimento",
  "R$ 90,00  10/01/2026",
  "SINDILIMP",
  "Descrição  55469.928174 1",
  "MENSALIDADE SOCIAL REFERENTE DEZEMBRO DE  13220000009000",
  "Antes do vencimento",
  "R$ 90,00",
  "Uso do banco  Carteira  Espécie  Quantidade  Valor  Valor do documento",
  "17  R$  R$ 90,00",
  "Instruções (Texto de responsabilidade do beneficiário)  Desconto/Abatimento",
  "Juros/Multa",
  "R$ 0,00",
  "Valor Cobrado",
  "R$ 90,00",
];

const CONTRATOS: ContratoRef[] = [
  { id: "cx-velho", nome: "CAXIAS DO SUL  -2025/162", status: "encerrado" },
  { id: "cx", nome: "CAXIAS DO SUL - 2026/95", status: "ativo" },
  { id: "samu-pe", nome: "SAMU PE - 62/2024", status: "encerrado" },
  { id: "samu-tel", nome: "SAMU TELEFONISTAS - 96397/2025", status: "ativo" },
  { id: "ufrgs", nome: "UFRGS - LIMPEZA GERAL - 047/2022", status: "ativo" },
  { id: "ufrgs-lib", nome: "UFRGS INTERPRETE DE LIBRAS C. 009.2026", status: "ativo" },
  { id: "bento", nome: "BENTO GONÇALVES - AUX ADM - 002/2021", status: "ativo" },
  { id: "bento-limp", nome: "BENTO GONÇALVES LIMPEZA - 048/2026", status: "ativo" },
];

describe("Relação de Eventos sem CPF (consignado da Soma Financeira)", () => {
  it("reconhece o layout e lê matrícula, empresa, nome e valor", () => {
    expect(identificarLayoutPdf(SOMA).layout).toBe("relacao_eventos");
    const ls = extrairLinhasRelacaoEventos(SOMA);
    expect(ls.map((l) => [l.cadastro, l.empresa, l.nomePdf, l.valor])).toEqual([
      ["1111", 1, "FULANA DE TAL", 125.81],
      ["2222", 1, "BELTRANO MENDONÇA DA SILVA", 58.24],
      ["3333", 1, "CICRANA SOUZA", 117.4],
    ]);
    expect(ls.every((l) => l.cpf === null)).toBe(true);
    // A tela usa extrairLinhasDoPdf — tem de dar o mesmo.
    expect(extrairLinhasDoPdf(SOMA, "relacao_eventos")).toHaveLength(3);
  });

  it("o total é o 'Total de Colaboradores' (aqui ele É a despesa) e bate com o boleto", () => {
    expect(totalRelacaoEventos(SOMA)).toBe(301.45);
    expect(totalDoPdf(SOMA, "relacao_eventos")).toBe(301.45);
    expect(valorDoBoleto(SOMA)).toBe(301.45);
  });

  it("não lê o cabeçalho do evento nem o rodapé como colaborador", () => {
    const ls = extrairLinhasRelacaoEventos(SOMA);
    expect(ls.some((l) => /3622|FPRF/.test(l.texto))).toBe(false);
  });

  it("antes do 'Relação de Eventos' nada conta (o boleto não vira linha)", () => {
    expect(extrairLinhasRelacaoEventos(SOMA.slice(0, 11))).toEqual([]);
  });

  it("PDF com CPF continua na leitura genérica", () => {
    const comCpf = [...SOMA, "FULANO  529.982.247-25  10,00"];
    expect(identificarLayoutPdf(comCpf).layout).toBe("generico");
  });

  it("empresa de cada página vem do próprio cabeçalho", () => {
    const duas = [...SOMA, "0005 - HAGG PRESTACAO DE SERVICOS  Pág.:  2", "Relação de Eventos",
      "000004444 OUTRA PESSOA  001  12/2025  07/01/2026  0,00  10,00", "Total de Colaboradores:  1  0,00  10,00"];
    const ls = extrairLinhasRelacaoEventos(duas);
    expect(ls.at(-1)).toMatchObject({ cadastro: "4444", empresa: 5 });
    expect(totalRelacaoEventos(duas)).toBe(311.45);
  });
});

describe("boleto sem lista (mensalidade do sindicato)", () => {
  it("o valor sai do boleto ('Valor Cobrado' na linha de baixo)", () => {
    expect(valorDoBoleto(SINDICAL)).toBe(90);
    expect(identificarLayoutPdf(SINDICAL).layout).toBe("generico");
    expect(totalDoPdf(SINDICAL, "generico")).toBe(90);
    expect(extrairLinhasDoPdf(SINDICAL, "generico")).toEqual([]);
  });

  it("'Valor cobrado' ganha do documento quando há desconto", () => {
    expect(valorDoBoleto(["(=) Valor do documento  25.767,61", "(-) Desconto/Abatimento  6.321,74", "(=) Valor cobrado  19.445,87"])).toBe(19445.87);
  });

  it("sem boleto, null", () => {
    expect(valorDoBoleto(["nada aqui 10,00"])).toBeNull();
  });
});

describe("contrato pelo nome do arquivo", () => {
  it("sindicato de Caxias → o contrato ativo de Caxias ('2020.1003' não é contrato)", () => {
    expect(contratoPeloNomeArquivo("MENSALIDADE SINDICAL 12.2025 - SINDLIMP - CAXIAS DO SUL - 2020.1003.pdf", CONTRATOS)?.id).toBe("cx");
  });

  it("BSF da SAMU → o único SAMU ativo", () => {
    expect(contratoPeloNomeArquivo("BENEFICIO SOCIAL FAMILIAR  MES 12.2025 - SAMU 192.2024.pdf", CONTRATOS)?.id).toBe("samu-tel");
  });

  it("número do contrato no nome manda (e a competência não vira contrato)", () => {
    expect(contratoPeloNomeArquivo("BSF 12.2025 - UFRGS 047.2022.pdf", CONTRATOS)?.id).toBe("ufrgs");
    // "12.2025" é a competência — não pode casar com nada.
    expect(contratoPeloNomeArquivo("SEGURO 12.2025.pdf", CONTRATOS)).toBeNull();
    // Número de 3 dígitos ("009.2026") é de contrato, não competência.
    expect(contratoPeloNomeArquivo("BSF - LIBRAS 009.2026.pdf", CONTRATOS)?.id).toBe("ufrgs-lib");
  });

  it("na dúvida, null (a pessoa escolhe)", () => {
    // Dois ativos começam com BENTO.
    expect(contratoPeloNomeArquivo("MENSALIDADE 12.2025 - BENTO.pdf", CONTRATOS)).toBeNull();
    // Com a palavra que desempata, acha.
    expect(contratoPeloNomeArquivo("MENSALIDADE 12.2025 - BENTO LIMPEZA.pdf", CONTRATOS)?.id).toBe("bento-limp");
    expect(contratoPeloNomeArquivo("SOMA FINANCEIRA 12.2025 -EMPRESTIMO CONSIGNADO-HAGG.PDF", CONTRATOS)).toBeNull();
    expect(contratoPeloNomeArquivo("", CONTRATOS)).toBeNull();
  });
});
