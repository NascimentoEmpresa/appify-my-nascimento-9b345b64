import { describe, expect, it } from "vitest";
import { reconciliar } from "@/lib/conciliacaoBancariaEngine";
import { ehSaldoAnterior, linhasSaldoAnterior } from "@/lib/conciliacaoSaldoAnterior";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

const saldo = (valor: number, dia = "2026-01-01", id = "s1"): FluxoCaixaMaloteLinha =>
  ({
    despesa_id: id, id_malote: "IMP-1", data_pagamento: dia, competencia: dia, empresa_id: "e1", empresa_nome: "AGPS",
    contrato_id: null, contrato_nome: null, classificacao_id: "c1", classificacao_nome: "SALDO ANTERIOR",
    descricao: "AJUSTES DE CONTAS", forma_pagamento: "-", banco_id: "b1", banco_nome: "Banrisul", banco_logo_path: null,
    numero_parcela: null, numero_parcelas: null, valor, tipo: "entrada", origem: "importacao_historica", ajustado: false,
  }) as FluxoCaixaMaloteLinha;

describe("saldo anterior como linha da conciliação", () => {
  it("sem saldo digitado, o saldo do Fluxo fica fora (nada vira divergência falsa)", () => {
    const { plan, ofx } = linhasSaldoAnterior([saldo(270.22)], null, "2026-01-01", "Banrisul");
    expect(plan).toEqual([]);
    expect(ofx).toEqual([]);
  });

  it("saldo igual nos dois lados: o dia fecha OK, sem divergência", () => {
    const { plan, ofx } = linhasSaldoAnterior([saldo(270.22)], 270.22, "2026-01-01", "Banrisul");
    const res = reconciliar(plan, ofx);
    expect(res.divergencias).toBe(0);
    expect(res.lancamentos).toHaveLength(0);
  });

  it("saldo diferente: vira divergência na própria linha (e mantém o vínculo p/ ajustar)", () => {
    const { plan, ofx } = linhasSaldoAnterior([saldo(270.22)], 191.22, "2026-01-01", "Banrisul");
    expect(plan[0].despesaId).toBe("s1");
    const res = reconciliar(plan, ofx);
    expect(res.divergencias).toBe(1);
    expect(res.lancamentos.length).toBeGreaterThan(0);
  });

  it("extrato tem saldo e o Fluxo não: aparece como 'consta no extrato, sem lançamento no Fluxo'", () => {
    const { plan, ofx } = linhasSaldoAnterior([], 500, "2026-01-01", "Banrisul");
    expect(plan).toEqual([]);
    const res = reconciliar(plan, ofx);
    expect(res.lancamentos.some((l) => l.erro === "🚨 FLUXO - NÃO ENCONTRADO")).toBe(true);
  });

  it("várias linhas de saldo no Fluxo são comparadas pela soma", () => {
    const { plan, ofx } = linhasSaldoAnterior([saldo(100, "2026-01-01", "a"), saldo(170.22, "2026-01-01", "b")], 270.22, "2026-01-01", "Banrisul");
    expect(plan).toHaveLength(1);
    expect(plan[0].despesaId).toBeNull();
    expect(reconciliar(plan, ofx).divergencias).toBe(0);
  });

  it("a linha cai no dia do saldo do Fluxo; sem Fluxo, no início do período", () => {
    expect(linhasSaldoAnterior([saldo(10, "2026-01-02")], 10, "2026-01-01", "B").ofx[0].dia).toBe("2026-01-02");
    expect(linhasSaldoAnterior([], 10, "2026-01-01", "B").ofx[0].dia).toBe("2026-01-01");
  });

  it("ehSaldoAnterior reconhece pela classificação, sem depender de caixa/espaço", () => {
    expect(ehSaldoAnterior({ classificacao_nome: " saldo anterior " })).toBe(true);
    expect(ehSaldoAnterior({ classificacao_nome: "TARIFAS" })).toBe(false);
    expect(ehSaldoAnterior({ classificacao_nome: null })).toBe(false);
  });
});
