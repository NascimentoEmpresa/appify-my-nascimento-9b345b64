import { describe, expect, it } from "vitest";
import { montarComparativo, normalizarAnalise, quebrasConciliam, variacao } from "@/pages/financeiro/fluxo-caixa-gerencial/analiseDespesas";

// SIS-2026-XXXX (etapa 3): análise de despesas com comparativo do período anterior.
describe("variação entre períodos", () => {
  it("subiu / caiu com valor e percentual", () => {
    expect(variacao(120, 100)).toEqual({ valor: 20, pct: 0.2, situacao: "subiu" });
    expect(variacao(80, 100)).toEqual({ valor: -20, pct: -0.2, situacao: "caiu" });
  });
  it("sem despesa no período anterior é 'novo' (não existe percentual sobre zero)", () => {
    expect(variacao(500, 0)).toEqual({ valor: 500, pct: null, situacao: "novo" });
  });
  it("despesa que existia e zerou: −100%", () => {
    expect(variacao(0, 300)).toEqual({ valor: -300, pct: -1, situacao: "zerou" });
  });
  it("igual e sem nada nos dois períodos", () => {
    expect(variacao(100, 100).situacao).toBe("igual");
    expect(variacao(0, 0)).toEqual({ valor: 0, pct: 0, situacao: "igual" });
  });
  it("sem erro de ponto flutuante nos centavos", () => {
    expect(variacao(0.3, 0.1).valor).toBe(0.2);
  });
});

describe("comparativo por linha", () => {
  const linhas = [
    { nome: "Folha", valor: 600, valor_anterior: 500 },
    { nome: "Fornecedores", valor: 300, valor_anterior: 0 },
    { nome: "Aluguel", valor: 100, valor_anterior: 100 },
    { nome: "Obra encerrada", valor: 0, valor_anterior: 250 },
  ];
  const c = montarComparativo(linhas, 1000);

  it("ordena da maior despesa atual para a menor; quem só existia antes continua na lista", () => {
    expect(c.map((l) => l.nome)).toEqual(["Folha", "Fornecedores", "Aluguel", "Obra encerrada"]);
  });
  it("participação no total do período atual", () => {
    expect(c[0].pctDoTotal).toBe(0.6);
    expect(c.reduce((s, l) => s + l.pctDoTotal, 0)).toBeCloseTo(1, 6);
  });
  it("variação de cada linha", () => {
    expect(c.find((l) => l.nome === "Fornecedores")!.variacao.situacao).toBe("novo");
    expect(c.find((l) => l.nome === "Obra encerrada")!.variacao.situacao).toBe("zerou");
    expect(c.find((l) => l.nome === "Folha")!.variacao.pct).toBeCloseTo(0.2, 6);
  });
  it("total zero não divide por zero", () => {
    expect(montarComparativo([{ nome: "x", valor: 0, valor_anterior: 10 }], 0)[0].pctDoTotal).toBe(0);
  });
});

describe("JSON da função do servidor", () => {
  it("normaliza campos ausentes e rotula as origens", () => {
    const a = normalizarAnalise({
      tipo_data: "competencia", periodo_anterior: { ini: "2026-10-01", fim: "2026-10-31" }, total: "1000.50", total_anterior: 800, qtd: 12,
      por_classificacao: [{ nome: "Folha", valor: 700.5, valor_anterior: 500 }, { valor: 300, valor_anterior: 300 }],
      por_contrato: [{ contrato_id: "c1", nome: "Contrato A", valor: 1000.5, valor_anterior: 800 }],
      por_origem: [{ origem: "malote", valor: 1000.5, valor_anterior: 800 }],
    });
    expect(a.tipo_data).toBe("competencia");
    expect(a.total).toBe(1000.5);
    expect(a.por_classificacao[1].nome).toBe("Sem classificação");
    expect(a.por_contrato[0].contrato_id).toBe("c1");
    expect(a.por_origem[0].nome).toBe("Malote");
  });
  it("resposta vazia ou inválida vira análise vazia (nunca quebra a tela)", () => {
    expect(normalizarAnalise(null).total).toBe(0);
    expect(normalizarAnalise({}).por_contrato).toEqual([]);
  });
  it("as três quebras conciliam com o total (cada despesa cai em uma linha de cada quebra)", () => {
    const ok = normalizarAnalise({
      total: 1000, total_anterior: 800,
      por_classificacao: [{ nome: "a", valor: 600, valor_anterior: 500 }, { nome: "b", valor: 400, valor_anterior: 300 }],
      por_contrato: [{ nome: "c", valor: 1000, valor_anterior: 800 }],
      por_origem: [{ origem: "malote", valor: 900, valor_anterior: 800 }, { origem: "debito_automatico", valor: 100, valor_anterior: 0 }],
    });
    expect(quebrasConciliam(ok)).toBe(true);
    expect(quebrasConciliam({ ...ok, por_contrato: [{ nome: "c", valor: 999, valor_anterior: 800 }] })).toBe(false);
  });
});
