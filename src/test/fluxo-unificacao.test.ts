import { describe, expect, it } from "vitest";
import {
  cotasDasSalvas, cotasParaRpcUnif, diferencaCotasUnif, erroCotasUnif, planejarUnificacao, SEM_CONTRATO_UNIF, somaCotasUnif, type LinhaUnificavel,
} from "@/pages/financeiro/fluxo-caixa/unificacao";

// SIS-2026-0927: o caso do chamado — FGTS Mensal R$ 14.844,27 + Consignado R$ 6.196,32 = um pagamento de R$ 21.040,59.
const base: LinhaUnificavel = {
  origem: "malote", despesa_id: "a", numero_parcela: null, id_malote: "DM-2026-2845", empresa_id: "nh", data_pagamento: "2026-10-20", competencia: "2026-09-01",
  banco_id: "sicredi", tipo: "saida", valor: 14844.27,
};
const fgts = base;
const consignado: LinhaUnificavel = { ...base, despesa_id: "b", id_malote: "DM-2026-2846", valor: 6196.32 };

describe("planejarUnificacao (SIS-2026-0927)", () => {
  it("o exemplo do chamado soma R$ 21.040,59 e pode unificar", () => {
    const p = planejarUnificacao([fgts, consignado]);
    expect(p.ok).toBe(true);
    expect(p.total).toBe(21040.59);
    expect(p.itens).toEqual([{ origem: "malote", despesa_id: "a" }, { origem: "malote", despesa_id: "b" }]);
    expect(p.somaTexto).toContain("21.040,59");
  });

  it("aceita Malote junto com Débito Automático", () => {
    expect(planejarUnificacao([fgts, { ...consignado, origem: "debito_automatico" }]).ok).toBe(true);
  });

  it("exige 2 ou mais lançamentos", () => {
    const p = planejarUnificacao([fgts]);
    expect(p.ok).toBe(false);
    expect(p.erros.join(" ")).toMatch(/ao menos 2/);
  });

  it.each([
    ["empresas diferentes", { empresa_id: "outra" }, /empresas diferentes/],
    ["datas diferentes", { data_pagamento: "2026-10-21" }, /Datas de pagamento diferentes/],
    ["competências diferentes", { competencia: "2026-08-01" }, /Competências diferentes/],
    ["bancos diferentes", { banco_id: "itau" }, /Bancos diferentes/],
    ["entrada", { tipo: "entrada" }, /Só saídas/],
    ["parcelado", { numero_parcela: 2 }, /parcelado/],
    ["fatura de cartão", { fatura_cartao_id: "f1" }, /Fatura consolidada/],
    ["previsto", { situacao_base: "aberto" }, /previsto/],
    ["origem sem suporte", { origem: "importacao_historica" }, /Malote e do Débito Automático/],
  ])("bloqueia %s", (_nome, alteracao, esperado) => {
    const p = planejarUnificacao([fgts, { ...consignado, ...alteracao } as LinhaUnificavel]);
    expect(p.ok).toBe(false);
    expect(p.erros.join(" ")).toMatch(esperado);
  });
});

describe("rateio da linha unificada (SIS-2026-0927)", () => {
  const total = 21040.59;
  const cotas = [
    { classificacaoId: "fgts", contratoId: "bento", valor: "8.500,00" },
    { classificacaoId: "fgts", contratoId: "triunfo", valor: "4.200,00" },
    { classificacaoId: "fgts", contratoId: SEM_CONTRATO_UNIF, valor: "2.144,27" },
    { classificacaoId: "cons", contratoId: "bento", valor: "3.000,00" },
    { classificacaoId: "cons", contratoId: SEM_CONTRATO_UNIF, valor: "3.196,32" },
  ];

  it("o rateio do chamado fecha exatamente com o total", () => {
    expect(somaCotasUnif(cotas)).toBe(total);
    expect(diferencaCotasUnif(total, cotas)).toBe(0);
    expect(erroCotasUnif(total, cotas)).toBeNull();
  });

  it("não deixa salvar se a soma não fechar", () => {
    const menos = cotas.map((c, i) => (i === 0 ? { ...c, valor: "8.499,00" } : c));
    expect(erroCotasUnif(total, menos)).toMatch(/faltam/);
    const mais = cotas.map((c, i) => (i === 0 ? { ...c, valor: "8.501,00" } : c));
    expect(erroCotasUnif(total, mais)).toMatch(/sobram/);
  });

  it("exige classificação, centro de custo e valor positivo em toda cota", () => {
    expect(erroCotasUnif(total, [{ classificacaoId: "", contratoId: "x", valor: "21.040,59" }])).toMatch(/classificação/);
    expect(erroCotasUnif(total, [{ classificacaoId: "a", contratoId: "", valor: "21.040,59" }])).toMatch(/centro de custo/);
    expect(erroCotasUnif(total, [{ classificacaoId: "a", contratoId: "x", valor: "0" }, { classificacaoId: "a", contratoId: "y", valor: "21.040,59" }])).toMatch(/maior que zero/);
  });

  it("monta o payload da RPC (sem contrato vira null) e preserva o integrante das linhas originais", () => {
    const rpc = cotasParaRpcUnif([
      { classificacaoId: "c1", contratoId: SEM_CONTRATO_UNIF, valor: "10,50", integranteEmpregadoId: 7 },
      { classificacaoId: "c2", contratoId: "k", valor: "1.000,00" },
    ]);
    expect(rpc).toEqual([
      { classificacao_id: "c1", contrato_id: null, integrante_empregado_id: 7, valor: 10.5 },
      { classificacao_id: "c2", contrato_id: "k", integrante_empregado_id: null, valor: 1000 },
    ]);
  });

  it("cotas salvas voltam para o editor com vírgula e com o integrante", () => {
    expect(cotasDasSalvas([{ classificacao_id: "c1", contrato_id: null, integrante_empregado_id: 3, valor: 1234.5 }])).toEqual([
      { classificacaoId: "c1", contratoId: SEM_CONTRATO_UNIF, valor: "1234,5", integranteEmpregadoId: 3 },
    ]);
  });
});
