import { describe, expect, it } from "vitest";
import { categoriaDaDiferenca, efeitoDasDiferencas, ponteDaPlanilhaPorMes } from "@/pages/financeiro/conciliacao-origem/regras";

// SIS-2026-0701: ponte da planilha importada com o que o Fluxo de Caixa lê, mês a mês.
const S = (mes: string, situacao: string, qtd: number, entradas: number, saidas: number) => ({ mes, situacao, qtd, entradas, saidas });
const F = (tipo: "entrada" | "saida", valor: number, data: string, competencia = data) => ({ tipo, valor, data_pagamento: data, competencia });

describe("ponteDaPlanilhaPorMes", () => {
  it("separa o que está em uso do que a planilha tem e o Fluxo não mostra, e confere com o que o ERP lê", () => {
    const planilha = [S("2026-01-01", "em_uso", 3, 1000, 600), S("2026-01-01", "ja_existe_no_erp", 1, 0, 50), S("2026-01-01", "excluida_por_usuario", 1, 20, 0)];
    const fluxo = [F("entrada", 600, "2026-01-10"), F("entrada", 400, "2026-01-12"), F("saida", 600, "2026-01-15")];
    const [jan] = ponteDaPlanilhaPorMes(planilha, fluxo, "pagamento");
    expect(jan.mes).toBe("2026-01");
    expect(jan.planilha).toEqual({ qtd: 5, entradas: 1020, saidas: 650 });
    expect(jan.emUso).toEqual({ qtd: 3, entradas: 1000, saidas: 600 });
    expect(jan.foraDoUso).toEqual({ qtd: 2, entradas: 20, saidas: 50 });
    expect(jan.erpLe).toEqual({ qtd: 3, entradas: 1000, saidas: 600 });
    expect(jan.difEntradas).toBe(0);
    expect(jan.difSaidas).toBe(0);
  });

  it("valor ajustado no Fluxo aparece como diferença entre o em uso e o que o ERP lê", () => {
    const planilha = [S("2026-02-01", "em_uso", 1, 0, 100)];
    const [fev] = ponteDaPlanilhaPorMes(planilha, [F("saida", 90, "2026-02-03")], "pagamento");
    expect(fev.difSaidas).toBe(10);
  });

  it("a base muda o mês de cada linha: pagamento em fevereiro, competência em janeiro", () => {
    const planilha = [S("2026-01-01", "em_uso", 1, 0, 100)];
    const linha = F("saida", 100, "2026-02-02", "2026-01-01");
    expect(ponteDaPlanilhaPorMes(planilha, [linha], "competencia")[0].erpLe.saidas).toBe(100);
    const porPagamento = ponteDaPlanilhaPorMes([S("2026-02-01", "em_uso", 1, 0, 100)], [linha], "pagamento");
    expect(porPagamento).toHaveLength(1);
    expect(porPagamento[0].mes).toBe("2026-02");
  });

  it("mês que só existe no Fluxo (sem planilha) também aparece", () => {
    const r = ponteDaPlanilhaPorMes([], [F("entrada", 5, "2026-03-01")], "pagamento");
    expect(r[0]).toMatchObject({ mes: "2026-03", planilha: { qtd: 0 }, erpLe: { qtd: 1, entradas: 5 } });
  });
});

// SIS-2026-0701: jan/26 — 9 estornos (saída negativa na planilha) viraram entrada positiva no ERP: R$ 10.116,35 a mais em entradas e em saídas.
describe("efeitoDasDiferencas", () => {
  const estorno = (valor: number, data = "2026-01-10") => ({
    tipo_planilha: "saida" as const, valor_planilha: -valor, data_planilha: data, competencia_planilha: data,
    tipo_erp: "entrada" as const, valor_erp: valor, data_erp: data, competencia_erp: data,
  });

  it("estorno reclassificado: o ERP lê o valor a mais em entradas e em saídas, e a ponte fecha a diferença do mês", () => {
    const linhas = [estorno(5000), estorno(3099.59), estorno(2016.76)];
    expect(categoriaDaDiferenca(linhas[0])).toBe("estorno");
    const e = efeitoDasDiferencas(linhas, "2026-01", "pagamento");
    expect(e.qtd).toBe(3);
    expect(e.entradas).toBe(10116.35);
    expect(e.saidas).toBe(10116.35);
    expect(e.porCategoria.estorno).toEqual({ qtd: 3, entradas: 10116.35, saidas: 10116.35 });
  });

  it("linha que muda de mês tira de um mês e põe no outro", () => {
    const l = { tipo_planilha: "entrada" as const, valor_planilha: 100, data_planilha: "2026-06-08", competencia_planilha: "2026-06-01", tipo_erp: "entrada" as const, valor_erp: 100, data_erp: "2026-07-08", competencia_erp: "2026-07-01" };
    expect(categoriaDaDiferenca(l)).toBe("mes");
    expect(efeitoDasDiferencas([l], "2026-06", "pagamento").entradas).toBe(-100);
    expect(efeitoDasDiferencas([l], "2026-07", "pagamento").entradas).toBe(100);
  });

  it("valor corrigido e tipo corrigido têm categoria própria; mês sem linhas não tem efeito", () => {
    const valor = { tipo_planilha: "entrada" as const, valor_planilha: 60002.5, data_planilha: "2026-05-21", competencia_planilha: "2026-05-01", tipo_erp: "entrada" as const, valor_erp: 80192.38, data_erp: "2026-05-21", competencia_erp: "2026-05-01" };
    expect(categoriaDaDiferenca(valor)).toBe("valor");
    expect(categoriaDaDiferenca({ ...valor, valor_erp: 60002.5, tipo_erp: "saida" })).toBe("tipo");
    expect(efeitoDasDiferencas([valor], "2026-01", "pagamento").qtd).toBe(0);
  });
});
