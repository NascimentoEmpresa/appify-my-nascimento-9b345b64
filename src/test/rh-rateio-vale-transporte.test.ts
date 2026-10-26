import { describe, expect, it } from "vitest";
import {
  extrairLinhasDoPdf, extrairLinhasValeTransporte, identificarLayoutPdf, layoutPorMatricula, rotuloTipo, totalDoPdf,
  totalValeTransporte, TIPOS_RATEIO,
} from "@/lib/rh/rateioDespesas";

// =====================================================================
// RH › Rateio de Despesas — VALE TRANSPORTE (26/10/2026).
// PDF real "VT 11.2026 POLICIA-SMS-SAMU-TJ-UFRGS- TEU.pdf": boleto da TEU
// (Total 22.508,30) + relatórios "Período Vale Transporte" da Senior
// (BSVT001), uma linha por MATRÍCULA, sem CPF e sem contrato. Fixture com o
// mesmo layout das linhas que o pdf.js monta (montarLinhas) — o nome vem
// colado no código da escala —, nomes e matrículas trocados.
// =====================================================================

const VT = [
  "ASSOC. EMP. DO SBE - RMPA",
  "Código Descrição do serviço  Quantidade  Valor",
  "(+)  Pedido de Carga: 46314  1  1.000,00",
  "(-)  Desconto sobre cargas não realizadas  1  100,00",
  "Total:  904,80",
  "Ressarcimento do Custo de Processamento e Transmissão incluso: R$4,80",
  "(=) Valor do Documento",
  "Beneficiário ASSOC. EMP. DO SBE - RMPA - CPF/CNPJ: 09.339.153/0001-32 - LARGO VISCONDE DO",
  "CAIRÚ 2º ANDAR 12 - CENTRO - PORTO ALEGRE - RS - 90.030-110  904,80",
  "0001 - NASCIMENTO SERVICOS DE LIMPEZA LTDA  Pág.:  1",
  "Período Vale Transporte",
  "Apuração: 01/11/2026 a 30/11/2026  Faltas: 01/09/2026 a 30/09/2026  Desconto Apuração: Afast. + Prog. Férias",
  "-- Faltas --  --- Passe ---",
  "Cadastro Nome  Esc. Linha  Meio  Tipo  Mult. Qtd.  Total Qtd. Unitário Valor Mult.  Saldo Desc.  Valor Total",
  "000010001 FULANA DE TAL DA SILVA00004  2  TEU - LINHA ÚNICAÔnibus  Único  01  0  0,00  76  5,30  402,80  0,00  402,80",
  "000009002 BELTRANO SOUZA 00003  2  TEU - LINHA ÚNICAÔnibus  Único  01  2  10,60  28  5,30  148,40  0,00  148,40",
  "Total Em pres a  2  10,60 104  551,20  0,00  551,20",
  "Linha  Qtd. Colab.  Qtd. Pass es  Valor  Saldo Desc.  Valor Total",
  "2 - TEU - LINHA  2  104  551,20  0,00  551,20",
  "ÚNICA",
  "BSVT001.COL - 14/10/2026 - 08:41:45  NASCIMENTO SERVICOS DE LIMPEZA LTDA  Usuário: rh",
  "0001 - NASCIMENTO SERVICOS DE LIMPEZA LTDA  Pág.:  1",
  "Período Vale Transporte",
  "Cadastro Nome  Esc. Linha  Meio  Tipo  Mult. Qtd.  Total Qtd. Unitário Valor Mult.  Saldo Desc.  Valor Total",
  "000004003 CICRANA GOMES 00157  157 TEU ALVORADA - R$9,45Ônibus  Único  01  0  0,00  38  9,45  359,10  0,00  359,10",
  "Total Em pres a  0  0,00  38  359,10  0,00  359,10",
  "BSVT001.COL - 13/10/2026 - 16:02:21  NASCIMENTO SERVICOS DE LIMPEZA LTDA  Usuário: rh",
];

describe("rateio de Vale Transporte (BSVT001 da Senior)", () => {
  it("é um tipo de rateio pelo PDF", () => {
    expect(TIPOS_RATEIO.find((t) => t.tipo === "vale_transporte")).toMatchObject({ criterio: "pdf" });
    expect(rotuloTipo("vale_transporte")).toBe("Vale Transporte");
  });

  it("reconhece o layout e lê por matrícula, como a Relação de Eventos", () => {
    const l = identificarLayoutPdf(VT);
    expect(l.layout).toBe("vale_transporte");
    expect(layoutPorMatricula(l.layout)).toBe(true);
    expect(layoutPorMatricula("relacao_eventos")).toBe(true);
    expect(layoutPorMatricula("generico")).toBe(false);
  });

  it("uma linha por colaborador: matrícula, empresa, nome sem o código da escala e o Valor Total", () => {
    const ls = extrairLinhasValeTransporte(VT);
    expect(ls.map((x) => [x.cadastro, x.empresa, x.nomePdf, x.valor])).toEqual([
      ["10001", 1, "FULANA DE TAL DA SILVA", 402.8],
      ["9002", 1, "BELTRANO SOUZA", 148.4],
      ["4003", 1, "CICRANA GOMES", 359.1],
    ]);
    expect(extrairLinhasDoPdf(VT, "vale_transporte")).toHaveLength(3);
  });

  it("o valor é o Total do boleto (com desconto e taxa), não um Total Empresa", () => {
    expect(totalDoPdf(VT, "vale_transporte")).toBe(904.8);
    // Só os relatórios (sem o boleto): soma dos Total Empresa.
    expect(totalValeTransporte(VT.slice(9))).toBe(910.3);
  });
});
