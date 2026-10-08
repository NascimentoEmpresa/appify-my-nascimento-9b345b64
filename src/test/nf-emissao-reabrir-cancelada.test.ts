import { describe, expect, it } from "vitest";
import { podeReabrirNfCancelada } from "@/pages/financeiro/nf-emissao/reabrirCancelada";

// A Anne manda a NF, o Financeiro cancela (às vezes por uma descrição ou um valor
// mínimo) e ela precisava refazer tudo. Agora reabre a mesma nota para corrigir.
describe("podeReabrirNfCancelada", () => {
  const cancelada = { status: "cancelada", situacao_site_pmt: "NORMAL", situacao_dominio: "NORMAL", data_pagamento: null, valor_pago: null };

  it("cancelada pelo Financeiro (validação), sem pagamento: pode reabrir", () => {
    expect(podeReabrirNfCancelada(cancelada)).toBe(true);
    expect(podeReabrirNfCancelada({ status: "cancelada" })).toBe(true);
  });

  it("só a cancelada: rascunho, enviada e concluída não têm o botão", () => {
    for (const status of ["rascunho", "enviada", "concluida"]) {
      expect(podeReabrirNfCancelada({ ...cancelada, status })).toBe(false);
    }
    expect(podeReabrirNfCancelada({})).toBe(false);
  });

  it("cancelada/substituída no site ou no Domínio é cancelamento de verdade: não reabre", () => {
    expect(podeReabrirNfCancelada({ ...cancelada, situacao_site_pmt: "CANCELADA" })).toBe(false);
    expect(podeReabrirNfCancelada({ ...cancelada, situacao_dominio: "SUBSTITUIDA" })).toBe(false);
    expect(podeReabrirNfCancelada({ ...cancelada, situacao_dominio: "cancelada" })).toBe(false);
  });

  it("com pagamento registrado não reabre", () => {
    expect(podeReabrirNfCancelada({ ...cancelada, data_pagamento: "2026-10-01" })).toBe(false);
    expect(podeReabrirNfCancelada({ ...cancelada, valor_pago: 1500 })).toBe(false);
    expect(podeReabrirNfCancelada({ ...cancelada, valor_pago: "0" })).toBe(true);
  });
});
