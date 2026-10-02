import { describe, expect, it } from "vitest";
import { calcularItem, calcularTotaisNf, pctEfetivo, pctFiscaisDaNf, ItemInput } from "@/pages/financeiro/nf-emissao/calculos";

// Achado real (Ruan, NF 1186 Caxias do Sul - 2026/95, importada da planilha
// legada): totais de ISSQN/IR salvos, percentuais salvos = 0. A NF Concluída
// recalculava com 0% e o líquido (R$ 40.839,73) divergia do Relatório
// (R$ 36.801,65).

const NF_1186 = {
  issqn_pct: 0, ir_pct: 0, cofins_pct: 0, pis_pct: 0, csll_pct: 0,
  vlr_bruto_total: 45887.34,
  issqn_total: 1835.49, ir_total: 2202.59, cofins_total: 0, pis_total: 0, csll_total: 0,
};

const ITEM_1186: ItemInput = {
  valor_contrato_exec: 50431, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
  faltas: 4543.66, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  qtd_colaboradores: 0, inss_categoria: "normais",
};

describe("pctFiscaisDaNf — nota importada com retenção em valor e percentual 0", () => {
  it("deriva os percentuais do total/bruto", () => {
    const pct = pctFiscaisDaNf(NF_1186);
    expect(pct.issqn_pct).toBe(0.04);
    expect(pct.ir_pct).toBe(0.048);
    expect(pct.cofins_pct).toBe(0);
  });

  it("recalcular com o percentual derivado reproduz o líquido do Relatório", () => {
    const calc = calcularItem(ITEM_1186, pctEfetivo(ITEM_1186, pctFiscaisDaNf(NF_1186)));
    const totais = calcularTotaisNf([calc]);
    expect(totais.vlr_liquido_total).toBeCloseTo(36801.65, 2);
    expect(totais.issqn_total).toBeCloseTo(1835.49, 2);
    expect(totais.ir_total).toBeCloseTo(2202.59, 2);
  });

  it("sem o fix o recálculo perdia ISSQN e IR (regressão original)", () => {
    const calc = calcularItem(ITEM_1186, pctEfetivo(ITEM_1186, { issqn_pct: 0, ir_pct: 0, cofins_pct: 0, pis_pct: 0, csll_pct: 0 }));
    expect(calcularTotaisNf([calc]).vlr_liquido_total).toBeCloseTo(40839.73, 2);
  });
});

describe("pctFiscaisDaNf — não mexe no que já tem percentual salvo", () => {
  it("nota criada no app (percentual salvo) usa o salvo, não o derivado", () => {
    const nf = { ...NF_1186, issqn_pct: 0.05, ir_pct: 0.015 };
    expect(pctFiscaisDaNf(nf)).toEqual({ issqn_pct: 0.05, ir_pct: 0.015, cofins_pct: 0, pis_pct: 0, csll_pct: 0 });
  });

  it("nota sem retenção nenhuma continua com 0%", () => {
    const nf = { ...NF_1186, issqn_total: 0, ir_total: 0 };
    expect(pctFiscaisDaNf(nf).issqn_pct).toBe(0);
  });

  it("bruto zero não divide por zero", () => {
    expect(pctFiscaisDaNf({ ...NF_1186, vlr_bruto_total: 0 }).issqn_pct).toBe(0);
  });
});
