import { describe, expect, it } from "vitest";
import { empresaQueMaisLeva, linhasDoRateioParaMalote, percentuaisQueFecham } from "@/lib/rh/rateioParaMalote";

const unidades = (pcts: number[]) => pcts.reduce((a, p) => a + Math.round(p * 10000), 0);
const cents = (vals: number[]) => vals.reduce((a, v) => a + Math.round(v * 100), 0);

// Valores do print do Pablo (Rateio por contrato, 19/10/2026) — parte dos 42.
const VALORES = [
  4103.06, 2549.04, 2504.32, 1878.24, 1486.94, 1017.38, 816.14, 715.52, 670.8, 659.62, 637.26, 626.06, 547.82,
  514.28, 503.1, 441.61, 424.84, 413.66, 391.28, 380.12, 352.17, 335.38, 307.45, 301.86, 290.68, 279.5, 257.14,
  245.96, 201.24, 201.24, 178.88,
];

describe("percentuaisQueFecham", () => {
  it("soma exatamente 100% com muitos contratos", () => {
    const p = percentuaisQueFecham(VALORES);
    expect(unidades(p)).toBe(1_000_000);
    p.forEach((x) => expect(Number(x.toFixed(4))).toBe(x)); // no máximo 4 casas
  });
  it("três partes iguais: o resto vai para uma linha só", () => {
    expect(percentuaisQueFecham([10, 10, 10])).toEqual([33.3334, 33.3333, 33.3333]);
  });
  it("proporcional ao valor", () => {
    expect(percentuaisQueFecham([75, 25])).toEqual([75, 25]);
  });
  it("tudo zero não inventa percentual", () => {
    expect(percentuaisQueFecham([0, 0])).toEqual([0, 0]);
  });
});

describe("linhasDoRateioParaMalote", () => {
  const empresaDoContrato = new Map([
    ["c1", "emp-A"],
    ["c2", "emp-B"],
  ]);

  it("empresa vem do contrato; sem contrato ou contrato desconhecido vai para a pagadora", () => {
    const l = linhasDoRateioParaMalote(
      [
        { contrato_id: "c1", valor: 60 },
        { contrato_id: "c2", valor: 30 },
        { contrato_id: null, valor: 6 },
        { contrato_id: "fora-do-malote", valor: 4 },
      ],
      { empresaDoContrato, empresaPadrao: "emp-PAG", fornecedorId: "forn-1" },
    );
    expect(l.map((x) => [x.empresa_id, x.contrato_id])).toEqual([
      ["emp-A", "c1"],
      ["emp-B", "c2"],
      ["emp-PAG", null],
      ["emp-PAG", null],
    ]);
    expect(l.every((x) => x.fornecedor_id === "forn-1")).toBe(true);
    expect(l.map((x) => x.percentual)).toEqual([60, 30, 6, 4]);
    expect(l.map((x) => x.ordem)).toEqual([0, 1, 2, 3]);
  });

  it("linha zerada fica de fora e o total em centavos fecha com a despesa", () => {
    const itens = [...VALORES.map((valor, k) => ({ contrato_id: k % 2 ? "c1" : "c2", valor })), { contrato_id: "c1", valor: 0 }];
    const total = cents(VALORES);
    const l = linhasDoRateioParaMalote(itens, { empresaDoContrato, empresaPadrao: null, fornecedorId: null });
    expect(l).toHaveLength(VALORES.length);
    expect(cents(l.map((x) => x.valor))).toBe(total);
    expect(unidades(l.map((x) => x.percentual ?? 0))).toBe(1_000_000);
    expect(l.every((x) => x.fornecedor_id === null)).toBe(true);
  });

  it("valor com resíduo de ponto flutuante vira centavo limpo", () => {
    const [l] = linhasDoRateioParaMalote([{ contrato_id: "c1", valor: 0.1 + 0.2 }], {
      empresaDoContrato, empresaPadrao: null, fornecedorId: null,
    });
    expect(l.valor).toBe(0.3);
    expect(l.percentual).toBe(100);
  });
});

describe("empresaQueMaisLeva", () => {
  it("sugere a empresa com mais valor somado", () => {
    const m = new Map([["c1", "A"], ["c2", "B"], ["c3", "B"]]);
    expect(empresaQueMaisLeva([{ contrato_id: "c1", valor: 50 }, { contrato_id: "c2", valor: 30 }, { contrato_id: "c3", valor: 30 }], m)).toBe("B");
    expect(empresaQueMaisLeva([{ contrato_id: null, valor: 10 }], m)).toBeNull();
  });
});
