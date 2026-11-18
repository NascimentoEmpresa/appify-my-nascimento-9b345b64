import { describe, expect, it } from "vitest";
import { descontosDaNf, retencoesDaNf } from "@/pages/financeiro/relatorio-servicos/totais";

// SIS-2026-0867: Relatório Geral mostra, por nota, o total de impostos e os descontos antes e depois da nota.
describe("descontos por nota (antes e depois da emissão)", () => {
  const itens = [
    { faltas: 100.1, posto_nao_implementado: 50, multas: 10, glosas: 5, outros_descontos: 1, multas_pos_emissao: 20, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 3 },
    { faltas: 0.2, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0, multas_pos_emissao: 0, glosas_pos_emissao: 7, outros_descontos_pos_emissao: 0 },
  ];
  it("soma cada tipo de desconto dos itens e fecha os totais", () => {
    const d = descontosDaNf(itens);
    expect(d.antes).toEqual({ faltas: 100.3, postosNaoImplementados: 50, multas: 10, glosas: 5, outros: 1, total: 166.3 });
    expect(d.depois).toEqual({ multas: 20, glosas: 7, outros: 3, total: 30 });
  });
  it("nota sem itens ou com campos nulos soma zero", () => {
    expect(descontosDaNf([]).antes.total).toBe(0);
    expect(descontosDaNf([{ faltas: null }]).depois.total).toBe(0);
  });
  it("total de impostos = ISSQN + INSS + IR + COFINS + PIS + CSLL", () => {
    expect(retencoesDaNf({ issqn_total: 10, inss_total: 20, ir_total: 5, cofins_total: 3, pis_total: 1, csll_total: 1 } as any)).toBe(40);
  });
});
