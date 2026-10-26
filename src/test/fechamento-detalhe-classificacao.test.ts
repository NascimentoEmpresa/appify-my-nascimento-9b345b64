import { describe, expect, it } from "vitest";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import {
  admPorMesRubrica, complementoProjecao, despesasDosSocios, detalheAdmPorClassificacao, detalheSocioPorClassificacao,
} from "@/pages/controladoria/fechamento/regras";

const l = (o: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-01-10", competencia: "2026-01-01", contrato_id: null, classificacao_nome: "Uniforme", valor: 100, empresa_id: "e1", ...o,
});

const jan = new Set(["2026-01"]);

describe("SIS-2026-0730 — detalhamento por classificação (despesa administrativa)", () => {
  const linhas = [
    l({ classificacao_nome: "Uniforme", valor: 400 }),
    l({ classificacao_nome: "Uniforme", valor: 12.35 }),
    l({ classificacao_nome: "EPI", valor: 186 }),
    l({ classificacao_nome: "Salário", valor: 5000 }),
    l({ classificacao_nome: "Uniforme", valor: 999, competencia: "2026-02-01", data_pagamento: "2026-02-10" }),
    l({ tipo: "entrada", classificacao_nome: "Uniforme", valor: 777 }),
    l({ classificacao_nome: "Uniforme", valor: 555, contrato_id: "c1" }),
  ];

  it("a soma do detalhe de uma rubrica é o valor da célula do resumo mensal", () => {
    const celula = admPorMesRubrica(linhas).get("2026-01")!.outras;
    const itens = detalheAdmPorClassificacao(linhas, jan, ["outras"]);
    expect(itens.map((i) => i.classificacao)).toEqual(["Uniforme", "EPI"]);
    expect(itens.find((i) => i.classificacao === "Uniforme")).toMatchObject({ valor: 412.35, lancamentos: 2 });
    expect(Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100).toBe(Math.round(celula * 100) / 100);
  });

  it("não mistura outro mês, entrada nem lançamento de contrato", () => {
    const todos = detalheAdmPorClassificacao(linhas, jan, null);
    expect(Math.round(todos.reduce((s, i) => s + i.valor, 0) * 100) / 100).toBe(5598.35);
  });

  it("Total Desp. Adm (todas as rubricas) soma as rubricas do mês", () => {
    const porRubrica = admPorMesRubrica(linhas).get("2026-01")!;
    const soma = Object.values(porRubrica).reduce((s, v) => s + v, 0);
    const itens = detalheAdmPorClassificacao(linhas, jan, null);
    expect(Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100).toBe(Math.round(soma * 100) / 100);
  });

  it("vários meses (linha Total) somam os meses escolhidos", () => {
    const itens = detalheAdmPorClassificacao(linhas, new Set(["2026-01", "2026-02"]), ["outras"]);
    expect(itens.find((i) => i.classificacao === "Uniforme")?.valor).toBe(1411.35);
  });

  it("filtra por empresa", () => {
    expect(detalheAdmPorClassificacao(linhas, jan, ["outras"], undefined, "e2")).toEqual([]);
  });

  it("projeção: o que a célula mostra além do lançado vira o complemento", () => {
    const itens = detalheAdmPorClassificacao(linhas, jan, ["outras"]);
    expect(complementoProjecao(1000, itens)).toBe(401.65);
    expect(complementoProjecao(598.35, itens)).toBe(0);
  });
});

describe("SIS-2026-0730 — detalhamento por classificação (sócio)", () => {
  const socioPorContrato = new Map([["cH", "Helena"], ["cC", "Carlos Eduardo"]]);
  const linhas = [
    l({ contrato_id: "cH", classificacao_nome: "Água", valor: 12540.22 }),
    l({ contrato_id: "cH", classificacao_nome: "Luz", valor: 18736.4 }),
    l({ contrato_id: "cC", classificacao_nome: "Condomínio", valor: 100 }),
    l({ contrato_id: "cH", classificacao_nome: "Luz", valor: 50, competencia: "2026-02-01" }),
    l({ contrato_id: "cH", tipo: "entrada", classificacao_nome: "Luz", valor: 9 }),
  ];

  it("lista só o sócio e o mês, e a soma bate com a coluna do sócio", () => {
    const celula = despesasDosSocios(linhas, socioPorContrato).get("Helena")!.get("2026-01")!;
    const itens = detalheSocioPorClassificacao(linhas, jan, "Helena", socioPorContrato);
    expect(itens.map((i) => i.classificacao)).toEqual(["Luz", "Água"]);
    expect(Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100).toBe(Math.round(celula * 100) / 100);
  });
});
