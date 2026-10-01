import { describe, expect, it } from "vitest";
import { valorPendenteNf, situacaoEspecial, statusDaNota } from "@/pages/financeiro/nf-emissao/shared";

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
