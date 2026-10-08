import { describe, expect, it } from "vitest";
import {
  ajustarDescontosPosEmissao, ajustarValoresNfConcluida, calcularItem, valoresLegadosDoItem, somaDescontosPosEmissao, type ItemInput,
} from "@/pages/financeiro/nf-emissao/calculos";

// SIS-2026-0592: ajuste dos descontos pós-emissão numa NF já concluída.
const pct = { issqn_pct: 0.02, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };
const base: ItemInput = {
  valor_contrato_exec: 10000, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  qtd_colaboradores: 0, inss_categoria: "normais",
};
const zero = { multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0 };

describe("ajustarDescontosPosEmissao (SIS-2026-0609: pós-emissão não mexe na NF)", () => {
  it("nota do ERP: o desconto NÃO entra no cálculo — bruto, retenções e líquido ficam iguais", () => {
    const antes = calcularItem(base, pct);
    const depois = ajustarDescontosPosEmissao(base, pct, { ...zero, glosas_pos_emissao: 1000 });
    expect(depois.glosas_pos_emissao).toBe(1000);
    expect(depois.vlr_bruto).toBe(antes.vlr_bruto);
    expect(depois.total_descontos).toBe(antes.total_descontos);
    expect(depois.vlr_liquido).toBeCloseTo(antes.vlr_liquido, 6);
    expect(depois.issqn).toBeCloseTo(antes.issqn, 6);
  });

  it("os três campos pós-emissão juntos também não mudam o líquido", () => {
    const antes = calcularItem(base, pct);
    const depois = calcularItem({ ...base, multas_pos_emissao: 100, glosas_pos_emissao: 200, outros_descontos_pos_emissao: 300 }, pct);
    expect(depois.vlr_liquido).toBeCloseTo(antes.vlr_liquido, 6);
    expect(depois.vlr_bruto).toBe(antes.vlr_bruto);
  });

  it("sem mudança, devolve o mesmo cálculo", () => {
    expect(ajustarDescontosPosEmissao(base, pct, zero).vlr_liquido).toBeCloseTo(calcularItem(base, pct).vlr_liquido, 6);
  });

  it("remover um desconto pós-emissão também não mexe no bruto", () => {
    const comDesconto: ItemInput = { ...base, multas_pos_emissao: 500 };
    const sem = ajustarDescontosPosEmissao(comDesconto, pct, zero);
    expect(sem.vlr_bruto).toBe(10000);
  });

  it("nota legada: os valores gravados (bruto, retenções, líquido) não mudam", () => {
    const linha = {
      vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, vlr_bruto: 11424.32,
      issqn: 228.49, inss: 1113.68, ir: 548.37, cofins: 0, pis: 0, csll: 0, vlr_liquido: 9533.79,
    };
    const legada: ItemInput = { ...base, valor_contrato_exec: 11424.32, valores_legados: valoresLegadosDoItem(linha) };
    const r = ajustarDescontosPosEmissao(legada, pct, { ...zero, multas_pos_emissao: 300.5 });
    expect(r.vlr_liquido).toBe(9533.79);
    expect(r.vlr_bruto).toBe(11424.32);
    expect(r.inss).toBe(1113.68);
    expect(r.issqn).toBe(228.49);
    expect(r.ir).toBe(548.37);
    expect(r.multas_pos_emissao).toBe(300.5);
  });

  it("nota legada: reduzir o desconto também não devolve nada ao bruto/líquido", () => {
    const linha = {
      vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, vlr_bruto: 1000,
      issqn: 20, inss: 0, ir: 48, cofins: 0, pis: 0, csll: 0, vlr_liquido: 932,
    };
    const legada: ItemInput = { ...base, multas_pos_emissao: 100, valores_legados: valoresLegadosDoItem(linha) };
    const r = ajustarDescontosPosEmissao(legada, pct, zero);
    expect(r.vlr_liquido).toBe(932);
    expect(r.vlr_bruto).toBe(1000);
  });

  it("soma dos três campos", () => {
    expect(somaDescontosPosEmissao({ multas_pos_emissao: 1, glosas_pos_emissao: 2, outros_descontos_pos_emissao: 3 })).toBe(6);
  });
});

