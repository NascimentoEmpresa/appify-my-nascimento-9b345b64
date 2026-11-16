import { describe, expect, it } from "vitest";
import { diferencaDoRateio, mostrarResumoPorClassificacao, totaisPorClassificacao } from "@/pages/malote/rateioPorClassificacao";

// SIS-2026-0900: total do rateio por classificação (boleto de FGTS + consignado do RH: uma despesa, várias empresas, duas classificações).
const L = (empresa_id: string | null, valor: number, classificacao_id?: string | null) => ({ empresa_id, valor, classificacao_id });

describe("totais do rateio por classificação", () => {
  const linhas = [L("hagg", 1000, "fgts"), L("sn", 500, "fgts"), L("hagg", 300, "consignado"), L("sn", 200.5, "consignado"), L("hagg", 100, "fgts")];

  it("soma cada classificação, com % e quantidade de linhas, na ordem em que aparecem no rateio", () => {
    const r = totaisPorClassificacao(linhas, null);
    expect(r.total).toBe(2100.5);
    expect(r.grupos.map((g) => g.classificacaoId)).toEqual(["fgts", "consignado"]);
    expect(r.grupos[0]).toMatchObject({ valor: 1600, linhas: 3, percentual: 76.17 });
    expect(r.grupos[1]).toMatchObject({ valor: 500.5, linhas: 2, percentual: 23.83 });
  });

  it("subtotal por empresa dentro de cada classificação (maior valor primeiro; a mesma empresa em duas linhas soma)", () => {
    const [fgts, consignado] = totaisPorClassificacao(linhas, null).grupos;
    expect(fgts.porEmpresa).toEqual([{ empresaId: "hagg", valor: 1100, linhas: 2 }, { empresaId: "sn", valor: 500, linhas: 1 }]);
    expect(consignado.porEmpresa).toEqual([{ empresaId: "hagg", valor: 300, linhas: 1 }, { empresaId: "sn", valor: 200.5, linhas: 1 }]);
  });

  it("linha sem classificação própria vale a da despesa", () => {
    const r = totaisPorClassificacao([L("a", 100), L("b", 50, "consignado"), L("c", 25, null)], "fgts");
    expect(r.grupos.find((g) => g.classificacaoId === "fgts")).toMatchObject({ valor: 125, linhas: 2 });
    expect(r.grupos.find((g) => g.classificacaoId === "consignado")?.valor).toBe(50);
  });

  it("sem nenhuma classificação (nem na despesa) agrupa tudo em 'sem classificação'", () => {
    const r = totaisPorClassificacao([L("a", 10), L("b", 20)], null);
    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({ classificacaoId: null, valor: 30 });
  });

  it("não perde centavos de arredondamento nos percentuais nem no total", () => {
    const r = totaisPorClassificacao([L("a", 0.1, "x"), L("a", 0.2, "y")], null);
    expect(r.total).toBe(0.3);
  });

  it("rateio vazio ou de valor zero não quebra", () => {
    expect(totaisPorClassificacao([], "fgts")).toEqual({ grupos: [], total: 0 });
    expect(totaisPorClassificacao([L("a", 0, "x"), L("a", 0, "y")], null).grupos.map((g) => g.percentual)).toEqual([null, null]);
  });
});

describe("quando mostrar e conferência com o valor da despesa", () => {
  it("só mostra o resumo com mais de uma classificação", () => {
    expect(mostrarResumoPorClassificacao(totaisPorClassificacao([L("a", 10, "x"), L("b", 20, "x")], null))).toBe(false);
    expect(mostrarResumoPorClassificacao(totaisPorClassificacao([L("a", 10, "x"), L("b", 20, "y")], null))).toBe(true);
  });

  it("diferença: falta ratear (positivo), rateado a mais (negativo); 1 centavo já é diferença", () => {
    const r = totaisPorClassificacao([L("a", 600, "x"), L("b", 399.99, "y")], null);
    expect(diferencaDoRateio(999.99, r)).toBe(0);
    expect(diferencaDoRateio(1000, r)).toBe(0.01);
    expect(diferencaDoRateio(1100, r)).toBe(100.01);
    expect(diferencaDoRateio(900, r)).toBe(-99.99);
  });
});
