import { describe, expect, it } from "vitest";
import { rateioMudouValor, rateioMudouEmpresa } from "@/pages/malote/DespesaVisualizar";
import type { RateioLinha } from "@/hooks/useMaloteDespesa";

// DM-2026-0268 (financeiro, via Iury): em ajuste_pagamento (correção pedida
// pela Conferência de Pagamento), o solicitante pode corrigir Valor e
// Empresa no Rateio (RateioGrid com apenasValorEEmpresa) — mas os dois têm
// destinos diferentes: mudar o Valor afeta orçamento já consumido e por
// isso força "Reenviar" (reinicia em N1); mudar só a Empresa não afeta
// nada (orçamento é do grupo, não por empresa) e pode ser salvo sem
// reiniciar aprovação. Estas duas funções são o que decide qual dos dois
// caminhos a tela oferece — ver rateioValorMudouNestaEdicao/
// rateioEmpresaMudouNestaEdicao em DespesaVisualizar.tsx.
function linha(overrides: Partial<RateioLinha> = {}): RateioLinha {
  return {
    id: "l1",
    empresa_id: "emp1",
    contrato_id: null,
    fornecedor_id: null,
    integrante_empregado_id: null,
    percentual: 100,
    valor: 1000,
    ordem: 0,
    ...overrides,
  };
}

describe("rateioMudouValor", () => {
  it("retorna false quando nada mudou", () => {
    expect(rateioMudouValor([linha()], [linha()])).toBe(false);
  });

  it("retorna true quando o valor de uma linha mudou", () => {
    expect(rateioMudouValor([linha({ valor: 1000 })], [linha({ valor: 1200 })])).toBe(true);
  });

  it("ignora mudança só de empresa", () => {
    expect(rateioMudouValor([linha({ empresa_id: "emp1" })], [linha({ empresa_id: "emp2" })])).toBe(false);
  });

  it("retorna true quando uma linha foi adicionada", () => {
    expect(rateioMudouValor([linha({ id: "l1" })], [linha({ id: "l1" }), linha({ id: "l2", valor: 500 })])).toBe(true);
  });

  it("retorna true quando uma linha foi removida", () => {
    expect(rateioMudouValor([linha({ id: "l1" }), linha({ id: "l2", valor: 500 })], [linha({ id: "l1" })])).toBe(true);
  });

  it("retorna true pra linha nova sem id (mesmo com mesma contagem)", () => {
    expect(rateioMudouValor([linha({ id: "l1" })], [{ ...linha({ id: undefined }) }])).toBe(true);
  });
});

describe("rateioMudouEmpresa", () => {
  it("retorna false quando nada mudou", () => {
    expect(rateioMudouEmpresa([linha()], [linha()])).toBe(false);
  });

  it("retorna true quando a empresa de uma linha mudou", () => {
    expect(rateioMudouEmpresa([linha({ empresa_id: "emp1" })], [linha({ empresa_id: "emp2" })])).toBe(true);
  });

  it("ignora mudança só de valor", () => {
    expect(rateioMudouEmpresa([linha({ valor: 1000 })], [linha({ valor: 1200 })])).toBe(false);
  });

  it("trata null e undefined como equivalentes (sem empresa)", () => {
    expect(rateioMudouEmpresa([linha({ empresa_id: null })], [linha({ empresa_id: null })])).toBe(false);
  });
});