describe("ajustarValoresNfConcluida — VA/VT/materiais", () => {
  const linha238 = {
    vlr_va: 0, vlr_vt: 0, vlr_materiais: 0, vlr_mao_obra: 0, vlr_bruto: 11424.32,
    issqn: 228.49, inss: 1113.68, ir: 548.37, cofins: 0, pis: 0, csll: 0, vlr_liquido: 9533.79,
  };
  const pct238 = { issqn_pct: 0.02, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };
  const sem = { multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0 };

  it("nota do ERP: VA/VT reduzem a base do INSS (bruto não muda) e o líquido sobe", () => {
    const antes = calcularItem(base, pct);
    const r = ajustarValoresNfConcluida(base, pct, { ...sem, vlr_va: 1000, vlr_vt: 300, vlr_materiais: 0 });
    expect(r.vlr_bruto).toBe(antes.vlr_bruto);
    expect(r.vlr_mao_obra).toBe(8700);
    expect(r.inss).toBeLessThan(antes.inss);
    expect(r.vlr_liquido).toBeGreaterThan(antes.vlr_liquido);
  });

  it("nota legada + VA/VT corretos da planilha: reproduz o líquido gravado (NF 238)", () => {
    const legada: ItemInput = { ...base, valor_contrato_exec: 11424.32, valores_legados: valoresLegadosDoItem(linha238) };
    const r = ajustarValoresNfConcluida(legada, pct238, { ...sem, vlr_va: 900, vlr_vt: 400, vlr_materiais: 0 });
    expect(r.vlr_mao_obra).toBeCloseTo(10124.32, 2);
    expect(r.inss).toBeCloseTo(1113.68, 2);
    expect(r.vlr_liquido).toBeCloseTo(9533.79, 2);
  });

  it("nota legada sem VA/VT informados continua usando os valores gravados", () => {
    const legada: ItemInput = { ...base, valor_contrato_exec: 11424.32, valores_legados: valoresLegadosDoItem(linha238) };
    const r = ajustarValoresNfConcluida(legada, pct238, { ...sem, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0 });
    expect(r.vlr_liquido).toBe(9533.79);
  });
});

describe("SIS-2026-0591: total PIS + COFINS + CSLL", () => {
  it("soma as três retenções e arredonda em centavos", async () => {
    const { somaRetencoesPisCofinsCsll } = await import("@/pages/financeiro/nf-emissao/calculos");
    expect(somaRetencoesPisCofinsCsll({ pis_total: 65.1, cofins_total: 300.2, csll_total: 100.05 })).toBe(465.35);
    expect(somaRetencoesPisCofinsCsll({ pis_total: 0, cofins_total: 0, csll_total: 0 })).toBe(0);
  });
});

describe("[SEM-CHAMADO]: INSS 'Não reter' (NF de material do SEMAE)", () => {
  it("zera o INSS do item e o líquido deixa de descontá-lo", async () => {
    const { calcularItem, INSS_CATEGORIAS } = await import("@/pages/financeiro/nf-emissao/calculos");
    const pct = { issqn_pct: 0.05, ir_pct: 0.048, cofins_pct: 0, pis_pct: 0, csll_pct: 0 };
    const base = {
      valor_contrato_exec: 10000, vlr_va: 0, vlr_vt: 0, vlr_materiais: 0,
      faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
      multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0, qtd_colaboradores: 0,
    };
    const normal = calcularItem({ ...base, inss_categoria: "normais" }, pct);
    const semInss = calcularItem({ ...base, inss_categoria: "nao_reter" }, pct);
    expect(INSS_CATEGORIAS.nao_reter.pct).toBe(0);
    expect(normal.inss).toBe(1100);
    expect(semInss.inss).toBe(0);
    expect(semInss.vlr_liquido).toBeCloseTo(normal.vlr_liquido + 1100, 2);
    // as categorias de risco continuam com as mesmas alíquotas
    expect(INSS_CATEGORIAS.insalubridade_40.pct).toBe(0.15);
  });
});
