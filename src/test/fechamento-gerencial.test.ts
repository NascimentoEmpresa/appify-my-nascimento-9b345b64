import { describe, expect, it } from "vitest";
import type { LinhaFluxoCusto } from "@/pages/controladoria/faturamento/regras";
import { saiDasDespesas, tratamentoEfetivo, tratamentoPadraoPorNome } from "@/pages/controladoria/faturamento/tratamentoContrato";
import {
  admPorMesRubrica, detalheTributosPorClassificacao, ehTributoSobreResultado, montarFechamento, ordenarColunasSocios, ROTULO_INVESTIMENTOS, ROTULO_OBRAS_ADM, totalDoFechamento,
  tributosPorMes,
} from "@/pages/controladoria/fechamento/regras";

// SIS-2026-0749: Resultado Operacional − sócios − Investimentos − Obras Adm = Resultado Gerencial após Ajustes; − Tributos (IRPJ/CSLL) = Resultado Gerencial Líquido.
const linha = (classificacao_nome: string, valor: number, extra: Partial<LinhaFluxoCusto> = {}): LinhaFluxoCusto =>
  ({ tipo: "saida", data_pagamento: "2026-01-10", competencia: "2026-01-01", contrato_id: null, classificacao_id: null, classificacao_nome, valor, ...extra }) as LinhaFluxoCusto;

describe("Obras Adm: tratamento do contrato", () => {
  it("contrato 'OBRAS ADM - …' vale como obra administrativa por padrão (sem acento e sem caixa) e sai das despesas", () => {
    expect(tratamentoPadraoPorNome("OBRAS ADM - HAGG")).toBe("obra_administrativa");
    expect(tratamentoPadraoPorNome("obras adm - sn")).toBe("obra_administrativa");
    expect(tratamentoPadraoPorNome("UFRGS - OBRAS GERAIS")).toBe("normal");
    expect(saiDasDespesas("obra_administrativa")).toBe(true);
  });

  it("no Fechamento a linha é mantida para a coluna própria, e a exceção configurada vale mais que o nome", () => {
    expect(saiDasDespesas("obra_administrativa", { manterInvestimentos: true })).toBe(false);
    expect(tratamentoEfetivo("OBRAS ADM - SN", "normal")).toBe("normal");
    expect(tratamentoEfetivo("CONTRATO COMUM", "obra_administrativa")).toBe("obra_administrativa");
  });

  it("a coluna Obras Adm vem depois de Investimentos, e os sócios antes, em ordem alfabética", () => {
    expect(ordenarColunasSocios([ROTULO_OBRAS_ADM, "Helena", ROTULO_INVESTIMENTOS, "Antonio"])).toEqual(["Antonio", "Helena", ROTULO_INVESTIMENTOS, ROTULO_OBRAS_ADM]);
  });
});

describe("Tributos sobre o Resultado = IRPJ e CSLL", () => {
  it("reconhece IRPJ e CSLL pelo nome, sem acento e sem caixa, inclusive variações; IMPOSTOS e TRIBUTOS ESTADUAIS não", () => {
    const e = (n: string) => ehTributoSobreResultado({ classificacao_id: null, classificacao_nome: n });
    expect(e("IRPJ")).toBe(true);
    expect(e("csll")).toBe(true);
    expect(e("IRPJ - ADICIONAL")).toBe(true);
    expect(e("IMPOSTOS")).toBe(false);
    expect(e("TRIBUTOS ESTADUAIS")).toBe(false);
    expect(e("")).toBe(false);
  });

  it("a ligação manual 'não é custo' vale antes", () => {
    expect(ehTributoSobreResultado({ classificacao_id: "x", classificacao_nome: "IRPJ" }, new Map([["x", "nao_custo" as const]]))).toBe(false);
  });

  it("IRPJ/CSLL saem das despesas administrativas e vão para Tributos, no mesmo mês; saída de contrato não entra", () => {
    const ls = [linha("IRPJ", 1000), linha("CSLL", 300), linha("IMPOSTOS", 50), linha("IRPJ", 999, { contrato_id: "c1" })];
    expect(tributosPorMes(ls).get("2026-01")).toBe(1300);
    const adm = admPorMesRubrica(ls).get("2026-01");
    expect(adm ? Object.values(adm).reduce((s, v) => s + v, 0) : 0).toBe(50);
    expect(detalheTributosPorClassificacao(ls, new Set(["2026-01"])).map((i) => [i.classificacao, i.valor])).toEqual([["IRPJ", 1000], ["CSLL", 300]]);
  });
});

describe("cadeia do Resultado Gerencial", () => {
  const base = {
    meses: ["2026-01", "2026-02"], mesAtual: "2026-02",
    liquidoPorMes: new Map([["2026-01", 2000], ["2026-02", 2000]]), executavelPorMes: new Map<string, number>(),
    custosContratoPorMes: new Map([["2026-01", 500], ["2026-02", 500]]), admPorMes: new Map(),
  };
  const socios = new Map([
    ["Helena", new Map([["2026-01", 100]])],
    [ROTULO_INVESTIMENTOS, new Map([["2026-01", 200]])],
    [ROTULO_OBRAS_ADM, new Map([["2026-01", 50]])],
  ]);

  it("Resultado Operacional − sócios − Investimentos − Obras Adm = após Ajustes; − Tributos = Gerencial Líquido", () => {
    const [jan] = montarFechamento({ ...base, sociosPorMes: socios, tributosPorMes: new Map([["2026-01", 120]]) });
    expect(jan.resultado).toBe(1500);
    expect(jan.totalSocios).toBe(350);
    expect(jan.lucroLiquido).toBe(1150);
    expect(jan.tributos).toBe(120);
    expect(jan.resultadoGerencialLiquido).toBe(1030);
    // margem e status são do Resultado Gerencial Líquido sobre o lucro dos contratos (1500)
    expect(jan.margemLiquida).toBeCloseTo(1030 / 1500);
  });

  it("o total do período soma os meses", () => {
    const linhas = montarFechamento({ ...base, sociosPorMes: socios, tributosPorMes: new Map([["2026-01", 120], ["2026-02", 30]]) });
    const t = totalDoFechamento(linhas);
    expect(t.tributos).toBe(150);
    expect(t.lucroLiquido).toBe(1150 + 1500);
    expect(t.resultadoGerencialLiquido).toBe(1150 + 1500 - 150);
  });

  it("sem tributos nem obras, o Gerencial Líquido é o resultado menos os sócios (comportamento de antes)", () => {
    const [jan] = montarFechamento({ ...base, sociosPorMes: new Map([["Helena", new Map([["2026-01", 100]])]]) });
    expect(jan.tributos).toBe(0);
    expect(jan.resultadoGerencialLiquido).toBe(jan.lucroLiquido);
    expect(jan.lucroLiquido).toBe(1400);
  });
});
