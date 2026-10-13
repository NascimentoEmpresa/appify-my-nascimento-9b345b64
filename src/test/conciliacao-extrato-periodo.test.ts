import { describe, expect, it } from "vitest";
import { parseOFX, transacoesNoPeriodo } from "@/lib/conciliacaoBancariaEngine";

// SIS-2026-0637: o OFX "de janeiro" do Bradesco, exportado em 04/02, traz 02/02 e 03/02.
const ofx = (...itens: [string, string, string][]) =>
  `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n` +
  itens
    .map(([dt, valor, memo], i) => `<STMTTRN>\n<TRNTYPE>${valor.startsWith("-") ? "DEBIT" : "CREDIT"}\n<DTPOSTED>${dt}120000\n<TRNAMT>${valor}\n<FITID>N${i}\n<MEMO>${memo}\n</STMTTRN>\n`)
    .join("") +
  `</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("conciliação: extrato recortado pelo período", () => {
  const trns = parseOFX(
    ofx(["20260109", "75000,00", "PIX"], ["20260122", "-9,80", "TARIFA"], ["20260202", "-411,48", "ENCARGOS"], ["20260203", "-450,07", "ENCARGOS"]),
    "bradesco.ofx",
  );

  it("o parser lê todos os dias do arquivo", () => {
    expect(trns.map((t) => t.dia)).toEqual(["2026-01-09", "2026-01-22", "2026-02-02", "2026-02-03"]);
  });

  it("deixa de fora o que passa do período e conta quantos foram", () => {
    const r = transacoesNoPeriodo(trns, "2026-01-01", "2026-01-31");
    expect(r.dentro.map((t) => t.dia)).toEqual(["2026-01-09", "2026-01-22"]);
    expect(r.fora).toBe(2);
  });

  it("inclui os dias de início e de fim do período", () => {
    const r = transacoesNoPeriodo(trns, "2026-01-09", "2026-02-02");
    expect(r.dentro).toHaveLength(3);
    expect(r.fora).toBe(1);
  });
});
