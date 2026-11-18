import { describe, expect, it } from "vitest";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";
import { agruparPendentes, carteiraPendente, composicaoPendente, conciliarComKpi, resumoPorFaixa } from "@/pages/financeiro/fluxo-caixa-gerencial/pendentes";
import { aplicarPrazo, diasDeAtraso, faixaDeAtraso, interpretarPrazoContrato, vencimentoDaNota } from "@/pages/financeiro/fluxo-caixa-gerencial/vencimento";

// SIS-2026-0893 (etapa 3): vencimento da nota e aging dos recebimentos pendentes.
describe("prazo de pagamento do contrato (texto livre)", () => {
  it.each([
    ["ATÉ 15 DIAS MÊS SUBSEQUENTE", { tipo: "dia_do_mes_seguinte", dia: 15 }],
    ["Dia 10 do mês seguinte", { tipo: "dia_do_mes_seguinte", dia: 10 }],
    ["ATÉ O DIA 5 DO PRÓXIMO MÊS", { tipo: "dia_do_mes_seguinte", dia: 5 }],
    ["30 DIAS", { tipo: "dias_corridos", dias: 30 }],
    ["ate 30 dias apos a emissao", { tipo: "dias_corridos", dias: 30 }],
    ["45 DDL", { tipo: "dias_corridos", dias: 45 }],
    ["ATÉ 20 DIAS ÚTEIS", { tipo: "dias_uteis", dias: 20 }],
  ])("entende %s", (texto, esperado) => expect(interpretarPrazoContrato(texto)).toEqual(esperado));

  it.each([[""], [null], [undefined], ["CONFORME MEDIÇÃO"], ["0 DIAS"], ["ATÉ O DIA 45 DO MÊS SEGUINTE"]])("não entende %s (cai no padrão estimado)", (texto) => {
    expect(interpretarPrazoContrato(texto as string | null)).toBeNull();
  });
});

describe("vencimento da nota", () => {
  const nota = { data_emissao: "2026-11-05", competencia: "2026-10-01" };
  it("1) vencimento gravado (ajuste do Financeiro) vale sempre", () => {
    expect(vencimentoDaNota({ ...nota, data_vencimento: "2026-12-20" }, "30 DIAS")).toEqual({ data: "2026-12-20", origem: "manual" });
  });
  it("2) prazo do contrato: dias corridos a partir da emissão", () => {
    expect(vencimentoDaNota(nota, "30 DIAS")).toEqual({ data: "2026-12-05", origem: "prazo_contrato" });
  });
  it("2) 'dia N do mês seguinte' conta do mês da COMPETÊNCIA (outubro → dia 15 de novembro)", () => {
    expect(vencimentoDaNota(nota, "ATÉ 15 DIAS MÊS SUBSEQUENTE")).toEqual({ data: "2026-11-15", origem: "prazo_contrato" });
  });
  it("2) dia 31 em mês de 30 dias vai para o último dia; competência de dezembro vence em janeiro do ano seguinte", () => {
    expect(aplicarPrazo({ tipo: "dia_do_mes_seguinte", dia: 31 }, "2026-11-05", "2026-11-01")).toBe("2026-12-31");
    expect(aplicarPrazo({ tipo: "dia_do_mes_seguinte", dia: 31 }, "2026-10-05", "2026-10-01")).toBe("2026-11-30");
    expect(aplicarPrazo({ tipo: "dia_do_mes_seguinte", dia: 10 }, "2026-12-20", "2026-12-01")).toBe("2027-01-10");
  });
  it("3) texto não entendido: emissão + 30 dias, marcado como estimado", () => {
    expect(vencimentoDaNota(nota, "CONFORME MEDIÇÃO")).toEqual({ data: "2026-12-05", origem: "padrao" });
    expect(vencimentoDaNota(nota, null)).toEqual({ data: "2026-12-05", origem: "padrao" });
  });
  it("sem emissão e sem vencimento gravado não dá para estimar", () => {
    expect(vencimentoDaNota({ data_emissao: null, competencia: "2026-10-01" }, "30 DIAS")).toBeNull();
  });
});

describe("faixas de atraso", () => {
  const ref = "2026-12-01";
  it.each([
    ["2026-12-31", "a_vencer"], ["2026-12-01", "a_vencer"], // o dia do vencimento ainda está no prazo
    ["2026-11-30", "vencido_1_30"], ["2026-11-01", "vencido_1_30"],
    ["2026-10-31", "vencido_31_60"], ["2026-10-02", "vencido_31_60"],
    ["2026-10-01", "vencido_61_90"], ["2026-09-02", "vencido_61_90"],
    ["2026-09-01", "vencido_90_mais"],
  ])("vencimento %s → %s", (venc, faixa) => expect(faixaDeAtraso(venc, ref)).toBe(faixa));
  it("sem vencimento", () => expect(faixaDeAtraso(null, ref)).toBe("sem_vencimento"));
  it("dias de atraso", () => expect(diasDeAtraso("2026-11-21", ref)).toBe(10));
});

