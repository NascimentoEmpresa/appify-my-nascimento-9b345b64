// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { custosPorContratoMes, mesDaDespesaNaBase, mesDoCusto, type LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { despesasDoEscopo } from "@/pages/controladoria/faturamento/composicao";
import { admPorMesRubrica, despesasDosSocios } from "@/pages/controladoria/fechamento/regras";
import { reiniciarLeituraCompartilhada, useLeituraCompartilhada } from "@/pages/controladoria/faturamento/leituraCompartilhada";

// SIS-2026-0721: Faturamento da Empresa, Lucratividade de Contratos e Fechamento da Empresa leem as despesas por COMPETÊNCIA ou por DATA DE PAGAMENTO.
const L = (extra: Partial<LinhaFluxoCusto>): LinhaFluxoCusto => ({
  tipo: "saida", data_pagamento: "2026-02-05", competencia: "2026-01-01", contrato_id: "c1", classificacao_nome: "SALÁRIO", valor: 100, ...extra,
});
// O hook de leitura grava em cada linha o mês na base escolhida (mes_base); aqui reproduzimos isso.
const naBase = (l: LinhaFluxoCusto, base: "competencia" | "pagamento"): LinhaFluxoCusto => ({ ...l, mes_base: mesDaDespesaNaBase(l, base) });

describe("mês da despesa por base", () => {
  it("competência: mês da competência (sem ela, o do pagamento); pagamento: sempre o do pagamento", () => {
    expect(mesDaDespesaNaBase(L({}), "competencia")).toBe("2026-01");
    expect(mesDaDespesaNaBase(L({ competencia: null }), "competencia")).toBe("2026-02");
    expect(mesDaDespesaNaBase(L({}), "pagamento")).toBe("2026-02");
    expect(mesDaDespesaNaBase(L({ data_pagamento: null }), "pagamento")).toBeNull();
  });
  it("mesDoCusto respeita o mês já resolvido na leitura; sem ele, a regra da competência de sempre", () => {
    expect(mesDoCusto(L({}))).toBe("2026-01");
    expect(mesDoCusto(naBase(L({}), "pagamento"))).toBe("2026-02");
  });
});

describe("os mesmos lançamentos, nas duas bases", () => {
  const linhas = [L({}), L({ valor: 50, competencia: "2026-02-01", data_pagamento: "2026-02-20" })];

  it("custos por contrato e mês: o salário de janeiro pago em fevereiro troca de mês", () => {
    const comp = custosPorContratoMes(linhas.map((l) => naBase(l, "competencia")));
    expect(comp.get("c1|2026-01")?.salarios).toBe(100);
    expect(comp.get("c1|2026-02")?.salarios).toBe(50);
    const pag = custosPorContratoMes(linhas.map((l) => naBase(l, "pagamento")));
    expect(pag.get("c1|2026-01")).toBeUndefined();
    expect(pag.get("c1|2026-02")?.salarios).toBe(150);
  });
  it("o total geral é o mesmo nas duas bases: só muda o mês em que cada despesa conta", () => {
    const soma = (m: Map<string, { salarios: number }>) => [...m.values()].reduce((s, c) => s + c.salarios, 0);
    expect(soma(custosPorContratoMes(linhas.map((l) => naBase(l, "competencia"))))).toBe(150);
    expect(soma(custosPorContratoMes(linhas.map((l) => naBase(l, "pagamento"))))).toBe(150);
  });
  it("modal das despesas, administrativas e sócios seguem a mesma base", () => {
    expect(despesasDoEscopo(linhas.map((l) => naBase(l, "pagamento")), { meses: ["2026-02"], contratoIds: ["c1"] }).total).toBe(150);
    expect(despesasDoEscopo(linhas.map((l) => naBase(l, "competencia")), { meses: ["2026-02"], contratoIds: ["c1"] }).total).toBe(50);
    const adm = [L({ contrato_id: null })];
    expect(admPorMesRubrica(adm.map((l) => naBase(l, "competencia"))).has("2026-01")).toBe(true);
    expect(admPorMesRubrica(adm.map((l) => naBase(l, "pagamento"))).has("2026-02")).toBe(true);
    const socios = despesasDosSocios([naBase(L({}), "pagamento")], new Map([["c1", "Helena"]]));
    expect(socios.get("Helena")?.get("2026-02")).toBe(100);
  });
});

describe("leitura compartilhada entre as três telas", () => {
  beforeEach(() => {
    localStorage.clear();
    reiniciarLeituraCompartilhada();
  });

  it("começa em competência, código N e todas as empresas", () => {
    const { result } = renderHook(() => useLeituraCompartilhada());
    expect(result.current).toMatchObject({ base: "competencia", codigo: "N", empresaId: "todos" });
  });
  it("trocar a base numa tela troca nas outras (duas telas montadas ao mesmo tempo)", () => {
    const faturamento = renderHook(() => useLeituraCompartilhada());
    const fechamento = renderHook(() => useLeituraCompartilhada());
    act(() => faturamento.result.current.setBase("pagamento"));
    expect(fechamento.result.current.base).toBe("pagamento");
    act(() => fechamento.result.current.setEmpresaId("E1"));
    expect(faturamento.result.current.empresaId).toBe("E1");
  });
  it("sobrevive à troca de tela: quem monta depois lê o que foi escolhido", () => {
    const antes = renderHook(() => useLeituraCompartilhada());
    act(() => antes.result.current.setBase("pagamento"));
    act(() => antes.result.current.setCodigo("todos"));
    antes.unmount();
    const depois = renderHook(() => useLeituraCompartilhada());
    expect(depois.result.current).toMatchObject({ base: "pagamento", codigo: "todos" });
  });
});
