import { describe, it, expect } from "vitest";
import { parseOfxAmount, parseOFX } from "@/pages/financeiro/ConciliacaoBancaria";

// SIS-2026-0344 (achado real, usuária testando extratos do Bradesco): o
// regex antigo do parser só aceitava dígito/"-"/"." em TRNAMT — um valor
// exportado em formato BR ("0,06", "-183,60") cortava exatamente na
// vírgula, virando "0"/"-183". A usuária percebeu isso como "o sistema
// arredondando alguns valores", mas era truncamento por não reconhecer a
// vírgula, não arredondamento.
describe("parseOfxAmount", () => {
  it("converte valor em formato BR (vírgula decimal)", () => {
    expect(parseOfxAmount("0,06")).toBeCloseTo(0.06);
    expect(parseOfxAmount("-183,60")).toBeCloseTo(-183.6);
    expect(parseOfxAmount("10000,00")).toBeCloseTo(10000);
    expect(parseOfxAmount("-7191,44")).toBeCloseTo(-7191.44);
  });

  it("converte valor em formato BR com separador de milhar (ponto)", () => {
    expect(parseOfxAmount("-7.191,44")).toBeCloseTo(-7191.44);
    expect(parseOfxAmount("1.234.567,89")).toBeCloseTo(1234567.89);
  });

  it("continua aceitando o formato padrão OFX (ponto decimal, sem vírgula)", () => {
    expect(parseOfxAmount("183.60")).toBeCloseTo(183.6);
    expect(parseOfxAmount("-100")).toBeCloseTo(-100);
  });
});

describe("parseOFX", () => {
  // Amostra real do .OFX do Bradesco (conta HAGG) enviado no chamado.
  const OFX_BRADESCO = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260709120000
<TRNAMT>10000,00
<FITID>N10120
<MEMO>PIX RECEBIDO REM: NASCIMENTO SERVICOS D 09/07
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260710120000
<TRNAMT>0,28
<FITID>N10136
<MEMO>RENTAB.INVEST FACILCRED*
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260710120000
<TRNAMT>-378,58
<FITID>N1015E
<MEMO>PAGTO ELETRON  COBRANCA 070127607900316901BRADESCO ADMIN
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260710120000
<TRNAMT>-7191,44
<FITID>N101A0
<MEMO>GASTOS CARTAO DE CREDITO
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

  it("não trunca o valor na vírgula (bug real do Bradesco)", () => {
    const txns = parseOFX(OFX_BRADESCO, "bradesco-hagg");
    expect(txns).toHaveLength(4);
    expect(txns.find((t) => t.memo.includes("NASCIMENTO SERVICOS"))?.valor).toBeCloseTo(10000);
    expect(txns.find((t) => t.memo.includes("RENTAB.INVEST"))?.valor).toBeCloseTo(0.28);
    expect(txns.find((t) => t.memo.includes("070127607900316901"))?.valor).toBeCloseTo(378.58);
    expect(txns.find((t) => t.memo.includes("GASTOS CARTAO"))?.valor).toBeCloseTo(7191.44);
  });

  it("classifica ENTRADA/SAÍDA pelo sinal do valor", () => {
    const txns = parseOFX(OFX_BRADESCO, "bradesco-hagg");
    expect(txns.find((t) => t.memo.includes("NASCIMENTO SERVICOS"))?.tipo).toBe("ENTRADA");
    expect(txns.find((t) => t.memo.includes("GASTOS CARTAO"))?.tipo).toBe("SAÍDA");
  });

  // SIS-2026-0491 (Iury, correção): só o rótulo "BB Rende Fácil" em si deve
  // ser ignorado no extrato — "Aplicação BB CDB DI" e "Resgate BB CDB DI" são
  // movimentações normais e devem continuar contabilizadas na conciliação
  // (a usuária corrigiu o pedido inicial, que confundia as duas coisas).
  it("ignora só o rótulo BB Rende Fácil, mas conta Aplicação/Resgate BB CDB DI normalmente", () => {
    const OFX_BB = `
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260709120000
<TRNAMT>-5000,00
<FITID>1
<MEMO>Aplicação BB CDB DI
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260710120000
<TRNAMT>5000,00
<FITID>2
<MEMO>Resgate BB CDB DI
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260710120500
<TRNAMT>0,15
<FITID>3
<MEMO>RENDIMENTO BB RENDE FACIL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260711120000
<TRNAMT>1200,00
<FITID>4
<MEMO>PIX RECEBIDO REM: CLIENTE X
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
    const txns = parseOFX(OFX_BB, "bb-hagg");
    expect(txns).toHaveLength(3);
    expect(txns.find((t) => t.memo.includes("Aplicação"))).toBeTruthy();
    expect(txns.find((t) => t.memo.includes("Resgate"))).toBeTruthy();
    expect(txns.find((t) => t.memo.includes("PIX RECEBIDO"))).toBeTruthy();
    expect(txns.find((t) => t.memo.includes("RENDE FACIL"))).toBeUndefined();
  });
});
