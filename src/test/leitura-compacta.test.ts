// 04/11/2026: fluxo_caixa_ler_fonte_compacta (mig 20261104000100) manda as
// mesmas linhas do Fluxo de Caixa em formato colunar com dicionário. A
// equivalência com o formato antigo foi provada na produção
// (infra/qa/conferir-leitura-compacta.mjs); aqui fica travado o decodificador.
import { describe, expect, it } from "vitest";
import { decodificarCompacto, ehLeituraCompacta } from "@/lib/leituraCompacta";

const compacto = {
  v: 1 as const,
  cols: ["despesa_id", "empresa_nome", "valor", "tipo", "contrato_id", "ajustado"],
  dic: { empresa_nome: ["AGPS", "HAGG"], tipo: ["entrada", "saida"], contrato_id: ["c-1"] },
  linhas: [
    ["d1", 1, 1520.5, 1, 0, false],
    ["d2", 0, -10, 0, null, true],
  ],
};

describe("leitura compacta do Fluxo de Caixa", () => {
  it("remonta os mesmos objetos, com todas as chaves", () => {
    expect(decodificarCompacto(compacto)).toEqual([
      { despesa_id: "d1", empresa_nome: "HAGG", valor: 1520.5, tipo: "saida", contrato_id: "c-1", ajustado: false },
      { despesa_id: "d2", empresa_nome: "AGPS", valor: -10, tipo: "entrada", contrato_id: null, ajustado: true },
    ]);
  });

  it("null de coluna de dicionário continua null (não vira o item 0)", () => {
    expect(decodificarCompacto(compacto)[1].contrato_id).toBeNull();
  });

  it("coluna crua (número/booleano) passa intacta, inclusive zero e false", () => {
    const r = decodificarCompacto({ v: 1, cols: ["valor", "ok"], dic: {}, linhas: [[0, false]] });
    expect(r).toEqual([{ valor: 0, ok: false }]);
  });

  it("reconhece o formato e rejeita o antigo (array de objetos)", () => {
    expect(ehLeituraCompacta(compacto)).toBe(true);
    expect(ehLeituraCompacta([{ despesa_id: "d1" }])).toBe(false);
    expect(ehLeituraCompacta(null)).toBe(false);
  });

  it("lista vazia", () => {
    expect(decodificarCompacto({ v: 1, cols: ["a"], dic: { a: [] }, linhas: [] })).toEqual([]);
  });
});

describe("leitura compacta — mais de 100 colunas (planilha_custo)", () => {
  it("emenda os pedaços na ordem das colunas", () => {
    const cols = Array.from({ length: 120 }, (_, i) => `c${i}`);
    const valores = cols.map((_, i) => i);
    const r = decodificarCompacto({ v: 1, partes: true, cols, dic: {}, linhas: [[valores.slice(0, 100), valores.slice(100)]] });
    expect(Object.keys(r[0])).toHaveLength(120);
    expect(r[0].c0).toBe(0);
    expect(r[0].c99).toBe(99);
    expect(r[0].c100).toBe(100);
    expect(r[0].c119).toBe(119);
  });
});
