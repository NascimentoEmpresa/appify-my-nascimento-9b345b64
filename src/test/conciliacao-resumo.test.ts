import { describe, expect, it } from "vitest";
import { reconciliar, type OFXTransaction, type PlanilhaRow } from "@/lib/conciliacaoBancariaEngine";
import { resumirConciliacao } from "@/lib/conciliacaoResumo";

// Conciliação Bancária: o resumo do que foi conciliado é gravado junto, para a lista de salvas mostrar valores mesmo sem divergência.
const P = (dia: string, valor: number, tipo: "ENTRADA" | "SAÍDA"): PlanilhaRow => ({ dia, valor, tipo, banco: "Sicredi" });
const E = (dia: string, valor: number, tipo: "ENTRADA" | "SAÍDA"): OFXTransaction => ({ dia, valor, tipo, memo: "x", origem: "a.ofx" });

describe("resumirConciliacao", () => {
  it("tudo bate: o conciliado é o total do Fluxo e não há divergência", () => {
    const plan = [P("2026-09-01", 100, "ENTRADA"), P("2026-09-02", 40.5, "SAÍDA"), P("2026-09-02", 9.5, "SAÍDA")];
    const ofx = [E("2026-09-01", 100, "ENTRADA"), E("2026-09-02", 40.5, "SAÍDA"), E("2026-09-02", 9.5, "SAÍDA")];
    const res = reconciliar(plan, ofx);
    const r = resumirConciliacao(plan, ofx, res);
    expect(r).toMatchObject({
      fluxoEntradas: 100, fluxoSaidas: 50, qtdFluxo: 3, qtdExtrato: 3,
      conciliadoEntradas: 100, conciliadoSaidas: 50, qtdConciliadas: 3, diasTotal: 2, diasOk: 2,
    });
  });
  it("uma linha do Fluxo sem par no extrato (ignorada) não conta como conciliada", () => {
    const plan = [P("2026-09-01", 100, "ENTRADA"), P("2026-09-02", 30, "SAÍDA")];
    const ofx = [E("2026-09-01", 100, "ENTRADA")];
    const res = reconciliar(plan, ofx);
    const r = resumirConciliacao(plan, ofx, res);
    expect(r.fluxoSaidas).toBe(30);
    expect(r.conciliadoSaidas).toBe(0);
    expect(r.conciliadoEntradas).toBe(100);
    expect(r.qtdConciliadas).toBe(1);
  });
  it("dia a dia: separa entradas e saídas, o conciliado e o status de cada dia", () => {
    const plan = [P("2026-09-01", 100, "ENTRADA"), P("2026-09-02", 40, "SAÍDA"), P("2026-09-02", 10, "SAÍDA"), P("2026-09-03", 5, "SAÍDA")];
    const ofx = [E("2026-09-01", 100, "ENTRADA"), E("2026-09-02", 40, "SAÍDA"), E("2026-09-02", 10, "SAÍDA")];
    const r = resumirConciliacao(plan, ofx, reconciliar(plan, ofx));
    expect(r.dias.map((d) => d.dia)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    expect(r.dias[0]).toMatchObject({ fluxoEntradas: 100, extratoEntradas: 100, conciliadoEntradas: 100, qtdConciliadas: 1, qtdFluxo: 1, ok: true });
    expect(r.dias[1]).toMatchObject({ fluxoSaidas: 50, extratoSaidas: 50, conciliadoSaidas: 50, qtdConciliadas: 2, ok: true });
    // dia 3: saída só no Fluxo (ainda divergente) → nada conciliado
    expect(r.dias[2]).toMatchObject({ fluxoSaidas: 5, conciliadoSaidas: 0, qtdConciliadas: 0, qtdFluxo: 1, ok: false });
    expect(r.conciliadoSaidas).toBe(50);
    // mesmo formato do "Resumo por Dia": valor no Fluxo, valor no extrato, diferença, status e observação
    expect(r.dias[0]).toMatchObject({ fluxoTotal: 100, extratoTotal: 100, diferenca: 0, ok: true, observacao: "—" });
    expect(r.dias[1]).toMatchObject({ fluxoTotal: 50, extratoTotal: 50, diferenca: 0 });
    expect(r.dias[2]).toMatchObject({ fluxoTotal: 5, extratoTotal: 0, diferenca: 5, observacao: "1 no Fluxo, sem par no extrato" });
  });
  it("linha só do extrato (sem par no Fluxo) não mexe no conciliado do Fluxo", () => {
    const plan = [P("2026-09-01", 100, "ENTRADA")];
    const ofx = [E("2026-09-01", 100, "ENTRADA"), E("2026-09-03", 7, "SAÍDA")];
    const r = resumirConciliacao(plan, ofx, reconciliar(plan, ofx));
    expect(r.conciliadoEntradas).toBe(100);
    expect(r.qtdConciliadas).toBe(1);
    expect(r.qtdExtrato).toBe(2);
  });
});
