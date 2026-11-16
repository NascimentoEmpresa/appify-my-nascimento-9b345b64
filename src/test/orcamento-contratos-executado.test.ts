import { describe, it, expect } from "vitest";
import { computarGruposContrato, executadoPorContratoMes, baseDoOrcamento, chaveExecutado, LIMIAR_EXECUTADO } from "@/hooks/useOrcamentoContratos";
import { composicaoDaClassificacao } from "@/pages/malote/orcamento-adm-socios/regras";

// SIS-2026-0828: o orçamento de contratos sai pelo EXECUTADO (faturado nas NFs do mês), não pelo executável da Planilha de Custo.
const contrato = { id: "c1", nome: "UFRGS - LIMPEZA", status: "ativo", empresa_id: "e1", cliente: "UFRGS" } as never;
const planilha = [
  { contrato_id: "c1", orexec: "EXECUTADO", encerrado: false, posto: "P", data_vigencia: "2026-01-01", qt_postos: 1, custos_indiretos: 20, salario: 80 },
] as never;
const ligacoes = new Map([["custos_indiretos", "cls-ci"], ["salario", "cls-sal"]]);

describe("orçamento de contratos pelo executado (SIS-2026-0828)", () => {
  it("base: executado a partir de 70% do executável; antes disso, previsão; mês passado sem NF = 0", () => {
    expect(LIMIAR_EXECUTADO).toBe(0.7);
    expect(baseDoOrcamento(100, 75, "2026-11", "2026-11")).toEqual({ fator: 0.75, fonte: "faturado" });
    expect(baseDoOrcamento(100, 70, "2026-11", "2026-11")).toEqual({ fator: 0.7, fonte: "faturado" });
    expect(baseDoOrcamento(100, 110, "2026-11", "2026-11")).toEqual({ fator: 1.1, fonte: "faturado" });
    expect(baseDoOrcamento(100, 69, "2026-11", "2026-11")).toEqual({ fator: 1, fonte: "previsto" });
    expect(baseDoOrcamento(100, 0, "2026-11", "2026-11")).toEqual({ fator: 1, fonte: "previsto" });
    expect(baseDoOrcamento(100, 0, "2026-12", "2026-11")).toEqual({ fator: 1, fonte: "previsto" });
    expect(baseDoOrcamento(100, 0, "2026-10", "2026-11")).toEqual({ fator: 0, fonte: "sem_nota" });
    expect(baseDoOrcamento(100, 40, "2026-10", "2026-11")).toEqual({ fator: 1, fonte: "previsto" });
    expect(baseDoOrcamento(0, 0, "2026-11", "2026-11")).toEqual({ fator: 0, fonte: "sem_nota" });
  });

  it("soma o Valor contrato exec. das NFs que contam, por contrato e mês", () => {
    const m = executadoPorContratoMes([
      { contrato_id: "c1", competencia: "2026-11-01", valor_contrato_exec_total: 60, tipo_nota: "N" },
      { contrato_id: "c1", competencia: "2026-11-01", valor_contrato_exec_total: 15, tipo_nota: "N" },
      { contrato_id: "c1", competencia: "2026-11-01", valor_contrato_exec_total: 999, tipo_nota: "S" },
    ]);
    expect(m.get(chaveExecutado("c1", "2026-11"))).toBe(75);
  });

  it("cada rubrica mantém a proporção da planilha e o contrato vale o faturado", () => {
    const exec = new Map([[chaveExecutado("c1", "2026-11"), 75]]);
    const g = computarGruposContrato([contrato], planilha, ligacoes, "2026-11", exec, "2026-11")[0];
    expect(g.executavel).toBe(100);
    expect(g.executado).toBe(75);
    expect(g.valorTotal).toBeCloseTo(75);
    const ci = g.rubricas.find((r) => r.campo === "custos_indiretos");
    expect(ci?.valor).toBeCloseTo(15);
    expect(ci?.valorExecutavel).toBe(20);
  });

  it("sem NF: previsão no mês corrente, 0 em mês passado; sem o mapa segue pelo executável", () => {
    expect(computarGruposContrato([contrato], planilha, ligacoes, "2026-11", new Map(), "2026-11")[0].valorTotal).toBe(100);
    expect(computarGruposContrato([contrato], planilha, ligacoes, "2026-11", new Map(), "2026-12")[0].valorTotal).toBe(0);
    expect(computarGruposContrato([contrato], planilha, ligacoes, "2026-11")[0].valorTotal).toBe(100);
  });

  it("resumo da classificação: executável × executado e saldo", () => {
    const exec = new Map([[chaveExecutado("c1", "2026-11"), 75]]);
    const grupos = computarGruposContrato([contrato], planilha, ligacoes, "2026-11", exec, "2026-11");
    const usado = [{ contrato_id: "c1", classificacao_id: "cls-ci", competencia: "2026-11-10", valor: 5 }] as never;
    const [l] = composicaoDaClassificacao(grupos, usado, "cls-ci", "2026-11", ["c1"]);
    expect(l).toMatchObject({ executavel: 20, utilizado: 5, faturado: 75 });
    expect(l.executado).toBeCloseTo(15);
    expect(l.saldo).toBeCloseTo(10);
    expect(composicaoDaClassificacao(grupos, usado, "cls-ci", "2026-11", [])).toEqual([]);
  });
});