describe("carteira pendente (aging)", () => {
  const nf = (p: Partial<NfEmissaoRow>) => ({
    id: "n", empresa_id: "e1", contrato_id: "c1", status: "concluida", competencia: "2026-10-01", data_emissao: "2026-10-05", numero_nf: "100",
    vlr_liquido_total: 1000, valor_pago: null, desconto_conta_vinculada: 0, data_pagamento: null, situacao_site_pmt: null, situacao_dominio: null, ...p,
  } as unknown as NfEmissaoRow);
  const contratos = new Map([
    ["c1", { nome: "Contrato A", cliente: "Prefeitura X", prazoPagamento: "30 DIAS" }],
    ["c2", { nome: "Contrato B", cliente: "Prefeitura X", prazoPagamento: null }],
    ["c3", { nome: "Contrato C", cliente: "Embrapa", prazoPagamento: "30 DIAS" }],
  ]);
  const ref = "2026-12-01";
  const todos = { empresaId: "", contratoId: "" };

  const notas = [
    nf({ id: "a", contrato_id: "c1", data_emissao: "2026-11-20", vlr_liquido_total: 1000 }), // vence 20/12 → a vencer
    nf({ id: "b", contrato_id: "c1", data_emissao: "2026-10-05", vlr_liquido_total: 2000 }), // vence 04/11 → 27 dias → 1–30
    nf({ id: "c", contrato_id: "c2", data_emissao: "2026-08-01", vlr_liquido_total: 500 }), // padrão: vence 31/08 → 92 dias → >90
    nf({ id: "d", contrato_id: "c3", data_emissao: "2026-10-01", vlr_liquido_total: 800, valor_pago: 300 }), // pendente 500, vence 31/10 → 31 dias → 31–60
    nf({ id: "e", contrato_id: "c1", vlr_liquido_total: 700, valor_pago: 700, data_pagamento: "2026-11-10" }), // quitada: fora
    nf({ id: "f", contrato_id: "c1", status: "cancelada", vlr_liquido_total: 900 }), // cancelada: fora
  ];

  it("só entram notas com saldo; quitada e cancelada ficam de fora", () => {
    const c = carteiraPendente(notas, undefined, contratos, todos, ref);
    expect(c.map((l) => l.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(c.find((l) => l.id === "d")!.pendente).toBe(500);
  });

  it("cada nota na sua faixa, com a origem do vencimento", () => {
    const c = carteiraPendente(notas, undefined, contratos, todos, ref);
    const f = (id: string) => c.find((l) => l.id === id)!;
    expect(f("a").faixa).toBe("a_vencer");
    expect(f("b").faixa).toBe("vencido_1_30");
    expect(f("c").faixa).toBe("vencido_90_mais");
    expect(f("c").origemVencimento).toBe("padrao");
    expect(f("d").faixa).toBe("vencido_31_60");
    expect(f("b").origemVencimento).toBe("prazo_contrato");
  });

  it("o resumo por faixa soma o total da carteira", () => {
    const c = carteiraPendente(notas, undefined, contratos, todos, ref);
    const r = resumoPorFaixa(c);
    expect(r.reduce((s, x) => s + x.valor, 0)).toBe(4000);
    expect(r.find((x) => x.faixa === "a_vencer")!.valor).toBe(1000);
    expect(r.find((x) => x.faixa === "vencido_90_mais")!.valor).toBe(500);
    expect(r.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(1, 6);
  });

  it("agrupa por cliente (dois contratos da mesma Prefeitura) e por contrato", () => {
    const c = carteiraPendente(notas, undefined, contratos, todos, ref);
    const porCliente = agruparPendentes(c, "cliente");
    expect(porCliente[0]).toMatchObject({ rotulo: "Prefeitura X", total: 3500, qtd: 3, vencido: 2500 });
    expect(porCliente[1]).toMatchObject({ rotulo: "Embrapa", total: 500 });
    const porContrato = agruparPendentes(c, "contrato");
    expect(porContrato.find((g) => g.rotulo === "Contrato A")!.total).toBe(3000);
    expect(porContrato.find((g) => g.rotulo === "Contrato A")!.porFaixa.a_vencer).toBe(1000);
  });

  it("respeita os filtros de empresa e contrato", () => {
    expect(carteiraPendente(notas, undefined, contratos, { empresaId: "e2", contratoId: "" }, ref)).toHaveLength(0);
    expect(carteiraPendente(notas, undefined, contratos, { empresaId: "", contratoId: "c3" }, ref).map((l) => l.id)).toEqual(["d"]);
  });

  it("composição: líquido − pago − conta vinculada − pós-emissão = pendente (com o piso de zero por nota)", () => {
    const comDescontos = [
      nf({ id: "x", vlr_liquido_total: 1000, valor_pago: 100, desconto_conta_vinculada: 50, descontos_pos_emissao_total: 30 } as Partial<NfEmissaoRow>),
    ];
    const c = carteiraPendente(comDescontos, undefined, contratos, todos, ref);
    const comp = composicaoPendente(c);
    expect(comp).toMatchObject({ liquido: 1000, pago: 100, contaVinculada: 50, posEmissao: 30, pendente: 820, ajusteDePisoZero: 0 });
    expect(comp.liquido - comp.pago - comp.contaVinculada - comp.posEmissao + comp.ajusteDePisoZero).toBe(comp.pendente);
  });

  it("conciliação com o KPI: pendente do recorte + fora do recorte = carteira total", () => {
    const c = carteiraPendente(notas, undefined, contratos, todos, ref);
    const k = conciliarComKpi(c, new Set(["a", "b"]));
    expect(k).toEqual({ doRecorte: 3000, foraDoRecorte: 1000, total: 4000 });
  });
});
