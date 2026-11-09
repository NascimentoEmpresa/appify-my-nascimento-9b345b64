import { describe, expect, it } from "vitest";
import type { ItemLinhaMalote, MaloteDespesaRow, Parcela } from "@/hooks/useMaloteDespesa";
import { valorDe } from "@/pages/malote/meusItensUtils";

const item = (d: Partial<MaloteDespesaRow>, parcela: Partial<Parcela> | null = null): ItemLinhaMalote =>
  ({ despesa: { valor_total: 100, valor_aprovado_cotacao: null, status: "aguardando_pagamento", ...d } as MaloteDespesaRow, parcela: parcela as Parcela | null });

describe("Meus Itens / Aprovações: valor da solicitação com cotação aprovada", () => {
  it("cotação aprovada mostra o valor aprovado na cotação, não o estimado", () => {
    expect(valorDe(item({ status: "cotacao_aprovada", valor_total: 400, valor_aprovado_cotacao: 325.35 }))).toBe(325.35);
  });
  it("cotação aprovada sem valor aprovado gravado cai no valor da solicitação", () => {
    expect(valorDe(item({ status: "cotacao_aprovada", valor_total: 400 }))).toBe(400);
  });
  it("depois de lançada como despesa, vale o valor lançado (valor_total), mesmo com cotação gravada", () => {
    expect(valorDe(item({ status: "pendente_aprovacao", valor_total: 330, valor_aprovado_cotacao: 325.35 }))).toBe(330);
    expect(valorDe(item({ status: "aguardando_pagamento", valor_total: 330, valor_aprovado_cotacao: 325.35 }))).toBe(330);
  });
  it("parcela sempre mostra o valor da parcela", () => {
    expect(valorDe(item({ status: "aguardando_pagamento", valor_total: 300 }, { valor: 100 }))).toBe(100);
  });
  it("solicitação ainda em cotação (não aprovada) mostra o estimado", () => {
    expect(valorDe(item({ status: "cotacao_realizada", valor_total: 400, valor_aprovado_cotacao: null }))).toBe(400);
  });
});
