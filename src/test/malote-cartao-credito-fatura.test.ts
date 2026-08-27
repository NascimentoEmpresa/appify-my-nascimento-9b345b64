import { describe, expect, it } from "vitest";
import { calcularFatura } from "@/hooks/useMaloteCartaoCredito";

describe("calcularFatura", () => {
  it("entra na fatura do próprio mês quando o pagamento é antes do fechamento", () => {
    expect(calcularFatura("2026-08-02", 5)).toBe("2026-08");
  });

  it("entra na fatura do próprio mês quando o pagamento é exatamente no dia do fechamento", () => {
    expect(calcularFatura("2026-08-05", 5)).toBe("2026-08");
  });

  it("entra na fatura do mês seguinte quando o pagamento é depois do fechamento", () => {
    expect(calcularFatura("2026-08-06", 5)).toBe("2026-09");
  });

  it("lida com mês de 31 dias", () => {
    expect(calcularFatura("2026-08-31", 5)).toBe("2026-09");
  });

  it("vira o ano corretamente (dezembro -> janeiro)", () => {
    expect(calcularFatura("2026-12-20", 15)).toBe("2027-01");
  });

  it("não vira o ano quando o pagamento de dezembro ainda está dentro do fechamento", () => {
    expect(calcularFatura("2026-12-10", 15)).toBe("2026-12");
  });
});
