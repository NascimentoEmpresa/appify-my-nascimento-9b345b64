import { describe, expect, it } from "vitest";
import { custosPorContratoMes, mesDoCusto, type LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { despesasDoEscopo } from "@/pages/controladoria/faturamento/composicao";
import { admPorClassificacao, admPorMesRubrica, despesasDosSocios } from "@/pages/controladoria/fechamento/regras";

// SIS-2026-0708: Faturamento da Empresa, Lucratividade de Contratos e Fechamento da Empresa leem as despesas pela COMPETÊNCIA.
const L = (extra: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-02-05", competencia: "2026-01-01", contrato_id: "c1", classificacao_nome: "SALÁRIO", valor: 100, ...extra,
});

describe("despesas pela competência (SIS-2026-0708)", () => {
  it("o mês da despesa é o da competência; sem competência, o do pagamento", () => {
    expect(mesDoCusto(L({}))).toBe("2026-01");
    expect(mesDoCusto(L({ competencia: null }))).toBe("2026-02");
    expect(mesDoCusto(L({ competencia: null, data_pagamento: null }))).toBeNull();
  });

  it("custos por contrato e mês: salário de janeiro pago em fevereiro cai em janeiro", () => {
    const mapa = custosPorContratoMes([L({}), L({ valor: 50, competencia: "2026-02-01" })]);
    expect(mapa.get("c1|2026-01")?.salarios).toBe(100);
    expect(mapa.get("c1|2026-02")?.salarios).toBe(50);
  });

  it("o modal das despesas soma só os meses do escopo, pela competência", () => {
    const linhas = [L({}), L({ valor: 70, competencia: "2026-02-01" })];
    const jan = despesasDoEscopo(linhas, { meses: ["2026-01"], contratoIds: ["c1"] });
    expect(jan.total).toBe(100);
    expect(jan.linhas).toHaveLength(1);
    expect(despesasDoEscopo(linhas, { meses: ["2026-02"], contratoIds: ["c1"] }).total).toBe(70);
  });

  it("Fechamento: despesa administrativa (sem contrato) também vai para o mês da competência", () => {
    const adm = [L({ contrato_id: null }), L({ contrato_id: null, competencia: "2026-02-01", valor: 30 })];
    const porMes = admPorMesRubrica(adm);
    expect(porMes.get("2026-01")?.salarios).toBe(100);
    expect(porMes.get("2026-02")?.salarios).toBe(30);
    expect(admPorClassificacao(adm, new Set(["2026-01"])).reduce((s, l) => s + l.valor, 0)).toBe(100);
  });

  it("linha de contrato ainda NÃO é despesa administrativa por si só (a tela repassa as dos contratos ADMINISTRATIVO como sem contrato)", () => {
    expect(admPorMesRubrica([L({ contrato_id: "adm-hagg", valor: 40 })]).get("2026-01")).toBeUndefined();
    expect(admPorMesRubrica([L({ contrato_id: null, valor: 40 })]).get("2026-01")?.salarios).toBe(40);
  });

  it("despesas dos sócios também pela competência", () => {
    const socios = new Map([["cs", "Senilton"]]);
    const m = despesasDosSocios([
      { tipo: "saida", data_pagamento: "2026-02-05", competencia: "2026-01-01", contrato_id: "cs", classificacao_nome: "DISTRIBUIÇÃO DE LUCROS", valor: 500 },
    ], socios);
    expect(m.get("Senilton")?.get("2026-01")).toBe(500);
    expect(m.get("Senilton")?.get("2026-02")).toBeUndefined();
  });
});
