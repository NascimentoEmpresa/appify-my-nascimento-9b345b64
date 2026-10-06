import { describe, expect, it } from "vitest";
import {
  comprovantePendenteDoItem, diasAguardandoComprovante, pagoEmDoItem, severidadeComprovante, textoDiasComprovante,
} from "@/pages/malote/comprovantePendente";

describe("Malote — pago aguardando comprovante", () => {
  it("despesa não parcelada: pendente só quando paga e marcada", () => {
    const base = { parcela: null };
    expect(comprovantePendenteDoItem({ ...base, despesa: { status: "despesa_paga", comprovante_pendente: true } })).toBe(true);
    expect(comprovantePendenteDoItem({ ...base, despesa: { status: "despesa_paga", comprovante_pendente: false } })).toBe(false);
    // marca sem estar paga não conta (ex.: estornada/reaberta)
    expect(comprovantePendenteDoItem({ ...base, despesa: { status: "aguardando_pagamento", comprovante_pendente: true } })).toBe(false);
  });

  it("parcelada: a parcela decide, não a despesa", () => {
    const despesa = { status: "despesa_paga", comprovante_pendente: true };
    expect(comprovantePendenteDoItem({ despesa, parcela: { status: "paga", comprovante_pendente: false } })).toBe(false);
    expect(comprovantePendenteDoItem({ despesa, parcela: { status: "paga", comprovante_pendente: true } })).toBe(true);
    expect(comprovantePendenteDoItem({ despesa, parcela: { status: "pendente", comprovante_pendente: true } })).toBe(false);
  });

  it("pago_em vem da parcela quando parcelada", () => {
    expect(pagoEmDoItem({ despesa: { status: "x", pago_em: "2026-10-01" }, parcela: { status: "paga", pago_em: "2026-10-05" } })).toBe("2026-10-05");
    expect(pagoEmDoItem({ despesa: { status: "x", pago_em: "2026-10-01" }, parcela: null })).toBe("2026-10-01");
  });

  it("dias corridos desde o pagamento, nunca negativo", () => {
    const agora = new Date("2026-10-10T12:00:00Z");
    expect(diasAguardandoComprovante("2026-10-10T08:00:00Z", agora)).toBe(0);
    expect(diasAguardandoComprovante("2026-10-07T08:00:00Z", agora)).toBe(3);
    expect(diasAguardandoComprovante("2026-10-12T08:00:00Z", agora)).toBe(0);
    expect(diasAguardandoComprovante(null, agora)).toBe(0);
  });

  it("a cobrança esquenta com o tempo", () => {
    expect(severidadeComprovante(0)).toBe("normal");
    expect(severidadeComprovante(2)).toBe("normal");
    expect(severidadeComprovante(3)).toBe("atencao");
    expect(severidadeComprovante(6)).toBe("atencao");
    expect(severidadeComprovante(7)).toBe("critico");
    expect(textoDiasComprovante(0)).toBe("hoje");
    expect(textoDiasComprovante(1)).toBe("há 1 dia");
    expect(textoDiasComprovante(5)).toBe("há 5 dias");
  });
});
