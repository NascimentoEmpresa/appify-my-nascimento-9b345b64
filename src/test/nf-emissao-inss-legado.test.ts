import { describe, expect, it } from "vitest";
import { calcularItem, inssLegadoDoItem, type ItemInput } from "@/pages/financeiro/nf-emissao/calculos";

// NF 238 (IPASEM - 13/2022, importada da planilha): bruto 11.424,32, INSS
// gravado 1.113,68 (base sem VA+VT = 10.124,32), líquido gravado 9.533,79 — o
// valor CERTO (confirmado pelo Financeiro). VA/VT/materiais vieram zerados da
// planilha, e o ERP recalculava o INSS sobre o bruto inteiro (1.256,68): o
// líquido caía para 9.390,79 ao abrir a nota.
const base: ItemInput = {
  valor_contrato_exec: 11424.32, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  qtd_colaboradores: 0, inss_categoria: "normais",
};
const pct = { issqn_pct: 0.02, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };

describe("INSS de nota legada importada da planilha", () => {
  it("sem o INSS gravado, o recálculo diverge do relatório (o bug)", () => {
    const r = calcularItem(base, pct);
    expect(r.inss).toBeCloseTo(1256.68, 2);
    expect(r.vlr_liquido).toBeCloseTo(9390.79, 2);
  });

  it("com o INSS gravado, o líquido bate com o do relatório", () => {
    const r = calcularItem({ ...base, inss_legado: 1113.68 }, pct);
    expect(r.inss).toBe(1113.68);
    expect(r.vlr_liquido).toBeCloseTo(9533.79, 2);
    // Mão de obra implícita no INSS (INSS ÷ 11%): ≈ 10.124,32, com folga de
    // centavos porque o INSS gravado já vem arredondado.
    expect(r.vlr_mao_obra).toBeCloseTo(10124.32, 1);
  });

  it("reconhece item legado: mão de obra 0, sem VA/VT/materiais, com INSS", () => {
    expect(inssLegadoDoItem({ vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, inss: 1113.68 })).toBe(1113.68);
  });

  it("item criado pelo ERP (mão de obra gravada) ou com VA/VT não é legado", () => {
    expect(inssLegadoDoItem({ vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 10662.94, inss: 1172.92 })).toBeNull();
    expect(inssLegadoDoItem({ vlr_va: 1100, vlr_vt: 200, vlr_materiais: 0, vlr_mao_obra: 0, inss: 1172.92 })).toBeNull();
  });

  it("legado sem INSS gravado (nota zerada) não é override", () => {
    expect(inssLegadoDoItem({ vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, inss: 0 })).toBeNull();
  });
});
