import { describe, expect, it } from "vitest";
import { itensPorParte, linhasPorParteParaMalote } from "@/lib/rh/rateioParaMalote";

// Pedido do Pablo (10/11/2026, mig 20261110011200): a guia do FGTS com
// consignado vai numa despesa só no Malote, mas cada parte nas linhas com a
// SUA classificação (FGTS MENSAL × CONSIGNADO).

const porParte = new Map<string | null, { fgts?: number; consignado?: number }>([
  ["c1", { fgts: 100, consignado: 300 }],
  ["c2", { fgts: 50 }],
  [null, { consignado: 10 }],
]);
const itens = [
  { contrato_id: "c1", valor: 400 },
  { contrato_id: "c2", valor: 50 },
  { contrato_id: null, valor: 10 },
];
const opcoes = { empresaDoContrato: new Map([["c1", "E1"], ["c2", "E2"]]), empresaPadrao: "E9", fornecedorId: "F" };

describe("guia do FGTS com consignado → Malote", () => {
  it("cada contrato se divide pelas partes e fecha no centavo", () => {
    const r = itensPorParte(itens, porParte, ["fgts", "consignado"]);
    expect(r).toEqual([
      { contrato_id: "c1", valor: 100, parte: "fgts" },
      { contrato_id: "c2", valor: 50, parte: "fgts" },
      { contrato_id: "c1", valor: 300, parte: "consignado" },
      { contrato_id: null, valor: 10, parte: "consignado" },
    ]);
    expect(r.reduce((a, x) => a + x.valor, 0)).toBe(460);
  });

  it("valor ajustado à mão segue a proporção das partes", () => {
    const r = itensPorParte([{ contrato_id: "c1", valor: 200 }], porParte, ["fgts", "consignado"]);
    expect(r.map((x) => x.valor)).toEqual([50, 150]);
  });

  it("cada linha leva a classificação da sua parte e os % fecham 100", () => {
    const linhas = linhasPorParteParaMalote(
      itensPorParte(itens, porParte, ["fgts", "consignado"]),
      { fgts: "CL-FGTS", consignado: "CL-CONS" },
      opcoes,
    );
    expect(linhas.map((l) => l.classificacao_id)).toEqual(["CL-FGTS", "CL-FGTS", "CL-CONS", "CL-CONS"]);
    expect(linhas.map((l) => l.empresa_id)).toEqual(["E1", "E2", "E1", "E9"]);
    expect(Math.round(linhas.reduce((a, l) => a + (l.percentual ?? 0), 0) * 10000) / 10000).toBe(100);
  });
});
