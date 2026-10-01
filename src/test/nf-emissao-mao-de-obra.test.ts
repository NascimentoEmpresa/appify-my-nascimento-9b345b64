import { describe, expect, it } from "vitest";
import { calcularItem, calcularTotaisNf, ItemInput, PercentuaisFiscais } from "@/pages/financeiro/nf-emissao/calculos";

// SIS-2026 (pedido do usuário, informativo de Mão de Obra em destaque no
// cadastro de Emissão de NF): vlr_mao_obra = Vlr Bruto - VA - VT - Materiais.
// Já existia por item; o total da nota (vlr_mao_obra_total) é o que faltava.

const PCT: PercentuaisFiscais = { issqn_pct: 0, ir_pct: 0, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };

function item(partial: Partial<ItemInput>): ItemInput {
  return {
    valor_contrato_exec: 1000,
    vlr_va: 0,
    vlr_vt: 0,
    vlr_materiais: 0,
    faltas: 0,
    posto_nao_implementado: 0,
    multas: 0,
    glosas: 0,
    outros_descontos: 0,
    multas_pos_emissao: 0,
    glosas_pos_emissao: 0,
    outros_descontos_pos_emissao: 0,
    qtd_colaboradores: 1,
    inss_categoria: "normais",
    ...partial,
  };
}

describe("vlr_mao_obra = Vlr Bruto - VA - VT - Materiais", () => {
  it("sem VA/VT/Materiais, mão de obra é igual ao bruto", () => {
    const calc = calcularItem(item({ valor_contrato_exec: 1000 }), PCT);
    expect(calc.vlr_bruto).toBe(1000);
    expect(calc.vlr_mao_obra).toBe(1000);
  });

  it("desconta VA, VT e Materiais do bruto", () => {
    const calc = calcularItem(item({ valor_contrato_exec: 1000, vlr_va: 100, vlr_vt: 50, vlr_materiais: 30 }), PCT);
    expect(calc.vlr_bruto).toBe(1000);
    expect(calc.vlr_mao_obra).toBe(820);
  });

  it("descontos pós-emissão reduzem o bruto antes do cálculo de mão de obra", () => {
    const calc = calcularItem(item({ valor_contrato_exec: 1000, multas_pos_emissao: 200, vlr_va: 50 }), PCT);
    expect(calc.vlr_bruto).toBe(800);
    expect(calc.vlr_mao_obra).toBe(750);
  });
});

describe("calcularTotaisNf — vlr_mao_obra_total", () => {
  it("soma a mão de obra de todos os itens da nota", () => {
    const itens = [
      calcularItem(item({ valor_contrato_exec: 1000, vlr_va: 100 }), PCT),
      calcularItem(item({ valor_contrato_exec: 2000, vlr_vt: 300, vlr_materiais: 200 }), PCT),
    ];
    const totais = calcularTotaisNf(itens);
    expect(totais.vlr_mao_obra_total).toBe(900 + 1500);
  });
});
