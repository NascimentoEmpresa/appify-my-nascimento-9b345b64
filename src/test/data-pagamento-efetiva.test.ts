import { describe, expect, it } from "vitest";
import { dataPagamentoEfetiva } from "@/lib/dataPagamentoEfetiva";

const parcelas = [
  { data_vencimento: "2026-12-16", pago_em: null },
  { data_vencimento: "2026-11-16", pago_em: null },
  { data_vencimento: "2026-10-16", pago_em: "2026-10-16T10:00:00Z" },
];

describe("data de pagamento efetiva (despesa parcelada)", () => {
  it("parcelada usa a primeira parcela em aberto, não a data da compra (SD-2026-0224)", () => {
    expect(dataPagamentoEfetiva(true, parcelas, "2026-10-21")).toBe("2026-11-16");
  });
  it("ignora parcela já paga", () => {
    expect(dataPagamentoEfetiva(true, parcelas.slice(2), "2026-10-21")).toBe("2026-10-21");
  });
  it("não parcelada continua usando a data do cabeçalho", () => {
    expect(dataPagamentoEfetiva(false, parcelas, "2026-10-21")).toBe("2026-10-21");
  });
  it("sem parcelas carregadas cai no cabeçalho", () => {
    expect(dataPagamentoEfetiva(true, [], "2026-10-21")).toBe("2026-10-21");
    expect(dataPagamentoEfetiva(true, undefined, null)).toBe("");
  });
});
