import { describe, expect, it } from "vitest";
import { totaisDoRelatorio, type NfParaTotais } from "@/pages/financeiro/relatorio-servicos/totais";

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
