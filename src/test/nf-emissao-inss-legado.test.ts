import { describe, expect, it } from "vitest";
import { calcularItem, valoresLegadosDoItem, type ItemInput } from "@/pages/financeiro/nf-emissao/calculos";

// NF 238 (IPASEM - 13/2022, importada da planilha): bruto 11.424,32, INSS
// gravado 1.113,68 (base sem VA+VT = 10.124,32), líquido gravado 9.533,79 — o
// valor CERTO (confirmado pelo Financeiro: nessas notas eles discriminam VA, VT
// e materiais na planilha, e isso não vem pro ERP). O ERP recalculava o INSS
// sobre o bruto inteiro (1.256,68) e o líquido caía para 9.390,79 ao abrir.
const base: ItemInput = {
  valor_contrato_exec: 11424.32, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  qtd_colaboradores: 0, inss_categoria: "normais",
};
const pct = { issqn_pct: 0.02, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };
const linha238 = {
  vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, vlr_bruto: 11424.32,
  issqn: 228.49, inss: 1113.68, ir: 548.37, cofins: 0, pis: 0, csll: 0, vlr_liquido: 9533.79,
};

describe("nota legada importada da planilha usa os valores gravados", () => {
  it("sem os valores gravados, o recálculo diverge do relatório (o bug)", () => {
    const r = calcularItem(base, pct);
    expect(r.inss).toBeCloseTo(1256.68, 2);
    expect(r.vlr_liquido).toBeCloseTo(9390.79, 2);
  });

  it("com os valores gravados, o líquido e as retenções batem com o relatório", () => {
    const r = calcularItem({ ...base, valores_legados: valoresLegadosDoItem(linha238) }, pct);
    expect(r.vlr_liquido).toBe(9533.79);
    expect(r.inss).toBe(1113.68);
    expect(r.issqn).toBe(228.49);
    expect(r.ir).toBe(548.37);
    // Mão de obra implícita no INSS (INSS ÷ 11%): ≈ 10.124,32, com folga de
    // centavos porque o INSS gravado já vem arredondado.
    expect(r.vlr_mao_obra).toBeCloseTo(10124.32, 1);
  });

  it("vale também quando o desvio vem de ISSQN/IR/glosa (não só INSS), e sem INSS", () => {
    // Ex.: glosa lançada na nota mas fora do bruto gravado — recalcular mudaria tudo.
    const r = calcularItem(
      { ...base, valor_contrato_exec: 84416.95, glosas: 118.85,
        valores_legados: { vlr_bruto: 84416.95, issqn: 4220.85, inss: 8026.18, ir: 4052.01, cofins: 0, pis: 0, csll: 0, vlr_liquido: 64192.52 } },
      pct
    );
    expect(r.vlr_bruto).toBe(84416.95);
    expect(r.vlr_liquido).toBe(64192.52);
    const semInss = calcularItem({ ...base, valores_legados: { ...valoresLegadosDoItem(linha238)!, inss: 0 } }, pct);
    expect(semInss.vlr_mao_obra).toBe(11424.32);
  });

  it("reconhece item legado: mão de obra 0, sem VA/VT/materiais, com bruto gravado", () => {
    expect(valoresLegadosDoItem(linha238)?.vlr_liquido).toBe(9533.79);
  });

  it("item criado pelo ERP (mão de obra gravada) ou com VA/VT não é legado", () => {
    expect(valoresLegadosDoItem({ ...linha238, vlr_mao_obra: 10662.94 })).toBeNull();
    expect(valoresLegadosDoItem({ ...linha238, vlr_va: 1100, vlr_vt: 200 })).toBeNull();
  });

  it("legado zerado (bruto 0) não é override", () => {
    expect(valoresLegadosDoItem({ ...linha238, vlr_bruto: 0 })).toBeNull();
  });
});
