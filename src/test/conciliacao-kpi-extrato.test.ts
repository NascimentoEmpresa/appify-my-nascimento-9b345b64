// SIS-2026-0736 (continuação): KPIs do extrato no Dashboard de Conciliações, comparáveis com o item 2 da Auditoria.
import { describe, expect, it } from "vitest";
import { totaisDoExtrato, totaisFluxoDosBancosConciliados } from "@/lib/conciliacaoDashboard";

const conc = (o: Record<string, unknown> = {}) => ({
  id: "c" + Math.random(), data_inicio: "2026-01-01", data_fim: "2026-01-31", banco_id: "b1", todas_empresas: false, empresa_ids: ["A"], conta_extrato: null, created_at: "2026-02-05T10:00:00Z",
  fluxo_entradas: 100, fluxo_saidas: 40, extrato_entradas: 90, extrato_saidas: 35, conciliado_entradas: 90, conciliado_saidas: 35, ...o,
}) as any;

const filtro = { empresaId: null, bancoId: null, mesDe: "2026-01", mesAte: "2026-01" };

describe("extrato do período (conciliações salvas)", () => {
  it("soma entradas e saídas do extrato das conciliações do período", () => {
    const r = totaisDoExtrato([conc(), conc({ banco_id: "b2", extrato_entradas: 10, extrato_saidas: 5 })], filtro);
    expect(r).toEqual({ entradas: 100, saidas: 40, conciliacoes: 2, semValores: 0 });
  });

  it("respeita empresa, banco e período", () => {
    const lista = [conc(), conc({ banco_id: "b2", empresa_ids: ["B"] }), conc({ data_fim: "2026-02-28", data_inicio: "2026-02-01" })];
    expect(totaisDoExtrato(lista, { ...filtro, empresaId: "A" }).conciliacoes).toBe(1);
    expect(totaisDoExtrato(lista, { ...filtro, bancoId: "b2" }).conciliacoes).toBe(1);
    expect(totaisDoExtrato(lista, { ...filtro, mesAte: "2026-02" }).conciliacoes).toBe(3);
  });

  it("conciliação antiga sem os totais gravados fica de fora e é contada", () => {
    const r = totaisDoExtrato([conc(), conc({ extrato_entradas: null, extrato_saidas: null })], filtro);
    expect(r).toMatchObject({ entradas: 90, saidas: 35, conciliacoes: 1, semValores: 1 });
  });
});

describe("Fluxo só dos bancos conciliados", () => {
  const l = (o: Record<string, unknown> = {}) => ({
    despesa_id: "d" + Math.random(), numero_parcela: null, empresa_id: "A", banco_id: "b1", data_pagamento: "2026-01-10", tipo: "saida", valor: 10, classificacao_nome: "SERVICOS", descricao: "x", banco_nome: "Banrisul", ...o,
  }) as any;
  const f = { dataDe: "2026-01-01", dataAte: "2026-01-31", empresaId: null, bancoId: null, mesDe: "2026-01", mesAte: "2026-01" };

  it("só conta banco e empresa com conciliação salva no mesmo mês", () => {
    const linhas = [l({ valor: 10 }), l({ valor: 20, banco_id: "b9" }), l({ valor: 30, empresa_id: "Z" }), l({ valor: 40, data_pagamento: "2026-02-03" }), l({ tipo: "entrada", valor: 50 })];
    expect(totaisFluxoDosBancosConciliados(linhas, [conc()], f, "2026-10-28")).toEqual({ entradas: 50, saidas: 10 });
  });

  it("ignora saldo anterior e o que a conciliação ignora (saída de conta vinculada)", () => {
    const linhas = [l({ valor: 10 }), l({ tipo: "entrada", valor: 999, classificacao_nome: "SALDO ANTERIOR" }), l({ valor: 77, descricao: "RESGATE CONTA VINCULADA" })];
    expect(totaisFluxoDosBancosConciliados(linhas, [conc()], f, "2026-10-28")).toEqual({ entradas: 0, saidas: 10 });
  });

  it("conciliação de todas as empresas cobre qualquer empresa daquele banco", () => {
    const linhas = [l({ valor: 10, empresa_id: "Z" })];
    expect(totaisFluxoDosBancosConciliados(linhas, [conc({ todas_empresas: true, empresa_ids: [] })], f, "2026-10-28").saidas).toBe(10);
  });
});
