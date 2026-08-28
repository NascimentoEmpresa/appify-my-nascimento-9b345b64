import { describe, expect, it } from "vitest";
import { montarCombosAlcada, encontrarComboQueEstouraAlcada } from "@/pages/malote/orcamentoUtils";

// SIS-2026-0261 (Iury) — dois achados reais:
// 1) despesa parcelada: só a parcela 1 decidia se escalava pra N2, mas uma
//    parcela mais à frente pode estourar o orçado do mês dela mesmo com a
//    1ª dentro.
// 2) despesa com Rateio em mais de 1 contrato: só o despesa.contrato_id
//    "principal" era checado, então um Rateio com 2 de 4 contratos
//    estourando o orçado deles passava direto sem escalar.
describe("montarCombosAlcada + encontrarComboQueEstouraAlcada", () => {
  it("despesa não parcelada sem rateio (fallback pro contrato/valor da própria despesa)", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [],
      valorTotalDespesa: 1000,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    expect(combos).toEqual([{ mes: "2026-08", contratoId: null, valor: 1000 }]);
  });

  it("achado 1: parcela 3 estoura o orçado do mês dela mesmo com a parcela 1 dentro", () => {
    const combos = montarCombosAlcada({
      parcelado: true,
      parcelas: [
        { data_vencimento: "2026-08-28", valor: 100 },
        { data_vencimento: "2026-09-08", valor: 100 },
        { data_vencimento: "2026-10-08", valor: 100 },
      ],
      linhas: [{ contrato_id: "contrato-A", valor: 300 }],
      valorTotalDespesa: 300,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    // Orçado de contrato-A: agosto e setembro sobrando de sobra, outubro já
    // quase estourado por outras despesas.
    const orcadoPorMes: Record<string, number> = { "2026-08": 1000, "2026-09": 1000, "2026-10": 150 };
    const utilizadoAntesPorMes: Record<string, number> = { "2026-08": 0, "2026-09": 0, "2026-10": 100 };
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      80, // alçada de 80%
      (_contratoId, mes) => orcadoPorMes[mes],
      (_contratoId, mes) => utilizadoAntesPorMes[mes]
    );
    expect(estouro).toBeDefined();
    expect(estouro?.mes).toBe("2026-10");
  });

  it("achado 1 (negativo): todas as parcelas dentro do orçado do mês delas não escala", () => {
    const combos = montarCombosAlcada({
      parcelado: true,
      parcelas: [
        { data_vencimento: "2026-08-28", valor: 100 },
        { data_vencimento: "2026-09-08", valor: 100 },
        { data_vencimento: "2026-10-08", valor: 100 },
      ],
      linhas: [{ contrato_id: "contrato-A", valor: 300 }],
      valorTotalDespesa: 300,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      80,
      () => 1000,
      () => 0
    );
    expect(estouro).toBeUndefined();
  });

  it("achado 2: rateio em 4 contratos, 2 deles estourando o orçado deles, escala", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [
        { contrato_id: "A", valor: 100 },
        { contrato_id: "B", valor: 100 },
        { contrato_id: "C", valor: 100 },
        { contrato_id: "D", valor: 100 },
      ],
      valorTotalDespesa: 400,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    const orcadoPorContrato: Record<string, number> = { A: 1000, B: 1000, C: 50, D: 60 };
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      100,
      (contratoId) => orcadoPorContrato[contratoId as string],
      () => 0
    );
    expect(estouro).toBeDefined();
    expect(["C", "D"]).toContain(estouro?.contratoId);
  });

  it("achado 2 (negativo): rateio em vários contratos, todos dentro, não escala", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [
        { contrato_id: "A", valor: 100 },
        { contrato_id: "B", valor: 100 },
      ],
      valorTotalDespesa: 200,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      100,
      () => 1000,
      () => 0
    );
    expect(estouro).toBeUndefined();
  });

  it("orçado desconhecido (null) nunca bloqueia, mesmo com valor estourando na prática", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [{ contrato_id: "sem-rubrica", valor: 999999 }],
      valorTotalDespesa: 999999,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      50,
      () => null,
      () => 0
    );
    expect(estouro).toBeUndefined();
  });

  it("sem limitePct configurado, nunca escala (sem trava)", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [{ contrato_id: "A", valor: 999999 }],
      valorTotalDespesa: 999999,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    const estouro = encontrarComboQueEstouraAlcada(
      combos,
      null,
      () => 1000,
      () => 0
    );
    expect(estouro).toBeUndefined();
  });

  it("valor aprovado ajustado pelo aprovador escala proporcionalmente cada linha do rateio (despesa não parcelada)", () => {
    const combos = montarCombosAlcada({
      parcelado: false,
      parcelas: [],
      linhas: [
        { contrato_id: "A", valor: 60 },
        { contrato_id: "B", valor: 40 },
      ],
      valorTotalDespesa: 100,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 2, // aprovador dobrou o valor aprovado
    });
    expect(combos).toEqual([
      { mes: "2026-08", contratoId: "A", valor: 120 },
      { mes: "2026-08", contratoId: "B", valor: 80 },
    ]);
  });

  it("combina rateio multi-contrato com parcelamento (linha × parcela)", () => {
    const combos = montarCombosAlcada({
      parcelado: true,
      parcelas: [
        { data_vencimento: "2026-08-10", valor: 50 },
        { data_vencimento: "2026-09-10", valor: 50 },
      ],
      linhas: [
        { contrato_id: "A", valor: 60 },
        { contrato_id: "B", valor: 40 },
      ],
      valorTotalDespesa: 100,
      anoMesDespesa: "2026-08",
      fatorValorAprovado: 1,
    });
    expect(combos).toHaveLength(4);
    expect(combos).toEqual(
      expect.arrayContaining([
        { mes: "2026-08", contratoId: "A", valor: 30 },
        { mes: "2026-08", contratoId: "B", valor: 20 },
        { mes: "2026-09", contratoId: "A", valor: 30 },
        { mes: "2026-09", contratoId: "B", valor: 20 },
      ])
    );
  });
});
