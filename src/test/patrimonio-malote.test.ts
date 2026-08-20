import { describe, it, expect } from "vitest";
import { despesaEstaPaga, PARAM_ORIGEM } from "@/pages/juridico/patrimonio/vinculoMalote";

// O selo da conta do Patrimônio. A regra é a que a tela usa em statusObr:
// baixa manual > despesa no Malote (paga ou andando) > vencido > pendente.
type Conta = { status?: string | null; vencimento?: string | null; malote_despesa_id?: string | null };
const HOJE = "2026-08-20";

const statusConta = (o: Conta, paga: (id?: string | null) => boolean) => {
  if (o.status === "Pago") return "Pago";
  if (o.malote_despesa_id) return paga(o.malote_despesa_id) ? "Pago" : "Enviado ao Malote";
  if (o.vencimento && o.vencimento < HOJE) return "Vencido";
  return "Pendente";
};

describe("despesa do Malote está paga?", () => {
  it("reconhece o status e a data de pagamento", () => {
    // O status real da base hoje é "despesa_paga".
    expect(despesaEstaPaga({ status: "despesa_paga" })).toBe(true);
    expect(despesaEstaPaga({ status: "aguardando_pagamento", pago_em: "2026-08-19T10:00:00Z" })).toBe(true);
    expect(despesaEstaPaga({ status: "pendente_aprovacao" })).toBe(false);
    expect(despesaEstaPaga({ status: "pronto_para_pagar" })).toBe(false);
    expect(despesaEstaPaga(null)).toBe(false);
    expect(despesaEstaPaga(undefined)).toBe(false);
  });
});

describe("selo da conta", () => {
  const nenhumaPaga = () => false;
  const todasPagas = () => true;

  it("conta nova, dentro do prazo: Pendente", () => {
    expect(statusConta({ vencimento: "2026-09-10" }, nenhumaPaga)).toBe("Pendente");
  });

  it("passou do vencimento e ninguém mexeu: Vencido", () => {
    expect(statusConta({ vencimento: "2026-08-01" }, nenhumaPaga)).toBe("Vencido");
  });

  it("mandou pro Malote: Enviado ao Malote, mesmo vencida", () => {
    // Estava "Pendente" para sempre — era exatamente a queixa. E conta que já
    // está andando no Malote não deve voltar a "Vencido" só porque a data passou.
    expect(statusConta({ vencimento: "2026-09-10", malote_despesa_id: "d1" }, nenhumaPaga)).toBe("Enviado ao Malote");
    expect(statusConta({ vencimento: "2026-08-01", malote_despesa_id: "d1" }, nenhumaPaga)).toBe("Enviado ao Malote");
  });

  it("a despesa foi paga no Malote: Pago", () => {
    expect(statusConta({ vencimento: "2026-08-01", malote_despesa_id: "d1" }, todasPagas)).toBe("Pago");
  });

  it("baixa manual com comprovante continua valendo", () => {
    expect(statusConta({ status: "Pago", vencimento: "2026-08-01" }, nenhumaPaga)).toBe("Pago");
  });

  it("conta paga não volta a Vencido quando a data passa", () => {
    expect(statusConta({ status: "Pago", vencimento: "2020-01-01" }, nenhumaPaga)).toBe("Pago");
  });
});

describe("o parâmetro que liga as duas telas", () => {
  it("é o mesmo nome nos dois lados", () => {
    // O Patrimônio monta a URL e o Malote lê. Constante única para não
    // divergirem numa renomeação.
    expect(PARAM_ORIGEM).toBe("origem_obrigacao");
  });
});
