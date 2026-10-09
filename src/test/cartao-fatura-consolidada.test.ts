import { describe, expect, it } from "vitest";
import { chaveFatura, compararFatura } from "@/pages/financeiro/cartao-credito/faturaConsolidada";

describe("SIS-2026-0632: comparação da fatura do cartão", () => {
  it("sem valor informado: nada a comparar", () => {
    expect(compararFatura(10478.74, null)).toEqual({ status: "sem_valor", diferenca: 0 });
    expect(compararFatura(10478.74, undefined).status).toBe("sem_valor");
  });

  it("confere quando a diferença é menor que 1 centavo", () => {
    expect(compararFatura(10478.74, 10478.74).status).toBe("confere");
    expect(compararFatura(0.1 + 0.2, 0.3).status).toBe("confere");
  });

  it("divergente: diferença = fatura − despesas (positiva = faltam despesas)", () => {
    expect(compararFatura(10000, 10478.74)).toEqual({ status: "divergente", diferenca: 478.74 });
    expect(compararFatura(10478.74, 10000)).toEqual({ status: "divergente", diferenca: -478.74 });
  });

  it("chave da fatura usa cartão + mês (ignora o dia)", () => {
    expect(chaveFatura("c1", "2026-10-01")).toBe("c1:2026-10");
    expect(chaveFatura("c1", "2026-10")).toBe("c1:2026-10");
  });
});
