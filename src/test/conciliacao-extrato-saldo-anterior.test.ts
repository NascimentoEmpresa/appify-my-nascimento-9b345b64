import { describe, expect, it } from "vitest";
import { parseOFX } from "@/lib/conciliacaoBancariaEngine";

// SIS-2026-0604: a linha "SALDO ANTERIOR" do extrato não é movimento.
const ofx = (...linhas: [string, string, string][]) =>
  linhas
    .map(([dt, valor, memo]) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${dt}<TRNAMT>${valor}<MEMO>${memo}</STMTTRN>`)
    .join("\n");

describe("parseOFX — SALDO ANTERIOR do extrato", () => {
  it("ignora a linha de saldo anterior e mantém os movimentos", () => {
    const t = parseOFX(
      ofx(
        ["20261001", "15000.00", "SALDO ANTERIOR"],
        ["20261001", "-250.00", "PIX ENVIADO FORNECEDOR"],
        ["20261002", "1000.00", "Saldo Anterior"],
        ["20261002", "300.00", "PIX RECEBIDO"]
      ),
      "teste.ofx"
    );
    expect(t.map((x) => x.memo)).toEqual(["PIX ENVIADO FORNECEDOR", "PIX RECEBIDO"]);
  });

  it("variação abreviada também sai, e outros memos com 'saldo' continuam", () => {
    const t = parseOFX(ofx(["20261001", "10.00", "SDO ANTERIOR"], ["20261001", "20.00", "SALDO APLICACAO AUTOMATICA"]), "x.ofx");
    expect(t.map((x) => x.memo)).toEqual(["SALDO APLICACAO AUTOMATICA"]);
  });

  it("continua ignorando o rótulo do BB Rende Fácil", () => {
    expect(parseOFX(ofx(["20261001", "5.00", "BB RENDE FACIL"]), "x.ofx")).toHaveLength(0);
  });
});
