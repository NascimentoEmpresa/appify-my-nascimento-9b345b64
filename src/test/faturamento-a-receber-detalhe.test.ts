// SIS-2026-0641: conta vinculada, descontos depois da NF e a "ponte" que explica o A Receber.
import { describe, expect, it } from "vitest";
import { agruparFaturamento, executavelSemPlanilha, notasComSaldo, ponteAReceber, type NfFaturamento } from "@/pages/controladoria/faturamento/regras";

const nf = (o: Partial<NfFaturamento> = {}): NfFaturamento => ({
  contrato_id: "c1",
  competencia: "2026-01-01",
  tipo_nota: "N",
  status: "concluida",
  valor_contrato_exec_total: 1000,
  vlr_bruto_total: 1000,
  vlr_liquido_total: 900,
  valor_pago: null,
  desconto_conta_vinculada: 0,
  ...o,
});

const totalDe = (nfs: NfFaturamento[]) => agruparFaturamento(nfs, () => "x").get("x")!;

describe("totais com conta vinculada e descontos depois da NF", () => {
  it("soma a conta vinculada e os descontos pós-emissão de todas as notas que contam", () => {
    const t = totalDe([
      nf({ valor_pago: 800, data_pagamento: "2026-02-01", desconto_conta_vinculada: 100 }),
      nf({ desconto_conta_vinculada: 40, descontos_pos_emissao_total: 10 }),
      nf({ status: "cancelada", desconto_conta_vinculada: 999 }),
    ]);
    expect(t.contaVinculada).toBe(140);
    expect(t.posEmissao).toBe(10);
  });
});

describe("ponte do A Receber", () => {
  it("fecha: Líquido − Recebido − Conta vinculada − Descontos − Diferença nas baixadas = A Receber", () => {
    const t = totalDe([
      // paga exatamente: 900 = 800 pagos + 100 conta vinculada
      nf({ valor_pago: 800, data_pagamento: "2026-02-01", desconto_conta_vinculada: 100 }),
      // paga a menos 30 e baixada: não tem saldo, a diferença aparece na ponte
      nf({ valor_pago: 870, data_pagamento: "2026-02-02" }),
      // em aberto: saldo = 900 − 40 − 10
      nf({ desconto_conta_vinculada: 40, descontos_pos_emissao_total: 10 }),
    ]);
    const p = ponteAReceber(t);
    expect(p).toEqual({ liquido: 2700, recebido: 1670, contaVinculada: 140, posEmissao: 10, diferencaBaixadas: 30, aReceber: 850 });
    expect(p.liquido - p.recebido - p.contaVinculada - p.posEmissao - p.diferencaBaixadas).toBeCloseTo(p.aReceber, 2);
  });

  it("nota paga a mais aparece como diferença negativa", () => {
    const p = ponteAReceber(totalDe([nf({ valor_pago: 950, data_pagamento: "2026-02-01" })]));
    expect(p.diferencaBaixadas).toBe(-50);
    expect(p.aReceber).toBe(0);
  });
});

describe("notas com saldo", () => {
  it("só as com saldo, do maior para o menor; paga e cancelada ficam de fora", () => {
    const lista = notasComSaldo([
      nf({ vlr_liquido_total: 300 }),
      nf({ vlr_liquido_total: 900 }),
      nf({ vlr_liquido_total: 500, valor_pago: 500, data_pagamento: "2026-02-01" }),
      nf({ vlr_liquido_total: 700, status: "cancelada" }),
      nf({ vlr_liquido_total: 100, desconto_conta_vinculada: 100 }),
    ]);
    expect(lista.map((x) => x.saldo)).toEqual([900, 300]);
  });
});

describe("executável de contrato sem planilha", () => {
  it("usa o Valor Executado Mensal do cadastro a partir do mês de início", () => {
    const c = { valor_executado_mensal: 1500, vigencia_inicial: "2026-03-10", data_inicio: null };
    expect(executavelSemPlanilha(c, "2026-02")).toBe(0);
    expect(executavelSemPlanilha(c, "2026-03")).toBe(1500);
    expect(executavelSemPlanilha(c, "2026-09")).toBe(1500);
  });
  it("sem início cadastrado vale em todos os meses; sem valor ou zero não conta", () => {
    expect(executavelSemPlanilha({ valor_executado_mensal: 800 }, "2026-01")).toBe(800);
    expect(executavelSemPlanilha({ valor_executado_mensal: null }, "2026-01")).toBe(0);
    expect(executavelSemPlanilha({ valor_executado_mensal: 0 }, "2026-01")).toBe(0);
  });
  it("início pela data_inicio quando não há vigencia_inicial", () => {
    expect(executavelSemPlanilha({ valor_executado_mensal: 100, data_inicio: "2026-05-01" }, "2026-04")).toBe(0);
  });
});
