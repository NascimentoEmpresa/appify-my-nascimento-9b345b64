import { describe, expect, it } from "vitest";
import { custosVazios, type LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { admPorClassificacao, admPorMesRubrica, admSemClassificacao, margemFinal, montarFechamento, statusDoFechamento, totalDoFechamento } from "@/pages/controladoria/fechamento/regras";

const saida = (o: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({ tipo: "saida", data_pagamento: "2026-01-10", contrato_id: null, classificacao_nome: "SALÁRIO ADM", valor: 100, ...o });

describe("SIS-2026-0642 · status e margem do Fechamento", () => {
  it("margem = resultado ÷ lucro dos contratos; sem lucro positivo não há margem", () => {
    expect(margemFinal(100, 1000)).toBeCloseTo(0.1);
    expect(margemFinal(100, 0)).toBeNull();
    expect(margemFinal(-50, -100)).toBeNull();
  });

  it("acima de 10% = Saudável; de 8% a 10% = Atenção; abaixo de 8% = Crítico", () => {
    expect(statusDoFechamento(1000, 101.8)).toBe("saudavel");
    expect(statusDoFechamento(1000, 100)).toBe("atencao"); // exatamente 10%
    expect(statusDoFechamento(1000, 94.3)).toBe("atencao");
    expect(statusDoFechamento(1000, 80)).toBe("atencao"); // exatamente 8%
    expect(statusDoFechamento(1000, 79.5)).toBe("critico");
    expect(statusDoFechamento(1000, -10)).toBe("critico");
  });

  it("compara com a margem como aparece na tela (9,996% e 10,001% aparecem 10,00%, que é Atenção)", () => {
    expect(statusDoFechamento(100000, 9996)).toBe("atencao");
    expect(statusDoFechamento(100000, 10006)).toBe("saudavel");
  });

  it("sem lucro: resultado negativo é Crítico; zerado fica sem status", () => {
    expect(statusDoFechamento(0, -500)).toBe("critico");
    expect(statusDoFechamento(0, 0)).toBeNull();
  });
});

describe("SIS-2026-0642 · despesas administrativas", () => {
  it("só entra saída sem contrato e que seja despesa (aplicação/transferência/financiamento ficam fora)", () => {
    const linhas = [
      saida({}),
      saida({ contrato_id: "c1" }), // custo de contrato: não é administrativa
      saida({ classificacao_nome: "TRANSFERÊNCIA ENTRE CONTAS", valor: 5000 }),
      saida({ classificacao_nome: "FINANCIAMENTOS", valor: 7000 }),
      saida({ classificacao_nome: "SEGURO DE VIDA ADM", valor: 50 }),
      saida({ tipo: "entrada", valor: 9999 }),
    ];
    const adm = admPorMesRubrica(linhas).get("2026-01")!;
    expect(adm.salarios).toBe(100);
    expect(adm.outras).toBe(50);
    expect(adm.fgts).toBe(0);
  });

  it("filtra por empresa", () => {
    const linhas = [saida({ empresa_id: "e1" }), saida({ empresa_id: "e2", valor: 40 })];
    expect(admPorMesRubrica(linhas, undefined, "e2").get("2026-01")!.salarios).toBe(40);
  });

  it("sem classificação não entra em rubrica e é avisado", () => {
    const linhas = [saida({ classificacao_nome: null, valor: 300 }), saida({ classificacao_nome: "  ", valor: 200 })];
    expect(admPorMesRubrica(linhas).size).toBe(0);
    expect(admSemClassificacao(linhas)).toEqual({ linhas: 2, valor: 500 });
  });

  it("agrupa por classificação nos meses escolhidos", () => {
    const linhas = [saida({ valor: 100 }), saida({ valor: 50 }), saida({ data_pagamento: "2026-02-03", valor: 999 }), saida({ classificacao_nome: "VA", valor: 10 })];
    const r = admPorClassificacao(linhas, new Set(["2026-01"]));
    expect(r[0]).toMatchObject({ classificacao: "SALÁRIO ADM", rubrica: "salarios", valor: 150, lancamentos: 2 });
    expect(r[1]).toMatchObject({ classificacao: "VA", rubrica: "va", valor: 10 });
  });
});

describe("SIS-2026-0642 · fechamento mensal e projeção", () => {
  const meses = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
  const adm = (v: number) => ({ ...custosVazios(), salarios: v });
  const base = {
    meses,
    mesAtual: "2026-04",
    liquidoPorMes: new Map([["2026-01", 1000], ["2026-02", 1000], ["2026-03", 1000], ["2026-04", 500]]),
    executavelPorMes: new Map([["2026-01", 2000], ["2026-02", 2000], ["2026-03", 2000], ["2026-04", 2000], ["2026-05", 2000]]),
    custosContratoPorMes: new Map([["2026-01", 600], ["2026-02", 600], ["2026-03", 600], ["2026-04", 300]]),
    admPorMes: new Map([["2026-01", adm(100)], ["2026-02", adm(100)], ["2026-03", adm(100)], ["2026-04", adm(50)]]),
  };

  it("meses até o atual são realizados: lucro = líquido − custos; resultado = lucro − administrativas", () => {
    const l = montarFechamento(base);
    expect(l[0]).toMatchObject({ mes: "2026-01", projetado: false, lucroContratos: 400, totalAdm: 100, resultado: 300 });
    expect(l[0].margem).toBeCloseTo(0.75);
    expect(l[0].status).toBe("saudavel");
  });

  it("mês futuro: executável × proporção líquido/executável; custo e administrativas pela média dos 3 meses cheios", () => {
    const m = montarFechamento(base)[4];
    expect(m.projetado).toBe(true);
    // proporção = 3000/6000 = 0,5 → líquido projetado 1000; custo médio 600; adm média 100
    expect(m.lucroContratos).toBe(400);
    expect(m.totalAdm).toBe(100);
    expect(m.resultado).toBe(300);
  });

  it("o programado vale quando é maior que a média; nota já emitida vale no lugar do executável", () => {
    const e = { ...base, liquidoPorMes: new Map([...base.liquidoPorMes, ["2026-05", 1500]]), custosContratoPorMes: new Map([...base.custosContratoPorMes, ["2026-05", 900]]), admPorMes: new Map([...base.admPorMes, ["2026-05", adm(250)]]) };
    const m = montarFechamento(e)[4];
    expect(m.lucroContratos).toBe(600);
    expect(m.totalAdm).toBe(250);
  });

  it("total soma os meses e separa realizado de projetado", () => {
    const t = totalDoFechamento(montarFechamento(base));
    expect(t.lucroRealizado + t.lucroProjetado).toBe(t.lucroContratos);
    expect(t.lucroProjetado).toBe(400);
    expect(t.resultado).toBe(t.lucroContratos - t.totalAdm);
  });

  it("sem meses anteriores (janeiro) usa o próprio mês atual como referência", () => {
    const l = montarFechamento({ ...base, meses: ["2026-01", "2026-02"], mesAtual: "2026-01" });
    expect(l[1].totalAdm).toBe(100);
  });
});
