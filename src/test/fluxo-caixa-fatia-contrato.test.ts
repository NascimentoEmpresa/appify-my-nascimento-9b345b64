import { describe, expect, it } from "vitest";
import { fatiaDoContratoNaLinha } from "@/pages/financeiro/fluxo-caixa/fatiaContrato";

// Os KPIs do Fluxo com um contrato filtrado somam a fatia dele nos rateios (ex.: 6 mil de um rateio de 10 mil).
const rateio = {
  valor: 10000, contrato_id: null, contrato_nome: "Rateio", fatura_cartao_id: null,
  rateioDetalhe: [{ id: "triunfo", nome: "TRIUNFO", valor: 6000 }, { id: "outro", nome: "OUTRO", valor: 4000 }],
  partesClassificacao: [{ classificacaoId: "k1", valor: 7000 }, { classificacaoId: "k2", valor: 3000 }],
};

describe("fatia do contrato no rateio", () => {
  it("com o contrato filtrado, a linha passa a valer só a cota dele e guarda o total do lançamento", () => {
    const l = fatiaDoContratoNaLinha(rateio, ["triunfo"]);
    expect(l.valor).toBe(6000);
    expect(l.valorLancamentoRateio).toBe(10000);
    expect(l.partesClassificacao?.map((p) => Math.round(p.valor))).toEqual([4200, 1800]);
  });
  it("vários contratos somam as cotas deles", () => {
    expect(fatiaDoContratoNaLinha(rateio, ["triunfo", "outro"]).valor).toBe(10000);
    expect(fatiaDoContratoNaLinha(rateio, ["triunfo", "outro"]).valorLancamentoRateio).toBeUndefined();
  });
  it("sem contrato filtrado, linha sem rateio e fatura de cartão ficam como estão", () => {
    expect(fatiaDoContratoNaLinha(rateio, [])).toBe(rateio);
    const simples = { valor: 50, contrato_id: "triunfo", fatura_cartao_id: null };
    expect(fatiaDoContratoNaLinha(simples, ["triunfo"])).toBe(simples);
    const fatura = { ...rateio, fatura_cartao_id: "f1" };
    expect(fatiaDoContratoNaLinha(fatura, ["triunfo"])).toBe(fatura);
  });
});
