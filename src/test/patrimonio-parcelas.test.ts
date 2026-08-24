import { describe, it, expect } from "vitest";
import {
  dividirEmParcelas, gerarParcelas, somaParcelas, totalGeral, validarParcelas,
  renumerar, somaMeses, passoDaPeriodicidade, ehContratoParcelado,
  valorQueFalta, mapaValorQueFalta, type LinhaParcela,
} from "@/pages/juridico/patrimonio/parcelas";

describe("dividir sem perder centavo", () => {
  it("reparte o que sobra nas primeiras parcelas", () => {
    // 1000/3 arredondado daria 333,33 três vezes = 999,99. Falta 1 centavo.
    const v = dividirEmParcelas(1000, 3);
    expect(v).toEqual([333.34, 333.33, 333.33]);
    expect(somar(v)).toBe(1000);
  });

  it("a soma bate com o total em qualquer quantidade", () => {
    for (const [total, n] of [[1000, 3], [5085.65, 4], [12345.67, 7], [99.99, 60], [1, 3]] as const) {
      expect(somar(dividirEmParcelas(total, n))).toBeCloseTo(total, 2);
    }
  });

  it("divisão exata não inventa diferença", () => {
    expect(dividirEmParcelas(1200, 4)).toEqual([300, 300, 300, 300]);
  });

  it("quantidade inválida devolve lista vazia", () => {
    expect(dividirEmParcelas(1000, 0)).toEqual([]);
    expect(dividirEmParcelas(1000, -5)).toEqual([]);
  });
});

const somar = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100;

describe("gerar as parcelas", () => {
  it("tira a entrada do total e anda pela periodicidade", () => {
    const p = gerarParcelas({ total: 10000, entrada: 1000, quantidade: 3, primeiroVencimento: "2026-09-15", periodicidade: "Mensal" });
    expect(p.map(x => x.vencimento)).toEqual(["2026-09-15", "2026-10-15", "2026-11-15"]);
    expect(somaParcelas(p)).toBe(9000);
    expect(totalGeral(p, 1000)).toBe(10000);
    expect(p.map(x => x.numero)).toEqual([1, 2, 3]);
  });

  it("respeita o passo de cada periodicidade", () => {
    expect(passoDaPeriodicidade("Trimestral")).toBe(3);
    expect(passoDaPeriodicidade("Anual")).toBe(12);
    expect(passoDaPeriodicidade("Único")).toBe(1);
    const p = gerarParcelas({ total: 300, quantidade: 3, primeiroVencimento: "2026-01-10", periodicidade: "Trimestral" });
    expect(p.map(x => x.vencimento)).toEqual(["2026-01-10", "2026-04-10", "2026-07-10"]);
  });

  it("não deixa a parcela pular de mês em dia 31", () => {
    // 31/01 + 1 mês no JS cru vira 03/03 (fevereiro não tem 31).
    expect(somaMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somaMeses("2026-01-31", 3)).toBe("2026-04-30");
    expect(somaMeses("2026-03-15", 1)).toBe("2026-04-15");
  });

  it("sem vencimento ou sem quantidade não gera nada", () => {
    expect(gerarParcelas({ total: 100, quantidade: 3, primeiroVencimento: "" })).toEqual([]);
    expect(gerarParcelas({ total: 100, quantidade: 0, primeiroVencimento: "2026-09-15" })).toEqual([]);
  });
});

describe("validação do bloco de parcelas", () => {
  const ok: LinhaParcela[] = [
    { numero: 1, vencimento: "2026-09-15", valor: "500.00" },
    { numero: 2, vencimento: "2026-10-15", valor: "500.00" },
  ];

  it("aceita quando a soma bate com o total", () => {
    expect(validarParcelas(ok, 1000)).toBeNull();
    expect(validarParcelas(ok, 1200, 200)).toBeNull();   // com entrada
  });

  it("cobra gerar antes de salvar", () => {
    expect(validarParcelas([], 1000)).toMatch(/gere as parcelas/i);
  });

  it("aponta a parcela sem data ou sem valor, pelo número", () => {
    expect(validarParcelas([{ ...ok[0] }, { numero: 2, vencimento: "", valor: "500" }], 1000)).toMatch(/parcela 2/i);
    expect(validarParcelas([{ ...ok[0] }, { numero: 2, vencimento: "2026-10-15", valor: "0" }], 1000)).toMatch(/parcela 2/i);
  });

  it("reclama quando a soma não fecha com o total", () => {
    expect(validarParcelas(ok, 3000)).toMatch(/ajuste um dos dois/i);
  });

  it("tolera 1 centavo de diferença", () => {
    // No modo "uma a uma" a pessoa arredonda na mão; brigar por um centavo
    // só trava o cadastro.
    expect(validarParcelas(ok, 1000.01)).toBeNull();
    expect(validarParcelas(ok, 1000.5)).not.toBeNull();
  });

  it("sem total informado não cobra fechamento", () => {
    expect(validarParcelas(ok, 0)).toBeNull();
  });
});

describe("renumerar", () => {
  it("fecha a sequência depois de excluir uma linha do meio", () => {
    const tres: LinhaParcela[] = [
      { numero: 1, vencimento: "2026-01-10", valor: "10" },
      { numero: 2, vencimento: "2026-02-10", valor: "10" },
      { numero: 3, vencimento: "2026-03-10", valor: "10" },
    ];
    expect(renumerar(tres.filter(x => x.numero !== 2)).map(x => x.numero)).toEqual([1, 2]);
  });
});

describe("valor que falta do patrimônio", () => {
  // Só Financiamento e Consórcio contam, e só o que não foi pago.
  const obrs = [
    { patrimonio_id: 1, categoria: "Financiamento", valor: 1000, status: "Pendente" },
    { patrimonio_id: 1, categoria: "Financiamento", valor: 1000, status: "Pago" },
    { patrimonio_id: 1, categoria: "Consórcio", valor: 500, status: "Pendente" },
    { patrimonio_id: 1, categoria: "IPTU", valor: 900, status: "Pendente" },   // não é contrato
    { patrimonio_id: 2, categoria: "Financiamento", valor: 250.25, status: "Pendente" },
  ];

  it("soma só as parcelas em aberto de contrato", () => {
    expect(valorQueFalta(obrs, 1)).toBe(1500);
    expect(valorQueFalta(obrs, 2)).toBe(250.25);
    expect(valorQueFalta(obrs, 99)).toBe(0);
  });

  it("o mapa da tabela dá o mesmo número", () => {
    const m = mapaValorQueFalta(obrs);
    expect(m.get(1)).toBe(1500);
    expect(m.get(2)).toBe(250.25);
    expect(m.has(99)).toBe(false);
  });

  it("sabe quais categorias são contrato parcelado", () => {
    expect(ehContratoParcelado("Financiamento")).toBe(true);
    expect(ehContratoParcelado("Consórcio")).toBe(true);
    expect(ehContratoParcelado("IPTU")).toBe(false);
    expect(ehContratoParcelado("")).toBe(false);
    expect(ehContratoParcelado(null)).toBe(false);
  });
});
