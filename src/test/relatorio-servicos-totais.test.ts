import { describe, expect, it } from "vitest";
import { totaisDoRelatorio, retencoesPorContrato, type NfParaTotais } from "@/pages/financeiro/relatorio-servicos/totais";
import { pendenciaContaVinculada } from "@/pages/financeiro/nf-emissao/shared";

const nf = (o: Partial<NfParaTotais> = {}): NfParaTotais => ({
  contrato_id: "c1", competencia: "2026-09-01", tipo_nota: "N", status: "concluida", data_pagamento: null,
  valor_contrato_exec_total: 1000, vlr_bruto_total: 900, vlr_liquido_total: 800, valor_pago: 0, desconto_conta_vinculada: 50,
  ...o,
});

const exec = (c: string, m: string) => (c === "c1" ? 1000 : c === "c2" ? 500 : 0) + (m === "2026-10" ? 100 : 0);
const pend = () => 10;

describe("SIS-2026-0647 · totais do Relatório Geral", () => {
  it("soma executado, faturado, líquido, conta vinculada e calcula a divergência (executado − faturado)", () => {
    const t = totaisDoRelatorio([nf(), nf({ contrato_id: "c2", valor_contrato_exec_total: 400, vlr_bruto_total: 500 })], exec, pend);
    expect(t.executado).toBe(1400);
    expect(t.faturado).toBe(1400);
    expect(t.liquido).toBe(1600);
    expect(t.contaVinculada).toBe(100);
    expect(t.divergencia).toBe(0);
    expect(t.pendente).toBe(20);
  });

  it("divergência positiva quando executou mais do que faturou, negativa no contrário", () => {
    expect(totaisDoRelatorio([nf({ valor_contrato_exec_total: 1000, vlr_bruto_total: 700 })], exec, pend).divergencia).toBe(300);
    expect(totaisDoRelatorio([nf({ valor_contrato_exec_total: 1000, vlr_bruto_total: 1200 })], exec, pend).divergencia).toBe(-200);
  });

  it("o executável entra uma vez por contrato e mês, mesmo com várias notas", () => {
    const t = totaisDoRelatorio([nf(), nf({ variacao: "outra" } as Partial<NfParaTotais>), nf({ competencia: "2026-10-01" })], exec, pend);
    // c1 em 2026-09 (1000, uma vez) + c1 em 2026-10 (1100)
    expect(t.executavel).toBe(2100);
  });

  it("nota cancelada ou substituída fica fora de todos os totais", () => {
    const t = totaisDoRelatorio([nf(), nf({ status: "cancelada", valor_contrato_exec_total: 9999, vlr_bruto_total: 9999, desconto_conta_vinculada: 999 }), nf({ contrato_id: "c2", situacao_dominio: "SUBSTITUIDA" })], exec, pend);
    expect(t.executado).toBe(1000);
    expect(t.contaVinculada).toBe(50);
    expect(t.executavel).toBe(1000);
  });

  it("só nota Código N forma o executável; outros códigos entram nos demais totais", () => {
    const t = totaisDoRelatorio([nf({ tipo_nota: "A", contrato_id: "c2" })], exec, pend);
    expect(t.executavel).toBe(0);
    expect(t.faturado).toBe(900);
  });

  it("sem linhas filtradas tudo zera", () => {
    const t = totaisDoRelatorio([], exec, pend);
    expect(Object.values(t).every((v) => v === 0)).toBe(true);
  });
});

// SIS-2026-0794: conta vinculada recebida e pendência (descontado − efetivamente recebido).
describe("SIS-2026-0794 · pendência da conta vinculada", () => {
  it("pendência por nota é o descontado menos o recebido, nunca negativa", () => {
    expect(pendenciaContaVinculada({ desconto_conta_vinculada: 4151.8, conta_vinculada_valor_recebido: 0 })).toBe(4151.8);
    expect(pendenciaContaVinculada({ desconto_conta_vinculada: 4151.8, conta_vinculada_valor_recebido: 4151.8 })).toBe(0);
    expect(pendenciaContaVinculada({ desconto_conta_vinculada: 100, conta_vinculada_valor_recebido: 130 })).toBe(0);
    expect(pendenciaContaVinculada({ desconto_conta_vinculada: 100 })).toBe(100);
  });
  it("nota cancelada ou substituída não deve conta vinculada", () => {
    expect(pendenciaContaVinculada({ desconto_conta_vinculada: 100, situacao_site_pmt: "CANCELADA" })).toBe(0);
  });
  it("os KPIs somam descontado, recebido e as pendências por nota (recebido a maior não abate a pendência de outra nota)", () => {
    const t = totaisDoRelatorio([
      nf({ desconto_conta_vinculada: 100, conta_vinculada_valor_recebido: 40 }),
      nf({ desconto_conta_vinculada: 100, conta_vinculada_valor_recebido: 130 }),
      nf({ desconto_conta_vinculada: 50, conta_vinculada_valor_recebido: 50 }),
      nf({ status: "cancelada", desconto_conta_vinculada: 999, conta_vinculada_valor_recebido: 0 }),
    ], exec, pend);
    expect(t.contaVinculada).toBe(250);
    expect(t.contaVinculadaRecebida).toBe(220);
    expect(t.pendenciaContaVinculada).toBe(60);
  });
});

describe("SIS-2026-0819 · impostos retidos", () => {
  const imp = (o: Partial<NfParaTotais> = {}) => nf({ issqn_total: 10, inss_total: 20, ir_total: 5, cofins_total: 1, pis_total: 2, csll_total: 3, ...o });
  it("o KPI soma os seis impostos das notas", () => {
    const t = totaisDoRelatorio([imp(), imp({ contrato_id: "c2", issqn_total: 100 })], exec, pend);
    expect(t.retencoes).toBe(41 + 131);
  });
  it("nota sem os campos de imposto conta zero", () => {
    expect(totaisDoRelatorio([nf()], exec, pend).retencoes).toBe(0);
  });
  it("cancelada e substituída ficam fora do KPI e do detalhe por contrato", () => {
    const linhas = [imp(), imp({ status: "cancelada", issqn_total: 999 }), imp({ contrato_id: "c2", situacao_dominio: "SUBSTITUIDA" })];
    expect(totaisDoRelatorio(linhas, exec, pend).retencoes).toBe(41);
    expect(retencoesPorContrato(linhas).map((r) => r.contratoId)).toEqual(["c1"]);
  });
  it("o total por contrato fecha com o KPI, vem do maior para o menor e não lista contrato sem retenção", () => {
    const linhas = [imp(), imp(), imp({ contrato_id: "c2", issqn_total: 500 }), nf({ contrato_id: "c3" })];
    const porContrato = retencoesPorContrato(linhas);
    expect(porContrato.map((r) => [r.contratoId, r.total, r.notas])).toEqual([["c2", 531, 1], ["c1", 82, 2]]);
    expect(porContrato[1].porImposto.issqn_total).toBe(20);
    expect(porContrato.reduce((a, r) => a + r.total, 0)).toBe(totaisDoRelatorio(linhas, exec, pend).retencoes);
  });
});
