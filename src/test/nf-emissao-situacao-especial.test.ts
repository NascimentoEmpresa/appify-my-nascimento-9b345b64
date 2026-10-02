import { describe, expect, it } from "vitest";
import { valorPendenteNf, situacaoEspecial, statusDaNota, foraDoRelatorio, naoContabilizaKpi } from "@/pages/financeiro/nf-emissao/shared";

// Achado real (Ruan): nota Cancelada/Substituída (colunas legadas
// situacao_site_pmt/situacao_dominio) ainda carrega valores da planilha
// importada — sem excluí-la, ela contava como "pendente de receber" em
// todo lugar que soma isso (Dashboard, Relatório Geral, Notas Concluídas,
// Controle de Faturamento), mesmo nunca indo receber pagamento de verdade.

function nf(situacao: string | null, liquido: number, pago: number | null = null, dataPagamento: string | null = null) {
  return {
    vlr_liquido_total: liquido,
    valor_pago: pago,
    desconto_conta_vinculada: 0,
    situacao_site_pmt: situacao,
    situacao_dominio: null,
    data_pagamento: dataPagamento,
  };
}

describe("valorPendenteNf — exclui Cancelada/Substituída", () => {
  it("nota normal com líquido não pago conta como pendente", () => {
    expect(valorPendenteNf(nf(null, 1000), [])).toBe(1000);
  });

  it("nota Cancelada nunca conta como pendente, mesmo com valor líquido > 0", () => {
    expect(valorPendenteNf(nf("CANCELADA", 1000), [])).toBe(0);
  });

  it("nota Substituída nunca conta como pendente, mesmo com valor líquido > 0", () => {
    expect(valorPendenteNf(nf("SUBSTITUIDA", 1000), [])).toBe(0);
  });

  it("checagem de situação é case-insensitive (mesma regra de situacaoEspecial)", () => {
    expect(valorPendenteNf(nf("cancelada", 1000), [])).toBe(0);
  });
});

describe("situacaoEspecial / statusDaNota", () => {
  it("nota Cancelada não é confundida com paga só por ter valor_pago vazio", () => {
    expect(situacaoEspecial(nf("CANCELADA", 0))).toBe("CANCELADA");
    expect(statusDaNota(nf("CANCELADA", 0))).toBe("cancelada");
  });

  it("nota normal com pagamento registrado é 'pago'", () => {
    expect(statusDaNota(nf(null, 1000, 1000, "2026-09-30"))).toBe("pago");
  });
});

// Achado real (Ruan/Financeiro, 01/10/2026): processo real é rascunho ->
// enviada pro Financeiro -> Financeiro valida (concluida) ou rejeita
// (cancelada). Rascunho/enviada (ainda não validada) não deveria aparecer
// nem na listagem nem nos totais do Relatório Geral/Dashboard/Controle de
// Faturamento. Cancelada/Substituída (legada ou direto pelo app) PODE
// continuar aparecendo na listagem — é um registro válido, só não deve
// contar nos KPIs de dinheiro (pedido explícito do usuário).
describe("foraDoRelatorio — gate de listagem (rascunho/enviada fora)", () => {
  it("rascunho fica fora da listagem", () => {
    expect(foraDoRelatorio({ status: "rascunho" })).toBe(true);
  });

  it("enviada mas ainda não validada pelo Financeiro fica fora da listagem", () => {
    expect(foraDoRelatorio({ status: "enviada" })).toBe(true);
  });

  it("concluida entra na listagem", () => {
    expect(foraDoRelatorio({ status: "concluida" })).toBe(false);
  });

  it("cancelada pelo app também entra na listagem (só não conta no KPI)", () => {
    expect(foraDoRelatorio({ status: "cancelada" })).toBe(false);
  });
});

describe("naoContabilizaKpi — gate de soma (cancelada/substituída fora, de qualquer origem)", () => {
  it("cancelada pelo app não conta no KPI", () => {
    expect(naoContabilizaKpi({ status: "cancelada" })).toBe(true);
  });

  it("cancelada/substituída legada (planilha importada) não conta no KPI", () => {
    expect(naoContabilizaKpi({ status: "concluida", situacao_site_pmt: "CANCELADA", situacao_dominio: null })).toBe(true);
    expect(naoContabilizaKpi({ status: "concluida", situacao_site_pmt: "SUBSTITUIDA", situacao_dominio: null })).toBe(true);
  });

  it("nota concluida normal conta no KPI", () => {
    expect(naoContabilizaKpi({ status: "concluida" })).toBe(false);
  });
});
